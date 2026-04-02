/**
 * researchSwarm.js
 *
 * P3: Research Swarm — Multi-Agent parallel research orchestrator.
 *
 * Architecture (borrowed from Claude Code Coordinator/Worker pattern):
 *   1. Coordinator Agent decomposes the ResearchPlan into N hypotheses (branches)
 *   2. N Worker branches run in parallel, each in an isolated git-cloned workspace
 *      using P1's runExperimentLoop as their mini Ratchet Loop
 *   3. Coordinator Agent synthesizes branch results and selects the best direction
 *   4. Best branch workspace is merged back into the main workspace for further use
 *
 * Design decisions (confirmed):
 *   Q1: Keep best branch workspace, clean up rejected branches
 *   Q2: Unified model (config.llm.model) for all agents including Coordinator
 *   Q3: PORT isolation — each branch gets PORT = BASE_SWARM_PORT + branchIndex
 */

import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { resolve } from 'node:path';
import { startAgent } from './agentManager.js';
import { runExperimentLoop, abortExperiment } from './experimentEngine.js';
import {
  createSwarmBranch,
  updateSwarmBranchStatus,
  updateSwarmBranchMetrics,
  selectSwarmBranch,
  rejectSwarmBranch,
  saveCoordinatorDecision,
} from './swarmStore.js';
import { getRun } from './experimentStore.js';

export const swarmEvents = new EventEmitter();
swarmEvents.setMaxListeners(50);

// Active swarm map: runId → abortController
const activeSwarms = new Map();

// Port range for branch isolation (avoids collisions between parallel benchmarks)
const BASE_SWARM_PORT = 14000;

// ── Coordinator System Prompt ─────────────────────────────────────────────────

const COORDINATOR_SYSTEM_PROMPT = `
You are a Research Coordinator overseeing multiple parallel research branches.

CRITICAL RULES (inspired by Claude Code Coordinator principles):
1. NEVER fabricate or hallucinate results — only reason about what Workers actually produced.
2. NEVER merely relay output — YOU must analyze each branch result yourself before making a decision.
3. In Phase 1 (Decompose): produce distinct, non-overlapping research directions. Avoid redundancy.
4. In Phase 2 (Synthesize): provide concrete, metric-backed reasoning for your selection.
5. Always output structured tags. Machine parsing depends on these tags being correct.

OUTPUT FORMAT RULES:
- Phase 1 must output ONLY <hypothesis id="N">...</hypothesis> blocks, one per direction.
  Each hypothesis should be 1-3 sentences describing a concrete change to attempt.
- Phase 2 must output: <selected_branch id="N"/> and <reasoning>...</reasoning> block.
  Optionally: <notes>...</notes> for additional observations.
`.trim();

// ── XML Parsers ───────────────────────────────────────────────────────────────

/**
 * Parse <hypothesis id="N">text</hypothesis> blocks from Coordinator output.
 * @returns {Array<{id: number, text: string}>}
 */
function parseHypotheses(text) {
  const regex = /<hypothesis\s+id="(\d+)">([\s\S]*?)<\/hypothesis>/g;
  const results = [];
  let match;
  while ((match = regex.exec(text)) !== null) {
    const hyp = match[2].trim();
    if (hyp) results.push({ id: parseInt(match[1], 10), text: hyp });
  }
  return results;
}

/**
 * Parse <selected_branch id="N"/> and <reasoning>...</reasoning> from Coordinator output.
 * @returns {{ selectedId: number|null, reasoning: string }}
 */
function parseSelection(text) {
  const branchMatch = /<selected_branch\s+id="(\d+)"\s*\/?>/i.exec(text);
  const reasoningMatch = /<reasoning>([\s\S]*?)<\/reasoning>/i.exec(text);
  return {
    selectedId: branchMatch ? parseInt(branchMatch[1], 10) : null,
    reasoning: reasoningMatch ? reasoningMatch[1].trim() : 'No reasoning provided.',
  };
}

// ── Coordinator Prompts ───────────────────────────────────────────────────────

