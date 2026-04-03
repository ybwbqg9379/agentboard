import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import config from './config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, 'templates');
import {
  listSessionsPaged,
  countSessions,
  getSession,
  getEvents,
  countEvents,
  recoverStaleSessions,
  deleteSession,
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
import { closeMemoryDb } from './memoryStore.js';
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
  workflowRunRequestSchema,
  experimentSchema,
  experimentRunSchema,
  validate,
  validateQuery,
} from './middleware.js';
import {
  createExperiment,
  getExperiment,
  listExperiments,
  countExperiments,
  updateExperiment,
  deleteExperiment,
  createRun as createExperimentRun,
  listRuns as listExperimentRuns,
  listTrials,
  getRunOwned as getExperimentRunOwned,
  recoverStaleRuns,
  closeExperimentDb,
} from './experimentStore.js';
import {
  runExperimentLoop,
  abortExperiment,
  getActiveExperiments,
  validatePlan,
  prepareWorkspace,
  experimentEvents,
} from './experimentEngine.js';
import {
  runResearchSwarm,
  abortSwarm,
  isSwarmActive,
  swarmEvents,
  initSwarmBus,
} from './researchSwarm.js';
import { listSwarmBranches, listCoordinatorDecisions } from './swarmStore.js';

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

async function hasOwnedSession(userId, sessionId) {
  return Boolean(sessionId && (await getSession(userId, sessionId)));
}

async function hasOwnedWorkflowRun(userId, runId) {
  return Boolean(runId && (await getWorkflowRun(userId, runId)));
}

// --- REST API ---

app.get('/api/sessions', validateQuery(sessionsQuerySchema), async (req, res) => {
  const { limit, offset } = req.query;
  const sessions = await listSessionsPaged(req.user.id, limit, offset);
  const total = await countSessions(req.user.id);
  res.json({ sessions, total, limit, offset });
});

app.get('/api/sessions/:id', async (req, res) => {
  const session = await getSession(req.user.id, req.params.id);
  if (!session) return res.status(404).json({ error: 'session not found' });
  const events = await getEvents(req.params.id); // Events don't need user_id strictly if session checked
  const eventCount = await countEvents(req.params.id);
  res.json({ ...session, events, eventCount });
});

// Delete a session and its events (stops running agent first)
app.delete('/api/sessions/:id', async (req, res) => {
  if (!(await hasOwnedSession(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'session not found' });
  }
  stopAgent(req.params.id);
  const deleted = await deleteSession(req.user.id, req.params.id);
  if (!deleted) {
    return res.status(500).json({ error: 'delete failed' });
  }
  res.json({ deleted: true });
});

// Batch delete sessions
app.post('/api/sessions/batch-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  if (ids.length > 100) {
    return res.status(400).json({ error: 'max 100 ids per batch' });
  }
  let count = 0;
  for (const id of ids) {
    if (await hasOwnedSession(req.user.id, id)) {
      stopAgent(id);
      if (await deleteSession(req.user.id, id)) count++;
    }
  }
  res.json({ deleted: count });
});

app.post('/api/sessions/:id/stop', async (req, res) => {
  if (!(await hasOwnedSession(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'session not found' });
  }
  const stopped = stopAgent(req.params.id);
  if (!stopped) {
    res.status(404).json({ error: 'session not found or not active', stopped });
    return;
  }
  res.json({ stopped });
});

