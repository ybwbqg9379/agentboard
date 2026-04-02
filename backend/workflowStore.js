/**
 * Workflow persistence layer -- Supabase storage for workflow definitions and run history.
 */

import { randomUUID } from 'node:crypto';
import supabase from './supabaseClient.js';

// --- Workflow CRUD ---

export async function createWorkflow(userId, name, description, definition) {
  const id = randomUUID();
  const { error } = await supabase.from('workflows').insert({
    id,
    user_id: userId || 'default',
    name,
    description: description || '',
    definition,
  });
  if (error) {
    console.error(`[workflowStore] createWorkflow failed: ${error.message}`);
    throw error;
  }
  return id;
}

export async function updateWorkflow(userId, id, name, description, definition) {
  const { data, error } = await supabase
    .from('workflows')
    .update({
      name,
      description: description || '',
      definition,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId || 'default')
    .select('id');
  if (error) {
    console.error(`[workflowStore] updateWorkflow failed: ${error.message}`);
    throw error;
  }
  return (data?.length || 0) > 0;
}

export async function getWorkflow(userId, id) {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId || 'default')
    .maybeSingle();
  if (error) {
    console.error(`[workflowStore] getWorkflow failed: ${error.message}`);
    return null;
  }
  return data;
}

export async function listWorkflows(userId, limit = 20, offset = 0) {
  const { data, error } = await supabase
    .from('workflows')
    .select('*')
    .eq('user_id', userId || 'default')
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error(`[workflowStore] listWorkflows failed: ${error.message}`);
    return [];
  }
  return data;
}

export async function countWorkflows(userId) {
  const { count, error } = await supabase
    .from('workflows')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId || 'default');
  if (error) {
    console.error(`[workflowStore] countWorkflows failed: ${error.message}`);
    return 0;
  }
  return count || 0;
}

/**
 * Delete a workflow and all its runs.
 * Workflow runs are cascade-deleted by the FK constraint in PostgreSQL.
 */
export async function deleteWorkflow(userId, id) {
  const { data, error } = await supabase
    .from('workflows')
    .delete()
    .eq('id', id)
    .eq('user_id', userId || 'default')
    .select('id');
  if (error) {
    console.error(`[workflowStore] deleteWorkflow failed: ${error.message}`);
    throw error;
  }
  return (data?.length || 0) > 0;
}

// --- Workflow Run CRUD ---

export async function createWorkflowRun(
  userId,
  workflowId,
  initialContext = {},
  runId = randomUUID(),
) {
  const { error } = await supabase.from('workflow_runs').insert({
    id: runId,
    user_id: userId || 'default',
    workflow_id: workflowId,
    status: 'pending',
    context: initialContext,
  });
  if (error) {
    console.error(`[workflowStore] createWorkflowRun failed: ${error.message}`);
    throw error;
  }
  return runId;
}

export async function updateWorkflowRun(id, { status, context, nodeResults, error: runError }) {
  const { error } = await supabase
    .from('workflow_runs')
    .update({
      status,
      context: context || {},
      node_results: nodeResults || {},
      error: runError || null,
    })
    .eq('id', id);
  if (error) {
    console.error(`[workflowStore] updateWorkflowRun failed: ${error.message}`);
  }
}

export async function completeWorkflowRun(id, { status, nodeResults, error: runError }) {
  const { error } = await supabase
    .from('workflow_runs')
    .update({
      status,
      node_results: nodeResults || {},
      error: runError || null,
      completed_at: new Date().toISOString(),
    })
    .eq('id', id);
  if (error) {
    console.error(`[workflowStore] completeWorkflowRun failed: ${error.message}`);
  }
}

export async function getWorkflowRun(userId, id) {
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId || 'default')
    .maybeSingle();
  if (error) {
    console.error(`[workflowStore] getWorkflowRun failed: ${error.message}`);
    return null;
  }
  return data;
}

export async function listWorkflowRuns(userId, workflowId, limit = 20, offset = 0) {
  const { data, error } = await supabase
    .from('workflow_runs')
    .select('*')
    .eq('workflow_id', workflowId)
    .eq('user_id', userId || 'default')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error(`[workflowStore] listWorkflowRuns failed: ${error.message}`);
    return [];
  }
  return data;
}

export async function closeWorkflowDb() {
  // No-op: Supabase client manages its own lifecycle
}
