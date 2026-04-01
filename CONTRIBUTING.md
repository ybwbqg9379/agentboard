# 贡献指南 (Contributing to AgentBoard)

感谢您花时间为 AgentBoard 贡献代码！为了保证项目持续处于 “可交付部署”（Plug-and-play）状态，请务必阅读以下内部迭代与工程红线规范。

## 一、开发环境初始化与构建

1. **环境准备**：克隆项目后，需要确保您的 Node.js 环境在 **20+** 以上。
2. **三端同开**：推荐在具有充足屏幕空间的设备上使用 `npm run dev` 启动前端、后端以及 Proxy。
3. **API Key 获取**：在根目录拷贝建立 `.env.local` 即可，详细参数列表见 `.env.example`。

## 二、测试先行 (Testing Guidelines)

AgentBoard 是一个核心逻辑极其复杂的编排引擎。我们使用 `Vitest` 框架并已积累了超过 **528 个单元与集成测试用例**。

### 1. 运行测试

修改任何代码后，请务必运行测试：

```bash
# 后端测试
cd backend
npx vitest

# 前端架构测试
cd frontend
npx vitest
```

### 2. 补齐要求

如果您新增了类似于 Workflow 的 DAG 调度引擎逻辑、修改了一类 `node` 节点机制、或是调整了 Agent 侧的 `Hooks`（安全边界），**必须同步增加相关的测试断言用例**以保证 100% Core API 的通过率。

## 三、构建门禁与代码风格 (CI & Formatting)

本项目配置了极严级别的 CI 拦击管线。在您提交 Pull Request 或 Commit 代码前，系统将会发起拦截评估。

### 1. 全局门禁体检

推荐您在代码修改完毕后，从根目录执行一键体检：

```bash
npm run check
```

该命令将按顺序触发：

- `npm run format:check`：由 Prettier 接管，确保文件完全符合作者指定的格式 (无单引号转抛、行宽 100 等)。
- `npm run lint:strict`：由 ESLint 接管，**零警告 (Zero Warning) 容忍**。
- `npm run build`：确保 Vite 生产构建打包一切正常。

### 2. Husky Hook 防治

项目已经集成基于 Husky 的 `pre-commit` 门禁，如果您绕过格式器试图强行提交流程，极大概率会被 Hooks 在本地级驳回。

另外，请注意 ** CHANGELOG.md 常态化更新**：如果有影响项目体验的 feature 交付，必须同步将其记录倒未发布版本的 Changelog 内，避免文档漂移。

## 四、前端 UI 开发原则

1. **CSS 变量化 (Semantic Tokens)**：新 UI 元素禁止混用孤立的 `#hex` 色值。所有的颜色体系均依赖于 `index.css` 的系统变量。请务必测试你的组件在 **Light / Dark** 环境中，且具备 `*:focus-visible` 无障碍大纲。
2. **全移动端兼容**：新设计的任何组件或配置面板应当运用在移动端(`< 768px`)环境自适应堆叠/Drawer化隐藏策略。不遮挡画布且无横向滚动条溢出。

## 五、后端提交原则

1. **Zod 强制校验**：进入 `Express` 层的 Rest API 和 `WebSocket` 的 Query 或 Socket Message 层，**必须要有 Zod Object Schema 定义并参与过滤**，不允许产生不安全的 Payload 解除引用漏洞。
2. **文件防护**：如果是操作了类似于 Terminal bash 脚本下发相关的代码，必须通过安全审查评估白名单是否可以越权访问主机关键敏感分区。

再次感谢！有了您的完善，AgentBoard 的 Agent 宇宙定能生生不息。
