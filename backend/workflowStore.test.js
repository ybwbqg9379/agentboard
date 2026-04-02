/**
 * Unit tests for Supabase-based workflow store.
 *
 * Mocks the Supabase client to avoid real network calls.
 * All store functions are async -- every call uses await.
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

let mockFromHandler;

vi.mock('./supabaseClient.js', () => {
  const createChainable = (resolvedValue = { data: null, error: null }) => {
    const target = {};

    const proxy = new Proxy(target, {
      get(t, prop) {
        if (prop === 'then') {
          return (cb) => Promise.resolve(resolvedValue).then(cb);
        }
        if (prop === 'single' || prop === 'maybeSingle') {
          return t[prop] || (() => Promise.resolve(resolvedValue));
        }
        if (t[prop]) return t[prop];
        return () => proxy;
      },
      set(t, prop, value) {
        t[prop] = value;
        return true;
      },
    });

    const methods = [
      'select',
      'insert',
      'update',
      'delete',
      'upsert',
      'eq',
      'order',
      'limit',
      'range',
    ];
    for (const m of methods) {
      target[m] = vi.fn().mockReturnValue(proxy);
    }
    target.single = vi.fn().mockResolvedValue(resolvedValue);
    target.maybeSingle = vi.fn().mockResolvedValue(resolvedValue);

    return proxy;
  };

  return {
    default: {
      from: vi.fn((...args) => {
        if (mockFromHandler) return mockFromHandler(...args);
        return createChainable({ data: [], error: null });
      }),
      _createChainable: createChainable,
    },
  };
});

const supabase = (await import('./supabaseClient.js')).default;
const createChainable = supabase._createChainable;

const {
  createWorkflow,
  updateWorkflow,
  getWorkflow,
  listWorkflows,
  countWorkflows,
  deleteWorkflow,
  createWorkflowRun,
  updateWorkflowRun,
  completeWorkflowRun,
  getWorkflowRun,
  listWorkflowRuns,
  closeWorkflowDb,
} = await import('./workflowStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockFromHandler = undefined;
});

// ---------------------------------------------------------------------------
// Workflow CRUD
// ---------------------------------------------------------------------------

describe('Workflow CRUD', () => {
  const definition = {
    nodes: [
      { id: 'in', type: 'input', label: 'Start' },
      { id: 'out', type: 'output', label: 'End' },
    ],
    edges: [{ from: 'in', to: 'out' }],
  };

  it('creates a workflow and returns a UUID', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    const wfId = await createWorkflow('test-user', 'Test WF', 'A test workflow', definition);
    expect(wfId).toBeDefined();
    expect(typeof wfId).toBe('string');
    expect(wfId.length).toBe(36);
  });

  it('inserts with correct fields', async () => {
    let capturedRow;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        capturedRow = row;
        return chain;
      });
      return chain;
    };

    await createWorkflow('test-user', 'Test WF', 'A test workflow', definition);
    expect(capturedRow.user_id).toBe('test-user');
    expect(capturedRow.name).toBe('Test WF');
    expect(capturedRow.description).toBe('A test workflow');
    // JSONB: definition is stored as native object
    expect(capturedRow.definition).toEqual(definition);
  });

  it('retrieves a workflow by ID with native definition (JSONB)', async () => {
    const fakeWf = {
      id: 'wf-1',
      user_id: 'test-user',
      name: 'Test WF',
      description: 'A test workflow',
      definition,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    };
    mockFromHandler = () => createChainable({ data: fakeWf, error: null });

    const wf = await getWorkflow('test-user', 'wf-1');
    expect(wf).not.toBeNull();
    expect(wf.name).toBe('Test WF');
    expect(wf.description).toBe('A test workflow');
    expect(wf.definition).toEqual(definition);
  });

  it('returns null for non-existent workflow', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    const wf = await getWorkflow('test-user', '00000000-0000-0000-0000-000000000000');
    expect(wf).toBeNull();
  });

  it('lists workflows with pagination using .range()', async () => {
    const fakeList = [
      { id: 'wf-1', name: 'WF1', definition, updated_at: '2025-01-02' },
      { id: 'wf-2', name: 'WF2', definition, updated_at: '2025-01-01' },
    ];
    let capturedRange;
    mockFromHandler = () => {
      const chain = createChainable({ data: fakeList, error: null });
      chain.range = vi.fn((start, end) => {
        capturedRange = { start, end };
        return chain;
      });
      return chain;
    };

    const list = await listWorkflows('test-user', 10, 0);
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBe(2);
    expect(list[0].definition).toBeDefined();
    expect(capturedRange).toEqual({ start: 0, end: 9 }); // range(0, 0+10-1)
  });

  it('counts workflows', async () => {
    mockFromHandler = () => createChainable({ count: 3, error: null });
    const count = await countWorkflows('test-user');
    expect(count).toBe(3);
  });

  it('updates a workflow and returns true when rows matched', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: [{ id: 'wf-1' }], error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    const newDef = {
      ...definition,
      nodes: [...definition.nodes, { id: 'mid', type: 'agent', config: { prompt: 'hello' } }],
    };
    const updated = await updateWorkflow('test-user', 'wf-1', 'Updated WF', 'Updated desc', newDef);
    expect(updated).toBe(true);
    expect(capturedUpdate.name).toBe('Updated WF');
    expect(capturedUpdate.definition.nodes).toHaveLength(3);
  });

  it('returns false when updating non-existent workflow', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });
    const result = await updateWorkflow(
      'test-user',
      '00000000-0000-0000-0000-000000000000',
      'x',
      '',
      definition,
    );
    expect(result).toBe(false);
  });

  it('deletes a workflow and returns true', async () => {
    mockFromHandler = () => createChainable({ data: [{ id: 'wf-del' }], error: null });
    const result = await deleteWorkflow('test-user', 'wf-del');
    expect(result).toBe(true);
  });

  it('returns false when deleting non-existent workflow', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });
    const result = await deleteWorkflow('test-user', '00000000-0000-0000-0000-000000000000');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Workflow Runs
// ---------------------------------------------------------------------------

describe('Workflow Runs', () => {
  it('creates a run and returns an ID', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    const runId = await createWorkflowRun('test-user', 'wf-1', { input: 'hello' });
    expect(runId).toBeDefined();
    expect(typeof runId).toBe('string');
    expect(runId.length).toBe(36);
  });

  it('inserts a run with correct fields', async () => {
    let capturedRow;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        capturedRow = row;
        return chain;
      });
      return chain;
    };

    await createWorkflowRun('test-user', 'wf-1', { input: 'hello' });
    expect(capturedRow.user_id).toBe('test-user');
    expect(capturedRow.workflow_id).toBe('wf-1');
    expect(capturedRow.status).toBe('pending');
    // JSONB: context is native object
    expect(capturedRow.context).toEqual({ input: 'hello' });
  });

  it('supports creating a run with a caller-provided runId', async () => {
    const customRunId = randomUUID();
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        expect(row.id).toBe(customRunId);
        return chain;
      });
      return chain;
    };

    const createdRunId = await createWorkflowRun(
      'test-user',
      'wf-1',
      { input: 'custom' },
      customRunId,
    );
    expect(createdRunId).toBe(customRunId);
  });

  it('retrieves a run with JSONB fields as native objects', async () => {
    const fakeRun = {
      id: 'run-1',
      user_id: 'test-user',
      workflow_id: 'wf-1',
      status: 'pending',
      context: { input: 'hello' },
      node_results: {},
      created_at: '2025-01-01T00:00:00Z',
      completed_at: null,
    };
    mockFromHandler = () => createChainable({ data: fakeRun, error: null });

    const run = await getWorkflowRun('test-user', 'run-1');
    expect(run).not.toBeNull();
    expect(run.workflow_id).toBe('wf-1');
    expect(run.status).toBe('pending');
    expect(run.context).toEqual({ input: 'hello' });
    expect(run.node_results).toEqual({});
  });

  it('updates a run', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateWorkflowRun('run-1', {
      status: 'running',
      context: { input: 'hello', step: 1 },
      nodeResults: { in: { done: true } },
    });
    expect(capturedUpdate.status).toBe('running');
    expect(capturedUpdate.context).toEqual({ input: 'hello', step: 1 });
    expect(capturedUpdate.node_results).toEqual({ in: { done: true } });
  });

  it('completes a run with completed_at timestamp', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await completeWorkflowRun('run-1', {
      status: 'completed',
      nodeResults: { in: { done: true }, out: { done: true } },
    });
    expect(capturedUpdate.status).toBe('completed');
    expect(capturedUpdate.completed_at).toBeDefined();
    expect(capturedUpdate.node_results).toEqual({ in: { done: true }, out: { done: true } });
  });

  it('lists runs for a workflow', async () => {
    const fakeRuns = [
      { id: 'run-1', workflow_id: 'wf-1', context: { input: 'hello' }, status: 'completed' },
    ];
    mockFromHandler = () => createChainable({ data: fakeRuns, error: null });

    const runs = await listWorkflowRuns('test-user', 'wf-1', 10, 0);
    expect(Array.isArray(runs)).toBe(true);
    expect(runs.length).toBe(1);
    expect(runs[0].context).toBeDefined();
  });

  it('returns null for non-existent run', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    const run = await getWorkflowRun('test-user', '00000000-0000-0000-0000-000000000000');
    expect(run).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tenant isolation: deleteWorkflow only deletes owned resources
// ---------------------------------------------------------------------------

describe('Tenant isolation on delete', () => {
  it('deleteWorkflow filters by user_id via eq', async () => {
    let eqCalls = [];
    mockFromHandler = () => {
      const chain = createChainable({ data: [{ id: 'wf-a' }], error: null });
      chain.eq = vi.fn((col, val) => {
        eqCalls.push({ col, val });
        return chain;
      });
      return chain;
    };

    await deleteWorkflow('user-a', 'wf-a');
    expect(eqCalls).toContainEqual({ col: 'id', val: 'wf-a' });
    expect(eqCalls).toContainEqual({ col: 'user_id', val: 'user-a' });
  });

  it('returns false when user does not own workflow', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });
    const result = await deleteWorkflow('user-a', 'wf-owned-by-b');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Atomic delete -- cascade handled by PostgreSQL FK
// ---------------------------------------------------------------------------

describe('Atomic delete', () => {
  it('deleteWorkflow returns true when row deleted (runs cascade via FK)', async () => {
    mockFromHandler = () => createChainable({ data: [{ id: 'wf-atom' }], error: null });
    const result = await deleteWorkflow('atom-user', 'wf-atom');
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error handling regression (B-M2)
// ---------------------------------------------------------------------------

describe('Error handling', () => {
  it('updateWorkflowRun does not throw on valid input', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    await expect(
      updateWorkflowRun('run-1', { status: 'running', context: {}, nodeResults: {} }),
    ).resolves.not.toThrow();
  });

  it('completeWorkflowRun does not throw on valid input', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    await expect(
      completeWorkflowRun('run-1', { status: 'completed', nodeResults: {} }),
    ).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// closeWorkflowDb
// ---------------------------------------------------------------------------

describe('closeWorkflowDb', () => {
  it('does not throw (no-op for Supabase)', async () => {
    await expect(closeWorkflowDb()).resolves.not.toThrow();
  });
});
