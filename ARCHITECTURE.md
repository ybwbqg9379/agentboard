# AgentBoard Architecture

> Agent SDK: [@anthropic-ai/claude-agent-sdk](https://github.com/anthropics/claude-agent-sdk-typescript) (TypeScript)

## 系统架构

AgentBoard 已演进为支持**单 Agent 对话**与**多 Agent DAG 协作**的双模式架构引擎。

```text
+-------------------------------------------------+       +---------------------------------------------+
| Browser (Vite + React SPA)                      |       | Node.js Backend (Express + WS :3001)        |
|                                                 |       |                                             |
| [Header] (Mode: Agent / Workflow, ThemeToggle)  | REST  | +-----------------+    +------------------+ |
|                                                 | <---> | | Zod Auth/Valid  |    | workflowEngine.js| |
| +-------------------+ +-----------------------+ |  WS   | +--------+--------+    +---------+--------+ |
| |   MainContent     | |     RightPanel        | | <---> |          |                       |          |
| | - Timeline/Chat   | | - Terminal / Context  | |       | +--------v--------+    +---------v--------+ |
| | - WorkflowEditor  | | - Files               | |       | | agentManager.js |    | workflowStore.js | |
| +-------------------+ +-----------------------+ |       | +--------+--------+    +------------------+ |
+-------------------------------------------------+       +----------|----------------------------------+
                                                                     |
                               +----------------+                    | (Claude Agent SDK async iter)
                               |  2x SQLite DB  |                    |
                               |  agentboard.db | <------------------+
                               |  workflows.db  |                    |      +-------------------+
                               +----------------+                    |      | MCP Servers       |
                                                                     +----> | filesystem/memory |
+-------------------------------+                                    |      | browser/github    |
| Any OpenAI-Compatible LLM     |                                    |      | seq-thinking      |
| (Local: vLLM, Ollama)         | <----+                             |      +-------------------+
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
4. 调用 Agent SDK，经过 `proxy.js` 将 Anthropic 格式转译为通用的 OpenAI 格式以调用远端 LLM。
5. SDK 产出 `SDKMessage` 事件流，由 `hooks` 进行截获处理（过滤高危 bash 路径，记录 MCP Token 耗时等）。
6. 事件同步写入 SQLite (sessions / events 表)，并通过 WebSocket 广播给前端 `AgentTimeline` 和 `RightPanel` 进行 Markdown 渲染和可视化拆表。

### 2. Workflow 工作流引擎渲染流

1. 用户在 `WorkflowEditor` 拖拽连线生成 `nodes` 和 `edges` 的 JSON DAG，REST `/api/workflows` 将其存入 `workflows.db`。
2. 触发执行 `POST /run`，`workflowEngine.js` 锁定执行。
3. `workflowEngine.js` 对所有节点执行**拓扑排序 (Topological Sort)** 以决定依赖顺序。
4. 节点开始流水线流转：
   - **`agent` 节点**：将模版变量 `{{var}}` 替换后，指派为匿名的子代理交给 `agentManager.js` 执行。
   - **`condition` 节点**：运算上下文表达式（`key == value`, `key > N`）。运算失败的后继节点会被执行引擎递归打上 `skipped` 标签并跳过。
   - **`transform` / `input` / `output` 节点**：纯函数变换，汇聚或修改执行上下文 `context`。
5. 前后端通过 WS 的 `node_start` / `node_complete` 以及实时脉冲动画协同，呈现可视化 DAG 构建状态。

## 模块职责

### Backend

| 模块           | 文件                                   | 职责                                                                                                                           |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **API与代理**  | `server.js` / `proxy.js`               | HTTP REST + WS 入口；Zod与Auth中间件拦截；Anthropic -> OpenAI 格式转包。                                                       |
| **动态编排**   | `registry.js` / `router.js`            | **Dynamic Orchestrator**: 动态扫描解析 `SKILL.md` (Frontmatter)，进行基于意图与上下文(路径)的 MCP/Skill 的按需路由与精准分发。 |
| **Agent 调度** | `agentManager.js` / `agentDefs.js`     | Agent SDK 实例维护，注册预设子代理，调用 Router 进行工具按需挂载，限制执行轮次与隔离环境。                                     |
| **安全沙箱**   | `hooks.js` / `mcpConfig.js`            | `PreToolUse` Bash双层围栏；MCP 节点环境隔离并支持基于环境变量的远端 HTTP/WS 分布式连接机制。                                   |
| **工作流引擎** | `workflowEngine.js`                    | DAG 图遍历，表达式解析，模板 `{{}}` 替换。管理子节点发散与 Join 汇合调度。                                                     |
| **持久层**     | `sessionStore.js` / `workflowStore.js` | 核心双库 SQLite 接口，支撑断线恢复及分页查询。                                                                                 |

### Frontend

| 模块         | 文件                 | 职责                                                                                                                       |
| ------------ | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **状态总线** | `useWebSocket.js`    | 管理 WS 长连接，5态生命周期重连，提供全局状态的 hook 发布/订阅。                                                           |
| **主展板**   | `AgentTimeline.jsx`  | 将高嵌套维度的 SDK block 扁平化渲染为思考链（思维气泡）、执行链（终端）、报错链。                                          |
| **控制台**   | `ChatInput / Header` | `Agent` / `Workflow` 双模式切换；Dark / Light 主题切换。                                                                   |
| **数据解剖** | `RightPanel.jsx`     | 3个子Tab管理：提炼 Bash 终端纯净流 (`Terminal`)、模型吞吐统计及价格核算 (`Context`)、文件编辑/读取频次统计监控 (`Files`)。 |
| **拓扑编辑** | `WorkflowEditor.jsx` | SVG 矩阵级画布编辑环境，节点 Config 表单设置与节点边缘动画状态。                                                           |

## 数据库 Schema 设计

系统由平行的两大核心持久化库构成：

### 1. `agentboard.db` (单 Agent 游历库)

```sql
CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  prompt     TEXT NOT NULL,
  status     TEXT DEFAULT 'pending', -- pending|running|completed|failed|stopped
  created_at TEXT,
  stats      TEXT                    -- 缓存该 Session 的模型 Token 吞吐结果
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
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  definition  TEXT NOT NULL,         -- 存储完整的 {nodes, edges} 拓扑结构JSON
  created_at  TEXT,
  updated_at  TEXT
);

