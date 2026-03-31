/**
 * Claude Code Agent SDK hook definitions.
 *
 * buildHooks(emitter, sessionId) returns a hooks configuration object
 * consumed by the SDK's `query()` call to intercept tool use, subagent
 * lifecycle, and session completion events.
 */

import { recordToolCall } from './mcpHealth.js';

const BLOCKED_PATTERNS = [
  /rm\s+(-\w*\s+)*-rf\s+[/~]/,
  /\|\s*(sh|bash|zsh)\b/,
  /\bsudo\b/,
  /\b(>\s*|tee\s+)(\/etc|\/usr|\/System|\/bin|\/sbin)\//,
];

function isDangerous(command) {
  return BLOCKED_PATTERNS.some((p) => p.test(command));
}

/**
 * Build a hooks configuration object for a single agent session.
 *
 * @param {import('node:events').EventEmitter} emitter - shared event bus
 * @param {string} sessionId - UUID of the current session
 * @returns {object} hooks config accepted by the Claude Code Agent SDK
 */
export function buildHooks(emitter, sessionId) {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          async (input) => {
            try {
              const command = input?.tool_input?.command;
              if (isDangerous(command)) {
                const reason = `Blocked dangerous command: ${command}`;
                console.warn(`[hooks] ${reason} (session=${sessionId})`);
                emitter.emit('event', {
                  sessionId,
                  type: 'system',
                  subtype: 'hook',
                  content: { message: reason },
                  timestamp: Date.now(),
                });
                return {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse',
                    permissionDecision: 'deny',
                    permissionDecisionReason: reason,
                  },
                };
              }
              return {};
            } catch (err) {
              console.error(`[hooks] PreToolUse error (session=${sessionId}):`, err);
              return {};
            }
          },
        ],
      },
    ],

    PostToolUse: [
      {
        hooks: [
          async (input) => {
            try {
              const toolName = input?.tool_name;
              recordToolCall(toolName, true, null);
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'tool_complete',
                content: { tool: toolName, message: `Tool ${toolName} completed` },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PostToolUse error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    PostToolUseFailure: [
      {
        hooks: [
          async (input) => {
            try {
              const toolName = input?.tool_name;
              const error = input?.error || 'unknown';
              recordToolCall(toolName, false, error);
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'tool_failed',
                content: { tool: toolName, error, message: `Tool ${toolName} failed: ${error}` },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PostToolUseFailure error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    SubagentStart: [
      {
        hooks: [
          async (input) => {
            try {
              const agentName = input?.agent_name;
              console.log(`[hooks] Subagent started: ${agentName} (session=${sessionId})`);
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'subagent',
                content: { message: `Delegated to subagent: ${agentName}`, agent: agentName },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] SubagentStart error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    SubagentStop: [
      {
        hooks: [
          async (input) => {
            try {
              const agentType = input?.agent_type;
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'subagent_stop',
                content: {
                  message: `Subagent completed: ${agentType}`,
                  agent: agentType,
                },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] SubagentStop error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    PermissionDenied: [
      {
        hooks: [
          async (input) => {
            try {
              const toolName = input?.tool_name;
              const reason = input?.reason || 'denied';
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'permission_denied',
                content: {
                  tool: toolName,
                  reason,
                  message: `Permission denied: ${toolName} -- ${reason}`,
                },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PermissionDenied error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    UserPromptSubmit: [
      {
        hooks: [
          async (input) => {
            try {
              const prompt = input?.prompt || '';
              // Log prompt submission for audit trail
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'prompt_submitted',
                content: {
                  message: `Prompt received (${prompt.length} chars)`,
                  length: prompt.length,
                },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] UserPromptSubmit error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    Stop: [
      {
        hooks: [
          async () => {
            try {
              console.log(`[hooks] Agent stopped (session=${sessionId})`);
            } catch (err) {
              console.error(`[hooks] Stop error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    PreCompact: [
      {
        hooks: [
          async () => {
            try {
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'pre_compact',
                content: { message: 'Context window compaction starting' },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PreCompact error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    PostCompact: [
      {
        hooks: [
          async () => {
            try {
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'post_compact',
                content: { message: 'Context window compaction completed' },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PostCompact error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    SessionStart: [
      {
        hooks: [
          async () => {
            try {
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'session_start',
                content: { message: 'Session initialized' },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] SessionStart error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],

    SessionEnd: [
      {
        hooks: [
          async () => {
            try {
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'session_end',
                content: { message: 'Session ended' },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] SessionEnd error (session=${sessionId}):`, err);
            }
            return { async: true };
          },
        ],
      },
    ],
  };
}
