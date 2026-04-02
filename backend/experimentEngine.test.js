import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { resolve } from 'node:path';

const workspaceRoot = fs.mkdtempSync(resolve(os.tmpdir(), 'agentboard-experiment-test-'));

vi.mock('./config.js', () => ({
  default: {
    workspaceDir: workspaceRoot,
  },
}));

const agentEvents = new EventEmitter();
const startAgent = vi.fn();
const stopAgent = vi.fn();

vi.mock('./agentManager.js', () => ({
  startAgent,
  stopAgent,
  agentEvents,
}));

const createRun = vi.fn();
const updateRunStatus = vi.fn();
const updateRunMetrics = vi.fn();
const updateRunBaseline = vi.fn();
const updateRunError = vi.fn();
const saveTrial = vi.fn();

vi.mock('./experimentStore.js', () => ({
  createRun,
  updateRunStatus,
  updateRunMetrics,
  updateRunBaseline,
  updateRunError,
  saveTrial,
}));

const { runExperimentLoop, abortExperiment } = await import('./experimentEngine.js');

function uniqueDir(name) {
  return resolve(workspaceRoot, `${Date.now()}-${Math.random().toString(16).slice(2)}-${name}`);
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('experimentEngine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    stopAgent.mockReset();
    startAgent.mockReset();
  });

  it('rejects source_dir symlink escapes after realpath resolution', async () => {
    const aliceRoot = resolve(workspaceRoot, 'alice');
    const bobRoot = resolve(workspaceRoot, 'bob');
    fs.mkdirSync(aliceRoot, { recursive: true });
    fs.mkdirSync(bobRoot, { recursive: true });
    fs.writeFileSync(resolve(bobRoot, 'secret.txt'), 'secret');
    fs.symlinkSync(bobRoot, resolve(aliceRoot, 'link-to-bob'));

    const runId = '11111111-1111-1111-1111-111111111111';
    const workspaceDir = uniqueDir('symlink-run');

    await runExperimentLoop(
      'exp-symlink',
      {
        name: 'symlink guard',
        target: { source_dir: resolve(aliceRoot, 'link-to-bob') },
        metrics: {
          primary: {
            command: 'node -e "process.exit(0)"',
            type: 'exit_code',
            direction: 'maximize',
          },
        },
      },
      'alice',
      workspaceDir,
      runId,
    );

    expect(updateRunStatus).toHaveBeenCalledWith(runId, 'failed');
    expect(updateRunError).toHaveBeenCalledTimes(1);
    expect(updateRunError.mock.calls[0][1]).toContain('outside the allowed workspace');
    expect(updateRunError.mock.calls[0][1]).toContain(resolve(workspaceRoot, 'bob'));
  });

  it(
    'aborts a long-running baseline command promptly without blocking the event loop',
    { timeout: 10000 },
    async () => {
      const runId = '22222222-2222-2222-2222-222222222222';
      const workspaceDir = uniqueDir('abort-run');
      const startedAt = Date.now();

      const runPromise = runExperimentLoop(
        'exp-abort',
        {
          name: 'abort baseline',
          metrics: {
            primary: {
              command: 'node -e "setTimeout(() => {}, 5000)"',
              type: 'exit_code',
              direction: 'maximize',
            },
          },
        },
        'default',
        workspaceDir,
        runId,
      );

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 200));

      expect(abortExperiment(runId)).toBe(true);

      await runPromise;

      const elapsedMs = Date.now() - startedAt;
      expect(elapsedMs).toBeLessThan(2500);
      expect(updateRunStatus).toHaveBeenCalledWith(runId, 'aborted');
    },
  );

  it(
    'kills descendant worker processes when an experiment command is aborted',
    { timeout: 10000 },
    async () => {
      const runId = '33333333-3333-3333-3333-333333333333';
      const workspaceDir = uniqueDir('process-tree-run');
      const processDir = uniqueDir('process-tree-fixtures');
      fs.mkdirSync(processDir, { recursive: true });

      const workerPidFile = resolve(processDir, 'worker.pid');
      const workerFile = resolve(processDir, 'worker.js');
      const parentFile = resolve(processDir, 'parent.js');

      fs.writeFileSync(
        workerFile,
        `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(workerPidFile)}, String(process.pid)); setInterval(() => {}, 100000);`,
      );
      fs.writeFileSync(
        parentFile,
        `const { spawn } = require('node:child_process'); spawn(process.execPath, [${JSON.stringify(workerFile)}], { stdio: 'ignore' }); setInterval(() => {}, 100000);`,
      );

      const runPromise = runExperimentLoop(
        'exp-process-tree',
        {
          name: 'abort descendant workers',
          metrics: {
            primary: {
              command: `node ${JSON.stringify(parentFile)}`,
              type: 'exit_code',
              direction: 'maximize',
            },
          },
        },
        'default',
        workspaceDir,
        runId,
      );

      let workerPid = null;
      for (let i = 0; i < 20; i++) {
        if (fs.existsSync(workerPidFile)) {
          workerPid = Number(fs.readFileSync(workerPidFile, 'utf8'));
          break;
        }
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
      }

      expect(workerPid).toBeTruthy();
      expect(abortExperiment(runId)).toBe(true);

      await runPromise;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 400));

      expect(isAlive(workerPid)).toBe(false);
      expect(updateRunStatus).toHaveBeenCalledWith(runId, 'aborted');
    },
  );

  it('sets repo-local git identity when source_dir already contains a git repo', async () => {
    const runId = '44444444-4444-4444-4444-444444444444';
    const sourceDir = uniqueDir('source-repo');
    const workspaceDir = uniqueDir('identity-run');
    const scoreFile = resolve(sourceDir, 'score.txt');
    const sessionId = 'agent-session-identity';

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(scoreFile, '1\n');
    execSync('git init', { cwd: sourceDir, stdio: 'pipe' });
    execSync('git add -A', { cwd: sourceDir, stdio: 'pipe' });
    execSync(
      'git -c user.name="Source Author" -c user.email="source@example.com" commit -m "source baseline"',
      {
        cwd: sourceDir,
        stdio: 'pipe',
      },
    );

    startAgent.mockImplementation((_prompt, opts) => {
      fs.writeFileSync(resolve(opts.cwd, 'score.txt'), '2\n');
      Promise.resolve().then(() => {
        agentEvents.emit('event', { sessionId, type: 'done' });
      });
      return sessionId;
    });

    await runExperimentLoop(
      'exp-identity',
      {
        name: 'git identity coverage',
        target: {
          source_dir: sourceDir,
          files: ['score.txt'],
        },
        metrics: {
          primary: {
            command:
              "node -e \"const fs = require('node:fs'); console.log(fs.readFileSync('score.txt', 'utf8').trim())\"",
            extract: '^(\\d+)$',
            type: 'regex',
            direction: 'maximize',
          },
        },
        budget: {
          max_experiments: 1,
        },
      },
      'default',
      workspaceDir,
      runId,
    );

    const gitConfig = fs.readFileSync(resolve(workspaceDir, '.git', 'config'), 'utf8');
    const lastCommitMessage = execSync('git log -1 --format=%s', {
      cwd: workspaceDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();

    expect(gitConfig).toContain('name = AutoResearch');
    expect(gitConfig).toContain('email = autoresearch@agentboard.local');
    expect(lastCommitMessage).toBe('autoresearch: trial 1 (metric: 2)');
    expect(updateRunStatus).toHaveBeenCalledWith(runId, 'completed');
  });
});
