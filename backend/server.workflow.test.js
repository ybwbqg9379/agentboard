/**
 * REST coverage for workflow CRUD, run, abort, status (store/engine mocked).
 */

import { describe, it, expect, vi, afterAll } from 'vitest';
import { EventEmitter } from 'node:events';

const WF_ID = '33333333-3333-4333-8333-333333333333';
const RUN_ID = '44444444-4444-4444-8444-444444444444';

const minDefinition = {
  nodes: [
    { id: 'in', type: 'input', label: 'Start', config: {} },
    { id: 'ag', type: 'agent', label: 'A', config: { prompt: 'do work' } },
    { id: 'out', type: 'output', label: 'End', config: {} },
  ],
  edges: [
    { from: 'in', to: 'ag' },
    { from: 'ag', to: 'out' },
  ],
};

vi.mock('./config.js', () => ({
  default: {
    port: 0,
    workspaceDir: '/tmp/agentboard-wf-test',
    pluginsDir: '/tmp/agentboard-wf-plugins',
    agentTimeout: 60000,
    proxy: { url: 'http://localhost:4000' },
    llm: { model: 'test-model', apiKey: '', baseUrl: '' },
    github: { token: '' },
  },
}));

vi.mock('./agentManager.js', () => ({
  startAgent: vi.fn().mockResolvedValue('mock-session'),
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

vi.mock('./mcpHealth.js', () => ({
  getMcpHealth: vi.fn(() => ({})),
  initMcpHealth: vi.fn(),
  recordToolCall: vi.fn(),
}));

vi.mock('./memoryStore.js', () => ({
  closeMemoryDb: vi.fn().mockResolvedValue(undefined),
}));

const mockValidateWorkflow = vi.fn(() => ({ valid: true, errors: [] }));

vi.mock('./workflowEngine.js', () => ({
  validateWorkflow: (...args) => mockValidateWorkflow(...args),
  executeWorkflow: vi.fn().mockResolvedValue(undefined),
  abortWorkflow: vi.fn(() => true),
  getActiveWorkflowRuns: vi.fn(() => [RUN_ID]),
  workflowEvents: new EventEmitter(),
}));

vi.mock('./workflowStore.js', () => ({
  createWorkflow: vi.fn().mockResolvedValue(WF_ID),
  createWorkflowRun: vi.fn().mockResolvedValue(RUN_ID),
  updateWorkflow: vi.fn().mockResolvedValue(true),
  getWorkflow: vi.fn((userId, id) =>
    Promise.resolve(
      userId === 'default' && id === WF_ID
        ? { id: WF_ID, name: 'Test WF', description: 'd', definition: minDefinition }
        : null,
    ),
  ),
  listWorkflows: vi.fn().mockResolvedValue([{ id: WF_ID, name: 'Test WF' }]),
  countWorkflows: vi.fn().mockResolvedValue(1),
  deleteWorkflow: vi.fn().mockResolvedValue(true),
  getWorkflowRun: vi.fn((userId, runId) =>
    Promise.resolve(
      userId === 'default' && runId === RUN_ID ? { id: RUN_ID, workflow_id: WF_ID } : null,
    ),
  ),
  listWorkflowRuns: vi.fn().mockResolvedValue([{ id: RUN_ID, status: 'completed' }]),
  closeWorkflowDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./experimentStore.js', () => ({
  createExperiment: vi.fn().mockResolvedValue(undefined),
  getExperiment: vi.fn().mockResolvedValue(null),
  listExperiments: vi.fn().mockResolvedValue([]),
  countExperiments: vi.fn().mockResolvedValue(0),
  updateExperiment: vi.fn().mockResolvedValue(true),
  deleteExperiment: vi.fn().mockResolvedValue(true),
  createRun: vi.fn().mockResolvedValue('run'),
  listRuns: vi.fn().mockResolvedValue([]),
  listTrials: vi.fn().mockResolvedValue([]),
  getRunOwned: vi.fn().mockResolvedValue(null),
  recoverStaleRuns: vi.fn().mockResolvedValue(0),
  closeExperimentDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./experimentEngine.js', () => ({
  runExperimentLoop: vi.fn().mockResolvedValue(undefined),
  abortExperiment: vi.fn(() => true),
  getActiveExperiments: vi.fn(() => []),
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

describe('Workflow REST API', () => {
  it('GET /api/workflows lists workflows', async () => {
    const res = await request(app).get('/api/workflows');
    expect(res.status).toBe(200);
    expect(res.body.workflows).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('GET /api/workflows/:id returns 404 when not found', async () => {
    const res = await request(app).get('/api/workflows/not-a-uuid');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('workflow not found');
  });

  it('GET /api/workflows/:id returns workflow when owned', async () => {
    const res = await request(app).get(`/api/workflows/${WF_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(WF_ID);
    expect(res.body.definition.nodes).toHaveLength(3);
  });

  it('POST /api/workflows creates workflow when validation passes', async () => {
    const res = await request(app)
      .post('/api/workflows')
      .send({ name: 'New', description: 'x', definition: minDefinition });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(WF_ID);
  });

  it('POST /api/workflows returns 400 when validateWorkflow fails', async () => {
    mockValidateWorkflow.mockReturnValueOnce({ valid: false, errors: ['cycle detected'] });
    const res = await request(app)
      .post('/api/workflows')
      .send({ name: 'Bad', definition: minDefinition });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid workflow');
    expect(res.body.details).toContain('cycle detected');
  });

  it('POST /api/workflows returns 400 on schema validation', async () => {
    const res = await request(app).post('/api/workflows').send({ name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation failed');
  });

  it('PUT /api/workflows/:id updates', async () => {
    const res = await request(app)
      .put(`/api/workflows/${WF_ID}`)
      .send({ name: 'U', definition: minDefinition });
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(true);
  });

  it('DELETE /api/workflows/:id deletes', async () => {
    const res = await request(app).delete(`/api/workflows/${WF_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it('POST /api/workflows/:id/run returns 202 with runId', async () => {
    const { executeWorkflow } = await import('./workflowEngine.js');
    const res = await request(app)
      .post(`/api/workflows/${WF_ID}/run`)
      .send({ context: { k: 'v' } });
    expect(res.status).toBe(202);
    expect(res.body.runId).toBe(RUN_ID);
    expect(res.body.message).toBe('workflow started');
    expect(executeWorkflow).toHaveBeenCalled();
  });

  it('POST /api/workflows/:id/run returns 404 when workflow missing', async () => {
    const res = await request(app).post('/api/workflows/missing-id/run').send({});
    expect(res.status).toBe(404);
  });

  it('GET /api/workflow-status returns active runs', async () => {
    const res = await request(app).get('/api/workflow-status');
    expect(res.status).toBe(200);
    expect(res.body.activeRuns).toEqual([RUN_ID]);
  });

  it('POST /api/workflow-runs/:id/abort aborts owned run', async () => {
    const res = await request(app).post(`/api/workflow-runs/${RUN_ID}/abort`);
    expect(res.status).toBe(200);
    expect(res.body.aborted).toBe(true);
  });

  it('POST /api/workflow-runs/:id/abort returns 404 when run not owned', async () => {
    const res = await request(app)
      .post(`/api/workflow-runs/${RUN_ID}/abort`)
      .set('x-user-id', 'other-tenant');
    expect(res.status).toBe(404);
  });

  it('GET /api/workflows/:id/runs lists runs', async () => {
    const res = await request(app).get(`/api/workflows/${WF_ID}/runs?limit=10&offset=0`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.runs)).toBe(true);
    expect(res.body.runs[0].id).toBe(RUN_ID);
  });

  it('GET /api/workflow-runs/:id returns run', async () => {
    const res = await request(app).get(`/api/workflow-runs/${RUN_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(RUN_ID);
  });

  it('GET /api/workflow-runs/:id returns 404 for unknown run', async () => {
    const res = await request(app).get('/api/workflow-runs/00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
