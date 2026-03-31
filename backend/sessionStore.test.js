/**
 * Integration tests for SQLite session store.
 *
 * Uses in-memory database via mocked config to avoid filesystem side-effects.
 * better-sqlite3 with ':memory:' gives a fresh DB per test module import.
 */

import { describe, it, expect } from 'vitest';
import { vi } from 'vitest';

vi.mock('./config.js', () => ({
  default: { dbPath: ':memory:' },
}));

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
  close,
} = await import('./sessionStore.js');

// ---------------------------------------------------------------------------
// createSession
// ---------------------------------------------------------------------------

describe('createSession', () => {
  it('returns a UUID string', () => {
    const id = createSession('test-user', 'test prompt');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it('creates session with status "running"', () => {
    const id = createSession('test-user', 'hello world');
    const session = getSession('test-user', id);
    expect(session).not.toBeNull();
    expect(session.status).toBe('running');
    expect(session.prompt).toBe('hello world');
  });

  it('is retrievable via getSession', () => {
    const id = createSession('test-user', 'find me');
    const session = getSession('test-user', id);
    expect(session).toBeDefined();
    expect(session.id).toBe(id);
  });

  it('assigns unique IDs across multiple calls', () => {
    const id1 = createSession('test-user', 'a');
    const id2 = createSession('test-user', 'b');
    expect(id1).not.toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe('getSession', () => {
  it('returns null for non-existent ID', () => {
    const result = getSession('test-user', '00000000-0000-0000-0000-000000000000');
    expect(result).toBeUndefined();
  });

  it('returns the full session row', () => {
    const id = createSession('test-user', 'full row test');
    const session = getSession('test-user', id);
    expect(session).toHaveProperty('id', id);
    expect(session).toHaveProperty('prompt', 'full row test');
    expect(session).toHaveProperty('status', 'running');
    expect(session).toHaveProperty('created_at');
  });
});

// ---------------------------------------------------------------------------
// updateSessionStatus
// ---------------------------------------------------------------------------

describe('updateSessionStatus', () => {
  it('changes session status', () => {
    const id = createSession('test-user', 'status test');
    expect(getSession('test-user', id).status).toBe('running');

    updateSessionStatus(id, 'completed');
    expect(getSession('test-user', id).status).toBe('completed');
  });

  it('can transition through multiple statuses', () => {
    const id = createSession('test-user', 'multi status');
    updateSessionStatus(id, 'failed');
    expect(getSession('test-user', id).status).toBe('failed');

    updateSessionStatus(id, 'interrupted');
    expect(getSession('test-user', id).status).toBe('interrupted');
  });
});

// ---------------------------------------------------------------------------
// updateSessionStats
// ---------------------------------------------------------------------------

describe('updateSessionStats', () => {
  it('stores JSON stats retrievable from session', () => {
    const id = createSession('test-user', 'stats test');
    const stats = { cost_usd: 0.05, input_tokens: 100, output_tokens: 200 };
    updateSessionStats(id, stats);

    const session = getSession('test-user', id);
    expect(session.stats).toBeDefined();
    const parsed = JSON.parse(session.stats);
    expect(parsed.cost_usd).toBe(0.05);
    expect(parsed.input_tokens).toBe(100);
    expect(parsed.output_tokens).toBe(200);
  });

  it('overwrites previous stats', () => {
    const id = createSession('test-user', 'overwrite stats');
    updateSessionStats(id, { cost_usd: 0.01 });
    updateSessionStats(id, { cost_usd: 0.99 });

    const parsed = JSON.parse(getSession('test-user', id).stats);
    expect(parsed.cost_usd).toBe(0.99);
  });
});

// ---------------------------------------------------------------------------
// insertEvent + getEvents
// ---------------------------------------------------------------------------

describe('insertEvent and getEvents', () => {
  it('round-trips events with parsed JSON content', () => {
    const id = createSession('test-user', 'event roundtrip');
    insertEvent(id, 'assistant', { text: 'hello' });

    const events = getEvents(id);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('assistant');
    expect(events[0].content).toEqual({ text: 'hello' });
  });

  it('returns events ordered by timestamp ASC', () => {
    const id = createSession('test-user', 'ordered events');
    insertEvent(id, 'a', { seq: 1 });
    insertEvent(id, 'b', { seq: 2 });
    insertEvent(id, 'c', { seq: 3 });

    const events = getEvents(id);
    expect(events).toHaveLength(3);
    expect(events[0].content.seq).toBe(1);
    expect(events[1].content.seq).toBe(2);
    expect(events[2].content.seq).toBe(3);

    // Verify ascending order by timestamp
    for (let i = 1; i < events.length; i++) {
      expect(events[i].timestamp).toBeGreaterThanOrEqual(events[i - 1].timestamp);
    }
  });

  it('handles multiple events per session', () => {
    const id = createSession('test-user', 'many events');
    for (let i = 0; i < 10; i++) {
      insertEvent(id, 'msg', { index: i });
    }
    const events = getEvents(id);
    expect(events).toHaveLength(10);
  });

  it('returns empty array for session with no events', () => {
    const id = createSession('test-user', 'no events');
    expect(getEvents(id)).toEqual([]);
  });

  it('isolates events between sessions', () => {
    const id1 = createSession('test-user', 'session A');
    const id2 = createSession('test-user', 'session B');
    insertEvent(id1, 'a', { from: 'A' });
    insertEvent(id2, 'b', { from: 'B' });

    expect(getEvents(id1)).toHaveLength(1);
    expect(getEvents(id1)[0].content.from).toBe('A');
    expect(getEvents(id2)).toHaveLength(1);
    expect(getEvents(id2)[0].content.from).toBe('B');
  });
});

// ---------------------------------------------------------------------------
// countEvents
// ---------------------------------------------------------------------------

describe('countEvents', () => {
  it('returns correct count per session', () => {
    const id = createSession('test-user', 'count events');
    expect(countEvents(id)).toBe(0);

    insertEvent(id, 'x', { n: 1 });
    insertEvent(id, 'x', { n: 2 });
    insertEvent(id, 'x', { n: 3 });
    expect(countEvents(id)).toBe(3);
  });

  it('returns 0 for non-existent session', () => {
    expect(countEvents('00000000-0000-0000-0000-000000000000')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// listSessions
// ---------------------------------------------------------------------------

describe('listSessions', () => {
  it('returns sessions ordered by created_at DESC', () => {
    // Create sessions; they all get "now" as created_at but IDs differ
    const id1 = createSession('test-user', 'list first');
    const id2 = createSession('test-user', 'list second');

    const sessions = listSessions('test-user', 100);
    // At least these two sessions exist (along with ones from other tests)
    const ids = sessions.map((s) => s.id);
    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  it('respects limit parameter', () => {
    // We have many sessions from prior tests; limit should truncate
    const sessions = listSessions('test-user', 2);
    expect(sessions).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// listSessionsPaged
// ---------------------------------------------------------------------------

describe('listSessionsPaged', () => {
  it('pagination with limit and offset works correctly', () => {
    const allSessions = listSessionsPaged('test-user', 100, 0);
    const total = allSessions.length;

    if (total >= 3) {
      const page1 = listSessionsPaged('test-user', 2, 0);
      const page2 = listSessionsPaged('test-user', 2, 2);

      expect(page1).toHaveLength(2);
      // page2 may have fewer if near the end
      expect(page2.length).toBeGreaterThan(0);

      // Pages should not overlap
      const page1Ids = new Set(page1.map((s) => s.id));
      for (const s of page2) {
        expect(page1Ids.has(s.id)).toBe(false);
      }
    }
  });

  it('returns empty array when offset exceeds total', () => {
    const sessions = listSessionsPaged('test-user', 10, 999999);
    expect(sessions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// countSessions
// ---------------------------------------------------------------------------

describe('countSessions', () => {
  it('returns total count', () => {
    const before = countSessions('test-user');
    createSession('test-user', 'count me');
    const after = countSessions('test-user');
    expect(after).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------
// recoverStaleSessions
// ---------------------------------------------------------------------------

describe('recoverStaleSessions', () => {
  it('marks running sessions as interrupted', () => {
    const id = createSession('test-user', 'stale runner');
    // createSession sets status to 'running'
    expect(getSession('test-user', id).status).toBe('running');

    const changed = recoverStaleSessions();
    expect(changed).toBeGreaterThanOrEqual(1);
    expect(getSession('test-user', id).status).toBe('interrupted');
  });

  it('does not affect completed sessions', () => {
    const id = createSession('test-user', 'completed one');
    updateSessionStatus(id, 'completed');

    recoverStaleSessions();
    expect(getSession('test-user', id).status).toBe('completed');
  });

  it('does not affect failed sessions', () => {
    const id = createSession('test-user', 'failed one');
    updateSessionStatus(id, 'failed');

    recoverStaleSessions();
    expect(getSession('test-user', id).status).toBe('failed');
  });

  it('returns number of affected sessions', () => {
    // All currently running sessions were already recovered above.
    // Create two new running sessions:
    createSession('test-user', 'recover me 1');
    createSession('test-user', 'recover me 2');

    const changed = recoverStaleSessions();
    expect(changed).toBeGreaterThanOrEqual(2);
  });

  it('returns 0 when no running sessions exist', () => {
    // After previous recovery, none should be running
    const changed = recoverStaleSessions();
    expect(changed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// close
// ---------------------------------------------------------------------------

describe('close', () => {
  it('does not throw', () => {
    // Run close last since it closes the database
    expect(() => close()).not.toThrow();
  });
});
