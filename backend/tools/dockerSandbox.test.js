/**
 * dockerSandbox unit tests — Dockerode is fully mocked (no real daemon).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import stream from 'node:stream';

const mockCreateContainer = vi.hoisted(() => vi.fn());

vi.mock('dockerode', () => ({
  default: class MockDocker {
    createContainer(opts) {
      return mockCreateContainer(opts);
    }
  },
}));

import { executeInSandbox } from './dockerSandbox.js';

function makeContainer({
  statusCode = 0,
  waitMs = 0,
  waitError = null,
  endStreamsAfterMs = 0,
} = {}) {
  return {
    start: vi.fn().mockResolvedValue(undefined),
    logs: vi.fn().mockResolvedValue(new stream.PassThrough()),
    kill: vi.fn().mockResolvedValue(undefined),
    wait: vi.fn().mockImplementation(() => {
      if (waitError) return Promise.reject(waitError);
      if (waitMs === 0) return Promise.resolve({ StatusCode: statusCode });
      return new Promise((resolve) =>
        setTimeout(() => resolve({ StatusCode: statusCode }), waitMs),
      );
    }),
    modem: {
      demuxStream: vi.fn((_log, out, err) => {
        setTimeout(() => {
          out.end();
          err.end();
        }, endStreamsAfterMs);
      }),
    },
  };
}

beforeEach(() => {
  mockCreateContainer.mockReset();
});

describe('executeInSandbox', () => {
  it('uses node:20-alpine and node -e for node language', async () => {
    const c = makeContainer({ endStreamsAfterMs: 0 });
    mockCreateContainer.mockResolvedValue(c);

    await executeInSandbox('/tmp/ws', 'console.log(1)', 'node', 5000);

    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'node:20-alpine',
        Cmd: ['node', '-e', 'console.log(1)'],
        HostConfig: expect.objectContaining({
          NetworkMode: 'none',
          Binds: ['/tmp/ws:/workspace'],
        }),
        WorkingDir: '/workspace',
      }),
    );
    expect(c.start).toHaveBeenCalledOnce();
  });

  it('maps js/javascript aliases to node image', async () => {
    const c = makeContainer();
    mockCreateContainer.mockResolvedValue(c);
    await executeInSandbox('/w', '0', 'javascript', 5000);
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({ Image: 'node:20-alpine' }),
    );
  });

  it('uses python:3.12-alpine for python', async () => {
    const c = makeContainer();
    mockCreateContainer.mockResolvedValue(c);
    await executeInSandbox('/w', 'print(1)', 'py', 5000);
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'python:3.12-alpine',
        Cmd: ['python', '-c', 'print(1)'],
      }),
    );
  });

  it('defaults to alpine sh for bash', async () => {
    const c = makeContainer();
    mockCreateContainer.mockResolvedValue(c);
    await executeInSandbox('/w', 'echo hi', 'bash', 5000);
    expect(mockCreateContainer).toHaveBeenCalledWith(
      expect.objectContaining({
        Image: 'alpine:3.19',
        Cmd: ['sh', '-c', 'echo hi'],
      }),
    );
  });

  it('throws helpful message when image is missing (404)', async () => {
    mockCreateContainer.mockRejectedValue({ statusCode: 404 });
    await expect(executeInSandbox('/w', 'true', 'bash', 5000)).rejects.toThrow(
      /docker pull alpine:3\.19/i,
    );
  });

  it('returns stdout, stderr, and exitCode when wait succeeds', async () => {
    const c = makeContainer({ statusCode: 3, endStreamsAfterMs: 0 });
    mockCreateContainer.mockResolvedValue(c);

    const out = await executeInSandbox('/workspace', 'x', 'bash', 5000);
    expect(out.exitCode).toBe(3);
    expect(out).toHaveProperty('stdout');
    expect(out).toHaveProperty('stderr');
  });

  it('rejects with timeout when wait is too slow', async () => {
    const c = makeContainer({ waitMs: 100_000, endStreamsAfterMs: 0 });
    mockCreateContainer.mockResolvedValue(c);

    await expect(executeInSandbox('/w', 'sleep', 'bash', 80)).rejects.toThrow(/timed out/i);
    expect(c.kill).toHaveBeenCalled();
  });
});
