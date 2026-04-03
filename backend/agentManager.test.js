/**
 * Tests for agentManager: tool selection, lifecycle, stream consumption hooks.
 * Claude SDK and filesystem are mocked; session store is mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  mockQuery,
  mockCreateSession,
  mockInsertEvent,
  mockUpdateSessionStatus,
  mockUpdateSessionStats,
  mockGetSession,
  mockUpdatePinnedContext,
  mockRouteTools,
  mockBuildHooks,
  mockCleanupSessionLoopState,
  mockInitMcpHealth,
  mockBuildAgentEnv,
  mockGetSdkExecutablePath,
} = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockCreateSession: vi.fn(),
  mockInsertEvent: vi.fn().mockResolvedValue(undefined),
  mockUpdateSessionStatus: vi.fn().mockResolvedValue(undefined),
  mockUpdateSessionStats: vi.fn().mockResolvedValue(undefined),
  mockGetSession: vi.fn(),
  mockUpdatePinnedContext: vi.fn().mockResolvedValue(undefined),
  mockRouteTools: vi.fn(() => ({
    uniqueAllowedTools: ['Read'],
    selectedMcpServers: {},
  })),
  mockBuildHooks: vi.fn(() => []),
  mockCleanupSessionLoopState: vi.fn(),
  mockInitMcpHealth: vi.fn(),
  mockBuildAgentEnv: vi.fn(() => ({})),
  mockGetSdkExecutablePath: vi.fn(() => '/usr/bin/node'),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (...args) => mockQuery(...args),
}));

vi.mock('./config.js', () => ({
  default: {
    workspaceDir: '/tmp/agentboard-am-ws',
    pluginsDir: '/tmp/agentboard-am-plugins',
    llm: { model: 'test-model', apiKey: 'key', baseUrl: 'http://api', effort: undefined },
    proxy: { url: 'http://proxy', token: '' },
    agentTimeout: 30_000,
    github: { token: '' },
  },
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
  },
}));

vi.mock('./sessionStore.js', () => ({
  createSession: (...a) => mockCreateSession(...a),
  insertEvent: (...a) => mockInsertEvent(...a),
  updateSessionStatus: (...a) => mockUpdateSessionStatus(...a),
  updateSessionStats: (...a) => mockUpdateSessionStats(...a),
  getSession: (...a) => mockGetSession(...a),
  updatePinnedContext: (...a) => mockUpdatePinnedContext(...a),
}));

vi.mock('./router.js', () => ({
  routeTools: (...a) => mockRouteTools(...a),
}));

vi.mock('./agentDefs.js', () => ({
  getAgentDefs: vi.fn(() => ({})),
}));

vi.mock('./hooks.js', () => ({
  buildHooks: (...a) => mockBuildHooks(...a),
  cleanupSessionLoopState: (...a) => mockCleanupSessionLoopState(...a),
}));

vi.mock('./mcpHealth.js', () => ({
  initMcpHealth: (...a) => mockInitMcpHealth(...a),
}));

vi.mock('./sdkRuntime.js', () => ({
  buildAgentEnv: (...a) => mockBuildAgentEnv(...a),
  getSdkExecutablePath: (...a) => mockGetSdkExecutablePath(...a),
}));

const agentManager = await import('./agentManager.js');
const {
  selectBuiltinTools,
  PERMISSION_MODES,
  startAgent,
  continueAgent,
  stopAgent,
  getActiveAgents,
  getAgentStream,
  agentEvents,
} = agentManager;

function waitForSessionDone(sessionId) {
  return new Promise((resolve) => {
    const onEvent = (e) => {
      if (e.sessionId === sessionId && e.type === 'done') {
        agentEvents.off('event', onEvent);
        resolve(e);
      }
    };
    agentEvents.on('event', onEvent);
  });
}

/**
 * SDK stream that stays open until stopAgent aborts. A plain `new Promise(() => {})`
 * never releases, so consumeStream never reaches `done` and waitForSessionDone hangs.
 */
function mockQueryUntilAbort(mockFn) {
  mockFn.mockImplementation((req) => {
    const signal = req?.options?.abortController?.signal;
    return (async function* () {
      yield await new Promise((_, reject) => {
        if (!signal) {
          reject(new Error('test: missing abortController.signal'));
          return;
        }
        if (signal.aborted) {
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          return;
        }
        signal.addEventListener(
          'abort',
          () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          { once: true },
        );
      });
    })();
  });
}

