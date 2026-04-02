/**
 * swarmStore.js
 *
 * Persistent storage for Research Swarm (P3).
 * Manages swarm_branches and swarm_coordinator_decisions tables.
 */

import { randomUUID } from 'node:crypto';
import supabase from './supabaseClient.js';

// ── Branch API ───────────────────────────────────────────────────────────────

/**
 * Register a new research branch.
 * @returns {Promise<string>} branchId
 */
export async function createSwarmBranch(runId, branchIndex, hypothesis, workspaceDir) {
  const id = randomUUID();
  const { error } = await supabase.from('swarm_branches').insert({
    id,
    run_id: runId,
    branch_index: branchIndex,
    hypothesis,
    workspace_dir: workspaceDir,
  });
  if (error) {
    console.error(`[swarmStore] createSwarmBranch failed: ${error.message}`);
    throw error;
  }
  return id;
}

/** Update the lifecycle status of a branch (running | completed | failed). */
export async function updateSwarmBranchStatus(branchId, status) {
  const updates = { status };
  if (['completed', 'failed'].includes(status)) {
    updates.completed_at = new Date().toISOString();
  }
  const { error } = await supabase.from('swarm_branches').update(updates).eq('id', branchId);
  if (error) {
    console.error(`[swarmStore] updateSwarmBranchStatus failed: ${error.message}`);
  }
}

/** Write Branch metrics after its mini Ratchet Loop finishes. */
export async function updateSwarmBranchMetrics(branchId, bestMetric, totalTrials, acceptedTrials) {
  const { error } = await supabase
    .from('swarm_branches')
    .update({ best_metric: bestMetric, total_trials: totalTrials, accepted_trials: acceptedTrials })
    .eq('id', branchId);
  if (error) {
    console.error(`[swarmStore] updateSwarmBranchMetrics failed: ${error.message}`);
  }
}

/** Mark the branch Coordinator selected as the winner. */
export async function selectSwarmBranch(branchId) {
  const { error } = await supabase
    .from('swarm_branches')
    .update({ is_selected: true })
    .eq('id', branchId);
  if (error) {
    console.error(`[swarmStore] selectSwarmBranch failed: ${error.message}`);
  }
}

/** Record why a branch was not selected. */
export async function rejectSwarmBranch(branchId, reason) {
  const { error } = await supabase
    .from('swarm_branches')
    .update({ is_selected: false, rejection_reason: reason || 'not selected' })
    .eq('id', branchId);
  if (error) {
    console.error(`[swarmStore] rejectSwarmBranch failed: ${error.message}`);
  }
}

/** Fetch a single branch row. */
export async function getSwarmBranch(branchId) {
  const { data, error } = await supabase
    .from('swarm_branches')
    .select('*')
    .eq('id', branchId)
    .maybeSingle();
  if (error) {
    console.error(`[swarmStore] getSwarmBranch failed: ${error.message}`);
    return null;
  }
  return data;
}

/** Fetch all branches for a run, ordered by branch_index. */
export async function listSwarmBranches(runId) {
  const { data, error } = await supabase
    .from('swarm_branches')
    .select('*')
    .eq('run_id', runId)
    .order('branch_index', { ascending: true });
  if (error) {
    console.error(`[swarmStore] listSwarmBranches failed: ${error.message}`);
    return [];
  }
  return data;
}

/** Return the branch that was selected by the Coordinator. */
export async function getSelectedSwarmBranch(runId) {
  const { data, error } = await supabase
    .from('swarm_branches')
    .select('*')
    .eq('run_id', runId)
    .eq('is_selected', true)
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[swarmStore] getSelectedSwarmBranch failed: ${error.message}`);
    return null;
  }
  return data;
}

// ── Coordinator Decision API ─────────────────────────────────────────────────

/**
 * Persist a Coordinator Agent decision for full auditability.
 * @returns {Promise<string>} decisionId
 */
export async function saveCoordinatorDecision(
  runId,
  phase,
  { inputSummary, outputRaw, parsedResult, agentSessionId } = {},
) {
  const id = randomUUID();
  const { error } = await supabase.from('swarm_coordinator_decisions').insert({
    id,
    run_id: runId,
    phase,
    input_summary: inputSummary || null,
    output_raw: outputRaw || null,
    parsed_result: parsedResult || null,
    agent_session_id: agentSessionId || null,
  });
  if (error) {
    console.error(`[swarmStore] saveCoordinatorDecision failed: ${error.message}`);
  }
  return id;
}

/** Return all Coordinator decisions for a run (ordered chronologically). */
export async function listCoordinatorDecisions(runId) {
  const { data, error } = await supabase
    .from('swarm_coordinator_decisions')
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error(`[swarmStore] listCoordinatorDecisions failed: ${error.message}`);
    return [];
  }
  return data.map((row) => ({
    ...row,
    parsedResult: row.parsed_result,
  }));
}
