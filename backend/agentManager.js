import { query } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import config from './config.js';
import { createSession, updateSessionStatus, insertEvent } from './sessionStore.js';

// 活跃的 Agent Query Map<sessionId, { stream, timeoutId }>
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

  // 超时保护
  const timeoutId = setTimeout(() => {
    if (activeAgents.has(sessionId)) {
      stopAgent(sessionId);
    }
  }, config.agentTimeout);

  activeAgents.set(sessionId, { stream, timeoutId });

  // 异步消费事件流
  (async () => {
    let finalStatus = 'completed';
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
      finalStatus = 'failed';
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
      const entry = activeAgents.get(sessionId);
      if (entry) clearTimeout(entry.timeoutId);
      activeAgents.delete(sessionId);
      agentEvents.emit('event', {
        sessionId,
        type: 'done',
        content: { status: finalStatus },
        timestamp: Date.now(),
      });
    }
  })();

  return sessionId;
}

/**
 * 停止一个运行中的 Agent
 */
export function stopAgent(sessionId) {
  const entry = activeAgents.get(sessionId);
  if (!entry) return false;

  clearTimeout(entry.timeoutId);
  entry.stream.return();
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