function buildDecomposePrompt(plan, branchCount) {
  return `You are about to coordinate a parallel research experiment.

## Research Goal
${plan.description || plan.name}

## Primary Metric
Command: ${plan.metrics?.primary?.command}
Direction: ${plan.metrics?.primary?.direction === 'minimize' ? 'Lower is better' : 'Higher is better'}

## Target Files (Workers may only modify these)
${plan.target?.files?.map((f) => `  - ${f}`).join('\n') || '  (no restriction — all files allowed)'}

## Agent Instructions
${plan.agent_instructions || 'Analyze and improve the code to optimize the metric.'}

## Your Task (Phase 1 — Decompose)
Generate exactly ${branchCount} distinct research hypotheses for parallel exploration.
Each hypothesis should propose a DIFFERENT optimization strategy.
Do NOT overlap: if one hypothesis covers learning rate tuning, another must NOT also cover learning rate.

Output ONLY hypothesis blocks, no other text:
<hypothesis id="0">first distinct approach</hypothesis>
<hypothesis id="1">second distinct approach</hypothesis>
...`;
}

function buildSynthesizePrompt(plan, branchSummaries) {
  const summaryText = branchSummaries
    .map(
      (b) =>
        `Branch ${b.branchIndex} — Hypothesis: "${b.hypothesis}"\n` +
        `  Status: ${b.status} | Best metric: ${b.bestMetric ?? 'N/A'} | ` +
        `Trials: ${b.totalTrials} (${b.acceptedTrials} accepted)`,
    )
    .join('\n\n');

  const direction =
    plan.metrics?.primary?.direction === 'minimize' ? 'lower is better' : 'higher is better';

  return `You are synthesizing results from ${branchSummaries.length} parallel research branches.

## Research Goal
${plan.description || plan.name}

## Metric Direction
${direction}

## Branch Results
${summaryText}

## Your Task (Phase 2 — Synthesize)
Analyze the results above. Select the single best branch to proceed with.
Consider: metric improvement, trial acceptance rate, and hypothesis quality.
For failed or stalled branches, explain why they underperformed.

Produce:
<selected_branch id="N"/>
<reasoning>Your concrete analysis and reasoning here</reasoning>`;
}

// Module-level reference to agentEvents bus, injected by initSwarmBus()
let _agentEventsBus = null;

/**
 * Start a Coordinator Agent session and wait for it to complete.
 * Resolves with the last assistant text message as structured output.
 *
 * @param {string} prompt
 * @param {string} workspaceDir
 * @param {string} userId
 * @param {AbortSignal} signal
 * @returns {Promise<{ text: string, sessionId: string }>}
 */
function runCoordinatorAgent(prompt, workspaceDir, userId, signal) {
  if (!_agentEventsBus) {
    return Promise.reject(
      new Error('[swarm] agentEvents bus not initialised — call initSwarmBus() first'),
    );
  }

  if (signal?.aborted) {
    return Promise.reject(new Error('Swarm aborted before Coordinator could start'));
  }

  return new Promise((resolveP, rejectP) => {
    let sessionId;
    let lastAssistantText = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      _agentEventsBus.removeListener('event', onAgentEvent);
      signal?.removeEventListener('abort', onAbort);
      if (result instanceof Error) rejectP(result);
      else resolveP(result);
    };

    // Listen directly on agentEvents bus (no re-emit layer needed)
    const onAgentEvent = (evt) => {
      if (evt.sessionId !== sessionId) return;

      // Capture the last assistant text — this is the Coordinator's structured output
      if (evt.type === 'message' && evt.content?.role === 'assistant') {
        const content = evt.content.content;
        if (typeof content === 'string') {
          lastAssistantText = content;
        } else if (Array.isArray(content)) {
          const texts = content.filter((b) => b.type === 'text').map((b) => b.text);
          if (texts.length) lastAssistantText = texts.join('\n');
        }
      }

      if (evt.type === 'done') {
        if (evt.content?.status === 'failed') {
          finish(new Error(`Coordinator agent failed: ${evt.content?.error || 'unknown'}`));
        } else {
          finish({ text: lastAssistantText, sessionId });
        }
      }
    };

    // Abort: stop the Coordinator Agent if the swarm is cancelled
    const onAbort = () => {
      if (sessionId && !settled) {
        // stopAgent is available via agentManager, but we avoid circular re-import.
        // Signal the bus — the agent's own abort controller will handle cleanup.
        finish(new Error('Swarm aborted'));
      }
    };

    _agentEventsBus.on('event', onAgentEvent);
    signal?.addEventListener('abort', onAbort);

    try {
      sessionId = startAgent(prompt, {
        userId,
        cwd: workspaceDir,
        maxTurns: 10,
        permissionMode: 'bypassPermissions',
        // Coordinator only needs Read access + shell inspection; no Write/Edit.
        // COORDINATOR_SYSTEM_PROMPT is appended via the systemPrompt.append field.
        systemPromptExtra: COORDINATOR_SYSTEM_PROMPT,
        _toolOverride: ['Read', 'Bash', 'Glob', 'Grep'],
      });
    } catch (err) {
      finish(err);
    }
  });
}

