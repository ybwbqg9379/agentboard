/**
 * Unit tests for Supabase-based session store.
 *
 * Mocks the Supabase client to avoid real network calls.
 * All store functions are async -- every call uses await.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

let mockFromHandler;

vi.mock('./supabaseClient.js', () => {
  /**
   * Build a chainable mock that simulates
   * supabase.from('table').select().eq().order()...
   *
   * When awaited, resolves to `resolvedValue`.
   * Methods like .select(), .eq(), etc. return the same proxy for chaining.
   * .single() / .maybeSingle() return a Promise of resolvedValue.
   */
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
        // Unknown methods return the proxy for chaining
        return () => proxy;
      },
      set(t, prop, value) {
        t[prop] = value;
        return true;
      },
    });

    // Seed commonly used methods so they are overridable via target
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
  createSession,
  getSession,
  updateSessionStatus,
  updateSessionStats,
  insertEvent,
  getEvents,
  listSessions,
  listSessionsPaged,
  countSessions,
  countEvents,
  recoverStaleSessions,
  deleteSession,
  deleteSessionsBatch,
  filterSessionIdsOwned,
  close,
} = await import('./sessionStore.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockFromHandler = undefined;
});

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('returns a UUID string', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    const id = await createSession('test-user', 'test prompt');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('inserts with status "running"', async () => {
    let capturedRow;
    mockFromHandler = (table) => {
      expect(table).toBe('sessions');
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        capturedRow = row;
        return chain;
      });
      return chain;
    };
    await createSession('test-user', 'hello world');
    expect(capturedRow.status).toBe('running');
    expect(capturedRow.prompt).toBe('hello world');
    expect(capturedRow.user_id).toBe('test-user');
  });

  it('assigns unique IDs across multiple calls', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    const id1 = await createSession('test-user', 'a');
    const id2 = await createSession('test-user', 'b');
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe('getSession', () => {
  it('returns null for non-existent ID', async () => {
    mockFromHandler = () => createChainable({ data: null, error: null });
    const result = await getSession('test-user', '00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('returns the full session row', async () => {
    const fakeRow = {
      id: 'abc-123',
      user_id: 'test-user',
      prompt: 'full row test',
      status: 'running',
      created_at: '2025-01-01T00:00:00Z',
      stats: null,
      pinned_context: null,
    };
    mockFromHandler = () => createChainable({ data: fakeRow, error: null });

    const session = await getSession('test-user', 'abc-123');
    expect(session).toHaveProperty('id', 'abc-123');
    expect(session).toHaveProperty('prompt', 'full row test');
    expect(session).toHaveProperty('status', 'running');
    expect(session).toHaveProperty('created_at');
  });
});

// ---------------------------------------------------------------------------
// updateSessionStatus
// ---------------------------------------------------------------------------

describe('updateSessionStatus', () => {
  it('calls update with the new status', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    await updateSessionStatus('sess-1', 'completed');
    expect(capturedUpdate).toEqual({ status: 'completed' });
  });

  it('can transition through multiple statuses', async () => {
    const statuses = [];
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        statuses.push(row.status);
        return chain;
      });
      return chain;
    };

    await updateSessionStatus('sess-1', 'failed');
    await updateSessionStatus('sess-1', 'interrupted');
    expect(statuses).toEqual(['failed', 'interrupted']);
  });
});

// ---------------------------------------------------------------------------
// updateSessionStats
// ---------------------------------------------------------------------------

describe('updateSessionStats', () => {
  it('stores stats object (JSONB, no JSON.stringify needed)', async () => {
    let capturedUpdate;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      return chain;
    };

    const stats = { cost_usd: 0.05, input_tokens: 100, output_tokens: 200 };
    await updateSessionStats('sess-1', stats);
    // Supabase JSONB: stored as native object, not stringified
    expect(capturedUpdate.stats).toEqual(stats);
    expect(capturedUpdate.stats.cost_usd).toBe(0.05);
    expect(capturedUpdate.stats.input_tokens).toBe(100);
    expect(capturedUpdate.stats.output_tokens).toBe(200);
  });

  it('overwrites previous stats', async () => {
    let lastStats;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.update = vi.fn((row) => {
        lastStats = row.stats;
        return chain;
      });
      return chain;
    };

    await updateSessionStats('sess-1', { cost_usd: 0.01 });
    await updateSessionStats('sess-1', { cost_usd: 0.99 });
    expect(lastStats.cost_usd).toBe(0.99);
  });
});

