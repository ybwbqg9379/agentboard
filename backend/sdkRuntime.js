import { dirname, delimiter, resolve } from 'node:path';

const BASE_AGENT_PATHS = ['/usr/local/bin', '/usr/bin', '/bin'];

export function getSdkExecutablePath(execPath = process.execPath) {
  return execPath;
}

export function getAgentRuntimePath(execPath = process.execPath) {
  const runtimePaths = [dirname(getSdkExecutablePath(execPath)), ...BASE_AGENT_PATHS];
  return [...new Set(runtimePaths.filter(Boolean))].join(delimiter);
}

export function buildAgentEnv({ userWorkspace, proxyUrl, apiKey, execPath = process.execPath }) {
  return {
    PATH: getAgentRuntimePath(execPath),
    HOME: userWorkspace,
    TMPDIR: resolve(userWorkspace, '.tmp'),
    ANTHROPIC_BASE_URL: proxyUrl,
    ANTHROPIC_API_KEY: apiKey || 'placeholder',
    CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
  };
}