// ── Branch Isolation ──────────────────────────────────────────────────────────

/**
 * Run a command as an arg-array via spawnSync (no shell interpolation).
 * Throws on non-zero exit to match former execSync behaviour.
 */
function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, { stdio: 'pipe', ...opts });
  if (result.status !== 0) {
    const msg = result.stderr?.toString().trim() || `${cmd} exited with code ${result.status}`;
    throw new Error(msg);
  }
  return result;
}

/**
 * Create an isolated branch workspace by git-cloning the base workspace.
 * Uses --local to avoid transferring objects (fast, same filesystem).
 */
function cloneBranchWorkspace(baseWorkspaceDir, branchDir) {
  if (fs.existsSync(branchDir)) {
    fs.rmSync(branchDir, { recursive: true, force: true });
  }
  run('git', ['clone', baseWorkspaceDir, branchDir, '--local', '--no-hardlinks']);
}

/**
 * Merge best branch results back into the main workspace.
 * Strategy: copy the entire working tree (excluding .git) into the main workspace.
 */
function mergeBestBranchIntoMain(bestBranchDir, mainWorkspaceDir) {
  run('rsync', ['-a', '--exclude=.git', `${bestBranchDir}/`, `${mainWorkspaceDir}/`]);
  // Snapshot the merged state as a new commit in the main workspace.
  // Use -c flags for git identity since the workspace may lack global config.
  const gitOpts = { cwd: mainWorkspaceDir };
  run('git', ['add', '-A'], gitOpts);
  run(
    'git',
    [
      '-c',
      'user.email=swarm@agentboard',
      '-c',
      'user.name=AgentBoard Swarm',
      'commit',
      '-m',
      'autoresearch: merge best branch from swarm',
      '--allow-empty',
    ],
    gitOpts,
  );
}

/** Delete a rejected branch workspace. */
function cleanupBranchWorkspace(branchDir) {
  try {
    if (fs.existsSync(branchDir)) {
      fs.rmSync(branchDir, { recursive: true, force: true });
    }
  } catch {
    // Best-effort cleanup — not fatal
  }
}

// ── Branch Runner ─────────────────────────────────────────────────────────────

/**
 * Run a single research branch using P1's runExperimentLoop as the mini Ratchet.
 * Each branch gets an isolated workspace and its own PORT.
 *
 * @returns {Promise<{branchIndex: number, branchId: string, branchDir: string,
 *                    bestMetric: number|null, totalTrials: number, acceptedTrials: number,
 *                    hypothesis: string, status: string}>}
 */
