import { randomUUID } from 'node:crypto';
import supabase from './supabaseClient.js';

/**
 * Save an entity to the user's specific memory.
 */
export async function saveEntity(userId, name, type, content) {
  const now = Date.now();
  const { error } = await supabase
    .from('memory_entities')
    .upsert(
      { id: randomUUID(), user_id: userId, name, type, content, created_at: now, updated_at: now },
      { onConflict: 'user_id,name,type' },
    );
  if (error) {
    console.error(`[memoryStore] saveEntity failed: ${error.message}`);
    throw error;
  }
  return true;
}

/**
 * Save a relation between two entities.
 */
export async function saveRelation(userId, sourceName, targetName, relationType) {
  const { error } = await supabase.from('memory_relations').upsert(
    {
      id: randomUUID(),
      user_id: userId,
      source_entity_name: sourceName,
      target_entity_name: targetName,
      relation_type: relationType,
      created_at: Date.now(),
    },
    {
      onConflict: 'user_id,source_entity_name,target_entity_name,relation_type',
      ignoreDuplicates: true,
    },
  );
  if (error) {
    console.error(`[memoryStore] saveRelation failed: ${error.message}`);
    return false;
  }
  return true;
}

/**
 * Extract full context graph (Entities + Relations) for a given user.
 */
export async function getUserMemoryGraph(userId) {
  const { data: entities, error: eErr } = await supabase
    .from('memory_entities')
    .select('name, type, content')
    .eq('user_id', userId);
  if (eErr) {
    console.error(`[memoryStore] getUserMemoryGraph entities failed: ${eErr.message}`);
    return { entities: [], relations: [] };
  }

  const { data: relations, error: rErr } = await supabase
    .from('memory_relations')
    .select('source_entity_name, target_entity_name, relation_type')
    .eq('user_id', userId);
  if (rErr) {
    console.error(`[memoryStore] getUserMemoryGraph relations failed: ${rErr.message}`);
    return { entities, relations: [] };
  }

  return {
    entities,
    relations: relations.map((r) => ({
      source: r.source_entity_name,
      target: r.target_entity_name,
      relation: r.relation_type,
    })),
  };
}

export async function closeMemoryDb() {
  // No-op: Supabase client manages its own lifecycle
}
