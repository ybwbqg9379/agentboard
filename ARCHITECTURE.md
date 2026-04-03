# AgentBoard Architecture

> Agent SDK: [@anthropic-ai/claude-agent-sdk](https://github.com/anthropics/claude-agent-sdk-typescript) (TypeScript)

## 系统架构

AgentBoard 已演进为支持**单 Agent 对话**、**多 Agent DAG 协作**与**基准驱动自动化实验 (AutoResearch)** 的三模式架构引擎。

```text
+-------------------------------------------------+       +---------------------------------------------+
| Browser (Vite + React SPA)                      |       | Node.js Backend (Express + WS :3001)        |
|                                                 |       |                                             |
| [Header] (Mode: Agent / Workflow / Experiment)  | REST  | +-----------------+    +------------------+ |
|                                                 | <---> | | Zod Auth/Valid  |    | workflowEngine.js| |
| +-------------------+ +-----------------------+ |  WS   | +--------+--------+    +---------+--------+ |
| |   MainContent     | |     RightPanel        | | <---> |          |                       |          |
| | - Timeline/Chat   | | - Terminal / Context  | |       | +--------v--------+    +---------v--------+ |
| | - WorkflowEditor  | | - Files               | |       | | agentManager.js |    | experimentEngine | |
| | - ExperimentView  | |                       | |       | +--------+--------+    +------------------+ |
| +-------------------+ +-----------------------+ |       | +----------|----------------------------------+
+-------------------------------------------------+       +----------|----------------------------------+
                                                                     |
                               +-------------------+                 | (Claude Agent SDK async iter)
                               | Remote Supabase   |                 |
                               | PostgreSQL (HTTPS)| <---------------+
                               | RLS + FK cascade  |                 |      +---------------------+
                               +-------------------+                 |      | MCP Servers (Core)  |
                                                                     +----> | filesystem/playwright|
                                                                     |      | memory/github       |
                                                                     |      +---------------------+
                                                                     |      | MCP Servers (Search) |
                                                                     +----> | tavily/exa/brave    |
                                                                     |      +---------------------+
                                                                     |      | MCP Servers (Crawl)  |
                                                                     +----> | firecrawl/fetch/jina |
                                                                     +----> | agentboard_native   |
+-------------------------------+                                    |      | (Batch/Loop/REPL)   |
| Any OpenAI-Compatible LLM     |                                    |      +---------------------+
| (Cloud: OpenAI, DeepSeek, etc)|      |                             |
+-------------------------------+      |  OpenAI Chat Completions    | Anthropic Messages API
                               +-------+--------+                    |
                               |    proxy.js    | <------------------+
                               |    (:4000)     |
                               +----------------+
```

## 核心数据流

### 1. Agent 模式交互流

1. 用户在浏览器输入任务 (`Browser → WebSocket → { action: "start", prompt: "..." }`)
2. 请求进入 Express 中间件，被 Zod Schema 和 API Key 拦截器校验。
3. `server.js` 移交 `agentManager.js` 创建 `sessionId`。
4. 调用 Agent SDK，经过 `proxy.js` 将 Anthropic 格式转译为通用的 OpenAI 格式以调用远端 LLM。Proxy 层同时执行 System Prompt 压缩（60KB→3KB）、Thinking Block 剥离、Tool Schema 截断等优化。
5. SDK 产出 `SDKMessage` 事件流，由 `hooks` 进行截获处理（过滤高危 bash 路径，记录 MCP Token 耗时等）。
6. 事件异步写入 Supabase PostgreSQL (sessions / events 表)，并通过 WebSocket 广播给前端。每个 Session 的文件操作限制在 `workspace/sessions/{sessionId}/` 独立目录中。

### 2. Workflow 工作流引擎渲染流

1. 用户在 `WorkflowEditor` 拖拽连线生成 `nodes` 和 `edges` 的 JSON DAG，REST `/api/workflows` 将其存入 Supabase PostgreSQL。
2. 触发执行 `POST /run`，`workflowEngine.js` 锁定执行。
3. `workflowEngine.js` 对所有节点执行**拓扑排序 (Topological Sort)** 以决定依赖顺序。
4. 节点开始流水线流转：
   - **`agent` 节点**：将模版变量 `{{var}}` 替换后，指派为匿名的子代理交给 `agentManager.js` 执行。
   - **`experiment` 节点**：创建独立的执行沙箱，启动 `experimentEngine` 执行从基线测试、多轮打分到结果 Ratchet 收敛的实验闭环，结束后注入提炼变量。
   - **`condition` 节点**：运算上下文表达式（`key == value`, `key > N`）。运算失败的后继节点会被执行引擎递归打上 `skipped` 标签并跳过。
   - **`transform` / `input` / `output` 节点**：纯函数变换，汇聚或修改执行上下文 `context`。
5. 前后端通过 WS 的 `node_start` / `node_complete` 以及实时脉冲动画协同，呈现可视化 DAG 构建状态。

### 3. Experiment 自动化研究引擎 (AutoResearch)

1. 用指定的配置 (ResearchPlan，例如目标文件白名单、测评主命令等) 在前端发起一轮 Experiment Run。
2. `experimentEngine.js` 开始执行 **Ratchet Loop**:
   - `Modify`: 代理分析日志和当前指标，对代码提出一项假说修改，并在本地隔离的 host (`workspace/sessions/...`) 环境写入。
   - `Execute & Measure`: 以**异步、可中断**的方式执行 baseline / guard / benchmark 命令 (如 `npm test`)，通过 `metricExtractor.js` 解析命令行输出 (regex/JSON_path)。命令运行期间后端事件循环保持可响应，因此 `/abort` 可以在测评中途立即生效；在 Unix/macOS 上实验命令以独立进程组运行，abort/timeout 会终止整个进程组，避免 worker 残留。
   - `Judge & Commit`: 若修改通过了 guard 指标、并且主要 metric 有提升，则通过本地 git 命令执行 `git commit` (Accept)，否则撤销修改 (Reject)。
3. 在连续 Reject 阈值耗尽或者指标达到最大收敛后，得出稳定的调优变体，向客户端下发最终的 `diff` 或结束通知。

### 4. Research Swarm 多 Agent 并行研究编排 (P3)

1. 用户在 ExperimentView 点击 "Run as Swarm"，发起 `POST /api/experiments/:id/swarm`，可覆盖 `branches`/`branch_budget`/`top_k` 参数。
2. 后端调用 `prepareWorkspace()` 初始化 baseline workspace（mkdir + copy source + git init），再将任务交给 `researchSwarm.js`。
3. **Phase 1 (Decompose)**：Coordinator Agent 接收 ResearchPlan，生成 N 个不重叠的研究假说（通过 `<hypothesis>` XML 标签结构化输出）。若 Coordinator 不可用或超时，自动降级为模板化假说生成。
4. **Phase 2 (Branch)**：N 个 Worker 并行运行，每个 Branch：
   - 使用 `git clone --local --no-hardlinks` 创建独立 workspace 副本
   - 注入 `BRANCH_PORT = 14000 + branchIndex` 到 `CLAUDE.md` 和 `process.env`（finally 清理）
   - 调用 `createRun()` 创建真实 `experiment_runs` 记录
   - 调用 P1 `runExperimentLoop()` 执行 Ratchet Loop；通过 `abortExperiment(branchRunId)` 桥接中止信号
5. **Phase 3 (Synthesize)**：Coordinator 综合各 Branch 的 `bestMetric`/`totalTrials`/`acceptedTrials`，通过 `<selected_branch>` + `<reasoning>` 输出选择决策。启发式兜底：按 `minimize`/`maximize` 方向选最优指标。
6. **Phase 4 (Merge)**：最优 Branch workspace 通过 `rsync` 合并回主 workspace（`spawnSync` 参数数组防注入），rejected branches 清理。顶层 run 更新为 `completed`/`failed` 并写入聚合指标。
7. 前端通过 8 种 `swarm` 类型 WS 事件实时展示：Coordinator 状态行 → 假说列表 → Branch 卡片网格 → 选择理由。`loadSwarmBranches()` 支持历史 run 的 Branch 状态恢复。

## 模块职责

### Backend

| **模块**                      | **文件**                                                                                                    | **职责**                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **API与鉴权**                 | `server.js` / `http/createApp.js` / `http/routes/*` / `websocket/registerAgentBoardWs.js` / `middleware.js` | 进程入口 `server.js`：`createApp()` 挂载 REST（按域拆分至 `http/routes`），`registerAgentBoardWebSocket` 注册 `/ws` 与事件桥；`middleware` 负责 CORS、鉴权、Zod 校验。                                                                                                                                                                                           |
| **意图路由编排**              | `registry.js` / `router.js`                                                                                 | 双通意图分类引擎：Pass 1 — 正则意图模式（web-research / web-scraping / url-reading / data-analysis）多命中评分；Pass 2 — 按类别（search / crawl / core）批量共激活对应 MCP 服务器组与 Skill，取代逐关键词单点匹配。                                                                                                                                              |
| **搜索/爬取 MCP 层**          | `mcpConfig.js` (Search/Crawl tier)                                                                          | 6 个条件加载的 MCP Server：搜索引擎 (Tavily / Exa / Brave Search)、爬取器 (Firecrawl / Fetch / Jina Reader)。API Key 存在时激活，不存在时静默跳过。Jina Reader 使用 SSE 远程传输。                                                                                                                                                                               |
| **自愈拦截引擎**              | `schemaValidator.js` / `hooks.js`                                                                           | **(Harness Engineering)** 搭载本地 Zod Schema 强校验网关闭环屏蔽模型传参幻觉；配备 Semantic Loop Watchdog。当系统检测到模型深陷“重试死循环”（连续多次 ToolHash 碰撞对应出错）时，Harness 免人类介入、自发下达 `<harness_override>` 破壁指令，底层设 Circuit Breaker 异常熔断。                                                                                   |
| **实验与评测 (AutoResearch)** | `experimentEngine.js` / `metricExtractor.js`                                                                | 新增的核心实验引擎。在 host 环境内基于白名单创建临时隔离 `workspace`，内部执行带状态恢复机制 (Git Ratchet) 的 "提议-度量-回滚/提交" 循环打分流程。baseline / guard / benchmark 采用异步可中断执行，避免长命令阻塞服务主线程；对会派生 worker 的命令，abort/timeout 会按进程组清理整个命令树。支持直接正则/解析提取命令行输出指标，自动向 WS 事件总线广播演进度。 |
| **研究 Swarm (P3)**           | `researchSwarm.js` / `swarmStore.js`                                                                        | Coordinator/Worker 并行研究编排器。Coordinator 拆解假说、综合选优；Worker 并行跑 P1 Ratchet Loop；Branch 隔离（git clone + PORT）；`spawnSync` 防注入；abort 桥接；状态/指标回写。`swarmStore` 使用共享 Supabase 客户端直接访问数据库。                                                                                                                          |
| **安全沙箱**                  | `hooks.js` / `dockerSandbox.js`                                                                             | `PreToolUse` Bash双层围栏防穿透。执行 Python/Node 代码时，引擎自动下卷分配基于 `dockerode` 的无网络零信任按需生成容器，完全隔离宿主机并施加 256MB/50 PIDs 的熔断保护。                                                                                                                                                                                           |
| **微服务器组**                | `nativeMcpServer.js`                                                                                        | 基于官方 `@modelcontextprotocol/sdk` 实现的后端驻留子进程，向模型动态注册高级中间件原生工具 (如 `TaskCreateTool` 分发子代理、`BatchTool`、`LoopTool` 并发调度与多维执行)。                                                                                                                                                                                       |
| **持久层**                    | `*Store.js`（session / workflow / experiment / swarm / memory）                                             | **远程** Supabase 托管 PostgreSQL：后端仅通过 `@supabase/supabase-js` 经 HTTPS 访问云端实例，**无本地 SQLite/嵌入式数据库文件**。11+ 张表 JSONB、FK 级联、RLS；每次读写均为网络往返，批量路由应避免 per-id 循环查询。                                                                                                                                            |

### Frontend

| 模块          | 文件                            | 职责                                                                                                                                                      |
| ------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **状态总线**  | `useWebSocket.js`               | 管理 WS 长连接，5态生命周期重连，提供全局状态的 hook 发布/订阅。                                                                                          |
| **主展板**    | `AgentTimeline.jsx`             | 将高嵌套维度的 SDK block 扁平化渲染为思考链（思维气泡）、执行链（终端）、报错链。                                                                         |
| **控制台**    | `ChatInput / Header`            | `Agent` / `Workflow` / `Experiment` 三模式切换；Dark / Light 主题切换。Cmd/Ctrl+Enter 提交。                                                              |
| **数据解剖**  | `RightPanel.jsx`                | 3个子Tab管理：提炼 Bash 终端纯净流 (`Terminal`)、模型吞吐统计及价格核算 (`Context`)、文件编辑/读取频次统计监控 (`Files`)。                                |
| **拓扑编辑**  | `WorkflowEditor.jsx`            | SVG 矩阵级画布编辑环境，支持将 `experiment` 节点编织入子 DAG 并配置属性。交互层支持批量选择/删除及自动寻径渲染。                                          |
| **实验面板**  | `ExperimentView.jsx`            | 实时实验透视台，具备并排的双联显示：左侧是 `experiments` 模板的动态 JSON 编辑修改区；右侧是流式获取后台子试验 (Trials) 数据指标刷新的监控仪表盘及进度图。 |
| **通用组件**  | `ConfirmDialog.jsx`             | 自定义主题确认弹窗，替代浏览器原生 `window.confirm`，支持 Esc/Enter 快捷键。                                                                              |
| **HTTP 封装** | `apiFetch.js` / `clientAuth.js` | 浏览器侧 REST 统一走 `apiFetch`（合并 Bearer + `x-user-id` 与默认超时）；鉴权头与 WS Query 仍由 `clientAuth` / `buildWsUrl` 提供。                        |

### 环境与 HTTP 健壮性约定（增量）

| 项目             | 说明                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **启动 env**     | `backend/env.js` 在 `config.js` 加载时对 `PORT`、`AGENT_TIMEOUT` 做 Zod 校验，非法即退出。                                                                                                                                                                                                              |
| **请求 ID**      | `requestIdMiddleware`：入站 `x-request-id`（合法则沿用）、否则生成 UUID；写入响应头 `X-Request-Id`。未捕获的 Express 路由错误在生产环境返回通用文案，并附带 **`requestId`** 便于日志关联。                                                                                                              |
| **JSON 上限**    | `express.json({ limit: '2mb' })`。                                                                                                                                                                                                                                                                      |
| **React**        | 根节点由 `ErrorBoundary.jsx` 包裹；`componentDidCatch` 将渲染错误输出到 `console.error`。                                                                                                                                                                                                               |
| **Session 删除** | 单删：先 `stopAgent` 再 `deleteSession`；若删除失败则将行标记为 **`interrupted`** 并返回 `hint`。批量删除：一次查询过滤归属 id、逐 id `stopAgent`、再 **单次** `delete().in(...)`；若删除行数少于归属数，再查仍存在的 id 并批量标 **`interrupted`**。`filterSessionIdsOwned` 返回顺序与入参不一定一致。 |

## 数据库 Schema 设计

系统由 **远程** Supabase 托管的 PostgreSQL 统一承载（单一云端项目，RLS 行级安全）。已与本地 SQLite 存储脱钩：开发/生产均需有效的 `SUPABASE_URL` 与 `SUPABASE_SECRET_KEY`，数据不落盘为应用侧 `.db` 文件。

**访问含义**：所有 Store 的 `select`/`insert`/`delete` 均走公网/专线至 Supabase；高扇出场景（例如按 id 循环 `getSession`）会放大延迟与连接开销，宜改为单条 SQL 批量条件（`in (...)`）或服务端单次 `delete().in(...)`。

### Supabase PostgreSQL

下列 DDL 以 **11 张核心业务表** 为主（另含 memory / swarm 等扩展表，详见 `backend/migrations/`）：

```sql
-- Agent 会话
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  status     TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ,
  stats      JSONB
);

CREATE TABLE events (
  id         BIGSERIAL PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  content    JSONB NOT NULL,
  timestamp  BIGINT NOT NULL
);

-- DAG 工作流
CREATE TABLE workflows (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition  JSONB NOT NULL,        -- 存储完整的 {nodes, edges} 拓扑结构JSON
  created_at  TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ
);

CREATE TABLE workflow_runs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL DEFAULT 'default',
  workflow_id  TEXT NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending',
  context      JSONB DEFAULT '{}',   -- 存储运行时随节点滚动累积的数据字典
  node_results JSONB DEFAULT '{}',   -- 子节点执行完成的 Snapshot
  error        TEXT,
  created_at   TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- 实验评测体系
CREATE TABLE experiments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  description TEXT,
  plan        JSONB NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE experiment_runs (
  id              TEXT PRIMARY KEY,
  experiment_id   TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL DEFAULT 'default',
  status          TEXT NOT NULL DEFAULT 'running',
  best_metric     DOUBLE PRECISION,
  baseline_metric DOUBLE PRECISION,
  total_trials    INTEGER NOT NULL DEFAULT 0,
  accepted_trials INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE trials (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  trial_number     INTEGER NOT NULL,
  accepted         BOOLEAN NOT NULL DEFAULT FALSE,
  primary_metric   DOUBLE PRECISION,
  all_metrics      JSONB,
  diff             TEXT,
  agent_session_id TEXT,
  reason           TEXT,
  duration_ms      INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- P3 Research Swarm
CREATE TABLE swarm_branches (
  id              TEXT    PRIMARY KEY,
  run_id          TEXT    NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  branch_index    INTEGER NOT NULL,
  hypothesis      TEXT    NOT NULL,
  workspace_dir   TEXT    NOT NULL,
  status          TEXT    NOT NULL DEFAULT 'running',  -- running | completed | failed
  best_metric     DOUBLE PRECISION,
  total_trials    INTEGER NOT NULL DEFAULT 0,
  accepted_trials INTEGER NOT NULL DEFAULT 0,
  is_selected     BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE TABLE swarm_coordinator_decisions (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES experiment_runs(id) ON DELETE CASCADE,
  phase            TEXT NOT NULL,         -- 'decompose' | 'synthesize'
  input_summary    TEXT,
  output_raw       TEXT,
  parsed_result    JSONB,
  agent_session_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Memory Knowledge Graph
CREATE TABLE memory_entities (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL,
  content    TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE(user_id, name, type)
);

CREATE TABLE memory_relations (
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL,
  source_entity_name   TEXT NOT NULL,
  target_entity_name   TEXT NOT NULL,
  relation_type        TEXT NOT NULL,
  created_at           BIGINT NOT NULL,
  UNIQUE(user_id, source_entity_name, target_entity_name, relation_type)
);
```

## 安全边界隔离 (Defense-in-Depth)

| **机制**               | **实施详情**                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **网络口令防火墙**     | REST 以及 WebSocket 支持 `AGENTBOARD_API_KEY` 环境变量认证。配置后 REST 要求 `Authorization: Bearer <key>`，WS 要求 `?token=<key>`。未配置时仅依赖 localhost Origin 白名单（开发模式）。各子路由全面注入并审计 `x-user-id`。                                                                                                                                                                                       |
| **Proxy 鉴权**         | 配置 `PROXY_TOKEN` 后，Proxy 验证入站 `x-api-key` 与 token 匹配，防止 agent 进程滥用 LLM API 配额。未配置时 Proxy 接受所有请求（本地开发适用）。Backend 通过 `sdkRuntime.buildAgentEnv` 将 token 注入 SDK 环境。                                                                                                                                                                                                   |
| **Benchmark 命令校验** | 用户提交的 benchmark/guard/secondary 命令经 `BLOCKED_PATTERNS` 校验后，由 `shellSplit()` 解析为 argv 数组，通过 `spawn(cmd, args)` 直接执行，不经过任何 shell 解释器。命令必须使用 allowlisted runner（如 `npm test`、`node scripts/bench.js`）或工作区内可执行文件；`node -e`、`python -c` 这类内联求值形式被拒绝。内部 git 操作命令（受信任）单独走 shell 路径。目录复制使用 `spawnSync` 参数数组 + 返回值检查。 |
| **Store 用户隔离**     | `experimentStore` 和 `sessionStore` 的 update 系列函数均支持可选 `userId` 参数，在 service key 绕过 RLS 模式下仍可按用户过滤，防止跨用户数据篡改。                                                                                                                                                                                                                                                                 |
| **Docker应用级沙盒**   | 所有由模型发起的高级脚本操作 (Node.js 或 Python的 REPL 评价) 全面抛弃主机执行，一律采用按需自动拉起的隔离容器。容器启动带有强制安全域：`NetworkMode: none`（绝对禁止回网），限制内存 (`256MB`)，并且仅映射唯一当前执行用户的云盘存储目录。                                                                                                                                                                         |
| **绝对路径围栏**       | 在 Bash 节点的底层钩子中，针对所有含有路径片段的命令强制剥离验证，仅允许放行白名单区域：`/usr/local/bin`, `/usr/bin`, `/bin`, `/dev`, `/tmp`。`isFilePathAllowed` 对空/无效输入默认拒绝（deny-by-default）。`rm -rf` 全面拦截（含相对路径），`cd ..` 覆盖无斜杠形式。                                                                                                                                              |
| **环境变量遮蔽**       | 以隔离租户的作用域传参 Spawn 辅助线程，伪装了 `HOME` 与特定 CWD。完全隔绝 Agent 对宿主机内核及系统环境变量的窥探。                                                                                                                                                                                                                                                                                                 |

## 网络搜索与爬取架构

AgentBoard 的 MCP 服务器分为三个层级（Tier），由意图路由引擎按需激活：

```text
┌─────────────────────────────────────────────────────────────────────┐
│                        Intent Router (router.js)                   │
│   Pass 1: 正则意图分类 → Pass 2: 类别共激活                        │
└────────┬────────────────────┬──────────────────────┬───────────────┘
         │                    │                      │
    ┌────▼────┐         ┌────▼────┐           ┌─────▼─────┐
    │  Core   │         │ Search  │           │   Crawl   │
    │ (5 MCP) │         │ (3 MCP) │           │  (3 MCP)  │
    ├─────────┤         ├─────────┤           ├───────────┤
    │filesys  │         │ tavily  │           │ firecrawl │
    │memory   │         │ exa     │           │ fetch     │
    │browser  │         │ brave   │           │ jina      │
    │github   │         └─────────┘           └───────────┘
    │seq-think│
    └─────────┘
```

### 编排 Skill 流水线

两个高阶 Skill 定义了标准化的数据获取流程：

- **`web-research`**: 搜索 → 爬取 → 分析 → 持久化（适合研究类任务）
- **`data-extraction`**: 定位 → 提取 → 验证 → 导出（适合结构化数据采集）

Skill 内部通过工具选择矩阵自动判断最佳工具组合，例如：学术研究优先 Exa、新闻搜索优先 Tavily、页面阅读优先 Jina Reader、批量爬取优先 Firecrawl。

## 自动化测试（Vitest）

- **运行方式**：仓库根目录执行 `npm run test`（或分别 `backend` / `frontend` 下 `npx vitest run`）。
- **覆盖率**：根目录 `npm run test:coverage` 启用 **V8** 覆盖率（`@vitest/coverage-v8`），输出终端摘要与 `json-summary`，HTML 报告在 `backend/coverage/index.html`、`frontend/coverage/index.html`（目录已忽略于 Git）。
- **覆盖重点**：`workflowEngine` 校验与条件求值、`agentManager` 与工具选择、HTTP `server` 关键路由（会话增删、工作流 CRUD/run、实验列表与模板、Swarm 端点等，依赖 Store/引擎 mock）、`proxy` 协议转换、`dockerSandbox` / Native MCP 等行为（Docker 与 SDK 在测试中桩替换）。
- **后端集成测试执行方式**：`backend/vitest.config.js` 中 **`fileParallelism: false`**（按测试文件串行）。多份 `server*.test.js` 各自 `vi.mock` 后导入共享的 `server.js` 单例时，若多文件并行会与模块缓存打架，导致偶发错状态码；串行可稳定复现与门禁结果。
- **数量与规范**：当前用例规模与门禁约定见根目录 `README.md` 与 `CONTRIBUTING.md`；发版记录见 `CHANGELOG.md`。

## 设计哲学

| 决策点         | 演进结果说明                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **API 解耦化** | 完全扬弃了早期强绑定某些国产厂商的设计。引入 `proxy.js` 实现 100% 遵守 Anthropic -> OpenAI 接口映射规范，极大增强了系统模型供应的健壮性。 |
| **CSS 变量化** | 利用原生的 CSS Variables 取代散碎的类名定义，通过单表 `index.css` 控制所有的视觉颜色。零依赖实现 Light/Dark 双色系统切换。                |
| **DAG 自研化** | 并未引入厚重的 xstate / Temporal，而是自研极简高效的纯异步拓扑排序引擎。极大减轻了前后端同构开发的理解负荷。                              |
| **MCP 层级化** | 搜索/爬取 MCP 不走全量装载，通过意图路由按需激活对应层级，避免 Token 浪费。API Key 缺失时静默跳过，保证零配置可启动。                     |
