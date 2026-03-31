# SDK Capability Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade AgentBoard from basic SDK usage to full MCP + Subagents + Hooks extension, giving the agent internet browsing, persistent memory, GitHub integration, structured reasoning, task delegation, and safety guardrails.

**Architecture:** 3 new backend modules (`mcpConfig.js`, `agentDefs.js`, `hooks.js`) each export configuration objects. `agentManager.js` imports and assembles them into the `query()` options. No frontend changes needed -- existing Timeline already renders MCP tool events.

**Tech Stack:** Claude Agent SDK 0.2.88, MCP protocol (stdio transport), 5 open-source MCP server npm packages

**Spec:** `docs/superpowers/specs/2026-03-31-sdk-capability-upgrade-design.md`

---

## File Map

### New Files

| File                   | Responsibility                         |
| ---------------------- | -------------------------------------- |
| `backend/mcpConfig.js` | MCP server configs + allowedTools list |
| `backend/agentDefs.js` | 4 subagent definitions                 |
| `backend/hooks.js`     | 4 hook callbacks + config factory      |

### Modified Files

| File                      | What Changes                                                                                                                                     |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `backend/config.js`       | Add `github.token` config field                                                                                                                  |
| `backend/agentManager.js` | Import 3 new modules, expand `query()` options with mcpServers, agents, hooks, includePartialMessages, enableFileCheckpointing, new systemPrompt |
| `.env.example`            | Add `GITHUB_TOKEN`                                                                                                                               |
| `package.json`            | Version 0.2.1 -> 0.3.0                                                                                                                           |
| `CHANGELOG.md`            | Add v0.3.0 entry                                                                                                                                 |
| `docs/architecture.md`    | Updated diagram, module table, security table                                                                                                    |

---

### Task 1: Create mcpConfig.js

**Files:**

- Create: `backend/mcpConfig.js`

- [ ] **Step 1: Create the MCP configuration module**

```javascript
import { resolve } from 'node:path';

/**
 * MCP 服务器配置
 * 每个服务器通过 npx stdio transport 启动，独立子进程
 */
export function getMcpServers(workspacePath) {
  return {
    filesystem: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', workspacePath],
    },

    memory: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-memory'],
    },

    browser: {
      command: 'npx',
      args: ['-y', '@playwright/mcp'],
    },

    github: {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: {
        ...(process.env.GITHUB_TOKEN
          ? { GITHUB_PERSONAL_ACCESS_TOKEN: process.env.GITHUB_TOKEN }
          : {}),
      },
    },

    'sequential-thinking': {
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    },
  };
}

/**
 * MCP 工具白名单
 * 使用通配符允许每个 MCP 服务器的所有工具
 */
export function getAllowedTools() {
  return [
    'mcp__filesystem__*',
    'mcp__memory__*',
    'mcp__browser__*',
    'mcp__github__*',
    'mcp__sequential-thinking__*',
  ];
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check backend/mcpConfig.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add backend/mcpConfig.js
git commit -m "feat: add MCP server configuration module (filesystem, memory, browser, github, sequential-thinking)"
```

---

### Task 2: Create agentDefs.js

**Files:**

- Create: `backend/agentDefs.js`

- [ ] **Step 1: Create the subagent definitions module**

```javascript
/**
 * 子代理定义
 * 主代理根据 description 自动判断何时分派任务给子代理
 */
export function getAgentDefs() {
  return {
    'code-reviewer': {
      description:
        'Review code for quality, security vulnerabilities, and design patterns. Use when code needs to be reviewed before committing or when analyzing existing code quality.',
      prompt: [
        'You are a senior code reviewer.',
        'Focus on: bugs, security issues, performance problems, code clarity, and design patterns.',
        'Be specific: cite exact file paths and line numbers.',
        'Be concise: prioritize actionable findings over general advice.',
      ].join('\n'),
      tools: ['Read', 'Glob', 'Grep'],
    },

    'test-writer': {
      description:
        'Write comprehensive tests including edge cases and error scenarios. Use when tests need to be created for new or existing code.',
      prompt: [
        'You are a test engineering specialist.',
        'Write tests that cover: happy paths, edge cases, error conditions, and boundary values.',
        'Use the testing framework already present in the project. If none exists, use the simplest option for the language.',
        'Each test should have a clear name describing what it verifies.',
      ].join('\n'),
      tools: ['Read', 'Write', 'Bash', 'Glob'],
    },

    researcher: {
      description:
        'Research topics by browsing the web, reading documentation, and summarizing findings. Use when external information is needed to complete a task.',
      prompt: [
        'You are a technical researcher.',
        'Search the web for documentation, tutorials, API references, and solutions.',
        'Summarize findings concisely with source URLs.',
        'Focus on official documentation and reputable sources.',
      ].join('\n'),
      tools: ['Read', 'Grep', 'mcp__browser__*'],
    },

    architect: {
      description:
        'Analyze complex tasks, design solutions, and break down work into actionable steps. Use when facing a problem that requires structured multi-step reasoning.',
      prompt: [
        'You are a software architect.',
        'Break complex problems into clear, ordered steps.',
        'Consider trade-offs and explain your reasoning.',
        'Produce actionable plans, not abstract advice.',
      ].join('\n'),
      tools: ['Read', 'Glob', 'Grep', 'mcp__sequential-thinking__*'],
    },
  };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check backend/agentDefs.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add backend/agentDefs.js
git commit -m "feat: add 4 specialist subagent definitions (code-reviewer, test-writer, researcher, architect)"
```