app.get('/api/status', (_req, res) => {
  res.json({
    activeAgents: getActiveAgents(_req.user.id),
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
  if (!(await hasOwnedSession(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'session not found' });
  }
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

app.get('/api/workflows', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const workflows = await listWorkflows(req.user.id, limit, offset);
  const total = await countWorkflows(req.user.id);
  res.json({ workflows, total, limit, offset });
});

app.get('/api/workflows/:id', async (req, res) => {
  const workflow = await getWorkflow(req.user.id, req.params.id);
  if (!workflow) return res.status(404).json({ error: 'workflow not found' });
  res.json(workflow);
});

app.post('/api/workflows', validate(workflowSchema), async (req, res) => {
  const { name, description, definition } = req.body;
  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid workflow', details: validation.errors });
  }
  const id = await createWorkflow(req.user.id, name, description, definition);
  res.status(201).json({ id });
});

app.put('/api/workflows/:id', validate(workflowSchema), async (req, res) => {
  const { name, description, definition } = req.body;
  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid workflow', details: validation.errors });
  }
  const updated = await updateWorkflow(req.user.id, req.params.id, name, description, definition);
  if (!updated) return res.status(404).json({ error: 'workflow not found' });
  res.json({ updated: true });
});

app.delete('/api/workflows/:id', async (req, res) => {
  // Abort any active runs for this workflow before deleting
  const activeRuns = getActiveWorkflowRuns(req.user.id);
  const runs = await listWorkflowRuns(req.user.id, req.params.id, 100, 0);
  for (const run of runs) {
    if (activeRuns.includes(run.id)) {
      abortWorkflow(run.id);
    }
  }
  const deleted = await deleteWorkflow(req.user.id, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'workflow not found' });
  res.json({ deleted: true });
});

// Batch delete workflows
app.post('/api/workflows/batch-delete', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids array required' });
  }
  if (ids.length > 100) {
    return res.status(400).json({ error: 'max 100 ids per batch' });
  }
  const activeRuns = getActiveWorkflowRuns(req.user.id);
  let count = 0;
  for (const id of ids) {
    try {
      const runs = await listWorkflowRuns(req.user.id, id, 100, 0);
      for (const run of runs) {
        if (activeRuns.includes(run.id)) abortWorkflow(run.id);
      }
      if (await deleteWorkflow(req.user.id, id)) count++;
    } catch {
      /* ignore individual failures */
    }
  }
  res.json({ deleted: count });
});

app.post('/api/workflows/:id/run', validate(workflowRunRequestSchema), async (req, res) => {
  const workflow = await getWorkflow(req.user.id, req.params.id);
  if (!workflow) return res.status(404).json({ error: 'workflow not found' });
  const inputContext = req.body.context || {};
  const requestedRunId = req.body.runId;
  const runId = await createWorkflowRun(req.user.id, req.params.id, inputContext, requestedRunId);
  res.status(202).json({ message: 'workflow started', workflowId: req.params.id, runId });
  executeWorkflow(req.params.id, workflow.definition, inputContext, runId, req.user.id).catch(
    (err) => {
      console.error(`[workflow] execution error: ${err.message}`);
    },
  );
});

app.post('/api/workflow-runs/:id/abort', async (req, res) => {
  if (!(await hasOwnedWorkflowRun(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const aborted = abortWorkflow(req.params.id);
  if (!aborted) return res.status(404).json({ error: 'run not found or not active' });
  res.json({ aborted: true });
});

app.get('/api/workflows/:id/runs', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const runs = await listWorkflowRuns(req.user.id, req.params.id, limit, offset);
  res.json({ runs });
});

app.get('/api/workflow-runs/:id', async (req, res) => {
  const run = await getWorkflowRun(req.user.id, req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json(run);
});

app.get('/api/workflow-status', (_req, res) => {
  res.json({ activeRuns: getActiveWorkflowRuns(_req.user.id) });
});

// --- Experiment API ---

// Serve pre-built ResearchPlan templates (safe allowlist — no path traversal)
app.get('/api/experiment-templates/:filename', (req, res) => {
  const filename = req.params.filename;
  // Only allow .json files with safe names (alphanumeric + hyphens)
  if (!/^[a-z0-9-]+\.json$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid template name' });
  }
  // Fix #8: Removed existsSync + readFileSync TOCTOU race.
  // A single readFileSync inside try/catch is atomic: ENOENT → 404,
  // any other error (malformed JSON, permission) → 500.
  const templatePath = resolve(TEMPLATES_DIR, filename);
  try {
    const content = JSON.parse(readFileSync(templatePath, 'utf-8'));
    res.json(content);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return res.status(404).json({ error: 'Template not found' });
    }
    res.status(500).json({ error: 'Failed to read template' });
  }
});

app.get('/api/experiment-templates', (_req, res) => {
  const templates = [
    { key: 'ml-training', label: 'ML Training Optimization', file: 'ml-training.json' },
    {
      key: 'performance-optimization',
      label: 'API Performance Optimization',
      file: 'performance-optimization.json',
    },
    { key: 'bundle-size', label: 'Frontend Bundle Size', file: 'bundle-size.json' },
    { key: 'ci-quality', label: 'CI Quality Gate', file: 'ci-quality.json' },
    { key: 'security-fuzz', label: 'Security Hardening', file: 'security-fuzz.json' },
  ];
  res.json({ templates });
});

app.get('/api/experiments', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const experiments = await listExperiments(req.user.id, limit, offset);
  const total = await countExperiments(req.user.id);
  res.json({ experiments, total, limit, offset });
});

app.get('/api/experiments/:id', async (req, res) => {
  const experiment = await getExperiment(req.user.id, req.params.id);
  if (!experiment) return res.status(404).json({ error: 'experiment not found' });
  res.json(experiment);
});

app.post('/api/experiments', validate(experimentSchema), async (req, res) => {
  const { name, description, plan } = req.body;
  const validation = validatePlan(plan);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid experiment plan', details: validation.errors });
  }
  const id = await createExperiment(req.user.id, name, description, plan);
  res.status(201).json({ id });
});

