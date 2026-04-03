/**
 * Unit tests for Supabase-based experiment store.
 *
 * Covers: experiments CRUD, runs lifecycle, trials persistence,
 * stale recovery, and multi-tenant userId filtering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase mock (same chainable pattern as swarmStore.test.js)
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
  createExperiment,
  getExperiment,
  listExperiments,
  countExperiments,
  updateExperiment,
  deleteExperiment,
  createRun,
  getRun,
  getRunOwned,
  listRuns,
  updateRunStatus,
  updateRunMetrics,
  updateRunBaseline,
  updateRunError,
  recoverStaleRuns,
  saveTrial,
  listTrials,
  countTrials,
  getBestTrial,
  closeExperimentDb,
} = await import('./experimentStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockFromHandler = undefined;
});

// ---------------------------------------------------------------------------
// Experiments CRUD
// ---------------------------------------------------------------------------

describe('experiments CRUD', () => {
  it('createExperiment returns a UUID and inserts correct fields', async () => {
    let capturedRow;
    mockFromHandler = (table) => {
      const chain = createChainable({ data: null, error: null });
      if (table === 'experiments') {
        chain.insert = vi.fn((row) => {
          capturedRow = row;
          return chain;
        });
      }
      return chain;
    };

    const plan = { metrics: { primary: { extract: 'score: (\\d+)' } } };
    const id = await createExperiment('user1', 'Test Exp', 'A description', plan);

    expect(id).toBeDefined();
    expect(id.length).toBe(36);
    expect(capturedRow.user_id).toBe('user1');
    expect(capturedRow.name).toBe('Test Exp');
    expect(capturedRow.description).toBe('A description');
    expect(capturedRow.plan).toEqual(plan);
    expect(capturedRow.status).toBe('draft');
  });

  it('createExperiment defaults userId to "default"', async () => {
    let capturedRow;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        capturedRow = row;
        return chain;
      });
      return chain;
    };

    await createExperiment(null, 'name', '', {});
    expect(capturedRow.user_id).toBe('default');
  });

  it('createExperiment throws on Supabase error', async () => {
    mockFromHandler = () => createChainable({ data: null, error: { message: 'insert failed' } });

    await expect(createExperiment('u', 'n', '', {})).rejects.toEqual({
      message: 'insert failed',
    });
  });

  it('getExperiment returns data on success', async () => {
    const fakeExp = { id: 'exp-1', name: 'Test', user_id: 'user1' };
    mockFromHandler = () => createChainable({ data: fakeExp, error: null });

    const result = await getExperiment('user1', 'exp-1');
    expect(result).toEqual(fakeExp);
  });

  it('getExperiment returns null on error', async () => {
    mockFromHandler = () => createChainable({ data: null, error: { message: 'not found' } });

    const result = await getExperiment('user1', 'exp-404');
    expect(result).toBeNull();
  });

  it('listExperiments returns array with pagination', async () => {
    const fakeList = [{ id: 'e1' }, { id: 'e2' }];
    let capturedRange;
    mockFromHandler = () => {
      const chain = createChainable({ data: fakeList, error: null });
      chain.range = vi.fn((from, to) => {
        capturedRange = { from, to };
        return chain;
      });
      return chain;
    };

    const result = await listExperiments('user1', 10, 5);
    expect(result).toHaveLength(2);
    expect(capturedRange).toEqual({ from: 5, to: 14 });
  });

  it('listExperiments returns empty array on error', async () => {
    mockFromHandler = () => createChainable({ data: null, error: { message: 'fail' } });

    const result = await listExperiments('user1');
    expect(result).toEqual([]);
  });

  it('countExperiments returns count', async () => {
    mockFromHandler = () => {
      const chain = createChainable({ count: 42, error: null });
      return chain;
    };

    const result = await countExperiments('user1');
    expect(result).toBe(42);
  });

  it('countExperiments returns 0 on error', async () => {
    mockFromHandler = () => {
      const chain = createChainable({ count: null, error: { message: 'fail' } });
      return chain;
    };

    const result = await countExperiments('user1');
    expect(result).toBe(0);
  });

  it('updateExperiment returns true when rows affected', async () => {
    mockFromHandler = () => createChainable({ data: [{ id: 'exp-1' }], error: null });

    const ok = await updateExperiment('user1', 'exp-1', 'New Name', 'desc', {});
    expect(ok).toBe(true);
  });

  it('updateExperiment returns false when no rows affected', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });

    const ok = await updateExperiment('user1', 'exp-404', 'n', '', {});
    expect(ok).toBe(false);
  });

  it('updateExperiment returns false on error', async () => {
    mockFromHandler = () => createChainable({ data: null, error: { message: 'fail' } });

    const ok = await updateExperiment('user1', 'exp-1', 'n', '', {});
    expect(ok).toBe(false);
  });

  it('deleteExperiment returns true when deleted', async () => {
    mockFromHandler = () => createChainable({ data: [{ id: 'exp-1' }], error: null });

    const ok = await deleteExperiment('user1', 'exp-1');
    expect(ok).toBe(true);
  });

  it('deleteExperiment returns false when nothing deleted', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });

    const ok = await deleteExperiment('user1', 'exp-404');
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Runs lifecycle
// ---------------------------------------------------------------------------

describe('runs lifecycle', () => {
  it('createRun returns UUID and marks experiment as running', async () => {
    const tables = {};
    mockFromHandler = (table) => {
      const chain = createChainable({ data: null, error: null });
      tables[table] = tables[table] || [];
      chain.insert = vi.fn((row) => {
        tables[table].push({ action: 'insert', row });
        return chain;
      });
      chain.update = vi.fn((row) => {
        tables[table].push({ action: 'update', row });
        return chain;
      });
      return chain;
    };

    const id = await createRun('user1', 'exp-1');
    expect(id.length).toBe(36);
    // experiment_runs insert
    expect(tables['experiment_runs'][0].action).toBe('insert');
    expect(tables['experiment_runs'][0].row.experiment_id).toBe('exp-1');
    expect(tables['experiment_runs'][0].row.status).toBe('running');
    // experiments status updated
    expect(tables['experiments'][0].action).toBe('update');
    expect(tables['experiments'][0].row.status).toBe('running');
  });

  it('createRun throws on insert error', async () => {
    mockFromHandler = (table) => {
      if (table === 'experiment_runs') {
        return createChainable({ data: null, error: { message: 'fk violation' } });
      }
      return createChainable({ data: null, error: null });
    };

    await expect(createRun('user1', 'exp-bad')).rejects.toEqual({
      message: 'fk violation',
    });
  });

  it('getRun returns run data', async () => {
    const fakeRun = { id: 'run-1', status: 'running' };
    mockFromHandler = () => createChainable({ data: fakeRun, error: null });

    const run = await getRun('run-1');
    expect(run.id).toBe('run-1');
  });

  it('getRun returns null on error', async () => {
    mockFromHandler = () => createChainable({ data: null, error: { message: 'fail' } });

    const run = await getRun('run-404');
    expect(run).toBeNull();
  });

  it('getRunOwned filters by userId', async () => {
    let eqCalls = [];
    mockFromHandler = () => {
      const chain = createChainable({ data: { id: 'run-1' }, error: null });
      chain.eq = vi.fn((col, val) => {
        eqCalls.push({ col, val });
        return chain;
      });
      return chain;
    };

    await getRunOwned('user1', 'run-1');
    expect(eqCalls).toContainEqual({ col: 'id', val: 'run-1' });
    expect(eqCalls).toContainEqual({ col: 'user_id', val: 'user1' });
  });

  it('listRuns returns array with pagination', async () => {
    const fakeRuns = [{ id: 'r1' }, { id: 'r2' }];
    let capturedRange;
    mockFromHandler = () => {
      const chain = createChainable({ data: fakeRuns, error: null });
      chain.range = vi.fn((from, to) => {
        capturedRange = { from, to };
        return chain;
      });
      return chain;
    };

    const result = await listRuns('user1', 'exp-1', 5, 10);
    expect(result).toHaveLength(2);
    expect(capturedRange).toEqual({ from: 10, to: 14 });
  });

  it('updateRunStatus sets completed_at for terminal statuses', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateRunStatus('run-1', 'completed');
    expect(capturedUpdate.status).toBe('completed');
    expect(capturedUpdate.completed_at).toBeDefined();
  });

  it('updateRunStatus does NOT set completed_at for running', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateRunStatus('run-1', 'running');
    expect(capturedUpdate.status).toBe('running');
    expect(capturedUpdate.completed_at).toBeUndefined();
  });

  it('updateRunStatus sets completed_at for aborted and failed', async () => {
    for (const status of ['aborted', 'failed']) {
      let capturedUpdate;
      mockFromHandler = () => {
        const chain = createChainable({ data: null, error: null });
        chain.update = vi.fn((row) => {
          capturedUpdate = row;
          return chain;
        });
        return chain;
      };

      await updateRunStatus('run-1', status);
      expect(capturedUpdate.completed_at).toBeDefined();
    }
  });

  it('updateRunStatus applies userId filter when provided', async () => {
    let eqCalls = [];
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn(() => chain);
      chain.eq = vi.fn((col, val) => {
        eqCalls.push({ col, val });
        return chain;
      });
      return chain;
    };

    await updateRunStatus('run-1', 'completed', 'user1');
    expect(eqCalls).toContainEqual({ col: 'user_id', val: 'user1' });
  });

  it('updateRunMetrics sends correct fields', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateRunMetrics('run-1', 0.85, 10, 7);
    expect(capturedUpdate.best_metric).toBeCloseTo(0.85);
    expect(capturedUpdate.total_trials).toBe(10);
    expect(capturedUpdate.accepted_trials).toBe(7);
  });

  it('updateRunBaseline sends baseline value', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateRunBaseline('run-1', 1.5);
    expect(capturedUpdate.baseline_metric).toBeCloseTo(1.5);
  });

  it('updateRunError stores error message', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateRunError('run-1', 'benchmark crashed');
    expect(capturedUpdate.error_message).toBe('benchmark crashed');
  });

  it('recoverStaleRuns marks running as interrupted', async () => {
    let capturedUpdate;
    let eqCalls = [];
    mockFromHandler = () => {
      const chain = createChainable({ data: [{ id: 'r1' }, { id: 'r2' }], error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      chain.eq = vi.fn((col, val) => {
        eqCalls.push({ col, val });
        return chain;
      });
      return chain;
    };

    const count = await recoverStaleRuns();
    expect(count).toBe(2);
    expect(capturedUpdate.status).toBe('interrupted');
    expect(eqCalls).toContainEqual({ col: 'status', val: 'running' });
  });

  it('recoverStaleRuns returns 0 when no stale runs', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });

    const count = await recoverStaleRuns();
    expect(count).toBe(0);
  });

  it('recoverStaleRuns returns 0 on error', async () => {
    mockFromHandler = () => createChainable({ data: null, error: { message: 'fail' } });

    const count = await recoverStaleRuns();
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

describe('trials persistence', () => {
  it('saveTrial inserts with correct fields', async () => {
    let capturedRow;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        capturedRow = row;
        return chain;
      });
      return chain;
    };

    const id = await saveTrial('run-1', 3, {
      accepted: true,
      primaryMetric: 0.95,
      allMetrics: { primary: 0.95, guard: true },
      diff: '--- a/file.js\n+++ b/file.js',
      agentSessionId: 'sess-1',
      reason: 'metric improved',
      durationMs: 5000,
    });

    expect(id.length).toBe(36);
    expect(capturedRow.run_id).toBe('run-1');
    expect(capturedRow.trial_number).toBe(3);
    expect(capturedRow.accepted).toBe(true);
    expect(capturedRow.primary_metric).toBeCloseTo(0.95);
    expect(capturedRow.all_metrics).toEqual({ primary: 0.95, guard: true });
    expect(capturedRow.diff).toContain('file.js');
    expect(capturedRow.agent_session_id).toBe('sess-1');
    expect(capturedRow.reason).toBe('metric improved');
    expect(capturedRow.duration_ms).toBe(5000);
  });

  it('saveTrial handles minimal data with nulls', async () => {
    let capturedRow;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        capturedRow = row;
        return chain;
      });
      return chain;
    };

    await saveTrial('run-1', 1, { accepted: false });
    expect(capturedRow.accepted).toBe(false);
    expect(capturedRow.primary_metric).toBeNull();
    expect(capturedRow.all_metrics).toBeNull();
    expect(capturedRow.diff).toBeNull();
    expect(capturedRow.agent_session_id).toBeNull();
    expect(capturedRow.reason).toBeNull();
    expect(capturedRow.duration_ms).toBeNull();
  });

  it('listTrials returns ordered array', async () => {
    const fakeTrials = [
      { id: 't1', trial_number: 1 },
      { id: 't2', trial_number: 2 },
    ];
    let capturedOrder;
    mockFromHandler = () => {
      const chain = createChainable({ data: fakeTrials, error: null });
      chain.order = vi.fn((col, opts) => {
        capturedOrder = { col, opts };
        return chain;
      });
      return chain;
    };

    const result = await listTrials('run-1');
    expect(result).toHaveLength(2);
    expect(capturedOrder.col).toBe('trial_number');
    expect(capturedOrder.opts).toEqual({ ascending: true });
  });

  it('listTrials returns empty array on error', async () => {
    mockFromHandler = () => createChainable({ data: null, error: { message: 'fail' } });

    const result = await listTrials('run-1');
    expect(result).toEqual([]);
  });

  it('countTrials returns count', async () => {
    mockFromHandler = () => createChainable({ count: 15, error: null });

    const result = await countTrials('run-1');
    expect(result).toBe(15);
  });

  it('countTrials returns 0 on error', async () => {
    mockFromHandler = () => createChainable({ count: null, error: { message: 'fail' } });

    const result = await countTrials('run-1');
    expect(result).toBe(0);
  });

  it('getBestTrial minimize sorts ascending', async () => {
    const fakeTrial = { id: 't1', primary_metric: 0.1, accepted: true };
    let capturedOrder;
    mockFromHandler = () => {
      const chain = createChainable({ data: fakeTrial, error: null });
      chain.order = vi.fn((col, opts) => {
        capturedOrder = { col, opts };
        return chain;
      });
      return chain;
    };

    const result = await getBestTrial('run-1', 'minimize');
    expect(result.id).toBe('t1');
    expect(capturedOrder.col).toBe('primary_metric');
    expect(capturedOrder.opts).toEqual({ ascending: true });
  });

  it('getBestTrial maximize sorts descending', async () => {
    let capturedOrder;
    mockFromHandler = () => {
      const chain = createChainable({ data: { id: 't1' }, error: null });
      chain.order = vi.fn((col, opts) => {
        capturedOrder = { col, opts };
        return chain;
      });
      return chain;
    };

    await getBestTrial('run-1', 'maximize');
    expect(capturedOrder.opts).toEqual({ ascending: false });
  });

  it('getBestTrial filters by accepted=true', async () => {
    let eqCalls = [];
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.eq = vi.fn((col, val) => {
        eqCalls.push({ col, val });
        return chain;
      });
      return chain;
    };

    await getBestTrial('run-1');
    expect(eqCalls).toContainEqual({ col: 'accepted', val: true });
  });

  it('getBestTrial returns null on error', async () => {
    mockFromHandler = () => createChainable({ data: null, error: { message: 'fail' } });

    const result = await getBestTrial('run-1');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// closeExperimentDb (no-op for Supabase)
// ---------------------------------------------------------------------------

describe('closeExperimentDb', () => {
  it('is a no-op and does not throw', async () => {
    await expect(closeExperimentDb()).resolves.toBeUndefined();
  });
});
