import { query } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import config from './config.js';
import { createSession, updateSessionStatus, insertEvent } from './sessionStore.js';

// 活跃的 Agent Query Map<sessionId, Query>
const activeAgents = new Map();

export const agentEvents = new EventEmitter();

const WORKSPACE = resolve(config.workspaceDir);

/**
 * 启动一个 Claude Code Agent (SDK 方式)
 * @param {string} prompt - 用户指令
 * @returns {string} sessionId
 */
export function startAgent(prompt) {
  const sessionId = createSession(prompt);

  const stream = query({
    prompt,
    options: {
      cwd: WORKSPACE,
      permissionMode: 'bypassPermissions',
      maxTurns: 50,
      systemPrompt: [
        `[SECURITY] You are sandboxed to: ${WORKSPACE}`,
        `All file operations MUST stay within this directory.`,
        `NEVER use absolute paths outside ${WORKSPACE}.`,
        `NEVER access parent directories beyond ${WORKSPACE}.`,
      ].join('\n'),
      // 不加载用户级配置，完全隔离
      settingSources: [],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: resolve(WORKSPACE, '.tmp'),
        ANTHROPIC_BASE_URL: config.litellm.url,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'placeholder',
      },
    },
  });

  activeAgents.set(sessionId, stream);

  // 异步消费事件流
  (async () => {
    try {
      for await (const message of stream) {
        const wrapped = {
          sessionId,
          type: message.type,
          subtype: message.subtype || null,
          content: message,
          timestamp: Date.now(),
        };

        insertEvent(sessionId, message.type, message);
        agentEvents.emit('event', wrapped);
      }

      updateSessionStatus(sessionId, 'completed');
    } catch (err) {
      const errEvent = {
        sessionId,
        type: 'stderr',
        content: { text: err.message || String(err) },
        timestamp: Date.now(),
      };
      insertEvent(sessionId, 'stderr', { text: err.message });
      agentEvents.emit('event', errEvent);
      updateSessionStatus(sessionId, 'failed');
    } finally {
      activeAgents.delete(sessionId);
      agentEvents.emit('event', {
        sessionId,
        type: 'done',
        content: { status: 'completed' },
        timestamp: Date.now(),
      });
    }
  })();

  // 超时保护
  setTimeout(() => {
    if (activeAgents.has(sessionId)) {
      stopAgent(sessionId);
    }
  }, config.agentTimeout);

  return sessionId;
}

/**
 * 停止一个运行中的 Agent
 */
export function stopAgent(sessionId) {
  const stream = activeAgents.get(sessionId);
  if (!stream) return false;

  stream.return();
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
