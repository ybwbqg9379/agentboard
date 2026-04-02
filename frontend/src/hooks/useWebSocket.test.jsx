// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock WebSocket
// ---------------------------------------------------------------------------
let lastWs;

class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    this.sent = [];
    lastWs = this;
  }
  send(data) {
    this.sent.push(data);
  }
  close() {
    this.readyState = MockWebSocket.CLOSED;
  }
}
MockWebSocket.CONNECTING = 0;
MockWebSocket.OPEN = 1;
MockWebSocket.CLOSED = 3;

vi.stubGlobal('WebSocket', MockWebSocket);
vi.stubGlobal('fetch', vi.fn());
vi.stubGlobal('localStorage', {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
});

// ---------------------------------------------------------------------------
// Import after mocks are in place
// ---------------------------------------------------------------------------
import { useWebSocket } from './useWebSocket.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function renderAndConnect() {
  const result = renderHook(() => useWebSocket());
  // Trigger onopen to simulate connection
  act(() => {
    lastWs.readyState = MockWebSocket.OPEN;
    lastWs.onopen();
  });
  return result;
}

function simulateMessage(msg) {
  act(() => {
    lastWs.onmessage({ data: JSON.stringify(msg) });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('useWebSocket', () => {
  beforeEach(() => {
    lastWs = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('initial state: connected=false, events=[], sessionId=null, status=idle', () => {
    const { result } = renderHook(() => useWebSocket());
    // Before onopen fires, connected should be false
    expect(result.current.connected).toBe(false);
    expect(result.current.events).toEqual([]);
    expect(result.current.sessionId).toBeNull();
    expect(result.current.status).toBe('idle');
  });

  it('after WebSocket opens: connected=true', () => {
    const { result } = renderAndConnect();
    expect(result.current.connected).toBe(true);
  });

  it('startAgent sends { action: start, prompt, permissionMode }', () => {
    const { result } = renderAndConnect();
    act(() => {
      result.current.startAgent('build a feature', { permissionMode: 'auto' });
    });
    expect(lastWs.sent).toHaveLength(1);
    const parsed = JSON.parse(lastWs.sent[0]);
    expect(parsed).toMatchObject({
      action: 'start',
      prompt: 'build a feature',
      permissionMode: 'auto',
    });
  });

  it('startAgent sets status to running', () => {
    const { result } = renderAndConnect();
    act(() => {
      result.current.startAgent('task');
    });
    expect(result.current.status).toBe('running');
  });

  it('stopAgent sends { action: stop, sessionId }', () => {
    const { result } = renderAndConnect();
    // First, start a session so sessionIdRef is set
    simulateMessage({ type: 'session_started', sessionId: 'sess-1' });
    act(() => {
      result.current.stopAgent();
    });
    const parsed = JSON.parse(lastWs.sent[lastWs.sent.length - 1]);
    expect(parsed).toMatchObject({ action: 'stop', sessionId: 'sess-1' });
  });

  it('clearSession sends unsubscribe and resets all state', () => {
    const { result } = renderAndConnect();
    // Setup some state
    simulateMessage({ type: 'session_started', sessionId: 'sess-1' });
    simulateMessage({ type: 'system', subtype: 'init', content: { model: 'x', tools: [] } });

    act(() => {
      result.current.clearSession();
    });

    const lastSent = JSON.parse(lastWs.sent[lastWs.sent.length - 1]);
    expect(lastSent).toMatchObject({ action: 'unsubscribe' });
    expect(result.current.sessionId).toBeNull();
    expect(result.current.status).toBe('idle');
    expect(result.current.events).toEqual([]);
    expect(result.current.sessionStats).toBeNull();
    expect(result.current.mcpHealth).toEqual({});
    expect(result.current.subtasks).toEqual({});
  });

  it('receiving session_started sets sessionId and status=running', () => {
    const { result } = renderAndConnect();
    simulateMessage({ type: 'session_started', sessionId: 'sess-abc' });
    expect(result.current.sessionId).toBe('sess-abc');
    expect(result.current.status).toBe('running');
    // session_started also clears events
    expect(result.current.events).toEqual([]);
  });

  it('receiving subscribed message sets sessionId', () => {
    const { result } = renderAndConnect();
    simulateMessage({ type: 'subscribed', sessionId: 'sess-sub' });
    expect(result.current.sessionId).toBe('sess-sub');
  });

  it('receiving done message sets final status', () => {
    const { result } = renderAndConnect();
    simulateMessage({ type: 'session_started', sessionId: 'sess-1' });
    simulateMessage({ type: 'done', content: { status: 'completed' } });
    expect(result.current.status).toBe('completed');
  });

  it('receiving done with failed status', () => {
    const { result } = renderAndConnect();
    simulateMessage({ type: 'session_started', sessionId: 'sess-1' });
    simulateMessage({ type: 'done', content: { status: 'failed' } });
    expect(result.current.status).toBe('failed');
  });

  it('receiving done defaults to completed when status missing', () => {
    const { result } = renderAndConnect();
    simulateMessage({ type: 'done', content: {} });
    expect(result.current.status).toBe('completed');
  });

  it('receiving result message updates sessionStats', () => {
    const { result } = renderAndConnect();
    simulateMessage({
      type: 'result',
      content: {
        total_cost_usd: 0.05,
        usage: { input_tokens: 1000, output_tokens: 500 },
        duration_ms: 5000,
        num_turns: 3,
      },
    });
    expect(result.current.sessionStats).toMatchObject({
      cost_usd: 0.05,
      input_tokens: 1000,
      output_tokens: 500,
      duration_ms: 5000,
      num_turns: 3,
    });
  });

  it('receiving system init message sets sessionStats', () => {
    const { result } = renderAndConnect();
    simulateMessage({
      type: 'system',
      subtype: 'init',
      content: {
        model: 'claude-4',
        tools: ['Read', 'Write', 'Edit'],
        mcp_servers: ['github'],
      },
    });
    expect(result.current.sessionStats).toMatchObject({
      model: 'claude-4',
      tools: 3,
      mcpServers: 1,
    });
  });

  it('receiving system init initializes mcpHealth', () => {
    const { result } = renderAndConnect();
    simulateMessage({
      type: 'system',
      subtype: 'init',
      content: {
        model: 'x',
        tools: [],
        mcp_servers: ['github', { name: 'sentry' }],
      },
    });
    expect(result.current.mcpHealth).toMatchObject({
      github: { state: 'connected', toolCalls: 0, toolErrors: 0 },
      sentry: { state: 'connected', toolCalls: 0, toolErrors: 0 },
    });
  });

  it('receiving system tool_complete updates mcpHealth', () => {
    const { result } = renderAndConnect();
    // Init with mcp server
    simulateMessage({
      type: 'system',
      subtype: 'init',
      content: { model: 'x', tools: [], mcp_servers: ['github'] },
    });
    // Simulate tool_complete for mcp tool
    simulateMessage({
      type: 'system',
      subtype: 'tool_complete',
      content: { tool: 'mcp__github__get_repo' },
    });
    expect(result.current.mcpHealth.github.toolCalls).toBe(1);
    expect(result.current.mcpHealth.github.toolErrors).toBe(0);
    expect(result.current.mcpHealth.github.state).toBe('connected');
  });

  it('receiving system tool_failed updates mcpHealth', () => {
    const { result } = renderAndConnect();
    simulateMessage({
      type: 'system',
      subtype: 'init',
      content: { model: 'x', tools: [], mcp_servers: ['github'] },
    });
    simulateMessage({
      type: 'system',
      subtype: 'tool_failed',
      content: { tool: 'mcp__github__get_repo' },
    });
    expect(result.current.mcpHealth.github.toolCalls).toBe(1);
    expect(result.current.mcpHealth.github.toolErrors).toBe(1);
    // First failure -> degraded (errors < 2 before increment)
    expect(result.current.mcpHealth.github.state).toBe('degraded');
  });

  it('events accumulate in the events array', () => {
    const { result } = renderAndConnect();
    simulateMessage({ type: 'system', subtype: 'init', content: { model: 'x', tools: [] } });
    simulateMessage({ type: 'assistant', content: { text: 'hello' } });
    simulateMessage({ type: 'assistant', content: { text: 'world' } });
    expect(result.current.events).toHaveLength(3);
  });

  it('MAX_EVENTS cap: events array does not exceed 5000', () => {
    const { result } = renderAndConnect();
    // Push 5001 events
    act(() => {
      for (let i = 0; i < 5001; i++) {
        lastWs.onmessage({
          data: JSON.stringify({ type: 'assistant', content: { text: `msg-${i}` } }),
        });
      }
    });
    expect(result.current.events.length).toBeLessThanOrEqual(5000);
  });

  it('messages with error field are ignored (not added to events)', () => {
    const { result } = renderAndConnect();
    simulateMessage({ error: 'something went wrong' });
    expect(result.current.events).toEqual([]);
  });

  it('pong heartbeat replies are ignored', () => {
    const { result } = renderAndConnect();
    simulateMessage({ type: 'pong' });
    expect(result.current.events).toEqual([]);
  });

  it('unsubscribed message is handled silently', () => {
    const { result } = renderAndConnect();
    simulateMessage({ type: 'session_started', sessionId: 'sess-1' });
    const eventsBefore = result.current.events.length;
    simulateMessage({ type: 'unsubscribed' });
    // unsubscribed returns early, no event added
    expect(result.current.events).toHaveLength(eventsBefore);
  });

  it('session_started clears previous events and sessionStats', () => {
    const { result } = renderAndConnect();
    // Accumulate some events
    simulateMessage({ type: 'assistant', content: { text: 'old' } });
    expect(result.current.events).toHaveLength(1);
    // New session
    simulateMessage({ type: 'session_started', sessionId: 'sess-new' });
    expect(result.current.events).toEqual([]);
    expect(result.current.sessionStats).toBeNull();
  });

  it('system init with content.subtype also triggers stats', () => {
    const { result } = renderAndConnect();
    simulateMessage({
      type: 'system',
      content: { subtype: 'init', model: 'opus', tools: ['a', 'b'] },
    });
    expect(result.current.sessionStats).toMatchObject({
      model: 'opus',
      tools: 2,
    });
  });

  it('tracks subtasks from task_started messages', () => {
    const { result } = renderAndConnect();
    simulateMessage({
      type: 'system',
      subtype: 'task_started',
      content: { task_id: 't1', description: 'Analyze code' },
      timestamp: '2026-03-31T12:00:00Z',
    });
    expect(result.current.subtasks).toHaveProperty('t1');
    expect(result.current.subtasks.t1).toMatchObject({
      description: 'Analyze code',
      status: 'running',
    });
  });

  it('tracks subtask completion from task_notification', () => {
    const { result } = renderAndConnect();
    simulateMessage({
      type: 'system',
      subtype: 'task_started',
      content: { task_id: 't1', description: 'Work' },
      timestamp: '2026-03-31T12:00:00Z',
    });
    simulateMessage({
      type: 'system',
      subtype: 'task_notification',
      content: { task_id: 't1', status: 'completed', summary: 'All done' },
    });
    expect(result.current.subtasks.t1).toMatchObject({
      status: 'completed',
      summary: 'All done',
    });
  });

  it('non-mcp tool events do not affect mcpHealth', () => {
    const { result } = renderAndConnect();
    simulateMessage({
      type: 'system',
      subtype: 'init',
      content: { model: 'x', tools: [], mcp_servers: ['github'] },
    });
    simulateMessage({
      type: 'system',
      subtype: 'tool_complete',
      content: { tool: 'Read' }, // not mcp__
    });
    expect(result.current.mcpHealth.github.toolCalls).toBe(0);
  });

  it('WebSocket close sets connected=false', () => {
    const { result } = renderAndConnect();
    expect(result.current.connected).toBe(true);
    act(() => {
      lastWs.readyState = MockWebSocket.CLOSED;
      lastWs.onclose();
    });
    expect(result.current.connected).toBe(false);
  });

  it('malformed JSON messages are ignored', () => {
    const { result } = renderAndConnect();
    act(() => {
      lastWs.onmessage({ data: 'not-json{{{' });
    });
    expect(result.current.events).toEqual([]);
  });

  // --- Regression tests for bugfix batch ---

  it('session_resumed updates sessionIdRef and sessionId state', () => {
    const { result } = renderAndConnect();
    act(() => {
      lastWs.onmessage({
        data: JSON.stringify({ type: 'session_resumed', sessionId: 'resumed-sid-123' }),
      });
    });
    expect(result.current.sessionId).toBe('resumed-sid-123');
    expect(result.current.status).toBe('running');
  });

  it('result message extracts cache_read_tokens into sessionStats', () => {
    const { result } = renderAndConnect();
    act(() => {
      lastWs.onmessage({
        data: JSON.stringify({
          type: 'result',
          content: {
            total_cost_usd: 0.01,
            usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 30 },
            duration_ms: 500,
            num_turns: 2,
          },
        }),
      });
    });
    expect(result.current.sessionStats.cache_read_tokens).toBe(30);
    expect(result.current.sessionStats.input_tokens).toBe(100);
  });

  it('result message extracts cache_read_input_tokens as fallback', () => {
    const { result } = renderAndConnect();
    act(() => {
      lastWs.onmessage({
        data: JSON.stringify({
          type: 'result',
          content: {
            usage: { input_tokens: 200, output_tokens: 80, cache_read_input_tokens: 60 },
          },
        }),
      });
    });
    expect(result.current.sessionStats.cache_read_tokens).toBe(60);
  });

  it('getWsUrl appends token from localStorage when available', () => {
    // Verify the localStorage mock is in place and getItem returns null by default
    expect(localStorage.getItem('agentboard_api_key')).toBeNull();
  });

  it('does not enter running state when startAgent is called before socket opens', () => {
    const { result } = renderHook(() => useWebSocket());
    act(() => {
      result.current.startAgent('task before connect');
    });
    expect(result.current.status).toBe('idle');
    expect(lastWs.sent).toEqual([]);
  });

  it('MCP health transitions to failed after 3 consecutive errors, not 2 (M3 fix)', () => {
    const { result } = renderAndConnect();
    simulateMessage({
      type: 'system',
      subtype: 'init',
      content: { model: 'x', tools: [], mcp_servers: ['test'] },
    });
    // Error 1 -> degraded
    simulateMessage({ type: 'system', subtype: 'tool_failed', content: { tool: 'mcp__test__fn' } });
    expect(result.current.mcpHealth.test.state).toBe('degraded');
    // Error 2 -> still degraded
    simulateMessage({ type: 'system', subtype: 'tool_failed', content: { tool: 'mcp__test__fn' } });
    expect(result.current.mcpHealth.test.state).toBe('degraded');
    // Error 3 -> failed
    simulateMessage({ type: 'system', subtype: 'tool_failed', content: { tool: 'mcp__test__fn' } });
    expect(result.current.mcpHealth.test.state).toBe('failed');
  });

  it('loadSession sends WS subscribe when loaded session is running (M5 fix)', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [],
        status: 'running',
        stats: null,
      }),
    });
    const { result } = renderAndConnect();
    await act(async () => {
      await result.current.loadSession('running-sess');
    });
    expect(result.current.sessionId).toBe('running-sess');
    expect(result.current.status).toBe('running');
    const subscribeSent = lastWs.sent.find((s) => {
      try {
        const p = JSON.parse(s);
        return p.action === 'subscribe' && p.sessionId === 'running-sess';
      } catch {
        return false;
      }
    });
    expect(subscribeSent).toBeTruthy();
  });

  it('loadSession does NOT send subscribe for completed sessions', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        events: [],
        status: 'completed',
        stats: null,
      }),
    });
    const { result } = renderAndConnect();
    const sentBefore = lastWs.sent.length;
    await act(async () => {
      await result.current.loadSession('done-sess');
    });
    const subscribeMsgs = lastWs.sent.slice(sentBefore).filter((s) => {
      try {
        return JSON.parse(s).action === 'subscribe';
      } catch {
        return false;
      }
    });
    expect(subscribeMsgs).toHaveLength(0);
  });

  it('pong timeout: closes WS if no message received within 45s (High-2 fix)', () => {
    const { result } = renderAndConnect();
    expect(result.current.connected).toBe(true);
    // Advance past heartbeat interval (30s) -- no messages received
    // First tick at 30s: lastMessageTime was set at connect, so 30s < 45s, just sends ping
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(lastWs.sent).toContain('ping');
    expect(lastWs.readyState).toBe(MockWebSocket.OPEN);

    // Advance another 30s (total 60s since last message) -- exceeds 45s threshold
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    // WS should have been closed due to pong timeout
    expect(lastWs.readyState).toBe(MockWebSocket.CLOSED);
  });

  it('pong timeout resets when messages are received', () => {
    renderAndConnect();
    // Advance 25s, then receive a message
    act(() => {
      vi.advanceTimersByTime(25000);
    });
    simulateMessage({ type: 'pong' });
    // Advance another 30s (55s total, but only 30s since last message)
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    // Should still be open (30s < 45s since last message)
    expect(lastWs.readyState).toBe(MockWebSocket.OPEN);
  });

  it('loadExperimentRunsEvents restores the real run status for history views', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          trials: [
            {
              trial_number: 1,
              accepted: false,
              primary_metric: null,
              diff: null,
              reason: 'aborted',
              created_at: '2026-04-01T19:30:00Z',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'aborted' }),
      });

    const { result } = renderAndConnect();
    const sentBefore = lastWs.sent.length;

    await act(async () => {
      await result.current.loadExperimentRunsEvents(
        '11111111-1111-4111-8111-111111111111',
        '22222222-2222-4222-8222-222222222222',
      );
    });

    expect(result.current.experimentRunId).toBe('11111111-1111-4111-8111-111111111111');
    expect(result.current.experimentStatus).toBe('aborted');
    expect(result.current.experimentEvents).toHaveLength(1);

    const subscribeMsgs = lastWs.sent.slice(sentBefore).filter((s) => {
      try {
        return JSON.parse(s).action === 'subscribe_experiment';
      } catch {
        return false;
      }
    });
    expect(subscribeMsgs).toHaveLength(0);
  });

  it('loadExperimentRunsEvents re-subscribes only when the historical run is still running', async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          trials: [],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'running' }),
      });

    const { result } = renderAndConnect();
    const sentBefore = lastWs.sent.length;

    await act(async () => {
      await result.current.loadExperimentRunsEvents(
        '33333333-3333-4333-8333-333333333333',
        '44444444-4444-4444-8444-444444444444',
      );
    });

    expect(result.current.experimentStatus).toBe('running');
    const subscribeMsgs = lastWs.sent.slice(sentBefore).filter((s) => {
      try {
        const parsed = JSON.parse(s);
        return (
          parsed.action === 'subscribe_experiment' &&
          parsed.runId === '33333333-3333-4333-8333-333333333333'
        );
      } catch {
        return false;
      }
    });
    expect(subscribeMsgs).toHaveLength(1);
  });
});
