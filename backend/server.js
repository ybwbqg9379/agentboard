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
  continueAgent,
  stopAgent,
  getActiveAgents,
  getAgentStream,
  agentEvents,
  PERMISSION_MODES,
} from './agentManager.js';
import { getMcpHealth } from './mcpHealth.js';
import {
  createWorkflow,
  createWorkflowRun,
  updateWorkflow,
  getWorkflow,
  listWorkflows,
  countWorkflows,
  deleteWorkflow,
  getWorkflowRun,
  listWorkflowRuns,
  closeWorkflowDb,
} from './workflowStore.js';
import {
  validateWorkflow,
  executeWorkflow,
  abortWorkflow,
  getActiveWorkflowRuns,
  workflowEvents,
} from './workflowEngine.js';
import {
  authMiddleware,
  wsAuth,
  isAllowedOrigin,
  wsMessageSchema,
  controlActionSchema,
  sessionsQuerySchema,
  workflowSchema,
  validate,
  validateQuery,
} from './middleware.js';

const app = express();

app.use(
  cors({
    origin(origin, cb) {
      if (isAllowedOrigin(origin)) return cb(null, true);
      cb(new Error('CORS: origin not allowed'));
    },
  }),
);
app.use(express.json());
app.use(authMiddleware);

// --- REST API ---

app.get('/api/sessions', validateQuery(sessionsQuerySchema), (req, res) => {
  const { limit, offset } = req.query;
  const sessions = listSessionsPaged(req.user.id, limit, offset);
  const total = countSessions(req.user.id);
  res.json({ sessions, total, limit, offset });
});

app.get('/api/sessions/:id', (req, res) => {
  const session = getSession(req.user.id, req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const events = getEvents(req.params.id); // Events don't need user_id strictly if session checked
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

// --- Workflow API ---

app.get('/api/workflows', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const workflows = listWorkflows(req.user.id, limit, offset);
  const total = countWorkflows(req.user.id);
  res.json({ workflows, total, limit, offset });
});

app.get('/api/workflows/:id', (req, res) => {
  const workflow = getWorkflow(req.user.id, req.params.id);
  if (!workflow) return res.status(404).json({ error: 'workflow not found' });
  res.json(workflow);
});

app.post('/api/workflows', validate(workflowSchema), (req, res) => {
  const { name, description, definition } = req.body;
  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid workflow', details: validation.errors });
  }
  const id = createWorkflow(req.user.id, name, description, definition);
  res.status(201).json({ id });
});

app.put('/api/workflows/:id', validate(workflowSchema), (req, res) => {
  const { name, description, definition } = req.body;
  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid workflow', details: validation.errors });
  }
  const updated = updateWorkflow(req.user.id, req.params.id, name, description, definition);
  if (!updated) return res.status(404).json({ error: 'workflow not found' });
  res.json({ updated: true });
});

app.delete('/api/workflows/:id', (req, res) => {
  const deleted = deleteWorkflow(req.user.id, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'workflow not found' });
  res.json({ deleted: true });
});

app.post('/api/workflows/:id/run', async (req, res) => {
  const workflow = getWorkflow(req.user.id, req.params.id);
  if (!workflow) return res.status(404).json({ error: 'workflow not found' });
  const inputContext = req.body?.context || {};
  const requestedRunId = req.body?.runId;
  const runId = createWorkflowRun(req.user.id, req.params.id, inputContext, requestedRunId);
  res.status(202).json({ message: 'workflow started', workflowId: req.params.id, runId });
  executeWorkflow(req.params.id, workflow.definition, inputContext, runId, req.user.id).catch(
    (err) => {
      console.error(`[workflow] execution error: ${err.message}`);
    },
  );
});

app.post('/api/workflow-runs/:id/abort', (req, res) => {
  const aborted = abortWorkflow(req.params.id);
  if (!aborted) return res.status(404).json({ error: 'run not found or not active' });
  res.json({ aborted: true });
});

