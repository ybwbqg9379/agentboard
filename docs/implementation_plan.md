# AgentBoard — AI Agent 编排展示平台

> Claude Code 编排框架 + Minimax 底层模型 + Web 前端实时展示

## 项目结构

```
agentboard/
├── frontend/                 # Vite + React 前端
│   ├── index.html
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── main.jsx
│       ├── App.jsx
│       ├── index.css          # 全局设计系统
│       ├── components/
│       │   ├── ChatInput.jsx       # 用户输入指令
│       │   ├── AgentTimeline.jsx   # Agent 思考/工具调用时间线
│       │   ├── TerminalView.jsx    # 终端输出面板
│       │   ├── FileExplorer.jsx    # 文件浏览器
│       │   ├── Header.jsx          # 顶部导航
│       │   └── StatusBar.jsx       # 底部状态栏
│       └── hooks/
│           └── useWebSocket.js     # WebSocket 连接 hook
│
├── backend/                  # Node.js 后端
│   ├── package.json
│   ├── server.js             # Express + WebSocket 主入口
│   ├── agentManager.js       # Claude Code subprocess 管理
│   ├── sessionStore.js       # SQLite 会话存储
│   └── config.js             # 配置管理
│
├── litellm/                  # LiteLLM 代理配置
│   └── config.yaml
│
├── workspace/                # Agent 工作目录（隔离）
│
└── README.md
```

## User Review Required

> [!IMPORTANT]
> **项目名称**：暂定 `agentboard`，你有想要的名称吗？

> [!IMPORTANT]
> **Minimax 配置**：你的 Minimax API Key 和具体模型名（M2.5? M2.7?）我需要在 LiteLLM config 中配置。目前先用占位符，后续你替换即可。

> [!WARNING]
> **LiteLLM 依赖 Python**：需要你的机器上有 Python 3.8+。如果没有，我们可以改用纯环境变量方式直接测试。

## Proposed Changes

### Phase 1: 项目骨架 + 后端

#### [NEW] backend/package.json

- Express + ws (WebSocket) + better-sqlite3
- 启动脚本配置

#### [NEW] backend/server.js

- Express HTTP 服务 (端口 3001)
- WebSocket 服务 (同端口)
- CORS 配置支持前端跨域
- 路由: `GET /api/sessions` 查看历史会话

#### [NEW] backend/agentManager.js

- 核心逻辑：spawn Claude Code CLI 为 subprocess
- 解析 `--output-format stream-json` 的 NDJSON 输出
- 将每个事件（thinking / text / tool_use / tool_result）分类并通过 WebSocket 推送
- 进程生命周期管理（启动/停止/超时）

#### [NEW] backend/sessionStore.js

- SQLite 存储会话和事件历史
- 表结构: `sessions(id, prompt, status, created_at)` + `events(id, session_id, type, content, timestamp)`

#### [NEW] backend/config.js

- 集中管理配置：端口、LiteLLM URL、工作目录等

---

### Phase 2: 前端 Dashboard

#### [NEW] frontend/ (Vite + React 项目)

- `npm create vite@latest ./ -- --template react`

#### [NEW] frontend/src/index.css

- 设计系统: 暗色主题、CSS Variables、动画
- 灵感: 类似 Vercel/Linear 的现代深色 UI

#### [NEW] frontend/src/App.jsx

- 主布局: 三栏（输入 | 时间线 | 文件/终端）
- 路由: Dashboard / Workspace / History

#### [NEW] frontend/src/components/ChatInput.jsx

- 底部输入栏，发送指令到 WebSocket

#### [NEW] frontend/src/components/AgentTimeline.jsx

- **核心组件**：实时展示 Agent 的思考过程和工具调用
- 每个事件卡片: thinking bubble / tool call card / text output
- 自动滚动 + 动画入场

#### [NEW] frontend/src/components/TerminalView.jsx

- 模拟终端输出（Agent 执行的命令和结果）

#### [NEW] frontend/src/components/FileExplorer.jsx

- 展示 Agent 创建/修改的文件树

#### [NEW] frontend/src/hooks/useWebSocket.js

- 管理 WebSocket 连接、重连、消息分发

---

### Phase 3: LiteLLM 代理层

#### [NEW] litellm/config.yaml

- 配置模型映射: Claude 模型名 → Minimax 模型
- drop_params 处理兼容性问题

---

### Phase 4: 集成与部署

- 启动脚本 (concurrently 启动前端+后端+LiteLLM)
- README 文档
- 基础 Docker 支持 (可选)

## Verification Plan

### Automated Tests

1. 启动 LiteLLM proxy，验证 `/v1/models` 返回正确
2. 启动后端，WebSocket 连接测试
3. 前端 `npm run dev` 能正常加载

### Manual Verification

1. 通过前端发送简单指令 → 观察 Agent 实时输出
2. 验证 thinking / tool_use / text 事件正确分类和展示
3. 会话历史保存和回放