app.put('/api/experiments/:id', validate(experimentSchema), async (req, res) => {
  const { name, description, plan } = req.body;
  const validation = validatePlan(plan);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid experiment plan', details: validation.errors });
  }
  const updated = await updateExperiment(req.user.id, req.params.id, name, description, plan);
  if (!updated) return res.status(404).json({ error: 'experiment not found' });
  res.json({ updated: true });
});

app.delete('/api/experiments/:id', async (req, res) => {
  const deleted = await deleteExperiment(req.user.id, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'experiment not found' });
  res.json({ deleted: true });
});

app.post('/api/experiments/:id/run', validate(experimentRunSchema), async (req, res) => {
  const experiment = await getExperiment(req.user.id, req.params.id);
  if (!experiment) return res.status(404).json({ error: 'experiment not found' });

  // Use workspace/sessions/ for experiment isolation (Q2 decision)
  const workspaceDir = resolve(
    config.workspaceDir,
    req.user.id || 'default',
    'sessions',
    `experiment-${req.params.id}-${Date.now()}`,
  );

  const runId = await createExperimentRun(req.user.id, req.params.id);

  res.status(202).json({ message: 'experiment started', experimentId: req.params.id, runId });

  runExperimentLoop(req.params.id, experiment.plan, req.user.id, workspaceDir, runId).catch(
    (err) => {
      console.error(`[experiment] execution error: ${err.message}`);
    },
  );
});

app.get('/api/experiment-runs/:id', async (req, res) => {
  const run = await getExperimentRunOwned(req.user.id, req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json(run);
});

app.post('/api/experiment-runs/:id/abort', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const aborted = abortExperiment(req.params.id);
  if (!aborted) return res.status(404).json({ error: 'run not found or not active' });
  res.json({ aborted: true });
});

app.get('/api/experiments/:id/runs', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const runs = await listExperimentRuns(req.user.id, req.params.id, limit, offset);
  res.json({ runs });
});

app.get('/api/experiment-runs/:id/trials', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const trials = await listTrials(req.params.id, limit, offset);
  res.json({ trials });
});

app.get('/api/experiment-status', (_req, res) => {
  res.json({ activeRuns: getActiveExperiments(_req.user.id) });
});

// ── Swarm API ──────────────────────────────────────────────────────────────────

/**
 * POST /api/experiments/:id/swarm
 * Launch a Research Swarm run for the given experiment.
 * Request body may override swarm-level settings:
 *   { branches?: number, branch_budget?: { max_experiments, time_per_branch }, top_k?: number }
 */
