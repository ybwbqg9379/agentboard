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
                               +----------------+                    | (Claude Agent SDK async iter)
                               |  SQLite DBs    |                    |
                               |  - agentboard  | <------------------+
                               |  - workflows   |                    |      +---------------------+
                               |  - memoryStore |                    |      | MCP Servers (Core)  |
                               +----------------+                    +----> | filesystem/playwright|
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
6. 事件同步写入 SQLite (sessions / events 表)，并通过 WebSocket 广播给前端。每个 Session 的文件操作限制在 `workspace/sessions/{sessionId}/` 独立目录中。

### 2. Workflow 工作流引擎渲染流

1. 用户在 `WorkflowEditor` 拖拽连线生成 `nodes` 和 `edges` 的 JSON DAG，REST `/api/workflows` 将其存入 `workflows.db`。
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
   - `Execute & Measure`: 拦截调用基准测试 (如 `npm mix tests`)、通过 `metricExtractor.js` 解析命令行输出 (regex/JSON_path)。
   - `Judge & Commit`: 若修改通过了 guard 指标、并且主要 metric 有提升，则通过本地 git 命令执行 `git commit` (Accept)，否则撤销修改 (Reject)。
3. 在连续 Reject 阈值耗尽或者指标达到最大收敛后，得出稳定的调优变体，向客户端下发最终的 `diff` 或结束通知。

## 模块职责

### Backend

| **模块**                      | **文件**                                     | **职责**                                                                                                                                                                                                                                                                       |
| ----------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **API与鉴权**                 | `server.js` / `middleware.js`                | HTTP REST + WS 入口；拦截校验 Headers 中 `x-user-id` 及 Token，执行基于 JWT/Token 的多租户身份隔离验证。                                                                                                                                                                       |
| **意图路由编排**              | `registry.js` / `router.js`                  | 双通意图分类引擎：Pass 1 — 正则意图模式（web-research / web-scraping / url-reading / data-analysis）多命中评分；Pass 2 — 按类别（search / crawl / core）批量共激活对应 MCP 服务器组与 Skill，取代逐关键词单点匹配。                                                            |
| **搜索/爬取 MCP 层**          | `mcpConfig.js` (Search/Crawl tier)           | 6 个条件加载的 MCP Server：搜索引擎 (Tavily / Exa / Brave Search)、爬取器 (Firecrawl / Fetch / Jina Reader)。API Key 存在时激活，不存在时静默跳过。Jina Reader 使用 SSE 远程传输。                                                                                             |
| **自愈拦截引擎**              | `schemaValidator.js` / `hooks.js`            | **(Harness Engineering)** 搭载本地 Zod Schema 强校验网关闭环屏蔽模型传参幻觉；配备 Semantic Loop Watchdog。当系统检测到模型深陷“重试死循环”（连续多次 ToolHash 碰撞对应出错）时，Harness 免人类介入、自发下达 `<harness_override>` 破壁指令，底层设 Circuit Breaker 异常熔断。 |
| **实验与评测 (AutoResearch)** | `experimentEngine.js` / `metricExtractor.js` | 新增的核心实验引擎。在 host 环境内基于白名单创建临时隔离 `workspace`，内部执行带状态恢复机制 (Git Ratchet) 的 "提议-度量-回滚/提交" 循环打分流程。支持直接正则/解析提取命令行输出指标，自动向 WS 事件总线广播演进度。                                                          |
| **安全沙箱**                  | `hooks.js` / `dockerSandbox.js`              | `PreToolUse` Bash双层围栏防穿透。执行 Python/Node 代码时，引擎自动下卷分配基于 `dockerode` 的无网络零信任按需生成容器，完全隔离宿主机并施加 256MB/50 PIDs 的熔断保护。                                                                                                         |
| **微服务器组**                | `nativeMcpServer.js`                         | 基于官方 `@modelcontextprotocol/sdk` 实现的后端驻留子进程，向模型动态注册高级中间件原生工具 (如 `TaskCreateTool` 分发子代理、`BatchTool`、`LoopTool` 并发调度与多维执行)。                                                                                                     |
| **持久层**                    | `sessionStore.js` / `experimentStore.js`     | 核心多模块 SQLite 接口，采用 WAL 读写模式，全面强制化附带 `user_id` 分区设计。支持断线恢复与基于租户强隔离。                                                                                                                                                                   |

### Frontend

| 模块         | 文件                 | 职责                                                                                                                                                      |
| ------------ | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **状态总线** | `useWebSocket.js`    | 管理 WS 长连接，5态生命周期重连，提供全局状态的 hook 发布/订阅。                                                                                          |
| **主展板**   | `AgentTimeline.jsx`  | 将高嵌套维度的 SDK block 扁平化渲染为思考链（思维气泡）、执行链（终端）、报错链。                                                                         |
| **控制台**   | `ChatInput / Header` | `Agent` / `Workflow` / `Experiment` 三模式切换；Dark / Light 主题切换。Cmd/Ctrl+Enter 提交。                                                              |
| **数据解剖** | `RightPanel.jsx`     | 3个子Tab管理：提炼 Bash 终端纯净流 (`Terminal`)、模型吞吐统计及价格核算 (`Context`)、文件编辑/读取频次统计监控 (`Files`)。                                |
| **拓扑编辑** | `WorkflowEditor.jsx` | SVG 矩阵级画布编辑环境，支持将 `experiment` 节点编织入子 DAG 并配置属性。交互层支持批量选择/删除及自动寻径渲染。                                          |
| **实验面板** | `ExperimentView.jsx` | 实时实验透视台，具备并排的双联显示：左侧是 `experiments` 模板的动态 JSON 编辑修改区；右侧是流式获取后台子试验 (Trials) 数据指标刷新的监控仪表盘及进度图。 |
| **通用组件** | `ConfirmDialog.jsx`  | 自定义主题确认弹窗，替代浏览器原生 `window.confirm`，支持 Esc/Enter 快捷键。                                                                              |

