import { afterAll, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const ownedRunId = '11111111-1111-4111-8111-111111111111';
const foreignRunId = '22222222-2222-4222-8222-222222222222';
const ownedExperimentId = '33333333-3333-4333-8333-333333333333';

vi.mock('./config.js', () => ({
  default: {
    port: 0,
    workspaceDir: '/tmp/agentboard-test',
    pluginsDir: '/tmp/agentboard-test-plugins',
    dbPath: ':memory:',
    agentTimeout: 60000,
    proxy: { url: 'http://localhost:4000' },
    llm: { model: 'test-model', apiKey: '', baseUrl: '' },
    github: { token: '' },
  },
}));

const agentEvents = new EventEmitter();
const workflowEvents = new EventEmitter();
const experimentEvents = new EventEmitter();

vi.mock('./agentManager.js', () => ({
  startAgent: vi.fn(() => 'mock-session-id'),
  continueAgent: vi.fn(() => true),
  stopAgent: vi.fn(() => true),
  getActiveAgents: vi.fn(() => []),
  getAgentStream: vi.fn(() => null),
  agentEvents,
  PERMISSION_MODES: ['bypassPermissions', 'default', 'acceptEdits', 'plan'],
}));

vi.mock('./sessionStore.js', () => ({
  listSessionsPaged: vi.fn(() => []),
  countSessions: vi.fn(() => 0),
  getSession: vi.fn(() => null),
  getEvents: vi.fn(() => []),
  countEvents: vi.fn(() => 0),
  recoverStaleSessions: vi.fn(() => 0),
  deleteSession: vi.fn(() => true),
  close: vi.fn(),
}));

vi.mock('./mcpHealth.js', () => ({
  getMcpHealth: vi.fn(() => ({})),
}));

vi.mock('./memoryStore.js', () => ({
  closeMemoryDb: vi.fn(),
}));

vi.mock('./workflowStore.js', () => ({
  createWorkflow: vi.fn(),
  createWorkflowRun: vi.fn(),
  updateWorkflow: vi.fn(),
  getWorkflow: vi.fn(() => null),
  listWorkflows: vi.fn(() => []),
  countWorkflows: vi.fn(() => 0),
  deleteWorkflow: vi.fn(() => true),
  getWorkflowRun: vi.fn(() => null),
  listWorkflowRuns: vi.fn(() => []),
  closeWorkflowDb: vi.fn(),
}));

vi.mock('./workflowEngine.js', () => ({
  validateWorkflow: vi.fn(() => ({ valid: true, errors: [] })),
  executeWorkflow: vi.fn(),
  abortWorkflow: vi.fn(() => true),
  getActiveWorkflowRuns: vi.fn(() => []),
  workflowEvents,
}));

vi.mock('./experimentStore.js', () => ({
  createExperiment: vi.fn(),
  getExperiment: vi.fn((userId, id) =>
    userId === 'default' && id === ownedExperimentId ? { id, user_id: userId } : null,
  ),
  listExperiments: vi.fn(() => []),
  countExperiments: vi.fn(() => 0),
  updateExperiment: vi.fn(() => true),
  deleteExperiment: vi.fn(() => true),
  createRun: vi.fn(() => ownedRunId),
  listRuns: vi.fn(() => []),
  listTrials: vi.fn(() => []),
  getRunOwned: vi.fn((userId, runId) =>
    userId === 'default' && runId === ownedRunId
      ? { id: runId, user_id: userId, status: 'aborted' }
      : null,
  ),
  recoverStaleRuns: vi.fn(() => 0),
  closeExperimentDb: vi.fn(),
  experimentDb: {},
}));

vi.mock('./experimentEngine.js', () => ({
  runExperimentLoop: vi.fn(),
  abortExperiment: vi.fn(() => true),
  getActiveExperiments: vi.fn(() => []),
  validatePlan: vi.fn(() => ({ valid: true, errors: [] })),
  prepareWorkspace: vi.fn(),
  experimentEvents,
}));

// P3: Mock swarm modules to prevent DB table creation issues in test environment
vi.mock('./researchSwarm.js', () => ({
  runResearchSwarm: vi.fn(),
  abortSwarm: vi.fn(() => false),
  isSwarmActive: vi.fn(() => false),
  swarmEvents: new EventEmitter(),
  initSwarmBus: vi.fn(),
}));

vi.mock('./swarmStore.js', () => ({
  listSwarmBranches: vi.fn(() => []),
  listCoordinatorDecisions: vi.fn(() => []),
}));

const { app, server } = await import('./server.js');
const { default: request } = await import('supertest');
const { WebSocket: WSClient } = await import('ws');

afterAll(() => {
  server.close();
});

describe('experiment server routes', () => {
  it('returns the owned experiment run via GET /api/experiment-runs/:id', async () => {
    const res = await request(app).get(`/api/experiment-runs/${ownedRunId}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: ownedRunId, status: 'aborted' });
  });

  it('rejects subscribe_experiment when runId is not owned even if experimentId is owned', async () => {
    const port = server.address().port;
    const ws = new WSClient(`ws://127.0.0.1:${port}/ws`, {
      headers: { Origin: 'http://localhost:5173' },
    });

    await new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    });

    const messagePromise = new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => reject(new Error('subscribe_experiment timeout')), 1000);
      ws.once('message', (data) => {
        clearTimeout(timeoutId);
        resolve(JSON.parse(data.toString()));
      });
      ws.once('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });
    });

    ws.send(
      JSON.stringify({
        action: 'subscribe_experiment',
        runId: foreignRunId,
        experimentId: ownedExperimentId,
      }),
    );

    await expect(messagePromise).resolves.toEqual({ error: 'experiment run not found' });
    ws.close();
  });
});
