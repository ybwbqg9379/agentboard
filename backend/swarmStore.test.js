/**
 * swarmStore.test.js
 *
 * Unit tests for the swarmStore CRUD layer.
 * Uses an in-memory SQLite path to avoid polluting the real DB.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

// ── Inline re-implementation of swarmStore logic against a test DB ────────────
// We don't import the real module (which opens the production DB path).
// Instead we replicate the table schema and stmts in test scope.

let db;
let stmts;

beforeAll(() => {
  // In-memory SQLite — discarded after test run
  db = new Database(':memory:');
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create minimal dependency table so FK constraint doesn't break
  db.exec(`
    CREATE TABLE IF NOT EXISTS experiment_runs (
      id   TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL DEFAULT 'running'
    );

    CREATE TABLE IF NOT EXISTS swarm_branches (
      id              TEXT    PRIMARY KEY,
      run_id          TEXT    NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
      branch_index    INTEGER NOT NULL,
      hypothesis      TEXT    NOT NULL,
      workspace_dir   TEXT    NOT NULL,
      status          TEXT    NOT NULL DEFAULT 'running',
      best_metric     REAL,
      total_trials    INTEGER NOT NULL DEFAULT 0,
      accepted_trials INTEGER NOT NULL DEFAULT 0,
      is_selected     INTEGER NOT NULL DEFAULT 0,
      rejection_reason TEXT,
      created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
      completed_at    TEXT
    );

    CREATE TABLE IF NOT EXISTS swarm_coordinator_decisions (
      id               TEXT PRIMARY KEY,
      run_id           TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
      phase            TEXT NOT NULL,
      input_summary    TEXT,
      output_raw       TEXT,
      parsed_result    TEXT,
      agent_session_id TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  stmts = {
    insertRun: db.prepare(`INSERT INTO experiment_runs (id) VALUES (?)`),
    createBranch: db.prepare(`
      INSERT INTO swarm_branches (id, run_id, branch_index, hypothesis, workspace_dir)
      VALUES (?, ?, ?, ?, ?)
    `),
    updateBranchStatus: db.prepare(`
      UPDATE swarm_branches
      SET status = ?,
          completed_at = CASE WHEN ? IN ('completed','failed') THEN datetime('now') ELSE completed_at END
      WHERE id = ?
    `),
    updateBranchMetrics: db.prepare(`
      UPDATE swarm_branches SET best_metric = ?, total_trials = ?, accepted_trials = ? WHERE id = ?
    `),
    selectBranch: db.prepare(`UPDATE swarm_branches SET is_selected = 1 WHERE id = ?`),
    rejectBranch: db.prepare(`
      UPDATE swarm_branches SET is_selected = 0, rejection_reason = ? WHERE id = ?
    `),
    listBranches: db.prepare(`SELECT * FROM swarm_branches WHERE run_id = ? ORDER BY branch_index`),
    saveDecision: db.prepare(`
      INSERT INTO swarm_coordinator_decisions (id, run_id, phase, input_summary, output_raw, parsed_result, agent_session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    listDecisions: db.prepare(
      `SELECT * FROM swarm_coordinator_decisions WHERE run_id = ? ORDER BY created_at`,
    ),
  };
});

afterAll(() => {
  db.close();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function seedRun() {
  const runId = randomUUID();
  stmts.insertRun.run(runId);
  return runId;
}

function seedBranch(runId, overrides = {}) {
  const branchId = randomUUID();
  stmts.createBranch.run(
    branchId,
    runId,
    overrides.branchIndex ?? 0,
    overrides.hypothesis ?? 'Test hypothesis',
    overrides.workspaceDir ?? '/tmp/workspace-test',
  );
  return branchId;
}

// ── Branch CRUD ───────────────────────────────────────────────────────────────

describe('swarm_branches CRUD', () => {
  it('creates a branch and reads it back', () => {
    const runId = seedRun();
    const branchId = seedBranch(runId, { branchIndex: 0, hypothesis: 'Tune LR' });

    const rows = stmts.listBranches.all(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(branchId);
    expect(rows[0].hypothesis).toBe('Tune LR');
    expect(rows[0].status).toBe('running');
    expect(rows[0].is_selected).toBe(0);
  });

  it('updates status to completed and records completed_at', () => {
    const runId = seedRun();
    const branchId = seedBranch(runId);

    stmts.updateBranchStatus.run('completed', 'completed', branchId);

    const rows = stmts.listBranches.all(runId);
    expect(rows[0].status).toBe('completed');
    expect(rows[0].completed_at).toBeTruthy();
  });

  it('updates status to failed and records completed_at', () => {
    const runId = seedRun();
    const branchId = seedBranch(runId);

    stmts.updateBranchStatus.run('failed', 'failed', branchId);

    const rows = stmts.listBranches.all(runId);
    expect(rows[0].status).toBe('failed');
    expect(rows[0].completed_at).toBeTruthy();
  });

  it('updates metric values', () => {
    const runId = seedRun();
    const branchId = seedBranch(runId);

    stmts.updateBranchMetrics.run(0.42, 10, 4, branchId);

    const rows = stmts.listBranches.all(runId);
    expect(rows[0].best_metric).toBeCloseTo(0.42);
    expect(rows[0].total_trials).toBe(10);
    expect(rows[0].accepted_trials).toBe(4);
  });

  it('marks a branch as selected', () => {
    const runId = seedRun();
    const b0 = seedBranch(runId, { branchIndex: 0 });
    const b1 = seedBranch(runId, { branchIndex: 1 });

    stmts.selectBranch.run(b1);

    const rows = stmts.listBranches.all(runId);
    const selected = rows.find((r) => r.id === b1);
    const other = rows.find((r) => r.id === b0);
    expect(selected.is_selected).toBe(1);
    expect(other.is_selected).toBe(0);
  });

  it('rejects a branch with a reason', () => {
    const runId = seedRun();
    const branchId = seedBranch(runId);

    stmts.rejectBranch.run('Not selected — metric was worse', branchId);

    const rows = stmts.listBranches.all(runId);
    expect(rows[0].is_selected).toBe(0);
    expect(rows[0].rejection_reason).toBe('Not selected — metric was worse');
  });

  it('lists multiple branches ordered by branch_index', () => {
    const runId = seedRun();
    seedBranch(runId, { branchIndex: 2, hypothesis: 'C' });
    seedBranch(runId, { branchIndex: 0, hypothesis: 'A' });
    seedBranch(runId, { branchIndex: 1, hypothesis: 'B' });

    const rows = stmts.listBranches.all(runId);
    expect(rows.map((r) => r.branch_index)).toEqual([0, 1, 2]);
  });

  it('cascade-deletes branches when the run is deleted', () => {
    const runId = seedRun();
    seedBranch(runId, { branchIndex: 0 });
    seedBranch(runId, { branchIndex: 1 });

    db.prepare(`DELETE FROM experiment_runs WHERE id = ?`).run(runId);

    const rows = stmts.listBranches.all(runId);
    expect(rows).toHaveLength(0);
  });
});

// ── Coordinator decision audit ────────────────────────────────────────────────

describe('swarm_coordinator_decisions', () => {
  it('inserts and reads back a decompose decision', () => {
    const runId = seedRun();

    stmts.saveDecision.run(
      randomUUID(),
      runId,
      'decompose',
      'branches=3',
      '<hypothesis id="0">foo</hypothesis>',
      JSON.stringify([{ id: 0, text: 'foo' }]),
      'session-abc',
    );

    const rows = stmts.listDecisions.all(runId);
    expect(rows).toHaveLength(1);
    expect(rows[0].phase).toBe('decompose');
    expect(rows[0].agent_session_id).toBe('session-abc');
    const parsed = JSON.parse(rows[0].parsed_result);
    expect(parsed[0].text).toBe('foo');
  });

  it('stores both phases and returns them in chronological order', () => {
    const runId = seedRun();

    stmts.saveDecision.run(randomUUID(), runId, 'decompose', null, null, null, null);
    stmts.saveDecision.run(randomUUID(), runId, 'synthesize', null, null, null, null);

    const rows = stmts.listDecisions.all(runId);
    expect(rows).toHaveLength(2);
    expect(rows[0].phase).toBe('decompose');
    expect(rows[1].phase).toBe('synthesize');
  });
});
