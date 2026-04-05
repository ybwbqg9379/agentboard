# AgentBoard UI 设计约定（Design Tokens）

面向人机共读：与 [Stitch DESIGN.md](https://stitch.withgoogle.com/docs/design-md/overview/) 同类，说明 **语义 Token**、**双主题轴**、**响应式** 与 **i18n** 约束。实现侧见 `src/styles/`、`src/index.css` 的 `@import` 顺序，以及 `src/i18n.js`。顶栏版本号 **`v…`** 来自构建时注入的 **`__APP_VERSION__`**（**`vite.version-define.js`** 读取**仓库根** **`package.json`** 的 **`version`**，**`vite.config.js`** 与 **`vitest.config.js`** 共用，避免测试与运行不一致）。

## 1. 双轴主题（必守）

| 轴           | HTML                                       | 取值                                                                                     | 作用                                                                                                                                                                                                                                                |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **明暗**     | `document.documentElement` 上 `data-theme` | `light` \| `dark`                                                                        | 同一套语义变量在亮/暗下的取值；与系统 `prefers-color-scheme` 的首次默认一致，可本地存储覆盖。                                                                                                                                                       |
| **调色板包** | `data-theme-pack`（可选）                  | `default` \| `linear` \| `vercel` \| `cursor` \| `warp` \| `apple` \| `claude`（见下表） | 覆盖 **色 / 状态色** 与 **`--font-sans` / `--font-mono`**（及 **`claude`** 下的 **`--font-display`**）；**不**改间距、圆角等布局 Token。                                                                                                            |
| **布局密度** | `data-density`（可选）                     | 缺省 = **舒适**；`compact` = **紧凑**                                                    | 试点：**顶栏 / 底栏 / 输入区** 高度与壳层内边距（见 `foundation.css` 中 `--header-height`、`--chat-composer-*` 等）。持久化键 **`agentboard-density`**：仅 **`compact`** 写入；舒适模式 **不写**（`removeItem`），与「不写 `data-density`」一致。   |
| **界面壳层** | `data-ui-shell`（可选）                    | 缺省 / `pro` = **控制台**；`agent` = **智能同事（Agent）壳**                             | 仅在 **Agent** 模式下生效：单列进展 feed + 用户向输入区；终端/上下文/文件进抽屉。持久化键 **`agentboard-ui-shell`**：仅 **`agent`** 写入。切换到 **`agent`** 且当前为 **`default`** 调色板时，应用层会将调色板设为 **`claude`**（与下方蓝图一致）。 |

规则：

- **任意 `theme-pack` 都必须同时提供 `light` 与 `dark` 下的变量覆盖**（见 `themes/packs/*.css`）。
- 新增主题包时，选择器形如：`html[data-theme-pack='name']` 与 `html[data-theme-pack='name'][data-theme='dark']`，避免只覆盖一侧。

**已登记主题包**（实现：`src/styles/themes/packs/<name>.css`；参考 awesome-design-md）：

| `data-theme-pack` | 参考文档                                                                            |
| ----------------- | ----------------------------------------------------------------------------------- |
| `linear`          | `design-md/linear.app/DESIGN.md`                                                    |
| `vercel`          | `design-md/vercel/DESIGN.md`                                                        |
| `cursor`          | `design-md/cursor/DESIGN.md`                                                        |
| `warp`            | `design-md/warp/DESIGN.md`                                                          |
| `apple`           | `design-md/apple/DESIGN.md`                                                         |
| `claude`          | `awesome-design-md/design-md/claude/DESIGN.md`（Anthropic 公开站提炼，作 **蓝图**） |

### Claude 蓝图与 AgentBoard 自定义

- **蓝图来源**：[VoltAgent / awesome-design-md 中 `design-md/claude/DESIGN.md`](https://github.com/VoltAgent/awesome-design-md)（暖色羊皮纸、陶土主色 `#c96442`、暖灰阶、深色 `#141413` / `#30302e`、**Focus Blue `#3898ec` 仅用于 focus** 等）。
- **映射方式**：`themes/packs/claude.css` 将上述角色写入既有语义 Token（`--bg-*`、`--text-*`、`--border-*`、`--status-*`、`--bg-accent`、`--on-accent`、`--font-display`）；组件仍只依赖语义名，不直接写陶土 hex。
- **有意自定义**：布局与圆角沿用全仓 `foundation.css`（非 Claude 文档中的 12px 输入大圆角全盘替换）；正文字体用 **Inter** 代替专有 Anthropic Sans、等宽用 **JetBrains Mono**；状态色在暖底上微调对比度；**Lucide** 图标体系不变（与 Claude 营销页的插画策略不同）。
- **用户壳动效**：`--motion-duration-*` 与 `cubic-bezier` 见 `foundation.css`；`UserAgentTimeline` / 详情抽屉遵守 **`prefers-reduced-motion: reduce`**。
- **用户壳 Composer 页脚**：根层 **`WorkspaceFilesProvider`**（`sessionId` + **`events.length`** debounce）统一拉取 **`workspace-files`**，供底部 **`SessionDownloadablesStrip`** 与技术详情内 **`FileChangesPanel`** 共用；`App.jsx` 将 Strip 与 **`ChatInput variant="user"`** 包在 **`user-shell-composer-footer`** 内；`index.css` 在 **`:has(.session-downloadables-dock)`** 时为页脚施加与输入区一致的 **`bg-tertiary`** 与上阴影，并去掉紧随其后的 **`form`** 顶边，使「可下载文件」与输入框视觉连成一块。进展区仅展示助手向时间线（工具细节进抽屉）。

**主题包字体**（首个 `html[data-theme-pack='…']` 规则内设置；中文统一回退 **`PingFang SC` / `Hiragino Sans GB` / `Microsoft YaHei`**）：

| `data-theme-pack` | `--font-sans` / `--font-mono`（摘要）                             | 实现说明                                                                                       |
| ----------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `default`         | 继承 `foundation.css`                                             | `index.html` 加载 **Inter** + **JetBrains Mono**（Google Fonts）                               |
| `linear`          | **Inter** / **JetBrains Mono**                                    | 与 Linear 文档一致（Mono 以 JetBrains 代 Berkeley Mono）                                       |
| `vercel`          | **Geist Sans** / **Geist Mono**                                   | **Fontsource**，**按需** `import('./styles/fonts-pack-vercel.css')`（见下）                    |
| `cursor`          | **DM Sans** / **IBM Plex Mono**                                   | **Fontsource**，**按需** `fonts-pack-cursor.css`                                               |
| `warp`            | **Sora** / **IBM Plex Mono**                                      | **Fontsource**，**按需** `fonts-pack-warp.css`                                                 |
| `apple`           | **system SF 栈** / **SF Mono**                                    | **不加载** Fontsource；非 Apple 平台回退 **Segoe UI** / 系统 ui-monospace                      |
| `claude`          | **Inter** / **JetBrains Mono** + **`--font-display`: Georgia 系** | 与 Claude 文档「Sans / Mono 外置实现」一致；**标题气质**用 serif 栈（用户壳 `feedHeading` 等） |

**Webfont 加载策略**（性能）：**不要**在 `main.jsx` 静态引入「全部」主题包字体。实现：`src/themePackConstants.js` 登记 **`THEME_PACK_ALLOWLIST`** 与 **`THEME_PACK_WEBFONT_IMPORTERS`**（仅 `vercel` / `cursor` / `warp`）；`src/themeFontLoader.js` 的 **`preloadStoredThemePackFonts()`** 在 **`createRoot().render()` 之前**按 `localStorage` 预加载对应 chunk；`App` 在 **`themePack` 变更**时再次 **`ensureThemePackFontsLoaded`**，避免切换包后缺字重。`default` / `linear` 仅用 `index.html` 字体；**`apple` 不请求任何 Fontsource 文件**。

## 2. 语义 Token（组件应只依赖这些）

命名保持稳定，换主题包时只改映射表，不改组件类名：

- **表面**：`--bg-primary`、`--bg-secondary`、`--bg-tertiary`、`--bg-elevated`、`--bg-hover`
- **边框**：`--border-primary`、`--border-secondary`、`--border-accent`、`--border-color`
- **文字**：`--text-primary`、`--text-secondary`、`--text-tertiary`、`--text-accent`
- **交互强调**：`--bg-accent`（与链接/选中态等对齐）、`--on-accent`（主 CTA 上前景色，如运行按钮）
- **展示标题（可选）**：`--font-display`（如 `claude` 包下 Georgia 栈，用于用户壳标题气质）
- **状态**：`--status-running`、`*-thinking`、`*-error`、`*-done`、`*-tool` 及对应 `*-rgb`（供 `rgba(...)`）
- **结构**：`--font-sans`、`--font-mono`、`--space-*`、`--radius-*`、`--header-height` 等（见 `tokens/foundation.css`）
- **密度相关布局**（实验页等）：与侧栏/堆叠高度相关的魔法数应优先落在 **`foundation.css`**（如 **`--experiment-sidebar-mobile-max-height`**），组件内 **避免裸 `px` 高度**（`letter-spacing` 等排版微调用 `px` 可保留）。

禁止在业务组件中新增「一次性 hex」；若某屏需要品牌扩展色，先在本文档与 `agentboard.css` / 主题包中登记语义名。

## 3. 响应式与交互

- **断点**：主断点为 `max-width: 768px`（与现有布局一致：竖向堆叠、`main-content`、顶栏压缩等）。顶栏控件区在 **`min-width: 520px` 且 `≤768px`** 时可将 **chromeCluster** 排成 **四列一行**（更吃满横屏手机宽度）。
- **整页横向滚动**：壳层（`html` / `body` / `#root` / `.app-layout` / 主栏网格）使用 **`overflow-x: clip`**（或等价约束）与 **`minmax(0, 1fr)`**，避免出现「只允许纵向滚动」以外的整页水平滑动；面板内容区可对 **`overflow-x: clip`**，长文案用 **`overflow-wrap`** / 省略号。
- **`overflow-x: clip` 与 `position: sticky`**：在 CSS 中，祖先若对横向使用 **`overflow: clip`**（或 `hidden`），可能使后代 **`position: sticky`** 失效。当前仓库 **未** 依赖 sticky 顶栏；若将来在可横向裁剪的容器内做粘性表头/侧栏，需改为 **`overflow-x: visible`** 在该轴、或把 sticky 节点移到不裁剪的祖先下。
- **下拉菜单宽度**：`Dropdown` 菜单 **`max-width`** 基准为 **`calc(100vw - 16px)`**；仅在 **`@supports (width: 100dvw)`** 时使用 **`min(100vw, 100dvw)`** 变体，避免旧版 Safari 因不识 **`dvw`** 而丢弃整条声明。
- **触控**：小屏上保留可点区域与现有 `Header` 按钮尺寸；主题包 **不得** 删除 `@media (max-width: 768px)` 下的关键规则。
- **滚动条**：移动端隐藏 WebKit 滚动条的规则保留，避免与抽屉/面板重叠。

新增页面时沿用 **移动优先或至少 768 补一套** 的策略，避免只在桌面测通。

### 3.1 顶栏（Header）

**信息架构（与 DOM 顺序一致）**

1. **界面壳**（仅 **`mode === 'agent'`** 时渲染 **`.shellTabs`**）：**Console**（`pro`）/ **Agent**（`agent` 用户壳）。桌面：与 Logo、版本、模式条同一行；**窄屏（`≤768px`）**：**`.left` 为纵向 flex**，**第一行**为 **`.shellTabs` 全宽**（两枚分段按钮均分）。
2. **模式**：**`.modeTabs`** 三等分 **`Agent` / `Workflow` / `Experiment`**。**用户壳**且 **`mode=agent`** 时 **不渲染** **`.modeTabs`**（无第二行；进入工作流/实验须先切回 **控制台** 壳再选模式）。**控制台壳**或 **`mode` 为 workflow/experiment** 时照常显示 **`.modeTabs`**。桌面：接在壳/Logo 右侧；**窄屏**：有 **`.modeTabs`** 时第二行全宽、三等分。
3. **Chrome 工具区**（`.chromeCluster`）：四个 **`Dropdown` `variant="compact"`**，窄屏 **`triggerFluid`** 使触发条在网格单元内 **拉满宽度**。
   - **第一组（国际化与外观基底）**：**语言**、**明暗模式**（`light` \| `dark`，`App` 经 **`onThemeChange={setTheme}`** 写 `data-theme`；**不再**使用日月图标按钮）。
   - **第二组（语义色与版面密度）**：**UI 调色板包**（`data-theme-pack`）、**布局密度**（`data-density`）。  
     窄屏默认 **2×2 网格**（上排 语言｜明暗，下排 调色板｜密度）；**520px–768px** 为 **四列一行**。
4. **尾部条**（`.trailingCluster`）：**`trailingLead`**（可选 **MCP** 状态点 + Agent 模式下 **History** / **New Session** / 用户壳下 **Details**）与 **连接状态**（`.connStatus`）并列。窄屏为 **`grid-template-columns: minmax(0, 1fr) auto`**：**左侧**会话相关操作 **左对齐**，**History** 在 `.sessionActions` 内可 **`flex: 1`** 吃满剩余宽；**右侧**连接状态 **`justify-self: end`**。
   - **分割线**：`.trailingCluster` **上边框**与 2×2 区之间：`.right` 子项 **`gap: var(--space-md)`**；分割线与首行控件之间 **`padding-top: var(--space-md)`**，底部 **`padding-bottom: var(--space-xs)`**。
   - **连接状态**：全局（含桌面）**`.connStatus`** 使用与顶栏按钮一致的 **`padding`**（`--header-btn-padding-y` / `--header-btn-padding-x`）与圆角；窄屏叠加 **背景 + 边框** 与略大的横向 **`padding`**，与 **History** 芯片视觉对齐。装饰性图标 **`aria-hidden`**；容器设 **`role="status"`、`aria-live="polite"`、`aria-label` / `title`**（窄屏隐藏「已连接」文案时读屏仍可读）。

**桌面**：`.header` 为横向 flex；`.right` 内 **chromeCluster** 与 **trailingCluster** 仍为一行内 **`justify-content: flex-end`** 排列（顺序：四个下拉 → MCP/会话按钮 → 连接状态）。

**实现文件**：`src/components/Header.jsx`、`Header.module.css`；明暗选项文案 **`header.themeLight` / `themeDark` / `themeModeTitle`**；下拉全宽修饰类 **`Dropdown.module.css` 的 `.triggerFluid`**（仅 `≤768px` 生效）。

## 4. 多语言（i18n）

已接入 **react-i18next**：`src/i18n.js` 初始化，`src/locales/en.json` 与 `zh-CN.json` 为文案源；`localStorage` 键 `agentboard-locale`；`document.documentElement.lang`、**`document.documentElement.dir`**（LTR/RTL）与 **`document.title`**（`common.appTitle`）随语言更新。

核心壳与 **Workflow / Experiment / Timeline / 终端与侧栏** 等已走 `t()` / `i18n.t()`；新增 key 时 **禁止整句硬编码拼接**，复杂句用 `t('key', { var })`；需要展示给用户的 `{{…}}` 模板字面量勿放进 JSON（避免被插值吞掉），可拆成 prefix/suffix 或在 JSX 中写死花括号段。

**门禁**：仓库根目录 `npm run i18n:check`（`scripts/check-i18n.mjs`）校验 en ↔ zh 键与占位符一致、源码中的静态 key 在 `en.json` 存在、动态 `t(\`prefix.\${…}\`)`前缀下至少有一条翻译、**禁止裸变量**`t(foo)` 与 **`t('…' + …)`** 拼接 key；这类非法写法会按**整个调用跨度**扫描，跨多行也会命中。属性访问只允许 **`_.labelKey`/`_.titleKey`/`_.descriptionKey`/`_.messageKey`** 这几类受支持的间接 key 引用，其对应字符串值仍须被间接 key 扫描命中；任意 `t(row.badKey)`一类访问会直接报错。任一调用跨度内带`// i18n-exempt` 可豁免；并默认扫描 **未使用的 en 键**（紧急跳过：`I18N_SKIP_UNUSED=1`）。日期/数字格式逐步用 `Intl`与当前`lang` 对齐。文案使用 **i18next 插值**（`{{var}}` 等），非 ICU MessageFormat；若引入 ICU 需另加校验。

**RTL**：`i18n.js` 在语言切换时对 `ar` / `he` / `fa` / `ur` 设 `dir="rtl"`，其余为 `ltr`；新增 RTL 语言时把关键布局改为逻辑属性（`margin-inline-*`）。

**设计**：长文案语言下注意顶栏多个 **compact** 下拉的 **`max-width` / 省略**（见 `Dropdown.module.css` 与 `Header.module.css`）；窄屏依赖 **`triggerFluid`** 与 **2×2 / 四列** 网格避免截断失控或撑破视口。

本文件随主题包与断点演进更新；新增 `themes/packs/<name>.css` 后在此登记名称与参考来源（如 awesome-design-md 路径）。

## 5. 图标（Lucide / `lucide-react`）

- **唯一图标体系**：界面中表达「动作 / 状态 / 对象类型」的图形符号，统一使用 **[Lucide](https://lucide.dev/)** 的 React 包 **`lucide-react`**（与社区常说的 “Lucide icons” 同义）。禁止用 **emoji**、禁止把 **Unicode 符号**（如 `×`、`→`、`▶`、`+` 前缀等）当作图标替代；**文案里**仅用文字描述，**图标**由组件渲染。
- **典型映射**（示例，非穷举）：关闭 `X`、删除 `Trash2`、确认/保存 `Check`、运行 `Play`、停止 `Square`、发送 `Send`、继续 `ArrowRight`、刷新 `RefreshCw`、返回 `ArrowLeft`、新建/添加节点 `Plus`、下载 `FileDown`、**明暗模式**由顶栏 **Dropdown** 切换（不再用 `Sun`/`Moon` 图标按钮）、历史 `History`、下拉 `ChevronDown`、加载 `Loader2`（可配合 CSS 旋转）、趋势 `TrendingUp`、连接 **Wifi** / **WifiOff** 等。
- **尺寸与描边**：默认 `strokeWidth={2}`；顶栏/工具条常用 **14–16px**；列表内徽标可 **11–13px**。保持 `currentColor` 以继承 `--text-*` / 按钮前景色。
- **无障碍**：装饰性图标加 **`aria-hidden`**；仅图标的按钮用 **`aria-label` / `title`**（或可见文案足够时仅隐藏图标）。`ConfirmDialog` 标题栏关闭钮使用 `confirmDialog.dismiss` 作为 `aria-label`。
- **布局**：图标与文案并排时使用 **`display: inline-flex; align-items: center; gap: 6px`**（各模块可在对应 `*.module.css` 中以 `btnWithIcon`、`toolbarIconBtn` 等类实现，命名可局部化，语义一致即可）。
- **共享组件**：时间线事件 gutter、底栏状态、会话列表状态、上下文图例等复用 `src/components/LucideStatusIcons.jsx`（`TimelineDotIcon`、`BarStatusIcon`、`ContextSegmentIcon`、`normalizeBarStatus`），避免同一语义在多处手写不同图标。
- **例外**：**数据可视化 / 画布** 内联 SVG（如图表折线、工作流画布箭头 `marker`）不属于 Lucide 替换范围；**终端模拟区**（`TerminalView`）中 `$`、`>`、`?` 等前缀表示 shell / 工具语义，保留为终端惯例，不改为 Lucide。
- **已移除**：全局 `.dot` / `.dot-*` 色点工具类（原 `index.css`）已由上述 Lucide 组件替代，勿再新增依赖该模式的 UI。
