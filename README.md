# AgentBoard

AI Agent & Workflow 计算展示平台 —— 基于 Claude Agent SDK 编排框架，通过可视化引擎支持 **单Agent探索模式** 与 **DAG多Agent工作流模式**。平台无缝接入任意 OpenAI 兼容大模型（如 DeepSeek, vLLM, 通义千问, GPT 等），并通过原生暗/浅色全自适应 Dashboard 实时展示思考、调试与工具执行全时序。

## 核心特性

- **双引擎驱动**:
  - **Agent 模式**：通过 Claude SDK 指派单节点 Agent（Researcher、Code-Reviewer 等），支持对话续接与记忆。
  - **Workflow 模式**：拖拽式 DAG（有向无环图）编排面板。支持 **Agent 节点**、**条件分支节点 (Condition)**、**数据变换节点 (Transform)**，上下文透传与 `{{var}}` 模板变量替换。
- **现代化响应式 UI原生架构**:
  - 全流程自适应流体布局，不仅适配大屏数据看板，而且**完美支持移动端 (`< 768px`)**的垂直滑屏查阅和抽屉交互。
  - **全站 Light/Dark Theme** 动态切换。基于 CSS 语义 Variable 的设计体系，与操作系统 `prefers-color-scheme` 即时绑定并进行本地缓存记忆。
  - **富交互数据看板 (RightPanel)**：终端输出(Terminal)、运行时变量(Context 占比与计费)、读写文件统计(Files) 分面设计。
- **无缝化模型适配器**: 原生搭载 Anthropic→OpenAI 转换代理中间件，0 阻塞直连市面任意提供 OpenAI-Compatible API 的本地或云端推理引擎。
- **智能化动态编排 (Dynamic Orchestrator)**: 摒弃了将所有工具与插件“一把梭”灌输给模型的粗放式策略。内建 `Context Router` 会根据用户当前的话语意图、关键动作以及工作目录状态，毫秒级裁剪和自动按需挂载相关 MCP 组件与 Agent Skills，从源头消灭 Token 浪费与模型幻觉。
- **国防级沙盒安全**:
  - 核心拦截：环境变量隔离，限定执行路径(`/usr/local/bin`, `/bin`等)，杜绝绝对路径跨目录穿越（`sed`/`awk`/`rm -rf /` 防护）。
  - API Key 门禁：内建 Express 层级的 Zod 准入拦截校验与 Bearer Token 鉴权（REST 及 WebSocket Query Param 分别注入）。
  - 组件隔离：五个独立 MCP 服务器 (Node.js/Playwright) 按需挂载子进程安全通讯。

## 架构概览

```
Browser ← (WS / Zod Validated) → Node.js Backend ←→ Claude Agent SDK (query)
 (Light/Dark SPA)                (Express :3001)           ↓    ↓
                                        ↑             +---------+---------+
                              (workflowEngine.js)     |     MCP Servers   |
                                        ↓             | filesystem/github |
                               +----------------+     | memory/playwright |
                               |  2x SQLite DB  |     +-------------------+
                               |  (sessions)    |               |
                               |  (workflows)   |               ↓
                               +----------------+     Anthropic→OpenAI Proxy
                                                                ↓
                                                     Any Compatible LLM API
                                                 (DeepSeek/vLLM/OpenAI/Groq..)
```

## 环境要求

- Node.js 20+

_注：无需全局手动安装 Claude Code CLI，框架内自带核心 SDK_

## 快速开始

### 1. 安装依赖

```bash
# 一键安装所有根目录与子服务依赖（借助 concurrently）
npm install
```

_(或者单独进入 `backend` / `frontend` 分频安装)_

### 2. 配置环境变量

复制 `.env.example` 为 `.env.local` 并填写配置：

```bash
cp .env.example .env.local
```

修改 `.env.local` 文件，配置你心仪的语言模型（任何兼容 OpenAI 规范的 API 均可）：

```env
LLM_BASE_URL=https://api.openai.com/v1     # 或自定义 URL, 譬如本地的 Ollama/vLLM http://localhost:11434/v1
LLM_API_KEY=sk-your-llm-provider-api-key
LLM_MODEL=gpt-4o-mini                      # 或 deepseek-chat 等

# [可选安全配置] 对外暴露服务时极其重要
# AGENTBOARD_API_KEY=your_secure_password
```

### 3. 一键启动

```bash
npm run dev
```

该命令并行启动三大核心服务：

- **proxy** (黄色) -- 核心协议翻译器及反向代理 `:4000`
- **back** (蓝色) -- Express API & 协程调度引擎 `:3001`
- **front** (绿色) -- Vite SPA 数据驾驶舱 `:5173`

打开浏览器访问 `http://localhost:5173`。

## API 文档与技术架构

AgentBoard 使用了复杂的流式数据处理和分发技术，包含了双 SQLite 数据集 (`sessionStore`, `workflowStore`)，并设计有细粒度生命周期回调函数（Hooks）。

- 关于**系统架构、DAG工作流程流转过程与数据库 Schema** 的详细信息，请参阅 [架构与设计文档 (ARCHITECTURE.md)](ARCHITECTURE.md)。

## 开发规范与质量保障

我们通过严格的自动化流水线来保持极高的代码纯度：

- 代码格式遵循 Prettier（单引号、100 行宽）。
- 高达 400+ 个的 `Vitest` 单元/集成测试用例覆盖所有的 DAG 条件引擎运算和代理层转译算法。

您可以随时通过下发全局质量门禁命令来确保代码没有退化：

```bash
npm run check
```

_(此命令将链式触发 `format:check`预检、`lint:strict`极严检查 和 `build` 打包编译)_

更详细的工程门禁规范、本地运行测试用例请查阅项目内的 [开发贡献指南 (CONTRIBUTING.md)](CONTRIBUTING.md)。

## License

MIT
