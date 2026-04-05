# Changelog

## [0.16.2] - 2026-04-04

### chore: 文档测试计数、i18n 边界门禁、E2E 与 document title / RTL

#### Added

- **Playwright 冒烟**：根目录 `e2e/smoke.spec.js` + `playwright.config.js`；`npm run test:e2e`（先 `build` 再测）；`npm run check`、Husky **`pre-commit`** 与 **GitHub Actions** 在构建后执行 `playwright test`（CI 中 `npx playwright install chromium --only-shell`）。
- **Playwright `globalSetup`**：`e2e/global-setup.mjs` 在缺少 **`frontend/dist/index.html`** 时**先于** `vite preview` **报错退出**，提示先执行 **`npm run build`** 或 **`npm run test:e2e`**，避免裸跑 **`npx playwright test`** 时错误信息不明确。
- **CI**：在 Lint 之后增加 **`npm run i18n:check`**，与本地 `check` 对齐。
- **文案**：`common.appTitle`（en / zh-CN）；`i18n.js` 在初始化与 `languageChanged` 时设置 **`document.title`**，并据语言码设置 **`document.documentElement.dir`**（`ar` / `he` / `fa` / `ur` 为 `rtl`，其余 `ltr`）。

#### Fixed

- **`StatusBar`**：`subtaskEntries.filter` 回调参数由 **`t`** 改为 **`sub`**，避免遮蔽 **`useTranslation()`** 的翻译函数 **`t`**（与 `MetricChart` 刻度变量遮蔽同类）。

#### Changed

- **`.gitignore`**：忽略 Playwright **`test-results/`**、**`playwright-report/`**、**`blob-report/`**、**`playwright/.cache/`**；Vite **`.vite/`**、Vitest **`.vitest/`**；**`.eslintcache`**、**`*.tsbuildinfo`**；构建备份 **`dist.bak/`**；常见 **`*.log`** / 包管理器 debug 日志；**`Thumbs.db`**、**`.idea/`**。
- **文档**：`README` / `CONTRIBUTING` / `ONBOARDING` 中 Vitest 全仓计数与前后端分项更新为 **852**（633 + 219）；`README` / `CONTRIBUTING` 中 `npm run check` 与 Husky 说明补充 **i18n** 与 **Playwright**。
- **`scripts/check-i18n.mjs`**：禁止**裸变量** **`t(foo)`**（**允许** **`t(row.labelKey)`** 等属性访问）与 **`t(...+...)`** 拼接 key（单行；行末 `// i18n-exempt` 可豁免）；间接 key 扩展为 **`labelKey` / `titleKey` / `descriptionKey` / `messageKey`**。
- **`frontend/DESIGN.md`**：记载 `document.title`、`dir`、i18n 禁止模式与 ICU 说明。

#### Tests

- 与 **GitHub Actions CI** 及 Husky **`pre-commit`** 对齐：`prettier --check`、`eslint --max-warnings 0`、`i18n:check`、**`npm test`**、**`npm run build`**、**`playwright test`**（`CI=true` 下不复用本地 preview 进程）均已验证通过。

---

## [0.16.1] - 2026-04-04

### feat(frontend): 多语言落地、双轴主题与文档同步

#### Added

- **i18n**：`react-i18next` + `src/locales/en.json` / `zh-CN.json`；顶栏语言切换；`localStorage` 键 `agentboard-locale`；`document.documentElement.lang` 随语言更新。
- **双轴主题**：明暗 `data-theme` 与可选 `data-theme-pack`（如 Linear 风格包），与 `DESIGN.md` 约定一致。
- **`ConfirmDialog`**：未传入 `title` / `message` / 按钮文案时默认走 i18n（`confirmDialog.*`），避免英文硬编码遗留。
- **`Dropdown`**：`variant="compact"` 与无障碍属性，供顶栏复用；`Header` 语言 / UI 调色板由原生 `<select>` 改为与 `WorkflowEditor` 一致的自定义下拉样式。
- **i18n 门禁脚本 `scripts/check-i18n.mjs`**（`npm run i18n:check`）：在原有 **en ↔ zh-CN** 键对齐与 `{{var}}` 一致性之外，增加 **源码侧校验**（`t('…')` / `i18n.t('…')`、``t(`prefix.${…}`)`` 动态前缀、`labelKey: '…'` 间接引用）、**i18next 复数键**解析、以及 **en.json 未使用 key** 扫描（可用环境变量 `I18N_SKIP_UNUSED=1` 跳过未使用扫描）；已接入 **`npm run check`** 与 Husky **`pre-commit`**。

#### Fixed

- **i18n 插值**：工作流 Agent 提示词占位拆为 `promptPlaceholderPrefix` / `Suffix` + 字面量 `{{key}}`；输出摘要占位使用字面量 `{{result}}`，避免被 i18next 清空。
- **终端**：`browser_click` 无目标时使用 `terminal.browserClickBare`；`TerminalView` 测试改用 `getFixedT('en')`；Vitest 下 `i18n` 默认语言固定为 `en`，避免 `AgentTimeline` 等与浏览器语言相关的断言漂移。
- **其它**：移除未使用的 `EDGE_CONDITION_OPTIONS`；`workflowName` 初始值走 `workflow.defaultName`；`MetricChart` 刻度变量重命名避免遮蔽翻译函数 `t`。
- **`StatusBar`**：状态文案改为 ``t(`statusBar.${status}`)``，与 i18n 动态前缀门禁一致。
- **字典清理**：移除未再引用的 `common.trial`、`header.uiPaletteAria`（en / zh-CN 同步）。

#### Changed

- **`frontend/DESIGN.md`**：更新 i18n 覆盖说明，并记载 **`npm run i18n:check`** 与 `I18N_SKIP_UNUSED` 约定。
- **`eslint.config.js`**：为浏览器全局补充 `navigator`，使 `i18n.js` 在 `eslint --max-warnings 0` 下通过。
- **项目版本**：根目录、`backend`、`frontend` 的 `package.json` 与对应 `package-lock.json` 同步为 **0.16.1**；Vite 注入的 **`__APP_VERSION__`** 仍读取根 `package.json`，Header 展示与之一致。
- **格式**：对上述前端组件与 `DESIGN.md` 执行 Prettier，与 Husky `pre-commit` 对齐。

#### Tests

- 全量 `npm test`（后端 + 前端 Vitest）与 `npm run build` 通过；质量门禁同 `npm run check` / Husky `pre-commit`（含 **`node scripts/check-i18n.mjs`**，当前约 **276** 条叶子键对齐、**251** 处静态 key 引用、**5** 个动态前缀校验、未使用 key 扫描通过）。

---

## [0.16.0] - 2026-04-03

### feat: 引入本地独立 Worker 体系与前端可视化闭环 (0 漏洞版本)

#### Added

- **本地独立 Worker 系统 (Local-First)**：
  - **`VisualizerTool`**：引入本地 Mermaid 渲染引擎，支持 Agent 生成拓扑图、时序图等可视化资产。
  - **`DataAnalystTool`**：集成 `AlaSQL`，赋予 Agent 极速分析本地 CSV/JSON 数据的能力，支持跨表 Join 与聚合计算。
  - **`OCRTool`**：集成 `Tesseract.js`，支持本地图像文字识别，打破调研中的图片数据盲区。
  - **`ReportTool`**：集成 `pdf-lib`，支持将调研成果自动化导出为带分页、标题格式化的专业 PDF 报告；优先自动嵌入系统 Unicode 字体，缺失时回退 StandardFonts 并附带显式警告。
- **前端 UX 与交互增强**：
  - **Mermaid 实时预览**：在 `MarkdownBody` 中集成 `mermaid.js` (10.9.5 稳定版)，自动渲染代码块为 SVG 图形。
  - **数据表格化展示**：`AgentTimeline` 自动检测工具输出的 JSON 数组并渲染为响应式 HTML 表格。
  - **一键下载报告**：前端新增 `DownloadButton` 组件，配合后端新增的文件下载 API，实现调研报告的一键导出。
- **安全性修复**：
  - 修复了 `mermaid` 11.x 引入的 `lodash` 高危漏洞，通过降级至 10.9.5 实现 **全仓 0 漏洞**。
  - `MarkdownBody` 的 Mermaid 渲染从 `innerHTML` 改为 `textContent`，阻断代码块中夹带 HTML 的 XSS 注入面。
  - 后端新增 `/api/sessions/:id/files/:fileName` 安全路由，并按 `config.workspaceDir/{userId}/sessions/:id` 对齐真实租户目录。

#### Changed

- **`ARCHITECTURE.md`**：同步更新 0.16.0 增强模块的职责描述。
- **构建拆包**：取消将 Mermaid 生态强制合并为单一 `visualizer` chunk，改为保留按需拆分，消除 3MB 级构建警告。
- **项目版本**：根目录与后端同步晋升至 **0.16.0**。

#### Tests

- 新增 `DataAnalystTool.test.js` (多格式关联查询)、`VisualizerTool.test.js`、`OCRTool.test.js`、`ReportTool.test.js`（分页、Unicode 字体与回退逻辑）、`MarkdownBody.test.jsx`（Mermaid XSS 回归）、`server.test.js` 下载成功路径断言。
- 全量通过 `npm run check` 质量门禁（Prettier + ESLint --max-warnings 0 + Build）。

---

## [0.15.10] - 2026-04-03

### refactor(frontend): 抽取 `wsConnection` 统一 WS 心跳与重连间隔

#### Changed

- **`lib/wsConnection.js`**：导出 `WS_RECONNECT_MS`、`WS_HEARTBEAT_INTERVAL_MS`、`WS_PONG_TIMEOUT_MS`，以及 `touchWsLastActivity`、`startWsHeartbeat`、`scheduleWsReconnect`。
- **`useWebSocket.js`**：主 Agent/实验连接改用上述工具函数；超时关闭前仍输出 **`[ws] pong timeout`**（`logLabel: 'ws'`）。
- **`WorkflowEditor.jsx`**：工作流专用 `/ws` 共用同一套心跳与重连常量，**不传 `logLabel`**（保持静默 `close`，与原先一致）。

#### Tests

- **`lib/wsConnection.test.js`**：新增 5 个用例（Vitest fake timers）；全仓 **615 + 217 = 832**。