## 数据库 Schema 设计

系统由三组 SQLite 持久化表构成（其中 sessions 与 experiments 共享 `agentboard.db`）：

### 1. `agentboard.db` (单 Agent 游历库)

```sql
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  prompt     TEXT NOT NULL,
  status     TEXT DEFAULT 'pending',
  created_at TEXT,
  stats      TEXT
);

CREATE TABLE events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT REFERENCES sessions(id),
  type       TEXT NOT NULL,
  content    TEXT NOT NULL,
  timestamp  INTEGER NOT NULL
);
```

### 2. `workflows.db` (DAG 流程图库)

```sql
CREATE TABLE workflows (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition  TEXT NOT NULL,         -- 存储完整的 {nodes, edges} 拓扑结构JSON
  created_at  TEXT,
  updated_at  TEXT
);

CREATE TABLE workflow_runs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL DEFAULT 'default',
  workflow_id  TEXT NOT NULL REFERENCES workflows(id),
  status       TEXT NOT NULL DEFAULT 'pending',
  context      TEXT DEFAULT '{}',    -- 存储运行时随节点滚动累积的数据字典
  node_results TEXT DEFAULT '{}',    -- 子节点执行完成的 Snapshot
  error        TEXT,
  created_at   TEXT,
  completed_at TEXT
);
```

### 3. `agentboard.db` 附加表 (实验评测体系)

```sql
CREATE TABLE experiments (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL DEFAULT 'default',
  name        TEXT NOT NULL,
  description TEXT,
  plan        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE experiment_runs (
  id              TEXT PRIMARY KEY,
  experiment_id   TEXT NOT NULL REFERENCES experiments(id),
  user_id         TEXT NOT NULL DEFAULT 'default',
  status          TEXT NOT NULL DEFAULT 'running',
  best_metric     REAL,
  baseline_metric REAL,
  total_trials    INTEGER NOT NULL DEFAULT 0,
  accepted_trials INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at    TEXT
);

CREATE TABLE trials (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES experiment_runs(id),
  trial_number     INTEGER NOT NULL,
  accepted         INTEGER NOT NULL DEFAULT 0,
  primary_metric   REAL,
  all_metrics      TEXT,
  diff             TEXT,
  agent_session_id TEXT,
  reason           TEXT,
  duration_ms      INTEGER,
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);
```

## 安全边界隔离 (Defense-in-Depth)

| **机制**             | **实施详情**                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **网络口令防火墙**   | REST 以及 WebSocket 强制启用 `AGENTBOARD_API_KEY` 环境变量进行双重认证。未配钥强行熔断。同时各子路由全面注入并强制审计 `x-user-id`。                                                                                                       |
| **Docker应用级沙盒** | 所有由模型发起的高级脚本操作 (Node.js 或 Python的 REPL 评价) 全面抛弃主机执行，一律采用按需自动拉起的隔离容器。容器启动带有强制安全域：`NetworkMode: none`（绝对禁止回网），限制内存 (`256MB`)，并且仅映射唯一当前执行用户的云盘存储目录。 |
| **绝对路径围栏**     | 在 Bash 节点的底层钩子中，针对所有含有路径片段的命令强制剥离验证，仅允许放行白名单区域：`/usr/local/bin`, `/usr/bin`, `/bin`, `/dev`, `/tmp`。其余系统级目录试图遭到 `cat` 读取将直接打回 `PermissionDenied`。                             |
| **环境变量遮蔽**     | 以隔离租户的作用域传参 Spawn 辅助线程，伪装了 `HOME` 与特定 CWD。完全隔绝 Agent 对宿主机内核及系统环境变量的窥探。                                                                                                                         |

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

## 设计哲学

| 决策点         | 演进结果说明                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **API 解耦化** | 完全扬弃了早期强绑定某些国产厂商的设计。引入 `proxy.js` 实现 100% 遵守 Anthropic -> OpenAI 接口映射规范，极大增强了系统模型供应的健壮性。 |
| **CSS 变量化** | 利用原生的 CSS Variables 取代散碎的类名定义，通过单表 `index.css` 控制所有的视觉颜色。零依赖实现 Light/Dark 双色系统切换。                |
| **DAG 自研化** | 并未引入厚重的 xstate / Temporal，而是自研极简高效的纯异步拓扑排序引擎。极大减轻了前后端同构开发的理解负荷。                              |
| **MCP 层级化** | 搜索/爬取 MCP 不走全量装载，通过意图路由按需激活对应层级，避免 Token 浪费。API Key 缺失时静默跳过，保证零配置可启动。                     |
