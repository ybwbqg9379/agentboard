/**
 * Claude Code Agent SDK hook definitions.
 *
 * buildHooks(emitter, sessionId) returns a hooks configuration object
 * consumed by the SDK's `query()` call to intercept tool use, subagent
 * lifecycle, and session completion events.
 */

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
                    reason,
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
  };
}