#### Docs

- 根版本 **0.15.10**；`ARCHITECTURE.md` 前端表补充 `wsConnection`；`README` / `CONTRIBUTING` / `ONBOARDING` 测试计数与 **832** 对齐。

---

## [0.15.9] - 2026-04-03

### refactor(backend): HTTP 按域拆分 + WebSocket 独立注册（行为不变）

#### Changed

- **`http/createApp.js`**：组装 Express 全局中间件与 `/api` 路由挂载；保留统一错误处理与 `requestId`。
- **`http/routes/`**：`sessions`、`meta`（status / mcp / permissions）、`workflows`、`experiments`（含 Swarm 相关 REST）分文件承载原 `server.js` 路由表。
- **`http/helpers/access.js`**：`hasOwnedSession` / `hasOwnedWorkflowRun` 供 REST 与 WS 共用。
- **`websocket/registerAgentBoardWs.js`**：`/ws` 协议、订阅表与 agent / workflow / experiment / swarm 事件桥；末尾仍调用 **`initSwarmBus(agentEvents)`**。
- **`server.js`**：进程入口（`createApp`、`listen`、恢复、优雅退出）；**仍导出 `{ app, server }`** 供集成测试。
- **`ARCHITECTURE.md`**：API 与鉴权模块表与上述分层对齐。

#### Fixed

- **Session control `mcp_status`**：`getMcpHealth` 从 **`mcpHealth.js`** 导入（拆分时勿从 `agentManager` 引入）。

#### Tests

- 测试规模不变：**615 + 212 = 827**；`server*.test.js` 仍导入 `server.js` 单例。

#### Docs

- 根版本 **0.15.9**；`README` / `CONTRIBUTING` / `ONBOARDING` 测试计数仍为 **827**。

---

## [0.15.8] - 2026-04-02

### chore: ExperimentView catch 清理 + 批量删 session 部分失败补 interrupted + JSDoc

#### Changed

- **`ExperimentView.jsx`**：`apiFetch` 已统一包装中止类错误，移除对裸 `AbortError`/`TimeoutError` 的重复判断（Observation A）。
- **`POST /api/sessions/batch-delete`**：当 `deleteSessionsBatch` 删除行数 **小于** 已归属 id 数时，二次 `filterSessionIdsOwned` 得到仍存在的 id，对其 **`updateSessionStatus(..., 'interrupted')`**（Observation B）。
- **`filterSessionIdsOwned`**：JSDoc 注明 **返回顺序与入参 `ids` 不一定一致**（Observation C）。

#### Tests

- `server.test.js`：批量删除 mock 返回 0 行时期望 `updateSessionStatus` 与两次 `filterSessionIdsOwned`。

#### Docs

- 根版本 **0.15.8**；`README` / `CONTRIBUTING` / `ONBOARDING` 测试计数 **615 + 212 = 827**。

---

## [0.15.7] - 2026-04-02

### fix: Session 删除一致性、批量删除省 RTT、apiFetch 可区分超时、env/requestId/ErrorBoundary

#### Fixed / improved

- **DELETE /api/sessions/:id**：若 `stopAgent` 后 `deleteSession` 失败，将会话标记为 **`interrupted`** 并返回 500 + `hint`，便于重试 DELETE 而非停留在「进程已停、行仍在」的隐式状态。
- **POST /api/sessions/batch-delete**：使用 `filterSessionIdsOwned` + `deleteSessionsBatch` **两次 DB 往返**（原名下每个 id 两次查询的 N+1），仍对每个拥有 id 调用 `stopAgent`。
- **apiFetch**：超时/用户取消抛出 **`ApiFetchError`**（`isTimeout` / `isUserAbort`）；`AbortSignal.any` 不可用时 **`console.warn`**；`ExperimentView` 静默路径识别该类错误。
- **env**：`assertValidEnv` 改为抛出 **`EnvValidationError`**；`config.js` 在非 Vitest 下 `console.error` 后 `process.exit(1)`，**Vitest**（`VITEST=true`）下重新抛出以便测试捕获。
- **requestId**：入站 id 须 **至少含一个字母或数字**（拒绝纯 `----------` 等）。
- **ErrorBoundary**：新增 **`componentDidCatch`** → `console.error`。

#### Tests

- `sessionStore`：`filterSessionIdsOwned` / `deleteSessionsBatch`；`env`：`assertValidEnv` 抛错；`middleware`：纯连字符 request id；`apiFetch`：超时与用户中止包装；`server.test`：删除失败时期望 `updateSessionStatus`、批量删除走 `deleteSessionsBatch`。

#### Docs

- 根版本 **0.15.7**；`README` / `CONTRIBUTING` / `ONBOARDING` 测试计数 **614 + 212 = 826**。

---

## [0.15.6] - 2026-04-02

### chore: 工程健壮性增量 + 文档 + 全站 REST 统一 apiFetch

#### Added

- **`backend/env.js`**：`PORT`、`AGENT_TIMEOUT` 启动时 Zod 校验（由 `config.js` 触发）；`getEnvValidationError` / `isProduction` 供测试与路由使用。
- **`requestIdMiddleware`**：`X-Request-Id` 与 `req.requestId`；Express **`express.json({ limit: '2mb' })`**。
- **全局错误处理**：`NODE_ENV=production` 时对客户端掩码未捕获异常详情，响应包含 **`requestId`**（若存在）。
- **前端**：`apiFetch.js`（鉴权 + 默认超时）、根级 **`ErrorBoundary`**；**`ExperimentView` / `WorkflowEditor` / `SessionDrawer` / `useWebSocket`** 的 REST 全部经 `apiFetch`（行为与原先 `fetch` + `withClientAuth` 对齐）。
- **ESLint**：全局 `AbortSignal`（配合 `apiFetch`）。

#### Tests

- `env.test.js`、`middleware`（requestId）、`apiFetch.test.js`。

#### Docs

- `ARCHITECTURE.md` 补充环境与 HTTP 约定；`README.md`、`CONTRIBUTING.md`、`ONBOARDING.md` 测试规模与 **608 + 210 = 818** 对齐；根版本 **0.15.6**。

---

## [0.15.5] - 2026-04-02

### fix: 活跃任务枚举租户隔离 + 会话删除失败 HTTP 语义

#### Fixed

- **`getActiveExperiments` / `getActiveWorkflowRuns`**：当 `userId` 为 `null`、`undefined` 或空字符串时改为返回 **空列表**，不再退化为「返回全局全部活跃 id」（多租户场景下的信息枚举风险；HTTP 层历来会传入 `default` 或合法 id，但内部误调过去会踩坑）。
- **`DELETE /api/sessions/:id`**：在已通过归属校验且已 `stopAgent` 之后，若 `deleteSession` 仍为 `false`（持久化失败），响应改为 **500** + `delete failed`，避免 **200 + deleted: false** 误导客户端。

#### Tests

- `experimentEngine.test.js`：活跃实验运行中时，`getActiveExperiments(undefined|null|"")` 必须为空；`default` 用户仅列出己方 `runId`，`other-tenant` 为空。
- `workflowEngine.test.js`：契约测试 `getActiveWorkflowRuns` 对缺省 `userId` 返回空列表。
- `server.test.js`：持久化删除失败时期望 **500**。

#### Chore

- **`backend/vitest.config.js`**：`fileParallelism: false`，避免多个 `server*.test.js` 并行时共用已缓存的 `server.js` / mock 组合导致偶发失败。

#### Docs

- 根 `package.json` 版本 **0.15.5**；`README.md`、`CONTRIBUTING.md`、`ONBOARDING.md` 测试计数与 **600 + 207 = 807** 对齐；`ARCHITECTURE.md` 补充后端 Vitest **按文件串行**（`fileParallelism: false`）原因说明。

---

## [0.15.4] - 2026-04-02

### dev: Vitest V8 覆盖率依赖与脚本

#### Added

- **`@vitest/coverage-v8` (^4.1.2)**：分别加入 `backend/` 与 `frontend/` 的 `devDependencies`，与现有 Vitest 主版本对齐。
- **根目录脚本**：`npm run test:coverage`、`test:coverage:backend`、`test:coverage:frontend`；子包内 `npm run test:coverage`（`vitest run --coverage`）。
- **Vitest `coverage` 配置**（v8 provider）：`text` + `json-summary` + `html` 报告；后端/前端各自输出到 `coverage/`（已加入 `.gitignore`）。
- **`eslint.config.js`**：忽略 `**/coverage/`，避免本地生成 HTML 报告后 `eslint backend/` 误扫产物。

#### Docs

- `README.md`、`CONTRIBUTING.md`、`ONBOARDING.md`、`ARCHITECTURE.md` 补充覆盖率运行方式与报告位置说明；根 `package.json` 版本 **0.15.4**。

---

## [0.15.3] - 2026-04-02

### test: 核心模块与 Server 路由测试扩容 + LSPTool MCP 契约修复

#### Fixed

- **`backend/tools/LSPTool.js`** — 实现 `success()` / `error()` / `call()`，与 Native MCP `tool.call` 及统一 `{ content, isError }` 返回格式一致（此前仅存在 `execute()` 且调用未定义方法会导致运行期失败）。

#### Tests (backend)

新增或显著扩充的专项文件：

- `agentManager.test.js` — `selectBuiltinTools`、起停与续跑、AbortSignal 可中止的挂起流、`pin_context` 等。
- `agentDefs.test.js` — 子代理定义结构与工具集约束。
- `config.test.js` — 环境与默认值。
- `tools/REPLTool.test.js`、`tools/dockerSandbox.test.js`、`tools/RememberTool.test.js` — 沙箱与记忆工具。
- `tools/LSPTool.test.js` — 基于临时目录的语义查询。
- `nativeMcpServer.test.js` — MCP `ListTools` / `CallTool` 分发。
- `server.workflow.test.js`、`server.templates.test.js`、`server.swarm.test.js`、`server.experiments-list.test.js` — 工作流、实验模板、Swarm、实验列表等 REST。
- `server.test.js` — 补 `deleteSession` mock；单删与批量删除成功路径。

#### Metrics

- 后端 **597** 用例 / **36** 文件；前端 **207** 用例 / **10** 文件；**合计 804** 个 Vitest 用例。

#### Docs

