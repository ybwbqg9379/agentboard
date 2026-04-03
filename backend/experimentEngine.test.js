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
const stopAgent = vi.fn().mockResolvedValue(true);

vi.mock('./agentManager.js', () => ({
  startAgent,
  stopAgent,
  agentEvents,
}));

const createRun = vi.fn().mockResolvedValue(undefined);
const updateRunStatus = vi.fn().mockResolvedValue(undefined);
const updateRunMetrics = vi.fn().mockResolvedValue(undefined);
const updateRunBaseline = vi.fn().mockResolvedValue(undefined);
const updateRunError = vi.fn().mockResolvedValue(undefined);
const saveTrial = vi.fn().mockResolvedValue(undefined);

vi.mock('./experimentStore.js', () => ({
  createRun,
  updateRunStatus,
  updateRunMetrics,
  updateRunBaseline,
  updateRunError,
  saveTrial,
}));

const { runExperimentLoop, abortExperiment, getActiveExperiments } =
  await import('./experimentEngine.js');

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

  it('getActiveExperiments does not list runs when userId is missing (tenant isolation)', async () => {
    const runId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const sourceDir = uniqueDir('tenant-list-source');
    const workspaceDir = uniqueDir('tenant-list-run');
    const sleeperFile = resolve(sourceDir, 'sleeper.js');

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(sleeperFile, 'setTimeout(() => {}, 8000);');

    const runPromise = runExperimentLoop(
      'exp-tenants',
      {
        name: 'tenant isolation active list',
        target: { source_dir: sourceDir },
        metrics: {
          primary: {
            command: 'node sleeper.js',
            type: 'exit_code',
            direction: 'maximize',
          },
        },
      },
      'default',
      workspaceDir,
      runId,
    );

    await new Promise((r) => setTimeout(r, 250));
    expect(getActiveExperiments(undefined)).toEqual([]);
    expect(getActiveExperiments(null)).toEqual([]);
    expect(getActiveExperiments('')).toEqual([]);
    expect(getActiveExperiments('default')).toEqual([runId]);
    expect(getActiveExperiments('other-tenant')).toEqual([]);

    expect(abortExperiment(runId)).toBe(true);
    await runPromise;
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

    expect(updateRunStatus).toHaveBeenCalledWith(runId, 'failed', 'alice');
    expect(updateRunError).toHaveBeenCalledTimes(1);
    expect(updateRunError.mock.calls[0][1]).toContain('outside the allowed workspace');
    expect(updateRunError.mock.calls[0][1]).toContain(resolve(workspaceRoot, 'bob'));
  });

  it(
    'aborts a long-running baseline command promptly without blocking the event loop',
    { timeout: 10000 },
    async () => {
      const runId = '22222222-2222-2222-2222-222222222222';
      const sourceDir = uniqueDir('abort-source');
      const workspaceDir = uniqueDir('abort-run');
      const sleeperFile = resolve(sourceDir, 'sleeper.js');
      const startedAt = Date.now();

      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(sleeperFile, 'setTimeout(() => {}, 5000);');

      const runPromise = runExperimentLoop(
        'exp-abort',
        {
          name: 'abort baseline',
          target: { source_dir: sourceDir },
          metrics: {
            primary: {
              command: 'node sleeper.js',
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
      expect(updateRunStatus).toHaveBeenCalledWith(runId, 'aborted', 'default');
    },
  );

  it(
    'kills descendant worker processes when an experiment command is aborted',
    { timeout: 10000 },
    async () => {
      const runId = '33333333-3333-3333-3333-333333333333';
      const sourceDir = uniqueDir('process-tree-source');
      const workspaceDir = uniqueDir('process-tree-run');
      fs.mkdirSync(sourceDir, { recursive: true });

      const workerPidFile = resolve(sourceDir, 'worker.pid');
      const workerFile = resolve(sourceDir, 'worker.js');
      const parentFile = resolve(sourceDir, 'parent.js');

      fs.writeFileSync(
        workerFile,
        `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(workerPidFile)}, String(process.pid)); setInterval(() => {}, 100000);`,
      );
      fs.writeFileSync(
        parentFile,
        `const { spawn } = require('node:child_process'); const { resolve } = require('node:path'); spawn(process.execPath, [resolve(__dirname, 'worker.js')], { stdio: 'ignore' }); setInterval(() => {}, 100000);`,
      );

      const runPromise = runExperimentLoop(
        'exp-process-tree',
        {
          name: 'abort descendant workers',
          target: { source_dir: sourceDir },
          metrics: {
            primary: {
              command: 'node parent.js',
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
      expect(updateRunStatus).toHaveBeenCalledWith(runId, 'aborted', 'default');
    },
  );

  it('sets repo-local git identity when source_dir already contains a git repo', async () => {
    const runId = '44444444-4444-4444-4444-444444444444';
    const sourceDir = uniqueDir('source-repo');
    const workspaceDir = uniqueDir('identity-run');
    const scoreFile = resolve(sourceDir, 'score.txt');
    const readScoreFile = resolve(sourceDir, 'read-score.js');
    const sessionId = 'agent-session-identity';

    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(scoreFile, '1\n');
    fs.writeFileSync(
      readScoreFile,
      `const fs = require('node:fs'); console.log(fs.readFileSync('score.txt', 'utf8').trim());`,
    );
    execSync('git init', { cwd: sourceDir, stdio: 'pipe' });
    execSync('git add -A', { cwd: sourceDir, stdio: 'pipe' });
    execSync(
      'git -c user.name="Source Author" -c user.email="source@example.com" commit -m "source baseline"',
      {
        cwd: sourceDir,
        stdio: 'pipe',
      },
    );

    startAgent.mockImplementation(async (_prompt, opts) => {
      fs.writeFileSync(resolve(opts.cwd, 'score.txt'), '2\n');
      // Use setTimeout(0) to push to macrotask queue -- ensures the await
      // assignment of capturedSessionId completes before the event fires
      setTimeout(() => {
        agentEvents.emit('event', { sessionId, type: 'done' });
      }, 0);
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
            command: 'node read-score.js',
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
    expect(updateRunStatus).toHaveBeenCalledWith(runId, 'completed', 'default');
  });

  it('rejects non-allowlisted benchmark executables before running the experiment', async () => {
    const runId = '55555555-5555-5555-5555-555555555555';
    const workspaceDir = uniqueDir('blocked-executable-run');

    await runExperimentLoop(
      'exp-blocked-executable',
      {
        name: 'blocked executable',
        metrics: {
          primary: {
            command: 'uname -a',
            type: 'exit_code',
            direction: 'maximize',
          },
        },
      },
      'default',
      workspaceDir,
      runId,
    );

    expect(updateRunStatus).toHaveBeenCalledWith(runId, 'failed', 'default');
    expect(updateRunError.mock.calls.at(-1)[1]).toContain('not allowed');
  });

  it('rejects node benchmark commands that use inline evaluation flags', async () => {
    const runId = '66666666-6666-6666-6666-666666666666';
    const workspaceDir = uniqueDir('node-inline-eval-run');

    await runExperimentLoop(
      'exp-node-inline-eval',
      {
        name: 'node inline eval blocked',
        metrics: {
          primary: {
            command: 'node -e "process.exit(0)"',
            type: 'exit_code',
            direction: 'maximize',
          },
        },
      },
      'default',
      workspaceDir,
      runId,
    );

    expect(updateRunStatus).toHaveBeenCalledWith(runId, 'failed', 'default');
    expect(updateRunError.mock.calls.at(-1)[1]).toContain('workspace-local script file');
  });

  it(
    'parses escaped quotes inside double-quoted benchmark arguments correctly',
    { timeout: 10000 },
    async () => {
      const runId = '77777777-7777-7777-7777-777777777777';
      const sourceDir = uniqueDir('escaped-quotes-source');
      const workspaceDir = uniqueDir('escaped-quotes-run');
      const assertArgFile = resolve(sourceDir, 'assert-arg.js');
      const sessionId = 'agent-session-escaped-quotes';

      fs.mkdirSync(sourceDir, { recursive: true });
      fs.writeFileSync(
        assertArgFile,
        `
const expected = 'a "b" c';
if (process.argv[2] !== expected) {
  console.error(\`expected="\${expected}" actual="\${process.argv[2] || ''}"\`);
  process.exit(1);
}
process.exit(0);
      `.trim(),
      );

      startAgent.mockImplementation(async (_prompt) => {
        setTimeout(() => {
          agentEvents.emit('event', { sessionId, type: 'done' });
        }, 0);
        return sessionId;
      });

      await runExperimentLoop(
        'exp-escaped-quotes',
        {
          name: 'escaped quotes',
          target: { source_dir: sourceDir },
          metrics: {
            primary: {
              command: 'node assert-arg.js "a \\"b\\" c"',
              type: 'exit_code',
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

      expect(updateRunBaseline).toHaveBeenCalledWith(runId, 1, 'default');
      expect(updateRunStatus).toHaveBeenCalledWith(runId, 'completed', 'default');
    },
  );
});