---

### Task 3: Create hooks.js

**Files:**

- Create: `backend/hooks.js`

- [ ] **Step 1: Create the hooks module**

```javascript
/**
 * Agent Hooks
 * PreToolUse: 安全拦截危险 Bash 命令
 * PostToolUse: 推送工具事件到 Timeline
 * SubagentStart: 记录子代理分派
 * Stop: 会话结束清理
 */

// 危险命令模式
const BLOCKED_PATTERNS = [
  /rm\s+(-\w*\s+)*-rf\s+[/~]/, // rm -rf / 或 rm -rf ~
  /\|\s*(sh|bash|zsh)\b/, // curl|sh, wget|bash 等管道执行
  /\bsudo\b/, // 任何 sudo 命令
  /\b(>\s*|tee\s+)(\/etc|\/usr|\/System|\/bin|\/sbin)\//, // 写入系统路径
];

function isDangerous(command) {
  return BLOCKED_PATTERNS.some((pattern) => pattern.test(command));
}

/**
 * 构建 hooks 配置
 * @param {import('node:events').EventEmitter} emitter - agentEvents
 * @param {string} sessionId - 当前会话 ID
 */
export function buildHooks(emitter, sessionId) {
  return {
    PreToolUse: [
      {
        matcher: 'Bash',
        hooks: [
          async (input) => {
            try {
              const command = input?.tool_input?.command || '';
              if (isDangerous(command)) {
                const reason = `Blocked dangerous command: ${command.slice(0, 100)}`;
                console.warn(`[hooks] ${reason} (session: ${sessionId})`);
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
            } catch (err) {
              console.error(`[hooks] PreToolUse error: ${err.message}`);
            }
            return {};
          },
        ],
      },
    ],

    PostToolUse: [
      {
        hooks: [
          async (input) => {
            try {
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'tool_complete',
                content: {
                  tool: input?.tool_name || 'unknown',
                  message: `Tool ${input?.tool_name || 'unknown'} completed`,
                },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] PostToolUse error: ${err.message}`);
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
              const agentName = input?.agent_name || 'unknown';
              console.log(`[hooks] Subagent started: ${agentName} (session: ${sessionId})`);
              emitter.emit('event', {
                sessionId,
                type: 'system',
                subtype: 'subagent',
                content: {
                  message: `Delegated to subagent: ${agentName}`,
                  agent: agentName,
                },
                timestamp: Date.now(),
              });
            } catch (err) {
              console.error(`[hooks] SubagentStart error: ${err.message}`);
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
              console.log(`[hooks] Session stopped: ${sessionId}`);
            } catch (err) {
              console.error(`[hooks] Stop error: ${err.message}`);
            }
            return { async: true };
          },
        ],
      },
    ],
  };
}
```

- [ ] **Step 2: Verify syntax**

Run: `node --check backend/hooks.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add backend/hooks.js
git commit -m "feat: add hook callbacks (safety guard, timeline events, subagent tracking)"
```

---

### Task 4: Update config.js

**Files:**

- Modify: `backend/config.js:6-28`

- [ ] **Step 1: Add GitHub token config**

Add after the `minimax` block (line 18):

```javascript
  // GitHub 集成（可选，无 token 时仅支持公开仓库）
  github: {
    token: process.env.GITHUB_TOKEN || '',
  },
