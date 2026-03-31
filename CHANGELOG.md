# Changelog

## [0.7.0] - 2026-03-31

### Added

- **Agent 高级字段**: 每个子代理增加 `disallowedTools`、`maxTurns`、`permissionMode`、`model`、`background`、`initialPrompt`
  - `code-reviewer`: 显式禁止 Bash/Write，限制 15 turns，default 权限
  - `test-writer`: 禁止 `rm`/`sudo` 模式的 Bash，25 turns，acceptEdits 权限
  - `researcher`: 禁止 Write/Bash，20 turns，后台运行 (`background: true`)
  - `architect`: 禁止 Write/Bash，20 turns，`initialPrompt` 先分析 workspace
- **新增 Hook 事件**:
  - `SubagentStop`: 子代理完成时推送事件到 Timeline
  - `PermissionDenied`: 权限拒绝审计日志，Timeline 红色标记
  - `UserPromptSubmit`: 用户输入审计记录（字符数统计）
- **SKILL.md 增强**: 4 个技能添加 `allowed-tools`、`when_to_use`、`model` frontmatter 字段
  - writing-plans, brainstorming, systematic-debugging, verification-before-completion

### Changed

- **AgentTimeline**: 处理 `subagent_stop`、`permission_denied`、`tool_failed` 新事件类型

---

## [0.6.0] - 2026-03-31

### Added

- **子任务追踪**: `useWebSocket` 从 `task_started`/`task_notification` 消息追踪子代理任务状态
- **Token 进度条**: StatusBar 显示 input/output token 比例可视化条
- **活跃子任务指示器**: StatusBar 显示当前运行中的子任务数量（含脉冲动画指示灯）
- **Turns 计数**: StatusBar 显示 agent 执行的 turn 数

### Changed

- **StatusBar**: 接收 `subtasks` prop，展示子任务状态和 token 分布图
- **StatusBar.module.css**: 新增 `tokenBar`、`tokenTrack`、`tokenFillIn`/`tokenFillOut`、`subtask` 样式
- **App.jsx**: 传递 `subtasks` 从 useWebSocket 到 StatusBar

---

## [0.5.0] - 2026-03-31

### Added

- **MCP 健康监测**: 新增 `mcpHealth.js` 模块，实现 MCP 服务器状态机 (connected/degraded/failed)
  - 从 `system/init` 消息初始化 MCP 服务器列表
  - `PostToolUse` / `PostToolUseFailure` hooks 追踪 MCP 工具调用成功/失败率
  - 错误率超过 50% 且 >= 3 次失败时标记为 `failed`，成功调用可从 `degraded` 恢复
- **MCP 健康面板**: Header 组件新增 MCP 状态灯阵列，悬停显示服务器名、状态、调用次数、错误次数
- **REST API**: 新增 `GET /api/mcp/health` 端点，返回所有 MCP 服务器健康数据
- **PostToolUseFailure Hook**: 工具执行失败时记录错误并推送 `tool_failed` 事件到 Timeline
- **前端 MCP 追踪**: `useWebSocket` 实时追踪 MCP 工具调用结果，更新健康状态

### Changed

- **Header.jsx**: 新增 `mcpHealth` prop，显示 MCP 服务器状态灯（绿/黄/红）
- **hooks.js**: PostToolUse 调用 `recordToolCall()`，新增 PostToolUseFailure hook
- **App.jsx**: `mcpHealth` 从 useWebSocket 传递到 Header

---

## [0.4.0] - 2026-03-31

### Added

- **SDKMessage 全类型处理**: 从 ~5 种扩展到覆盖全部 23 种 SDK 消息类型
  - `system/init`: 显示加载的 Model、Tools、MCP Servers、Skills 数量
  - `system/api_retry`: API 重试可视化（attempt/max/delay）
  - `system/status`: 上下文压缩状态
  - `system/compact_boundary`: 压缩完成标记
  - `system/task_started/task_notification`: 子代理任务追踪
  - `tool_progress`: 工具执行进度（elapsed time）
  - `rate_limit_event`: 限流警告
  - `stream_event`: 静默处理（partial messages）
  - `result`: 完整统计信息展示（turns、duration、tokens、cost）
- **Session Stats 持久化**: `sessionStore.js` 新增 `stats` 列，`result` 消息自动提取成本/token/耗时/模型信息
- **StatusBar 增强**: 实时显示 Model、Token 用量、API 成本、运行时长
- **File Checkpointing**: 通过 `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` 环境变量启用（SDK 模式兼容）

### Changed

- **AgentTimeline**: `flattenEvent()` 重写，按消息 subtype 精确路由，减少 fallback JSON 噪音
- **useWebSocket**: 新增 `sessionStats` state，从 init/result 消息提取统计数据
- **App.jsx**: `sessionStats` 传递到 `StatusBar`

---

## [0.3.2] - 2026-03-31

### Fixed