- `README.md`、`CONTRIBUTING.md`、`ONBOARDING.md` 与测试规模对齐；根 `package.json` 版本 **0.15.3**。

---

## [0.15.2] - 2026-04-02

### test: 补齐 4 个后端模块测试 + 文档漂移修复 -- 714 tests / 34 files

#### Tests

- `experimentStore.test.js` -- 37 用例覆盖 experiments/runs/trials 全部 20 个 CRUD 函数（含 userId 隔离、分页、stale recovery、error path）
- `metricExtractor.test.js` -- 35 用例覆盖 3 种提取模式（regex / json_path / exit_code）、guard 校验、isImproved、improvementPercent 边界值
- `mcpConfig.test.js` -- 20 用例覆盖 6 个 core server 常驻加载、5 个条件 server ENV 驱动、SSE transport override、getAllowedTools 通配符生成
- `supabaseClient.test.js` -- 4 用例覆盖 test 环境 fallback 和 production fail-fast 校验
- 测试总数: 606 -> 714 (+108)，测试文件: 30 -> 34 (+4)

#### Docs

- 修正表数量漂移: 全站 "10 tables" -> "11 tables"（含 memory_entities + memory_relations）
- ARCHITECTURE.md Schema 区块补充 memory_entities / memory_relations 完整 DDL
- README.md 测试数更新: 597 -> 714
- CHANGELOG.md + 迁移计划文档同步修正

## [0.15.1] - 2026-04-02

### fix(audit): 全面安全审计修复 -- 5 critical + 10 high + 8 medium (22 files)

#### Security

- benchmark 命令执行面收紧 -- BLOCKED_PATTERNS 校验 + shellSplit() 无 shell argv 解析执行; 用户命令必须使用 allowlisted runner 或工作区内可执行文件，`node -e` / `python -c` 等内联求值形式被拒绝; 内部 git 命令单独走 shell 路径 (experimentEngine.js)
- cp -r shell 注入修复 -- 改为 spawnSync 参数数组 + 返回值检查 (experimentEngine.js)
- proxy 端口鉴权 -- 新增可选 PROXY_TOKEN，配置后校验 x-api-key 匹配; 未配置时不强制（兼容本地 dev） (proxy.js, sdkRuntime.js, config.js)
- store update 用户隔离 -- experimentStore 和 sessionStore 的 update 系列函数均新增 userId 参数; researchSwarm 调用点同步传递 userId (experimentStore.js, sessionStore.js, agentManager.js, researchSwarm.js)
- hooks 围栏强化 -- isFilePathAllowed 空输入 deny; rm -rf 全拦截; cd .. 无斜杠拦截 (hooks.js)
- subscribe_workflow 授权收紧 -- 移除 workflow 所有权 fallback (server.js)

#### Bug Fixes

- await createRun 缺失 -- 防御性修复，防止 runId 变为 Promise 对象 (experimentEngine.js)
- branchIndex 硬编码 -- allSettled fallback 改用位置 index (researchSwarm.js)
- startAgent 竞态 -- 新增 activeAgents 预占位 (agentManager.js)
- ensureWorkspaceGitIdentity 崩溃 -- 改 spawnSync + 返回值 error/status 检查 (experimentEngine.js)
- runExperimentNode 无超时 -- 新增 wall-clock timeout + 超时时调用 abortExperiment 终止底层实验 (workflowEngine.js)
- svgRef 空指针 -- 三处添加 null guard (WorkflowEditor.jsx)
- WebSocket 双连接 -- connect 守卫补 CONNECTING (useWebSocket.js)
- SVG id 全局冲突 -- 改为 useId 动态生成 (WorkflowEditor.jsx)
- nextEdgeId 不重置 -- newWorkflow 时重置 (workflowEdgeUtils.js)
- fetchExperiments 卸载泄漏 -- AbortController + useCallback (ExperimentView.jsx)
- globalThis 双真相源 -- 统一使用模块级 \_agentEventsBus (researchSwarm.js)

#### Improvements

- agentEvents maxListeners 50 -> 200 (agentManager.js)
- event key 稳定性 -- 移除 idx 后缀 (ExperimentView.jsx)
- delete 防重复 -- isDeleting 守卫 (SessionDrawer.jsx)
- scroll 抖动修复 -- instant + rAF (AgentTimeline.jsx, TerminalView.jsx)
- proxy req.url null 守卫 (proxy.js)

#### Tests

- 603 tests / 30 files 全部通过
- hooks.test.js: 2 cases 适配新安全语义
- experimentEngine.test.js: 4 cases 适配 updateRun userId 参数

---

## [0.15.0] - 2026-04-02

### feat(db): SQLite to Supabase PostgreSQL 全面迁移 (version bump 0.14.0 -> 0.15.0)

#### Breaking Changes