CREATE TABLE workflow_runs (
  id           TEXT PRIMARY KEY,
  workflow_id  TEXT NOT NULL REFERENCES workflows(id),
  status       TEXT NOT NULL DEFAULT 'pending',
  context      TEXT DEFAULT '{}',    -- 存储运行时随节点滚动累积的数据字典
  node_results TEXT DEFAULT '{}',    -- 子节点执行完成的 Snapshot
  error        TEXT,
  created_at   TEXT,
  completed_at TEXT
);
```

## 安全边界隔离 (Defense-in-Depth)

| 机制               | 实施详情                                                                                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **网络口令防火墙** | REST 以及 WebSocket 强制启用 `AGENTBOARD_API_KEY` 环境变量进行双重认证。未配钥强行熔断。                                                                                                                               |
| **绝对路径围栏**   | 在 Bash 节点的底层钩子中，针对所有含有路径片段的命令强制剥离验证，仅允许放行白名单区域：`/usr/local/bin`, `/usr/bin`, `/bin`, `/dev`, `/tmp`。其余系统级目录如试图被 `cat` / `sed` 读取则直接打回 `PermissionDenied`。 |
| **环境变量遮蔽**   | 以隔离作用域起草 Spawn 线程，伪装了 `HOME` 为当前 Workspace。隔绝 Agent 窥探操作者宿主机器关键参数配置。                                                                                                               |
| **操作失控防护**   | `workflowEngine.js` 的 `workflow_runs` 在初始化即受全局超时管理约束，避免无限死循环。针对死锁查询的 WebSearch/Agent 分配了 `maxTurns` 软限流硬保护。                                                                   |

## 设计哲学

| 决策点         | 演进结果说明                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **API 解耦化** | 完全扬弃了早期强绑定某些国产厂商的设计。引入 `proxy.js` 实现 100% 遵守 Anthropic -> OpenAI 接口映射规范，极大增强了系统模型供应的健壮性。 |
| **CSS 变量化** | 利用原生的 CSS Variables 取代散碎的类名定义，通过单表 `index.css` 控制所有的视觉颜色。零依赖实现 Light/Dark 双色系统切换。                |
| **DAG 自研化** | 并未引入厚重的 xstate / Temporal，而是自研极简高效的纯异步拓扑排序引擎。极大减轻了前后端同构开发的理解负荷。                              |
