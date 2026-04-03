/**
 * Integration tests for Express REST API routes.
 *
 * All external dependencies (agentManager, sessionStore, mcpHealth) are mocked
 * so that tests exercise route logic in isolation. The server binds to a random
 * port (port: 0) to avoid conflicts with a running dev server.
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Mocks -- must be declared before any import of server.js
// ---------------------------------------------------------------------------

vi.mock('./config.js', () => ({
  default: {
    port: 0,
    workspaceDir: '/tmp/agentboard-test',
    pluginsDir: '/tmp/agentboard-test-plugins',
    dbPath: ':memory:',
    agentTimeout: 60000,
    proxy: { url: 'http://localhost:4000' },
    llm: { model: 'test-model', apiKey: '', baseUrl: '' },
    github: { token: '' },
  },
}));

const mockEmitter = new EventEmitter();

vi.mock('./agentManager.js', () => ({
  startAgent: vi.fn().mockResolvedValue('mock-session-id'),
  stopAgent: vi.fn((id) => id === 'active-id'),
  getActiveAgents: vi.fn(() => ['session-1', 'session-2']),
  getAgentStream: vi.fn((id) => {
    if (id === 'active-id') {
      return {
        getContextUsage: vi.fn(async () => ({ input: 100, output: 50 })),
        setModel: vi.fn(async () => {}),
        rewindFiles: vi.fn(async () => ({ rewound: true })),
      };
    }
    return null;
  }),
  agentEvents: mockEmitter,
  PERMISSION_MODES: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
}));

const mockSession = {
  id: 'valid-id',
  prompt: 'test prompt',
  status: 'completed',
  stats: null,
  created_at: '2024-01-01 00:00:00',
};

const sessionOwners = new Map([
  ['default', new Set(['valid-id', 'active-id'])],
  ['tenant-a', new Set(['tenant-a-session'])],
]);

const mockEvent = {
  id: 1,
  session_id: 'valid-id',
  type: 'assistant',
  content: { text: 'hello' },
  timestamp: 1704067200000,
};

vi.mock('./sessionStore.js', () => ({
  listSessionsPaged: vi.fn((_userId, limit, offset) => {
    if (limit && offset >= 0) return Promise.resolve([mockSession]);
    return Promise.resolve([]);
  }),
  countSessions: vi.fn().mockResolvedValue(1),
  getSession: vi.fn((userId, id) => {
    const ownedSessions = sessionOwners.get(userId || 'default');
    if (!ownedSessions?.has(id)) return Promise.resolve(undefined);
    return Promise.resolve({ ...mockSession, id, user_id: userId || 'default' });
  }),
  getEvents: vi.fn((sessionId) =>
    Promise.resolve(sessionId === 'valid-id' ? [{ ...mockEvent }] : []),
  ),
  countEvents: vi.fn((sessionId) => Promise.resolve(sessionId === 'valid-id' ? 1 : 0)),
  recoverStaleSessions: vi.fn().mockResolvedValue(0),
  deleteSession: vi.fn(async (userId, id) => {
    const ownedSessions = sessionOwners.get(userId || 'default');
    return Boolean(ownedSessions?.has(id));
  }),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./mcpHealth.js', () => ({
  getMcpHealth: vi.fn(() => ({
    filesystem: { state: 'connected', toolCalls: 5, toolErrors: 0 },
  })),
  initMcpHealth: vi.fn(),
  recordToolCall: vi.fn(),
}));

vi.mock('./memoryStore.js', () => ({
  closeMemoryDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./workflowStore.js', () => ({
  createWorkflow: vi.fn().mockResolvedValue(undefined),
  createWorkflowRun: vi.fn().mockResolvedValue(undefined),
  updateWorkflow: vi.fn().mockResolvedValue(undefined),
  getWorkflow: vi.fn().mockResolvedValue(null),
  listWorkflows: vi.fn().mockResolvedValue([]),
  countWorkflows: vi.fn().mockResolvedValue(0),
  deleteWorkflow: vi.fn().mockResolvedValue(true),
  getWorkflowRun: vi.fn().mockResolvedValue(null),
  listWorkflowRuns: vi.fn().mockResolvedValue([]),
  closeWorkflowDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./workflowEngine.js', () => ({
  validateWorkflow: vi.fn(() => ({ valid: true, errors: [] })),
  executeWorkflow: vi.fn().mockResolvedValue(undefined),
  abortWorkflow: vi.fn(() => true),
  getActiveWorkflowRuns: vi.fn(() => []),
  workflowEvents: new EventEmitter(),
}));

vi.mock('./experimentStore.js', () => ({
  createExperiment: vi.fn().mockResolvedValue(undefined),
  getExperiment: vi.fn().mockResolvedValue(null),
  listExperiments: vi.fn().mockResolvedValue([]),
  countExperiments: vi.fn().mockResolvedValue(0),
  updateExperiment: vi.fn().mockResolvedValue(true),
  deleteExperiment: vi.fn().mockResolvedValue(true),
  createRun: vi.fn().mockResolvedValue('mock-run-id'),
  listRuns: vi.fn().mockResolvedValue([]),
  listTrials: vi.fn().mockResolvedValue([]),
  getRunOwned: vi.fn().mockResolvedValue(null),
  recoverStaleRuns: vi.fn().mockResolvedValue(0),
  closeExperimentDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./experimentEngine.js', () => ({
  runExperimentLoop: vi.fn().mockResolvedValue(undefined),
  abortExperiment: vi.fn(() => true),
  getActiveExperiments: vi.fn(() => []),
  validatePlan: vi.fn(() => ({ valid: true, errors: [] })),
  prepareWorkspace: vi.fn().mockResolvedValue(undefined),
  experimentEvents: new EventEmitter(),
}));

// P3: Mock swarm modules to prevent DB table creation in test environment
vi.mock('./researchSwarm.js', () => ({
  runResearchSwarm: vi.fn().mockResolvedValue(undefined),
  abortSwarm: vi.fn(() => false),
  isSwarmActive: vi.fn(() => false),
  swarmEvents: new EventEmitter(),
  initSwarmBus: vi.fn(),
}));

vi.mock('./swarmStore.js', () => ({
  listSwarmBranches: vi.fn().mockResolvedValue([]),
  listCoordinatorDecisions: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Import app and server after mocks are in place
// ---------------------------------------------------------------------------

const { app, server } = await import('./server.js');

// supertest does NOT need the server to be listening; it connects to the app
// directly. But server.listen() was called at module load. We close it in
// afterAll to release the port.

const { default: request } = await import('supertest');
const { WebSocket: WSClient } = await import('ws');

afterAll(() => {
  server.close();
});

// ---------------------------------------------------------------------------
// GET /api/sessions
// ---------------------------------------------------------------------------

describe('GET /api/sessions', () => {
  it('returns paginated session list with defaults', async () => {
    const res = await request(app).get('/api/sessions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('sessions');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('limit');
    expect(res.body).toHaveProperty('offset');
    expect(Array.isArray(res.body.sessions)).toBe(true);
  });

  it('accepts valid limit and offset query params', async () => {
    const res = await request(app).get('/api/sessions?limit=5&offset=0');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(0);
  });

  it('rejects invalid limit (string)', async () => {
    const res = await request(app).get('/api/sessions?limit=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation failed');
  });

  it('rejects limit exceeding maximum (101)', async () => {
    const res = await request(app).get('/api/sessions?limit=101');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation failed');
  });

  it('rejects negative offset', async () => {
    const res = await request(app).get('/api/sessions?offset=-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation failed');
  });
});

// ---------------------------------------------------------------------------
// GET /api/sessions/:id
// ---------------------------------------------------------------------------

describe('GET /api/sessions/:id', () => {
  it('returns session with events when found', async () => {
    const res = await request(app).get('/api/sessions/valid-id');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('valid-id');
    expect(res.body.prompt).toBe('test prompt');
    expect(res.body.events).toBeDefined();
    expect(Array.isArray(res.body.events)).toBe(true);
    expect(res.body.eventCount).toBe(1);
  });

  it('returns 404 when session not found', async () => {
    const res = await request(app).get('/api/sessions/nonexistent-id');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session not found');
  });
});

// ---------------------------------------------------------------------------
// POST /api/sessions/:id/stop
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/stop', () => {
  it('returns stopped: true for an active session', async () => {
    const res = await request(app).post('/api/sessions/active-id/stop');
    expect(res.status).toBe(200);
    expect(res.body.stopped).toBe(true);
  });

  it('returns 404 when the session is not owned by the current user', async () => {
    const res = await request(app)
      .post('/api/sessions/active-id/stop')
      .set('x-user-id', 'tenant-a');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session not found');
  });

  it('returns 404 when session is not active', async () => {
    const res = await request(app).post('/api/sessions/unknown-id/stop');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('not found');
  });
});

// ---------------------------------------------------------------------------
// GET /api/status
// ---------------------------------------------------------------------------

describe('GET /api/status', () => {
  it('returns activeAgents and uptime', async () => {
    const res = await request(app).get('/api/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('activeAgents');
    expect(Array.isArray(res.body.activeAgents)).toBe(true);
    expect(res.body.activeAgents).toEqual(['session-1', 'session-2']);
    expect(res.body).toHaveProperty('uptime');
    expect(typeof res.body.uptime).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// GET /api/mcp/health
// ---------------------------------------------------------------------------

describe('GET /api/mcp/health', () => {
  it('returns health data from mcpHealth module', async () => {
    const res = await request(app).get('/api/mcp/health');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('filesystem');
    expect(res.body.filesystem.state).toBe('connected');
  });
});

// ---------------------------------------------------------------------------
// GET /api/config/permissions
// ---------------------------------------------------------------------------

describe('GET /api/config/permissions', () => {
  it('returns permission modes array', async () => {
    const res = await request(app).get('/api/config/permissions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('modes');
    expect(res.body.modes).toEqual(['bypassPermissions', 'default', 'acceptEdits', 'plan']);
  });
});

// ---------------------------------------------------------------------------
// POST /api/sessions/:id/control
// ---------------------------------------------------------------------------

describe('POST /api/sessions/:id/control', () => {
  it('validates action field -- rejects invalid action', async () => {
    const res = await request(app).post('/api/sessions/active-id/control').send({ action: 'nuke' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation failed');
  });

  it('validates action field -- rejects missing body', async () => {
    const res = await request(app).post('/api/sessions/active-id/control').send({});
    expect(res.status).toBe(400);
  });

  it('returns 404 when session not active (no stream)', async () => {
    const res = await request(app)
      .post('/api/sessions/nonexistent-id/control')
      .send({ action: 'get_context_usage' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session not found');
  });

  it('returns 404 when the session is not owned by the current user', async () => {
    const res = await request(app)
      .post('/api/sessions/active-id/control')
      .set('x-user-id', 'tenant-a')
      .send({ action: 'get_context_usage' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('session not found');
  });

  it('executes get_context_usage on active session', async () => {
    const res = await request(app)
      .post('/api/sessions/active-id/control')
      .send({ action: 'get_context_usage' });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('get_context_usage');
    expect(res.body.result).toEqual({ input: 100, output: 50 });
  });

  it('executes set_model with model param', async () => {
    const res = await request(app)
      .post('/api/sessions/active-id/control')
      .send({ action: 'set_model', model: 'claude-3-opus' });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('set_model');
    expect(res.body.result.model).toBe('claude-3-opus');
  });

  it('rejects set_model without model param', async () => {
    const res = await request(app)
      .post('/api/sessions/active-id/control')
      .send({ action: 'set_model' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('model is required');
  });

  it('executes rewind_files', async () => {
    const res = await request(app)
      .post('/api/sessions/active-id/control')
      .send({ action: 'rewind_files', messageId: 'msg-42' });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('rewind_files');
    expect(res.body.result).toEqual({ rewound: true });
  });

  it('executes mcp_status and returns health data', async () => {
    const res = await request(app)
      .post('/api/sessions/active-id/control')
      .send({ action: 'mcp_status' });
    expect(res.status).toBe(200);
    expect(res.body.action).toBe('mcp_status');
    expect(res.body.result).toHaveProperty('filesystem');
  });
});

// ---------------------------------------------------------------------------
// Unknown route
// ---------------------------------------------------------------------------

describe('unknown routes', () => {
  it('returns 404 for unregistered GET path', async () => {
    const res = await request(app).get('/api/nonexistent');
    // Express 5 returns 404 by default for unmatched routes
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Batch delete limits (H3 fix)
// ---------------------------------------------------------------------------

describe('batch delete limits', () => {
  it('rejects session batch-delete with more than 100 ids', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const res = await request(app).post('/api/sessions/batch-delete').send({ ids });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/max 100/);
  });

  it('rejects workflow batch-delete with more than 100 ids', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `id-${i}`);
    const res = await request(app).post('/api/workflows/batch-delete').send({ ids });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/max 100/);
  });
});

describe('session delete and batch-delete', () => {
  it('rejects session batch-delete when ids is missing or empty', async () => {
    expect((await request(app).post('/api/sessions/batch-delete').send({})).status).toBe(400);
    expect((await request(app).post('/api/sessions/batch-delete').send({ ids: [] })).status).toBe(
      400,
    );
  });

  it('batch-deletes owned sessions and stops agents', async () => {
    const { stopAgent: stopAgentFn } = await import('./agentManager.js');
    const { deleteSession: delFn } = await import('./sessionStore.js');
    const res = await request(app)
      .post('/api/sessions/batch-delete')
      .send({ ids: ['valid-id', 'ghost-id'] });
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(1);
    expect(stopAgentFn).toHaveBeenCalledWith('valid-id');
    expect(delFn).toHaveBeenCalledWith('default', 'valid-id');
  });

  it('DELETE /api/sessions/:id removes an owned session', async () => {
    const { stopAgent: stopAgentFn } = await import('./agentManager.js');
    const { deleteSession: delFn } = await import('./sessionStore.js');
    const res = await request(app).delete('/api/sessions/valid-id');
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(stopAgentFn).toHaveBeenCalledWith('valid-id');
    expect(delFn).toHaveBeenCalledWith('default', 'valid-id');
  });

  it('DELETE /api/sessions/:id returns 404 when not owned', async () => {
    const res = await request(app).delete('/api/sessions/unknown-id');
    expect(res.status).toBe(404);
  });
});

describe('WebSocket heartbeat handling', () => {
  it('accepts raw ping heartbeats and replies with pong', async () => {
    const port = server.address().port;
    const ws = new WSClient(`ws://127.0.0.1:${port}/ws`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const message = await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('pong timeout')), 1000);
      ws.once('message', (data) => {
        clearTimeout(timeoutId);
        resolve(JSON.parse(data.toString()));
      });
      ws.once('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
      ws.send('ping');
    });

    expect(message).toEqual({ type: 'pong' });
    ws.close();
  });
});
