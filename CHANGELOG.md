# Changelog

## [0.2.0] - 2026-03-31

### Changed

- **Agent 引擎**：从 CLI subprocess 迁移到 Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
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
