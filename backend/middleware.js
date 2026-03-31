/**
 * Express middleware: API key authentication and input validation.
 */

import { z } from 'zod';

// --- API Key Auth ---

const API_KEY = process.env.AGENTBOARD_API_KEY || '';

/**
 * Bearer token authentication middleware.
 * Skipped when AGENTBOARD_API_KEY is not set (development mode).
 */
export function authMiddleware(req, res, next) {
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
 */
export function wsAuth(req) {
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
]);

export const controlActionSchema = z.object({
  action: z.enum(['get_context_usage', 'set_model', 'rewind_files', 'mcp_status']),
  model: z.string().optional(),
  messageId: z.string().optional(),
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
    req.query = result.data;
    next();
  };
}
