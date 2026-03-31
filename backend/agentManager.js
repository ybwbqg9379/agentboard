import { query } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import config from './config.js';
import {
  createSession,
  updateSessionStatus,
  updateSessionStats,
  insertEvent,
} from './sessionStore.js';
import { getMcpServers, getAllowedTools } from './mcpConfig.js';
import { getAgentDefs } from './agentDefs.js';
import { buildHooks } from './hooks.js';
import { initMcpHealth } from './mcpHealth.js';

// 活跃的 Agent Query Map<sessionId, { stream, timeoutId }>
const activeAgents = new Map();

export const agentEvents = new EventEmitter();

const WORKSPACE = resolve(config.workspaceDir);
const PLUGINS_DIR = resolve(config.pluginsDir);

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
      allowDangerouslySkipPermissions: true,
      maxTurns: 50,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: [
          `[SECURITY] You are sandboxed to: ${WORKSPACE}`,
          `All file operations MUST stay within this directory.`,
          `NEVER use absolute paths outside ${WORKSPACE}.`,
          `NEVER access parent directories beyond ${WORKSPACE}.`,
        ].join('\n'),
      },
      settingSources: [],
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        TMPDIR: resolve(WORKSPACE, '.tmp'),
        ANTHROPIC_BASE_URL: config.litellm.url,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || 'placeholder',
        CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: '1',
      },

      // MCP Servers
      mcpServers: getMcpServers(WORKSPACE),
      allowedTools: getAllowedTools(),

      // Subagents
      agents: getAgentDefs(),

      // Hooks
      hooks: buildHooks(agentEvents, sessionId),

      // Streaming deltas for real-time rendering
      includePartialMessages: true,

      // File change tracking for rollback (SDK mode uses env var)
      enableFileCheckpointing: true,
      // Also set env var for SDK mode compatibility

      // Skills (via local plugin)
      plugins: [{ type: 'local', path: resolve(PLUGINS_DIR, 'agentboard-skills') }],
    },
  });

  // 超时保护
  const timeoutId = setTimeout(() => {
    if (activeAgents.has(sessionId)) {
      stopAgent(sessionId);
    }
  }, config.agentTimeout);

  activeAgents.set(sessionId, { stream, timeoutId, stopped: false });

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

        // Initialize MCP health from init message
        if (message.type === 'system' && message.subtype === 'init' && message.mcp_servers) {
          initMcpHealth(message.mcp_servers);
        }

        // Extract session stats from result messages
        if (message.type === 'result') {
          const stats = {
            cost_usd: message.total_cost_usd || 0,
            input_tokens: message.usage?.input_tokens || 0,
            output_tokens: message.usage?.output_tokens || 0,
            duration_ms: message.duration_ms || 0,
            num_turns: message.num_turns || 0,
            model: null,
          };
          if (message.modelUsage) {
            const models = Object.keys(message.modelUsage);
            if (models.length > 0) stats.model = models[0];
          }
          updateSessionStats(sessionId, stats);
        }
      }
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
    } finally {
      const entry = activeAgents.get(sessionId);
      if (entry) {
        clearTimeout(entry.timeoutId);
        if (entry.stopped) finalStatus = 'stopped';
      }
      activeAgents.delete(sessionId);
      updateSessionStatus(sessionId, finalStatus);
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

  entry.stopped = true;
  clearTimeout(entry.timeoutId);
  try {
    entry.stream.return();
  } catch (err) {
    console.warn(`[agentManager] stream.return() error: ${err.message}`);
  }
  return true;
}

/**
 * 获取活跃 Agent 列表
 */
export function getActiveAgents() {
  return [...activeAgents.keys()];
}
