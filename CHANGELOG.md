# Changelog

## Unreleased

### Fixed

- **[Critical] CORS + WebSocket 跨源防护**: HTTP CORS 继续使用 localhost allowlist；WebSocket 单独改为 `isAllowedWebSocketOrigin()`，必须带显式浏览器 `Origin` 且命中 localhost 白名单，修复了未设置 `AGENTBOARD_API_KEY` 时 raw WS 客户端通过缺失 `Origin` 头绕过鉴权的问题；启动时无 key 打印更准确的安全警告
- **[Critical] 沙箱白名单路径围栏**: `env.HOME` 指向 WORKSPACE，`PATH` 限制为 `/usr/local/bin:/usr/bin:/bin`；hooks 从纯黑名单升级为双层防护 -- 保留危险命令黑名单，同时新增绝对路径提取与白名单围栏，命令里所有绝对路径都会检查是否位于 workspace 内，仅放行 `/usr/local/bin`、`/usr/bin`、`/bin`、`/dev`、`/tmp`，从而拦截 `sed`/`awk`/`perl` 等通过绝对路径读取宿主机文件的绕过方式
- **[Major] 条件分支跳过 join 汇合节点**: `markDescendantsSkipped` 递归标记后代时需排除触发 skip 的条件节点自身的出边（`skipSourceId` 参数），否则条件节点已 executed 的入边永远阻止目标被 skip，导致两条分支都执行；`allIncomingSatisfied` 改为 resolved 语义（executed 或 skipped 均算已处理），但至少需要一条 executed 入边
- **[Major] WorkflowEditor 首次 Run 空操作**: `saveWorkflow()` 返回 id，`runWorkflow` 直接用返回值而非闭包旧值
- **[Major] 节点 ID 冲突**: `loadWorkflow` 解析已有节点 ID 的最大数字并同步 `nextId` 计数器
- **[Major] 前端 REST 硬编码 :3001**: 三处 `API_BASE` 改为相对路径 `''` 走 Vite proxy
- **[Major] Workflow 事件广播串台 + 订阅竞态**: 改回按 `runId` 精确订阅，后端 workflow 广播只投递给订阅对应 `runId` 的连接，避免同一 workflow 的并发运行或多页面互相串台；前端在执行前先生成 `runId`、通过 WebSocket 订阅并等待 `workflow_subscribed` ack，再调用 `/run` 启动执行，彻底消除首次运行时短流程事件先于订阅到达的竞态
- **[Major] abortWorkflow 不取消运行中 agent**: `activeRuns` 追踪当前 agent sessionId，abort 时调用 `stopAgent()` 触发 done 事件，由 `runAgentNode` 的 listener 自然 resolve/reject 并 cleanup（不再手动 off listener 避免 promise 悬挂）
- **[Major] WorkflowEditor 节点坐标越界崩溃**: 修复因底层数据库混入测试脏数据（缺失 `position` 坐标字段）导致的渲染报错，利用防御性容错逻辑赋予默认坐标（x:0, y:0），避免 React 组件由于 undefined 异常而导致的白屏（White Screen of Death）崩溃

### Added

- **全面移动端支持 (Comprehensive Mobile Responsiveness)**: 实现纯 CSS 驱动的响应式布局，完美适配小屏设备 (`< 768px`)
  - 主布局从 `1fr 1fr` 硬分栏改为垂直连贯堆叠，允许自然手势滚动 Terminal。
  - Header 导航精简非绝对必要字样；ChatInput 采用 `flex-wrap` 让文本输入框跨屏占满 100% 宽度。
  - Workflow Editor 的配置面板在手机端自适应折叠为底部抽屉 (Bottom Sheet) 以防止阻挡画布拓扑，SessionDrawer 自动扩容至 `100vw`。

- **对话连续性 (Conversation Continuity)**: 支持对已完成/停止/失败的 session 发送后续消息
  - 后端: 利用 Claude Agent SDK 的 `resume` 机制恢复对话上下文，新增 `continueAgent()` 函数和 `follow_up` WebSocket action
  - 前端: ChatInput 在 session 结束后保持可用，显示 "Continue" 按钮（绿色），placeholder 切换为 "Send a follow-up message..."
  - 重构 agentManager: 提取 `buildBaseOptions()` 和 `consumeStream()` 消除代码重复，传递 `sessionId` 给 SDK 确保 resume 可追踪
- **多 Agent 工作流引擎 (Multi-Agent Workflow Engine)**: DAG 编排系统，支持串行/并行/条件分支执行
  - 后端: `workflowEngine.js` -- DAG 拓扑排序、条件评估（==, !=, >, <, contains）、模板变量替换（`{{key}}`）、节点间上下文传递
  - 五种节点类型: `input`（入口）、`output`（出口）、`agent`（调用 Claude Agent）、`condition`（条件分支）、`transform`（数据变换）
  - `workflowStore.js` -- 独立 SQLite DB 存储工作流定义和运行历史
  - 完整 REST API: CRUD (`/api/workflows`)、执行 (`POST /run`)、中止 (`POST /abort`)、历史查询 (`/runs`)
  - 实时 WebSocket 事件广播: `node_start`、`node_complete`、`run_start`、`run_complete`、`agent_started`
