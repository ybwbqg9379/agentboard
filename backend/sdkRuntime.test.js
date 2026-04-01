import { describe, it, expect } from 'vitest';
import { dirname } from 'node:path';
import { buildAgentEnv, getAgentRuntimePath, getSdkExecutablePath } from './sdkRuntime.js';

describe('sdkRuntime', () => {
  it('uses the current Node executable path for SDK subprocesses', () => {
    expect(getSdkExecutablePath()).toBe(process.execPath);
  });

  it('prepends the current Node bin directory to the restricted PATH', () => {
    const runtimePath = getAgentRuntimePath();
    const pathEntries = runtimePath.split(':');

    expect(pathEntries[0]).toBe(dirname(process.execPath));
    expect(pathEntries).toContain('/usr/local/bin');
    expect(pathEntries).toContain('/usr/bin');
    expect(pathEntries).toContain('/bin');
  });

  it('builds agent env with SDK transport and workspace variables', () => {
    const env = buildAgentEnv({
      userWorkspace: '/tmp/agentboard-workspace',
      proxyUrl: 'http://localhost:4000',
      apiKey: 'test-key',
    });

    expect(env.PATH.split(':')[0]).toBe(dirname(process.execPath));
    expect(env.HOME).toBe('/tmp/agentboard-workspace');
    expect(env.TMPDIR).toBe('/tmp/agentboard-workspace/.tmp');
    expect(env.ANTHROPIC_BASE_URL).toBe('http://localhost:4000');
    expect(env.ANTHROPIC_API_KEY).toBe('test-key');
  });
});
