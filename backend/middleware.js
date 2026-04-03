/**
 * Express middleware: API key authentication and input validation.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';

/** At least one alphanumeric; disallow ids that are only punctuation (e.g. all hyphens). */
const INBOUND_REQUEST_ID = /^(?=.*[A-Za-z0-9])[A-Za-z0-9-]{8,128}$/;

/**
 * Attach a stable request id for logs and client-facing error correlation.
 */
export function requestIdMiddleware(req, res, next) {
  const raw = req.headers['x-request-id'];
  const headerVal = Array.isArray(raw) ? raw[0] : raw;
  const id =
    typeof headerVal === 'string' && INBOUND_REQUEST_ID.test(headerVal) ? headerVal : randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-Id', id);
  next();
}

// --- API Key Auth ---

const API_KEY = process.env.AGENTBOARD_API_KEY || '';
const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

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

function getFirstHeaderValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

export function normalizeUserId(rawUserId) {
  if (typeof rawUserId !== 'string') return null;
  const userId = rawUserId.trim();
  if (!userId) return null;
  return USER_ID_PATTERN.test(userId) ? userId : null;
}

function getRequestUserId(req) {
  return getFirstHeaderValue(req.headers['x-user-id']);
}

/**
 * Bearer token authentication middleware.
 * Skipped when AGENTBOARD_API_KEY is not set (development mode).
 */
export function authMiddleware(req, res, next) {
  const requestedUserId = getRequestUserId(req);
  const normalizedUserId = requestedUserId ? normalizeUserId(requestedUserId) : null;

  if (requestedUserId && !normalizedUserId) {
    return res.status(400).json({ error: 'invalid x-user-id' });
  }

  // Always initialize req.user
  req.user = { id: normalizedUserId || 'default' };

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

  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedUserId =
    url.searchParams.get('user_id') ||
    url.searchParams.get('userId') ||
    getRequestUserId(req) ||
    null;
  const normalizedUserId = requestedUserId ? normalizeUserId(requestedUserId) : null;
  if (requestedUserId && !normalizedUserId) return false;
  req.userId = normalizedUserId || 'default';

  if (!API_KEY) return true;
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
    workflowId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal('unsubscribe_workflow'),
    runId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal('subscribe_experiment'),
    runId: z.string().uuid(),
    experimentId: z.string().uuid().optional(),
  }),
  z.object({
    action: z.literal('unsubscribe_experiment'),
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
  type: z.enum(['agent', 'condition', 'transform', 'input', 'output', 'experiment']),
  label: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
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
  condition: z.enum(['true', 'false']).optional(),
});

export const workflowSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  definition: z.object({
    nodes: z.array(nodeSchema).min(1),
    edges: z.array(edgeSchema),
  }),
});

export const workflowRunRequestSchema = z
  .object({
    context: z.record(z.string(), z.unknown()).optional(),
    runId: z.string().uuid().optional(),
  })
  .default({});

export const sessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const experimentSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  plan: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    target: z
      .object({
        files: z.array(z.string()).optional(),
        readonly: z.array(z.string()).optional(),
        source_dir: z.string().optional(),
        constraints: z.array(z.string()).optional(),
      })
      .optional(),
    metrics: z.object({
      primary: z.object({
        command: z.string().min(1),
        extract: z.string().optional(),
        type: z.enum(['regex', 'json_path', 'exit_code']).optional(),
        direction: z.enum(['minimize', 'maximize']).optional(),
      }),
      secondary: z
        .array(
          z.object({
            name: z.string(),
            command: z.string().optional(),
            extract: z.string().optional(),
            type: z.enum(['regex', 'json_path', 'exit_code']).optional(),
            direction: z.enum(['minimize', 'maximize']).optional(),
          }),
        )
        .optional(),
      guard: z
        .object({
          command: z.string().min(1),
          success_pattern: z.string().optional(),
        })
        .optional(),
    }),
    budget: z
      .object({
        time_per_experiment: z.string().optional(),
        max_experiments: z.number().int().min(1).max(10000).optional(),
        max_consecutive_failures: z.number().int().min(1).optional(),
        total_time: z.string().optional(),
      })
      .optional(),
    agent_instructions: z.string().max(50000).optional(),
  }),
});

export const experimentRunSchema = z
  .object({
    context: z.record(z.string(), z.unknown()).optional(),
  })
  .default({});

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