async function runBranch(
  plan,
  hypothesis,
  branchIndex,
  branchId,
  baseWorkspaceDir,
  userId,
  swarmRunId,
  signal,
) {
  const branchDir = `${baseWorkspaceDir}-branch-${branchIndex}`;

  swarmEvents.emit('swarm_branch_start', {
    runId: swarmRunId,
    branchId,
    branchIndex,
    hypothesis: hypothesis.text,
    workspaceDir: branchDir,
  });

  try {
    // 1. Clone base workspace into isolated branch directory
    cloneBranchWorkspace(baseWorkspaceDir, branchDir);
    updateSwarmBranchStatus(branchId, 'running');

    // 2. Inject hypothesis into the plan's agent instructions
    const branchBudget = plan.swarm?.branch_budget || {};
    const branchPlan = {
      ...plan,
      agent_instructions: [
        `[RESEARCH DIRECTION FOR THIS BRANCH]`,
        `Your hypothesis: ${hypothesis.text}`,
        ``,
        `Focus ONLY on this specific approach. Do not explore other directions.`,
        ``,
        plan.agent_instructions || '',
      ]
        .join('\n')
        .trim(),
      budget: {
        max_experiments: branchBudget.max_experiments ?? plan.budget?.max_experiments ?? 5,
        max_consecutive_failures: plan.budget?.max_consecutive_failures ?? 3,
        time_per_experiment: plan.budget?.time_per_experiment ?? '5m',
        total_time: branchBudget.time_per_branch ?? '15m',
      },
    };

    // 3. Build PORT-isolated environment for this branch's benchmark commands.
    //    Port info is written into the branch workspace's CLAUDE.md so the Agent
    //    knows which port to use. We also set a process.env var so child processes
    //    can reference it, and clean it up in the outer finally block.
    const branchPort = BASE_SWARM_PORT + branchIndex;
    const envKey = `SWARM_BRANCH_PORT_${branchIndex}`;
    process.env[envKey] = String(branchPort);

    // Inject into the workspace's CLAUDE.md so the Agent is aware
    const claudeMdPath = resolve(branchDir, 'CLAUDE.md');
    const portHint = `\n\n## Swarm Branch Environment\n- BRANCH_PORT=${branchPort} (use this port for any local servers to avoid conflicts with other branches)\n- BRANCH_INDEX=${branchIndex}\n`;
    if (fs.existsSync(claudeMdPath)) {
      fs.appendFileSync(claudeMdPath, portHint);
    } else {
      fs.writeFileSync(claudeMdPath, portHint);
    }

    // 4. Run the mini Ratchet Loop (P1)
    //    runExperimentLoop creates its own internal abortController, so we bridge
    //    the swarm-level signal to it via abortExperiment().
    const branchRunId = `${swarmRunId}-branch-${branchIndex}`;
    const onSwarmAbort = () => abortExperiment(branchRunId);
    signal?.addEventListener('abort', onSwarmAbort);
    try {
      await runExperimentLoop(null, branchPlan, userId, branchDir, branchRunId);
    } finally {
      signal?.removeEventListener('abort', onSwarmAbort);
    }

    if (signal?.aborted) {
      updateSwarmBranchStatus(branchId, 'failed');
      return {
        branchIndex,
        branchId,
        branchDir,
        bestMetric: null,
        totalTrials: 0,
        acceptedTrials: 0,
        hypothesis: hypothesis.text,
        status: 'aborted',
      };
    }

    // 5. Read final metrics from the branch run
    const run = getRun(branchRunId);
    const bestMetric = run?.best_metric ?? null;
    const totalTrials = run?.total_trials ?? 0;
    const acceptedTrials = run?.accepted_trials ?? 0;

    updateSwarmBranchStatus(branchId, 'completed');
    updateSwarmBranchMetrics(branchId, bestMetric, totalTrials, acceptedTrials);

    swarmEvents.emit('swarm_branch_complete', {
      runId: swarmRunId,
      branchId,
      branchIndex,
      hypothesis: hypothesis.text,
      bestMetric,
      totalTrials,
      acceptedTrials,
    });

    return {
      branchIndex,
      branchId,
      branchDir,
      bestMetric,
      totalTrials,
      acceptedTrials,
      hypothesis: hypothesis.text,
      status: 'completed',
    };
  } catch (err) {
    updateSwarmBranchStatus(branchId, 'failed');

    swarmEvents.emit('swarm_branch_complete', {
      runId: swarmRunId,
      branchId,
      branchIndex,
      hypothesis: hypothesis.text,
      bestMetric: null,
      error: err.message,
    });

    return {
      branchIndex,
      branchId,
      branchDir,
      bestMetric: null,
      totalTrials: 0,
      acceptedTrials: 0,
      hypothesis: hypothesis.text,
      status: 'failed',
      error: err.message,
    };
  } finally {
    // Clean up per-branch env var to avoid global pollution across swarm runs
    delete process.env[`SWARM_BRANCH_PORT_${branchIndex}`];
  }
}

// ── Coordinator Phase 1: Decompose ────────────────────────────────────────────

