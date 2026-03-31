/**
 * MCP Server Health Tracker
 *
 * 5-state model matching Claude Code source:
 *   pending -> connected -> degraded -> failed
 *                                    -> needs_auth
 *
 * Includes exponential backoff counters for reconnection tracking.
 */

const mcpHealth = new Map();

const ERROR_THRESHOLD = 3;
const FAIL_RATE_THRESHOLD = 0.5;
const MAX_RECONNECT_ATTEMPTS = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

/**
 * Initialize health entries from the SDK system/init message.
 * Servers present in init start as 'connected'.
 */
export function initMcpHealth(mcpServers) {
  mcpHealth.clear();
  if (!Array.isArray(mcpServers)) return;

  for (const server of mcpServers) {
    const name = typeof server === 'string' ? server : server.name || String(server);
    mcpHealth.set(name, {
      state: 'connected',
      toolCalls: 0,
      toolErrors: 0,
      lastError: null,
      updatedAt: Date.now(),
      reconnectAttempt: 0,
      maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
      nextBackoffMs: INITIAL_BACKOFF_MS,
    });
  }
}

/**
 * Transition a server to a specific state.
 */
export function setServerState(serverName, state, error = null) {
  const entry = mcpHealth.get(serverName);
  if (!entry) return;

  entry.state = state;
  entry.updatedAt = Date.now();
  if (error) entry.lastError = error;

  if (state === 'connected') {
    entry.reconnectAttempt = 0;
    entry.nextBackoffMs = INITIAL_BACKOFF_MS;
  } else if (state === 'pending') {
    entry.reconnectAttempt++;
    entry.nextBackoffMs = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, entry.reconnectAttempt - 1),
      MAX_BACKOFF_MS,
    );
  }
}

/**
 * Record an MCP tool call outcome.
 * @param {string} toolName - Full tool name (e.g. mcp__filesystem__read_file)
 * @param {boolean} success - Whether the call succeeded
 * @param {string|null} error - Error message if failed
 */
export function recordToolCall(toolName, success, error) {
  if (!toolName?.startsWith('mcp__')) return;
  const parts = toolName.split('__');
  if (parts.length < 3) return;
  const serverName = parts[1];

  const entry = mcpHealth.get(serverName);
  if (!entry) return;

  entry.toolCalls++;
  entry.updatedAt = Date.now();

  if (!success) {
    entry.toolErrors++;
    entry.lastError = error || 'unknown error';

    // Check for auth errors
    if (
      typeof error === 'string' &&
      (error.includes('auth') || error.includes('401') || error.includes('403'))
    ) {
      entry.state = 'needs_auth';
      return;
    }

    const failRate = entry.toolErrors / entry.toolCalls;
    if (failRate >= FAIL_RATE_THRESHOLD && entry.toolErrors >= ERROR_THRESHOLD) {
      entry.state = 'failed';
    } else if (entry.toolErrors > 0) {
      entry.state = 'degraded';
    }
  } else if (entry.state === 'degraded') {
    entry.state = 'connected';
  }
}

/**
 * Get current health snapshot for all MCP servers.
 */
export function getMcpHealth() {
  const result = {};
  for (const [name, entry] of mcpHealth) {
    result[name] = { ...entry };
  }
  return result;
}