- **[Critical] SDK 启动失败**：`agentManager.js` 添加 `allowDangerouslySkipPermissions: true`，`bypassPermissions` 模式必须搭配此选项否则 SDK 拒绝启动
- **[Critical] Hook 拒绝原因丢失**：`hooks.js` PreToolUse 返回字段从错误的 `reason` 修正为 SDK 要求的 `permissionDecisionReason`
- **Agent 超时/停止重复事件**：重构 `stopAgent()` 和异步事件循环，用 `entry.stopped` 标志统一状态管理，`updateSessionStatus` 和 `done` 事件仅在 `finally` 中发送一次，杜绝重复 done 事件和状态不一致
- **WebSocket 断线重连丢失订阅**：`useWebSocket.js` 引入 `sessionIdRef`/`statusRef` refs，`onopen` 时自动重新发送 `subscribe` 恢复事件流
- **前端事件数组无限增长**：添加 `MAX_EVENTS = 5000` 上限，超限时截断旧事件，防止长时间运行导致内存和渲染性能退化
- **clearSession 未通知后端**：清除会话时发送 `unsubscribe` action，后端同步清理 subscriptions Map
- **stopAgent 引用过时 sessionId**：`useCallback` 改用 `sessionIdRef.current` 替代闭包捕获的 state 值
- **WebSocket 无 unsubscribe 协议**：后端 `server.js` 新增 `unsubscribe` action 处理
- **Proxy SSE 流尾部数据丢失**：`proxy.js` 在 `reader.read()` 循环结束后处理 `sseBuffer` 残留数据，防止最后一个不完整 chunk 被丢弃
- **TerminalView 渲染性能**：`extractTerminalLines` 改用 `useMemo` 缓存，与 AgentTimeline 一致
- **AgentTimeline Invalid Date**：`item.ts` 为 `undefined` 时显示 `--:--:--` 替代 `Invalid Date`
- **WebSocket 生产环境兼容**：`WebSocketServer` 添加 `path: '/ws'` 过滤，反向代理场景下不再接受任意路径连接
- **Express 5 异常泄露**：添加全局错误处理中间件，rejected promise 返回 JSON 错误响应而非默认 HTML 页面
- **stopAgent API 状态码**：session 不存在时返回 404 而非 200，便于客户端区分操作结果
- **环境变量命名误导**：`proxy.js` 优先读取 `MINIMAX_API_KEY`，回退到 `ANTHROPIC_API_KEY`；`.env.example` 更新注释说明

---

## [0.3.1] - 2026-03-31

### Added

- **Skills Plugin**: 8 个开源 SKILL.md 集成为本地插件 (`plugins/agentboard-skills/`)
  - `differential-review` (trailofbits) -- 安全差异审查 + 爆炸半径分析 -> code-reviewer
  - `test-driven-development` (superpowers) -- 严格 red-green-refactor -> test-writer
  - `property-based-testing` (trailofbits) -- 属性测试 -> test-writer
  - `audit-context-building` (trailofbits) -- 系统化调研上下文 -> researcher
  - `writing-plans` (superpowers) -- 细粒度实施计划 -> architect
  - `brainstorming` (superpowers) -- 设计探索 -> architect
  - `systematic-debugging` (superpowers) -- 根因分析 -> 主代理
  - `verification-before-completion` (superpowers) -- 验证铁律 -> 主代理
- **Subagent Skills**: 每个子代理通过 `skills` 字段加载对应领域技能
- **Plugins Config**: `agentManager.js` 通过 `plugins` 选项加载本地插件目录

---

## [0.3.0] - 2026-03-31

### Added

- **MCP Servers**: 5 open-source MCP 服务器集成 (`mcpConfig.js`)
  - `@modelcontextprotocol/server-filesystem` -- 目录树、文件元数据、高级搜索
  - `@modelcontextprotocol/server-memory` -- 知识图谱式持久记忆
  - `@playwright/mcp` -- 浏览器操作、截图、表单填写
  - `@modelcontextprotocol/server-github` -- Issues、PRs、代码搜索
  - `@modelcontextprotocol/server-sequential-thinking` -- 结构化多步推理

- **Subagents**: 4 个专精子代理 (`agentDefs.js`)
  - `code-reviewer` -- 代码审查（只读权限）
  - `test-writer` -- 测试编写（可写文件、执行命令）
  - `researcher` -- 联网调研（挂载 browser MCP）
  - `architect` -- 架构分析（挂载 sequential-thinking MCP）

- **Hooks**: 4 个生命周期钩子 (`hooks.js`)
  - `PreToolUse` (Bash) -- 拦截危险命令（rm -rf /、sudo、curl|sh 等）
  - `PostToolUse` -- 工具事件推送到 Timeline
  - `SubagentStart` -- 子代理分派追踪
  - `Stop` -- 会话结束日志