beforeEach(() => {
  // Do not use vi.clearAllMocks(): it resets mock implementations in Vitest 4
  // and can leave createSession/query mocks not returning resolved promises.
  mockInsertEvent.mockClear();
  mockUpdateSessionStatus.mockClear();
  mockUpdateSessionStats.mockClear();
  mockUpdatePinnedContext.mockClear();
  mockRouteTools.mockClear();
  mockBuildHooks.mockClear();
  mockCleanupSessionLoopState.mockClear();
  mockInitMcpHealth.mockClear();
  mockQuery.mockClear();
  mockCreateSession.mockReset();
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ pinned_context: null });
  mockRouteTools.mockReturnValue({
    uniqueAllowedTools: ['Read'],
    selectedMcpServers: {},
  });
});

afterEach(async () => {
  // Drain any stray active agents from failed tests
  for (const id of getActiveAgents()) {
    stopAgent(id);
  }
  await Promise.resolve();
});

describe('PERMISSION_MODES', () => {
  it('lists the four frontend modes', () => {
    expect(PERMISSION_MODES).toEqual(['bypassPermissions', 'default', 'acceptEdits', 'plan']);
  });
});

describe('selectBuiltinTools', () => {
  it('always includes core tools', () => {
    const tools = selectBuiltinTools('hello');
    for (const t of [
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Grep',
      'Glob',
      'WebSearch',
      'WebFetch',
      'Task',
      'AgentTool',
      'TodoWrite',
    ]) {
      expect(tools).toContain(t);
    }
  });

  it('adds notebook tools when prompt mentions jupyter', () => {
    const tools = selectBuiltinTools('open my jupyter notebook');
    expect(tools).toContain('NotebookEdit');
  });

  it('adds cron tools when prompt mentions schedule', () => {
    const tools = selectBuiltinTools('add a cron schedule');
    expect(tools).toContain('CronCreate');
    expect(tools).toContain('CronList');
  });

  it('deduplicates when multiple keyword groups match overlapping tool sets', () => {
    const tools = selectBuiltinTools('skill and task');
    const skillCount = tools.filter((t) => t === 'Skill').length;
    expect(skillCount).toBe(1);
  });
});

describe('startAgent', () => {
  it('returns session id and completes with completed status for empty stream', async () => {
    mockCreateSession.mockResolvedValue('sess-done');
    mockQuery.mockReturnValue((async function* () {})());

    const sid = await startAgent('run task', { userId: 'u1' });
    expect(sid).toBe('sess-done');
    const done = await waitForSessionDone('sess-done');
    expect(done.content.status).toBe('completed');
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith('sess-done', 'completed', 'u1');
    expect(mockCleanupSessionLoopState).toHaveBeenCalledWith('sess-done');
  });

  it('calls routeTools with prompt and workspace', async () => {
    mockCreateSession.mockResolvedValue('sess-rt');
    mockQuery.mockReturnValue((async function* () {})());

    await startAgent('use playwright browser', { userId: 'tenant-x' });
    await waitForSessionDone('sess-rt');

    expect(mockRouteTools).toHaveBeenCalled();
    const [promptArg, workspaceArg] = mockRouteTools.mock.calls[0];
    expect(promptArg).toBe('use playwright browser');
    expect(typeof workspaceArg).toBe('string');
  });

  it('persists result stats when stream yields result message', async () => {
    mockCreateSession.mockResolvedValue('sess-st');
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          total_cost_usd: 0.01,
          usage: { input_tokens: 10, output_tokens: 20 },
          duration_ms: 100,
          num_turns: 3,
        };
      })(),
    );

    await startAgent('x', { userId: 'u1' });
    await waitForSessionDone('sess-st');

    expect(mockUpdateSessionStats).toHaveBeenCalledWith(
      'sess-st',
      expect.objectContaining({
        cost_usd: 0.01,
        input_tokens: 10,
        output_tokens: 20,
        model: 'test-model',
      }),
      'u1',
    );
  });

  it('throws and marks session failed when query() throws', async () => {
    mockCreateSession.mockResolvedValue('sess-fail');
    mockQuery.mockImplementation(() => {
      throw new Error('sdk init failed');
    });

    await expect(startAgent('x', { userId: 'u1' })).rejects.toThrow('sdk init failed');
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith('sess-fail', 'failed', 'u1');
    expect(mockCleanupSessionLoopState).toHaveBeenCalledWith('sess-fail');
  });

  it('updates pinned context from assistant pin_context tags', async () => {
    mockCreateSession.mockResolvedValue('sess-pin');
    mockGetSession.mockResolvedValue({ pinned_context: [] });
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'message',
          role: 'assistant',
          content: [
            {
              type: 'text',
              text: 'Note <pin_context>\nfirst memory\n</pin_context> done.',
            },
          ],
        };
      })(),
    );

    await startAgent('x', { userId: 'u1' });
    await waitForSessionDone('sess-pin');

    expect(mockUpdatePinnedContext).toHaveBeenCalledWith('sess-pin', ['first memory'], 'u1');
  });
});

