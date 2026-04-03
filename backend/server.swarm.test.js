/**
 * Research Swarm HTTP routes (experiment store + swarm engine mocked).
 */

import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const EXP_ID = '55555555-5555-4555-8555-555555555555';
const SWARM_RUN_ID = '66666666-6666-4666-8666-666666666666';

const mockPrepareWorkspace = vi.fn();
const mockAbortSwarm = vi.fn(() => true);
const mockIsSwarmActive = vi.fn(() => false);

vi.mock('./config.js', () => ({
  default: {
    port: 0,
    workspaceDir: '/tmp/agentboard-swarm-test',
    pluginsDir: '/tmp/agentboard-swarm-plugins',
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
  getExperiment: vi.fn((userId, id) =>
    Promise.resolve(
      userId === 'default' && id === EXP_ID
        ? {
            id: EXP_ID,
            plan: {
              name: 'swarm-plan',
              swarm: { branches: 10 },
            },
          }
        : null,
    ),
  ),
  listExperiments: vi.fn().mockResolvedValue([]),
  countExperiments: vi.fn().mockResolvedValue(0),
  updateExperiment: vi.fn(),
  deleteExperiment: vi.fn(),
  createRun: vi.fn().mockResolvedValue(SWARM_RUN_ID),
  listRuns: vi.fn().mockResolvedValue([]),
  listTrials: vi.fn().mockResolvedValue([]),
  getRunOwned: vi.fn((userId, runId) =>
    Promise.resolve(
      userId === 'default' && runId === SWARM_RUN_ID
        ? { id: runId, user_id: userId, status: 'running' }
        : null,
    ),
  ),
  recoverStaleRuns: vi.fn().mockResolvedValue(0),
  closeExperimentDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./experimentEngine.js', () => ({
  runExperimentLoop: vi.fn().mockResolvedValue(undefined),
  abortExperiment: vi.fn(() => false),
  getActiveExperiments: vi.fn(() => []),
  validatePlan: vi.fn(() => ({ valid: true, errors: [] })),
  prepareWorkspace: (...args) => mockPrepareWorkspace(...args),
  experimentEvents: new EventEmitter(),
}));

vi.mock('./researchSwarm.js', () => ({
  runResearchSwarm: vi.fn().mockResolvedValue(undefined),
  abortSwarm: (...args) => mockAbortSwarm(...args),
  isSwarmActive: (...args) => mockIsSwarmActive(...args),
  swarmEvents: new EventEmitter(),
  initSwarmBus: vi.fn(),
}));

vi.mock('./swarmStore.js', () => ({
  listSwarmBranches: vi.fn().mockResolvedValue([{ id: 'branch-1', title: 'main' }]),
  listCoordinatorDecisions: vi.fn().mockResolvedValue([{ t: 'coord' }]),
}));

const { app, server } = await import('./server.js');
const { default: request } = await import('supertest');

afterAll(() => {
  server.close();
});

beforeEach(() => {
  mockPrepareWorkspace.mockReset();
  mockPrepareWorkspace.mockImplementation(() => {});
  mockAbortSwarm.mockReset();
  mockAbortSwarm.mockReturnValue(true);
  mockIsSwarmActive.mockReset();
  mockIsSwarmActive.mockReturnValue(false);
});

describe('Swarm REST API', () => {
  it('POST /api/experiments/:id/swarm returns 404 when experiment missing', async () => {
    const res = await request(app).post(
      '/api/experiments/00000000-0000-4000-8000-000000000000/swarm',
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('experiment not found');
  });

  it('POST /api/experiments/:id/swarm returns 202 and clamps branches to 8', async () => {
    const { runResearchSwarm } = await import('./researchSwarm.js');
    const res = await request(app).post(`/api/experiments/${EXP_ID}/swarm`).send({});
    expect(res.status).toBe(202);
    expect(res.body.branches).toBe(8);
    expect(res.body.runId).toBe(SWARM_RUN_ID);
    expect(mockPrepareWorkspace).toHaveBeenCalled();
    expect(runResearchSwarm).toHaveBeenCalled();
  });

  it('POST swarm merges body.swarm and clamps negative branch count to 1', async () => {
    const res = await request(app)
      .post(`/api/experiments/${EXP_ID}/swarm`)
      .send({ swarm: { branches: -3 } });
    expect(res.status).toBe(202);
    expect(res.body.branches).toBe(1);
  });

  it('POST swarm returns 500 when prepareWorkspace throws', async () => {
    mockPrepareWorkspace.mockImplementationOnce(() => {
      throw new Error('no space left');
    });
    const res = await request(app).post(`/api/experiments/${EXP_ID}/swarm`).send({});
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/workspace setup failed: no space left/);
  });

  it('GET /api/experiment-runs/:id/branches requires ownership', async () => {
    const ok = await request(app).get(`/api/experiment-runs/${SWARM_RUN_ID}/branches`);
    expect(ok.status).toBe(200);
    expect(ok.body.branches).toHaveLength(1);
    expect(ok.body.branches[0].id).toBe('branch-1');

    const denied = await request(app)
      .get(`/api/experiment-runs/${SWARM_RUN_ID}/branches`)
      .set('x-user-id', 'other-user');
    expect(denied.status).toBe(404);
  });

  it('GET /api/experiment-runs/:id/coordinator-decisions returns decisions', async () => {
    const res = await request(app).get(
      `/api/experiment-runs/${SWARM_RUN_ID}/coordinator-decisions`,
    );
    expect(res.status).toBe(200);
    expect(res.body.decisions).toEqual([{ t: 'coord' }]);
  });

  it('POST abort-swarm returns 409 when swarm not active', async () => {
    mockAbortSwarm.mockReturnValueOnce(false);
    const res = await request(app).post(`/api/experiment-runs/${SWARM_RUN_ID}/abort-swarm`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('swarm not active');
  });

  it('POST abort-swarm returns 200 when abort succeeds', async () => {
    mockAbortSwarm.mockReturnValueOnce(true);
    const res = await request(app).post(`/api/experiment-runs/${SWARM_RUN_ID}/abort-swarm`);
    expect(res.status).toBe(200);
    expect(res.body.aborted).toBe(true);
  });

  it('GET swarm-status reflects isSwarmActive', async () => {
    mockIsSwarmActive.mockReturnValueOnce(true);
    const res = await request(app).get(`/api/experiment-runs/${SWARM_RUN_ID}/swarm-status`);
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(true);
  });
});
