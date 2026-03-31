import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import config from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id        TEXT PRIMARY KEY,
    prompt    TEXT NOT NULL,
    status    TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    type       TEXT NOT NULL,
    content    TEXT NOT NULL,
    timestamp  INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
`);

const stmts = {
  createSession: db.prepare('INSERT INTO sessions (id, prompt, status) VALUES (?, ?, ?)'),
  updateStatus: db.prepare('UPDATE sessions SET status = ? WHERE id = ?'),
  getSession: db.prepare('SELECT * FROM sessions WHERE id = ?'),
  listSessions: db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?'),
  insertEvent: db.prepare(
    'INSERT INTO events (session_id, type, content, timestamp) VALUES (?, ?, ?, ?)',
  ),
  getEvents: db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC'),
};

export function createSession(prompt) {
  const id = randomUUID();
  stmts.createSession.run(id, prompt, 'running');
  return id;
}

export function updateSessionStatus(id, status) {
  stmts.updateStatus.run(status, id);
}

export function getSession(id) {
  return stmts.getSession.get(id);
}

export function listSessions(limit = 50) {
  return stmts.listSessions.all(limit);
}

export function insertEvent(sessionId, type, content) {
  stmts.insertEvent.run(sessionId, type, JSON.stringify(content), Date.now());
}

export function getEvents(sessionId) {
  const rows = stmts.getEvents.all(sessionId);
  return rows.map((r) => ({ ...r, content: JSON.parse(r.content) }));
}

export function close() {
  db.close();
}
