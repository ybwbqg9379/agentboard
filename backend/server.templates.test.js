/**
 * Experiment template static file routes (real templates/ on disk).
 */

import { describe, it, expect, afterAll, vi } from 'vitest';

vi.mock('./config.js', () => ({
  default: {
    port: 0,
    workspaceDir: '/tmp/agentboard-tpl-test',
    pluginsDir: '/tmp/agentboard-tpl-plugins',
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
  agentEvents: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), setMaxListeners: vi.fn() },
  PERMISSION_MODES: [],
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
  workflowEvents: { on: vi.fn(), emit: vi.fn() },
}));

vi.mock('./experimentStore.js', () => ({
  createExperiment: vi.fn(),
  getExperiment: vi.fn().mockResolvedValue(null),
  listExperiments: vi.fn().mockResolvedValue([]),
  countExperiments: vi.fn().mockResolvedValue(0),
  updateExperiment: vi.fn(),
  deleteExperiment: vi.fn(),
  createRun: vi.fn(),
  listRuns: vi.fn().mockResolvedValue([]),
  listTrials: vi.fn().mockResolvedValue([]),
  getRunOwned: vi.fn().mockResolvedValue(null),
  recoverStaleRuns: vi.fn().mockResolvedValue(0),
  closeExperimentDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./experimentEngine.js', () => ({
  runExperimentLoop: vi.fn().mockResolvedValue(undefined),
  abortExperiment: vi.fn(() => false),
  getActiveExperiments: vi.fn(() => []),
  validatePlan: vi.fn(() => ({ valid: true, errors: [] })),
  prepareWorkspace: vi.fn(),
  experimentEvents: { on: vi.fn() },
}));

vi.mock('./researchSwarm.js', () => ({
  runResearchSwarm: vi.fn().mockResolvedValue(undefined),
  abortSwarm: vi.fn(() => false),
  isSwarmActive: vi.fn(() => false),
  swarmEvents: { on: vi.fn() },
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

describe('Experiment template routes', () => {
  it('GET /api/experiment-templates returns catalog', async () => {
    const res = await request(app).get('/api/experiment-templates');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.templates)).toBe(true);
    const keys = res.body.templates.map((t) => t.key);
    expect(keys).toContain('ml-training');
    expect(keys).toContain('bundle-size');
  });

  it('GET /api/experiment-templates/:filename rejects invalid names and 404 for missing file', async () => {
    expect((await request(app).get('/api/experiment-templates/evil.JSON')).status).toBe(400);
    expect((await request(app).get('/api/experiment-templates/bad_underscore.json')).status).toBe(
      400,
    );
    expect((await request(app).get('/api/experiment-templates/not-exists-abc.json')).status).toBe(
      404,
    );
  });

  it('GET /api/experiment-templates/ml-training.json returns JSON plan shape', async () => {
    const res = await request(app).get('/api/experiment-templates/ml-training.json');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('name');
  });
});