app.post('/api/experiments/:id/swarm', async (req, res) => {
  const experiment = await getExperiment(req.user.id, req.params.id);
  if (!experiment) return res.status(404).json({ error: 'experiment not found' });

  // Merge request-body swarm overrides into plan
  const plan = {
    ...experiment.plan,
    swarm: {
      branches: 3,
      branch_budget: { max_experiments: 5, time_per_branch: '15m' },
      top_k: 1,
      ...(experiment.plan.swarm || {}),
      ...(req.body.swarm || {}),
    },
  };

  // Validate branch count (1–8)
  const branches = Math.min(Math.max(parseInt(plan.swarm.branches) || 3, 1), 8);
  plan.swarm.branches = branches;

  const workspaceDir = resolve(
    config.workspaceDir,
    req.user.id || 'default',
    'sessions',
    `swarm-${req.params.id}-${Date.now()}`,
  );

  // Prepare baseline workspace (mkdir, copy source files, git init) so
  // cloneBranchWorkspace has a valid git repo to clone from.
  try {
    prepareWorkspace(plan, workspaceDir, req.user.id);
  } catch (err) {
    return res.status(500).json({ error: `workspace setup failed: ${err.message}` });
  }

  const runId = await createExperimentRun(req.user.id, req.params.id);

  res.status(202).json({
    message: 'swarm started',
    experimentId: req.params.id,
    runId,
    branches,
  });

  runResearchSwarm(req.params.id, plan, req.user.id, workspaceDir, runId).catch((err) => {
    console.error(`[swarm] execution error: ${err.message}`);
  });
});

/**
 * GET /api/experiment-runs/:id/branches
 * List all research branches for a swarm run.
 */
app.get('/api/experiment-runs/:id/branches', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const branches = await listSwarmBranches(req.params.id);
  res.json({ branches });
});

/**
 * GET /api/experiment-runs/:id/coordinator-decisions
 * Return full Coordinator audit trail for a swarm run.
 */
app.get('/api/experiment-runs/:id/coordinator-decisions', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const decisions = await listCoordinatorDecisions(req.params.id);
  res.json({ decisions });
});

/**
 * POST /api/experiment-runs/:id/abort-swarm
 * Abort a running swarm (will abort all active branches).
 */
app.post('/api/experiment-runs/:id/abort-swarm', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const aborted = abortSwarm(req.params.id);
  if (!aborted) return res.status(409).json({ error: 'swarm not active' });
  res.json({ aborted: true });
});

/**
 * GET /api/experiment-runs/:id/swarm-status
 * Check whether a swarm run is currently active.
 */
