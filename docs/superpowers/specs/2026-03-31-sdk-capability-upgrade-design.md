# AgentBoard SDK Capability Upgrade Design

> v0.3.0 -- Maximize Claude Agent SDK extensibility without modifying core SDK code

## Goal

Upgrade AgentBoard from only using `query()` with 6 basic options to leveraging the full SDK extension surface: MCP Servers, Subagents, Hooks, and structured code organization. All backend changes, no frontend modifications needed.

## Current State

`agentManager.js` calls `query()` with:

- `cwd`, `permissionMode`, `maxTurns`, `systemPrompt` (string), `settingSources`, `env`

Agent can only use built-in tools (Bash, Read, Write, Edit, Glob, Grep). No internet access, no persistent memory, no task delegation, no safety hooks.

## Target State

Agent gains: internet browsing, persistent memory, GitHub integration, structured reasoning, task delegation to specialist subagents, safety guardrails, and real-time tool event visibility.

---

## 1. MCP Servers

5 external MCP servers, all open-source npm packages launched via `npx`:

| Server              | npm Package                                        | Version    | Purpose                                         |
| ------------------- | -------------------------------------------------- | ---------- | ----------------------------------------------- |
| filesystem          | `@modelcontextprotocol/server-filesystem`          | 2026.1.14  | Directory trees, file metadata, advanced search |
| memory              | `@modelcontextprotocol/server-memory`              | 2026.1.26  | Knowledge-graph persistent memory across tasks  |
| browser             | `@playwright/mcp`                                  | 0.0.69     | Web browsing, screenshots, form interaction     |
| github              | `@modelcontextprotocol/server-github`              | 2025.4.8   | Issues, PRs, code search, repo operations       |
| sequential-thinking | `@modelcontextprotocol/server-sequential-thinking` | 2025.12.18 | Multi-step structured reasoning                 |

### Configuration Pattern

Each server is configured in `mcpConfig.js` as a stdio transport:

```javascript
{
  command: 'npx',
  args: ['-y', '<package-name>', ...extraArgs],
  env: { ...credentials }
}
```

### Tool Permissions

All MCP tools are explicitly allowed via `allowedTools` wildcards:

```javascript
[
  'mcp__filesystem__*',
  'mcp__memory__*',
  'mcp__browser__*',
  'mcp__github__*',
  'mcp__sequential-thinking__*',
];
```

### Environment Variables

New env vars needed in `.env.local`:

| Variable       | Required | Used By                                           |
| -------------- | -------- | ------------------------------------------------- |
| `GITHUB_TOKEN` | Optional | github MCP server (without it, public repos only) |

No other API keys needed. filesystem, memory, sequential-thinking, and browser work without credentials.

---

## 2. Subagents

4 specialist subagents, defined in `agentDefs.js`:

### code-reviewer

- **Description**: Review code for quality, security vulnerabilities, and design patterns
- **Tools**: Read, Glob, Grep (read-only, cannot modify files)
- **Use case**: Main agent delegates code review before committing

### test-writer

- **Description**: Write comprehensive tests including edge cases and error scenarios
- **Tools**: Read, Write, Bash, Glob (needs Write for test files, Bash to run tests)
- **Use case**: Main agent delegates test creation after implementing features

### researcher

- **Description**: Research topics by browsing the web, reading documentation, and summarizing findings
- **Tools**: Read, Grep, mcp**browser**\* (internet access for research)
- **Use case**: Main agent delegates when it needs external information

### architect

- **Description**: Analyze complex tasks, design solutions, and break down work into steps
- **Tools**: Read, Glob, Grep, mcp**sequential-thinking**\* (structured reasoning)
- **Use case**: Main agent delegates when facing complex multi-step problems

### Design Rules

- No subagent gets the `Agent` tool (no recursive delegation)
- Only test-writer gets `Write` and `Bash` (principle of least privilege)
- All inherit the main model (MiniMax via proxy) -- no model override since proxy only handles one backend
- Subagent prompts are concise -- describe role and constraints, not general instructions

---

## 3. Hooks

4 hooks defined in `hooks.js`:

### PreToolUse (matcher: "Bash") -- Synchronous

Intercepts every Bash command before execution. Checks against a blocklist:

**Blocked patterns:**

- `rm -rf /` or `rm -rf ~` (destructive deletion of root/home)
- `curl ... | sh` or `wget ... | sh` (remote code execution)
- Commands containing `sudo`
- Writes to system paths (`/etc`, `/usr`, `/System`, `/bin`, `/sbin`)

**Returns:**