- **SDK Options**: 启用 `includePartialMessages`（流式 delta）和 `enableFileCheckpointing`（文件回滚）
- **System Prompt**: 升级为 `preset: 'claude_code'` + append 安全约束

### Changed

- **代码组织**: 新增 `mcpConfig.js`、`agentDefs.js`、`hooks.js` 三个模块，职责分离
- **agentManager.js**: 从 6 个 options 扩展到完整配置（MCP/Subagents/Hooks/Streaming/Checkpointing）

---

## [0.2.1] - 2026-03-31

### Fixed

- **WebSocket URL 硬编码端口**：`useWebSocket.js` 不再硬编码 `:3001`，改为使用相对路径 `/ws`，通过 Vite proxy 转发，支持反向代理和 HTTPS 部署
- **done 事件状态错误**：`agentManager.js` 的 `finally` 块现在正确传递实际状态（`completed` / `failed`），而非始终报 `completed`
- **超时定时器未清除**：Agent 正常完成或手动停止时，`setTimeout` 超时保护定时器现在会被正确清除
- **SQLite 操作无错误处理**：`sessionStore.js` 所有数据库操作添加 try/catch，防止数据库异常导致进程崩溃
- **无优雅退出**：`server.js` 添加 `SIGTERM`/`SIGINT` 处理器，退出时依次停止活跃 Agent、关闭 WebSocket 连接、关闭 HTTP 服务器、关闭 SQLite 连接
- **AgentTimeline 渲染性能**：`buildDisplayItems` 使用 `useMemo` 缓存，避免每次渲染重新计算
- **React key 使用 index**：`AgentTimeline` 和 `TerminalView` 改为使用稳定的组合 key（`eventIndex-blockIndex`）
- **Header 版本号过时**：从 `v0.1` 更新为 `v0.2.1`，与 `package.json` 保持一致
- **config.js 注释过时**：将 "LiteLLM" 引用更新为 "Anthropic-to-OpenAI proxy"

---

## [0.2.0] - 2026-03-31

### Changed

- **Agent 引擎**：从 CLI subprocess 迁移到 [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript) (`@anthropic-ai/claude-agent-sdk`)
  - `query()` 编程式调用，替代 `spawn('claude', [...])`
  - 结构化 `SDKMessage` 事件流，不再手动解析 NDJSON
  - `stream.return()` 干净停止，替代进程 kill
  - SDK 作为 npm 依赖安装，无需全局安装 Claude Code CLI
  - `settingSources: []` 完全隔离用户级配置（MCP servers / hooks）
  - `systemPrompt` 直接注入 workspace 安全约束
  - `permissionMode: 'bypassPermissions'` 替代 `--dangerously-skip-permissions`

### Added

- **代码质量工具**
  - Prettier: 单引号、尾逗号、100 字符行宽 (`.prettierrc`)
  - ESLint: recommended 规则、no-unused-vars warning (`eslint.config.js`)
  - `npm run format` / `npm run format:check` / `npm run lint` 脚本

### Removed

- 移除 `child_process` spawn 方式
- 移除 NDJSON 手动解析逻辑

---

## [0.1.0] - 2026-03-31

### Added

- **Backend**: Express + WebSocket 服务 (port 3001)
  - Claude Code CLI subprocess 管理 (agentManager)
  - NDJSON stream-json 输出解析与事件分发
  - SQLite 会话/事件持久化存储 (sessionStore)
  - REST API: sessions 列表、详情、停止、状态查询
  - WebSocket: start/subscribe/stop 指令，实时事件推送
  - Agent 进程超时保护（默认 10 分钟）

- **Anthropic→OpenAI Proxy** (proxy.js, port 4000)
  - Anthropic Messages API → OpenAI Chat Completions 格式翻译
  - 支持流式 (SSE) 和非流式响应
  - 工具调用 (tool_use/tool_result) 双向转换
  - system prompt、thinking、温度等参数映射
  - 替代 LiteLLM，零 Python 依赖

- **Frontend**: Vite + React 19 暗色 Dashboard
  - Header: 连接状态指示、New Session 按钮
  - ChatInput: 任务输入框，Run/Stop 切换
  - AgentTimeline: 扁平化解析嵌套 content blocks
  - TerminalView: 提取 Bash 命令及输出
  - StatusBar: 运行状态、Session ID、事件计数
  - useWebSocket hook: 自动连接、重连、事件分发
  - 设计系统: CSS Variables 暗色主题，自定义滚动条，入场动画

- **安全隔离**
  - workspace/CLAUDE.md 行为约束规则
  - systemPrompt 安全指令注入
  - 最小化环境变量，HOME 指向 workspace

- **项目基础设施**
  - 根 package.json: `npm run dev` 一键启动 proxy + backend + frontend
  - .env.example / .env.local 环境变量管理
  - Node.js `--env-file` 自动加载（无需 dotenv）
  - .gitignore (node_modules, data, workspace, .venv, env files)
  - 设计文档 (docs/)
