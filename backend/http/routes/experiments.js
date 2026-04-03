import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../../config.js';
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
} from '../../experimentStore.js';
import {
  runExperimentLoop,
  abortExperiment,
  getActiveExperiments,
  validatePlan,
  prepareWorkspace,
} from '../../experimentEngine.js';
import { runResearchSwarm, abortSwarm, isSwarmActive } from '../../researchSwarm.js';
import { listSwarmBranches, listCoordinatorDecisions } from '../../swarmStore.js';
import { experimentSchema, experimentRunSchema, validate } from '../../middleware.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = resolve(__dirname, '../../templates');

const router = Router();

router.get('/experiment-templates', (_req, res) => {
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

router.get('/experiment-templates/:filename', (req, res) => {
  const filename = req.params.filename;
  if (!/^[a-z0-9-]+\.json$/.test(filename)) {
    return res.status(400).json({ error: 'Invalid template name' });
  }
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

router.get('/experiments', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const experiments = await listExperiments(req.user.id, limit, offset);
  const total = await countExperiments(req.user.id);
  res.json({ experiments, total, limit, offset });
});

router.get('/experiments/:id', async (req, res) => {
  const experiment = await getExperiment(req.user.id, req.params.id);
  if (!experiment) return res.status(404).json({ error: 'experiment not found' });
  res.json(experiment);
});

router.post('/experiments', validate(experimentSchema), async (req, res) => {
  const { name, description, plan } = req.body;
  const validation = validatePlan(plan);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid experiment plan', details: validation.errors });
  }
  const id = await createExperiment(req.user.id, name, description, plan);
  res.status(201).json({ id });
});

router.put('/experiments/:id', validate(experimentSchema), async (req, res) => {
  const { name, description, plan } = req.body;
  const validation = validatePlan(plan);
  if (!validation.valid) {
    return res.status(400).json({ error: 'invalid experiment plan', details: validation.errors });
  }
  const updated = await updateExperiment(req.user.id, req.params.id, name, description, plan);
  if (!updated) return res.status(404).json({ error: 'experiment not found' });
  res.json({ updated: true });
});

router.delete('/experiments/:id', async (req, res) => {
  const deleted = await deleteExperiment(req.user.id, req.params.id);
  if (!deleted) return res.status(404).json({ error: 'experiment not found' });
  res.json({ deleted: true });
});

router.post('/experiments/:id/run', validate(experimentRunSchema), async (req, res) => {
  const experiment = await getExperiment(req.user.id, req.params.id);
  if (!experiment) return res.status(404).json({ error: 'experiment not found' });

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

router.get('/experiment-runs/:id', async (req, res) => {
  const run = await getExperimentRunOwned(req.user.id, req.params.id);
  if (!run) return res.status(404).json({ error: 'run not found' });
  res.json(run);
});

router.post('/experiment-runs/:id/abort', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const aborted = abortExperiment(req.params.id);
  if (!aborted) return res.status(404).json({ error: 'run not found or not active' });
  res.json({ aborted: true });
});

router.get('/experiments/:id/runs', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const runs = await listExperimentRuns(req.user.id, req.params.id, limit, offset);
  res.json({ runs });
});

router.get('/experiment-runs/:id/trials', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset) || 0, 0);
  const trials = await listTrials(req.params.id, limit, offset);
  res.json({ trials });
});

router.get('/experiment-status', (_req, res) => {
  res.json({ activeRuns: getActiveExperiments(_req.user.id) });
});

router.post('/experiments/:id/swarm', async (req, res) => {
  const experiment = await getExperiment(req.user.id, req.params.id);
  if (!experiment) return res.status(404).json({ error: 'experiment not found' });

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

  const branches = Math.min(Math.max(parseInt(plan.swarm.branches) || 3, 1), 8);
  plan.swarm.branches = branches;

  const workspaceDir = resolve(
    config.workspaceDir,
    req.user.id || 'default',
    'sessions',
    `swarm-${req.params.id}-${Date.now()}`,
  );

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

router.get('/experiment-runs/:id/branches', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const branches = await listSwarmBranches(req.params.id);
  res.json({ branches });
});

router.get('/experiment-runs/:id/coordinator-decisions', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const decisions = await listCoordinatorDecisions(req.params.id);
  res.json({ decisions });
});

router.post('/experiment-runs/:id/abort-swarm', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  const aborted = abortSwarm(req.params.id);
  if (!aborted) return res.status(409).json({ error: 'swarm not active' });
  res.json({ aborted: true });
});

router.get('/experiment-runs/:id/swarm-status', async (req, res) => {
  if (!(await getExperimentRunOwned(req.user.id, req.params.id))) {
    return res.status(404).json({ error: 'run not found' });
  }
  res.json({ active: isSwarmActive(req.params.id) });
});

export default router;
