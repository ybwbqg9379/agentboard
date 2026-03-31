import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import config from './config.js';

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

// Initialize Memory Knowledge Graph Tables
// We use a simple Entity-Relation-Entity graph architecture
db.exec(`
  CREATE TABLE IF NOT EXISTS memory_entities (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(user_id, name, type)
  );

  CREATE TABLE IF NOT EXISTS memory_relations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_entity_name TEXT NOT NULL,
    target_entity_name TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, source_entity_name, target_entity_name, relation_type)
  );

  CREATE INDEX IF NOT EXISTS idx_mem_entities_user ON memory_entities(user_id);
  CREATE INDEX IF NOT EXISTS idx_mem_relations_user ON memory_relations(user_id);
`);

/**
 * Save an entity to the user's specific memory.
 */
export function saveEntity(userId, name, type, content) {
  const stmt = db.prepare(`
    INSERT INTO memory_entities (id, user_id, name, type, content, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, name, type) DO UPDATE SET
      content = excluded.content,
      updated_at = excluded.updated_at
  `);
  stmt.run(crypto.randomUUID(), userId, name, type, content, Date.now(), Date.now());
  return true;
}

/**
 * Save a relation between two entities.
 */
export function saveRelation(userId, sourceName, targetName, relationType) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO memory_relations (id, user_id, source_entity_name, target_entity_name, relation_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    crypto.randomUUID(),
    userId,
    sourceName,
    targetName,
    relationType,
    Date.now(),
  );
  return info.changes > 0;
}

/**
 * Extract full context graph (Entities + Relations) for a given user.
 * In a massive environment we would retrieve by keyword, but a simple user scope is sufficient for small personal graphs.
 */
export function getUserMemoryGraph(userId) {
  const entities = db
    .prepare('SELECT name, type, content FROM memory_entities WHERE user_id = ?')
    .all(userId);
  const relations = db
    .prepare(
      'SELECT source_entity_name as source, target_entity_name as target, relation_type as relation FROM memory_relations WHERE user_id = ?',
    )
    .all(userId);
  return { entities, relations };
}