// ---------------------------------------------------------------------------
// insertEvent + getEvents
// ---------------------------------------------------------------------------

describe('insertEvent and getEvents', () => {
  it('inserts an event with correct fields', async () => {
    let capturedRow;
    mockFromHandler = () => {
      const chain = createChainable({ data: null, error: null });
      chain.insert = vi.fn((row) => {
        capturedRow = row;
        return chain;
      });
      return chain;
    };

    await insertEvent('sess-1', 'assistant', { text: 'hello' });
    expect(capturedRow.session_id).toBe('sess-1');
    expect(capturedRow.type).toBe('assistant');
    expect(capturedRow.content).toEqual({ text: 'hello' });
    expect(typeof capturedRow.timestamp).toBe('number');
  });

  it('getEvents returns events ordered by timestamp ASC', async () => {
    const fakeEvents = [
      { id: 'e1', session_id: 's1', type: 'a', content: { seq: 1 }, timestamp: 1000 },
      { id: 'e2', session_id: 's1', type: 'b', content: { seq: 2 }, timestamp: 2000 },
      { id: 'e3', session_id: 's1', type: 'c', content: { seq: 3 }, timestamp: 3000 },
    ];
    mockFromHandler = () => createChainable({ data: fakeEvents, error: null });

    const events = await getEvents('s1');
    expect(events).toHaveLength(3);
    expect(events[0].content.seq).toBe(1);
    expect(events[1].content.seq).toBe(2);
    expect(events[2].content.seq).toBe(3);
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }
  });

  it('returns empty array for session with no events', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });
    const events = await getEvents('no-events');
    expect(events).toEqual([]);
  });

  it('isolates events between sessions via eq filter', async () => {
    let lastEq;
    mockFromHandler = () => {
      const chain = createChainable({ data: [], error: null });
      chain.eq = vi.fn((col, val) => {
        lastEq = { col, val };
        return chain;
      });
      return chain;
    };

    await getEvents('session-A');
    expect(lastEq).toEqual({ col: 'session_id', val: 'session-A' });

    await getEvents('session-B');
    expect(lastEq).toEqual({ col: 'session_id', val: 'session-B' });
  });
});

// ---------------------------------------------------------------------------
// countEvents
// ---------------------------------------------------------------------------

