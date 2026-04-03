/**
 * Tests for auth middleware and Zod validation schemas.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Zod schemas and validation middleware (no module-load-time env dependency)
// ---------------------------------------------------------------------------

import {
  wsMessageSchema,
  controlActionSchema,
  sessionsQuerySchema,
  workflowSchema,
  workflowRunRequestSchema,
  normalizeUserId,
  requestIdMiddleware,
  validate,
  validateQuery,
} from './middleware.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockRes() {
  const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}

// ---------------------------------------------------------------------------
// authMiddleware -- API_KEY captured at module load; must reset modules
// ---------------------------------------------------------------------------

describe('authMiddleware - no key configured', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AGENTBOARD_API_KEY;
  });

  it('calls next() when AGENTBOARD_API_KEY is unset', async () => {
    const { authMiddleware } = await import('./middleware.js');
    const next = vi.fn();
    const req = { headers: {} };
    authMiddleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user.id).toBe('default');
  });

  it('calls next() when AGENTBOARD_API_KEY is empty string', async () => {
    process.env.AGENTBOARD_API_KEY = '';
    vi.resetModules();
    const { authMiddleware } = await import('./middleware.js');
    const next = vi.fn();
    const req = { headers: {} };
    authMiddleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user.id).toBe('default');
  });

  it('normalizes x-user-id when provided', async () => {
    const { authMiddleware } = await import('./middleware.js');
    const next = vi.fn();
    const req = { headers: { 'x-user-id': 'tenant-42' } };
    authMiddleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.user.id).toBe('tenant-42');
  });
});

describe('authMiddleware - with key configured', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AGENTBOARD_API_KEY = 'test-secret';
  });

  it('calls next() with correct bearer token', async () => {
    const { authMiddleware } = await import('./middleware.js');
    const next = vi.fn();
    const req = { headers: { authorization: 'Bearer test-secret' } };
    authMiddleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 with wrong bearer token', async () => {
    const { authMiddleware } = await import('./middleware.js');
    const next = vi.fn();
    const res = mockRes();
    const req = { headers: { authorization: 'Bearer wrong-token' } };
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'unauthorized' });
  });

  it('returns 401 when authorization header is missing', async () => {
    const { authMiddleware } = await import('./middleware.js');
    const next = vi.fn();
    const res = mockRes();
    authMiddleware({ headers: {} }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when header does not start with "Bearer "', async () => {
    const { authMiddleware } = await import('./middleware.js');
    const next = vi.fn();
    const res = mockRes();
    const req = { headers: { authorization: 'Basic test-secret' } };
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 401 when token is empty after "Bearer "', async () => {
    const { authMiddleware } = await import('./middleware.js');
    const next = vi.fn();
    const res = mockRes();
    const req = { headers: { authorization: 'Bearer ' } };
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('returns 400 when x-user-id format is invalid', async () => {
    const { authMiddleware } = await import('./middleware.js');
    const next = vi.fn();
    const res = mockRes();
    const req = {
      headers: {
        authorization: 'Bearer test-secret',
        'x-user-id': '../escape',
      },
    };
    authMiddleware(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'invalid x-user-id' });
  });
});

// ---------------------------------------------------------------------------
// wsAuth
// ---------------------------------------------------------------------------

describe('wsAuth - no key configured', () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.AGENTBOARD_API_KEY;
  });

  it('returns true for allowed localhost origin when no API key is set', async () => {
    const { wsAuth } = await import('./middleware.js');
    const req = {
      url: '/ws?user_id=tenant-1',
      headers: { host: 'localhost:3001', origin: 'http://localhost:5173' },
    };
    expect(wsAuth(req)).toBe(true);
    expect(req.userId).toBe('tenant-1');
  });

  it('returns false when origin header is missing', async () => {
    const { wsAuth } = await import('./middleware.js');
    const req = { url: '/ws', headers: { host: 'localhost:3001' } };
    expect(wsAuth(req)).toBe(false);
  });

  it('returns false for disallowed origin', async () => {
    const { wsAuth } = await import('./middleware.js');
    const req = {
      url: '/ws',
      headers: { host: 'localhost:3001', origin: 'https://evil.example' },
    };
    expect(wsAuth(req)).toBe(false);
  });
});

describe('wsAuth - with key configured', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.AGENTBOARD_API_KEY = 'ws-secret';
  });

  it('returns true with correct token in query param', async () => {
    const { wsAuth } = await import('./middleware.js');
    const req = {
      url: '/ws?token=ws-secret&user_id=tenant-2',
      headers: { host: 'localhost:3001', origin: 'http://localhost:5173' },
    };
    expect(wsAuth(req)).toBe(true);
    expect(req.userId).toBe('tenant-2');
  });

  it('returns false with wrong token', async () => {
    const { wsAuth } = await import('./middleware.js');
    const req = {
      url: '/ws?token=bad',
      headers: { host: 'localhost:3001', origin: 'http://localhost:5173' },
    };
    expect(wsAuth(req)).toBe(false);
  });

  it('returns false when token param is missing', async () => {
    const { wsAuth } = await import('./middleware.js');
    const req = {
      url: '/ws',
      headers: { host: 'localhost:3001', origin: 'http://localhost:5173' },
    };
    expect(wsAuth(req)).toBe(false);
  });

  it('returns false for disallowed origin even with a valid token', async () => {
    const { wsAuth } = await import('./middleware.js');
    const req = {
      url: '/ws?token=ws-secret',
      headers: { host: 'localhost:3001', origin: 'https://evil.example' },
    };
    expect(wsAuth(req)).toBe(false);
  });

  it('returns false for invalid user_id in query string', async () => {
    const { wsAuth } = await import('./middleware.js');
    const req = {
      url: '/ws?token=ws-secret&user_id=../../bad',
      headers: { host: 'localhost:3001', origin: 'http://localhost:5173' },
    };
    expect(wsAuth(req)).toBe(false);
  });
});

describe('normalizeUserId', () => {
  it('accepts simple tenant IDs', () => {
    expect(normalizeUserId('tenant-1')).toBe('tenant-1');
    expect(normalizeUserId('user.alpha:01')).toBe('user.alpha:01');
  });

  it('rejects invalid values', () => {
    expect(normalizeUserId('')).toBeNull();
    expect(normalizeUserId('  ')).toBeNull();
    expect(normalizeUserId('../bad')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// wsMessageSchema
// ---------------------------------------------------------------------------

describe('wsMessageSchema', () => {
  describe('start action', () => {
    it('accepts valid start with prompt', () => {
      const result = wsMessageSchema.safeParse({ action: 'start', prompt: 'hello' });
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ action: 'start', prompt: 'hello' });
    });

    it('accepts start with optional permissionMode and maxTurns', () => {
      const msg = { action: 'start', prompt: 'do it', permissionMode: 'plan', maxTurns: 10 };
      const result = wsMessageSchema.safeParse(msg);
      expect(result.success).toBe(true);
      expect(result.data.permissionMode).toBe('plan');
      expect(result.data.maxTurns).toBe(10);
    });

    it('rejects start without prompt', () => {
      const result = wsMessageSchema.safeParse({ action: 'start' });
      expect(result.success).toBe(false);
    });

    it('rejects start with empty prompt', () => {
      const result = wsMessageSchema.safeParse({ action: 'start', prompt: '' });
      expect(result.success).toBe(false);
    });

    it('rejects start with prompt exceeding 50000 chars', () => {
      const result = wsMessageSchema.safeParse({ action: 'start', prompt: 'x'.repeat(50001) });
      expect(result.success).toBe(false);
    });

    it('accepts prompt at exactly 50000 chars', () => {
      const result = wsMessageSchema.safeParse({ action: 'start', prompt: 'x'.repeat(50000) });
      expect(result.success).toBe(true);
    });
  });

  describe('maxTurns bounds', () => {
    it('rejects maxTurns = 0', () => {
      const result = wsMessageSchema.safeParse({ action: 'start', prompt: 'hi', maxTurns: 0 });
      expect(result.success).toBe(false);
    });

    it('rejects maxTurns = 201', () => {
      const result = wsMessageSchema.safeParse({ action: 'start', prompt: 'hi', maxTurns: 201 });
      expect(result.success).toBe(false);
    });

    it('accepts maxTurns = 1', () => {
      const result = wsMessageSchema.safeParse({ action: 'start', prompt: 'hi', maxTurns: 1 });
      expect(result.success).toBe(true);
      expect(result.data.maxTurns).toBe(1);
    });

    it('accepts maxTurns = 200', () => {
      const result = wsMessageSchema.safeParse({ action: 'start', prompt: 'hi', maxTurns: 200 });
      expect(result.success).toBe(true);
      expect(result.data.maxTurns).toBe(200);
    });

    it('rejects non-integer maxTurns', () => {
      const result = wsMessageSchema.safeParse({ action: 'start', prompt: 'hi', maxTurns: 5.5 });
      expect(result.success).toBe(false);
    });
  });

  describe('subscribe action', () => {
    it('accepts valid subscribe with UUID sessionId', () => {
      const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
      const result = wsMessageSchema.safeParse({ action: 'subscribe', sessionId: id });
      expect(result.success).toBe(true);
      expect(result.data.sessionId).toBe(id);
    });

    it('rejects subscribe without sessionId', () => {
      const result = wsMessageSchema.safeParse({ action: 'subscribe' });
      expect(result.success).toBe(false);
    });

    it('rejects subscribe with non-UUID sessionId', () => {
      const result = wsMessageSchema.safeParse({ action: 'subscribe', sessionId: 'not-a-uuid' });
      expect(result.success).toBe(false);
    });
  });

  describe('stop action', () => {
    it('accepts stop without sessionId', () => {
      const result = wsMessageSchema.safeParse({ action: 'stop' });
      expect(result.success).toBe(true);
    });

    it('accepts stop with valid UUID sessionId', () => {
      const id = '550e8400-e29b-41d4-a716-446655440000';
      const result = wsMessageSchema.safeParse({ action: 'stop', sessionId: id });
      expect(result.success).toBe(true);
      expect(result.data.sessionId).toBe(id);
    });

    it('rejects stop with invalid sessionId format', () => {
      const result = wsMessageSchema.safeParse({ action: 'stop', sessionId: 'bad' });
      expect(result.success).toBe(false);
    });
  });

  describe('unsubscribe action', () => {
    it('accepts valid unsubscribe', () => {
      const result = wsMessageSchema.safeParse({ action: 'unsubscribe' });
      expect(result.success).toBe(true);
      expect(result.data.action).toBe('unsubscribe');
    });
  });

  describe('workflow subscription actions', () => {
    it('accepts subscribe_workflow with UUID runId', () => {
      const runId = '550e8400-e29b-41d4-a716-446655440000';
      const result = wsMessageSchema.safeParse({ action: 'subscribe_workflow', runId });
      expect(result.success).toBe(true);
      expect(result.data.runId).toBe(runId);
    });

    it('accepts subscribe_workflow with optional workflowId for pre-subscribe', () => {
      const result = wsMessageSchema.safeParse({
        action: 'subscribe_workflow',
        runId: '550e8400-e29b-41d4-a716-446655440000',
        workflowId: '123e4567-e89b-12d3-a456-426614174000',
      });
      expect(result.success).toBe(true);
      expect(result.data.workflowId).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('accepts unsubscribe_workflow with optional runId', () => {
      const runId = '550e8400-e29b-41d4-a716-446655440000';
      expect(wsMessageSchema.safeParse({ action: 'unsubscribe_workflow', runId }).success).toBe(
        true,
      );
      expect(wsMessageSchema.safeParse({ action: 'unsubscribe_workflow' }).success).toBe(true);
    });

    it('rejects subscribe_workflow with invalid runId', () => {
      expect(
        wsMessageSchema.safeParse({ action: 'subscribe_workflow', runId: 'bad-id' }).success,
      ).toBe(false);
    });
  });

  describe('unknown action', () => {
    it('rejects unknown action type', () => {
      const result = wsMessageSchema.safeParse({ action: 'restart' });
      expect(result.success).toBe(false);
    });

    it('rejects missing action field', () => {
      const result = wsMessageSchema.safeParse({ prompt: 'hello' });
      expect(result.success).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// controlActionSchema
// ---------------------------------------------------------------------------

describe('controlActionSchema', () => {
  const validActions = ['get_context_usage', 'set_model', 'rewind_files', 'mcp_status'];

  it.each(validActions)('accepts valid action: %s', (action) => {
    const result = controlActionSchema.safeParse({ action });
    expect(result.success).toBe(true);
    expect(result.data.action).toBe(action);
  });

  it('rejects invalid action', () => {
    const result = controlActionSchema.safeParse({ action: 'shutdown' });
    expect(result.success).toBe(false);
  });

  it('accepts optional model field', () => {
    const result = controlActionSchema.safeParse({ action: 'set_model', model: 'gpt-4o' });
    expect(result.success).toBe(true);
    expect(result.data.model).toBe('gpt-4o');
  });

  it('accepts optional messageId field', () => {
    const result = controlActionSchema.safeParse({
      action: 'rewind_files',
      messageId: 'msg-123',
    });
    expect(result.success).toBe(true);
    expect(result.data.messageId).toBe('msg-123');
  });

  it('rejects missing action field', () => {
    const result = controlActionSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sessionsQuerySchema
// ---------------------------------------------------------------------------

describe('sessionsQuerySchema', () => {
  it('applies defaults when no params provided', () => {
    const result = sessionsQuerySchema.safeParse({});
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ limit: 20, offset: 0 });
  });

  it('coerces string numbers from query params', () => {
    const result = sessionsQuerySchema.safeParse({ limit: '10', offset: '5' });
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ limit: 10, offset: 5 });
  });

  it('rejects limit < 1', () => {
    const result = sessionsQuerySchema.safeParse({ limit: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects limit > 100', () => {
    const result = sessionsQuerySchema.safeParse({ limit: 101 });
    expect(result.success).toBe(false);
  });

  it('accepts limit = 1 (minimum)', () => {
    const result = sessionsQuerySchema.safeParse({ limit: 1 });
    expect(result.success).toBe(true);
  });

  it('accepts limit = 100 (maximum)', () => {
    const result = sessionsQuerySchema.safeParse({ limit: 100 });
    expect(result.success).toBe(true);
  });

  it('rejects negative offset', () => {
    const result = sessionsQuerySchema.safeParse({ offset: -1 });
    expect(result.success).toBe(false);
  });

  it('accepts offset = 0', () => {
    const result = sessionsQuerySchema.safeParse({ offset: 0 });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// requestIdMiddleware
// ---------------------------------------------------------------------------

describe('requestIdMiddleware', () => {
  it('sets req.requestId and X-Request-Id header', () => {
    const req = { headers: {} };
    const res = mockRes();
    const next = vi.fn();
    requestIdMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(typeof req.requestId).toBe('string');
    expect(req.requestId.length).toBeGreaterThan(10);
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  it('reuses a valid inbound x-request-id', () => {
    const req = { headers: { 'x-request-id': 'client-req-abc-123' } };
    const res = mockRes();
    const next = vi.fn();
    requestIdMiddleware(req, res, next);
    expect(req.requestId).toBe('client-req-abc-123');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', 'client-req-abc-123');
  });

  it('ignores malformed inbound x-request-id', () => {
    const req = { headers: { 'x-request-id': 'bad id !' } };
    const res = mockRes();
    const next = vi.fn();
    requestIdMiddleware(req, res, next);
    expect(req.requestId).not.toBe('bad id !');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-Id', req.requestId);
  });

  it('rejects inbound id that is only hyphens (no alphanumeric)', () => {
    const req = { headers: { 'x-request-id': '----------' } };
    const res = mockRes();
    const next = vi.fn();
    requestIdMiddleware(req, res, next);
    expect(req.requestId).not.toBe('----------');
    expect(req.requestId.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// validate (body validation middleware)
// ---------------------------------------------------------------------------

describe('validate middleware', () => {
  it('sets req.body to parsed data and calls next on valid input', () => {
    const middleware = validate(controlActionSchema);
    const req = { body: { action: 'set_model', model: 'claude-3' } };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body.action).toBe('set_model');
    expect(req.body.model).toBe('claude-3');
  });

  it('strips unknown fields from parsed body', () => {
    const middleware = validate(controlActionSchema);
    const req = { body: { action: 'mcp_status', extra: 'junk' } };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.body).not.toHaveProperty('extra');
  });

  it('returns 400 with error details on invalid body', () => {
    const middleware = validate(controlActionSchema);
    const req = { body: { action: 'invalid_action' } };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'validation failed',
        details: expect.any(Array),
      }),
    );
  });

  it('returns 400 when body is empty', () => {
    const middleware = validate(controlActionSchema);
    const req = { body: {} };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ---------------------------------------------------------------------------
// validateQuery (query validation middleware)
// ---------------------------------------------------------------------------

describe('validateQuery middleware', () => {
  it('sets req.query to parsed data and calls next on valid input', () => {
    const middleware = validateQuery(sessionsQuerySchema);
    const req = { query: { limit: '15', offset: '3' } };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.query).toEqual({ limit: 15, offset: 3 });
  });

  it('applies schema defaults when query is empty', () => {
    const middleware = validateQuery(sessionsQuerySchema);
    const req = { query: {} };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.query).toEqual({ limit: 20, offset: 0 });
  });

  it('returns 400 with error details on invalid query', () => {
    const middleware = validateQuery(sessionsQuerySchema);
    const req = { query: { limit: 'abc' } };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: 'validation failed',
        details: expect.any(Array),
      }),
    );
  });

  it('returns 400 when limit exceeds maximum', () => {
    const middleware = validateQuery(sessionsQuerySchema);
    const req = { query: { limit: '999' } };
    const res = mockRes();
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ---------------------------------------------------------------------------
// wsMessageSchema -- follow_up action
// ---------------------------------------------------------------------------

describe('wsMessageSchema - follow_up action', () => {
  it('accepts follow_up with prompt', () => {
    const result = wsMessageSchema.safeParse({ action: 'follow_up', prompt: 'continue' });
    expect(result.success).toBe(true);
    expect(result.data.action).toBe('follow_up');
  });

  it('accepts follow_up with optional sessionId and permissionMode', () => {
    const msg = {
      action: 'follow_up',
      prompt: 'do more',
      sessionId: '550e8400-e29b-41d4-a716-446655440000',
      permissionMode: 'default',
    };
    const result = wsMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    expect(result.data.sessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('rejects follow_up without prompt', () => {
    const result = wsMessageSchema.safeParse({ action: 'follow_up' });
    expect(result.success).toBe(false);
  });

  it('rejects follow_up with empty prompt', () => {
    const result = wsMessageSchema.safeParse({ action: 'follow_up', prompt: '' });
    expect(result.success).toBe(false);
  });

  it('rejects follow_up with non-UUID sessionId', () => {
    const result = wsMessageSchema.safeParse({
      action: 'follow_up',
      prompt: 'hi',
      sessionId: 'not-uuid',
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// workflowSchema
// ---------------------------------------------------------------------------

describe('workflowSchema', () => {
  const validDef = {
    name: 'Test',
    definition: {
      nodes: [
        { id: 'in', type: 'input' },
        { id: 'out', type: 'output' },
      ],
      edges: [{ from: 'in', to: 'out' }],
    },
  };

  it('accepts a valid workflow', () => {
    const result = workflowSchema.safeParse(validDef);
    expect(result.success).toBe(true);
  });

  it('rejects missing name', () => {
    const result = workflowSchema.safeParse({ definition: validDef.definition });
    expect(result.success).toBe(false);
  });

  it('rejects empty name', () => {
    const result = workflowSchema.safeParse({ ...validDef, name: '' });
    expect(result.success).toBe(false);
  });

  it('rejects empty nodes array', () => {
    const result = workflowSchema.safeParse({
      name: 'Bad',
      definition: { nodes: [], edges: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid node type', () => {
    const result = workflowSchema.safeParse({
      name: 'Bad',
      definition: {
        nodes: [{ id: 'x', type: 'magic' }],
        edges: [],
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts all valid node types', () => {
    const types = ['agent', 'condition', 'transform', 'input', 'output'];
    for (const type of types) {
      const result = workflowSchema.safeParse({
        name: 'Test',
        definition: {
          nodes: [{ id: `n-${type}`, type }],
          edges: [],
        },
      });
      expect(result.success).toBe(true);
    }
  });

  it('accepts nodes with position', () => {
    const result = workflowSchema.safeParse({
      name: 'Test',
      definition: {
        nodes: [{ id: 'in', type: 'input', position: { x: 100, y: 200 } }],
        edges: [],
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts edges with condition', () => {
    const result = workflowSchema.safeParse({
      name: 'Test',
      definition: {
        nodes: [
          { id: 'in', type: 'input' },
          { id: 'out', type: 'output' },
        ],
        edges: [{ from: 'in', to: 'out', condition: 'true' }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid edge condition value', () => {
    const result = workflowSchema.safeParse({
      name: 'Bad',
      definition: {
        nodes: [
          { id: 'in', type: 'input' },
          { id: 'cond', type: 'condition', config: { expression: 'x == "y"' } },
          { id: 'out', type: 'output' },
        ],
        edges: [
          { from: 'in', to: 'cond' },
          { from: 'cond', to: 'out', condition: 'maybe' },
        ],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('workflowRunRequestSchema', () => {
  it('accepts empty body', () => {
    expect(workflowRunRequestSchema.safeParse({}).success).toBe(true);
  });

  it('accepts context with arbitrary values and UUID runId', () => {
    const result = workflowRunRequestSchema.safeParse({
      context: { answer: 42, nested: { ok: true } },
      runId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('rejects non-UUID runId', () => {
    expect(
      workflowRunRequestSchema.safeParse({
        runId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });
});