app.get('/api/workflows/:id/runs', (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const runs = listWorkflowRuns(req.user.id, req.params.id, limit, offset);
  res.json({ runs });
});

app.get('/api/workflow-runs/:id', (req, res) => {
  const run = getWorkflowRun(req.user.id, req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json(run);
});

app.get('/api/workflow-status', (_req, res) => {
  res.json({ activeRuns: getActiveWorkflowRuns() });
});

// --- Error Handler (Express 5 auto-forwards rejected promises) ---

app.use((err, _req, res, _next) => {
  console.error('[server] Unhandled route error:', err);
  res.status(500).json({ error: err.message || 'internal server error' });
});

// --- WebSocket ---

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// 跟踪每个 ws 连接订阅的 sessionId 和 workflow runId
const subscriptions = new Map();
const workflowSubs = new Map(); // Map<ws, Set<runId>>

wss.on('connection', (ws, req) => {
  if (!wsAuth(req)) {
    ws.close(4001, 'unauthorized');
    return;
  }

  ws.userId = req.userId;

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
          userId: ws.userId,
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

      case 'follow_up': {
        if (!msg.prompt) {
          ws.send(JSON.stringify({ error: 'prompt is required' }));
          return;
        }
        const targetSid = msg.sessionId || subscriptions.get(ws);
        if (!targetSid) {
          ws.send(JSON.stringify({ error: 'no active session to continue' }));
          return;
        }
        const resumed = continueAgent(targetSid, msg.prompt, {
          userId: ws.userId,
          permissionMode: msg.permissionMode,
          maxTurns: msg.maxTurns,
        });
        if (!resumed) {
          ws.send(JSON.stringify({ error: 'session is still running or not found' }));
          return;
        }
        subscriptions.set(ws, targetSid);
        ws.send(JSON.stringify({ type: 'session_resumed', sessionId: targetSid }));
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

      case 'subscribe_workflow': {
        if (!workflowSubs.has(ws)) workflowSubs.set(ws, new Set());
        workflowSubs.get(ws).add(msg.runId);
        ws.send(JSON.stringify({ type: 'workflow_subscribed', runId: msg.runId }));
        break;
      }

      case 'unsubscribe_workflow': {
        if (msg.runId) {
          workflowSubs.get(ws)?.delete(msg.runId);
        } else {
          workflowSubs.delete(ws);
        }
        ws.send(JSON.stringify({ type: 'workflow_unsubscribed' }));
        break;
      }

      default:
        ws.send(JSON.stringify({ error: `unknown action: ${msg.action}` }));
    }
  });

  ws.on('close', () => {
    subscriptions.delete(ws);
    workflowSubs.delete(ws);
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

// Broadcast workflow execution events to clients subscribed to the runId
for (const eventName of [
  'run_start',
  'run_complete',
  'node_start',
  'node_complete',
  'agent_started',
]) {
  workflowEvents.on(eventName, (data) => {
    const runId = data.runId;
    if (!runId) return;
    const payload = JSON.stringify({
      type: 'workflow',
      subtype: eventName,
      content: data,
      timestamp: Date.now(),
    });
    for (const [ws, runIds] of workflowSubs) {
      if (ws.readyState === 1 && runIds.has(runId)) {
        ws.send(payload);
      }
    }
  });
}

// --- Start ---

// Recover stale sessions from previous crashes before accepting connections
recoverStaleSessions();

server.listen(config.port, () => {
  console.log(`AgentBoard backend listening on http://localhost:${config.port}`);
  console.log(`WebSocket ready on ws://localhost:${config.port}`);
  console.log(`Workspace: ${config.workspaceDir}`);
  if (!process.env.AGENTBOARD_API_KEY) {
    console.warn(
      '[SECURITY] AGENTBOARD_API_KEY is not set. API remains unauthenticated for allowed localhost origins, and raw WebSocket clients without a browser Origin header are rejected. Set AGENTBOARD_API_KEY for production use.',
    );
  }
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

  // Close HTTP server, then databases
  server.close(() => {
    closeDb();
    closeWorkflowDb();
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

export { app, server };
