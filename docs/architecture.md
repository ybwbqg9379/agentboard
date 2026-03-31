# AgentBoard Architecture

## 系统架构

```
+------------------+       +-------------------+       +--------------------+
|                  |  WS   |                   | spawn |                    |
|   Browser        |<----->|   Node.js Backend |------>| Claude Code CLI    |
|   (React SPA)    |       |   (Express + WS)  |       | (subprocess)       |
|                  |       |                   |       |                    |
+------------------+       +--------+----------+       +---------+----------+
                                    |                            |
                                    | SQLite                     | Anthropic API
                                    v                            v
                           +--------+----------+       +---------+----------+
                           |                   |       |                    |
                           |   data/           |       |  LiteLLM Proxy     |
                           |   agentboard.db   |       |  :4000             |
                           |                   |       |                    |
                           +-------------------+       +---------+----------+
                                                                 |
                                                                 | OpenAI API
                                                                 v
                                                       +---------+----------+
                                                       |                    |
                                                       |  Minimax API       |
                                                       |  mydamoxing.cn/v1  |
                                                       |  M2.7-highspeed    |
                                                       +--------------------+
```

## 数据流

```
1. 用户在浏览器输入任务
   Browser → WebSocket → { action: "start", prompt: "..." }

2. 后端创建会话，spawn Claude Code CLI
   server.js → agentManager.startAgent(prompt)
     → sessionStore.createSession(prompt)
     → spawn('claude', ['-p', prompt, '--output-format', 'stream-json'])

3. Claude Code CLI 通过 LiteLLM 调用 Minimax 模型
   Claude Code → ANTHROPIC_BASE_URL=localhost:4000 → LiteLLM
     → Anthropic 格式 → OpenAI 格式 → Minimax API → 响应

4. Claude Code 输出 NDJSON 事件流
   stdout → 逐行解析 → { type: "assistant"|"tool_use"|"tool_result"|... }

5. 后端解析事件，持久化到 SQLite，通过 WebSocket 推送
   agentManager → insertEvent() + agentEvents.emit()
     → server.js 广播给订阅了该 session 的 WebSocket 客户端

6. 前端实时渲染
   useWebSocket hook → events state → AgentTimeline / TerminalView
```

## 模块职责

### Backend

| 模块 | 文件 | 职责 |
|------|------|------|
| Config | `config.js` | 集中配置管理（端口、路径、超时） |
| Session Store | `sessionStore.js` | SQLite CRUD，sessions + events 两表 |
| Agent Manager | `agentManager.js` | spawn/stop Claude Code 进程，NDJSON 解析，事件发射 |
| Server | `server.js` | HTTP REST API + WebSocket 服务，事件广播 |

### Frontend

| 模块 | 文件 | 职责 |
|------|------|------|
| WebSocket Hook | `useWebSocket.js` | 连接管理、重连、消息解析、状态维护 |
| Header | `Header.jsx` | Logo、版本、连接状态、New Session |
| ChatInput | `ChatInput.jsx` | 任务输入、Run/Stop 操作 |
| AgentTimeline | `AgentTimeline.jsx` | 核心：按类型渲染事件卡片（thinking/tool/text） |
| TerminalView | `TerminalView.jsx` | 提取 Bash tool_use/tool_result 渲染终端 |
| StatusBar | `StatusBar.jsx` | 运行状态、Session ID、事件计数 |

### LiteLLM Proxy

| 配置项 | 值 | 作用 |
|--------|-----|------|
| model_name | claude-sonnet/haiku/opus 等 | 接收 Claude Code 的模型请求 |
| litellm_params.model | openai/MiniMax-M2.7-highspeed | 实际转发目标 |
| litellm_params.api_base | https://mydamoxing.cn/v1 | Minimax 端点 |
| drop_params | true | 丢弃 Minimax 不支持的参数 |

## 事件类型

Claude Code `--output-format stream-json` 输出的事件类型：

| type | 含义 | 前端展示 |
|------|------|---------|
| `assistant` (subtype: thinking) | 模型思考过程 | 时间线 - 黄色思考气泡 |
| `assistant` | 模型文本输出 | 时间线 - 紫色文本卡片 |
| `tool_use` | 工具调用（Bash/Read/Write/Edit 等） | 时间线 - 蓝色工具卡片 + 终端面板 |
| `tool_result` | 工具执行结果 | 时间线 - 结果卡片 + 终端面板 |
| `result` | 最终结果 | 时间线 - 完成卡片 |
| `system` | 系统消息 | 时间线 |

## 数据库 Schema

```sql
sessions (
  id         TEXT PRIMARY KEY,     -- UUID
  prompt     TEXT NOT NULL,        -- 用户指令
  status     TEXT DEFAULT 'pending', -- pending|running|completed|failed|stopped
  created_at TEXT                   -- ISO datetime
)

events (
  id         INTEGER PRIMARY KEY,  -- 自增
  session_id TEXT REFERENCES sessions(id),
  type       TEXT NOT NULL,        -- 事件类型
  content    TEXT NOT NULL,        -- JSON 序列化的事件内容
  timestamp  INTEGER NOT NULL      -- Unix ms
)
```

## 设计决策

| 决策 | 理由 |
|------|------|
| Claude Code CLI subprocess 而非 SDK | 零开发成本复用全部 Agent 能力（工具调用、文件操作、Git、编排循环） |
| LiteLLM 代理层 | Anthropic API 格式与 OpenAI 格式转换，模型名映射 |
| WebSocket 而非 SSE | 双向通信，支持 start/stop/subscribe 指令 |
| SQLite 而非 Postgres | 单机部署，零运维，轻量存储 |
| CSS Modules 而非 Tailwind | 精确控制暗色主题设计系统，无额外构建依赖 |
| Vite 而非 Next.js | 纯 SPA，无需 SSR，最小化复杂度 |