app.get('/api/experiment-runs/:id/swarm-status', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  res.json({ active: isSwarmActive(req.params.id) });
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
const experimentSubs = new Map(); // Map<ws, Set<runId>>

wss.on('connection', (ws, req) => {
  if (!wsAuth(req)) {
    ws.close(4001, 'unauthorized');
    return;
  }

  ws.userId = req.userId;

  ws.on('message', async (raw) => {
    if (raw.toString() === 'ping') {
      ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

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
        try {
          const sessionId = await startAgent(msg.prompt, {
            userId: ws.userId,
            permissionMode: msg.permissionMode,
            maxTurns: msg.maxTurns,
          });
          subscriptions.set(ws, sessionId);
          ws.send(JSON.stringify({ type: 'session_started', sessionId }));
        } catch (err) {
          ws.send(JSON.stringify({ error: `agent failed to start: ${err.message}` }));
        }
        break;
      }

      case 'subscribe': {
        if (!msg.sessionId) {
          ws.send(JSON.stringify({ error: 'sessionId is required' }));
          return;
        }
        if (!(await hasOwnedSession(ws.userId, msg.sessionId))) {
          ws.send(JSON.stringify({ error: 'session not found' }));
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
        if (!(await hasOwnedSession(ws.userId, targetSid))) {
          ws.send(JSON.stringify({ error: 'session not found' }));
          return;
        }
        const resumed = await continueAgent(targetSid, msg.prompt, {
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
        if (sid) {
          if (!(await hasOwnedSession(ws.userId, sid))) {
            ws.send(JSON.stringify({ error: 'session not found' }));
            return;
          }
          const stopped = stopAgent(sid);
          // Immediately notify the frontend so it can transition out of 'running'
          ws.send(JSON.stringify({ type: 'done', content: { status: 'stopped' }, sessionId: sid }));
          if (!stopped) {
            // Agent wasn't active -- still tell the frontend
            ws.send(JSON.stringify({ error: 'session not active' }));
          }
        }
        break;
      }

      case 'unsubscribe': {
        subscriptions.delete(ws);
        ws.send(JSON.stringify({ type: 'unsubscribed' }));
        break;
      }

      case 'subscribe_workflow': {
        const hasExistingRun = await hasOwnedWorkflowRun(ws.userId, msg.runId);
        if (!hasExistingRun) {
          ws.send(JSON.stringify({ error: 'run not found' }));
          return;
        }
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

      case 'subscribe_experiment': {
        // Validate runId ownership -- runId is the authoritative boundary
        if (!msg.runId || !(await getExperimentRunOwned(ws.userId, msg.runId))) {
          ws.send(JSON.stringify({ error: 'experiment run not found' }));
          return;
        }
        if (!experimentSubs.has(ws)) experimentSubs.set(ws, new Set());
        experimentSubs.get(ws).add(msg.runId);
        ws.send(JSON.stringify({ type: 'experiment_subscribed', runId: msg.runId }));
        // Also auto-subscribe to swarm events for the same runId
        // (swarm events re-use the same experimentSubs map)
        break;
      }

      case 'unsubscribe_experiment': {
        if (msg.runId) {
          experimentSubs.get(ws)?.delete(msg.runId);
        } else {
          experimentSubs.delete(ws);
        }
        ws.send(JSON.stringify({ type: 'experiment_unsubscribed' }));
        break;
      }

      default:
        ws.send(JSON.stringify({ error: `unknown action: ${msg.action}` }));
    }
  });

  ws.on('close', () => {
    subscriptions.delete(ws);
    workflowSubs.delete(ws);
    experimentSubs.delete(ws);
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

// Broadcast experiment events to subscribed clients
for (const eventName of [
  'experiment_start',
  'experiment_done',
  'experiment_error',
  'baseline',
  'trial_start',
  'trial_accepted',
  'trial_rejected',
  'trial_error',
  'trial_complete',
  'budget_exhausted',
]) {
  experimentEvents.on(eventName, (data) => {
    const runId = data.runId;
    if (!runId) return;
    const payload = JSON.stringify({
      type: 'experiment',
      subtype: eventName,
      content: data,
      timestamp: Date.now(),
    });
    for (const [ws, runIds] of experimentSubs) {
      if (ws.readyState === 1 && runIds.has(runId)) {
        ws.send(payload);
      }
    }
  });
}

// Broadcast Swarm events to subscribed clients (reuse experimentSubs — same runId)
for (const eventName of [
  'swarm_decompose_start',
  'swarm_hypothesis',
  'swarm_branch_start',
  'swarm_branch_complete',
  'swarm_synthesize_start',
  'swarm_branch_selected',
  'swarm_complete',
  'swarm_error',
]) {
  swarmEvents.on(eventName, (data) => {
    const runId = data.runId;
    if (!runId) return;
    const payload = JSON.stringify({
      type: 'swarm',
      subtype: eventName,
      content: data,
      timestamp: Date.now(),
    });
    for (const [ws, runIds] of experimentSubs) {
      if (ws.readyState === 1 && runIds.has(runId)) {
        ws.send(payload);
      }
    }
  });
}

// Initialise the agentEvents bus reference needed by Coordinator Agent sessions
initSwarmBus(agentEvents);

// --- Start ---

// Recover stale sessions/runs from previous crashes
await recoverStaleSessions();
await recoverStaleRuns();

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

async function shutdown(signal) {
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
  server.close(async () => {
    await closeDb();
    await closeWorkflowDb();
    await closeMemoryDb();
    await closeExperimentDb();
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