```

- [ ] **Step 2: Verify syntax**

Run: `node --check backend/config.js`
Expected: No output (clean parse)

- [ ] **Step 3: Commit**

```bash
git add backend/config.js
git commit -m "feat: add GitHub token config for MCP server"
```

---

### Task 5: Update .env.example

**Files:**

- Modify: `.env.example`

- [ ] **Step 1: Add new env vars**

Append to the file:

```
# GitHub (optional, for github MCP server -- public repos work without it)
GITHUB_TOKEN=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: add GITHUB_TOKEN to .env.example"
```

---

### Task 6: Wire everything into agentManager.js

**Files:**

- Modify: `backend/agentManager.js:1-5` (imports)
- Modify: `backend/agentManager.js:19-97` (startAgent function)

This is the core integration task. All three new modules get imported and assembled into `query()` options.

- [ ] **Step 1: Update imports**

Replace lines 1-5:

```javascript
import { query } from '@anthropic-ai/claude-agent-sdk';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import config from './config.js';
import { createSession, updateSessionStatus, insertEvent } from './sessionStore.js';
import { getMcpServers, getAllowedTools } from './mcpConfig.js';
import { getAgentDefs } from './agentDefs.js';
import { buildHooks } from './hooks.js';
```

- [ ] **Step 2: Update the query() call in startAgent**

Replace the `const stream = query({...})` block (lines 22-44) with:

```javascript
const stream = query({
  prompt,
  options: {
    cwd: WORKSPACE,
    permissionMode: 'bypassPermissions',
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

    // File change tracking for rollback
    enableFileCheckpointing: true,
  },
});
```

- [ ] **Step 3: Verify syntax**

Run: `node --check backend/agentManager.js`
Expected: No output (clean parse)

- [ ] **Step 4: Run lint + format**

Run: `npm run lint && npm run format:check`
Expected: No errors. If format fails, run `npm run format` then re-check.

- [ ] **Step 5: Commit**

```bash
git add backend/agentManager.js
git commit -m "feat: wire MCP servers, subagents, and hooks into agent query options"
```

---

### Task 7: Update package.json version

**Files:**

- Modify: `package.json`

- [ ] **Step 1: Bump version**

Change `"version": "0.2.1"` to `"version": "0.3.0"`.

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: bump version to 0.3.0"
```

---

### Task 8: Update CHANGELOG.md

**Files:**

- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add v0.3.0 entry**

Insert after the `# Changelog` header, before the `## [0.2.1]` entry:

```markdown
## [0.3.0] - 2026-03-31

### Added

- **MCP Servers**: 5 open-source MCP 服务器集成
  - `@modelcontextprotocol/server-filesystem` -- 目录树、文件元数据、高级搜索
  - `@modelcontextprotocol/server-memory` -- 知识图谱式持久记忆
  - `@playwright/mcp` -- 浏览器操作、截图、表单填写
  - `@modelcontextprotocol/server-github` -- Issues、PRs、代码搜索
  - `@modelcontextprotocol/server-sequential-thinking` -- 结构化多步推理

- **Subagents**: 4 个专精子代理
  - `code-reviewer` -- 代码审查（只读权限）
  - `test-writer` -- 测试编写（可写文件、执行命令）
  - `researcher` -- 联网调研（挂载 browser MCP）
  - `architect` -- 架构分析（挂载 sequential-thinking MCP）

- **Hooks**: 4 个生命周期钩子
  - `PreToolUse` (Bash) -- 拦截危险命令（rm -rf /、sudo、curl|sh 等）
  - `PostToolUse` -- 工具事件推送到 Timeline
  - `SubagentStart` -- 子代理分派追踪
  - `Stop` -- 会话结束日志

- **SDK Options**: 启用 `includePartialMessages`（流式 delta）和 `enableFileCheckpointing`（文件回滚）

- **System Prompt**: 升级为 `preset: 'claude_code'` + append 安全约束

### Changed

- **代码组织**: 新增 `mcpConfig.js`、`agentDefs.js`、`hooks.js` 三个模块，职责分离

---
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add v0.3.0 changelog entry"
```

---

### Task 9: Update architecture.md

**Files:**

- Modify: `docs/architecture.md`

- [ ] **Step 1: Update the system architecture diagram**

Replace the existing diagram (lines 7-33) with:

```
+------------------+       +-------------------+       +--------------------+
|                  |  WS   |                   | SDK   |                    |
|   Browser        |<----->|   Node.js Backend |<----->| Claude Agent SDK   |
|   (React SPA)    |       |   (Express + WS)  |       | query() async iter |
|                  |       |   :3001            |       |                    |
+------------------+       +--------+----------+       +---------+----------+
                                    |                            |
                                    | SQLite              +------+------+
                                    v                     |             |
                           +--------+----------+   Anthropic API   MCP Protocol
                           |                   |         |             |
                           |   data/           |         v             v
                           |   agentboard.db   |  +------+---+  +----+----------+
                           |                   |  | proxy.js  |  | MCP Servers   |
                           +-------------------+  | :4000     |  | filesystem    |
                                                  | Anthropic |  | memory        |
                                                  | -> OpenAI |  | browser       |
                                                  +------+----+  | github        |
                                                         |       | seq-thinking  |
                                                         v       +---------------+
                                                  +------+----+
                                                  | Minimax   |
                                                  | API       |
                                                  +-----------+
```

- [ ] **Step 2: Update the Backend module table**

Replace the module table with:

```markdown
| 模块          | 文件              | 职责                                                                 |
| ------------- | ----------------- | -------------------------------------------------------------------- |
| Config        | `config.js`       | 集中配置管理（端口、路径、超时、Minimax 端点、GitHub token）         |
| Session Store | `sessionStore.js` | SQLite CRUD（带错误处理），sessions + events 两表                    |
| Agent Manager | `agentManager.js` | SDK query() 调用，组装 MCP/Subagents/Hooks 配置                      |
| MCP Config    | `mcpConfig.js`    | 5 个 MCP 服务器配置 + allowedTools 白名单                            |
| Agent Defs    | `agentDefs.js`    | 4 个专精子代理定义（code-reviewer/test-writer/researcher/architect） |
| Hooks         | `hooks.js`        | 4 个生命周期钩子（安全拦截/Timeline 推送/子代理追踪/会话清理）       |
| Server        | `server.js`       | HTTP REST API + WebSocket 服务，事件广播，graceful shutdown          |
| Proxy         | `proxy.js`        | Anthropic Messages API -> OpenAI Chat Completions 翻译               |
```

- [ ] **Step 3: Update the security isolation table**

Replace the existing security table with:

```markdown
| 机制                                  | 说明                                                      |
| ------------------------------------- | --------------------------------------------------------- |
| `cwd: WORKSPACE`                      | Agent 工作目录限定                                        |
| `systemPrompt` (preset + append)      | Claude Code 完整系统提示 + 目录约束指令                   |
| `workspace/CLAUDE.md`                 | Agent 行为规则文件                                        |
| `settingSources: []`                  | 不加载用户级 Claude Code 配置（MCP/hooks/settings）       |
| `env: { HOME: process.env.HOME }`     | HOME 指向真实用户目录（SDK 初始化需要），cwd 限定工作目录 |
| `permissionMode: 'bypassPermissions'` | 受控环境下自动批准工具调用                                |
| `PreToolUse` hook (Bash)              | 拦截危险命令（rm -rf /、sudo、curl\|sh 等）               |
| `allowedTools` whitelist              | MCP 工具显式白名单，仅允许已配置服务器的工具              |
| Subagent 最小权限                     | 子代理仅获分配所需工具，不可递归派生                      |
```

- [ ] **Step 4: Add a new "MCP Servers" section after the security table**

```markdown
## MCP 服务器

| 服务器              | npm 包                                             | 传输方式 | 用途                         |
| ------------------- | -------------------------------------------------- | -------- | ---------------------------- |
| filesystem          | `@modelcontextprotocol/server-filesystem`          | stdio    | 目录树、文件元数据、高级搜索 |
| memory              | `@modelcontextprotocol/server-memory`              | stdio    | 知识图谱式持久记忆           |
| browser             | `@playwright/mcp`                                  | stdio    | 浏览器操作、截图、表单填写   |
| github              | `@modelcontextprotocol/server-github`              | stdio    | Issues、PRs、代码搜索        |
| sequential-thinking | `@modelcontextprotocol/server-sequential-thinking` | stdio    | 结构化多步推理               |

所有服务器通过 `npx -y` 按需启动，独立子进程，崩溃不影响主 Agent。
工具命名规则：`mcp__{server_name}__{tool_name}`，通过 `allowedTools` 白名单控制。
```

- [ ] **Step 5: Run format**

Run: `npx prettier --write docs/architecture.md`

- [ ] **Step 6: Commit**

```bash
git add docs/architecture.md
git commit -m "docs: update architecture for MCP servers, subagents, and hooks"
```

---

### Task 10: Smoke test

No files to create or modify. This is manual verification.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: All three services start (proxy :4000, backend :3001, frontend :5173). Watch backend logs for MCP server initialization messages.

- [ ] **Step 2: Open browser and send a basic task**

Open `http://localhost:5173`, type a simple task like "Create a hello world script in Python".
Expected: Agent uses built-in tools (Write, Bash) as before. Timeline shows events. This is a regression check.

- [ ] **Step 3: Test a task that would trigger subagent or MCP**

Type a task like "Search the web for the latest Node.js LTS version and create a summary file".
Expected: Agent should attempt to use browser MCP tools or delegate to researcher subagent.

- [ ] **Step 4: If systemPrompt preset causes issues**

If MiniMax struggles with `preset: 'claude_code'`, revert to the string-based systemPrompt in `agentManager.js`:

```javascript
systemPrompt: [
  `[SECURITY] You are sandboxed to: ${WORKSPACE}`,
  `All file operations MUST stay within this directory.`,
  `NEVER use absolute paths outside ${WORKSPACE}.`,
  `NEVER access parent directories beyond ${WORKSPACE}.`,
].join('\n'),
```

This is the fallback documented in the spec.