- `better-sqlite3` (原生 N-API) 已完全移除，替换为 `@supabase/supabase-js` (纯 JS)
- 环境变量新增 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY`（必填）
- 移除环境变量 `DB_PATH`（不再需要本地 SQLite 文件）
- 所有 Store 函数从同步变为异步（返回 Promise）

#### Added

- `backend/supabaseClient.js` -- Supabase 客户端单例，支持 publishable/secret key 两种模式
- Supabase PostgreSQL schema -- 11 张表 + 8 索引 + FK 级联删除
- RLS 行级安全策略 -- 11 条基于 JWT claims 的用户隔离策略
- `.env.example` 更新 -- 新增 Supabase 配置文档

#### Changed

- 5 个 Store 模块完全重写为 async Supabase API（sessionStore、experimentStore、workflowStore、memoryStore、swarmStore）
- ~104 个调用点从同步改为 `await`（agentManager、server、researchSwarm、workflowEngine、RememberTool）
- JSON 列升级为 JSONB（stats、pinned_context、plan、definition、context、node_results、all_metrics、parsed_result）
- Boolean 列从 INTEGER 0/1 升级为原生 BOOLEAN（accepted、is_selected）
- 时间戳从 `datetime('now')` 迁移为 `TIMESTAMPTZ DEFAULT NOW()`

#### Removed

- `better-sqlite3` 依赖（消除跨平台 N-API 编译问题）
- `config.dbPath` 配置项
- `experimentDb` 共享连接模式（改为各 Store 独立引用 Supabase client）
- 本地 `data/` 目录依赖

#### Migrations

- `backend/migrations/001_create_all_tables.sql` -- 11 张表 + 8 索引（幂等）
- `backend/migrations/002_enable_rls.sql` -- RLS + 11 条用户隔离策略（幂等）

#### Tests

- 603 tests / 30 files -- 全部通过
- 8 个测试文件重写为 Supabase client mock
- 新增 LoopTool.test.js (4 cases)
- 新增 startAgent 失败时的 listener/timer cleanup 测试覆盖

---

## [0.14.0] - 2026-04-02

### P3：多 Agent 研究组织（Research Swarm）

#### Added

- **`backend/researchSwarm.js`**：P3 核心编排引擎。实现 Coordinator/Worker 双层模式：Coordinator Agent 将 ResearchPlan 拆解为 N 个研究假说（`coordinatorDecompose`），N 个 Worker Branch 并行运行各自的 P1 Ratchet Loop（`runBranch`），Coordinator 再综合所有 Branch 指标选出最优方向（`coordinatorSynthesize`）。最优 Branch workspace 通过 rsync 合并回主 workspace，rejected branches 自动清理（Q1 方案 C）。
- **`backend/swarmStore.js`**：Swarm 持久化层。新增 `swarm_branches`（分支状态、指标、是否被选中）和 `swarm_coordinator_decisions`（Coordinator 决策完整审计日志）两张 SQLite 表，支持级联删除和完整 CRUD API。
- **Swarm API 端点**（`backend/server.js`）：
  - `POST /api/experiments/:id/swarm`——以 Swarm 模式启动，支持 `branches`/`branch_budget`/`top_k` 参数覆盖
  - `GET /api/experiment-runs/:id/branches`——获取所有 Branch 状态
  - `GET /api/experiment-runs/:id/coordinator-decisions`——Coordinator 决策审计
  - `POST /api/experiment-runs/:id/abort-swarm`——终止所有并行 Branch
  - `GET /api/experiment-runs/:id/swarm-status`——查询 Swarm 是否仍在运行
- **Swarm WebSocket 事件广播**：服务端复用 `experimentSubs` map，新增 8 种 `swarm` 类型 WS 事件（`swarm_decompose_start`、`swarm_hypothesis`、`swarm_branch_start/complete`、`swarm_synthesize_start`、`swarm_branch_selected`、`swarm_complete/error`）。
- **`frontend/src/hooks/useWebSocket.js`**：新增 swarm 状态（`swarmBranches`/`swarmHypotheses`/`swarmStatus`/`swarmReasoning`）及 `runSwarm()`/`abortSwarmRun()`/`loadSwarmBranches()` API；swarm 事件自动与 `subscribe_experiment` 同订阅，无需额外操作。
- **`frontend/src/components/SwarmBranchCard.jsx`**：单个 Branch 状态卡片，展示假说文本、运行状态（旋转动画 / 完成 / 失败 / 已选中高亮）、最优 Metric、Trial 进度。
- **Swarm Dashboard**（`ExperimentView.jsx`）：Live Dashboard 升级为 Swarm Dashboard，包含 Coordinator 状态行、假说列表（Decompose 阶段）、Branch 卡片网格（自适应列数）、Coordinator 选择理由展示。
- **"⚡ Run as Swarm" 按钮**（`ExperimentView.jsx`）：在实验头部新增 Swarm 启动按钮（紫色渐变，区别于普通 Run 按钮）。

#### Architecture

- **PORT 隔离（Q3）**：每个 Branch Runner 注入 `BRANCH_PORT = 14000 + branchIndex` 并写入 Branch workspace 的 `CLAUDE.md`，防止并行 benchmark 命令争抢同一端口。
- **workspace 克隆策略**：使用 `git clone --local --no-hardlinks` 实现同文件系统快速克隆，避免对象传输开销。
- **无 Coordinator 时的兜底**：若 `initSwarmBus()` 未被调用或 Agent 超时，自动切换为启发式选择（`minimize`/`maximize` 方向最优指标）和模板化假说生成，确保 Swarm 在任何环境下均可降级运行。
- **P3 → P1 串联**：Coordinator 选出最优 Branch 后，将其 workspace 合并回主 workspace，此时 P1 Ratchet Loop 可继续在最优起点上精细收敛，实现两级优化。

#### Bugfixes (code review round 1 + round 2)

- fix: Coordinator Agent 永不运行——`initSwarmBus` 漏设模块级 `_agentEventsBus`
- fix: abort signal 被丢弃——改用 `abortExperiment(branchRunId)` 桥接
- fix: branchIndex 命名空间不一致——统一使用数组下标
- fix: swarmStore 重复 DB 连接——改为共享 `experimentDb`
- fix: `mergeBestBranchIntoMain` git commit 缺 identity——添加 `-c user.email/name`
- fix: shell injection——`execSync` 替换为 `spawnSync` + 参数数组
- fix: `process.env` 全局污染——finally 块清理 branch port 变量
- fix: `loadSwarmBranches` 死代码——接入 View History 恢复路径
- fix: `runSwarm` 缺少 `Content-Type: application/json`，后端收到 `undefined` body
- fix: Swarm baseline workspace 未初始化——启动前调用 `prepareWorkspace`
- fix: Branch runId 未在 `experiment_runs` 创建记录——改用 `createRun()` 正式建行
- fix: Swarm 顶层 run 状态不回写——完成/失败时调用 `updateRunStatus`/`updateRunMetrics`

#### Tests

- `backend/researchSwarm.test.js` — 17 tests（XML 解析器 10 cases、启发式选择 4 cases、EventEmitter + 生命周期 3 cases）
- `backend/swarmStore.test.js` — 10 tests（Branch CRUD 7 cases、级联删除、Coordinator 审计 2 cases）

---

### 基准驱动自动化研究引擎 (AutoResearch & Experiment Engine)

#### Added

- **核心自动研究机制 (Ratchet Loop)**: 新增 `experimentEngine.js` 驱动自动化打分循环，支持根据自定义的 `ResearchPlan` 白皮书来安全隔离执行“代码假说-提取测试指标-决策通过与否”闭环。通过 `metricExtractor.js` 灵活解析终端日志的 regex、JSON 和 Exit Code，以此判定并借助本地 Git 增量强制对失败的方案进行代码撤销。
- **实时实验仪表台**: `ExperimentView.jsx` 正式上线。具备双联大屏：左侧支持 JSON 在线编排 ResearchPlan 并发散执行；右侧搭载随 WS 实时回传刷新的打分监控图与各 Trial 最新通过状态，彻底实现量化指标的可视化统筹。
- **DAG 管线实验节点映射 (`workflowEngine.js`)**: **`experiment`** 现已正式作为平台支持的原生图谱节点并入 `WorkflowEditor`。用户可在可视化画布中拖曳出实验节点，以实现“当主工作流运转至此，阻断抛交后台进行多轮基数优化，待指标收敛后自动将 Best Metric 携带至下一工作流节点”的管线闭环构想。
- **实验三级持久化网络**: 引入 `experimentStore.js`。内置表结构（`experiments` 模板、`experiment_runs` 场次与 `experiment_trials` 具体试运行尝试），确保每一次科研数据都能被永久检索和审查。
- **指标折线图 (P1 补完)**: `ExperimentView.jsx` Live Dashboard 新增纯 SVG 折线图，实时展示 primary metric 随 trial 序号变化的曲线；Accept 点以主题色圆点标注，Reject 点以红色圆点标注；附带 Y/X 轴刻度与图例，数据不足 2 点时显示占位提示。
- **ResearchPlan 预置模板 (P2 补完)**: 新建 `backend/templates/` 目录，包含 5 个生产级 JSON 模板（ml-training / performance-optimization / bundle-size / ci-quality / security-fuzz）；后端新增 `GET /api/experiment-templates/:filename` 路由安全提供模板文件（文件名严格正则白名单）；ExperimentView 侧栏新增"Start from template"模板快选区，点击一键填充 JSON 编辑器并跳转到编辑视图。

### 审查后续修复

#### Fixed

- **AR-F1** `experimentEngine.js` -- `source_dir` 复制已有 Git 仓库时，workspace 因继承 `.git` 而跳过 repo-local identity 初始化；现改为无论仓库是否预先存在，都统一写入 `AutoResearch` 本地身份，并在缺少 HEAD 或复制出脏工作区时创建 baseline snapshot，避免后续 trial commit 再次依赖宿主环境配置
- **AR-F2** `ExperimentView.jsx` -- 快速切换实验时，旧的 `/runs` 请求晚到会覆盖当前实验列表；新增 pending request 取消与 `selectedExperimentIdRef` 守卫，确保只有当前选中实验的响应才能落盘到 UI
- **AR-F3** `ExperimentView.jsx` + `ExperimentView.module.css` -- `primary` / `danger` 按钮样式通过字面量 className 绑定，无法命中 CSS Modules 生成类名；改为显式 module class，恢复 Save / Run Experiment / Abort 的视觉样式

#### Tests

- `experimentEngine.test.js` 新增“`source_dir` 已含 Git 仓库时仍写入 repo-local identity 并成功完成 trial commit”的回归用例
- `ExperimentView.test.jsx` 新增实验切换竞态用例与主按钮样式绑定用例

### CI 修复: 实验引擎 git identity

#### Fixed

- **CI-1** `experimentEngine.js` -- 实验 workspace 初始化时 `git commit` 依赖全局 git user identity，CI runner 无此配置导致 baseline 阶段 fatal 失败；改为在 `git init` 后立即设置 repo-local `user.email` / `user.name`（`AutoResearch` 内部标识，不影响真实用户身份）

### 15 项实验引擎六轮审查修复 (Experiment Engine Audit Round 6 — 3C + 5I + 4T + 3Test)

#### Fixed -- Critical

- **R6-C1** `ExperimentView.jsx` -- SVG gradient `id="areaGrad"` 为全局 DOM ID，多实例渲染时冲突；改用 `useId()` 生成唯一 ID
- **R6-C2** `ExperimentView.module.css` -- `rgba(var(--status-running-rgb,...), 0.15)` 变量缺失时整条声明失效；改为 `color-mix(in srgb, ...)` 方案
- **R6-C3** `ExperimentView.jsx` -- 事件列表 `.reverse()` + `key={idx}` 导致所有 key 随新增事件偏移；改为 CSS `flex-direction: column-reverse` + 稳定复合 key

#### Fixed -- Important

- **R6-I1** `ExperimentView.jsx` -- 4 处 `console.error` 违反项目 logger 规则且错误被静默吞掉；移除并补充注释
- **R6-I2** `ExperimentView.jsx` -- 模板加载失败静默回退空白，用户无感知；新增 `templateError` state 和内联错误提示
- **R6-I3** `ExperimentView.jsx` -- `selectedExperiment.plan` 可能 undefined 致 `JSON.stringify(undefined)` 破坏受控 textarea；加 `?? {}` 保护
- **R6-I4** `ExperimentView.jsx` -- 切换实验时未清空 runs 状态，短暂显示旧数据；`handleSelectExperiment` 首行立即 `setRuns([])`
- **R6-I5** `server.js` -- `existsSync` + `readFileSync` TOCTOU 竞态；移除预检，改为 try/catch + `err.code === 'ENOENT'` 映射 404

#### Fixed -- Template

- **R6-T1** `bundle-size.json` -- guard 重复执行 build 导致双倍耗时；改为 `node --check` 轻量语法检查
- **R6-T2** `bundle-size.json` -- `chunk_count` direction 设为 minimize 与 code-splitting 指令矛盾；改为 maximize
- **R6-T3** `security-fuzz.json` -- guard 用 `--grep`（Mocha 专属），通用模板不应假定 runner；改为 `npm test`
- **R6-T4** `ml-training.json` -- `--epochs 5 --eval-only` 参数矛盾；拆分为独立 `evaluate.py` 调用

#### Tests

- 新增根级 `vitest.config.js`（`test.projects`）解决根目录 `npx vitest run` 时 frontend setupFiles 不加载的问题
- `ChatInput.test.jsx` / `SessionDrawer.test.jsx` 改用原生 vitest 断言替代 jest-dom matchers，消除跨 workspace 兼容性问题

### 1 项实验引擎五轮审查修复 (Experiment Engine Audit Round 5 — 1M)

#### Fixed -- Major

- **R5-M1** `experimentEngine.js` -- `exec(..., { signal })` 虽然能终止直接子进程，但对 `npm test` 这类会继续派生 worker 的命令不保证清理完整进程树；`runCommand` 现改为 `spawn + process-group kill`，在 Unix/macOS 上以独立进程组运行命令并在 abort/timeout 时对整个进程组发送 `SIGTERM`/`SIGKILL`，Windows 上使用 `taskkill /T /F`

#### Tests

- `experimentEngine.test.js` 新增“父进程派生 worker 后 abort 不留残余进程”的回归用例

### 1 项实验引擎四轮审查修复 (Experiment Engine Audit Round 4 — 1M)

#### Fixed -- Major

- **R4-M1** `experimentEngine.js` -- 虽然给 `execSync` 传入了 `AbortSignal`，但 baseline/guard/benchmark 仍然同步阻塞 Node.js 事件循环，导致 `/abort` 请求在命令执行期间根本无法被处理；`runCommand` 现已改为基于异步 `exec` 的非阻塞执行，并在 abort 时立即结束当前命令与 trial

#### Tests

- 新增 `experimentEngine.test.js`，覆盖 symlink 越界拦截与长时间 baseline 的中途 abort
- 新增 `server.experiment.test.js`，覆盖 `subscribe_experiment` 的 runId 归属校验与 `GET /api/experiment-runs/:id`
- `useWebSocket.test.jsx` 新增历史运行真实 status 恢复与仅对 running run 重连订阅的回归用例

### 4 项实验引擎三轮审查修复 (Experiment Engine Audit Round 3 — 2C + 2M)

#### Fixed -- Critical

- **R3-C1** `server.js` -- `subscribe_experiment` 鉴权逻辑为 `runOwned || expOwned`，仍可用自己的 experimentId 订阅他人 runId；改为仅校验 runId 归属
- **R3-C2** `experimentEngine.js` -- source_dir 校验用 `resolve()` + `startsWith()`，未消解 symlink；改为 `fs.realpathSync()` 解析真实路径后再比较

#### Fixed -- Major

- **R3-M1** `experimentEngine.js` -- guard/benchmark 走 `execSync` 不响应 abort signal；`runCommand` 增加 `signal` 参数透传给 `execSync`，abort 时立即终止子进程
- **R3-M2** `useWebSocket.js` + `server.js` -- View History 硬编码 `completed` 状态，failed/aborted 历史显示为已完成；新增 `GET /api/experiment-runs/:id` 端点，前端获取真实 run status

#### Improved

- `experimentEngine.js` -- cwdOverride 绕过了 `CLAUDE.md` 复制逻辑，可能触发 SDK onboarding 产生无关文件变更；`prepareWorkspace` 现在确保实验 workspace 内有 `CLAUDE.md`

### 7 项实验引擎二轮审查修复 (Experiment Engine Audit Round 2 — 4C + 3M)

#### Fixed -- Critical

- **R2-C1** `experimentEngine.js` + `agentManager.js` -- agent trial 的 CWD 未指向实验 workspaceDir，导致 agent 修改与 benchmark 不在同一目录，核心 Ratchet 闭环失效；`startAgent` 新增 `opts.cwd` 透传，`buildBaseOptions` 支持 cwdOverride
- **R2-C2** `experimentEngine.js` -- source_dir 沙箱仅校验全局 workspaceDir，允许跨租户读文件；改为校验 user-specific workspace root (`config.workspaceDir/{userId}`)
- **R2-C3** `experimentEngine.js` -- 文件白名单用 `git diff --name-only` 检查，遗漏 untracked 新建文件；增加 `git ls-files --others --exclude-standard`，reject 时同步 `git clean -fd`
- **R2-C4** `server.js` + `experimentEngine.js` -- `/api/experiment-status` 返回全部活跃 runId 不过滤 userId，且 `subscribe_experiment` 未校验 runId 归属；`getActiveExperiments` 按 userId 过滤，WS 订阅增加 runId 归属校验

#### Fixed -- Major

- **R2-M1** `experimentEngine.js` -- abort 仅设 signal 不停 agent/execSync；activeExperiments 中记录 `currentAgentSessionId`，abort 时同步调用 `stopAgent`
- **R2-M2** `useWebSocket.js` -- `loadExperimentRunsEvents` 调用 `subscribeExperiment` 清空了刚恢复的历史事件并错误设置 running 状态；改为直接设置 events/status，仅发 WS subscribe 不清空
- **R2-M3** `WorkflowEditor.jsx` + `ExperimentView.jsx` -- 实验节点 ID 标注为 Number 且 placeholder 为 "1"，实际为 UUID；修正标签/placeholder，ExperimentView 列表和详情页显示 ID 以便复制

### 13 项实验引擎代码审查修复 (Experiment Engine Audit — 6C + 7I)

#### Fixed -- Critical

- **C1** `experimentEngine.js` -- `bestMetric` 在计算 `improvementPercent` 前被覆盖，改进率始终报 0%；调换赋值与计算顺序
- **C2** `experimentEngine.js` -- git commit 消息拼接用户可控 metric 值存在 shell injection；增加 `safeMetric` 过滤，仅保留 `[-\d.e+]`
- **C3** `experimentEngine.js` -- `source_dir` 无路径沙箱校验，允许任意目录被复制；增加 `config.workspaceDir` 前缀强制检查
- **C4** `workflowEngine.js` -- `runExperimentNode` 检查 `event.subtype` 但 EventEmitter data 无此字段，experiment 节点 Promise 永远不 resolve；改为三个独立 handler 直接匹配事件名
- **C5** `workflowEngine.js` -- `currentExpRunId` 在异步 `.then()` 中赋值，早期失败事件被忽略导致节点挂起；改为同步创建 runId 后再启动异步循环
- **C6** `server.js` -- `/api/experiments/:id/run` 响应缺少 `runId`，前端 WS 订阅拿到 `undefined`；在响应前同步创建 runId 并返回

#### Fixed -- Important

- **I1** `experimentStore.js` -- `getBestTrial` 固定 ASC 排序，maximize 实验返回最差 trial；改为双预编译语句按 direction 分派
- **I2** `useWebSocket.js` -- `connect` 空依赖 useCallback 导致 `experimentRunId` 闭包过期，重连后不重新订阅；增加 `experimentRunIdRef`
- **I3** `useWebSocket.js` -- `loadExperimentRunsEvents` 漏传 `expId`，WS 订阅 experimentId 为 undefined；补齐参数传递
- **I4** `ExperimentView.jsx` -- `event.content` 未做 null guard，畸形 WS 消息会抛 TypeError；全部加 `?.` 可选链
- **I5** `middleware.js` -- workflow nodeSchema 的 type enum 缺少 `'experiment'`，含实验节点的 workflow 被 Zod 拒绝；补齐枚举值
- **I6** `ExperimentView.jsx` -- 使用 `window.alert` 阻塞式提示；改为 inline error state 渲染
- **I7** `Header.jsx` -- 主题切换按钮缺少 `aria-label`；补齐无障碍标签

#### Docs

- `ARCHITECTURE.md` -- 修正 experiment_runs schema 三个字段名错误 (`error`->`error_message`, `created_at`->`started_at`, `updated_at`->`completed_at`)、补齐 `user_id`/`status` 默认值、修正 trials 表名 (`experiment_trials`->`trials`) 及主键类型 (`INTEGER`->`TEXT`)
- `README.md` -- 测试总数 528->554+、SQLite 描述 2x->3x

### 5 项阻塞性缺陷修复 (Blocking Issue Fix — 2C + 3H)

#### Fixed — Critical

- **C1** `hooks.js` — 路径围栏仅挂在 Bash hook 上，Read/Write/Edit/Grep/Glob 无 workspace 校验；`../` 相对路径不拦截。新增 `isFilePathAllowed()` 对所有文件工具做 `resolve(workspaceRoot, path)` 归一化 + `isPathInside` 校验
- **C2** `server.js` — 删除运行中 session/workflow 产生"幽灵任务"：删库不先 stop，后续 stop/abort 因 ownership 失败。删除接口现在先调 `stopAgent()`/`abortWorkflow()` 再删库

#### Fixed — High

- **H1** `WorkflowEditor.jsx` — Workflow 启动强耦合 WS subscribe ack，3s 超时直接标记失败。改为 fire-and-forget subscribe + REST 并行，WS 失败不阻塞执行
- **H2** `useWebSocket.js` + `WorkflowEditor.jsx` — Heartbeat 仅发 ping 无 pong 超时，半开连接永远不触发 onclose。新增 `lastMessageTimeRef`，>45s 无任何消息则主动 `ws.close()` 触发重连
- **H3** `agentManager.js` + `workflowEngine.js` — startAgent/continueAgent 同步 throw 无回滚：running session 或 activeAgents slot 泄漏。SDK `query()` 包裹 try/catch，失败时清理状态 + 发 done 事件

#### Tests

- `hooks.test.js` 新增 `isFilePathAllowed` 单元测试 + PreToolUse 集成测试 (10 tests)
- `useWebSocket.test.jsx` 新增 pong timeout 测试 (2 tests)
- 测试总数: 542 -> 554 (全绿)

### 9 项缺陷修复 (Bug Audit Fix — 1C + 3H + 5M)

#### Fixed — Critical

- **C1** `schemaValidator.js` — Edit tool Zod schema 字段名错误 (`search_string`/`replacement_string` -> `old_string`/`new_string`)，导致所有 agent Edit 调用被拒绝；同步修正 Grep schema (`directory` -> `path`)；修复 Zod v4 `.errors` -> `.issues` 兼容

#### Fixed — High

- **H1** `proxy.js` — 流中断 catch 路径未调用 `transformer.flush()`，SSE 客户端收不到 `message_stop`，agent session 卡在 running 状态
- **H2** `WorkflowEditor.jsx` — Transform 节点 JSON textarea 每次按键 `JSON.parse` 失败即丢弃输入，手打 JSON 完全不可用；重构为 `JsonTextarea` 组件，本地 string state + onBlur 提交
- **H3** `WorkflowEditor.jsx` — Workflow WebSocket 缺少 heartbeat，代理/LB 静默断连后工作流运行事件丢失；新增 30s ping 心跳 + onclose/cleanup 清理

#### Fixed — Medium

- **M1** `proxy.js` — 请求体 `body += chunk` 隐式 UTF-8 toString，多字节字符跨 chunk 边界被截断（中文 prompt 受影响）；改为 Buffer 数组 + `Buffer.concat`
- **M2** `hooks.js` + `agentManager.js` — `sessionLoopState` 仅在 SessionEnd hook 清理，agent 崩溃/abort 时条目泄漏；新增 `cleanupSessionLoopState()` 在 finally 块调用
- **M3** `useWebSocket.js` — MCP health 状态判定 off-by-one，用旧 `toolErrors` 值检查阈值，实际需 3 次失败才进 `failed`；改为先递增再判断
- **M4** `WorkflowEditor.jsx` — Delete/Backspace 快捷键仅处理 node 不处理 edge；补充 selectedEdge 删除逻辑
- **M5** `useWebSocket.js` — `loadSession` 未发送 WS subscribe，加载仍在运行的历史 session 无实时更新；running 状态时自动发送 subscribe

#### Tests

- 新增 `schemaValidator.test.js` (8 tests)
- `hooks.test.js` 新增 `cleanupSessionLoopState` 测试 (2 tests)
- `proxy.test.js` 新增 flush 幂等性测试 (1 test)
- `useWebSocket.test.jsx` 新增 MCP off-by-one、loadSession subscribe 测试 (4 tests)
- 测试总数: 528 -> 542 (全绿)

---

## [0.13.0] - 2026-04-01

### Harness 终极架构补强 (Harness Engineering - The Final Leap)

#### Added

- **语义级代码护城河 (LSP Semantic Engine)**: 新增 `LSPTool`（基于 `ts-morph`），通过提供真正的 `find_references` 和 `go_to_definition` 方法，让 Agent 具备 IDE 级别的 AST 感知能力，彻底告别正则文本检索。
- **“上帝之眼”破坏防御前线 (Destructive Oracle)**: 改造 `PreToolUse` Hook，扩展至细粒度 SQL 保护机制（`DROP TABLE`, `TRUNCATE`），容器层拦截（`docker prune`, `rm -f`），以及禁止高风险版本控制器操作（`git reset --hard`, `git push --force`）。
- **上下文强锁定防遗忘机制 (Context Pinning Escrow)**: 在引擎会话层及 SQLite (`pinned_context`) 实装，通过让大模型附带 `<pin_context>` 标签实现记忆永驻置顶，杜绝因为超长会话和窗口压缩导致的核心逻辑失忆。

---

## [0.12.0] - 2026-04-01

### Harness 全自动基座与自愈引擎 (Harness Engineering & Self-Healing)

#### Added

- **本地 Zod 参数自愈网关 (`schemaValidator.js`)**: 拦截所有内置 Tool 的畸形 JSON 调用，本地强制注入闭环修正提示 (`Your JSON payload is strictly invalid...`)，彻底免除向外层计算层/沙盒发起的无用请求耗时。
- **语义死循环断路器 (`hooks.js` / Semantic Loop Watchdog)**: 监听内存中最近的 Tool 调用，如果连续 3 次的 Hash 指纹完全一致且失败，系统自动向大模型注入 `<harness_override>` 高优系统破壁指令，强制其放弃并切换解题路径；当同一循环达到 5 次失败，将直接引发底层底层断路异常 (`Circuit Breaker`)。
- **全保真长堆栈透传**: 废除之前为了“节省 Token 成本”而截断报错字符的做法。现在全面采纳“以 Token 换质量”的黑盒原则，即便是长达数百行的 Node.js / Python 堆栈乱码，Harness 也将全保真喂入上下文视窗，提升深层 Bug 排障成功率。

### 网络搜索与爬取能力增强 (Web Search & Crawling Enhancement)

#### Added

- **6 个新 MCP Server 集成** (`mcpConfig.js`):
  - `fetch` — 轻量级 HTTP URL 读取与 HTML→Markdown 转换（无需 API Key，始终可用）
  - `tavily-search` — AI 优化搜索引擎，支持实时 Web 搜索与内容提取（免费 1K 次/月, [tavily.com](https://tavily.com)）
  - `firecrawl` — 生产级网页爬取，支持单页抓取、批量处理、站点地图与结构化数据提取（免费 500 页/月, [firecrawl.dev](https://firecrawl.dev)）
  - `jina-reader` — 高效 URL→Markdown Reader，token 效率最优（SSE 远程传输, [jina.ai](https://jina.ai)）
  - `exa-search` — 神经语义搜索引擎，擅长学术/文档/深度研究（[exa.ai](https://exa.ai)）
  - `brave-search` — 隐私优先 Web 搜索，支持图片/视频/新闻搜索（免费 2K 次/月, [brave.com/search/api](https://brave.com/search/api)）
- **条件加载机制**: 所有需 API Key 的 MCP Server 仅在对应环境变量存在时激活，避免无效子进程
- **Jina Reader 双传输**: 默认通过 SSE 连接 `https://mcp.jina.ai/v1`，可通过 `JINA_MCP_ENDPOINT` 覆盖
- **`getAllowedTools()` 动态化**: 自动从当前激活的 MCP 服务器列表生成工具模式，不再硬编码

