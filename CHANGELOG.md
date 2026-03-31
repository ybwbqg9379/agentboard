# Changelog

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
