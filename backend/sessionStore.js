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
    user_id   TEXT NOT NULL DEFAULT 'default',
    prompt    TEXT NOT NULL,
    status    TEXT NOT NULL DEFAULT 'pending',
    stats     TEXT,
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

try {
  // Migration for user_id
  const tableInfo = db.pragma('table_info(sessions)');
  if (!tableInfo.some((col) => col.name === 'user_id')) {
    db.exec(`ALTER TABLE sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
  }
} catch (e) {
  console.error('[sessionStore] Migration failed:', e);
}

const stmts = {
  createSession: db.prepare(
    'INSERT INTO sessions (id, user_id, prompt, status) VALUES (?, ?, ?, ?)',
  ),
  updateStatus: db.prepare('UPDATE sessions SET status = ? WHERE id = ?'),
  updateStats: db.prepare('UPDATE sessions SET stats = ? WHERE id = ?'),
  getSession: db.prepare('SELECT * FROM sessions WHERE id = ? AND user_id = ?'),
  listSessions: db.prepare(
    'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
  ),
  listSessionsPaged: db.prepare(
    'SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
  ),
  countSessions: db.prepare('SELECT count(*) as total FROM sessions WHERE user_id = ?'),
  recoverStale: db.prepare("UPDATE sessions SET status = 'interrupted' WHERE status = 'running'"),
  insertEvent: db.prepare(
    'INSERT INTO events (session_id, type, content, timestamp) VALUES (?, ?, ?, ?)',
  ),
  getEvents: db.prepare('SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC'),
  countEvents: db.prepare('SELECT count(*) as total FROM events WHERE session_id = ?'),
};

export function createSession(userId, prompt) {
  const id = randomUUID();
  try {
    stmts.createSession.run(id, userId || 'default', prompt, 'running');
  } catch (err) {
    console.error(`[sessionStore] createSession failed: ${err.message}`);
    throw err;
  }
  return id;
}

export function updateSessionStatus(id, status) {
  try {
    stmts.updateStatus.run(status, id);
  } catch (err) {
    console.error(`[sessionStore] updateSessionStatus failed: ${err.message}`);
  }
}

export function updateSessionStats(id, stats) {
  try {
    stmts.updateStats.run(JSON.stringify(stats), id);
  } catch (err) {
    console.error(`[sessionStore] updateSessionStats failed: ${err.message}`);
  }
}

export function getSession(userId, id) {
  try {
    return stmts.getSession.get(id, userId || 'default');
  } catch (err) {
    console.error(`[sessionStore] getSession failed: ${err.message}`);
    return null;
  }
}

export function listSessions(userId, limit = 50) {
  try {
    return stmts.listSessions.all(userId || 'default', limit);
  } catch (err) {
    console.error(`[sessionStore] listSessions failed: ${err.message}`);
    return [];
  }
}

export function insertEvent(sessionId, type, content) {
  try {
    stmts.insertEvent.run(sessionId, type, JSON.stringify(content), Date.now());
  } catch (err) {
    console.error(`[sessionStore] insertEvent failed: ${err.message}`);
  }
}

export function getEvents(sessionId) {
  try {
    const rows = stmts.getEvents.all(sessionId);
    return rows.map((r) => ({ ...r, content: JSON.parse(r.content) }));
  } catch (err) {
    console.error(`[sessionStore] getEvents failed: ${err.message}`);
    return [];
  }
}

/**
 * Mark any "running" sessions as "interrupted" -- called on startup to clean stale state.
 */
export function recoverStaleSessions() {
  try {
    const result = stmts.recoverStale.run();
    if (result.changes > 0) {
      console.log(`[sessionStore] Recovered ${result.changes} stale session(s)`);
    }
    return result.changes;
  } catch (err) {
    console.error(`[sessionStore] recoverStaleSessions failed: ${err.message}`);
    return 0;
  }
}

export function listSessionsPaged(userId, limit = 20, offset = 0) {
  try {
    return stmts.listSessionsPaged.all(userId || 'default', limit, offset);
  } catch (err) {
    console.error(`[sessionStore] listSessionsPaged failed: ${err.message}`);
    return [];
  }
}

export function countSessions(userId) {
  try {
    return stmts.countSessions.get(userId || 'default')?.total || 0;
  } catch (err) {
    console.error(`[sessionStore] countSessions failed: ${err.message}`);
    return 0;
  }
}

export function countEvents(sessionId) {
  try {
    return stmts.countEvents.get(sessionId)?.total || 0;
  } catch (err) {
    console.error(`[sessionStore] countEvents failed: ${err.message}`);
    return 0;
  }
}

export function close() {
  try {
    db.close();
  } catch (err) {
    console.error(`[sessionStore] close failed: ${err.message}`);
  }
}
