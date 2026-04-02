/**
 * swarmStore.js
 *
 * Persistent storage for Research Swarm (P3).
 * Manages swarm_branches and swarm_coordinator_decisions tables.
 * Reuses the same SQLite database as experimentStore.js (WAL mode, shared config).
 */

import { randomUUID } from 'node:crypto';
import { experimentDb as db } from './experimentStore.js';

db.exec(`
  -- Research branches spawned by a Swarm run
  CREATE TABLE IF NOT EXISTS swarm_branches (
    id              TEXT    PRIMARY KEY,
    run_id          TEXT    NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
    branch_index    INTEGER NOT NULL,
    hypothesis      TEXT    NOT NULL,        -- Coordinator-generated research direction text
    workspace_dir   TEXT    NOT NULL,
    status          TEXT    NOT NULL DEFAULT 'running',  -- running | completed | failed
    best_metric     REAL,
    total_trials    INTEGER NOT NULL DEFAULT 0,
    accepted_trials INTEGER NOT NULL DEFAULT 0,
    is_selected     INTEGER NOT NULL DEFAULT 0,          -- 1 = Coordinator chose this branch
    rejection_reason TEXT,                               -- why branch was not selected
    created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_swarm_branches_run ON swarm_branches(run_id);

  -- Full audit trail for every Coordinator Agent decision
  CREATE TABLE IF NOT EXISTS swarm_coordinator_decisions (
    id               TEXT PRIMARY KEY,
    run_id           TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
    phase            TEXT NOT NULL,         -- 'decompose' | 'synthesize'
    input_summary    TEXT,                  -- what was handed to the Coordinator
    output_raw       TEXT,                  -- raw Coordinator Agent text output
    parsed_result    TEXT,                  -- JSON-serialised parsed output
    agent_session_id TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_swarm_decisions_run ON swarm_coordinator_decisions(run_id);
`);

// ── Prepared Statements ──────────────────────────────────────────────────────

const stmts = {
  // Branches
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
    UPDATE swarm_branches
    SET best_metric = ?, total_trials = ?, accepted_trials = ?
    WHERE id = ?
  `),

  selectBranch: db.prepare(`
    UPDATE swarm_branches
    SET is_selected = 1
    WHERE id = ?
  `),

  rejectBranch: db.prepare(`
    UPDATE swarm_branches
    SET is_selected = 0, rejection_reason = ?
    WHERE id = ?
  `),

  getBranch: db.prepare(`SELECT * FROM swarm_branches WHERE id = ?`),

  listBranches: db.prepare(`
    SELECT * FROM swarm_branches WHERE run_id = ? ORDER BY branch_index ASC
  `),

  getSelectedBranch: db.prepare(`
    SELECT * FROM swarm_branches WHERE run_id = ? AND is_selected = 1 LIMIT 1
  `),

  // Coordinator decisions
  saveDecision: db.prepare(`
    INSERT INTO swarm_coordinator_decisions
      (id, run_id, phase, input_summary, output_raw, parsed_result, agent_session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `),

  listDecisions: db.prepare(`
    SELECT * FROM swarm_coordinator_decisions WHERE run_id = ? ORDER BY created_at ASC
  `),
};

// ── Branch API ───────────────────────────────────────────────────────────────

/**
 * Register a new research branch.
 * @returns {string} branchId
 */
export function createSwarmBranch(runId, branchIndex, hypothesis, workspaceDir) {
  const id = randomUUID();
  try {
    stmts.createBranch.run(id, runId, branchIndex, hypothesis, workspaceDir);
  } catch (err) {
    console.error(`[swarmStore] createSwarmBranch failed: ${err.message}`);
    throw err;
  }
  return id;
}

/** Update the lifecycle status of a branch (running | completed | failed). */
export function updateSwarmBranchStatus(branchId, status) {
  try {
    stmts.updateBranchStatus.run(status, status, branchId);
  } catch (err) {
    console.error(`[swarmStore] updateSwarmBranchStatus failed: ${err.message}`);
  }
}

/** Write Branch metrics after its mini Ratchet Loop finishes. */
export function updateSwarmBranchMetrics(branchId, bestMetric, totalTrials, acceptedTrials) {
  try {
    stmts.updateBranchMetrics.run(bestMetric, totalTrials, acceptedTrials, branchId);
  } catch (err) {
    console.error(`[swarmStore] updateSwarmBranchMetrics failed: ${err.message}`);
  }
}

/** Mark the branch Coordinator selected as the winner. */
export function selectSwarmBranch(branchId) {
  try {
    stmts.selectBranch.run(branchId);
  } catch (err) {
    console.error(`[swarmStore] selectSwarmBranch failed: ${err.message}`);
  }
}

/** Record why a branch was not selected. */
export function rejectSwarmBranch(branchId, reason) {
  try {
    stmts.rejectBranch.run(reason || 'not selected', branchId);
  } catch (err) {
    console.error(`[swarmStore] rejectSwarmBranch failed: ${err.message}`);
  }
}

/** Fetch a single branch row. */
export function getSwarmBranch(branchId) {
  try {
    return stmts.getBranch.get(branchId) || null;
  } catch (err) {
    console.error(`[swarmStore] getSwarmBranch failed: ${err.message}`);
    return null;
  }
}

/** Fetch all branches for a run, ordered by branch_index. */
export function listSwarmBranches(runId) {
  try {
    return stmts.listBranches.all(runId);
  } catch (err) {
    console.error(`[swarmStore] listSwarmBranches failed: ${err.message}`);
    return [];
  }
}

/** Return the branch that was selected by the Coordinator. */
export function getSelectedSwarmBranch(runId) {
  try {
    return stmts.getSelectedBranch.get(runId) || null;
  } catch (err) {
    console.error(`[swarmStore] getSelectedSwarmBranch failed: ${err.message}`);
    return null;
  }
}

// ── Coordinator Decision API ─────────────────────────────────────────────────

/**
 * Persist a Coordinator Agent decision for full auditability.
 * @returns {string} decisionId
 */
export function saveCoordinatorDecision(
  runId,
  phase,
  { inputSummary, outputRaw, parsedResult, agentSessionId } = {},
) {
  const id = randomUUID();
  try {
    stmts.saveDecision.run(
      id,
      runId,
      phase,
      inputSummary || null,
      outputRaw || null,
      parsedResult ? JSON.stringify(parsedResult) : null,
      agentSessionId || null,
    );
  } catch (err) {
    console.error(`[swarmStore] saveCoordinatorDecision failed: ${err.message}`);
  }
  return id;
}

/** Return all Coordinator decisions for a run (ordered chronologically). */
export function listCoordinatorDecisions(runId) {
  try {
    return stmts.listDecisions.all(runId).map((row) => ({
      ...row,
      parsedResult: row.parsed_result ? JSON.parse(row.parsed_result) : null,
    }));
  } catch (err) {
    console.error(`[swarmStore] listCoordinatorDecisions failed: ${err.message}`);
    return [];
  }
}