#### Added — 编排 Skill

- **`web-research` Skill** (`plugins/agentboard-skills/skills/web-research/SKILL.md`):
  四阶段编排流水线 **搜索 → 爬取 → 分析 → 持久化**；内置工具选择矩阵（按意图自动选择最佳搜索/爬取工具）、3-5 页精选抓取策略、强制引用来源、错误恢复表
- **`data-extraction` Skill** (`plugins/agentboard-skills/skills/data-extraction/SKILL.md`):
  四阶段编排流水线 **定位 → 提取 → 验证 → 导出**；Schema-first 提取范式、类型校验 + 去重 + 异常值检测、多格式导出（JSON/CSV/Markdown）、多页分页提取模式

#### Changed — 意图路由引擎

- **`router.js` 双通路由重构**: 从单一关键词匹配升级为两阶段意图分类系统：
  - **Pass 1 — 意图分类**: 4 个正则意图模式（`web-research`、`web-scraping`、`url-reading`、`data-analysis`）对 prompt 进行多命中评分
  - **Pass 2 — 类别共激活**: 命中的意图自动批量激活其所属 MCP 类别组（`search`、`crawl`、`browser`、`memory`），取代逐个关键词命中单个 MCP 的脆弱模式
  - 可选类别（如 `memory`）在多意图交叉时自动激活
  - 返回值新增 `detectedIntents[]` 字段用于调试可观测性（向后兼容，现有调用方忽略此字段）