- **可视化工作流编辑器 (Workflow Editor UI)**: SVG Canvas 拖拽式 DAG 编辑器
  - Agent/Workflow 双模式切换（Header tab），Workflow 模式全屏编辑
  - 节点拖拽移动、端口连线（右侧输出端 -> 左侧输入端）、贝塞尔曲线边
  - 节点配置面板: Agent 节点（prompt/maxTurns/permissionMode）、Condition 节点（表达式）、Transform 节点（JSON mapping）
  - 工作流列表浏览、一键创建/保存/运行、执行状态实时高亮
  - 运行时节点激活指示器（脉冲动画）和边高亮
- **测试覆盖扩展**: 443 个测试（原 391），新增 workflowEngine 验证/排序/条件评估 30 tests + workflowStore CRUD 13 tests + middleware follow_up/workflowSchema 19 tests

### Changed

- **UI Design Tokens 统一化与主题覆盖**: 彻底剥离全站零星的前端硬编码色值（`#hex` 与 `rgba(xx,x,x)`）
  - 通过 `index.css` 抽离中央控制的语义化 Token 模型 (`--bg-primary`, `--status-running-rgb` 等)。
  - 原生系统完全适配 **Light Mode (暗色) / Dark Mode (浅色)** 双模式无缝切换，且自动侦测 `prefers-color-scheme` 与 `localStorage` 持久化记忆。
  - 移除了项目历史中老旧的 `<select>` 原生控件，自研 `Dropdown.jsx` 使得包含配置表单在内的交互 UI 全部贴合全局赛博设计语言。
  - 全局补齐 `*:focus-visible` 焦点光圈，且去除移动端繁杂丑陋的自绘滚动条轨道。
- `agentManager.js` 重构: 系统提示提取为常量 `SYSTEM_PROMPT_APPEND`，核心逻辑拆分为 `buildBaseOptions()` + `consumeStream()` + `startAgent()` + `continueAgent()`
- `middleware.js` 新增 `follow_up` WebSocket schema 和 `workflowSchema` Zod 验证
- Header 组件新增 Agent/Workflow 模式切换 tab 和全局主题一键切换 Sun/Moon 按钮
- ChatInput 支持三态按钮: Run（新 session）/ Continue（续接 session）/ Stop（运行中）

---

- **完整测试套件**: Vitest 框架，373 个测试用例覆盖前后端关键逻辑
  - 后端 6 个测试文件（218 tests）: proxy 转换、isDangerous 安全检测、auth + Zod 验证、SQLite CRUD 集成、MCP 状态机、REST API 路由集成
  - 前端 4 个测试文件（155 tests）: flattenEvent 事件展平、Terminal 命令提取、文件变更聚合、useWebSocket hook 状态机
- **测试 CI 门禁**: pre-commit hook 和 GitHub Actions 均加入测试步骤，测试不过不能 commit/merge
- **Terminal 面板扩展**: 从仅显示 Bash 命令扩展为显示 WebSearch (`?`)、WebFetch (`>`)、Playwright 浏览器操作 (`>`) 等 6 种工具活动

### Fixed

- **Playwright 弹出浏览器窗口**: MCP 配置缺少 `--headless` 参数，浏览器以 headed 模式运行
- **Agent 无限运行**: 研究类任务无效率约束导致 agent 不断搜索不停止，system prompt 新增 `[EFFICIENCY]` 指令（2-3 来源收集、禁止重复搜索、30 次工具调用软上限）
- **Express 5 req.query 只读**: `validateQuery` 中 `req.query = result.data` 在 Express 5 下抛异常，改用 `Object.defineProperty` 覆盖

### Changed

- 关键纯函数添加 `export` 以支持单元测试（proxy 转换函数、isDangerous、flattenEvent、extractTerminalLines、extractFileChanges）
- `server.js` 导出 `app` 和 `server` 供 supertest 集成测试使用

---

- **Pre-commit Hook**: husky pre-commit 门禁 -- 检查 CHANGELOG 已更新、Prettier 格式、ESLint 零警告、Build 通过
- **GitHub Actions CI**: `.github/workflows/ci.yml` -- push/PR 到 main 自动运行 format + lint + build
- **`npm run check`**: 一键运行全部检查（format:check + lint:strict + build）
- **`npm run lint:strict`**: ESLint `--max-warnings 0` 严格模式
- **Markdown 渲染**: Timeline 的 Assistant/Result/Tool Result 事件支持 Markdown 渲染（react-markdown + remark-gfm）
- **Markdown 样式**: 全局 `.markdown-body` 暗色主题适配
- **Web 访问引导**: System prompt 三级策略 -- WebSearch 快速查询、WebFetch 常规抓取、Playwright MCP 兜底（403 立即切换，不重试）

### Fixed

