import { randomUUID } from 'node:crypto';
import supabase from './supabaseClient.js';

export async function createSession(userId, prompt) {
  const id = randomUUID();
  const { error } = await supabase
    .from('sessions')
    .insert({ id, user_id: userId || 'default', prompt, status: 'running' });
  if (error) {
    console.error(`[sessionStore] createSession failed: ${error.message}`);
    throw error;
  }
  return id;
}

export async function updateSessionStatus(id, status, userId) {
  let q = supabase.from('sessions').update({ status }).eq('id', id);
  if (userId) q = q.eq('user_id', userId);
  const { error } = await q;
  if (error) {
    console.error(`[sessionStore] updateSessionStatus failed: ${error.message}`);
  }
}

export async function updateSessionStats(id, stats, userId) {
  let q = supabase.from('sessions').update({ stats }).eq('id', id);
  if (userId) q = q.eq('user_id', userId);
  const { error } = await q;
  if (error) {
    console.error(`[sessionStore] updateSessionStats failed: ${error.message}`);
  }
}

export async function updatePinnedContext(id, pinnedContextArray, userId) {
  let q = supabase.from('sessions').update({ pinned_context: pinnedContextArray }).eq('id', id);
  if (userId) q = q.eq('user_id', userId);
  const { error } = await q;
  if (error) {
    console.error(`[sessionStore] updatePinnedContext failed: ${error.message}`);
  }
}

export async function getSession(userId, id) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId || 'default')
    .maybeSingle();
  if (error) {
    console.error(`[sessionStore] getSession failed: ${error.message}`);
    return null;
  }
  return data;
}

export async function listSessions(userId, limit = 50) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId || 'default')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) {
    console.error(`[sessionStore] listSessions failed: ${error.message}`);
    return [];
  }
  return data;
}

export async function insertEvent(sessionId, type, content) {
  const { error } = await supabase
    .from('events')
    .insert({ session_id: sessionId, type, content, timestamp: Date.now() });
  if (error) {
    console.error(`[sessionStore] insertEvent failed: ${error.message}`);
  }
}

export async function getEvents(sessionId) {
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .eq('session_id', sessionId)
    .order('timestamp', { ascending: true });
  if (error) {
    console.error(`[sessionStore] getEvents failed: ${error.message}`);
    return [];
  }
  return data;
}

/**
 * Mark any "running" sessions as "interrupted" -- called on startup to clean stale state.
 */
export async function recoverStaleSessions() {
  const { data, error } = await supabase
    .from('sessions')
    .update({ status: 'interrupted' })
    .eq('status', 'running')
    .select('id');
  if (error) {
    console.error(`[sessionStore] recoverStaleSessions failed: ${error.message}`);
    return 0;
  }
  const changes = data?.length || 0;
  if (changes > 0) {
    console.log(`[sessionStore] Recovered ${changes} stale session(s)`);
  }
  return changes;
}

export async function listSessionsPaged(userId, limit = 20, offset = 0) {
  const { data, error } = await supabase
    .from('sessions')
    .select('*')
    .eq('user_id', userId || 'default')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error(`[sessionStore] listSessionsPaged failed: ${error.message}`);
    return [];
  }
  return data;
}

export async function countSessions(userId) {
  const { count, error } = await supabase
    .from('sessions')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId || 'default');
  if (error) {
    console.error(`[sessionStore] countSessions failed: ${error.message}`);
    return 0;
  }
  return count || 0;
}

export async function countEvents(sessionId) {
  const { count, error } = await supabase
    .from('events')
    .select('*', { count: 'exact', head: true })
    .eq('session_id', sessionId);
  if (error) {
    console.error(`[sessionStore] countEvents failed: ${error.message}`);
    return 0;
  }
  return count || 0;
}

/**
 * Delete a session and all its events.
 * Events are cascade-deleted by the FK constraint in PostgreSQL.
 */
export async function deleteSession(userId, sessionId) {
  const { data, error } = await supabase
    .from('sessions')
    .delete()
    .eq('id', sessionId)
    .eq('user_id', userId || 'default')
    .select('id');
  if (error) {
    console.error(`[sessionStore] deleteSession failed: ${error.message}`);
    return false;
  }
  return (data?.length || 0) > 0;
}

/**
 * Return which of `ids` exist and belong to userId (single round-trip).
 */
export async function filterSessionIdsOwned(userId, ids) {
  if (!ids.length) return [];
  const uid = userId || 'default';
  const { data, error } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', uid)
    .in('id', ids);
  if (error) {
    console.error(`[sessionStore] filterSessionIdsOwned failed: ${error.message}`);
    return [];
  }
  return (data || []).map((r) => r.id);
}

/**
 * Delete many sessions in one request (FK cascade removes events).
 */
export async function deleteSessionsBatch(userId, ids) {
  if (!ids.length) return 0;
  const uid = userId || 'default';
  const { data, error } = await supabase
    .from('sessions')
    .delete()
    .eq('user_id', uid)
    .in('id', ids)
    .select('id');
  if (error) {
    console.error(`[sessionStore] deleteSessionsBatch failed: ${error.message}`);
    return 0;
  }
  return data?.length || 0;
}

export async function close() {
  // No-op: Supabase client manages its own lifecycle
}
