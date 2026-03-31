import { describe, it, expect, beforeEach } from 'vitest';
import { initMcpHealth, setServerState, recordToolCall, getMcpHealth } from './mcpHealth.js';

// ---------------------------------------------------------------------------
// initMcpHealth
// ---------------------------------------------------------------------------
describe('initMcpHealth', () => {
  it('initializes from a string array, all servers start as connected', () => {
    initMcpHealth(['filesystem', 'github']);
    const health = getMcpHealth();

    expect(Object.keys(health)).toEqual(['filesystem', 'github']);
    expect(health.filesystem.state).toBe('connected');
    expect(health.github.state).toBe('connected');
    expect(health.filesystem.toolCalls).toBe(0);
    expect(health.filesystem.toolErrors).toBe(0);
    expect(health.filesystem.lastError).toBeNull();
    expect(health.filesystem.reconnectAttempt).toBe(0);
    expect(health.filesystem.nextBackoffMs).toBe(1000); // INITIAL_BACKOFF_MS
  });

  it('initializes from object array with .name property', () => {
    initMcpHealth([{ name: 'slack' }, { name: 'jira' }]);
    const health = getMcpHealth();
    expect(Object.keys(health)).toEqual(['slack', 'jira']);
    expect(health.slack.state).toBe('connected');
  });

  it('clears previous state on re-init', () => {
    initMcpHealth(['old_server']);
    expect(getMcpHealth()).toHaveProperty('old_server');

    initMcpHealth(['new_server']);
    const health = getMcpHealth();
    expect(health).not.toHaveProperty('old_server');
    expect(health).toHaveProperty('new_server');
  });

  it('handles non-array input gracefully (no crash)', () => {
    initMcpHealth(null);
    expect(getMcpHealth()).toEqual({});

    initMcpHealth(undefined);
    expect(getMcpHealth()).toEqual({});

    initMcpHealth('not-an-array');
    expect(getMcpHealth()).toEqual({});
  });

  it('handles mixed string and object entries', () => {
    initMcpHealth(['plain', { name: 'obj' }]);
    const health = getMcpHealth();
    expect(health.plain.state).toBe('connected');
    expect(health.obj.state).toBe('connected');
  });
});

// ---------------------------------------------------------------------------
// setServerState
// ---------------------------------------------------------------------------
describe('setServerState', () => {
  beforeEach(() => {
    initMcpHealth(['alpha', 'beta']);
  });

  it('transitions to connected and resets reconnect counters', () => {
    // First move to pending to increment counters
    setServerState('alpha', 'pending');
    expect(getMcpHealth().alpha.reconnectAttempt).toBe(1);

    // Then move back to connected
    setServerState('alpha', 'connected');
    const entry = getMcpHealth().alpha;
    expect(entry.state).toBe('connected');
    expect(entry.reconnectAttempt).toBe(0);
    expect(entry.nextBackoffMs).toBe(1000); // INITIAL_BACKOFF_MS
  });

  it('transitions to pending increments reconnectAttempt and doubles backoff', () => {
    setServerState('alpha', 'pending');
    let entry = getMcpHealth().alpha;
    expect(entry.state).toBe('pending');
    expect(entry.reconnectAttempt).toBe(1);
    expect(entry.nextBackoffMs).toBe(1000); // 1000 * 2^0

    setServerState('alpha', 'pending');
    entry = getMcpHealth().alpha;
    expect(entry.reconnectAttempt).toBe(2);
    expect(entry.nextBackoffMs).toBe(2000); // 1000 * 2^1

    setServerState('alpha', 'pending');
    entry = getMcpHealth().alpha;
    expect(entry.reconnectAttempt).toBe(3);
    expect(entry.nextBackoffMs).toBe(4000); // 1000 * 2^2
  });

  it('caps backoff at MAX_BACKOFF_MS (30000) after many pending transitions', () => {
    for (let i = 0; i < 20; i++) {
      setServerState('alpha', 'pending');
    }
    const entry = getMcpHealth().alpha;
    expect(entry.nextBackoffMs).toBeLessThanOrEqual(30000);
    expect(entry.nextBackoffMs).toBe(30000);
  });

  it('is a no-op for unknown server name', () => {
    const before = getMcpHealth();
    setServerState('nonexistent', 'failed', 'some error');
    const after = getMcpHealth();
    expect(after).toEqual(before);
  });

  it('sets lastError when error is provided', () => {
    setServerState('alpha', 'failed', 'connection refused');
    expect(getMcpHealth().alpha.lastError).toBe('connection refused');
  });

  it('does not overwrite lastError when error is not provided', () => {
    setServerState('alpha', 'failed', 'first error');
    setServerState('alpha', 'degraded');
    expect(getMcpHealth().alpha.lastError).toBe('first error');
  });

  it('transitions to arbitrary states like degraded and failed', () => {
    setServerState('beta', 'degraded');
    expect(getMcpHealth().beta.state).toBe('degraded');

    setServerState('beta', 'failed');
    expect(getMcpHealth().beta.state).toBe('failed');
  });
});

