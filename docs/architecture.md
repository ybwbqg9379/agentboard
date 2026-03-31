# AgentBoard Architecture

## 系统架构

```
+------------------+       +-------------------+       +--------------------+
|                  |  WS   |                   | spawn |                    |
|   Browser        |<----->|   Node.js Backend |------>| Claude Code CLI    |
|   (React SPA)    |       |   (Express + WS)  |       | (subprocess)       |
|                  |       |   :3001            |       |                    |
+------------------+       +--------+----------+       +---------+----------+
                                    |                            |
                                    | SQLite                     | Anthropic API
                                    v                            v
                           +--------+----------+       +---------+----------+
                           |                   |       |                    |
                           |   data/           |       |  proxy.js          |
                           |   agentboard.db   |       |  (Node.js)  :4000  |
                           |                   |       |  Anthropic→OpenAI  |
                           +-------------------+       +---------+----------+
                                                                 |
                                                                 | OpenAI Chat
                                                                 | Completions
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
     → spawn('claude', ['-p', prompt, '--output-format', 'stream-json',
              '--verbose', '--dangerously-skip-permissions'])

3. Claude Code CLI 通过 proxy.js 调用 Minimax 模型
   Claude Code → ANTHROPIC_BASE_URL=localhost:4000/v1/messages
     → proxy.js 翻译 Anthropic → OpenAI
     → mydamoxing.cn/v1/chat/completions → 响应
     → proxy.js 翻译 OpenAI → Anthropic → Claude Code

4. Claude Code 输出 NDJSON 事件流
   stdout → 逐行解析 → 嵌套 content blocks
     { type: "assistant", content: { content: [{ type: "text" }, { type: "tool_use" }] } }

5. 后端解析事件，持久化到 SQLite，通过 WebSocket 推送
   agentManager → insertEvent() + agentEvents.emit()
     → server.js 广播给订阅了该 session 的 WebSocket 客户端

6. 前端扁平化渲染
   useWebSocket hook → events state
     → AgentTimeline: flattenEvent() 拆解嵌套 content blocks
     → TerminalView: 提取 Bash tool_use/tool_result
```

## 模块职责

### Backend

| 模块 | 文件 | 职责 |
|------|------|------|
| Config | `config.js` | 集中配置管理（端口、路径、超时、Minimax 端点） |
| Session Store | `sessionStore.js` | SQLite CRUD，sessions + events 两表 |
| Agent Manager | `agentManager.js` | spawn/stop Claude Code 进程，NDJSON 解析，事件发射 |
| Server | `server.js` | HTTP REST API + WebSocket 服务，事件广播 |
| Proxy | `proxy.js` | Anthropic Messages API → OpenAI Chat Completions 翻译 |

### Proxy 翻译层 (proxy.js)

| 功能 | 说明 |
|------|------|
| 消息转换 | Anthropic content blocks → OpenAI messages（text/tool_use/tool_result） |
| 工具转换 | Anthropic tools (input_schema) → OpenAI tools (parameters) |
| 响应转换 | OpenAI choices → Anthropic content blocks + stop_reason |
| 流式转换 | OpenAI SSE chunks → Anthropic SSE events（content_block_start/delta/stop） |
| 参数映射 | system prompt、max_tokens、temperature、top_p |

### Frontend

| 模块 | 文件 | 职责 |
|------|------|------|
| WebSocket Hook | `useWebSocket.js` | 连接管理、重连、消息解析、状态维护 |
| Header | `Header.jsx` | Logo、版本、连接状态、New Session |
| ChatInput | `ChatInput.jsx` | 任务输入、Run/Stop 操作 |
| AgentTimeline | `AgentTimeline.jsx` | flattenEvent() 拆解嵌套 blocks，按类型渲染（thinking/tool/text） |
| TerminalView | `TerminalView.jsx` | 提取嵌套 Bash tool_use/tool_result 渲染终端 |
| StatusBar | `StatusBar.jsx` | 运行状态、Session ID、事件计数 |

## 事件类型

Claude Code `--output-format stream-json` 输出的顶层事件类型：

| type | 含义 | content 结构 |
|------|------|-------------|
| `system` | 系统初始化消息 | `{ message, subtype }` |
| `assistant` | 模型输出（嵌套 blocks） | `{ content: [{ type: "thinking"/"text"/"tool_use" }] }` |
| `user` | 工具结果反馈 | `{ content: [{ type: "tool_result" }] }` |
| `result` | 最终结果 | `{ result, text }` |

### Content Block 类型（嵌套在 assistant/user 内）

| block.type | 含义 | 前端展示 |
|------------|------|---------|
| `thinking` | 模型思考过程 | 黄色思考气泡 |
| `text` | 文本输出 | 紫色文本卡片 |
| `tool_use` | 工具调用（name + input） | 蓝色工具卡片 + 终端面板 |
| `tool_result` | 工具执行结果 | 结果卡片 + 终端面板 |

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
  type       TEXT NOT NULL,        -- 顶层事件类型
  content    TEXT NOT NULL,        -- JSON 序列化的事件内容（含嵌套 blocks）
  timestamp  INTEGER NOT NULL      -- Unix ms
)
```

## 设计决策

| 决策 | 理由 |
|------|------|
| Claude Code CLI subprocess 而非 SDK | 零开发成本复用全部 Agent 能力（工具调用、文件操作、Git、编排循环） |
| Node.js proxy 而非 LiteLLM | LiteLLM 1.83 Anthropic passthrough 走 Responses API 不兼容 Minimax；自建 proxy 零 Python 依赖，~300 行全控 |
| `--dangerously-skip-permissions` | subprocess 无交互式终端，无法手动批准工具权限 |
| 前端 flattenEvent() | stream-json 输出为嵌套 content blocks，需拆解为扁平列表才能逐项渲染 |
| WebSocket 而非 SSE | 双向通信，支持 start/stop/subscribe 指令 |
| SQLite 而非 Postgres | 单机部署，零运维，轻量存储 |
| CSS Modules 而非 Tailwind | 精确控制暗色主题设计系统，无额外构建依赖 |
| Vite 而非 Next.js | 纯 SPA，无需 SSR，最小化复杂度 |
| 统一 ANTHROPIC_API_KEY | proxy 和 subprocess 共用同一个 key，减少配置项 |
