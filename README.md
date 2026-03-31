# AgentBoard

AI Agent 编排展示平台 -- 基于 Claude Code CLI 编排框架，接入低成本 Minimax 模型，通过 Web Dashboard 实时展示 Agent 的思考与执行过程。

## 架构概览

```
Browser ←→ WebSocket ←→ Node.js Backend ←→ Claude Code CLI (subprocess)
                                               ↓ stream-json
                                          LiteLLM Proxy
                                               ↓
                                          Minimax API
```

- **前端**：Vite + React，暗色主题 Dashboard，实时展示 Agent 时间线
- **后端**：Express + WebSocket + SQLite，管理 Claude Code subprocess
- **代理**：LiteLLM 将 Anthropic API 格式转换为 OpenAI 格式
- **模型**：MiniMax-M2.7-highspeed（OpenAI Compatible）

## 项目结构

```
agentboard/
├── backend/
│   ├── server.js           # Express + WebSocket 主入口
│   ├── agentManager.js     # Claude Code subprocess 管理
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
├── litellm/
│   └── config.yaml         # 模型映射配置
├── workspace/               # Agent 隔离工作目录
└── docs/                    # 设计文档
```

## 环境要求

- Node.js 20+
- Python 3.8+（LiteLLM 依赖）
- Claude Code CLI（已安装并可用）

## 快速开始

### 1. 安装依赖

```bash
# 后端
cd backend && npm install && cd ..

# 前端
cd frontend && npm install && cd ..

# 根目录（concurrently）
npm install

# LiteLLM
pip install 'litellm[proxy]'
```

### 2. 配置环境变量

```bash
export MINIMAX_API_KEY="your_minimax_api_key"
```

### 3. 启动 LiteLLM 代理

```bash
npm run litellm
# 监听 http://localhost:4000
```

### 4. 启动前后端

```bash
npm run dev
# 后端 http://localhost:3001
# 前端 http://localhost:5173
```

### 5. 使用

打开 `http://localhost:5173`，在输入框输入任务指令，Agent 将实时展示思考过程和工具调用。

## API

### REST

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | 获取会话列表 |
| GET | `/api/sessions/:id` | 获取会话详情（含事件） |
| POST | `/api/sessions/:id/stop` | 停止运行中的 Agent |
| GET | `/api/status` | 服务状态 |

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
{ "sessionId": "uuid", "type": "assistant|tool_use|tool_result|result", "content": {}, "timestamp": 1234567890 }
{ "type": "done", "content": { "exitCode": 0, "status": "completed" } }
```

## 技术栈

| 层 | 技术 | 用途 |
|----|------|------|
| 前端 | Vite + React 19 | SPA Dashboard |
| 样式 | CSS Modules + CSS Variables | 暗色主题设计系统 |
| 通信 | WebSocket (ws) | 实时流式推送 |
| 后端 | Express 5 | HTTP API + WebSocket |
| 存储 | better-sqlite3 | 会话和事件持久化 |
| 代理 | LiteLLM | Anthropic <-> OpenAI 格式转换 |
| Agent | Claude Code CLI | 编排引擎 |
| 模型 | MiniMax-M2.7-highspeed | 低成本 LLM |

## License

MIT
