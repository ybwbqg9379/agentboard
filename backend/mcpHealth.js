/**
 * MCP Server Health Tracker
 *
 * Monitors MCP server states based on SDK init messages and tool call outcomes.
 * States: pending | connected | degraded | failed
 */

const mcpHealth = new Map();

const ERROR_THRESHOLD = 3;
const FAIL_RATE_THRESHOLD = 0.5;

/**
 * Initialize health entries from the SDK system/init message.
 * Servers present in init are assumed connected.
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
    });
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
