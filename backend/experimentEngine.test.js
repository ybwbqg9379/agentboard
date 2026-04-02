import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
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
});
