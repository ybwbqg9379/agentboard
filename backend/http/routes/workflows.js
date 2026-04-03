import { Router } from 'express';
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
} from '../../workflowStore.js';
import {
  validateWorkflow,
  executeWorkflow,
  abortWorkflow,
  getActiveWorkflowRuns,
} from '../../workflowEngine.js';
import { workflowSchema, workflowRunRequestSchema, validate } from '../../middleware.js';
import { hasOwnedWorkflowRun } from '../helpers/access.js';

const router = Router();

router.get('/workflows', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const workflows = await listWorkflows(req.user.id, limit, offset);
  const total = await countWorkflows(req.user.id);
  res.json({ workflows, total, limit, offset });
});

router.get('/workflows/:id', async (req, res) => {
  const workflow = await getWorkflow(req.user.id, req.params.id);
  if (!workflow) return res.status(404).json({ error: 'workflow not found' });
  res.json(workflow);
});

router.post('/workflows', validate(workflowSchema), async (req, res) => {
  const { name, description, definition } = req.body;
  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid workflow', details: validation.errors });
  }
  const id = await createWorkflow(req.user.id, name, description, definition);
  res.status(201).json({ id });
});

router.put('/workflows/:id', validate(workflowSchema), async (req, res) => {
  const { name, description, definition } = req.body;
  const validation = validateWorkflow(definition);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid workflow', details: validation.errors });
  }
  const updated = await updateWorkflow(req.user.id, req.params.id, name, description, definition);
  if (!updated) return res.status(404).json({ error: 'workflow not found' });
  res.json({ updated: true });
});

router.delete('/workflows/:id', async (req, res) => {
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

router.post('/workflows/batch-delete', async (req, res) => {
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

router.post('/workflows/:id/run', validate(workflowRunRequestSchema), async (req, res) => {
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

router.post('/workflow-runs/:id/abort', async (req, res) => {
  if (!(await hasOwnedWorkflowRun(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const aborted = abortWorkflow(req.params.id);
  if (!aborted) return res.status(404).json({ error: 'run not found or not active' });
  res.json({ aborted: true });
});

router.get('/workflows/:id/runs', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const runs = await listWorkflowRuns(req.user.id, req.params.id, limit, offset);
  res.json({ runs });
});

router.get('/workflow-runs/:id', async (req, res) => {
  const run = await getWorkflowRun(req.user.id, req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json(run);
});

router.get('/workflow-status', (_req, res) => {
  res.json({ activeRuns: getActiveWorkflowRuns(_req.user.id) });
});

export default router;
