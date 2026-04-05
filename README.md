# AgentBoard

AI Agent & Workflow 计算展示平台 —— 基于 Claude Agent SDK 编排框架，通过可视化引擎支持 **单Agent探索模式**、**DAG多Agent工作流模式** 与 **自动化实验研究模式 (AutoResearch)**。平台无缝接入任意 OpenAI 兼容大模型（如 DeepSeek, vLLM, 通义千问, GPT 等），并通过原生暗/浅色全自适应 Dashboard 实时展示思考、调试与工具执行全时序。

## 核心特性

- **三大引擎驱动**:
  - **Agent 模式**：通过 Claude SDK 指派单节点 Agent（Researcher、Code-Reviewer 等），支持对话续接与记忆。
  - **Workflow 模式**：拖拽式 DAG（有向无环图）编排面板。支持 **Agent 节点**、**条件分支节点 (Condition)**、**数据变换节点 (Transform)**、**实验节点 (Experiment)**，上下文透传与 `{{var}}` 模板变量替换。
  - **Experiment 模式 (AutoResearch)**：内置代码自动化迭代打分的棘轮机制（Ratchet Loop）。通过隔离在宿主机的基准测试提供 "提议-度量-回滚/提交" 的科学推演，并可无缝将其挂载入高级工作流。
- **现代化响应式 UI原生架构**:
  - 全流程自适应流体布局，不仅适配大屏数据看板，而且**完美支持移动端 (`< 768px`)**的垂直滑屏查阅和抽屉交互。
  - **全站 Light/Dark Theme** 动态切换。基于 CSS 语义 Variable 的设计体系，与操作系统 `prefers-color-scheme` 即时绑定并进行本地缓存记忆。
  - **富交互数据看板 (RightPanel)**：终端输出 (Terminal)、运行时变量 (Context 占比与计费)、文件分面 (Files：工具读写统计 + 工作区文件列表，可下载类型带下载入口)。**智能同事壳**另在输入框上方展示本会话可下载产物条。
- **无缝化模型适配器**: 原生搭载 Anthropic→OpenAI 转换代理中间件，0 阻塞直连市面任意提供 OpenAI-Compatible API 的本地或云端推理引擎。
- **Context Payload 深度优化**: Proxy 层自动压缩 SDK 内置 ~60KB System Prompt 至 ~3KB、剥离第三方不支持的 Thinking Block、截断冗长 Tool Schema，单次请求 Payload 降低 78%（107KB → 23KB），延迟降低 85%。
- **智能化动态编排 (Dynamic Orchestrator)**: 摒弃了将所有工具与插件“一把梭”灌输给模型的粗放式策略。内建 `Context Router` 会根据用户当前的话语意图、关键动作以及工作目录状态，毫秒级裁剪和自动按需挂载相关 MCP 组件与 Agent Skills，从源头消灭 Token 浪费与模型幻觉。
- **网络搜索与爬取能力 (Web Search & Crawling)**:
  - **三层 MCP 服务器**: Core（5 个）+ Search（Tavily / Exa / Brave）+ Crawl（Firecrawl / Fetch / Jina Reader），共计 11 个 MCP Server。
  - **意图路由引擎**: 双通语义分类（web-research / web-scraping / url-reading / data-analysis）自动按类别批量激活对应 MCP 组。
  - **编排 Skill**: `web-research`（搜索→爬取→分析→持久化）和 `data-extraction`（定位→提取→验证→导出）。
  - **条件加载**: API Key 存在时激活，缺失时静默跳过，零配置可启动。
- **企业级 SaaS 多租户隔离**:
  - **基于会话的硬隔离**：底层所有 Supabase PostgreSQL 查询通过应用层 `user_id` 过滤实现租户隔离。数据库层已预配置 RLS 行级安全策略（当前后端使用 secret key 绕过 RLS，策略将在接入 Supabase Auth 后自动生效）。每个 Session 在独立的 `workspace/sessions/{sessionId}/` 目录中执行，文件互不干扰。
  - **零信任 Docker 物理级沙箱 (`REPLTool`)**：摒弃宿主机命令执行模式。模型调用的 Node.js 开发/Python 分析脚本会强制映射到租户私有工作目录的零网络临时容器内执行防逃逸保护 (`< 256MB Memory, PidsLimit 50, NetworkMode: None`)。