describe('continueAgent', () => {
  it('returns false when session is already active', async () => {
    mockCreateSession.mockResolvedValue('sess-busy');
    mockQueryUntilAbort(mockQuery);

    const sid = await startAgent('first', { userId: 'u1' });
    await vi.waitFor(() => expect(getActiveAgents('u1')).toContain('sess-busy'));
    const followOk = await continueAgent(sid, 'second', { userId: 'u1' });
    expect(followOk).toBe(false);
    stopAgent(sid);
    await waitForSessionDone(sid);
  });

  it('returns true and passes resume option to query', async () => {
    mockCreateSession.mockResolvedValue('sess-new');
    mockQuery.mockReturnValue((async function* () {})());
    const sid = await startAgent('a', { userId: 'u1' });
    await waitForSessionDone(sid);

    mockQuery.mockClear();
    mockQuery.mockReturnValue((async function* () {})());

    const ok = await continueAgent(sid, 'b', { userId: 'u1' });
    expect(ok).toBe(true);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ resume: sid }),
      }),
    );
    await waitForSessionDone(sid);
  });

  it('returns false when query throws on continue', async () => {
    mockCreateSession.mockResolvedValue('sess-new2');
    mockQuery.mockReturnValue((async function* () {})());
    const sid = await startAgent('a', { userId: 'u1' });
    await waitForSessionDone(sid);

    mockQuery.mockImplementation(() => {
      throw new Error('resume failed');
    });
    const ok = await continueAgent(sid, 'b', { userId: 'u1' });
    expect(ok).toBe(false);
    expect(mockUpdateSessionStatus).toHaveBeenCalledWith(sid, 'failed', 'u1');
  });
});

describe('stopAgent and getters', () => {
  it('stopAgent returns false for unknown session', () => {
    expect(stopAgent('no-such')).toBe(false);
  });

  it('stopAgent returns true and clears stream for active session', async () => {
    mockCreateSession.mockResolvedValue('sess-stop');
    mockQueryUntilAbort(mockQuery);

    const sid = await startAgent('u1 task', { userId: 'user-one' });
    expect(sid).toBe('sess-stop');
    await vi.waitFor(() => expect(getActiveAgents('user-one').length).toBe(1));
    expect(getAgentStream('sess-stop')).toBeTruthy();
    expect(stopAgent('sess-stop')).toBe(true);
    const done = await waitForSessionDone('sess-stop');
    expect(done.content.status).toBe('stopped');
  });

  it('getActiveAgents filters by userId', async () => {
    mockCreateSession.mockResolvedValueOnce('s-a').mockResolvedValueOnce('s-b');
    mockQueryUntilAbort(mockQuery);

    await startAgent('u1 task', { userId: 'user-one' });
    await vi.waitFor(() => expect(getActiveAgents('user-one').length).toBe(1));

    mockQueryUntilAbort(mockQuery);
    await startAgent('u2 task', { userId: 'user-two' });
    await vi.waitFor(() => expect(getActiveAgents('user-two').length).toBe(1));

    expect(getActiveAgents('user-one')).toContain('s-a');
    expect(getActiveAgents('user-two')).toContain('s-b');
    expect(getActiveAgents('user-one')).not.toContain('s-b');

    stopAgent('s-a');
    stopAgent('s-b');
  });

  it('getActiveAgents without userId returns all session ids', async () => {
    mockCreateSession.mockResolvedValue('s-all');
    mockQueryUntilAbort(mockQuery);
    await startAgent('t', { userId: 'u99' });
    await vi.waitFor(() => expect(getActiveAgents().length).toBeGreaterThan(0));
    expect(getActiveAgents()).toContain('s-all');
    stopAgent('s-all');
  });
});
