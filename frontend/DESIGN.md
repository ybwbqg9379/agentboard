# AgentBoard UI 设计约定（Design Tokens）

面向人机共读：与 [Stitch DESIGN.md](https://stitch.withgoogle.com/docs/design-md/overview/) 同类，说明 **语义 Token**、**双主题轴**、**响应式** 与 **i18n** 约束。实现侧见 `src/styles/`、`src/index.css` 的 `@import` 顺序，以及 `src/i18n.js`。

## 1. 双轴主题（必守）

| 轴           | HTML                                       | 取值                                                                         | 作用                                                                                          |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| **明暗**     | `document.documentElement` 上 `data-theme` | `light` \| `dark`                                                            | 同一套语义变量在亮/暗下的取值；与系统 `prefers-color-scheme` 的首次默认一致，可本地存储覆盖。 |
| **调色板包** | `data-theme-pack`（可选）                  | `default` \| `linear` \| `vercel` \| `cursor` \| `warp` \| `apple`（见下表） | 覆盖 **色 / 状态色** 与 **`--font-sans` / `--font-mono`**；**不**改间距、圆角等布局 Token。   |

规则：

- **任意 `theme-pack` 都必须同时提供 `light` 与 `dark` 下的变量覆盖**（见 `themes/packs/*.css`）。
- 新增主题包时，选择器形如：`html[data-theme-pack='name']` 与 `html[data-theme-pack='name'][data-theme='dark']`，避免只覆盖一侧。

**已登记主题包**（实现：`src/styles/themes/packs/<name>.css`；参考 awesome-design-md）：

| `data-theme-pack` | 参考文档                         |
| ----------------- | -------------------------------- |
| `linear`          | `design-md/linear.app/DESIGN.md` |
| `vercel`          | `design-md/vercel/DESIGN.md`     |
| `cursor`          | `design-md/cursor/DESIGN.md`     |
| `warp`            | `design-md/warp/DESIGN.md`       |
| `apple`           | `design-md/apple/DESIGN.md`      |

**主题包字体**（首个 `html[data-theme-pack='…']` 规则内设置；中文统一回退 **`PingFang SC` / `Hiragino Sans GB` / `Microsoft YaHei`**）：

| `data-theme-pack` | `--font-sans` / `--font-mono`（摘要） | 实现说明                                                           |
| ----------------- | ------------------------------------- | ------------------------------------------------------------------ |
| `default`         | 继承 `foundation.css`                 | `index.html` 加载 **Inter** + **JetBrains Mono**（Google Fonts）   |
| `linear`          | **Inter** / **JetBrains Mono**        | 与 Linear 文档一致（Mono 以 JetBrains 代 Berkeley Mono）           |
| `vercel`          | **Geist Sans** / **Geist Mono**       | **Fontsource**（`src/styles/fonts.css` → `main.jsx`）              |
| `cursor`          | **DM Sans** / **IBM Plex Mono**       | 开源近似 CursorGothic / berkeleyMono                               |
| `warp`            | **Sora** / **IBM Plex Mono**          | 几何无衬线近似 Matter；等宽近似 Matter Mono                        |
| `apple`           | **system SF 栈** / **SF Mono**        | 不引入 webfont，非 Apple 平台回退 **Segoe UI** / 系统 ui-monospace |

## 2. 语义 Token（组件应只依赖这些）

命名保持稳定，换主题包时只改映射表，不改组件类名：

- **表面**：`--bg-primary`、`--bg-secondary`、`--bg-tertiary`、`--bg-elevated`、`--bg-hover`
- **边框**：`--border-primary`、`--border-secondary`、`--border-accent`、`--border-color`
- **文字**：`--text-primary`、`--text-secondary`、`--text-tertiary`、`--text-accent`
- **交互强调**：`--bg-accent`（与链接/选中态等对齐）
- **状态**：`--status-running`、`*-thinking`、`*-error`、`*-done`、`*-tool` 及对应 `*-rgb`（供 `rgba(...)`）
- **结构**：`--font-sans`、`--font-mono`、`--space-*`、`--radius-*`、`--header-height` 等（见 `tokens/foundation.css`）

禁止在业务组件中新增「一次性 hex」；若某屏需要品牌扩展色，先在本文档与 `agentboard.css` / 主题包中登记语义名。

## 3. 响应式与交互

- **断点**：主断点为 `max-width: 768px`（与现有布局一致：竖向堆叠、`main-content`、顶栏压缩等）。
- **触控**：小屏上保留可点区域与现有 `Header` 按钮尺寸；主题包 **不得** 删除 `@media (max-width: 768px)` 下的关键规则。
- **滚动条**：移动端隐藏 WebKit 滚动条的规则保留，避免与抽屉/面板重叠。

新增页面时沿用 **移动优先或至少 768 补一套** 的策略，避免只在桌面测通。

## 4. 多语言（i18n）

已接入 **react-i18next**：`src/i18n.js` 初始化，`src/locales/en.json` 与 `zh-CN.json` 为文案源；`localStorage` 键 `agentboard-locale`；`document.documentElement.lang`、**`document.documentElement.dir`**（LTR/RTL）与 **`document.title`**（`common.appTitle`）随语言更新。

核心壳与 **Workflow / Experiment / Timeline / 终端与侧栏** 等已走 `t()` / `i18n.t()`；新增 key 时 **禁止整句硬编码拼接**，复杂句用 `t('key', { var })`；需要展示给用户的 `{{…}}` 模板字面量勿放进 JSON（避免被插值吞掉），可拆成 prefix/suffix 或在 JSX 中写死花括号段。

**门禁**：仓库根目录 `npm run i18n:check`（`scripts/check-i18n.mjs`）校验 en ↔ zh 键与占位符一致、源码中的静态 key 在 `en.json` 存在、动态 `t(\`prefix.\${…}\`)`前缀下至少有一条翻译、**禁止裸变量**`t(foo)` 与 **`t('…' + …)`** 拼接 key；这类非法写法会按**整个调用跨度**扫描，跨多行也会命中。属性访问只允许 **`_.labelKey`/`_.titleKey`/`_.descriptionKey`/`_.messageKey`** 这几类受支持的间接 key 引用，其对应字符串值仍须被间接 key 扫描命中；任意 `t(row.badKey)`一类访问会直接报错。任一调用跨度内带`// i18n-exempt` 可豁免；并默认扫描 **未使用的 en 键**（紧急跳过：`I18N_SKIP_UNUSED=1`）。日期/数字格式逐步用 `Intl`与当前`lang` 对齐。文案使用 **i18next 插值**（`{{var}}` 等），非 ICU MessageFormat；若引入 ICU 需另加校验。

**RTL**：`i18n.js` 在语言切换时对 `ar` / `he` / `fa` / `ur` 设 `dir="rtl"`，其余为 `ltr`；新增 RTL 语言时把关键布局改为逻辑属性（`margin-inline-*`）。

**设计**：长文案语言下注意顶栏 **语言 + 调色板** 两个下拉的 `max-width`（见 `Header.module.css` 移动端规则）。

本文件随主题包与断点演进更新；新增 `themes/packs/<name>.css` 后在此登记名称与参考来源（如 awesome-design-md 路径）。

## 5. 图标（Lucide / `lucide-react`）

- **唯一图标体系**：界面中表达「动作 / 状态 / 对象类型」的图形符号，统一使用 **[Lucide](https://lucide.dev/)** 的 React 包 **`lucide-react`**（与社区常说的 “Lucide icons” 同义）。禁止用 **emoji**、禁止把 **Unicode 符号**（如 `×`、`→`、`▶`、`+` 前缀等）当作图标替代；**文案里**仅用文字描述，**图标**由组件渲染。
- **典型映射**（示例，非穷举）：关闭 `X`、删除 `Trash2`、确认/保存 `Check`、运行 `Play`、停止 `Square`、发送 `Send`、继续 `ArrowRight`、刷新 `RefreshCw`、返回 `ArrowLeft`、新建/添加节点 `Plus`、下载 `FileDown`、主题 `Sun`/`Moon`、历史 `History`、下拉 `ChevronDown`、加载 `Loader2`（可配合 CSS 旋转）、趋势 `TrendingUp` 等。
- **尺寸与描边**：默认 `strokeWidth={2}`；顶栏/工具条常用 **14–16px**；列表内徽标可 **11–13px**。保持 `currentColor` 以继承 `--text-*` / 按钮前景色。
- **无障碍**：装饰性图标加 **`aria-hidden`**；仅图标的按钮用 **`aria-label` / `title`**（或可见文案足够时仅隐藏图标）。`ConfirmDialog` 标题栏关闭钮使用 `confirmDialog.dismiss` 作为 `aria-label`。
- **布局**：图标与文案并排时使用 **`display: inline-flex; align-items: center; gap: 6px`**（各模块可在对应 `*.module.css` 中以 `btnWithIcon`、`toolbarIconBtn` 等类实现，命名可局部化，语义一致即可）。
- **共享组件**：时间线事件 gutter、底栏状态、会话列表状态、上下文图例等复用 `src/components/LucideStatusIcons.jsx`（`TimelineDotIcon`、`BarStatusIcon`、`ContextSegmentIcon`、`normalizeBarStatus`），避免同一语义在多处手写不同图标。
- **例外**：**数据可视化 / 画布** 内联 SVG（如图表折线、工作流画布箭头 `marker`）不属于 Lucide 替换范围；**终端模拟区**（`TerminalView`）中 `$`、`>`、`?` 等前缀表示 shell / 工具语义，保留为终端惯例，不改为 Lucide。
- **已移除**：全局 `.dot` / `.dot-*` 色点工具类（原 `index.css`）已由上述 Lucide 组件替代，勿再新增依赖该模式的 UI。
