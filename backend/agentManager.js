import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import config from './config.js';
import {
  createSession,
  updateSessionStatus,
  insertEvent,
} from './sessionStore.js';

// 活跃的 Agent 进程 Map<sessionId, ChildProcess>
const activeAgents = new Map();

export const agentEvents = new EventEmitter();

// workspace 绝对路径（用于安全约束）
const WORKSPACE = resolve(config.workspaceDir);

/**
 * 构建注入到 prompt 前的安全约束指令
 */
function buildSandboxedPrompt(prompt) {
  return [
    `[SECURITY] You are sandboxed to: ${WORKSPACE}`,
    `All file operations MUST stay within this directory.`,
    `NEVER use absolute paths outside ${WORKSPACE}.`,
    `NEVER access parent directories beyond ${WORKSPACE}.`,
    `If the task requires files outside this directory, refuse and explain why.`,
    ``,
    `[TASK] ${prompt}`,
  ].join('\n');
}

/**
 * 启动一个 Claude Code Agent subprocess
 * @param {string} prompt - 用户指令
 * @returns {string} sessionId
 */
export function startAgent(prompt) {
  const sessionId = createSession(prompt);
  const sandboxedPrompt = buildSandboxedPrompt(prompt);

  const agent = spawn('claude', [
    '-p', sandboxedPrompt,
    '--output-format', 'stream-json',
    '--verbose',
    '--dangerously-skip-permissions',
  ], {
    cwd: WORKSPACE,
    env: {
      // 最小化环境变量，只传递必要的
      PATH: process.env.PATH,
      HOME: WORKSPACE,
      TMPDIR: resolve(WORKSPACE, '.tmp'),
      ANTHROPIC_BASE_URL: config.litellm.url,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'placeholder',
      // 防止 Claude Code 读取用户级配置
      CLAUDE_CONFIG_DIR: resolve(WORKSPACE, '.claude'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  activeAgents.set(sessionId, agent);

  let buffer = '';

  agent.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    // 保留最后一行（可能不完整）
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const wrapped = {
          sessionId,
          type: event.type,
          content: event,
          timestamp: Date.now(),
        };
        insertEvent(sessionId, event.type, event);
        agentEvents.emit('event', wrapped);
      } catch {
        // 非 JSON 行，作为 raw output 推送
        const wrapped = {
          sessionId,
          type: 'raw',
          content: { text: line },
          timestamp: Date.now(),
        };
        agentEvents.emit('event', wrapped);
      }
    }
  });

  agent.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    const wrapped = {
      sessionId,
      type: 'stderr',
      content: { text },
      timestamp: Date.now(),
    };
    insertEvent(sessionId, 'stderr', { text });
    agentEvents.emit('event', wrapped);
  });

  agent.on('close', (code) => {
    // 处理 buffer 中剩余数据
    if (buffer.trim()) {
      try {
        const event = JSON.parse(buffer);
        insertEvent(sessionId, event.type, event);
        agentEvents.emit('event', {
          sessionId,
          type: event.type,
          content: event,
          timestamp: Date.now(),
        });
      } catch {
        // ignore
      }
    }

    const status = code === 0 ? 'completed' : 'failed';
    updateSessionStatus(sessionId, status);
    activeAgents.delete(sessionId);

    agentEvents.emit('event', {
      sessionId,
      type: 'done',
      content: { exitCode: code, status },
      timestamp: Date.now(),
    });
  });

  // 超时保护
  const timer = setTimeout(() => {
    if (activeAgents.has(sessionId)) {
      stopAgent(sessionId);
    }
  }, config.agentTimeout);

  agent.on('close', () => clearTimeout(timer));

  return sessionId;
}

/**
 * 停止一个运行中的 Agent
 */
export function stopAgent(sessionId) {
  const agent = activeAgents.get(sessionId);
  if (!agent) return false;

  agent.kill('SIGTERM');
  // 3 秒后强制 kill
  setTimeout(() => {
    if (!agent.killed) agent.kill('SIGKILL');
  }, 3000);

  updateSessionStatus(sessionId, 'stopped');
  activeAgents.delete(sessionId);
  return true;
}

/**
 * 获取活跃 Agent 列表
 */
export function getActiveAgents() {
  return [...activeAgents.keys()];
}
