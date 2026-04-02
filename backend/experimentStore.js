import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import config from './config.js';

// Reuse the same DB file as sessionStore to keep data colocated
mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/** Shared DB connection for modules that need the same experiment database. */
export { db as experimentDb };

db.exec(`
  CREATE TABLE IF NOT EXISTS experiments (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'default',
    name        TEXT NOT NULL,
    description TEXT,
    plan        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft',
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS experiment_runs (
    id               TEXT PRIMARY KEY,
    experiment_id    TEXT NOT NULL REFERENCES experiments(id),
    user_id          TEXT NOT NULL DEFAULT 'default',
    status           TEXT NOT NULL DEFAULT 'running',
    best_metric      REAL,
    baseline_metric  REAL,
    total_trials     INTEGER NOT NULL DEFAULT 0,
    accepted_trials  INTEGER NOT NULL DEFAULT 0,
    error_message    TEXT,
    started_at       TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at     TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_runs_experiment ON experiment_runs(experiment_id);

  CREATE TABLE IF NOT EXISTS trials (
    id              TEXT PRIMARY KEY,
    run_id          TEXT NOT NULL REFERENCES experiment_runs(id),
    trial_number    INTEGER NOT NULL,
    accepted        INTEGER NOT NULL DEFAULT 0,
    primary_metric  REAL,
    all_metrics     TEXT,
    diff            TEXT,
    agent_session_id TEXT,
    reason          TEXT,
    duration_ms     INTEGER,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_trials_run ON trials(run_id);
`);

