/**
 * Express middleware: API key authentication and input validation.
 */

import { z } from 'zod';

// --- API Key Auth ---

const API_KEY = process.env.AGENTBOARD_API_KEY || '';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
]);

// Dynamically add backend port origins (for same-origin requests)
const backendPort = process.env.PORT || '3001';
ALLOWED_ORIGINS.add(`http://localhost:${backendPort}`);
ALLOWED_ORIGINS.add(`http://127.0.0.1:${backendPort}`);

/**
 * Check if an HTTP origin is allowed (localhost only).
 * Missing origins are allowed for non-browser HTTP clients such as curl.
 */
export function isAllowedOrigin(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

/**
 * WebSocket connections must always provide an explicit browser origin.
 * This closes the no-Origin bypass path for raw WS clients when no API key is set.
 */
export function isAllowedWebSocketOrigin(origin) {
  return typeof origin === 'string' && ALLOWED_ORIGINS.has(origin);
}

/**
 * Bearer token authentication middleware.
 * Skipped when AGENTBOARD_API_KEY is not set (development mode).
 */
export function authMiddleware(req, res, next) {
  // Always initialize req.user
  req.user = { id: req.headers['x-user-id'] || 'default' };

  if (!API_KEY) return next(); // no key configured = open access

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (token !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

/**
 * WebSocket auth check. Returns true if authorized.
 * Always enforces origin check (even without API key) to block cross-origin WS.
 */
export function wsAuth(req) {
  const origin = req.headers.origin;
  if (!isAllowedWebSocketOrigin(origin)) return false;

  req.userId = req.headers['x-user-id'] || 'default';

  if (!API_KEY) return true;
  const url = new URL(req.url, `http://${req.headers.host}`);
  return url.searchParams.get('token') === API_KEY;
}

// --- Zod Validation Schemas ---

export const wsMessageSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('start'),
    prompt: z.string().min(1).max(50000),
    permissionMode: z.string().optional(),
    maxTurns: z.number().int().min(1).max(200).optional(),
  }),
  z.object({
    action: z.literal('follow_up'),
    prompt: z.string().min(1).max(50000),
    sessionId: z.string().uuid().optional(),
    permissionMode: z.string().optional(),
    maxTurns: z.number().int().min(1).max(200).optional(),
  }),
  z.object({
    action: z.literal('subscribe'),
    sessionId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('stop'),
    sessionId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal('unsubscribe'),
  }),
  z.object({
    action: z.literal('subscribe_workflow'),
    runId: z.string().uuid(),
  }),
  z.object({
    action: z.literal('unsubscribe_workflow'),
    runId: z.string().uuid().optional(),
  }),
]);

export const controlActionSchema = z.object({
  action: z.enum(['get_context_usage', 'set_model', 'rewind_files', 'mcp_status']),
  model: z.string().optional(),
  messageId: z.string().optional(),
});

const nodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['agent', 'condition', 'transform', 'input', 'output']),
  label: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  position: z
    .object({
      x: z.number(),
      y: z.number(),
    })
    .optional(),
});

const edgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  condition: z.string().optional(),
});

export const workflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  definition: z.object({
    nodes: z.array(nodeSchema).min(1),
    edges: z.array(edgeSchema),
  }),
});

export const sessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Express middleware factory: validate req.body against a zod schema.
 */
export function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        error: 'validation failed',
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    req.body = result.data;
    next();
  };
}

/**
 * Validate query params against a zod schema.
 */
export function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json({
        error: 'validation failed',
        details: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    // Express 5 makes req.query a read-only getter; override with defineProperty
    Object.defineProperty(req, 'query', { value: result.data, writable: true, configurable: true });
    next();
  };
}