- **Native MCP 自主编排中间件**:
  - 原生支持 **`TaskCreateTool`**: 遇海量任务时，主Agent可调用完全离线的子Agent进行任务并行分发、结算和摘要提取，并节约母体 Token 限额负担。
  - **`BatchTool` & `LoopTool`**: 原生支持并行并发及单任务强制循环批处理流转。
  - **`Independent Workers` (Local-First)**:
    - **`VisualizerTool`**: 本地 Mermaid 渲染。
    - **`DataAnalystTool`**: 本地 SQL 分析 (AlaSQL)。
    - **`OCRTool`**: 本地图像文本识别 (Tesseract.js)。
    - **`ReportTool`**: 本地 PDF (pdf-lib + fontkit)；优先 **`AGENTBOARD_PDF_FONT`**，默认捆绑 **Noto Sans SC (WOFF2)** 覆盖中英文字形；系统提示要求**交付型 PDF 必须使用本工具**（勿用 reportlab / wkhtmltopdf 等替代）。

## 架构概览

```
Browser ← (WS / Zod Validated) → Node.js Backend ←→ Claude Agent SDK (query)
 (Light/Dark SPA)                (Express :3001)           ↓    ↓
                                        ↑             +---------+---------+
                              (workflowEngine.js)     |   MCP Servers     |
                                        ↓             | Core: fs/github/  |
                               +-------------------+  |   memory/browser  |
                               | Remote Supabase    |  | Search: tavily/   |
                               | PostgreSQL (HTTPS) |  |   exa/brave       |
                               | 11+ tbl, JSONB RLS |  | Crawl: firecrawl/ |
                               +-------------------+  |   fetch/jina      |
                                                       +-------------------+
                                                                ↓
                                                      Anthropic→OpenAI Proxy
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

# Supabase (向团队管理员获取，或自建后填写)
# 自建指南：创建 Supabase 项目后执行 backend/migrations/ 下的 SQL 文件
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SECRET_KEY=sb_secret_your-secret-key

# [可选] Web 搜索与爬取能力（填写后自动激活对应 MCP Server）
# TAVILY_API_KEY=tvly-...    # AI 搜索 (tavily.com, 免费 1K 次/月)
# FIRECRAWL_API_KEY=fc-...   # 网页爬取 (firecrawl.dev, 免费 500 页/月)
# JINA_API_KEY=jina_...      # URL→Markdown (jina.ai, 免费基础额度)
# EXA_API_KEY=...            # 语义搜索 (exa.ai)
# BRAVE_API_KEY=...          # 隐私搜索 (brave.com/search/api, 免费 2K 次/月)

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

**持久化说明**：会话、工作流、实验、Swarm、记忆等全部由 **远程 Supabase 托管 PostgreSQL** 承担（`@supabase/supabase-js` 访问云端项目）；本地无需、也不使用 SQLite 等嵌入式数据库文件。

## API 文档与技术架构

AgentBoard 使用了复杂的流式数据处理和分发技术，包含 **远程** Supabase PostgreSQL 持久层（`sessionStore`、`workflowStore`、`experimentStore`、`swarmStore`、`memoryStore` 等），并设计有细粒度生命周期回调函数（Hooks）。

- 关于**系统架构、DAG工作流程流转过程与数据库 Schema** 的详细信息，请参阅 [架构与设计文档 (ARCHITECTURE.md)](ARCHITECTURE.md)。

## 开发规范与质量保障

我们通过严格的自动化流水线来保持极高的代码纯度：

- 代码格式遵循 Prettier（单引号、100 行宽）。
- 全仓 **885** 个 `Vitest` 用例（后端 **641** + 前端 **244**），覆盖 DAG 条件引擎、代理层、沙箱/MCP、`server` 关键 REST 路由、环境校验、请求关联，以及 Header / 用户壳时间线与会话文件 API 的 i18n 与可访问性回归。

您可以随时通过下发全局质量门禁命令来确保代码没有退化：

```bash
npm run check
```

_(此命令将链式触发 `format:check`、`lint:strict`、`i18n:check`、`build` 与 **Playwright** 冒烟用例。)_

同步建议执行全量测试（根目录）：

```bash
npm run test
```

需要 **V8 覆盖率报告**（终端摘要 + `coverage/index.html`）时：

```bash
npm run test:coverage
```

报告目录：`backend/coverage/`、`frontend/coverage/`（已忽略于 Git）。

更详细的工程门禁规范与测试说明请查阅 [开发贡献指南 (CONTRIBUTING.md)](CONTRIBUTING.md)。

## License

MIT