- **[严重] SQLite 启动崩溃**: `sessionStore.js` 的 `CREATE TABLE sessions` DDL 缺少 `stats TEXT` 列
- **Token 计数为 0**: proxy.js 流式 usage 数据因时序问题被丢弃，改为延迟发送 finish 事件确保 usage 正确传递
- **Terminal 显示非 Bash 工具结果**: 改为追踪 Bash tool_use ID 仅显示对应结果
- **Timeline 重复 Assistant/Result**: result 事件现在只保留 Stats 行
- **模型名显示为 Sonnet**: agentManager 中 model 覆盖移到事件构建之前，确保 insertEvent 和 emit 都携带正确模型名

### Changed

- **LLM 配置泛化**: 从 MiniMax 专用配置改为通用 OpenAI Compatible 配置 (`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`)
- `.env.example` 重写，列出常见 OpenAI 兼容服务商示例（OpenAI、DeepSeek、Moonshot、Together、Groq、Ollama、vLLM、LM Studio）
- `config.js` 中 `minimax` 改为 `llm`，`litellm` 改为 `proxy`，全部从环境变量读取
- `proxy.js` 不再直接读 `MINIMAX_API_KEY`，统一使用 `config.llm.*`

---

## [0.11.0] - 2026-03-31

### Added

- **右侧 Tab 面板**: Terminal / Context / Files 三个标签页替代单一 Terminal 视图
- **Context 可视化**: 展示 input/output/cache token 占比分布条、数值、百分比和费用
- **文件变更面板**: 自动从事件流提取 Read/Write/Edit 工具调用，分 Modified 和 Read Only 两组展示，包含操作计数 (W/E/R)
- **RightPanel 组件**: 统一管理右侧面板的 tab 切换和内容路由

### Changed

- TerminalView 从独立 panel 改为嵌入式组件，由 RightPanel 包裹
- App.jsx 右侧面板从单一 TerminalView 升级为 RightPanel（含三个标签页）

---

## [0.10.0] - 2026-03-31

### Added

- **zod 输入校验**: REST API 和 WebSocket 消息均通过 zod schema 校验，拒绝畸形输入并返回结构化错误详情
- **API Key 认证**: 设置 `AGENTBOARD_API_KEY` 环境变量即启用 Bearer token 认证（REST）和 query param 认证（WebSocket）；未设置时保持开放访问
- **构建时版本注入**: Vite `define` 注入 `__APP_VERSION__` 从 `package.json` 读取，Header 不再硬编码版本号

### Changed

- **flattenEvent 重构**: 从 150+ 行 if/return 链重构为三层 dispatch map (`SYSTEM_HANDLERS`、`TYPE_HANDLERS`、`BLOCK_HANDLERS`)，可维护性大幅提升
- **WebSocket 消息校验**: 使用 `z.discriminatedUnion('action', ...)` 按 action 字段分别校验
- REST 路由增加 `validate()` 和 `validateQuery()` 中间件

---

## [0.9.0] - 2026-03-31

### Added

- **MCP 5 态状态机**: 从 3 态 (connected/degraded/failed) 升级为 5 态，新增 `pending`（重连中）和 `needs_auth`（认证失败）；配合指数退避重连参数 (1s -> 30s, 最多 5 次)
- **新增 Hook 事件**: PreCompact（上下文压缩前）、PostCompact（压缩后）、SessionStart（会话初始化）、SessionEnd（会话结束）
- **Agent 定义增强**: 每个子代理新增 `effort`（思考深度: high/medium）和 `color`（UI 标识色）字段
- **MCP 认证错误检测**: tool call 错误中包含 auth/401/403 关键词时自动转为 `needs_auth` 状态
- **Timeline 新事件渲染**: 前端 AgentTimeline 支持渲染 pre_compact、post_compact、session_start、session_end 事件

### Changed

- Header MCP 健康指示器支持 5 种颜色对应 5 种状态
- mcpHealth 条目新增 `reconnectAttempt`、`maxReconnectAttempts`、`nextBackoffMs` 字段

---

## [0.8.0] - 2026-03-31

### Added

- **Session 历史抽屉**: 右侧滑入面板，展示历史会话列表（状态、prompt 预览、统计），点击可加载/回放
- **Session 管理 API**: `GET /api/sessions` 支持分页 (limit/offset)，`GET /api/sessions/:id` 含事件计数，`GET /api/config/permissions` 暴露可用权限模式
- **权限模式选择**: ChatInput 新增下拉框选择权限模式（Bypass/Accept Edits/Default/Plan）
- **Stream Control API**: `POST /api/sessions/:id/control` 分发运行时控制指令（get_context_usage、set_model、rewind_files、mcp_status）
- **崩溃恢复**: 启动时将上次崩溃遗留的 "running" 会话标记为 "interrupted"
- **加载历史会话**: `useWebSocket.loadSession(id)` 从 SQLite 恢复事件、统计和状态到前端

### Changed

- `startAgent()` 接受 `opts.permissionMode` 和 `opts.maxTurns` 参数
- Sessions API 返回 `{ sessions, total, limit, offset }` 而非扁平数组
- `agentManager.js` 暴露 `getAgentStream()` 和 `PERMISSION_MODES` 常量

---

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
