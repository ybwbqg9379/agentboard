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
import { execSync, spawn, spawnSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { isAbsolute, normalize, resolve, sep } from 'node:path';
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
import { BLOCKED_PATTERNS } from './hooks.js';

export const experimentEvents = new EventEmitter();
experimentEvents.setMaxListeners(50);

const MAX_COMMAND_BUFFER = 10 * 1024 * 1024;
const COMMAND_KILL_GRACE_MS = 500;
const AUTORESEARCH_GIT_USER_EMAIL = 'autoresearch@agentboard.local';
const AUTORESEARCH_GIT_USER_NAME = 'AutoResearch';
const ALLOWED_BENCHMARK_EXECUTABLES = new Set([
  'node',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'python',
  'python3',
  'pytest',
  'cargo',
  'go',
  'deno',
]);

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
 * Minimal argv parser for user-supplied benchmark commands.
 * Supports quoted literals and backslash escapes without invoking a shell.
 *
 * Returns an array of unquoted argument strings.
 * Throws on unterminated quotes.
 */
function shellSplit(command) {
  const args = [];
  let current = '';
  let tokenStarted = false;
  let state = 'normal';

  const pushCurrent = () => {
    if (!tokenStarted) return;
    args.push(current);
    current = '';
    tokenStarted = false;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];

    if (state === 'single') {
      if (ch === "'") {
        state = 'normal';
      } else {
        current += ch;
      }
      continue;
    }

    if (state === 'double') {
      if (ch === '"') {
        state = 'normal';
        continue;
      }
      if (ch === '\\') {
        const next = command[i + 1];
        if (next === '"' || next === '\\') {
          current += next;
          i++;
        } else {
          current += ch;
        }
      } else {
        current += ch;
      }
      continue;
    }

    if (ch === "'") {
      state = 'single';
      tokenStarted = true;
    } else if (ch === '"') {
      state = 'double';
      tokenStarted = true;
    } else if (ch === '\\') {
      const next = command[i + 1];
      if (next === undefined) {
        current += ch;
      } else {
        current += next;
        i++;
      }
      tokenStarted = true;
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      pushCurrent();
    } else {
      current += ch;
      tokenStarted = true;
    }
  }

  if (state === 'single') {
    throw new Error(`Unterminated single quote in command: ${command}`);
  }
  if (state === 'double') {
    throw new Error(`Unterminated double quote in command: ${command}`);
  }

  pushCurrent();
  return args;
}

/**
 * Check whether a path-like executable stays inside the workspace fence.
 */
function isPathInside(basePath, targetPath) {
  let normalizedBase = normalize(resolve(basePath));
  let normalizedTarget = normalize(resolve(targetPath));
  if (fs.existsSync(normalizedBase)) {
    try {
      normalizedBase = fs.realpathSync(normalizedBase);
    } catch {
      /* keep normalized path */
    }
  }
  if (fs.existsSync(normalizedTarget)) {
    try {
      normalizedTarget = fs.realpathSync(normalizedTarget);
    } catch {
      /* keep normalized path */
    }
  }
  return (
    normalizedTarget === normalizedBase || normalizedTarget.startsWith(`${normalizedBase}${sep}`)
  );
}

function isWorkspaceLocalExecutable(executable, workspaceDir) {
  const resolved = isAbsolute(executable)
    ? normalize(executable)
    : normalize(resolve(workspaceDir, executable));
  let checkedPath = resolved;
  if (fs.existsSync(resolved)) {
    try {
      checkedPath = fs.realpathSync(resolved);
    } catch {
      checkedPath = resolved;
    }
  }
  return isPathInside(workspaceDir, checkedPath);
}

function getBenchmarkSubcommand(args) {
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return null;
}

function validateNodeBenchmark(args, workspaceDir) {
  const script = args[0];
  if (!script || script.startsWith('-')) {
    throw new Error('node benchmark commands must execute a workspace-local script file');
  }
  if (!isWorkspaceLocalExecutable(script, workspaceDir)) {
    throw new Error(`node benchmark script must stay inside the workspace: ${script}`);
  }
}

