import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import config from './config.js';
import {
  createSession,
  updateSessionStatus,
  insertEvent,
} from './sessionStore.js';

// 活跃的 Agent 进程 Map<sessionId, ChildProcess>
const activeAgents = new Map();

export const agentEvents = new EventEmitter();

/**
 * 启动一个 Claude Code Agent subprocess
 * @param {string} prompt - 用户指令
 * @returns {string} sessionId
 */
export function startAgent(prompt) {
  const sessionId = createSession(prompt);

  const agent = spawn('claude', ['-p', prompt, '--output-format', 'stream-json'], {
    cwd: config.workspaceDir,
    env: {
      ...process.env,
      ANTHROPIC_BASE_URL: config.litellm.url,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'placeholder',
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