const stmts = {
  // --- Experiments ---
  createExperiment: db.prepare(
    `INSERT INTO experiments (id, user_id, name, description, plan, status) VALUES (?, ?, ?, ?, ?, ?)`,
  ),
  getExperiment: db.prepare(`SELECT * FROM experiments WHERE id = ? AND user_id = ?`),
  listExperiments: db.prepare(
    `SELECT * FROM experiments WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ),
  countExperiments: db.prepare(`SELECT count(*) as total FROM experiments WHERE user_id = ?`),
  updateExperiment: db.prepare(
    `UPDATE experiments SET name = ?, description = ?, plan = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
  ),
  updateExperimentStatus: db.prepare(
    `UPDATE experiments SET status = ?, updated_at = datetime('now') WHERE id = ?`,
  ),
  deleteExperiment: db.prepare(`DELETE FROM experiments WHERE id = ? AND user_id = ?`),

  // --- Runs ---
  createRun: db.prepare(
    `INSERT INTO experiment_runs (id, experiment_id, user_id, status) VALUES (?, ?, ?, 'running')`,
  ),
  getRun: db.prepare(`SELECT * FROM experiment_runs WHERE id = ?`),
  getRunOwned: db.prepare(`SELECT * FROM experiment_runs WHERE id = ? AND user_id = ?`),
  listRuns: db.prepare(
    `SELECT * FROM experiment_runs WHERE experiment_id = ? AND user_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`,
  ),
  updateRunStatus: db.prepare(
    `UPDATE experiment_runs SET status = ?, completed_at = CASE WHEN ? IN ('completed','aborted','failed') THEN datetime('now') ELSE completed_at END WHERE id = ?`,
  ),
  updateRunMetrics: db.prepare(
    `UPDATE experiment_runs SET best_metric = ?, total_trials = ?, accepted_trials = ? WHERE id = ?`,
  ),
  updateRunBaseline: db.prepare(`UPDATE experiment_runs SET baseline_metric = ? WHERE id = ?`),
  updateRunError: db.prepare(`UPDATE experiment_runs SET error_message = ? WHERE id = ?`),
  recoverStaleRuns: db.prepare(
    `UPDATE experiment_runs SET status = 'interrupted' WHERE status = 'running'`,
  ),

  // --- Trials ---
  createTrial: db.prepare(
    `INSERT INTO trials (id, run_id, trial_number, accepted, primary_metric, all_metrics, diff, agent_session_id, reason, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  listTrials: db.prepare(
    `SELECT * FROM trials WHERE run_id = ? ORDER BY trial_number ASC LIMIT ? OFFSET ?`,
  ),
  countTrials: db.prepare(`SELECT count(*) as total FROM trials WHERE run_id = ?`),
  getBestTrialAsc: db.prepare(
    `SELECT * FROM trials WHERE run_id = ? AND accepted = 1 ORDER BY primary_metric ASC LIMIT 1`,
  ),
  getBestTrialDesc: db.prepare(
    `SELECT * FROM trials WHERE run_id = ? AND accepted = 1 ORDER BY primary_metric DESC LIMIT 1`,
  ),
};

// ── Experiments ──

export function createExperiment(userId, name, description, plan) {
  const id = randomUUID();
  try {
    stmts.createExperiment.run(
      id,
      userId || 'default',
      name,
      description || '',
      JSON.stringify(plan),
      'draft',
    );
  } catch (err) {
    console.error(`[experimentStore] createExperiment failed: ${err.message}`);
    throw err;
  }
  return id;
}

export function getExperiment(userId, id) {
  try {
    const row = stmts.getExperiment.get(id, userId || 'default');
    if (row && row.plan) row.plan = JSON.parse(row.plan);
    return row || null;
  } catch (err) {
    console.error(`[experimentStore] getExperiment failed: ${err.message}`);
    return null;
  }
}

export function listExperiments(userId, limit = 20, offset = 0) {
  try {
    const rows = stmts.listExperiments.all(userId || 'default', limit, offset);
    return rows.map((r) => ({ ...r, plan: JSON.parse(r.plan) }));
  } catch (err) {
    console.error(`[experimentStore] listExperiments failed: ${err.message}`);
    return [];
  }
}

export function countExperiments(userId) {
  try {
    return stmts.countExperiments.get(userId || 'default')?.total || 0;
  } catch (err) {
    console.error(`[experimentStore] countExperiments failed: ${err.message}`);
    return 0;
  }
}

export function updateExperiment(userId, id, name, description, plan) {
  try {
    const result = stmts.updateExperiment.run(
      name,
      description || '',
      JSON.stringify(plan),
      id,
      userId || 'default',
    );
    return result.changes > 0;
  } catch (err) {
    console.error(`[experimentStore] updateExperiment failed: ${err.message}`);
    return false;
  }
}

export function deleteExperiment(userId, id) {
  try {
    const result = stmts.deleteExperiment.run(id, userId || 'default');
    return result.changes > 0;
  } catch (err) {
    console.error(`[experimentStore] deleteExperiment failed: ${err.message}`);
    return false;
  }
}

// ── Runs ──

export function createRun(userId, experimentId) {
  const id = randomUUID();
  try {
    stmts.createRun.run(id, experimentId, userId || 'default');
    stmts.updateExperimentStatus.run('running', experimentId);
  } catch (err) {
    console.error(`[experimentStore] createRun failed: ${err.message}`);
    throw err;
  }
  return id;
}

export function getRun(runId) {
  try {
    return stmts.getRun.get(runId) || null;
  } catch (err) {
    console.error(`[experimentStore] getRun failed: ${err.message}`);
    return null;
  }
}

export function getRunOwned(userId, runId) {
  try {
    return stmts.getRunOwned.get(runId, userId || 'default') || null;
  } catch (err) {
    console.error(`[experimentStore] getRunOwned failed: ${err.message}`);
    return null;
  }
}

export function listRuns(userId, experimentId, limit = 20, offset = 0) {
  try {
    return stmts.listRuns.all(experimentId, userId || 'default', limit, offset);
  } catch (err) {
    console.error(`[experimentStore] listRuns failed: ${err.message}`);
    return [];
  }
}

export function updateRunStatus(runId, status) {
  try {
    stmts.updateRunStatus.run(status, status, runId);
  } catch (err) {
    console.error(`[experimentStore] updateRunStatus failed: ${err.message}`);
  }
}

export function updateRunMetrics(runId, bestMetric, totalTrials, acceptedTrials) {
  try {
    stmts.updateRunMetrics.run(bestMetric, totalTrials, acceptedTrials, runId);
  } catch (err) {
    console.error(`[experimentStore] updateRunMetrics failed: ${err.message}`);
  }
}

export function updateRunBaseline(runId, baseline) {
  try {
    stmts.updateRunBaseline.run(baseline, runId);
  } catch (err) {
    console.error(`[experimentStore] updateRunBaseline failed: ${err.message}`);
  }
}

export function updateRunError(runId, message) {
  try {
    stmts.updateRunError.run(message, runId);
  } catch (err) {
    console.error(`[experimentStore] updateRunError failed: ${err.message}`);
  }
}

export function recoverStaleRuns() {
  try {
    const result = stmts.recoverStaleRuns.run();
    if (result.changes > 0) {
      console.log(`[experimentStore] Recovered ${result.changes} stale experiment run(s)`);
    }
    return result.changes;
  } catch (err) {
    console.error(`[experimentStore] recoverStaleRuns failed: ${err.message}`);
    return 0;
  }
}

// ── Trials ──

export function saveTrial(runId, trialNumber, data) {
  const id = randomUUID();
  try {
    stmts.createTrial.run(
      id,
      runId,
      trialNumber,
      data.accepted ? 1 : 0,
      data.primaryMetric ?? null,
      data.allMetrics ? JSON.stringify(data.allMetrics) : null,
      data.diff || null,
      data.agentSessionId || null,
      data.reason || null,
      data.durationMs || null,
    );
  } catch (err) {
    console.error(`[experimentStore] saveTrial failed: ${err.message}`);
  }
  return id;
}

export function listTrials(runId, limit = 200, offset = 0) {
  try {
    const rows = stmts.listTrials.all(runId, limit, offset);
    return rows.map((r) => ({
      ...r,
      accepted: Boolean(r.accepted),
      allMetrics: r.all_metrics ? JSON.parse(r.all_metrics) : null,
    }));
  } catch (err) {
    console.error(`[experimentStore] listTrials failed: ${err.message}`);
    return [];
  }
}

export function countTrials(runId) {
  try {
    return stmts.countTrials.get(runId)?.total || 0;
  } catch (err) {
    console.error(`[experimentStore] countTrials failed: ${err.message}`);
    return 0;
  }
}

export function getBestTrial(runId, direction = 'minimize') {
  try {
    const stmt = direction === 'maximize' ? stmts.getBestTrialDesc : stmts.getBestTrialAsc;
    const row = stmt.get(runId);
    if (row) {
      row.accepted = Boolean(row.accepted);
      row.allMetrics = row.all_metrics ? JSON.parse(row.all_metrics) : null;
    }
    return row || null;
  } catch (err) {
    console.error(`[experimentStore] getBestTrial failed: ${err.message}`);
    return null;
  }
}

export function closeExperimentDb() {
  try {
    db.close();
  } catch (err) {
    console.error(`[experimentStore] close failed: ${err.message}`);
  }
}
