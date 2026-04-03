/**
 * GET /api/experiments list + detail + runs + experiment-status (store mocked).
 */

import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const EXP_ID = '77777777-7777-4777-8777-777777777777';

const { listExperiments, countExperiments, getExperiment, listRuns } = vi.hoisted(() => ({
  listExperiments: vi.fn(),
  countExperiments: vi.fn(),
  getExperiment: vi.fn(),
  listRuns: vi.fn(),
}));

vi.mock('./config.js', () => ({
  default: {
    port: 0,
    workspaceDir: '/tmp/agentboard-exp-list',
    pluginsDir: '/tmp/agentboard-exp-plug',
    agentTimeout: 60000,
    proxy: { url: 'http://localhost:4000' },
    llm: { model: 'test-model', apiKey: '', baseUrl: '' },
    github: { token: '' },
  },
}));

vi.mock('./agentManager.js', () => ({
  startAgent: vi.fn().mockResolvedValue('s'),
  continueAgent: vi.fn().mockResolvedValue(true),
  stopAgent: vi.fn(() => true),
  getActiveAgents: vi.fn(() => []),
  getAgentStream: vi.fn(() => null),
  agentEvents: new EventEmitter(),
  PERMISSION_MODES: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
}));

vi.mock('./sessionStore.js', () => ({
  listSessionsPaged: vi.fn().mockResolvedValue([]),
  countSessions: vi.fn().mockResolvedValue(0),
  getSession: vi.fn().mockResolvedValue(null),
  getEvents: vi.fn().mockResolvedValue([]),
  countEvents: vi.fn().mockResolvedValue(0),
  recoverStaleSessions: vi.fn().mockResolvedValue(0),
  deleteSession: vi.fn().mockResolvedValue(true),
  close: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./mcpHealth.js', () => ({ getMcpHealth: vi.fn(() => ({})) }));

vi.mock('./memoryStore.js', () => ({ closeMemoryDb: vi.fn().mockResolvedValue(undefined) }));

vi.mock('./workflowStore.js', () => ({
  createWorkflow: vi.fn(),
  createWorkflowRun: vi.fn(),
  updateWorkflow: vi.fn(),
  getWorkflow: vi.fn().mockResolvedValue(null),
  listWorkflows: vi.fn().mockResolvedValue([]),
  countWorkflows: vi.fn().mockResolvedValue(0),
  deleteWorkflow: vi.fn(),
  getWorkflowRun: vi.fn().mockResolvedValue(null),
  listWorkflowRuns: vi.fn().mockResolvedValue([]),
  closeWorkflowDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./workflowEngine.js', () => ({
  validateWorkflow: vi.fn(() => ({ valid: true, errors: [] })),
  executeWorkflow: vi.fn().mockResolvedValue(undefined),
  abortWorkflow: vi.fn(() => false),
  getActiveWorkflowRuns: vi.fn(() => []),
  workflowEvents: new EventEmitter(),
}));

vi.mock('./experimentStore.js', () => ({
  createExperiment: vi.fn(),
  getExperiment: (...a) => getExperiment(...a),
  listExperiments: (...a) => listExperiments(...a),
  countExperiments: (...a) => countExperiments(...a),
  updateExperiment: vi.fn(),
  deleteExperiment: vi.fn(),
  createRun: vi.fn(),
  listRuns: (...a) => listRuns(...a),
  listTrials: vi.fn().mockResolvedValue([]),
  getRunOwned: vi.fn().mockResolvedValue(null),
  recoverStaleRuns: vi.fn().mockResolvedValue(0),
  closeExperimentDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./experimentEngine.js', () => ({
  runExperimentLoop: vi.fn().mockResolvedValue(undefined),
  abortExperiment: vi.fn(() => false),
  getActiveExperiments: vi.fn(() => ['run-a', 'run-b']),
  validatePlan: vi.fn(() => ({ valid: true, errors: [] })),
  prepareWorkspace: vi.fn(),
  experimentEvents: new EventEmitter(),
}));

vi.mock('./researchSwarm.js', () => ({
  runResearchSwarm: vi.fn().mockResolvedValue(undefined),
  abortSwarm: vi.fn(() => false),
  isSwarmActive: vi.fn(() => false),
  swarmEvents: new EventEmitter(),
  initSwarmBus: vi.fn(),
}));

vi.mock('./swarmStore.js', () => ({
  listSwarmBranches: vi.fn().mockResolvedValue([]),
  listCoordinatorDecisions: vi.fn().mockResolvedValue([]),
}));

const { app, server } = await import('./server.js');
const { default: request } = await import('supertest');

afterAll(() => {
  server.close();
});

beforeEach(() => {
  listExperiments.mockReset();
  countExperiments.mockReset();
  getExperiment.mockReset();
  listRuns.mockReset();
  listExperiments.mockResolvedValue([{ id: EXP_ID, name: 'Alpha' }]);
  countExperiments.mockResolvedValue(42);
  getExperiment.mockImplementation((userId, id) =>
    Promise.resolve(
      userId === 'default' && id === EXP_ID
        ? { id: EXP_ID, name: 'Alpha', plan: { name: 'p' } }
        : null,
    ),
  );
  listRuns.mockResolvedValue([{ id: 'run-1', status: 'completed' }]);
});

describe('GET /api/experiments', () => {
  it('returns paginated list with default limit 20', async () => {
    const res = await request(app).get('/api/experiments');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(42);
    expect(res.body.limit).toBe(20);
    expect(res.body.offset).toBe(0);
    expect(res.body.experiments).toHaveLength(1);
    expect(listExperiments).toHaveBeenCalledWith('default', 20, 0);
  });

  it('passes limit and offset and caps limit at 100', async () => {
    const res = await request(app).get('/api/experiments?limit=5&offset=12');
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(5);
    expect(res.body.offset).toBe(12);
    expect(listExperiments).toHaveBeenCalledWith('default', 5, 12);

    const capped = await request(app).get('/api/experiments?limit=500');
    expect(capped.status).toBe(200);
    expect(capped.body.limit).toBe(100);
    expect(listExperiments).toHaveBeenCalledWith('default', 100, 0);
  });

  it('treats negative offset as 0', async () => {
    const res = await request(app).get('/api/experiments?offset=-5');
    expect(res.status).toBe(200);
    expect(res.body.offset).toBe(0);
  });
});

describe('GET /api/experiments/:id', () => {
  it('returns experiment when owned', async () => {
    const res = await request(app).get(`/api/experiments/${EXP_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(EXP_ID);
    expect(res.body.plan).toBeDefined();
  });

  it('returns 404 when not found', async () => {
    const res = await request(app).get('/api/experiments/00000000-0000-4000-8000-000000000001');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/experiments/:id/runs', () => {
  it('returns runs with limit/offset defaults', async () => {
    const res = await request(app).get(`/api/experiments/${EXP_ID}/runs`);
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(1);
    expect(listRuns).toHaveBeenCalledWith('default', EXP_ID, 20, 0);
  });
});

describe('GET /api/experiment-status', () => {
  it('returns active experiment runs for current user', async () => {
    const res = await request(app).get('/api/experiment-status');
    expect(res.status).toBe(200);
    expect(res.body.activeRuns).toEqual(['run-a', 'run-b']);
  });
});
