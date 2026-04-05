# Onboarding 快速上手指南

欢迎来到 **AgentBoard**！这份指南专门为您（无论是打算 Clone 进行本地部署，还是 Fork 进行二次开发）准备，旨在帮助您在 5 分钟内搭建并运行您的第一个 AI Agent 工作流。

我们的目标是真正的 **开箱即用 (Plug-and-play)**：无需安装任何系统级依赖、不需要折腾 Python 虚拟环境，更不需要安装笨重的数据库。

---

## 1. 环境准备 (Prerequisites)

在开始之前，请确保您的本地开发环境满足以下条件：

- **Node.js**: 版本在 **20.x** 或更高。
- **Git**: 已安装且正常配置。

> [!NOTE]  
> 您 **不需要** 在全局安装原始的 `claude-code` CLI。我们的引擎在底层直接桥接了 `@anthropic-ai/claude-agent-sdk` 依赖包。
> 系统数据存储使用 **远程** Supabase 托管 PostgreSQL（通过 `SUPABASE_URL` 连接云端项目），无需在本机安装或启动数据库进程，也不使用本地 `.db` 文件。向团队管理员获取 `SUPABASE_URL` 和 `SUPABASE_SECRET_KEY` 即可。
> 如需自建 Supabase 实例，请在 [Supabase](https://supabase.com) 创建项目后，执行 `backend/migrations/` 下的 SQL 文件初始化表结构。

---

## 2. 克隆与依赖安装

1. **克隆代码库**:

   ```bash
   git clone https://github.com/your-username/agentboard.git
   cd agentboard
   ```

2. **自动安装全端依赖**:
   ```bash
   # 这一条指令将自动并发安装根目录、后端以及前端工作区的所有依赖
   npm install
   ```

---

## 3. 环境变量与安全配置

AgentBoard 会通过项目内置的智能拦截层 `proxy.js` 与各类大语言模型通信。这个代理中间层会将 Anthropic SDK 的请求自动翻译为标准化的 **OpenAI Completions API** 格式。这意味着您可以实现 **任意** 现代大模型的无缝热插拔（DeepSeek, vLLM 部署的本地大模型, 通义千问, GPT 等）。

1. **从模版克隆本地环境变量文件**:

   ```bash
   cp .env.example .env.local
   ```

2. **编辑 `.env.local`**:
   使用任意编辑器打开 `.env.local`，以下是系统运转最核心的参数：

   ```env
   # 1. 配置兼容 OpenAI 协议的 API 端点
   # 示例:
   #   DeepSeek: https://api.deepseek.com/v1
   #   Ollama (本地部署): http://localhost:11434/v1
   LLM_BASE_URL=https://api.openai.com/v1

   # 2. 您的服务商 API 密钥
   LLM_API_KEY=sk-your-provider-api-key

   # 3. 指定 Agent 引擎将要调用的具体模型名
   LLM_MODEL=gpt-4o-mini

   # 4. Supabase 数据库连接 (向团队管理员获取，或自建后填写)
   SUPABASE_URL=https://your-project-ref.supabase.co
   SUPABASE_SECRET_KEY=sb_secret_your-secret-key
   ```

   **[可选] Web 搜索与爬取能力：** 填写以下 API Key 后，对应的 MCP Server 会自动激活，不填则跳过：

   ```env
   # AI 搜索 — https://tavily.com (免费 1K 次/月)
   TAVILY_API_KEY=tvly-your-key

   # 网页爬取 — https://firecrawl.dev (免费 500 页/月)
   FIRECRAWL_API_KEY=fc-your-key

   # URL→Markdown — https://jina.ai (免费基础额度)
   JINA_API_KEY=jina_your-key

   # 语义搜索 — https://exa.ai
   EXA_API_KEY=your-exa-key

   # 隐私搜索 — https://brave.com/search/api (免费 2K 次/月)
   BRAVE_API_KEY=your-brave-key
   ```

> [!IMPORTANT]  
> **安全警示 (`AGENTBOARD_API_KEY`)**
> 如果您打算将该项目部署至公网环境提供服务，您 **必须** 在 `.env.local` 中设置 `AGENTBOARD_API_KEY` 变量。设定后，它将立即拉起一堵强力的 Bearer Token 协议防火墙，保护 REST 接口与 WebSocket ，彻底拦截未经授权的远端命令执行（RCE）渗透尝试。

---

## 4. 启动平台

在根目录下一键拉起整个微服务集群：

```bash
npm run dev
```

启动后，您的终端中会亮起三种颜色的日志流：

1. `[proxy]` (端口 4000): LLM 通信代理，负责执行请求翻译和包体透传。
2. `[back]` (端口 3001): Express + WebSocket 服务中枢，挂载着 DAG 调度引擎以及 Supabase 云端数据库。
3. `[front]` (端口 5173): Vite React 前端 SPA 数据驾驶舱。

**下一步**: 您的应用现已启动。请打开浏览器并访问 **[http://localhost:5173](http://localhost:5173)**。

---

## 5. 快速导航：完成您的初次探索

### 模式 A: Agent 对话编排 (Agent Chat)

1. 在系统左上角的 Header 选项卡中，选中 **Agent** 模式。
2. 在底部的输入栏中输入指令（例：_“帮我写一段能收集当地天气的 Python 脚本并执行”_）。
3. 观察左侧面板的 **Timeline (时间线)** 如何实时演进：您能捕捉到 Agent 的自我规划、MCP 浏览器与文件等工具的调用，甚至其在控制台下发底层 Shell 命令的全过程。
4. 打开右侧抽屉式 **Right Panel (数据监控台)** 来剖析原始终端日志 (`Terminal`)、模型 Token 的吞吐计费条 (`Context`) 以及文件 I/O 监控记录 (`Files`)。

### 模式 B: DAG 工作流引擎 (Workflow Engine)

1. 切换顶部的 Header Tab 至 **Workflow** 模式。
2. 您将进入一望无际的 SVG 无极交互画布。
3. 从控制面板拖拽出所需的原子节点：
   - **Input Node (输入)**: 定义启动参数，如 `{{topic}}`。
   - **Agent Node (专家)**: 设定角色的 prompt 特征词、模板变量，限制轮次与越权保护边界。
   - **Condition Node (路由)**: 利用表达式分叉执行流（例如 `status == "success"`）。
4. 通过拖拽输出端（右侧白点）连接至下一节点的输入端（左侧白点），点击表单进行 **Save (保存)** 并选择 **Run (执行)**。

---

## 6. 继续进阶与功能开发

大功告成，您现在已经完全掌握了项目结构！如果您打算在底层做修改或提交 PR，我们为您准备了以下路标文档：

- **内部架构透视**: 好奇 `workflowEngine.js` 如何调度工作流？WebSocket 的 5 种状态机是如何流转的？搜索/爬取 MCP 是如何分层激活的？请参阅位于根目录的 [`ARCHITECTURE.md`](ARCHITECTURE.md)。
- **代码规范与自动化测试**: 我们对于入库的代码执行极严标准；当前全仓约 **867** 个 Vitest 用例（后端 637 + 前端 230）。提交代码或发起 PR 之前可在根目录运行 `npm run test`；需要覆盖率时可运行 `npm run test:coverage`。`npm run check`、Husky `pre-commit` 与更细说明见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。

开心编程，尽情打造您的超级 Agent 平台！