function validatePythonBenchmark(args, workspaceDir, executable) {
  const script = args[0];
  if (!script || script.startsWith('-')) {
    throw new Error(
      `${executable} benchmark commands must execute a workspace-local script file; inline flags are not allowed`,
    );
  }
  if (!isWorkspaceLocalExecutable(script, workspaceDir)) {
    throw new Error(`${executable} benchmark script must stay inside the workspace: ${script}`);
  }
}

function validateDenoBenchmark(args, workspaceDir) {
  const subcommand = args[0];
  if (subcommand === 'test') return;
  if (subcommand !== 'run') {
    throw new Error('deno benchmark commands only allow "run" or "test"');
  }
  const script = args[1];
  if (!script || script.startsWith('-')) {
    throw new Error('deno run benchmark commands must execute a workspace-local script file');
  }
  if (!isWorkspaceLocalExecutable(script, workspaceDir)) {
    throw new Error(`deno benchmark script must stay inside the workspace: ${script}`);
  }
}

function validateBareExecutable(argv, workspaceDir) {
  const [executable, ...args] = argv;
  if (!ALLOWED_BENCHMARK_EXECUTABLES.has(executable)) {
    throw new Error(
      `Benchmark executable "${executable}" is not allowed; use a workspace-local executable or an allowlisted runner`,
    );
  }

  switch (executable) {
    case 'node':
      validateNodeBenchmark(args, workspaceDir);
      return;
    case 'python':
    case 'python3':
      validatePythonBenchmark(args, workspaceDir, executable);
      return;
    case 'npm': {
      const subcommand = getBenchmarkSubcommand(args);
      if (!subcommand || !new Set(['test', 'run', 'run-script']).has(subcommand)) {
        throw new Error('npm benchmark commands only allow "test", "run", or "run-script"');
      }
      return;
    }
    case 'pnpm':
    case 'yarn':
    case 'bun': {
      const subcommand = getBenchmarkSubcommand(args);
      if (!subcommand || !new Set(['test', 'run']).has(subcommand)) {
        throw new Error(`${executable} benchmark commands only allow "test" or "run"`);
      }
      return;
    }
    case 'cargo': {
      const subcommand = getBenchmarkSubcommand(args);
      if (!subcommand || !new Set(['test', 'bench', 'run']).has(subcommand)) {
        throw new Error('cargo benchmark commands only allow "test", "bench", or "run"');
      }
      return;
    }
    case 'go': {
      const subcommand = getBenchmarkSubcommand(args);
      if (subcommand !== 'test') {
        throw new Error('go benchmark commands only allow "test"');
      }
      return;
    }
    case 'deno':
      validateDenoBenchmark(args, workspaceDir);
      return;
    case 'pytest':
      return;
    default:
      return;
  }
}

/**
 * Validate that a benchmark command stays within the allowed execution model.
 */
function validateBenchmarkCommand(command, workspaceDir) {
  if (typeof command !== 'string' || command.trim().length === 0) {
    throw new Error('Benchmark command must be a non-empty string');
  }
  if (BLOCKED_PATTERNS.some((pattern) => pattern.test(command))) {
    throw new Error(`Benchmark command blocked by security policy: ${command}`);
  }
  const argv = shellSplit(command);
  if (argv.length === 0) {
    throw new Error('Benchmark command must not be empty after parsing');
  }

  const executable = argv[0];
  const isPathLike =
    executable.startsWith('.') ||
    executable.includes('/') ||
    executable.includes('\\') ||
    isAbsolute(executable);

  if (isPathLike) {
    if (!isWorkspaceLocalExecutable(executable, workspaceDir)) {
      throw new Error(`Benchmark executable must stay inside the workspace: ${executable}`);
    }
    return;
  }

  validateBareExecutable(argv, workspaceDir);
}

/**
 * Execute a command in the experiment workspace.
 *
 * @param {string} command - Command string
 * @param {string} cwd - Working directory
 * @param {number} timeoutMs - Timeout in ms
 * @param {AbortSignal} [signal] - Abort signal
 * @param {object} [opts] - Options
 * @param {boolean} [opts.shell] - Use shell (for trusted internal commands only).
 *   Default false: command is parsed via shellSplit() and executed without shell,
 *   removing shell interpretation from user-supplied benchmark commands.
 */
