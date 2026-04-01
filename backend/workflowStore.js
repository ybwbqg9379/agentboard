/**
 * Workflow persistence layer -- SQLite storage for workflow definitions and run history.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import config from './config.js';

const dbPath = config.dbPath.replace('.db', '-workflows.db');
mkdirSync(dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS workflows (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL DEFAULT 'default',
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    definition  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL DEFAULT 'default',
    workflow_id  TEXT NOT NULL REFERENCES workflows(id),
    status       TEXT NOT NULL DEFAULT 'pending',
    context      TEXT DEFAULT '{}',
    node_results TEXT DEFAULT '{}',
    error        TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
`);

try {
  const tableInfoW = db.pragma('table_info(workflows)');
  if (!tableInfoW.some((col) => col.name === 'user_id')) {
    db.exec(`ALTER TABLE workflows ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
  }
  const tableInfoR = db.pragma('table_info(workflow_runs)');
  if (!tableInfoR.some((col) => col.name === 'user_id')) {
    db.exec(`ALTER TABLE workflow_runs ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
  }
} catch (e) {
  console.error('[workflowStore] Migration failed:', e);
}

const stmts = {
  createWorkflow: db.prepare(
    'INSERT INTO workflows (id, user_id, name, description, definition) VALUES (?, ?, ?, ?, ?)',
  ),
  updateWorkflow: db.prepare(
    "UPDATE workflows SET name = ?, description = ?, definition = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
  ),
  getWorkflow: db.prepare('SELECT * FROM workflows WHERE id = ? AND user_id = ?'),
  listWorkflows: db.prepare(
    'SELECT * FROM workflows WHERE user_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?',
  ),
  countWorkflows: db.prepare('SELECT count(*) as total FROM workflows WHERE user_id = ?'),
  deleteWorkflow: db.prepare('DELETE FROM workflows WHERE id = ? AND user_id = ?'),

  createRun: db.prepare(
    'INSERT INTO workflow_runs (id, user_id, workflow_id, status, context) VALUES (?, ?, ?, ?, ?)',
  ),
  updateRun: db.prepare(
    'UPDATE workflow_runs SET status = ?, context = ?, node_results = ?, error = ? WHERE id = ?',
  ),
  completeRun: db.prepare(
    "UPDATE workflow_runs SET status = ?, node_results = ?, completed_at = datetime('now'), error = ? WHERE id = ?",
  ),
  getRun: db.prepare('SELECT * FROM workflow_runs WHERE id = ? AND user_id = ?'),
  listRuns: db.prepare(
    'SELECT * FROM workflow_runs WHERE workflow_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ),
  deleteWorkflowRuns: db.prepare('DELETE FROM workflow_runs WHERE workflow_id = ?'),
};

// --- Workflow CRUD ---

export function createWorkflow(userId, name, description, definition) {
  try {
    const id = randomUUID();
    stmts.createWorkflow.run(
      id,
      userId || 'default',
      name,
      description || '',
      JSON.stringify(definition),
    );
    return id;
  } catch (err) {
    console.error(`[workflowStore] createWorkflow failed: ${err.message}`);
    throw err;
  }
}

export function updateWorkflow(userId, id, name, description, definition) {
  try {
    const result = stmts.updateWorkflow.run(
      name,
      description || '',
      JSON.stringify(definition),
      id,
      userId || 'default',
    );
    return result.changes > 0;
  } catch (err) {
    console.error(`[workflowStore] updateWorkflow failed: ${err.message}`);
    throw err;
  }
}

export function getWorkflow(userId, id) {
  const row = stmts.getWorkflow.get(id, userId || 'default');
  if (!row) return null;
  return { ...row, definition: JSON.parse(row.definition) };
}

export function listWorkflows(userId, limit = 20, offset = 0) {
  const rows = stmts.listWorkflows.all(userId || 'default', limit, offset);
  return rows.map((r) => ({ ...r, definition: JSON.parse(r.definition) }));
}

export function countWorkflows(userId) {
  return stmts.countWorkflows.get(userId || 'default')?.total || 0;
}

export function deleteWorkflow(userId, id) {
  try {
    // Cascade: delete all runs referencing this workflow first
    stmts.deleteWorkflowRuns.run(id);
    const result = stmts.deleteWorkflow.run(id, userId || 'default');
    return result.changes > 0;
  } catch (err) {
    console.error(`[workflowStore] deleteWorkflow failed: ${err.message}`);
    throw err;
  }
}

// --- Workflow Run CRUD ---

export function createWorkflowRun(userId, workflowId, initialContext = {}, runId = randomUUID()) {
  try {
    const id = runId;
    stmts.createRun.run(
      id,
      userId || 'default',
      workflowId,
      'pending',
      JSON.stringify(initialContext),
    );
    return id;
  } catch (err) {
    console.error(`[workflowStore] createWorkflowRun failed: ${err.message}`);
    throw err;
  }
}

export function updateWorkflowRun(id, { status, context, nodeResults, error }) {
  try {
    stmts.updateRun.run(
      status,
      JSON.stringify(context || {}),
      JSON.stringify(nodeResults || {}),
      error || null,
      id,
    );
  } catch (err) {
    console.error(`[workflowStore] updateWorkflowRun failed: ${err.message}`);
  }
}

export function completeWorkflowRun(id, { status, nodeResults, error }) {
  try {
    stmts.completeRun.run(status, JSON.stringify(nodeResults || {}), error || null, id);
  } catch (err) {
    console.error(`[workflowStore] completeWorkflowRun failed: ${err.message}`);
  }
}

export function getWorkflowRun(userId, id) {
  const row = stmts.getRun.get(id, userId || 'default');
  if (!row) return null;
  return {
    ...row,
    context: JSON.parse(row.context || '{}'),
    node_results: JSON.parse(row.node_results || '{}'),
  };
}

export function listWorkflowRuns(userId, workflowId, limit = 20, offset = 0) {
  const rows = stmts.listRuns.all(workflowId, userId || 'default', limit, offset);
  return rows.map((r) => ({
    ...r,
    context: JSON.parse(r.context || '{}'),
    node_results: JSON.parse(r.node_results || '{}'),
  }));
}

export function closeWorkflowDb() {
  try {
    db.close();
  } catch {
    /* ignore */
  }
}
