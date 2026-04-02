/**
 * experimentEngine.js
 *
 * Core experiment loop engine — the AutoResearch Ratchet Loop.
 * Orchestrates the "modify → execute → measure → judge → iterate" cycle.
 *
 * Borrows patterns from Claude Code's runAgent.ts:
 *   - AbortController per run (independent cancellation)
 *   - maxTurns equivalent (budget.max_experiments)
 *   - Event-driven progress reporting
 */

import { EventEmitter } from 'node:events';
import { execSync, spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { resolve } from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import config from './config.js';
import { startAgent, stopAgent, agentEvents } from './agentManager.js';
import {
  createRun,
  updateRunStatus,
  updateRunMetrics,
  updateRunBaseline,
  updateRunError,
  saveTrial,
} from './experimentStore.js';
import { extractAllMetrics, isImproved, improvementPercent } from './metricExtractor.js';

export const experimentEvents = new EventEmitter();
experimentEvents.setMaxListeners(50);

const MAX_COMMAND_BUFFER = 10 * 1024 * 1024;
const COMMAND_KILL_GRACE_MS = 500;
const AUTORESEARCH_GIT_USER_EMAIL = 'autoresearch@agentboard.local';
const AUTORESEARCH_GIT_USER_NAME = 'AutoResearch';

// Map<runId, { abortController, experimentId }>
const activeExperiments = new Map();

/**
 * Parse time strings like "5m", "2h", "30s" into milliseconds.
 */
function parseTimeMs(timeStr) {
  if (!timeStr) return Infinity;
  if (typeof timeStr === 'number') return timeStr;
  const match = timeStr.match(/^(\d+)(s|m|h)$/);
  if (!match) return parseInt(timeStr) || Infinity;
  const [, val, unit] = match;
  const multipliers = { s: 1000, m: 60000, h: 3600000 };
  return parseInt(val) * (multipliers[unit] || 1000);
}

/**
 * Execute a command in the experiment workspace and return output.
 * Runs directly on the host (no Docker) per Q1 decision.
 */
async function runCommand(command, cwd, timeoutMs = 300000, signal) {
  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let aborted = false;
    let timedOut = false;
    let forceKillTimer = null;

    const child = spawn(command, {
      cwd,
      shell: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const cleanup = () => {
      clearTimeout(timeoutId);
      clearTimeout(forceKillTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolvePromise(result);
    };

    const appendChunk = (chunk, target) => {
      const text = chunk.toString('utf-8');
      const bytes = Buffer.byteLength(text);
      if (target === 'stdout') {
        stdout += text;
        stdoutBytes += bytes;
      } else {
        stderr += text;
        stderrBytes += bytes;
      }

      if (stdoutBytes + stderrBytes > MAX_COMMAND_BUFFER) {
        stderr += '\n[runCommand] output exceeded maxBuffer';
        requestStop('buffer');
      }
    };

    const killProcessTree = (killSignal, force = false) => {
      if (!child.pid) return;
      if (process.platform === 'win32') {
        const args = ['/PID', String(child.pid), '/T'];
        if (force || killSignal === 'SIGKILL') args.push('/F');
        const killer = spawn('taskkill', args, { stdio: 'ignore', windowsHide: true });
        killer.on('error', () => {});
        return;
      }

      try {
        process.kill(-child.pid, killSignal);
      } catch {
        try {
          process.kill(child.pid, killSignal);
        } catch {
          /* ignore */
        }
      }
    };

    const requestStop = (reason) => {
      if (settled) return;
      if (reason === 'abort') aborted = true;
      if (reason === 'timeout') timedOut = true;

      killProcessTree('SIGTERM');
      forceKillTimer = setTimeout(() => {
        killProcessTree('SIGKILL', true);
      }, COMMAND_KILL_GRACE_MS);
    };

    const onAbort = () => requestStop('abort');
    if (signal) {
      if (signal.aborted) {
        requestStop('abort');
      } else {
        signal.addEventListener('abort', onAbort, { once: true });
      }
    }

    const timeoutId = setTimeout(() => {
      requestStop('timeout');
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => appendChunk(chunk, 'stdout'));
    child.stderr?.on('data', (chunk) => appendChunk(chunk, 'stderr'));

    child.on('error', (err) => {
      stderr += `${stderr ? '\n' : ''}${err.message}`;
    });

    child.on('close', (code) => {
      finish({
        output: [stdout || '', stderr || ''].filter(Boolean).join('\n'),
        exitCode: aborted ? 130 : timedOut ? 124 : (code ?? 1),
        aborted,
      });
    });
  });
}

function ensureWorkspaceGitIdentity(workspaceDir) {
  execSync(
    `git config user.email "${AUTORESEARCH_GIT_USER_EMAIL}" && git config user.name "${AUTORESEARCH_GIT_USER_NAME}"`,
    { cwd: workspaceDir, stdio: 'pipe' },
  );
}

function ensureWorkspaceBaselineSnapshot(workspaceDir) {
  let hasHead = true;
  try {
    execSync('git rev-parse --verify HEAD', { cwd: workspaceDir, stdio: 'pipe' });
  } catch {
    hasHead = false;
  }

  const statusOutput = execSync('git status --porcelain', {
    cwd: workspaceDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();

  if (!hasHead || statusOutput) {
    execSync('git add -A && git commit -m "autoresearch: baseline" --allow-empty', {
      cwd: workspaceDir,
      stdio: 'pipe',
    });
  }
}

/**
 * Initialize the experiment workspace directory.
 * Copies target files into a session-scoped workspace.
 *
 * Per Q2 decision: uses workspace/sessions/{sessionId} isolation.
 */
export function prepareWorkspace(plan, workspaceDir, userId) {
  if (!fs.existsSync(workspaceDir)) {
    fs.mkdirSync(workspaceDir, { recursive: true });
  }

  // If target files are specified and a source dir exists, copy them
  if (plan.target?.source_dir && fs.existsSync(plan.target.source_dir)) {
    // Resolve symlinks to prevent bypass via symlinked paths
    const sourceDir = fs.realpathSync(resolve(plan.target.source_dir));
    const userRoot = fs.realpathSync(
      userId && userId !== 'default'
        ? resolve(config.workspaceDir, userId)
        : resolve(config.workspaceDir),
    );
    if (!sourceDir.startsWith(userRoot + '/') && sourceDir !== userRoot) {
      throw new Error(`source_dir "${sourceDir}" is outside the allowed workspace "${userRoot}"`);
    }
    execSync(`cp -r "${sourceDir}/." "${workspaceDir}/"`, { stdio: 'pipe' });
  }

  // Ensure a CLAUDE.md exists to prevent the SDK from triggering [ONBOARDING TASK]
  // which would generate unrelated file changes and potentially trip the whitelist
  const claudeMdPath = resolve(workspaceDir, 'CLAUDE.md');
  if (!fs.existsSync(claudeMdPath)) {
    const userRoot =
      userId && userId !== 'default'
        ? resolve(config.workspaceDir, userId)
        : resolve(config.workspaceDir);
    const userClaudeMd = resolve(userRoot, 'CLAUDE.md');
    if (fs.existsSync(userClaudeMd)) {
      fs.copyFileSync(userClaudeMd, claudeMdPath);
    } else {
      fs.writeFileSync(claudeMdPath, '# Experiment workspace\n');
    }
  }

  // Initialize git in workspace for ratchet operations
  if (!fs.existsSync(resolve(workspaceDir, '.git'))) {
    execSync('git init', { cwd: workspaceDir, stdio: 'pipe' });
  }
  ensureWorkspaceGitIdentity(workspaceDir);
  ensureWorkspaceBaselineSnapshot(workspaceDir);
}

/**
 * Validate that a file path is within the allowed target files list.
 * Per Q3 decision: strict file whitelist enforcement.
 */
function isFileAllowed(filePath, allowedFiles) {
  if (!allowedFiles || allowedFiles.length === 0) return true;
  const normalized = filePath.replace(/^\.\//, '');
  return allowedFiles.some((allowed) => {
    const normalizedAllowed = allowed.replace(/^\.\//, '');
    // Support glob-like wildcards
    if (normalizedAllowed.includes('*')) {
      const regex = new RegExp('^' + normalizedAllowed.replace(/\*/g, '.*') + '$');
      return regex.test(normalized);
    }
    return normalized === normalizedAllowed || normalized.startsWith(normalizedAllowed + '/');
  });
}

/**
 * Build the agent prompt for a single experiment trial.
 */
function buildTrialPrompt(plan, trialNumber, bestMetric, previousResults) {
  const metricDirectionText = plan.metrics.primary.direction === 'minimize' ? 'lower' : 'higher';
  const bestText =
    bestMetric !== null
      ? `Current best ${plan.metrics.primary.direction === 'minimize' ? '(lowest)' : '(highest)'}: ${bestMetric}`
      : 'No baseline yet.';

  // File whitelist enforcement (Q3 decision)
  const fileConstraint = plan.target?.files?.length
    ? `\n\nIMPORTANT: You may ONLY modify these files:\n${plan.target.files.map((f) => `  - ${f}`).join('\n')}\nAny modifications to other files will be rejected.`
    : '';

  const readonlyHint = plan.target?.readonly?.length
    ? `\nYou may READ (but not modify) these files for reference:\n${plan.target.readonly.map((f) => `  - ${f}`).join('\n')}`
    : '';

  const constraintsList = plan.target?.constraints?.length
    ? `\nConstraints that must be satisfied:\n${plan.target.constraints.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`
    : '';

  const recentHistory = previousResults
    .slice(-3)
    .map(
      (r) =>
        `  Trial ${r.number}: metric=${r.metric ?? 'failed'} (${r.accepted ? 'ACCEPTED' : 'rejected: ' + r.reason})`,
    )
    .join('\n');

  return `You are an autonomous research agent running experiment trial #${trialNumber}.

## Goal
${plan.description || plan.name}

## Metric
A ${metricDirectionText} value is better.
${bestText}

## Recent History
${recentHistory || '(first trial)'}
${fileConstraint}${readonlyHint}${constraintsList}

## Instructions
${plan.agent_instructions || 'Analyze the current code, hypothesize an improvement, and implement it. Make targeted, incremental changes.'}

## Rules
1. Make ONE focused change per trial (not multiple unrelated changes)
2. After making your change, briefly explain your hypothesis and what you changed
3. Do NOT modify the benchmark or test commands themselves
4. Do NOT try to game the metric by changing the evaluation code`;
}

/**
 * The main experiment loop — the Ratchet Loop.
 *
 * @param {string} experimentId - Experiment plan ID
 * @param {object} plan - Parsed ResearchPlan
 * @param {string} userId - Owner user ID
 * @param {string} workspaceDir - Session workspace directory
 * @param {string} [preCreatedRunId] - Optional pre-created run ID (from API layer)
 * @returns {string} runId
 */
export async function runExperimentLoop(experimentId, plan, userId, workspaceDir, preCreatedRunId) {
  const runId = preCreatedRunId || createRun(userId, experimentId);
  const abortController = new AbortController();

  activeExperiments.set(runId, {
    abortController,
    experimentId,
    userId,
    currentAgentSessionId: null,
  });

  const budget = plan.budget || {};
  const maxExperiments = budget.max_experiments || 100;
  const maxConsecutiveFailures = budget.max_consecutive_failures || 10;
  const timePerExperiment = parseTimeMs(budget.time_per_experiment || '5m');
  const totalTimeLimit = parseTimeMs(budget.total_time || '8h');
  const startTime = Date.now();

  let bestMetric = null;
  let trialCount = 0;
  let acceptedCount = 0;
  let consecutiveFailures = 0;
  const previousResults = [];

  const emit = (event, data) => {
    experimentEvents.emit(event, { runId, experimentId, ...data });
  };

  try {
    // 0. Prepare workspace
    prepareWorkspace(plan, workspaceDir, userId);
    emit('experiment_start', { plan: plan.name, maxExperiments });

    // 1. Run baseline benchmark
    if (plan.metrics.primary?.command) {
      const baselineResult = await runCommand(
        plan.metrics.primary.command,
        workspaceDir,
        timePerExperiment,
        abortController.signal,
      );
      if (!baselineResult.aborted) {
        const baselineMetrics = extractAllMetrics(
          baselineResult.output,
          plan.metrics,
          baselineResult.exitCode,
        );

        if (baselineMetrics.primary !== null) {
          bestMetric = baselineMetrics.primary;
          updateRunBaseline(runId, bestMetric);
          emit('baseline', { metric: bestMetric, guardPassed: baselineMetrics.guardPassed });
        }
      }
    }

    // 2. Main Ratchet Loop
    while (!abortController.signal.aborted) {
      // Budget checks
      if (trialCount >= maxExperiments) {
        emit('budget_exhausted', { reason: 'max_experiments', trialCount });
        break;
      }
      if (consecutiveFailures >= maxConsecutiveFailures) {
        emit('budget_exhausted', { reason: 'consecutive_failures', consecutiveFailures });
        break;
      }
      if (Date.now() - startTime > totalTimeLimit) {
        emit('budget_exhausted', { reason: 'total_time' });
        break;
      }

      trialCount++;
      const trialStart = Date.now();
      const trialId = randomUUID();

      emit('trial_start', { trialNumber: trialCount, trialId });

      let trialResult = { accepted: false, reason: 'error', primaryMetric: null };

      try {
        // 2a. Run Agent to propose and implement a modification
        const agentPrompt = buildTrialPrompt(plan, trialCount, bestMetric, previousResults);

        // Wait for agent to complete by collecting events
        const agentSessionId = await runAgentTrial(
          agentPrompt,
          workspaceDir,
          userId,
          timePerExperiment,
          runId,
        );

        if (abortController.signal.aborted) break;

        // 2b. Check file whitelist compliance (Q3: safety boundary)
        //     Check both modified tracked files AND new untracked files
        if (plan.target?.files?.length) {
          const diffOutput = await runCommand('git diff --name-only', workspaceDir, 5000);
          const untrackedOutput = await runCommand(
            'git ls-files --others --exclude-standard',
            workspaceDir,
            5000,
          );
          const changedFiles = [
            ...diffOutput.output.trim().split('\n').filter(Boolean),
            ...untrackedOutput.output.trim().split('\n').filter(Boolean),
          ];
          const violations = changedFiles.filter((f) => !isFileAllowed(f, plan.target.files));

          if (violations.length > 0) {
            await runCommand('git checkout -- . && git clean -fd', workspaceDir, 5000);
            trialResult = { accepted: false, reason: 'whitelist_violation', primaryMetric: null };
            emit('trial_rejected', {
              trialNumber: trialCount,
              trialId,
              reason: `Files outside whitelist modified: ${violations.join(', ')}`,
            });
            consecutiveFailures++;
            saveTrial(runId, trialCount, {
              ...trialResult,
              agentSessionId,
              durationMs: Date.now() - trialStart,
            });
            previousResults.push({
              number: trialCount,
              metric: null,
              accepted: false,
              reason: 'whitelist_violation',
            });
            continue;
          }
        }

        // 2c. Run guard check (tests must pass)
        let guardPassed = true;
        if (plan.metrics.guard?.command) {
          const guardResult = await runCommand(
            plan.metrics.guard.command,
            workspaceDir,
            timePerExperiment,
            abortController.signal,
          );
          if (guardResult.aborted) break;
          const guardMetrics = extractAllMetrics(
            guardResult.output,
            { guard: plan.metrics.guard },
            guardResult.exitCode,
          );
          guardPassed = guardMetrics.guardPassed;
        }

        // 2d. Run benchmark to extract metrics
        let currentMetric = null;
        if (plan.metrics.primary?.command) {
          const benchResult = await runCommand(
            plan.metrics.primary.command,
            workspaceDir,
            timePerExperiment,
            abortController.signal,
          );
          if (benchResult.aborted) break;
          const metrics = extractAllMetrics(benchResult.output, plan.metrics, benchResult.exitCode);
          currentMetric = metrics.primary;
        }

        // 2e. Ratchet Decision: keep or revert
        const improved = isImproved(
          currentMetric,
          bestMetric,
          plan.metrics.primary?.direction || 'minimize',
        );

        if (guardPassed && improved && currentMetric !== null) {
          // ACCEPT: commit the change
          const improvement = improvementPercent(
            currentMetric,
            bestMetric,
            plan.metrics.primary?.direction,
          );
          bestMetric = currentMetric;
          acceptedCount++;
          consecutiveFailures = 0;

          const safeMetric = String(currentMetric).replace(/[^-\d.e+]/gi, '');
          await runCommand(
            `git add -A && git commit -m "autoresearch: trial ${trialCount} (metric: ${safeMetric})"`,
            workspaceDir,
            5000,
          );

          const diff = (await runCommand('git diff HEAD~1', workspaceDir, 5000)).output;

          trialResult = {
            accepted: true,
            reason: 'improved',
            primaryMetric: currentMetric,
            diff,
            agentSessionId,
          };
          emit('trial_accepted', {
            trialNumber: trialCount,
            trialId,
            metric: currentMetric,
            improvement,
            bestMetric,
          });
        } else {
          // REJECT: revert changes
          const reason = !guardPassed
            ? 'guard_failed'
            : currentMetric === null
              ? 'metric_extraction_failed'
              : 'no_improvement';

          const diff = (await runCommand('git diff', workspaceDir, 5000)).output;
          await runCommand('git checkout -- . && git clean -fd', workspaceDir, 5000);

          trialResult = {
            accepted: false,
            reason,
            primaryMetric: currentMetric,
            diff,
            agentSessionId,
          };
          consecutiveFailures++;
          emit('trial_rejected', {
            trialNumber: trialCount,
            trialId,
            reason,
            metric: currentMetric,
            bestMetric,
          });
        }
      } catch (err) {
        // Trial-level error (agent failure, command timeout, etc)
        await runCommand('git checkout -- . && git clean -fd', workspaceDir, 5000);
        trialResult = { accepted: false, reason: `error: ${err.message}`, primaryMetric: null };
        consecutiveFailures++;
        emit('trial_error', { trialNumber: trialCount, trialId, error: err.message });
      }

      // 2f. Persist trial result
      const durationMs = Date.now() - trialStart;
      await saveTrial(runId, trialCount, {
        ...trialResult,
        allMetrics: {
          primary: trialResult.primaryMetric,
          guardPassed: trialResult.reason !== 'guard_failed',
        },
        durationMs,
      });
      await updateRunMetrics(runId, bestMetric, trialCount, acceptedCount);

      previousResults.push({
        number: trialCount,
        metric: trialResult.primaryMetric,
        accepted: trialResult.accepted,
        reason: trialResult.reason,
      });

      emit('trial_complete', {
        trialNumber: trialCount,
        accepted: trialResult.accepted,
        metric: trialResult.primaryMetric,
        bestMetric,
        totalTrials: trialCount,
        acceptedTrials: acceptedCount,
      });
    }

    // 3. Done
    const status = abortController.signal.aborted ? 'aborted' : 'completed';
    await updateRunStatus(runId, status);
    emit('experiment_done', {
      status,
      bestMetric,
      totalTrials: trialCount,
      acceptedTrials: acceptedCount,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error(`[experimentEngine] Fatal error in run ${runId}: ${err.message}`);
    await updateRunStatus(runId, 'failed');
    await updateRunError(runId, err.message);
    emit('experiment_error', { error: err.message });
  } finally {
    activeExperiments.delete(runId);
  }

  return runId;
}

/**
 * Run a single agent trial and wait for completion.
 * Uses the existing agentManager to spawn a session.
 * The agent's CWD is set to the experiment workspaceDir so modifications
 * and benchmarks operate on the same directory.
 */
async function runAgentTrial(prompt, workspaceDir, userId, timeoutMs, runId) {
  let capturedSessionId = null;
  let pendingTimeout;
  let pendingHandler;

  // Register listener BEFORE startAgent to prevent missing fast-completing done events
  const completionPromise = new Promise((resolvePromise, reject) => {
    pendingTimeout = setTimeout(() => {
      if (capturedSessionId) stopAgent(capturedSessionId);
      agentEvents.off('event', pendingHandler);
      reject(new Error('Agent trial timed out'));
    }, timeoutMs);

    pendingHandler = (event) => {
      if (!capturedSessionId || event.sessionId !== capturedSessionId) return;
      if (event.type === 'done') {
        clearTimeout(pendingTimeout);
        agentEvents.off('event', pendingHandler);
        const e = activeExperiments.get(runId);
        if (e) e.currentAgentSessionId = null;
        resolvePromise(capturedSessionId);
      }
    };

    agentEvents.on('event', pendingHandler);
  });

  try {
    capturedSessionId = await startAgent(prompt, {
      userId,
      permissionMode: 'bypassPermissions',
      maxTurns: 30,
      cwd: workspaceDir,
    });
  } catch (err) {
    clearTimeout(pendingTimeout);
    agentEvents.off('event', pendingHandler);
    throw err;
  }

  // Track current agent sessionId for abort support
  const entry = activeExperiments.get(runId);
  if (entry) {
    entry.currentAgentSessionId = capturedSessionId;
  }

  return completionPromise;
}

/**
 * Abort a running experiment.
 */
export function abortExperiment(runId) {
  const entry = activeExperiments.get(runId);
  if (!entry) return false;
  entry.abortController.abort();
  // Stop the currently running agent trial if any
  if (entry.currentAgentSessionId) {
    stopAgent(entry.currentAgentSessionId);
  }
  return true;
}

/**
 * Get list of active experiment run IDs.
 */
export function getActiveExperiments(userId) {
  if (!userId) return [...activeExperiments.keys()];
  const result = [];
  for (const [runId, entry] of activeExperiments) {
    if (entry.userId === userId) result.push(runId);
  }
  return result;
}

/**
 * Validate a ResearchPlan schema (basic validation).
 */
export function validatePlan(plan) {
  const errors = [];

  if (!plan.name) errors.push('name is required');
  if (!plan.metrics) errors.push('metrics section is required');
  if (plan.metrics && !plan.metrics.primary) errors.push('metrics.primary is required');
  if (plan.metrics?.primary && !plan.metrics.primary.command) {
    errors.push('metrics.primary.command is required');
  }
  if (
    plan.metrics?.primary &&
    !plan.metrics.primary.extract &&
    plan.metrics.primary.type !== 'exit_code'
  ) {
    errors.push('metrics.primary.extract is required (or set type to exit_code)');
  }
  if (
    plan.metrics?.primary?.direction &&
    !['minimize', 'maximize'].includes(plan.metrics.primary.direction)
  ) {
    errors.push('metrics.primary.direction must be "minimize" or "maximize"');
  }

  return { valid: errors.length === 0, errors };
}