- **`registry.js` 元数据扩展**: 所有 MCP 能力项新增 `category` 字段（`core`/`search`/`crawl`/`browser`），支持路由引擎的类别级批量激活；6 个新 Server 配置 15-30 条中英双语关键词

#### Changed — 环境配置

- `.env.example` 新增 5 个 API Key 文档条目（含注册链接与免费额度说明）
- `.env.local` 新增空占位符：`TAVILY_API_KEY`, `FIRECRAWL_API_KEY`, `JINA_API_KEY`, `EXA_API_KEY`, `BRAVE_API_KEY`

#### Fixed

- **Fetch MCP 包名修正**: `@anthropic/mcp-server-fetch`（Python/uvx 生态，npm 不存在）→ `mcp-fetch-server`（npm 可用）
- **Brave Search MCP 包名修正**: `@anthropic/mcp-server-brave-search`（npm 不存在）→ `@modelcontextprotocol/server-brave-search`（npm v0.6.2）
- **Prettier 格式修正**: `ARCHITECTURE.md` 和 `registry.js` 的代码格式与 Prettier 规则对齐

#### Tests

- 全部 **330** 后端测试通过，零回归

### 连接稳定性与工作流编辑器修复 (Connection Stability & Workflow Editor Fixes)

#### Fixed

- **Agent WebSocket 心跳协议修复**: 后端现在原生接受前端发送的 `ping` 心跳并返回 `pong`，避免把保活流量误判成 `invalid JSON`
- **断线误进入 running 状态修复**: Agent 面板在 WebSocket 未连接时不再允许发送 `Run/Continue`，避免消息被静默丢弃后 UI 仍锁死在 `running`
- **Workflow Socket 自动重连**: Workflow 编辑器的专用 WebSocket 断开后会自动重连，恢复后可继续订阅当前运行中的 workflow run，而不必手动刷新页面
- **条件分支重复边唯一性修复**: workflow edge 渲染、选择、双击删除全部切换为优先使用 `edge.id`，解决同一目标节点上的 true/false 边互相串扰
- **Session History 总数刷新修复**: 删除 session 后改为重新拉取列表和总数，避免只看当前 30 条时把 `total` 错算成可见条数

#### Tests

- 新增后端 WebSocket 心跳回归测试，覆盖 `ping -> pong`
- 新增前端断线提交保护测试、workflow socket 重连测试、session 删除后总数刷新测试
- 前端测试总数提升至 `198`，后端测试总数提升至 `330`，总计 `528`

### 深度代码审计修复 (Deep Code Audit Fix) -- 4 Critical + 8 High + 7 Medium

#### Critical 数据完整性与安全修复

- **[C1] Session 删除非原子操作**: `deleteSession` 的 events 删除与 session 删除未包裹事务，进程在两步之间崩溃会导致数据孤立。现已用 `db.transaction()` 包裹为原子操作
- **[C2] Workflow 删除绕过租户隔离**: `deleteWorkflowRuns` SQL 语句无 `user_id` 过滤条件，攻击者猜到 workflowId 可删除其他租户的全部运行历史。现已加 `user_id` 过滤并用事务包裹
- **[C3] Session 批量删除缺失 Content-Type header**: `SessionDrawer` 批量删除时 `withClientAuth({ body: ... })` 未传递 `Content-Type: application/json`，导致后端 JSON 解析失败。现已正确传递 headers
- **[C4] 工作流编辑器画边初始坐标未减 pan 偏移**: `handleOutputPortMouseDown` 初始化坐标未考虑画布平移量，导致平移后画边第一帧从错误位置跳跃。现已在初始化时减去 `pan.x/pan.y`

#### High 级别修复

- **[H1] `continueAgent` TOCTOU 占位无 AbortController**: 占位 entry 缺少 `abortController`，窗口期内调用 `stopAgent` 被静默吞掉且后续 `consumeStream` 覆盖时丢失 `stopped` 标志。现已在占位时即创建 AbortController，并在 `consumeStream` 中保留已有 `stopped` 状态
- **[H2] 工作流 Agent 节点事件监听器竞态**: `agentEvents.on` 在 `startAgent` 之后注册，极速完成的 agent 可能错过 done 事件导致 Promise 永不 settle。现已将监听器注册移至 `startAgent` 调用之前
- **[H3] 批量删除无上限**: `batch-delete` 端点对 `ids` 数组无长度限制，万级 ids 同步 SQLite 循环阻塞主线程。现已限制为最多 100 条
- **[H4] 节点拖拽与画布平移状态无互斥**: `handleNodeMouseDown` 未清除 `isPanning` 状态，触控板双指操作可能同时触发拖拽和平移。现已在拖拽开始时设置 `setIsPanning(false)`
- **[H5] Edge 唯一标识仅靠 from+to**: 同一目标节点的 true/false 条件边无法区分，选择/删除/更新时互相影响。现已为每条 edge 添加唯一 `id` 字段，`edgeMatches` 优先使用 id 匹配
- **[H6] WebSocket 重连定时器卸载后泄漏**: 组件卸载后 `onclose` 仍可触发重连 timer，创建孤立 WebSocket 连接。现已添加 `unmountedRef` 守卫
- **[H7] ConfirmDialog Enter 键误触发**: document 级 Enter 键监听在 textarea/input 聚焦时也触发 `onConfirm`，导致编辑 prompt 时按 Enter 意外确认删除。现已添加 `e.target.tagName` 守卫
- **[H8] Docker 沙箱输出截断**: `container.wait()` 后未等待 stdout/stderr stream drain，日志可能未完全刷入。现已在 wait 后 await 两个 PassThrough stream 的 `end` 事件

#### Medium 级别修复

