# AgentBoard

AI Agent 编排展示平台 -- 基于 Claude Agent SDK 编排框架，接入低成本 Minimax 模型，通过 Web Dashboard 实时展示 Agent 的思考与执行过程。

## 架构概览

```
Browser ←→ WebSocket ←→ Node.js Backend ←→ Claude Agent SDK (query)
                                               ↓ SDKMessage 事件流
                                          Anthropic→OpenAI Proxy (Node.js)
                                               ↓
                                          Minimax API (OpenAI Compatible)
```

- **前端**：Vite + React，暗色主题 Dashboard，实时展示 Agent 时间线
- **后端**：Express + WebSocket + SQLite，通过 SDK 调用 Agent
- **代理**：Node.js 轻量代理，Anthropic Messages API → OpenAI Chat Completions
- **模型**：MiniMax-M2.7-highspeed（OpenAI Compatible，`mydamoxing.cn/v1`）

## 项目结构

```
agentboard/
├── backend/
│   ├── server.js           # Express + WebSocket 主入口
│   ├── agentManager.js     # Claude Agent SDK 调用与事件分发
│   ├── proxy.js            # Anthropic→OpenAI 翻译代理
│   ├── sessionStore.js     # SQLite 会话/事件存储
│   └── config.js           # 集中配置
├── frontend/
│   ├── src/
│   │   ├── App.jsx                     # 主布局
│   │   ├── index.css                   # 设计系统
│   │   ├── hooks/useWebSocket.js       # WebSocket hook
│   │   └── components/
│   │       ├── Header.jsx              # 顶部导航
│   │       ├── ChatInput.jsx           # 任务输入
│   │       ├── AgentTimeline.jsx       # 思考/工具调用时间线
│   │       ├── TerminalView.jsx        # 终端输出面板
│   │       └── StatusBar.jsx           # 底部状态栏
│   └── vite.config.js
├── workspace/               # Agent 隔离工作目录
│   └── CLAUDE.md            # Agent 安全规则
└── docs/                    # 设计文档与架构
```

## 环境要求

- Node.js 20+

无需全局安装 Claude Code CLI -- Agent SDK 作为 npm 依赖自动安装。

## 快速开始

### 1. 安装依赖

```bash
# 后端（含 Claude Agent SDK）
cd backend && npm install && cd ..

# 前端
cd frontend && npm install && cd ..

# 根目录（concurrently）
npm install
```

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local`，填入你的 API Key：

```bash
cp .env.example .env.local
# 编辑 .env.local，设置 ANTHROPIC_API_KEY
```

### 3. 启动

```bash
npm run dev
```

一条命令同时启动三个服务：

- **proxy** (黄色) -- Anthropic→OpenAI 翻译代理 `:4000`
- **back** (蓝色) -- Express + WebSocket 后端 `:3001`
- **front** (绿色) -- Vite 前端 `:5173`

### 4. 使用

打开 `http://localhost:5173`，在输入框输入任务指令，Agent 将实时展示思考过程和工具调用。

## API

### REST

| Method | Path                     | Description            |
| ------ | ------------------------ | ---------------------- |
| GET    | `/api/sessions`          | 获取会话列表           |
| GET    | `/api/sessions/:id`      | 获取会话详情（含事件） |
| POST   | `/api/sessions/:id/stop` | 停止运行中的 Agent     |
| GET    | `/api/status`            | 服务状态               |

### WebSocket (`ws://localhost:3001`)

**发送：**

```json
{ "action": "start", "prompt": "帮我写一个 Todo App" }
{ "action": "subscribe", "sessionId": "uuid" }
{ "action": "stop", "sessionId": "uuid" }
```

**接收：**

```json
{ "type": "session_started", "sessionId": "uuid" }
{ "sessionId": "uuid", "type": "assistant|result|system", "content": {}, "timestamp": 1234567890 }
{ "type": "done", "content": { "status": "completed" } }
```

## 技术栈

| 层    | 技术                                                                                        | 用途                                         |
| ----- | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 前端  | Vite + React 19                                                                             | SPA Dashboard                                |
| 样式  | CSS Modules + CSS Variables                                                                 | 暗色主题设计系统                             |
| 通信  | WebSocket (ws)                                                                              | 实时流式推送                                 |
| 后端  | Express 5                                                                                   | HTTP API + WebSocket                         |
| 存储  | better-sqlite3                                                                              | 会话和事件持久化                             |
| 代理  | Node.js proxy.js                                                                            | Anthropic Messages → OpenAI Chat Completions |
| Agent | [@anthropic-ai/claude-agent-sdk](https://github.com/anthropics/claude-agent-sdk-typescript) | 编排引擎（SDK 编程式调用）                   |
| 模型  | MiniMax-M2.7-highspeed                                                                      | 低成本 LLM（OpenAI Compatible）              |

## 开发

### 代码格式化

```bash
npm run format        # 格式化全部文件
npm run format:check  # 检查格式（CI 用）
```

### 代码检查

```bash
npm run lint          # ESLint 检查
```

### 构建

```bash
npm run build         # 构建前端生产包
```

## License

MIT
