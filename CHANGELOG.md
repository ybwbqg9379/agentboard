# Changelog

## [0.1.0] - 2026-03-31

### Added

- **Backend**: Express + WebSocket 服务 (port 3001)
  - Claude Code CLI subprocess 管理 (agentManager)
  - NDJSON stream-json 输出解析与事件分发
  - SQLite 会话/事件持久化存储 (sessionStore)
  - REST API: sessions 列表、详情、停止、状态查询
  - WebSocket: start/subscribe/stop 指令，实时事件推送
  - Agent 进程超时保护 (默认 10 分钟)

- **Frontend**: Vite + React 19 暗色 Dashboard
  - Header: 连接状态指示、New Session 按钮
  - ChatInput: 任务输入框，Run/Stop 切换
  - AgentTimeline: 核心时间线组件，展示 thinking/tool_use/tool_result/text 事件
  - TerminalView: 提取并展示 Bash 命令及输出
  - StatusBar: 运行状态、Session ID、事件计数
  - useWebSocket hook: 自动连接、重连、事件分发
  - 设计系统: CSS Variables 暗色主题，自定义滚动条，入场动画

- **LiteLLM**: 代理配置
  - Claude 模型名 (sonnet/haiku/opus) 全部映射到 MiniMax-M2.7-highspeed
  - Base URL: https://mydamoxing.cn/v1 (OpenAI Compatible)
  - drop_params 兼容性处理

- **项目基础设施**
  - 根 package.json 启动脚本 (dev/litellm/build)
  - .gitignore (node_modules, data, workspace, env files)
  - 设计文档 (docs/)