- `{ hookSpecificOutput: { permissionDecision: 'deny', reason: '...' } }` if blocked
- `{}` if allowed (proceed normally)

### PostToolUse -- Asynchronous

Fires after every tool call completes. Emits a structured event to `agentEvents` so the frontend Timeline can visualize MCP tool calls (not just built-in tools).

**Returns:** `{ async: true }` (fire-and-forget, does not block the agent)

### SubagentStart -- Asynchronous

Fires when a subagent is spawned. Logs which agent was selected and what task it received. Emits to `agentEvents` for Timeline visibility.

**Returns:** `{ async: true }`

### Stop -- Asynchronous

Fires when the agent session ends. Generates a brief session summary. If memory MCP is available, stores the summary for cross-session context.

**Returns:** `{ async: true }`

---

## 4. Code Organization

### New Files

| File                   | Responsibility                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| `backend/mcpConfig.js` | MCP server configs + allowedTools list                                                      |
| `backend/agentDefs.js` | Subagent definitions                                                                        |
| `backend/hooks.js`     | Hook callback functions + hooks config factory (accepts emitter + sessionId per invocation) |

### Modified Files

| File                      | Changes                                       |
| ------------------------- | --------------------------------------------- |
| `backend/agentManager.js` | Import new modules, expand `query()` options  |
| `backend/config.js`       | Add MCP-related config (GitHub token env var) |
| `CHANGELOG.md`            | v0.3.0 entry                                  |
| `docs/architecture.md`    | Updated architecture diagram and module table |
| `package.json`            | Version bump to 0.3.0                         |

### Unchanged Files

| File                      | Why                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `backend/server.js`       | REST API + WebSocket broadcast unchanged                                                    |
| `backend/sessionStore.js` | SQLite persistence unchanged                                                                |
| `backend/proxy.js`        | Anthropic-to-OpenAI translation unchanged                                                   |
| `frontend/*`              | Timeline already renders tool_use/tool_result events -- MCP tool events use the same format |

---

## 5. systemPrompt Strategy

Change from a plain string to the SDK preset with appended sandbox constraints:

```javascript
systemPrompt: {
  type: 'preset',
  preset: 'claude_code',
  append: [
    '[SECURITY] You are sandboxed to: ' + WORKSPACE,
    'All file operations MUST stay within this directory.',
  ].join('\n'),
}
```

**Risk**: The `claude_code` preset is designed for Claude models. MiniMax may not fully understand it. If MiniMax performance degrades after this change, fall back to a hand-written system prompt that includes the essential instructions (tool usage patterns, safety rules, output format).

---

## 6. Additional SDK Options

| Option                    | Value  | Purpose                                             |
| ------------------------- | ------ | --------------------------------------------------- |
| `includePartialMessages`  | `true` | Emit streaming delta events for real-time rendering |
| `enableFileCheckpointing` | `true` | Track file changes for rewind/rollback support      |

---

## 7. Risk Mitigation

| Risk                                       | Mitigation                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| MCP server crash takes down the agent      | Each MCP is a separate subprocess; crash only affects that server's tools                                |
| MiniMax struggles with too many tools      | Start with all 5 MCP servers; if tool selection degrades, reduce to 3 (drop github, sequential-thinking) |
| `claude_code` preset confuses MiniMax      | Prepared fallback: hand-written system prompt with essential instructions only                           |
| Hook callback throws exception             | All hook callbacks wrapped in try/catch; errors logged but never block the agent                         |
| Browser MCP opens unwanted sites           | Agent is sandboxed by system prompt; browser actions are logged via PostToolUse hook                     |
| npx cold start latency on first MCP launch | First agent task will be slower; subsequent tasks reuse npm cache                                        |

---

## 8. Testing Strategy

Manual verification in this order:

1. Start dev server (`npm run dev`), create an agent task
2. Verify MCP servers initialize (check backend logs for connection status)
3. Test basic task -- agent should use built-in tools as before (regression check)
4. Test memory -- ask agent to remember something, start new session, ask to recall
5. Test browser -- ask agent to look up documentation on the web
6. Test subagent -- give a task that involves code review (should delegate to code-reviewer)
7. Test safety hook -- send a task that would trigger `rm -rf /` (should be blocked)
8. Test Timeline -- verify MCP tool events appear in the frontend Timeline

---

## 9. Future Iterations (Out of Scope)

- Frontend MCP server management UI
- Custom in-process tools via `createSdkMcpServer()` + `tool()`
- Plugin directory structure for distribution
- V2 Session API for multi-turn conversations
- `onElicitation` callback for MCP OAuth flows
- `outputFormat` for structured JSON responses