- **[M1] WebSocket 无心跳**: 无主动 ping 机制，NAT/防火墙可能静默断开长连接。现已添加 30 秒间隔心跳 ping
- **[M2] Proxy CORS 全放通**: `Access-Control-Allow-Origin: *` 与主后端 localhost-only 策略不一致。现已限制为 localhost 来源
- **[M3] Proxy 无请求体大小限制**: 恶意客户端可发送巨大 payload 耗尽内存。现已添加 10MB 上限
- **[M4] EventEmitter maxListeners 警告**: `agentEvents` 和 `workflowEvents` 未设置上限，10+ 并发工作流触发 Node.js 警告。现已设置 `setMaxListeners(50)`
- **[M5] 工作流引擎 definition null guard**: 数据库存储的 JSON 畸形时 `executeWorkflow` 抛出 TypeError。现已添加前置校验并标记运行失败
- **[M6] SessionDrawer 删除计数不准**: 部分删除失败时 `total` 仍减去全部 ids 数量。现已改为基于实际剩余列表计算，失败时刷新列表
- **[M7] Timeline 动画延迟无上限**: `animationDelay` 使用渲染位置索引，大列表时延迟过长。现已 clamp 到最多 20 项

#### Tests

- 测试总数从 `509` 增至 `519`
- 后端新增 sessionStore 原子删除测试、租户隔离删除测试、批量删除上限测试
- 前端新增 edge id 唯一标识测试、`ensureEdgeIds`/`syncEdgeIdCounter` 测试、id 匹配优先级测试

### Session 级工作空间隔离

#### Changed

- **Per-session workspace**: 每个 Agent session 现在在独立的 `workspace/sessions/{sessionId}/` 目录中运行，不同 session 创建的文件互不干扰。启动时自动创建目录并从 workspace 根复制 `CLAUDE.md` 行为约束
- **Session 删除**: 新增 `DELETE /api/sessions/:id` API 和前端删除按钮（hover 显示垃圾桶图标），删除 session 及其所有事件
- **Cmd/Ctrl+Enter 提交**: ChatInput 从 Enter 提交改为 Cmd+Enter (Mac) / Ctrl+Enter (Windows)，纯 Enter 现在插入换行，支持多行输入
- **Workflow 删除**: Workflow 列表每项新增 hover 删除按钮，调用已有的 `DELETE /api/workflows/:id` API
- **批量选择/删除 (Session & Workflow)**: 两个列表均支持 checkbox 勾选、Select All、BatchDelete；后端新增 `POST /api/sessions/batch-delete` 和 `POST /api/workflows/batch-delete`
- **自定义确认弹窗 (ConfirmDialog)**: 替换浏览器原生 `window.confirm`，采用平台主题风格（暗色毛玻璃 + 动画），支持 Escape/Enter 快捷键

### Agent 生命周期修复与第三方 LLM 适配

#### Fixed

- **Agent Stop 按钮失效**: `stopAgent()` 使用 `stream.return()` 无法中断 SDK 内部 API 重试循环，导致点击 Stop 后 Agent 始终显示 "Agent is working"；改用 `AbortController.abort()` 实现可靠中止，同时在 WebSocket stop handler 中立即向前端发送 `{ type: 'done', status: 'stopped' }` 确认消息
- **第三方模型名不匹配**: `buildBaseOptions()` 未向 SDK 传递 `model` 参数，SDK 使用内置默认模型名（如 `claude-sonnet-4-20250514`），与第三方代理注册的模型名不一致导致 API 报错无限重试；现已从 `config.llm.model` 读取并传入
- **Proxy 诊断日志**: 为 Anthropic→OpenAI 翻译代理新增请求级日志，输出 model、stream、消息数、tools 数量及 payload 大小，便于定位第三方 API 超时/错误
- **ESLint `AbortController` 全局声明**: 补充 Node.js 18+ 内置全局 `AbortController` 到 ESLint globals，消除误报

### Context Payload 深度优化（减少第三方 API Token 消耗）

#### Changed

- **精确内置工具选择**: 从 `preset: 'claude_code'`（全部 ~24 个内置工具）切换为 `tools: string[]` 模式，核心工具 11 个始终加载，6 个可选工具组（notebook、cron、worktree、plan、remote、skill）按 prompt 关键词动态挂载
- **严格 MCP 路由**: 无关键词匹配的 MCP server 不再默认挂载，只在 prompt 命中关键词时加载；MCP 关键词列表扩展为中英双语覆盖
- **System Prompt 动态压缩（Proxy 层）**: 拦截 SDK 内置的 ~60KB system prompt，提取 AgentBoard 追加的安全/效率/Web 访问指令，与精简基础 prompt 组合，压缩至 ~2KB；通过 `COMPRESS_SYSTEM_PROMPT` 环境变量控制开关（默认开启）
- **Thinking Block 剥离**: 停止将 SDK 的 thinking 块转发到第三方 API，节省每轮 500-2000 context tokens
- **Tool Schema 压缩**: Proxy 层截断超过 300 字符的 tool description，减少 ~3-5KB payload
- **Effort Level 控制**: 新增 `LLM_EFFORT` 环境变量（low/medium/high），控制模型思考深度与输出 token 消耗

#### Tests

- 测试总数从 `320` 增至 `322`
- 新增 MCP 严格路由模式测试、中文关键词匹配测试
- 更新 thinking block 测试为 strip 验证

### 多租户鉴权透传与 Workflow 分支闭环修复

#### Fixed

- **GitHub Actions / npm ci 恢复**: 修复后端依赖锁定到 npm registry 不可下载版本 `@anthropic-ai/claude-agent-sdk@0.2.88` 导致 CI 在 `backend/npm ci` 阶段 404 失败的问题；现已将后端依赖和锁文件切回 registry 可用的稳定版本 `0.2.87`
- **前后端鉴权透传补齐**: 新增前端 `clientAuth` 协议层，统一为 REST 请求注入 `Authorization` / `x-user-id`，并为 WebSocket 自动附加 `token` / `user_id` 查询参数；修复设置 `AGENTBOARD_API_KEY` 后前端历史加载、workflow CRUD、workflow run 与 session 恢复链路失效的问题
- **Session / Workflow ownership 校验**: 后端在 REST 和 WebSocket 两侧为 `subscribe`、`follow_up`、`stop`、`control`、`abort`、`subscribe_workflow` 增加 tenant 归属校验，阻断跨用户操作他人 session/run 的漏洞；`/api/status` 与 `/api/workflow-status` 仅返回当前用户的活跃资源
- **`x-user-id` / `user_id` 输入清洗**: 新增统一的 user id 规范化逻辑，拒绝非法 tenant 标识，避免路径逃逸样式的用户 ID 落入运行态或数据库查询
- **Claude Agent SDK 启动环境修复**: 修复受限 PATH 下 SDK 误报 `Claude Code executable not found` 的问题；Agent 运行环境现显式使用 `process.execPath` 启动 SDK 与本地 MCP，并将当前 Node bin 目录注入受控 PATH，保证 `node` / `npx` 型子进程在 Homebrew 等安装路径下也能启动
- **Workflow Condition UI 真正可用**: Workflow 编辑器新增 edge 级配置面板，支持为 condition 节点的出边设置 `true` / `false` 分支标签；新建条件边时自动补首条 `true`、第二条 `false` 的默认分支，后端同步限制只有 condition 节点允许携带 edge condition
- **Workflow 安全预订阅恢复**: `subscribe_workflow` 新增 `workflowId` 预订阅通道，在保留 ownership 校验的前提下继续支持“先订阅再创建 run”，避免首次执行时丢失早期事件
- **Workflow `/run` 请求校验**: 为 workflow 启动请求新增 Zod schema，校验 `runId` 与 `context` 结构，补齐这一条 API 的输入防线

#### Tests

- 测试总数从 `480` 增至 `507`
- 后端新增 user id 规范化、ownership 拦截、workflow run 请求校验、condition edge 约束等回归测试
- 后端新增 SDK 运行时 PATH / 可执行路径回归测试，锁住 Homebrew / 非系统 Node 安装场景
- 前端新增 `clientAuth` 协议层测试与 `workflowEdgeUtils` 条件分支默认值/更新逻辑测试

### 全量缺陷审计修复 (Full Codebase Bug Audit Fix) -- 16 项

#### Critical 安全与数据完整性修复

- **[C1] MCP 子进程沙箱路径泄漏**: `nativeMcpServer.js` 使用 `process.env.HOME` 作为 `userWorkspace`，实际解析为宿主机真实 HOME 目录。现已通过 CLI arg[4] 从 `agentManager.js` 显式传入隔离工作区路径
- **[C2] 双 SQLite 连接竞态与关闭泄漏**: `memoryStore.js` 与 `sessionStore.js` 共用同一个 `agentboard.db` 文件的两个独立连接，shutdown 时 memoryStore 连接未关闭。现已将 memoryStore 迁移至独立的 `agentboard-memory.db`，并导出 `closeMemoryDb()` 在 shutdown 时调用
- **[C3] 工作流 abort 后 Promise 永不 settle**: `runAgentNode` 的 Promise 在 SDK 不发出 `done` 事件时永远挂起。新增 10 分钟安全超时和 `settled` 标志位，确保 abort 场景下 Promise 必定 reject

#### Major 后端修复

- **[M1] `continueAgent` TOCTOU 竞态**: `activeAgents.has()` 检查与 `activeAgents.set()` 之间存在间隙，两个快速 `follow_up` 可对同一 session 启动两个 SDK stream。现已在 guard 通过后立即占位
- **[M2] `workflowStore` 全量 DB 操作无错误处理**: 所有写操作无 try/catch，SQLite 异常导致请求挂起。现已为所有写操作添加 try/catch + 日志
- **[M3] 子代理工具 EventEmitter 监听器泄漏**: `TaskCreateTool`/`BatchTool`/`LoopTool` 的事件监听器在父 agent 停止后永远不会移除。新增 10 分钟超时自动清理
- **[M4] Proxy 流式中断崩溃进程**: 上游断连后对已发送 header 的响应调用 `res.writeHead(502)` 触发 `ERR_HTTP_HEADERS_SENT`。现已检查 `res.headersSent` 并改为发送 SSE error 事件

#### Major 前端修复

