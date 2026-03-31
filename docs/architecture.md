# AgentBoard Architecture

## 系统架构

```
+------------------+       +-------------------+       +--------------------+
|                  |  WS   |                   | SDK   |                    |
|   Browser        |<----->|   Node.js Backend |<----->| Claude Agent SDK   |
|   (React SPA)    |       |   (Express + WS)  |       | query() async iter |
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

2. 后端创建会话，调用 Claude Agent SDK
   server.js → agentManager.startAgent(prompt)
     → sessionStore.createSession(prompt)
     → query({ prompt, options: { cwd, permissionMode, systemPrompt, env } })

3. SDK 内部通过 proxy.js 调用 Minimax 模型
   SDK → ANTHROPIC_BASE_URL=localhost:4000/v1/messages
     → proxy.js 翻译 Anthropic → OpenAI
     → mydamoxing.cn/v1/chat/completions → 响应
     → proxy.js 翻译 OpenAI → Anthropic → SDK

4. SDK 产出结构化 SDKMessage 事件流
   for await (const message of stream) {
     // message.type: "system" | "assistant" | "result"
     // assistant 的 message.message.content 包含 content blocks
   }

5. 后端持久化到 SQLite，通过 WebSocket 推送
   agentManager → insertEvent() + agentEvents.emit()
     → server.js 广播给订阅了该 session 的 WebSocket 客户端

6. 前端扁平化渲染
   useWebSocket hook → events state
     → AgentTimeline: flattenEvent() 拆解嵌套 content blocks
     → TerminalView: 提取 Bash tool_use/tool_result
```

## 模块职责

### Backend

| 模块          | 文件              | 职责                                                  |
| ------------- | ----------------- | ----------------------------------------------------- |
| Config        | `config.js`       | 集中配置管理（端口、路径、超时、Minimax 端点）        |
| Session Store | `sessionStore.js` | SQLite CRUD，sessions + events 两表                   |
| Agent Manager | `agentManager.js` | SDK query() 调用、事件消费、生命周期管理              |
| Server        | `server.js`       | HTTP REST API + WebSocket 服务，事件广播              |
| Proxy         | `proxy.js`        | Anthropic Messages API → OpenAI Chat Completions 翻译 |

### Agent Manager (SDK 方式)

```javascript
import { query } from '@anthropic-ai/claude-agent-sdk';

const stream = query({
  prompt,
  options: {
    cwd: WORKSPACE,
    permissionMode: 'bypassPermissions',
    systemPrompt: '安全约束指令...',
    settingSources: [],        // 不加载用户配置
    env: { ANTHROPIC_BASE_URL, ... },
  },
});

for await (const message of stream) {
  // 结构化 SDKMessage，直接推送
}
```

### Proxy 翻译层 (proxy.js)

| 功能     | 说明                                                                       |
| -------- | -------------------------------------------------------------------------- |
| 消息转换 | Anthropic content blocks → OpenAI messages（text/tool_use/tool_result）    |
| 工具转换 | Anthropic tools (input_schema) → OpenAI tools (parameters)                 |
| 响应转换 | OpenAI choices → Anthropic content blocks + stop_reason                    |
| 流式转换 | OpenAI SSE chunks → Anthropic SSE events（content_block_start/delta/stop） |
| 参数映射 | system prompt、max_tokens、temperature、top_p                              |

### Frontend

| 模块           | 文件                | 职责                                                             |
| -------------- | ------------------- | ---------------------------------------------------------------- |
| WebSocket Hook | `useWebSocket.js`   | 连接管理、重连、消息解析、状态维护                               |
| Header         | `Header.jsx`        | Logo、版本、连接状态、New Session                                |
| ChatInput      | `ChatInput.jsx`     | 任务输入、Run/Stop 操作                                          |
| AgentTimeline  | `AgentTimeline.jsx` | flattenEvent() 拆解嵌套 blocks，按类型渲染（thinking/tool/text） |
| TerminalView   | `TerminalView.jsx`  | 提取嵌套 Bash tool_use/tool_result 渲染终端                      |
| StatusBar      | `StatusBar.jsx`     | 运行状态、Session ID、事件计数                                   |

## 事件类型

### SDKMessage 顶层类型

| type        | subtype            | 含义       | 内容                                        |
| ----------- | ------------------ | ---------- | ------------------------------------------- |
| `system`    | `init`             | 会话初始化 | session_id                                  |
| `system`    | `api_retry`        | API 重试   | 重试信息                                    |
| `system`    | `compact_boundary` | 上下文压缩 | --                                          |
| `assistant` | --                 | 模型输出   | `message.message.content` 含 content blocks |
| `result`    | --                 | 最终结果   | `result`（文本）、`stop_reason`、`is_error` |

### Content Block 类型（嵌套在 assistant 事件内）

| block.type    | 含义                     | 前端展示                |
| ------------- | ------------------------ | ----------------------- |
| `thinking`    | 模型思考过程             | 黄色思考气泡            |
| `text`        | 文本输出                 | 紫色文本卡片            |
| `tool_use`    | 工具调用（name + input） | 蓝色工具卡片 + 终端面板 |
| `tool_result` | 工具执行结果             | 结果卡片 + 终端面板     |

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
  type       TEXT NOT NULL,        -- SDKMessage type
  content    TEXT NOT NULL,        -- JSON 序列化的完整 SDKMessage
  timestamp  INTEGER NOT NULL      -- Unix ms
)
```

## 安全隔离

| 机制                                  | 说明                                                |
| ------------------------------------- | --------------------------------------------------- |
| `cwd: WORKSPACE`                      | Agent 工作目录限定                                  |
| `systemPrompt`                        | 每次任务注入目录约束指令                            |
| `workspace/CLAUDE.md`                 | Agent 行为规则文件                                  |
| `settingSources: []`                  | 不加载用户级 Claude Code 配置（MCP/hooks/settings） |
| `env: { HOME: WORKSPACE }`            | HOME 指向 workspace，阻止访问用户目录               |
| `permissionMode: 'bypassPermissions'` | 受控环境下自动批准工具调用                          |

## 设计决策

| 决策                                 | 理由                                                                                                       |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Claude Agent SDK 而非 CLI subprocess | 结构化事件流、无需解析 NDJSON、干净的生命周期管理、npm 依赖自动安装                                        |
| Node.js proxy 而非 LiteLLM           | LiteLLM 1.83 Anthropic passthrough 走 Responses API 不兼容 Minimax；自建 proxy 零 Python 依赖，~300 行全控 |
| `settingSources: []`                 | 完全隔离用户配置，subprocess 不加载用户的 MCP servers / hooks                                              |
| 前端 flattenEvent()                  | SDKMessage 的 assistant 事件包含嵌套 content blocks，需拆解为扁平列表渲染                                  |
| WebSocket 而非 SSE                   | 双向通信，支持 start/stop/subscribe 指令                                                                   |
| SQLite 而非 Postgres                 | 单机部署，零运维，轻量存储                                                                                 |
| CSS Modules 而非 Tailwind            | 精确控制暗色主题设计系统，无额外构建依赖                                                                   |
| Vite 而非 Next.js                    | 纯 SPA，无需 SSR，最小化复杂度                                                                             |
