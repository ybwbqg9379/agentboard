/**
 * Unit tests for Supabase-based swarm store (P3 Research Swarm).
 *
 * Mocks the Supabase client to avoid real network calls.
 * All store functions are async -- every call uses await.
 * Does NOT import experimentDb (no longer exists).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// randomUUID not needed -- store generates IDs internally

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
  createSwarmBranch,
  updateSwarmBranchStatus,
  updateSwarmBranchMetrics,
  selectSwarmBranch,
  rejectSwarmBranch,
  getSwarmBranch,
  listSwarmBranches,
  getSelectedSwarmBranch,
  saveCoordinatorDecision,
  listCoordinatorDecisions,
} = await import('./swarmStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockFromHandler = undefined;
});

// ---------------------------------------------------------------------------
// swarm_branches CRUD
// ---------------------------------------------------------------------------

describe('swarm_branches CRUD', () => {
  it('creates a branch and returns a UUID', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    const branchId = await createSwarmBranch('run-1', 0, 'Tune LR', '/tmp/workspace-test');
    expect(branchId).toBeDefined();
    expect(branchId.length).toBe(36);
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

    await createSwarmBranch('run-1', 0, 'Tune LR', '/tmp/workspace-test');
    expect(capturedRow.run_id).toBe('run-1');
    expect(capturedRow.branch_index).toBe(0);
    expect(capturedRow.hypothesis).toBe('Tune LR');
    expect(capturedRow.workspace_dir).toBe('/tmp/workspace-test');
  });

  it('reads back a branch via getSwarmBranch', async () => {
    const fakeBranch = {
      id: 'br-1',
      run_id: 'run-1',
      branch_index: 0,
      hypothesis: 'Tune LR',
      workspace_dir: '/tmp/workspace-test',
      status: 'running',
      best_metric: null,
      total_trials: 0,
      accepted_trials: 0,
      is_selected: false,
      rejection_reason: null,
      created_at: '2025-01-01T00:00:00Z',
      completed_at: null,
    };
    mockFromHandler = () => createChainable({ data: fakeBranch, error: null });

    const branch = await getSwarmBranch('br-1');
    expect(branch.id).toBe('br-1');
    expect(branch.hypothesis).toBe('Tune LR');
    expect(branch.status).toBe('running');
    // is_selected is boolean in Supabase (not integer 0/1)
    expect(branch.is_selected).toBe(false);
  });

  it('updates status to completed with completed_at', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateSwarmBranchStatus('br-1', 'completed');
    expect(capturedUpdate.status).toBe('completed');
    expect(capturedUpdate.completed_at).toBeDefined();
  });

  it('updates status to failed with completed_at', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateSwarmBranchStatus('br-1', 'failed');
    expect(capturedUpdate.status).toBe('failed');
    expect(capturedUpdate.completed_at).toBeDefined();
  });

  it('updates status to running without completed_at', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateSwarmBranchStatus('br-1', 'running');
    expect(capturedUpdate.status).toBe('running');
    expect(capturedUpdate.completed_at).toBeUndefined();
  });

  it('updates metric values', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateSwarmBranchMetrics('br-1', 0.42, 10, 4);
    expect(capturedUpdate.best_metric).toBeCloseTo(0.42);
    expect(capturedUpdate.total_trials).toBe(10);
    expect(capturedUpdate.accepted_trials).toBe(4);
  });

  it('marks a branch as selected (boolean true)', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await selectSwarmBranch('br-1');
    // is_selected is boolean true in Supabase, not integer 1
    expect(capturedUpdate.is_selected).toBe(true);
  });

  it('rejects a branch with a reason (is_selected = false)', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await rejectSwarmBranch('br-1', 'Not selected -- metric was worse');
    expect(capturedUpdate.is_selected).toBe(false);
    expect(capturedUpdate.rejection_reason).toBe('Not selected -- metric was worse');
  });

  it('lists multiple branches ordered by branch_index', async () => {
    const fakeBranches = [
      { id: 'b0', branch_index: 0, hypothesis: 'A', status: 'running' },
      { id: 'b1', branch_index: 1, hypothesis: 'B', status: 'running' },
      { id: 'b2', branch_index: 2, hypothesis: 'C', status: 'running' },
    ];
    let capturedOrder;
    mockFromHandler = () => {
      const chain = createChainable({ data: fakeBranches, error: null });
      chain.order = vi.fn((col, opts) => {
        capturedOrder = { col, opts };
        return chain;
      });
      return chain;
    };

    const rows = await listSwarmBranches('run-1');
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.branch_index)).toEqual([0, 1, 2]);
    expect(capturedOrder.col).toBe('branch_index');
    expect(capturedOrder.opts).toEqual({ ascending: true });
  });

  it('getSelectedSwarmBranch filters by is_selected=true', async () => {
    const selected = {
      id: 'b1',
      run_id: 'run-1',
      branch_index: 1,
      is_selected: true,
      hypothesis: 'Winner',
    };
    let eqCalls = [];
    mockFromHandler = () => {
      const chain = createChainable({ data: selected, error: null });
      chain.eq = vi.fn((col, val) => {
        eqCalls.push({ col, val });
        return chain;
      });
      return chain;
    };

    const branch = await getSelectedSwarmBranch('run-1');
    expect(branch).not.toBeNull();
    expect(branch.id).toBe('b1');
    expect(branch.is_selected).toBe(true);
    expect(eqCalls).toContainEqual({ col: 'run_id', val: 'run-1' });
    expect(eqCalls).toContainEqual({ col: 'is_selected', val: true });
  });

  it('getSelectedSwarmBranch returns null when none selected', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    const branch = await getSelectedSwarmBranch('run-1');
    expect(branch).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Coordinator decision audit
// ---------------------------------------------------------------------------

describe('swarm_coordinator_decisions', () => {
  it('saves a decompose decision and returns an ID', async () => {
    let capturedRow;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        capturedRow = row;
        return chain;
      });
      return chain;
    };

    const decisionId = await saveCoordinatorDecision('run-1', 'decompose', {
      inputSummary: 'branches=3',
      outputRaw: '<hypothesis id="0">foo</hypothesis>',
      parsedResult: [{ id: 0, text: 'foo' }],
      agentSessionId: 'session-abc',
    });

    expect(decisionId).toBeDefined();
    expect(decisionId.length).toBe(36);
    expect(capturedRow.run_id).toBe('run-1');
    expect(capturedRow.phase).toBe('decompose');
    expect(capturedRow.input_summary).toBe('branches=3');
    expect(capturedRow.output_raw).toBe('<hypothesis id="0">foo</hypothesis>');
    // JSONB: parsed_result stored as native object
    expect(capturedRow.parsed_result).toEqual([{ id: 0, text: 'foo' }]);
    expect(capturedRow.agent_session_id).toBe('session-abc');
  });

  it('lists decisions in chronological order', async () => {
    const fakeDecisions = [
      {
        id: 'd1',
        run_id: 'run-1',
        phase: 'decompose',
        input_summary: null,
        output_raw: null,
        parsed_result: null,
        agent_session_id: null,
        created_at: '2025-01-01T00:00:00Z',
      },
      {
        id: 'd2',
        run_id: 'run-1',
        phase: 'synthesize',
        input_summary: null,
        output_raw: null,
        parsed_result: null,
        agent_session_id: null,
        created_at: '2025-01-01T01:00:00Z',
      },
    ];
    let capturedOrder;
    mockFromHandler = () => {
      const chain = createChainable({ data: fakeDecisions, error: null });
      chain.order = vi.fn((col, opts) => {
        capturedOrder = { col, opts };
        return chain;
      });
      return chain;
    };

    const rows = await listCoordinatorDecisions('run-1');
    expect(rows).toHaveLength(2);
    expect(rows[0].phase).toBe('decompose');
    expect(rows[1].phase).toBe('synthesize');
    expect(capturedOrder.col).toBe('created_at');
    expect(capturedOrder.opts).toEqual({ ascending: true });
  });

  it('listCoordinatorDecisions maps parsed_result to parsedResult', async () => {
    const fakeDecisions = [
      {
        id: 'd1',
        run_id: 'run-1',
        phase: 'decompose',
        parsed_result: [{ id: 0, text: 'foo' }],
        input_summary: null,
        output_raw: null,
        agent_session_id: 'session-abc',
        created_at: '2025-01-01T00:00:00Z',
      },
    ];
    mockFromHandler = () => createChainable({ data: fakeDecisions, error: null });

    const rows = await listCoordinatorDecisions('run-1');
    expect(rows[0].parsedResult).toEqual([{ id: 0, text: 'foo' }]);
    expect(rows[0].agent_session_id).toBe('session-abc');
  });

  it('saves decision with null optional fields', async () => {
    let capturedRow;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        capturedRow = row;
        return chain;
      });
      return chain;
    };

    await saveCoordinatorDecision('run-1', 'synthesize');
    expect(capturedRow.phase).toBe('synthesize');
    expect(capturedRow.input_summary).toBeNull();
    expect(capturedRow.output_raw).toBeNull();
    expect(capturedRow.parsed_result).toBeNull();
    expect(capturedRow.agent_session_id).toBeNull();
  });
});