// ---------------------------------------------------------------------------
// recordToolCall
// ---------------------------------------------------------------------------
describe('recordToolCall', () => {
  beforeEach(() => {
    initMcpHealth(['filesystem', 'github']);
  });

  it('ignores non-MCP tools (no mcp__ prefix)', () => {
    recordToolCall('Bash', true, null);
    recordToolCall('Read', false, 'err');
    // No changes to any server
    const health = getMcpHealth();
    expect(health.filesystem.toolCalls).toBe(0);
    expect(health.github.toolCalls).toBe(0);
  });

  it('ignores malformed tool names with fewer than 3 parts', () => {
    recordToolCall('mcp__only_two', true, null);
    const health = getMcpHealth();
    expect(health.filesystem.toolCalls).toBe(0);
  });

  it('ignores unknown server names', () => {
    recordToolCall('mcp__unknown_server__tool', true, null);
    // Should not crash, no server entry created
    expect(getMcpHealth()).not.toHaveProperty('unknown_server');
  });

  it('increments toolCalls on success', () => {
    recordToolCall('mcp__filesystem__read_file', true, null);
    expect(getMcpHealth().filesystem.toolCalls).toBe(1);

    recordToolCall('mcp__filesystem__write_file', true, null);
    expect(getMcpHealth().filesystem.toolCalls).toBe(2);
  });

  it('success after degraded transitions back to connected', () => {
    // Make it degraded first
    recordToolCall('mcp__filesystem__read', false, 'timeout');
    expect(getMcpHealth().filesystem.state).toBe('degraded');

    // Success should recover
    recordToolCall('mcp__filesystem__read', true, null);
    expect(getMcpHealth().filesystem.state).toBe('connected');
  });

  it('first failure transitions to degraded', () => {
    recordToolCall('mcp__filesystem__read', false, 'timeout');
    const entry = getMcpHealth().filesystem;
    expect(entry.state).toBe('degraded');
    expect(entry.toolErrors).toBe(1);
    expect(entry.lastError).toBe('timeout');
  });

  it('failures at threshold (>=3 errors, >=50% fail rate) transition to failed', () => {
    // 3 failures, 0 successes => 100% fail rate, 3 errors
    recordToolCall('mcp__filesystem__a', false, 'e1');
    recordToolCall('mcp__filesystem__b', false, 'e2');
    recordToolCall('mcp__filesystem__c', false, 'e3');

    expect(getMcpHealth().filesystem.state).toBe('failed');
  });

  it('failures below threshold stay degraded', () => {
    // 2 failures out of 2 calls: rate >= 0.5 but errors < 3
    recordToolCall('mcp__filesystem__a', false, 'e1');
    recordToolCall('mcp__filesystem__b', false, 'e2');

    expect(getMcpHealth().filesystem.state).toBe('degraded');
    expect(getMcpHealth().filesystem.toolErrors).toBe(2);
  });

  it('high success rate keeps below threshold even with some errors', () => {
    // 8 successes, then 2 failures => fail rate 2/10 = 20%, below 50%
    for (let i = 0; i < 8; i++) {
      recordToolCall('mcp__filesystem__read', true, null);
    }
    recordToolCall('mcp__filesystem__read', false, 'e1');
    recordToolCall('mcp__filesystem__read', false, 'e2');

    // 2 errors, fail rate 0.2 -- both below thresholds
    expect(getMcpHealth().filesystem.state).toBe('degraded');
  });

  it('auth error (contains "auth") transitions to needs_auth', () => {
    recordToolCall('mcp__github__list_repos', false, 'authentication required');
    expect(getMcpHealth().github.state).toBe('needs_auth');
  });

  it('auth error (contains "401") transitions to needs_auth', () => {
    recordToolCall('mcp__github__list_repos', false, 'HTTP 401 Unauthorized');
    expect(getMcpHealth().github.state).toBe('needs_auth');
  });

  it('auth error (contains "403") transitions to needs_auth', () => {
    recordToolCall('mcp__github__push', false, 'HTTP 403 Forbidden');
    expect(getMcpHealth().github.state).toBe('needs_auth');
  });

  it('auth error takes precedence over threshold-based transitions', () => {
    // Even with many errors, auth error should set needs_auth not failed
    recordToolCall('mcp__github__a', false, 'timeout');
    recordToolCall('mcp__github__b', false, 'timeout');
    recordToolCall('mcp__github__c', false, '401 unauthorized');

    expect(getMcpHealth().github.state).toBe('needs_auth');
  });

  it('sets lastError to "unknown error" when error is falsy on failure', () => {
    recordToolCall('mcp__filesystem__read', false, null);
    expect(getMcpHealth().filesystem.lastError).toBe('unknown error');
  });

  it('success on connected server stays connected (no regression)', () => {
    recordToolCall('mcp__filesystem__read', true, null);
    expect(getMcpHealth().filesystem.state).toBe('connected');
  });
});

// ---------------------------------------------------------------------------
// getMcpHealth
// ---------------------------------------------------------------------------
describe('getMcpHealth', () => {
  beforeEach(() => {
    initMcpHealth(['server_a', 'server_b']);
  });

  it('returns an object containing all server entries', () => {
    const health = getMcpHealth();
    expect(Object.keys(health)).toEqual(['server_a', 'server_b']);
  });

  it('returns a copy, not a reference (mutations do not affect internal state)', () => {
    const health1 = getMcpHealth();
    health1.server_a.state = 'TAMPERED';
    health1.server_a.toolCalls = 9999;

    const health2 = getMcpHealth();
    expect(health2.server_a.state).toBe('connected');
    expect(health2.server_a.toolCalls).toBe(0);
  });

  it('returns empty object when no servers initialized', () => {
    initMcpHealth([]);
    expect(getMcpHealth()).toEqual({});
  });

  it('each entry has expected shape', () => {
    const entry = getMcpHealth().server_a;
    expect(entry).toEqual(
      expect.objectContaining({
        state: expect.any(String),
        toolCalls: expect.any(Number),
        toolErrors: expect.any(Number),
        lastError: null,
        updatedAt: expect.any(Number),
        reconnectAttempt: expect.any(Number),
        maxReconnectAttempts: expect.any(Number),
        nextBackoffMs: expect.any(Number),
      }),
    );
  });
});
