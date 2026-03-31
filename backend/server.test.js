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
  startAgent: vi.fn(() => 'mock-session-id'),
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

const mockEvent = {
  id: 1,
  session_id: 'valid-id',
  type: 'assistant',
  content: { text: 'hello' },
  timestamp: 1704067200000,
};

vi.mock('./sessionStore.js', () => ({
  listSessionsPaged: vi.fn((limit, offset) => {
    if (limit && offset >= 0) return [mockSession];
    return [];
  }),
  countSessions: vi.fn(() => 1),
  getSession: vi.fn((id) => (id === 'valid-id' ? { ...mockSession } : undefined)),
  getEvents: vi.fn((id) => (id === 'valid-id' ? [{ ...mockEvent }] : [])),
  countEvents: vi.fn((id) => (id === 'valid-id' ? 1 : 0)),
  recoverStaleSessions: vi.fn(() => 0),
  close: vi.fn(),
}));

vi.mock('./mcpHealth.js', () => ({
  getMcpHealth: vi.fn(() => ({
    filesystem: { state: 'connected', toolCalls: 5, toolErrors: 0 },
  })),
  initMcpHealth: vi.fn(),
  recordToolCall: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Import app and server after mocks are in place
// ---------------------------------------------------------------------------

const { app, server } = await import('./server.js');

// supertest does NOT need the server to be listening; it connects to the app
// directly. But server.listen() was called at module load. We close it in
// afterAll to release the port.

const { default: request } = await import('supertest');

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
    expect(res.body.error).toBe('session not active');
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
