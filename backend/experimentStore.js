import { randomUUID } from 'node:crypto';
import supabase from './supabaseClient.js';

// ── Experiments ──

export async function createExperiment(userId, name, description, plan) {
  const id = randomUUID();
  const { error } = await supabase.from('experiments').insert({
    id,
    user_id: userId || 'default',
    name,
    description: description || '',
    plan,
    status: 'draft',
  });
  if (error) {
    console.error(`[experimentStore] createExperiment failed: ${error.message}`);
    throw error;
  }
  return id;
}

export async function getExperiment(userId, id) {
  const { data, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId || 'default')
    .maybeSingle();
  if (error) {
    console.error(`[experimentStore] getExperiment failed: ${error.message}`);
    return null;
  }
  return data;
}

export async function listExperiments(userId, limit = 20, offset = 0) {
  const { data, error } = await supabase
    .from('experiments')
    .select('*')
    .eq('user_id', userId || 'default')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error(`[experimentStore] listExperiments failed: ${error.message}`);
    return [];
  }
  return data;
}

export async function countExperiments(userId) {
  const { count, error } = await supabase
    .from('experiments')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId || 'default');
  if (error) {
    console.error(`[experimentStore] countExperiments failed: ${error.message}`);
    return 0;
  }
  return count || 0;
}

export async function updateExperiment(userId, id, name, description, plan) {
  const { data, error } = await supabase
    .from('experiments')
    .update({
      name,
      description: description || '',
      plan,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('user_id', userId || 'default')
    .select('id');
  if (error) {
    console.error(`[experimentStore] updateExperiment failed: ${error.message}`);
    return false;
  }
  return (data?.length || 0) > 0;
}

export async function deleteExperiment(userId, id) {
  const { data, error } = await supabase
    .from('experiments')
    .delete()
    .eq('id', id)
    .eq('user_id', userId || 'default')
    .select('id');
  if (error) {
    console.error(`[experimentStore] deleteExperiment failed: ${error.message}`);
    return false;
  }
  return (data?.length || 0) > 0;
}

// ── Runs ──

export async function createRun(userId, experimentId) {
  const id = randomUUID();
  const { error } = await supabase
    .from('experiment_runs')
    .insert({ id, experiment_id: experimentId, user_id: userId || 'default', status: 'running' });
  if (error) {
    console.error(`[experimentStore] createRun failed: ${error.message}`);
    throw error;
  }
  // Also mark the experiment as running
  await supabase
    .from('experiments')
    .update({ status: 'running', updated_at: new Date().toISOString() })
    .eq('id', experimentId);
  return id;
}

export async function getRun(runId) {
  const { data, error } = await supabase
    .from('experiment_runs')
    .select('*')
    .eq('id', runId)
    .maybeSingle();
  if (error) {
    console.error(`[experimentStore] getRun failed: ${error.message}`);
    return null;
  }
  return data;
}

export async function getRunOwned(userId, runId) {
  const { data, error } = await supabase
    .from('experiment_runs')
    .select('*')
    .eq('id', runId)
    .eq('user_id', userId || 'default')
    .maybeSingle();
  if (error) {
    console.error(`[experimentStore] getRunOwned failed: ${error.message}`);
    return null;
  }
  return data;
}

export async function listRuns(userId, experimentId, limit = 20, offset = 0) {
  const { data, error } = await supabase
    .from('experiment_runs')
    .select('*')
    .eq('experiment_id', experimentId)
    .eq('user_id', userId || 'default')
    .order('started_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error(`[experimentStore] listRuns failed: ${error.message}`);
    return [];
  }
  return data;
}

export async function updateRunStatus(runId, status, userId) {
  const updates = { status };
  if (['completed', 'aborted', 'failed'].includes(status)) {
    updates.completed_at = new Date().toISOString();
  }
  let q = supabase.from('experiment_runs').update(updates).eq('id', runId);
  if (userId) q = q.eq('user_id', userId);
  const { error } = await q;
  if (error) {
    console.error(`[experimentStore] updateRunStatus failed: ${error.message}`);
  }
}

export async function updateRunMetrics(runId, bestMetric, totalTrials, acceptedTrials, userId) {
  let q = supabase
    .from('experiment_runs')
    .update({ best_metric: bestMetric, total_trials: totalTrials, accepted_trials: acceptedTrials })
    .eq('id', runId);
  if (userId) q = q.eq('user_id', userId);
  const { error } = await q;
  if (error) {
    console.error(`[experimentStore] updateRunMetrics failed: ${error.message}`);
  }
}

export async function updateRunBaseline(runId, baseline, userId) {
  let q = supabase.from('experiment_runs').update({ baseline_metric: baseline }).eq('id', runId);
  if (userId) q = q.eq('user_id', userId);
  const { error } = await q;
  if (error) {
    console.error(`[experimentStore] updateRunBaseline failed: ${error.message}`);
  }
}

export async function updateRunError(runId, message, userId) {
  let q = supabase.from('experiment_runs').update({ error_message: message }).eq('id', runId);
  if (userId) q = q.eq('user_id', userId);
  const { error } = await q;
  if (error) {
    console.error(`[experimentStore] updateRunError failed: ${error.message}`);
  }
}

export async function recoverStaleRuns() {
  const { data, error } = await supabase
    .from('experiment_runs')
    .update({ status: 'interrupted' })
    .eq('status', 'running')
    .select('id');
  if (error) {
    console.error(`[experimentStore] recoverStaleRuns failed: ${error.message}`);
    return 0;
  }
  const changes = data?.length || 0;
  if (changes > 0) {
    console.log(`[experimentStore] Recovered ${changes} stale experiment run(s)`);
  }
  return changes;
}

// ── Trials ──

export async function saveTrial(runId, trialNumber, data) {
  const id = randomUUID();
  const { error } = await supabase.from('trials').insert({
    id,
    run_id: runId,
    trial_number: trialNumber,
    accepted: Boolean(data.accepted),
    primary_metric: data.primaryMetric ?? null,
    all_metrics: data.allMetrics || null,
    diff: data.diff || null,
    agent_session_id: data.agentSessionId || null,
    reason: data.reason || null,
    duration_ms: data.durationMs || null,
  });
  if (error) {
    console.error(`[experimentStore] saveTrial failed: ${error.message}`);
  }
  return id;
}

export async function listTrials(runId, limit = 200, offset = 0) {
  const { data, error } = await supabase
    .from('trials')
    .select('*')
    .eq('run_id', runId)
    .order('trial_number', { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) {
    console.error(`[experimentStore] listTrials failed: ${error.message}`);
    return [];
  }
  return data;
}

export async function countTrials(runId) {
  const { count, error } = await supabase
    .from('trials')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', runId);
  if (error) {
    console.error(`[experimentStore] countTrials failed: ${error.message}`);
    return 0;
  }
  return count || 0;
}

export async function getBestTrial(runId, direction = 'minimize') {
  const { data, error } = await supabase
    .from('trials')
    .select('*')
    .eq('run_id', runId)
    .eq('accepted', true)
    .order('primary_metric', { ascending: direction === 'minimize' })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`[experimentStore] getBestTrial failed: ${error.message}`);
    return null;
  }
  return data;
}

export async function closeExperimentDb() {
  // No-op: Supabase client manages its own lifecycle
}
