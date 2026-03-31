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
    name        TEXT NOT NULL,
    description TEXT DEFAULT '',
    definition  TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workflow_runs (
    id           TEXT PRIMARY KEY,
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

const stmts = {
  createWorkflow: db.prepare(
    'INSERT INTO workflows (id, name, description, definition) VALUES (?, ?, ?, ?)',
  ),
  updateWorkflow: db.prepare(
    "UPDATE workflows SET name = ?, description = ?, definition = ?, updated_at = datetime('now') WHERE id = ?",
  ),
  getWorkflow: db.prepare('SELECT * FROM workflows WHERE id = ?'),
  listWorkflows: db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC LIMIT ? OFFSET ?'),
  countWorkflows: db.prepare('SELECT count(*) as total FROM workflows'),
  deleteWorkflow: db.prepare('DELETE FROM workflows WHERE id = ?'),

  createRun: db.prepare(
    'INSERT INTO workflow_runs (id, workflow_id, status, context) VALUES (?, ?, ?, ?)',
  ),
  updateRun: db.prepare(
    'UPDATE workflow_runs SET status = ?, context = ?, node_results = ?, error = ? WHERE id = ?',
  ),
  completeRun: db.prepare(
    "UPDATE workflow_runs SET status = ?, node_results = ?, completed_at = datetime('now'), error = ? WHERE id = ?",
  ),
  getRun: db.prepare('SELECT * FROM workflow_runs WHERE id = ?'),
  listRuns: db.prepare(
    'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ),
};

// --- Workflow CRUD ---

export function createWorkflow(name, description, definition) {
  const id = randomUUID();
  stmts.createWorkflow.run(id, name, description || '', JSON.stringify(definition));
  return id;
}

export function updateWorkflow(id, name, description, definition) {
  const result = stmts.updateWorkflow.run(name, description || '', JSON.stringify(definition), id);
  return result.changes > 0;
}

export function getWorkflow(id) {
  const row = stmts.getWorkflow.get(id);
  if (!row) return null;
  return { ...row, definition: JSON.parse(row.definition) };
}

export function listWorkflows(limit = 20, offset = 0) {
  const rows = stmts.listWorkflows.all(limit, offset);
  return rows.map((r) => ({ ...r, definition: JSON.parse(r.definition) }));
}

export function countWorkflows() {
  return stmts.countWorkflows.get()?.total || 0;
}

export function deleteWorkflow(id) {
  const result = stmts.deleteWorkflow.run(id);
  return result.changes > 0;
}

// --- Workflow Run CRUD ---

export function createWorkflowRun(workflowId, initialContext = {}) {
  const id = randomUUID();
  stmts.createRun.run(id, workflowId, 'pending', JSON.stringify(initialContext));
  return id;
}

export function updateWorkflowRun(id, { status, context, nodeResults, error }) {
  stmts.updateRun.run(
    status,
    JSON.stringify(context || {}),
    JSON.stringify(nodeResults || {}),
    error || null,
    id,
  );
}

export function completeWorkflowRun(id, { status, nodeResults, error }) {
  stmts.completeRun.run(status, JSON.stringify(nodeResults || {}), error || null, id);
}

export function getWorkflowRun(id) {
  const row = stmts.getRun.get(id);
  if (!row) return null;
  return {
    ...row,
    context: JSON.parse(row.context || '{}'),
    node_results: JSON.parse(row.node_results || '{}'),
  };
}

export function listWorkflowRuns(workflowId, limit = 20, offset = 0) {
  const rows = stmts.listRuns.all(workflowId, limit, offset);
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