describe('countEvents', () => {
  it('returns correct count from Supabase head:true query', async () => {
    mockFromHandler = () => {
      const chain = createChainable({ count: 3, error: null });
      chain.select = vi.fn((sel, opts) => {
        expect(sel).toBe('*');
        expect(opts).toEqual({ count: 'exact', head: true });
        return chain;
      });
      return chain;
    };

    const count = await countEvents('sess-1');
    expect(count).toBe(3);
  });

  it('returns 0 for non-existent session', async () => {
    mockFromHandler = () => createChainable({ count: 0, error: null });
    const count = await countEvents('00000000-0000-0000-0000-000000000000');
    expect(count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe('listSessions', () => {
  it('returns sessions from Supabase', async () => {
    const fakeSessions = [
      { id: 's2', prompt: 'second', status: 'running', created_at: '2025-01-02T00:00:00Z' },
      { id: 's1', prompt: 'first', status: 'completed', created_at: '2025-01-01T00:00:00Z' },
    ];
    mockFromHandler = () => createChainable({ data: fakeSessions, error: null });

    const sessions = await listSessions('test-user', 100);
    expect(sessions).toHaveLength(2);
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain('s1');
    expect(ids).toContain('s2');
  });

  it('respects limit parameter via Supabase .limit()', async () => {
    let capturedLimit;
    mockFromHandler = () => {
      const chain = createChainable({ data: [{}, {}], error: null });
      chain.limit = vi.fn((n) => {
        capturedLimit = n;
        return chain;
      });
      return chain;
    };

    await listSessions('test-user', 2);
    expect(capturedLimit).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// listSessionsPaged
// ---------------------------------------------------------------------------

describe('listSessionsPaged', () => {
  it('pagination with limit and offset uses .range()', async () => {
    let capturedRange;
    mockFromHandler = () => {
      const chain = createChainable({ data: [{ id: 'p1' }, { id: 'p2' }], error: null });
      chain.range = vi.fn((start, end) => {
        capturedRange = { start, end };
        return chain;
      });
      return chain;
    };

    const page = await listSessionsPaged('test-user', 2, 0);
    expect(capturedRange).toEqual({ start: 0, end: 1 }); // range(0, 0+2-1)
    expect(page).toHaveLength(2);
  });

  it('returns empty array when offset exceeds total', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });
    const sessions = await listSessionsPaged('test-user', 10, 999999);
    expect(sessions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// countSessions
// ---------------------------------------------------------------------------

describe('countSessions', () => {
  it('returns count from Supabase', async () => {
    mockFromHandler = () => createChainable({ count: 5, error: null });
    const count = await countSessions('test-user');
    expect(count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// recoverStaleSessions
// ---------------------------------------------------------------------------

describe('recoverStaleSessions', () => {
  it('updates running sessions to interrupted and returns count', async () => {
    let capturedUpdate;
    let capturedEqArgs;
    mockFromHandler = () => {
      const chain = createChainable({ data: [{ id: 's1' }, { id: 's2' }], error: null });
      chain.update = vi.fn((row) => {
        capturedUpdate = row;
        return chain;
      });
      chain.eq = vi.fn((col, val) => {
        capturedEqArgs = { col, val };
        return chain;
      });
      return chain;
    };

    const changed = await recoverStaleSessions();
    expect(capturedUpdate).toEqual({ status: 'interrupted' });
    expect(capturedEqArgs).toEqual({ col: 'status', val: 'running' });
    expect(changed).toBe(2);
  });

  it('does not affect completed sessions (filter by status=running)', async () => {
    let capturedEq;
    mockFromHandler = () => {
      const chain = createChainable({ data: [], error: null });
      chain.eq = vi.fn((col, val) => {
        capturedEq = { col, val };
        return chain;
      });
      return chain;
    };

    await recoverStaleSessions();
    expect(capturedEq).toEqual({ col: 'status', val: 'running' });
  });

  it('returns 0 when no running sessions exist', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });
    const changed = await recoverStaleSessions();
    expect(changed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// filterSessionIdsOwned
// ---------------------------------------------------------------------------

describe('filterSessionIdsOwned', () => {
  it('returns id list from Supabase select + in', async () => {
    mockFromHandler = () => createChainable({ data: [{ id: 'a' }, { id: 'b' }], error: null });

    const r = await filterSessionIdsOwned('user-1', ['a', 'b', 'ghost']);
    expect(r).toEqual(['a', 'b']);
  });

  it('returns empty array when ids is empty (no round-trip)', async () => {
    const r = await filterSessionIdsOwned('user-1', []);
    expect(r).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// deleteSessionsBatch
// ---------------------------------------------------------------------------

describe('deleteSessionsBatch', () => {
  it('returns number of deleted rows', async () => {
    mockFromHandler = () => createChainable({ data: [{ id: 'x' }, { id: 'y' }], error: null });

    const n = await deleteSessionsBatch('user-1', ['x', 'y']);
    expect(n).toBe(2);
  });

  it('returns 0 when ids is empty', async () => {
    expect(await deleteSessionsBatch('user-1', [])).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// deleteSession
// ---------------------------------------------------------------------------

describe('deleteSession', () => {
  it('deletes session and returns true when found', async () => {
    let eqCalls = [];
    mockFromHandler = () => {
      const chain = createChainable({ data: [{ id: 'sid-1' }], error: null });
      chain.eq = vi.fn((col, val) => {
        eqCalls.push({ col, val });
        return chain;
      });
      return chain;
    };

    const result = await deleteSession('del-user', 'sid-1');
    expect(result).toBe(true);
    expect(eqCalls).toContainEqual({ col: 'id', val: 'sid-1' });
    expect(eqCalls).toContainEqual({ col: 'user_id', val: 'del-user' });
  });

  it('returns false for non-existent session', async () => {
    mockFromHandler = () => createChainable({ data: [], error: null });
    const result = await deleteSession('del-user', '00000000-0000-0000-0000-000000000000');
    expect(result).toBe(false);
  });

  it('enforces user ownership via user_id eq filter', async () => {
    let eqCalls = [];
    mockFromHandler = () => {
      const chain = createChainable({ data: [], error: null });
      chain.eq = vi.fn((col, val) => {
        eqCalls.push({ col, val });
        return chain;
      });
      return chain;
    };

    const result = await deleteSession('other-user', 'sid-owned-by-someone');
    expect(result).toBe(false);
    expect(eqCalls).toContainEqual({ col: 'user_id', val: 'other-user' });
  });
});

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

describe('close', () => {
  it('does not throw (no-op for Supabase)', async () => {
    await expect(close()).resolves.not.toThrow();
  });
});
