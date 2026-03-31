import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import config from './config.js';
import {
  listSessionsPaged,
  countSessions,
  getSession,
  getEvents,
  countEvents,
  recoverStaleSessions,
  close as closeDb,
} from './sessionStore.js';
import {
  startAgent,
  stopAgent,
  getActiveAgents,
  getAgentStream,
  agentEvents,
  PERMISSION_MODES,
} from './agentManager.js';
import { getMcpHealth } from './mcpHealth.js';
import {
  authMiddleware,
  wsAuth,
  wsMessageSchema,
  controlActionSchema,
  sessionsQuerySchema,
  validate,
  validateQuery,
} from './middleware.js';

const app = express();
app.use(cors());
app.use(express.json());
app.use(authMiddleware);

// --- REST API ---

app.get('/api/sessions', validateQuery(sessionsQuerySchema), (req, res) => {
  const { limit, offset } = req.query;
  const sessions = listSessionsPaged(limit, offset);
  const total = countSessions();
  res.json({ sessions, total, limit, offset });
});

app.get('/api/sessions/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const events = getEvents(req.params.id);
  const eventCount = countEvents(req.params.id);
  res.json({ ...session, events, eventCount });
});

app.post('/api/sessions/:id/stop', (req, res) => {
  const stopped = stopAgent(req.params.id);
  if (!stopped) {
    res.status(404).json({ error: 'session not found or not active', stopped });
    return;
  }
  res.json({ stopped });
});

app.get('/api/status', (_req, res) => {
  res.json({
    activeAgents: getActiveAgents(),
    uptime: process.uptime(),
  });
});

app.get('/api/mcp/health', (_req, res) => {
  res.json(getMcpHealth());
});

app.get('/api/config/permissions', (_req, res) => {
  res.json({ modes: PERMISSION_MODES });
});

// Stream control -- dispatch actions to a running agent's stream
app.post('/api/sessions/:id/control', validate(controlActionSchema), async (req, res) => {
  const { action } = req.body;
  const stream = getAgentStream(req.params.id);
  if (!stream) {
    return res.status(404).json({ error: 'session not active' });
  }
  try {
    switch (action) {
      case 'get_context_usage': {
        if (typeof stream.getContextUsage === 'function') {
          const usage = await stream.getContextUsage();
          return res.json({ action, result: usage });
        }
        return res.json({ action, result: null, note: 'not supported by SDK version' });
      }
      case 'set_model': {
        const { model } = req.body;
        if (!model) return res.status(400).json({ error: 'model is required' });
        if (typeof stream.setModel === 'function') {
          await stream.setModel(model);
          return res.json({ action, result: { model } });
        }
        return res.json({ action, result: null, note: 'not supported by SDK version' });
      }
      case 'rewind_files': {
        const { messageId } = req.body;
        if (typeof stream.rewindFiles === 'function') {
          const result = await stream.rewindFiles(messageId);
          return res.json({ action, result });
        }
        return res.json({ action, result: null, note: 'not supported by SDK version' });
      }
      case 'mcp_status': {
        return res.json({ action, result: getMcpHealth() });
      }
      default:
        return res.status(400).json({ error: `unknown control action: ${action}` });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// --- Error Handler (Express 5 auto-forwards rejected promises) ---

app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled route error:', err);
  res.status(500).json({ error: err.message || 'internal server error' });
});

// --- WebSocket ---

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// 跟踪每个 ws 连接订阅的 sessionId
const subscriptions = new Map();

wss.on('connection', (ws, req) => {
  if (!wsAuth(req)) {
    ws.close(4001, 'unauthorized');
    return;
  }

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      ws.send(JSON.stringify({ error: 'invalid JSON' }));
      return;
    }

    const parsed = wsMessageSchema.safeParse(msg);
    if (!parsed.success) {
      ws.send(JSON.stringify({ error: 'validation failed', details: parsed.error.issues }));
      return;
    }
    msg = parsed.data;

    switch (msg.action) {
      case 'start': {
        if (!msg.prompt) {
          ws.send(JSON.stringify({ error: 'prompt is required' }));
          return;
        }
        const sessionId = startAgent(msg.prompt, {
          permissionMode: msg.permissionMode,
          maxTurns: msg.maxTurns,
        });
        subscriptions.set(ws, sessionId);
        ws.send(JSON.stringify({ type: 'session_started', sessionId }));
        break;
      }

      case 'subscribe': {
        if (!msg.sessionId) {
          ws.send(JSON.stringify({ error: 'sessionId is required' }));
          return;
        }
        subscriptions.set(ws, msg.sessionId);
        ws.send(JSON.stringify({ type: 'subscribed', sessionId: msg.sessionId }));
        break;
      }

      case 'stop': {
        const sid = msg.sessionId || subscriptions.get(ws);
        if (sid) stopAgent(sid);
        break;
      }

      case 'unsubscribe': {
        subscriptions.delete(ws);
        ws.send(JSON.stringify({ type: 'unsubscribed' }));
        break;
      }

      default:
        ws.send(JSON.stringify({ error: `unknown action: ${msg.action}` }));
    }
  });

  ws.on('close', () => {
    subscriptions.delete(ws);
  });
});

// 将 Agent 事件广播到订阅了对应 session 的 WebSocket 客户端
agentEvents.on('event', (event) => {
  for (const [ws, sessionId] of subscriptions) {
    if (sessionId === event.sessionId && ws.readyState === 1) {
      ws.send(JSON.stringify(event));
    }
  }
});

// --- Start ---

// Recover stale sessions from previous crashes before accepting connections
recoverStaleSessions();

server.listen(config.port, () => {
  console.log(`AgentBoard backend listening on http://localhost:${config.port}`);
  console.log(`WebSocket ready on ws://localhost:${config.port}`);
  console.log(`Workspace: ${config.workspaceDir}`);
});

// --- Graceful Shutdown ---

function shutdown(signal) {
  console.log(`\n[${signal}] Shutting down...`);

  // Stop all active agents
  for (const sessionId of getActiveAgents()) {
    stopAgent(sessionId);
  }

  // Close WebSocket connections
  for (const ws of wss.clients) {
    ws.close();
  }

  // Close HTTP server, then database
  server.close(() => {
    closeDb();
    console.log('Shutdown complete.');
    process.exit(0);
  });

  // Force exit if graceful shutdown takes too long
  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