async function coordinatorDecompose(plan, workspaceDir, userId, runId, signal) {
  const branchCount = plan.swarm?.branches ?? 3;

  swarmEvents.emit('swarm_decompose_start', { runId, branchCount });

  const prompt = buildDecomposePrompt(plan, branchCount);

  let output = '';
  let sessionId = '';

  try {
    // Try to use the Coordinator Agent if the agentEvents bus has been initialised
    if (globalThis.__agentEventsBus) {
      const result = await runCoordinatorAgent(prompt, workspaceDir, userId, signal);
      output = result.text;
      sessionId = result.sessionId;
    }
  } catch {
    // Coordinator Agent unavailable or timed out — fall back to deterministic decomposition
  }

  // Parse hypotheses from Coordinator output
  let hypotheses = parseHypotheses(output);

  // If parsing failed or Coordinator wasn't available, generate default hypotheses
  if (hypotheses.length === 0) {
    hypotheses = Array.from({ length: branchCount }, (_, i) => ({
      id: i,
      text: `Approach ${i + 1}: Apply optimization strategy ${i + 1} to improve the primary metric. Focus on a distinct aspect of the codebase.`,
    }));
  }

  // Trim or extend to exactly branchCount
  while (hypotheses.length < branchCount) {
    const i = hypotheses.length;
    hypotheses.push({
      id: i,
      text: `Approach ${i + 1}: Explore alternative optimization angle ${i + 1}.`,
    });
  }
  hypotheses = hypotheses.slice(0, branchCount);

  // Emit each hypothesis as its own event (for real-time sidebar display)
  for (const hyp of hypotheses) {
    swarmEvents.emit('swarm_hypothesis', { runId, hypothesis: hyp });
  }

  // Persist decision
  saveCoordinatorDecision(runId, 'decompose', {
    inputSummary: `branches=${branchCount}, plan="${plan.name}"`,
    outputRaw: output,
    parsedResult: hypotheses,
    agentSessionId: sessionId,
  });

  return hypotheses;
}

// ── Coordinator Phase 2: Synthesize ──────────────────────────────────────────

async function coordinatorSynthesize(plan, branchResults, userId, runId, signal) {
  swarmEvents.emit('swarm_synthesize_start', { runId });

  const branchSummaries = branchResults.map((r) => ({
    branchIndex: r.branchIndex,
    hypothesis: r.hypothesis,
    status: r.status,
    bestMetric: r.bestMetric,
    totalTrials: r.totalTrials,
    acceptedTrials: r.acceptedTrials,
  }));

  const prompt = buildSynthesizePrompt(plan, branchSummaries);

  let output = '';
  let sessionId = '';

  try {
    if (globalThis.__agentEventsBus) {
      const result = await runCoordinatorAgent(
        prompt,
        branchResults[0]?.branchDir || '',
        userId,
        signal,
      );
      output = result.text;
      sessionId = result.sessionId;
    }
  } catch {
    // Fall back to heuristic selection
  }

  // Parse Coordinator's selection
  let { selectedId, reasoning } = parseSelection(output);

  // Fallback: if parsing failed, pick best metric heuristically
  if (selectedId === null || selectedId < 0 || selectedId >= branchResults.length) {
    const direction = plan.metrics?.primary?.direction ?? 'minimize';
    const validBranches = branchResults.filter((b) => b.bestMetric !== null);

    if (validBranches.length === 0) {
      // All branches failed — pick the first one
      selectedId = 0;
      reasoning = 'All branches failed to produce a metric. Selecting branch 0 as fallback.';
    } else {
      const best = validBranches.reduce((a, b) => {
        if (direction === 'minimize') return b.bestMetric < a.bestMetric ? b : a;
        return b.bestMetric > a.bestMetric ? b : a;
      });
      selectedId = best.branchIndex;
      reasoning = `Heuristic selection (Coordinator output unparseable): Branch ${selectedId} achieved best metric ${best.bestMetric}.`;
    }
  }

  // Persist decision
  saveCoordinatorDecision(runId, 'synthesize', {
    inputSummary: branchSummaries
      .map((b) => `Branch ${b.branchIndex}: ${b.bestMetric ?? 'failed'}`)
      .join(', '),
    outputRaw: output,
    parsedResult: { selectedId, reasoning },
    agentSessionId: sessionId,
  });

  swarmEvents.emit('swarm_branch_selected', {
    runId,
    selectedBranchIndex: selectedId,
    reasoning,
  });

  return { selectedId, reasoning };
}

// ── Main Swarm Entry Point ────────────────────────────────────────────────────