async function runCommand(command, cwd, timeoutMs = 300000, signal, opts = {}) {
  let cmd, args;
  if (opts.shell) {
    // Trusted internal commands (git diff, git checkout, etc.) -- use shell
    cmd = '/bin/sh';
    args = ['-c', command];
  } else {
    // User-supplied benchmark commands -- no shell, parsed into argv
    const argv = shellSplit(command);
    if (argv.length === 0) {
      return { output: 'empty command', exitCode: 1, aborted: false };
    }
    cmd = argv[0];
    args = argv.slice(1);
  }

  return new Promise((resolvePromise) => {
    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;
    let aborted = false;
    let timedOut = false;
    let forceKillTimer = null;

    const child = spawn(cmd, args, {
      cwd,
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
  for (const [key, value] of [
    ['user.email', AUTORESEARCH_GIT_USER_EMAIL],
    ['user.name', AUTORESEARCH_GIT_USER_NAME],
  ]) {
    const result = spawnSync('git', ['config', key, value], {
      cwd: workspaceDir,
      stdio: 'pipe',
    });
    if (result.error) {
      throw new Error(`Failed to set git ${key} in workspace: ${result.error.message}`, {
        cause: result.error,
      });
    }
    if (result.status !== 0) {
      const stderr = result.stderr?.toString().trim() || 'unknown error';
      throw new Error(`git config ${key} failed (exit ${result.status}): ${stderr}`);
    }
  }
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
    const cpResult = spawnSync('cp', ['-r', `${sourceDir}/.`, `${workspaceDir}/`], {
      stdio: 'pipe',
    });
    if (cpResult.error) {
      throw new Error(`Failed to copy source_dir: ${cpResult.error.message}`, {
        cause: cpResult.error,
      });
    }
    if (cpResult.status !== 0) {
      const stderr = cpResult.stderr?.toString().trim() || 'unknown error';
      throw new Error(`cp -r failed (exit ${cpResult.status}): ${stderr}`);
    }
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
  const runId = preCreatedRunId || (await createRun(userId, experimentId));
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

    // 0.5 Validate all benchmark commands before executing any
    const commandsToValidate = [
      plan.metrics.primary?.command,
      plan.metrics.guard?.command,
      ...(plan.metrics.secondary || []).map((m) => m.command),
    ].filter(Boolean);
    for (const cmd of commandsToValidate) {
      validateBenchmarkCommand(cmd, workspaceDir);
    }

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
          updateRunBaseline(runId, bestMetric, userId);
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
        //     Use shell + stderr redirect so OS-level git warnings (e.g. macOS
        //     ".config/git/ignore: Operation not permitted") don't appear as filenames.
        if (plan.target?.files?.length) {
          const diffOutput = await runCommand(
            'git diff --name-only 2>/dev/null',
            workspaceDir,
            5000,
            null,
            { shell: true },
          );
          const untrackedOutput = await runCommand(
            'git ls-files --others --exclude-standard 2>/dev/null',
            workspaceDir,
            5000,
            null,
            { shell: true },
          );
          const changedFiles = [
            ...diffOutput.output.trim().split('\n').filter(Boolean),
            ...untrackedOutput.output.trim().split('\n').filter(Boolean),
          ];
          const violations = changedFiles.filter((f) => !isFileAllowed(f, plan.target.files));

          if (violations.length > 0) {
            await runCommand('git checkout -- . && git clean -fd', workspaceDir, 5000, null, {
              shell: true,
            });
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
            null,
            { shell: true },
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
          await runCommand('git checkout -- . && git clean -fd', workspaceDir, 5000, null, {
            shell: true,
          });

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
        await runCommand('git checkout -- . && git clean -fd', workspaceDir, 5000, null, {
          shell: true,
        });
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
      await updateRunMetrics(runId, bestMetric, trialCount, acceptedCount, userId);

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
    await updateRunStatus(runId, status, userId);
    emit('experiment_done', {
      status,
      bestMetric,
      totalTrials: trialCount,
      acceptedTrials: acceptedCount,
      durationMs: Date.now() - startTime,
    });
  } catch (err) {
    console.error(`[experimentEngine] Fatal error in run ${runId}: ${err.message}`);
    await updateRunStatus(runId, 'failed', userId);
    await updateRunError(runId, err.message, userId);
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
  // Never enumerate all runs without an explicit tenant id (multi-tenant footgun).
  if (userId == null || userId === '') return [];
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