- **[F1] 画边时未防御空 position**: `WorkflowEditor` 临时边绘制中 `from.position.x` 未做 fallback，节点缺失 position 时崩溃
- **[F2] `crypto.randomUUID` 非安全上下文不可用**: 非 HTTPS 部署下所有 workflow 运行静默失败。新增 Math.random UUID v4 降级方案
- **[F3] 空节点 workflow 退回列表视图**: 加载 nodes 为空数组的 workflow 时误判为列表视图。改用 `isEditing` 状态标志替代 `nodes.length` 检测
- **[F4] SessionDrawer 未检查响应状态**: `fetchSessions` 在 `res.ok` 为 false 时直接调用 `.json()` 可能抛异常

#### 前后端联动修复

- **[I1] `session_resumed` 未同步 sessionId**: 续接对话后 `sessionIdRef` 和 `setSessionId` 未更新，导致后续操作可能使用旧 session
- **[I2] `cache_read_tokens` 数据管道缺失**: 从 `agentManager` 到 `useWebSocket` 到 `ContextPanel`，缓存命中 token 从未提取和传递
- **[I3] 未处理 `run_start`/`agent_started` 事件**: 后端发出但前端丢弃，现已添加处理逻辑
- **[I4] `saveWorkflow` PUT 分支未检查 `res.ok`**: 保存失败仍返回 workflow ID 触发执行
- **[I5] WebSocket 连接不携带认证 token**: 设置 `AGENTBOARD_API_KEY` 后 WS 连接被拒绝。前端现从 URL 参数或 `localStorage` 读取 token 并附加到 WS URL

#### 测试

- 测试用例从 473 增至 480，新增 `session_resumed` ref 同步、`cache_read_tokens` 管道、`closeMemoryDb` 导出、workflowStore 错误处理等回归测试
- 修复 `useWebSocket.test.jsx` 测试环境: 添加 `@vitest-environment jsdom` 注释 + `localStorage` mock + 根级 `jsdom` 依赖，使 `npx vitest run` 从根目录运行时也能通过
- `useWebSocket.js` 将模块顶层 `window.location` 访问延迟至函数调用时（`getWsUrl()`），避免非浏览器环境加载时崩溃

### 企业级核心重构 & 零信任架构 (Enterprise Core & Zero-Trust Architecture)

- **多租户 SaaS 隔离架构**: 实现了底层数据库结构的彻底隔离。`sessionStore.js` 和 `workflowStore.js` 现已将 `user_id` 作为硬分区主键，强制实施在 `sessions`, `events`, `workflows` 和 `workflow_runs` 表上。
- **AgentBoard 原生 MCP 服务器**: 引入了一个作为子进程运行的 `@modelcontextprotocol/sdk` 代理中介 (`nativeMcpServer.js`)，该服务器负责向模型注入高阶原生 JavaScript 工具，彻底绕过官方 Claude Agent SDK 封闭环境的整合限制。
- **零信任 Docker 沙盒 (`REPLTool.js`)**: 现已将所有的实时 Node.js 与 Python 脚本评估和执行强迁至极度受限的临时容器内执行。容器具备零网络模式 (`NetworkMode: none`)、极其严格的 256MB 内存上限、限制 50 个 PID 防止叉形炸弹 (Fork-Bomb)，以及排他性的单一租户目录挂载（`binds` 严格绑定到当前的 `user_id` 工作区）。
- **原生衍生子代理系统 (`TaskCreateTool.js`)**: 主代理现可自主分派、在后台完全隔离的 SQL 会话中并发拉起独立的 Agent SDK 计算包，以便在不污染母体上下文视窗的前提下处理重度泛读或复杂分析计算逻辑。
- **批处理与循环调度引擎 (`BatchTool.js` & `LoopTool.js`)**: 原生中继能力组件。允许作为主控节点的大模型通过映射一批件或一组意图指令，从而并发拉起最多 10 个子代理集群异步或顺序处理流水线作业。
- **记忆化长期持久层库 (`memoryStore.js`)**: 自研定制化的、按用户分区围栏的 SQLite 知识图谱数据库系统（通过 `RememberTool` 和 `RecallTool`），彻底抛弃并替换掉存在跨租户数据泄露致命缺陷的官方系统内置 MCP 记忆节点。
- **动态用户工作域初始化**: 废除并清除了 `agentManager.js` 内涉及全局单例模式的死锁 `const WORKSPACE` 常量，将 LLM 的操作视图动态挂载于用户独有的隔离云盘层上。

### 安全更新 (Security Fixes)

- **[Critical] 杜绝跨租户记忆泄漏污染**: 移除了含有重大越权和泄漏隐患的官方 `server-memory` 系统级 MCP 节点。替之以更安全的由 `user_id` 强隔离的 `memoryStore.js`。
- **[Critical] Host-RCE 主机提权防御缓解**: 删除了易受突破的宿主机原生的 Bash/脚本评估解释能力插件，强制转交具备路径围墙与断网策略的隔离沙箱容器代行解析，以此抵御任何绕开围栏发起对母机环境渗透的 RCE（远程代码执行）攻击。

### Docs

- **全面消除文档漂移 (Zero Documentation Drift)**: 发起“文档全景治理”行动，校准了四大核心文件以匹配当前的实际项目状态：
  - `README.md`: 摒弃早期单阶段说明，全面升格为“单 Agent 与 DAG Workflow 双引擎平台”的介绍，补充了通配型 OpenAI API 热插拔能力、自适应双模式 UI 主题与 API 层级的门禁机制。
  - `ARCHITECTURE.md`: 将架构文档从 `docs/` 提升至根目录，详尽补齐了 `workflowEngine.js` 拓扑流转逻辑、中间件层、双 SQLite 数据引擎与前端 RightPanel 拆分树。
  - `ONBOARDING.md` (全新): 新人五分钟中文速通指南，解析环境配置、依赖安装及双模式的初步操作流程。
  - `CONTRIBUTING.md` (全新): 树立提交质量护城河，确立以 `npm run check` 拦截链（Prettier + ESLint + Build）与 `Vitest` 自动化断言规则为主的工程化迭代原则。

### Added

- **完全态动态意图路由 (Dynamic Orchestrator)**: 从硬编码装载器全面重构为基于上下文环境感知的动态能力挂载中间件：
  - **Dynamic Registry (`registry.js`)**: 平台级服务自动扫描解析插件目录下的 `SKILL.md` (解析 YAML Frontmatter 中的 `whenToUse`、`allowed-tools` 等语义元数据)。
  - **Context Router (`router.js`)**: 在 Agent SDK 启动前自动截获 Prompt 意图，利用正则匹配、关键字与工作区活跃路径过滤无关 MCP/Skills，将 Agent 所能接触到的能力池收束到最简集合，彻底消除“大乱炖”导致的 Token 浪费及弱模型幻觉问题。
  - **Remote MCP Support**: Config 架构大幅度解耦，允许随时通过注入环境变量（如 `MCP_BROWSER_ENDPOINT`）拉起基于 SSE/WS 协议连接远程分布式的服务器集群。

### Fixed

- **环境变量断连陷阱**: 修复 `backend/config.js` 未正确提取 `.env.local` 中 `PROXY_PORT` 导致的代理服务隔离问题；修复 `frontend/vite.config.js` 硬编码 `3001` 的问题，通过 `loadEnv` 动态跨目录侦测 `PORT` 变量，实现全盘端口号参数的自动化对齐
- **[Critical] CORS + WebSocket 跨源防护**: HTTP CORS 继续使用 localhost allowlist；WebSocket 单独改为 `isAllowedWebSocketOrigin()`，必须带显式浏览器 `Origin` 且命中 localhost 白名单，修复了未设置 `AGENTBOARD_API_KEY` 时 raw WS 客户端通过缺失 `Origin` 头绕过鉴权的问题；启动时无 key 打印更准确的安全警告
- **[Critical] 沙箱白名单路径围栏**: `env.HOME` 指向 WORKSPACE，`PATH` 限制为 `/usr/local/bin:/usr/bin:/bin`；hooks 从纯黑名单升级为双层防护 -- 保留危险命令黑名单，同时新增绝对路径提取与白名单围栏，命令里所有绝对路径都会检查是否位于 workspace 内，仅放行 `/usr/local/bin`、`/usr/bin`、`/bin`、`/dev`、`/tmp`，从而拦截 `sed`/`awk`/`perl` 等通过绝对路径读取宿主机文件的绕过方式
- **[Major] 条件分支跳过 join 汇合节点**: `markDescendantsSkipped` 递归标记后代时需排除触发 skip 的条件节点自身的出边（`skipSourceId` 参数），否则条件节点已 executed 的入边永远阻止目标被 skip，导致两条分支都执行；`allIncomingSatisfied` 改为 resolved 语义（executed 或 skipped 均算已处理），但至少需要一条 executed 入边
- **[Major] WorkflowEditor 首次 Run 空操作**: `saveWorkflow()` 返回 id，`runWorkflow` 直接用返回值而非闭包旧值
- **[Major] 节点 ID 冲突**: `loadWorkflow` 解析已有节点 ID 的最大数字并同步 `nextId` 计数器
- **[Major] 前端 REST 硬编码 :3001**: 三处 `API_BASE` 改为相对路径 `''` 走 Vite proxy
- **[Major] Workflow 事件广播串台 + 订阅竞态**: 改回按 `runId` 精确订阅，后端 workflow 广播只投递给订阅对应 `runId` 的连接，避免同一 workflow 的并发运行或多页面互相串台；前端在执行前先生成 `runId`、通过 WebSocket 订阅并等待 `workflow_subscribed` ack，再调用 `/run` 启动执行，彻底消除首次运行时短流程事件先于订阅到达的竞态
- **[Major] abortWorkflow 不取消运行中 agent**: `activeRuns` 追踪当前 agent sessionId，abort 时调用 `stopAgent()` 触发 done 事件，由 `runAgentNode` 的 listener 自然 resolve/reject 并 cleanup（不再手动 off listener 避免 promise 悬挂）
- **[Major] WorkflowEditor 节点坐标越界崩溃**: 修复因底层数据库混入测试脏数据（缺失 `position` 坐标字段）导致的渲染报错，利用防御性容错逻辑赋予默认坐标（x:0, y:0），避免React 组件由于 undefined 异常而导致的白屏崩溃

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