/**
 * Run the full Research Swarm:
 *   1. Coordinator decomposes ResearchPlan into N hypotheses
 *   2. N branches run in parallel (each using P1 runExperimentLoop)
 *   3. Coordinator selects best branch
 *   4. Best branch merged into main workspace; rejected branches cleaned up
 *
 * @param {string} experimentId
 * @param {object} plan - ResearchPlan with optional .swarm configuration
 * @param {string} userId
 * @param {string} workspaceDir - The main experiment workspace (baseline)
 * @param {string} runId - Pre-created experiment_runs row ID
 */
export async function runResearchSwarm(experimentId, plan, userId, workspaceDir, runId) {
  const abortController = new AbortController();
  const { signal } = abortController;

  activeSwarms.set(runId, { abortController, experimentId, userId });

  const emit = (event, data) => swarmEvents.emit(event, { runId, experimentId, ...data });

  try {
    // ── Phase 1: Coordinator decomposes research directions ─────────────────
    const hypotheses = await coordinatorDecompose(plan, workspaceDir, userId, runId, signal);

    if (signal.aborted) return;

    // ── Phase 2: Register branches in DB and run in parallel ────────────────
    const branchIds = hypotheses.map((hyp, i) =>
      createSwarmBranch(runId, i, hyp.text, `${workspaceDir}-branch-${i}`),
    );

    const branchPromises = hypotheses.map((hyp, i) =>
      runBranch(plan, hyp, i, branchIds[i], workspaceDir, userId, runId, signal),
    );

    const settledResults = await Promise.allSettled(branchPromises);
    const branchResults = settledResults.map((r) =>
      r.status === 'fulfilled'
        ? r.value
        : { branchIndex: 0, bestMetric: null, status: 'failed', error: r.reason?.message },
    );

    if (signal.aborted) return;

    // ── Phase 3: Coordinator synthesizes and selects best branch ────────────
    const { selectedId, reasoning } = await coordinatorSynthesize(
      plan,
      branchResults,
      userId,
      runId,
      signal,
    );

    // ── Phase 4: Merge best, clean up rejected (Q1: Option C) ───────────────
    const selectedBranch =
      branchResults.find((b) => b.branchIndex === selectedId) ?? branchResults[0];
    const selectedBranchId = branchIds[selectedBranch.branchIndex];

    selectSwarmBranch(selectedBranchId);

    // Merge best branch files back into main workspace
    if (selectedBranch.branchDir && fs.existsSync(selectedBranch.branchDir)) {
      mergeBestBranchIntoMain(selectedBranch.branchDir, workspaceDir);
    }

    // Clean up all non-selected branch workspaces
    for (const branch of branchResults) {
      if (branch.branchIndex === selectedBranch.branchIndex) continue;
      const branchId = branchIds[branch.branchIndex];
      rejectSwarmBranch(
        branchId,
        branch.branchIndex === selectedId ? null : `Not selected. ${reasoning}`,
      );
      cleanupBranchWorkspace(branch.branchDir);
    }

    emit('swarm_complete', {
      selectedBranchIndex: selectedBranch.branchIndex,
      selectedHypothesis: selectedBranch.hypothesis,
      bestMetric: selectedBranch.bestMetric,
      reasoning,
      totalBranches: hypotheses.length,
    });

    return {
      selectedBranch,
      hypotheses,
      branchResults,
      reasoning,
    };
  } catch (err) {
    emit('swarm_error', { error: err.message });
    throw err;
  } finally {
    activeSwarms.delete(runId);
  }
}

/**
 * Abort a running swarm (all branches will receive the abort signal).
 * @param {string} runId
 */
export function abortSwarm(runId) {
  const entry = activeSwarms.get(runId);
  if (entry) {
    entry.abortController.abort();
    activeSwarms.delete(runId);
    return true;
  }
  return false;
}

/** Check if a swarm run is currently active. */
export function isSwarmActive(runId) {
  return activeSwarms.has(runId);
}

/**
 * Initialise the agentEvents bus reference needed by Coordinator Agent sessions.
 * Call this once from server.js after importing agentManager.
 * @param {import('node:events').EventEmitter} agentEventsBus
 */
export function initSwarmBus(agentEventsBus) {
  _agentEventsBus = agentEventsBus;
  globalThis.__agentEventsBus = agentEventsBus;
}
