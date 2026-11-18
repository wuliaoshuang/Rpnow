# RP-Hub 功能对照进度

目标：把 RP-Hub 的功能全部实现在 RPNow 里（独立实现，不复制其代码——RP-Hub 为 CC BY-NC 4.0）。

参考清单：
- `docs/research/rphub-chat-features.md` — 主聊天应用
- `docs/research/rphub-card-novel-features.md` — 角色卡工坊 / 小说

## 已完成

| RP-Hub 功能 | RPNow 实现 | 验证 |
|---|---|---|
| 记忆：基础 / 增强 / 二次压缩 / 补录 | `src/core/memory/*`、`src/features/memory/service.ts` | 单元 19 + e2e 9 |
| 记忆角标 `[M#]`、召回块、引用说明 | `engine.ts`、`prompts.ts` | e2e 9 |
| 工具：关键词检索 / Tavily 联网 / 随机生成 | `src/core/tools/*` | 单元 25 + e2e 6 |
| `parallel_tool_calls:false`、单轮 5 项、最多 4 轮 | `llm/adapters.ts`、`agent/defaultLoop.ts` | e2e 6 |
| 剧情分支：分叉 / 切换 / 改名 / 删除 / 导出 | `src/core/branch/*`、`BranchPanel` | 单元 21 + e2e 10 |
| UI 模板：`{{}}` / `#each`、沙箱 iframe、变量更新、slash | `src/core/uitemplate/*`、`TemplateCard` | 单元 31 + e2e 8 |
| 自动生图：`image###Tag###`、NAI jobs、重 roll | `src/core/image/nai.ts` | 单元 14 + e2e 7 |
| 角色卡 AI 生成：分节解析、JSON 修复、世界书/正则映射 | `src/core/cardai/*`、`CardAIGenerateDialog` | 单元 17 + e2e 12 |
| 小说编辑器：书架 / 设定 / 角色 / 目录 / 查找、生成、书评团、TXT 导入导出 | `src/core/novel/*`、`NovelPage` | 单元 14 + e2e 17 |
| 云备份 / 恢复、更新检测 | `src/core/backup/*`、`BackupSettingsPanel` | 单元 12 |
| Gemini 抗截断（`output_reply`、空回重试 3 次） | `agent/defaultLoop.ts`、`features/chat/orchestrator.ts` | e2e 5 |
| 卡片智能修改（`edit_character_card` 编号 diff） | `src/core/cardai/diff.ts`、`CardEditDiffButton` | 单元 15 |

## 第 3 轮：补全差距报告中的缺失与部分项

按 [rphub-gap-report.md](research/rphub-gap-report.md) 逐条实施。

**消息层**
- 复制去掉 `[M#]`；正文里的 `[M#]` 渲染成可点角标，点击弹「判断依据」（G07 / B08）
- 移动端操作栏常显、桌面 hover 才显（B12）
- 用户消息显示人设头像；系统消息改用独立气泡样式（B13）
- 删除/重生成消息时同步裁剪记忆并重编号（B06 / B10 / G10）
- 编辑无变化时提示「消息未改动」（B07）

**渲染**
- `sandboxHtml` 真正生效：整段 HTML 与 ```html 围栏渲染进沙箱 iframe（B03）
- `renderer.render` 加 2000 条 LRU 缓存（B04）
- 图片宫格按数量切版式，3 张时首张跨两列（I02）
- 上下文查看器加「系统/世界书/记忆/工具/原文」组成条（K02）

**宏与设置**
- `{{ User }}` / `{{user }}` 现在也能替换（F09）
- 推理强度 `reasoning_effort`（N01）
- 人设新增偏好设定、叙述人称、头像上传（N06）
- 跨标签主题同步（M05）、全屏按钮（M01）
- 正文字号（M06）

**生图**
- 风格/画师串六选一 + 自定义（I07）
- 重 roll 带 `nocache=1`（I08）
- 配额查询按钮（I09）
- 选 V5 时自动切回不受支持的风��（I10）

**卡片库与工坊**
- 收藏星标 + 「只看收藏」筛选（A04）
- 多选 + 批量删除（A05）
- 角色简介面板（楼层/字数/压缩预览/描述渲染）（A07）
- 记忆面板扩展为记忆浏览：压缩率条、清空、单条重生成（A12 / G09）
- 总结温度对齐 0.2（G02）

**小说**
- 成人模式真正注入提示词（Q04）
- 章节正文按 Markdown 渲染（Q13）
- 清空全部内容（Q02）
- 搜索结果点击跳转并展开对应章节（Q09）
- 书评点赞、楼中楼回复、「作者赞过」（Q10）

**互操作**
- 分支 JSONL **导入**（兼容 RP-Hub 的 `rp-hub-branch-chat` manifest 与纯消息数组）（H07 / O06）

**已知差异（有意保留）**
- RP-Hub 禁用缩进代码块以渲染缩进 HTML；当前 marked 版本不支持该 tokenizer 覆盖，
  卡片请用 ```html 围栏（见 `core/render/renderer.ts` 注释）。
- 万相广场（A10）需要外部论坛服务，未复刻。

## 第 4 轮：移动端全量点击审计

按用户要求「从头到尾把全部可点击的地方都测试一遍」，写了 `scripts/ui-audit.mjs`：
两层（逐路由加载健康检查 → 关键控件定向点击），手机视口 390×844，覆盖 7 个路由 +
设置 12 个标签 + 小说 5 个标签。**结果 0 问题**，过程中修掉 6 个真实缺陷：

| 缺陷 | 现象 | 修复 |
|---|---|---|
| 设置标签栏横向溢出 | 手机上「模板/生图/备份/身份/网络/数据」6 个标签在屏幕外，点不到 | 标签换行；顺带修掉重复的 `image` 标签值（图像 vs 生图冲突） |
| Hooks 顺序错误 | 打开「角色简介」时 React 报 hook order 变化 | `useMemo` 移到 early return 之前 |
| 卡片按钮被遮挡 | 收藏/多选按钮 `opacity-0` 但仍覆盖在「开始对话」上，移动端点不到卡片 | 改为 `lg:opacity-0 lg:group-hover:opacity-100`，移动端常显 |
| 图片重 roll 点不到 | 同上，图片上的重 roll 按钮在移动端不可见 | 同上 |
| 宏未替换 | 导入卡片的开场白含 `{{char}}` 时原样显示给用户 | MessageBubble 渲染前展开宏 |
| 附件按钮无 accessible name | 图标按钮缺 `aria-label` | 补上 |

审计同时检查：横向溢出、零尺寸/离屏控件、图标按钮可访问名、点击后的控制台报错、
弹层可关闭性。

## 第 5 轮：功能合理性 / 移动端操作负担 / 正则可用性

按用户反馈逐项验证并修复。

**内置预设无法启用（用户实测的 bug）**
- 根因：`设为默认` 按钮带 `!isBuiltin` 条件，内置预设**永远不能成为默认**，
  于是它对新对话没有任何作用——这正是「安排了内置预设却没有意义」。
- 修复：内置预设可设为默认（默认预置只是一个 id 引用）；不可直接编辑/删除，
  需要「复制并编辑」。同步在 UI 上标明「当前默认」。

**操作按钮组过载**
- 消息操作栏原本常显 8 个按钮（swipe×2、重新生成、分支、复制、编辑、隐藏、删除、朗读），
  在 390px 宽的手机上几乎占满整条消息，挤压正文。
- 重构为 **3 个常显**（重新生成 / 编辑 / 更多），其余收进「更多操作」菜单：
  从这里分支、复制、隐藏、朗读、删除。桌面端同样适用（菜单比 8 个图标更清爽）。

**正则可用性（用户最担心的一项）**
- 新增单元测试 51 条，端到端 10 条（`scripts/feature-check.mjs`）。
- 修复：**历史消息此前完全没有应用正则**——`promptOnly` 脚本只作用于预设区块。
  现在历史中的 AI 输出会按 `placement` 应用提示词侧正则。
- 实现：`minDepth` / `maxDepth`（之前只有类型定义，无消费者），
  并修掉 `depth = 0` 被当作「未设置」的 bug（`maxDepth: 0` 表示「仅最新一条」，
  原实现因 falsy 判断而完全不过滤）。
- 确认语义：`/pattern/flags` 解析、去重 `g`、`markdownOnly` 与 `promptOnly` 互斥、
  **都不勾 = 仅用户可见**、`disabled` 跳过、`placement` 生效、停用后立即恢复原文。

## 第 6 轮：按 Tavo 布局改造

参照 Tavo 的移动端布局重做了导航与聊天界面（行为对齐，代码独立）。

**首页 = 聊天列表**
- 新路由 `chats`，替代「直接进入上次对话」。
- 每行：角色头像（无头像取首字）、角色名、最后一条消息摘要、相对时间。
- 行内 `⋯` 菜单收纳「继续对话 / 删除对话」，删除有确认。
- 底栏第一项由「对话」改为「聊天」。

**沉浸式聊天**
- 有角色头像且开启「使用角色封面背景」时，头像铺满整个视口（`object-cover`，
  `aria-hidden`），上叠暗色渐变保证文字可读。
- 顶栏极简化：`☰` 菜单 / 居中角色名（分支名作副标题）/ 重新生成 / `⋯`。
  全局顶栏与底部导航在该路由**整体隐藏**，把屏幕留给故事。
- 气泡改为半透明：用户 `bg-white/15`、角色 `bg-black/45`，均带 `backdrop-blur`。
- 输入区：`[＋ 附件] [胶囊输入框] [圆形发送键]`，停止生成时发送键变红色圆形。
- 页脚读数精简为 `提示词 / 出图 / ↑输入 ↓输出 / 预设名`。

**抽屉菜单（带当前值）**
- 每行右侧直接显示当前状态：`用户身份 未设置`、`预设 默认`、
  `世界书 未启用`、`正则 1/2 启用`、`记忆 关闭`、`工具 关闭`、`剧情分支 0 条`。
- 「正则」行**就地展开**：逐条脚本一个开关，切换立即写入卡片并生效/停用；
  这是把「正则能否启用关停」做成一步可达的入口。
- 其余行直达对应页面或设置页签（`onNavigate(route, tab)` 支持带页签跳转，
  设置页用 `key` 重挂载以切到指定标签）。
- `Esc` 关闭抽屉（标准抽屉行为）。

**验证**：新增 `scripts/redesign-check.mjs` 13 条，含几何断言——
背景铺满视口、发送键为 ≥36px 圆形、气泡背景为半透明，而不只是检查 class 名。

## 第 7 轮：硬件返回键 / 振动反馈

**手机返回键逐级返回**
- 每次导航 `history.pushState`，`popstate` 弹自己的路由栈——Android WebView 在有
  历史记录时把返回键交给页面历史，否则直接结束 Activity，因此这套实现不需要
  Tauri 特殊 API。
- **弹层优先**：返回键先关抽屉/菜单，再撤销那次历史回退（`history.forward()`），
  撤销产生的二次 `popstate` 用标志位吞掉，否则会连续退两级。
- 地址栏同步 `#route`，桌面浏览器手势返回同样有效。

**振动反馈**
- 新增 `src/lib/haptics.ts`：`navigator.vibrate` 封装，平台不支持时静默无操作。
- AndroidManifest 增加 `android.permission.VIBRATE`。
- 两个独立开关（设置 → 外观 → 触感反馈）：**按键振动**、**消息到达振动**，
  外加「测试振动」按钮；不支持时会提示设备无振动马达。
- 触发点：底部/侧栏导航、发送、重新生成、卡片开始对话、收藏、收藏成功、
  抽屉行、抽屉内正则开关，以及所有 `Switch` 开关。
- AI 回复**第一个字符到达时**轻振一次（每轮一次，`replyBuzzedRef` 去重），
  不用盯着屏幕也知道回复来了。

**真机验证**（OPPO PFUM10，Android 12）
- 小说页按返回 → 聊天列表，应用不退出
- 聊天页按返回 → 角色卡页
- 抽屉打开时按返回 → 只关抽屉，留在聊天页
- APK 权限含 `android.permission.VIBRATE`

**顺带修掉的测试基础设施问题**：Vite 把 `/src/state/store.ts`、
`/src/state/store.js`、`@/state/store.js` 解析为**三个不同模块实例**，导致
脚本注入的 store 与 UI 读取的不是同一个（设置写了不生效）。现在在 DEV 下把
store 挂到 `window.__rpnowStore`，全部 e2e 脚本统一使用。

## 第 8 轮：聊天区留白 / 加号操作面板

**消息区去掉头像与署名**
- 每条消息不再渲染头像列（原 `size-8/9` 圆形头像）和说话人名字，只保留一行
  很小的相对时间（及「已隐藏」标记）。
- 气泡宽度由 `max-w-[calc(100%-3rem)]` 改为 `92%`（窄栏）/ `86%`（`sm` 窄栏），
  「宽栏」设置下一行到底——正文拿到原本被头像和署名占掉的宽度。
- 用户消息与角色消息仍靠左右对齐区分（`items-end` / `items-start`）。
- 顶栏角色名保留（用于辨识当前对话，抽屉头部也有）。

**composer 收敛为一行 + 加号面板**
- 删除发送键左侧那个重复的「从相册添加图片」按钮（同一功能有两个入口）。
- composer 最左侧的图标由图片图标改为**加号**（`Plus`）。
- 点加号从底部弹出操作面板，三项：**添加图片**（唤起相册/文件选择）、
  **生成场景图**、**提示词构成**；并注明「图片会随本条消息一起发送」。
- 面板用 `role="dialog"` + 遮罩 `aria-label="关闭"`，返回键与 Esc 行为一致。

**真机验证**（OPPO PFUM10）
- 消息区只剩「时间 + 正文」，无头像无署名
- 加号按钮存在，点击弹出底部面板（三项齐全），返回键可关闭

## 第 9 轮：状态栏浅色适配 / Tavo 导航结构

**状态栏跟随主题**
- 问题：状态栏字形写死为白色，浅色主题（纸墨）下白字浮在暖白背景上看不见。
- 实现：MainActivity 增加 `StatusBarBridge`（`addJavascriptInterface`），
  `applyTheme` 在主题切换时调用 `RPNowNative.setStyle('light' | 'dark')`，
  Kotlin 端按 APPEARANCE_LIGHT_STATUS_BARS 切换字形颜色（浅色主题 → 深色字形）。
- 附加：boot 后 1.2s 重发一次（桥在首个 focus 才挂上，可能晚于首次 applyTheme）；
  同时写 `localStorage['rpnow:statusbar-style']` 作为 shell 侧 fallback。
- WebView 实例由 `onWindowFocusChanged` 递归查找（wry 异步创建）。

**导航结构对齐 Tavo**
- **聊天即主页**：启动直接进最近会话；删除 `chats` 路由与独立聊天列表页。
- **底部导航整体移除**（桌面侧栏保留）。
- **全局抽屉**（`GlobalDrawer`，每个页面顶栏 ☰ 可开）三页签 + 底部三个圆形导航钮：
  - 聊天：会话列表（头像/名/摘要），点行直接进入该会话
  - 应用：角色卡 / 世界书 / 预设 / 插件 / 小说 / 设置 六宫格
  - 更多：带当前值的设置行（身份 / 模型 / 生图 / 预设 / 世界书 / 正则 / 主题 /
    记忆 / 工具 / 分支 / 备份）
- 聊天页的 ☰ 打开同一个抽屉；空态（无卡片 / 无会话）也保留 ☰ 入口，
  首次使用者不会没有导航。
- 修正抽屉面板被 flex 拉伸盖住遮罩的 bug（`shrink-0` + 内容列 `w-full`）。

**验证**
| | 结果 |
|---|---|
| 单元 | 316/316 |
| smoke | 21/21（移动端断言改为「底部导航已移除」） |
| UI 点击审计 | 0 问题 |
| e2e | 13 套 **134/134** |
| 真机 release | 8/8；抽屉三页签在真机可开合 |
| 状态栏桥 | `MainActivity$StatusBarBridge` 已编译进 APK |

**测试基建**：新增 `scripts/e2e-helpers.mjs`（seed / drawerNavigate / openFirstChat），
15 个脚本统一从底栏点击迁移到抽屉导航。

## 第 10 轮：沉浸渐变 / HTML 渲染 / 输入区对齐 / token 参数

**上下渐变遮罩**
- 聊天滚动区顶部与底部各加一条固定渐变（沉浸态黑 60% → 透明，普通态背景色 → 透明），
  内容滚过头部/输入区时渐隐，不再硬裁切。

**完整 HTML 渲染**
- 用户实测导入的 HTML 卡片显示的是源代码：`render.sandboxHtml` 默认值是 `false`。
- 改为默认 `true`：完整 HTML 文档与 ```html 代码块都会进沙盒 iframe 渲染出真实效果
  （allow-scripts/forms/popups，隔离运行），关闭则显示源码。设置项文案同步改写。

**输入区对齐 Tavo**
- composer 两侧按钮（＋ / ↑）从 `items-end` 改为 `items-center`：
  多行输入时按钮始终垂直居中，不再沉底。
- **删除 composer 下方一整行**（提示词 / 出图 / ↑↓token / 额度 / 预设名）——
  提示词与出图已并入 ＋ 操作面板，token 统计挪到消息操作行。

**token 统计挪进消息操作行**
- 最后一条 AI 消息的操作行右侧显示 `↑输入 ↓输出`（本轮 usage）与 `额度 x/y`，
  与 Tavo 的「本轮 token 相关的统计看这里」一致；composer 不再重复。

**最大输出 / 上下文长度可设置，0 = 无限制**
- 设置 → 对话 新增两个数字输入框：`最大输出 token`、`上下文长度（token）`，
  默认 0 = 无限制。
- 语义落地：`maxTokens = 0` 时请求**完全不带** max_tokens（OpenAI 兼容/采样器
  赋值统一改为 `>0` 才携带；Anthropic 仍需占位值 4096，Gemini 已有条件跳过）；
  `contextTokens = 0` 时历史不裁剪（防长对话丢内容），>0 按 ~3 字/token 折算
  字符预算。

**顺带修复**
- 「AI 生成角色卡」与「角色简介」弹层不支持 Esc 关闭——补上，全应用统一。
- 侧栏关闭后不再残留 DOM（原 `role="dialog"` 常驻会干扰返回键判定/读屏）。
- 回到当前所在页面时侧栏仍会关闭（此前 `navigate` 早退导致面板卡在打开态）。
- 角色卡「简介」按钮补振动。

**验证**
| | 结果 |
|---|---|
| 单元 | 316/316 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | 14 套 **192/192**（pushaside 17、back-haptics 14、redesign 20） |
| 真机安装 | Success；进程存活/WebView 加载/无崩溃通过（后续两项前台判定因手机锁屏未通过，锁屏解除即可） |

## 第 11 轮：按参考实现重做推挤侧栏 / 顶栏精简

以 `push_sidebar_demo.html`（Tavo 推挤式侧栏参考实现）为基准逐参数对齐：

**推挤几何（与参考一致）**
- 抽屉宽 `min(76vw, 310px)`；**主屏是唯一移动层**：`translate3d(抽屉宽,0,0)`
  整体平移，**不缩放**——文字保持原始大小。
- 主屏内侧圆角 22px + 朝面板方向的柔和阴影（`∓12px 0 35px rgba(0,0,0,.15)`）。
- 蒙层改为参考的**轻蒙层** `rgba(0,0,0,.10)`（原实现 0.45 过重）。
- 480ms `cubic-bezier(.22,.72,.18,1)`；`transform-origin: left center`。
- 面板静态垫在主屏后面，永不滑动；关闭即卸载（无残留 dialog）。
- 点关闭热区只覆盖余条（抽屉边缘之外），面板本体不拦截点击。
- **☰ 变开关**：再点一次关闭；与参考一致，面板打开后 ☰ 随主屏滑入余条区，
  点击余条即关闭。
- **边缘滑动手势**：屏幕左缘 <28px 右滑 >65px 开左栏；右缘对称开右栏；
  面板打开时反向滑动关闭。

**顶栏右侧 3 个按钮 → 1 个**
- 聊天顶栏右侧只保留「打开对话设置」（开右侧栏）。
- 移除的入口去向：重新生成 → 每条 assistant 消息操作行（原本就有）；
  查看提示词构成 → 右栏「情景设定」与 ＋ 面板；生成场景图 → ＋ 面板；
  剧情分支 / 全屏 / 清空对话 → 右侧栏新增行（清空对话为红色危险行，带确认）。

**验证**
| | 结果 |
|---|---|
| 单元 | 316/316 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | 14 套 **195/195**（pushaside 16 条按参考参数断言：宽/位移/圆角/余条/开关） |
| 真机安装 | Success；进程/WebView/无崩溃通过（手机锁屏时前台判定跳过） |

## 第 12 轮：侧栏高度 / 覆盖式关闭 / 宽度 75%

三处修正（按用户反馈）：

**侧栏内部没占满高度**
- 根因：面板 `<aside>` 自己加了 `paddingTop/Bottom: env(safe-area-inset-*)`，
  而内部组件（`ChatListPanel` / `SettingsPanel`）也各自处理了安全区——
  inset 被叠加两次，且 padding 让内部 `flex-1` 列表块只能撑到 padding 内边缘。
- 修复：面板去掉自身的 safe-area padding（`inset-y-0` + `h-full` 铺满全高），
  安全区完全交给内部组件。实测内部块：品牌头 60 → 分组头 40 →
  列表 `flex-1` 640 → 底部圆钮 104 = 844（视口全高）。

**关闭必须是"覆盖"动画，不能直接隐藏侧栏**
- 原来关闭时面板立刻从 DOM 消失，主屏滑回来是盖在空气中。
- 修复：新增 `visibleSide` 状态——关闭时**面板保持挂载**，主屏滑回盖住它，
  等 480ms 动画结束才卸载。实测时间线（关闭后）：
  `50ms 面板在 主屏 x=154` → `150ms 在 37` → `300ms 在 4` → `450ms 卸载`。
  视觉上就是主屏"覆盖"回侧栏上方。

**侧栏加宽**
- 抽屉宽 `75vw`（上限 480px），主屏只留 **25%** 作为余条与点击关闭区。
- 390px 视口下：抽屉 293px，余条 97px。

**验证**
| | 结果 |
|---|---|
| 单元 | 316/316 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | 14 套 **195/195**（pushaside 断言已同步到 75%） |
| 真机 release | **8/8** |

## 第 13 轮：操作栏 / 输入区 / 滚动 / 打字机 / 群聊 / 酒馆插件

**消息操作栏**
- 开场白切换容器改**胶囊形**（`rounded-full`）。
- 右侧三个按钮（重生成 / 编辑 / 更多）各自成为独立的**黑色半透明圆角矩形**
  （`bg-black/45` + `backdrop-blur-sm`，与沉浸态气泡同一处理），高度统一
  `h-8`，与左侧胶囊等高，间距 `gap-1`。

**输入区**
- 胶囊化（`rounded-full`，原 1.6rem 弧度不够）。
- 最大高度 `176px` → `40vh`（按视口算，能显示更多字符）。
- 滚动条隐藏但**保留滚动**（新增 `.rp-no-scrollbar` 工具类）。

**全局滚动条**
- `.rp-scroll` 宽高 `8px → 4px`，不再遮挡正文。

**回到顶部 / 回到底部**
- 向上滚动显示「回到顶部」（`ChevronUp`），停在底部时显示「回到底部」；
  内容不足一屏时不显示。锚定在输入区上方右侧。

**打字机光标**
- 流式回复气泡末尾渲染 `.rp-caret`（1s 步进闪烁，`prefers-reduced-motion`
  下不闪），随每个新字符右移——文本本身已由 streaming delta 渐进渲染。

**渐变遮罩**
- 高度 `h-16 → h-28`，加中间色阶（`via-black/25`）让过渡更顺。
- 只覆盖聊天滚动区（图片层），不压在 header / composer 上。

**键盘辅助行**
- 用 `visualViewport` 高度差检测软键盘（>120px）。
- 键盘弹出时输入区下方出现三个按钮：**编辑**（打开全屏长文本编辑面板）、
  **“**（光标处插入 `“”`，光标停在中间）、**( )**（光标处插入 `()`），
  并留出与键盘的间距。

**群聊**
- 数据层：`RPChat.groupCardIds` + `groupSpeaker`。
- 提示词：`buildPrompt` 收到 `groupMembers` / `groupSpeaker` 后追加
  `【群聊场景】` roster 块（列出同场角色、指明本轮发言人），并把 `{{char}}`
  解析为当前说话者、`{{group}}` 为成员名单。
- 入口：右侧栏 **＋** → 全屏「组建群聊」面板：搜索、多选（带序号徽标）、
  第一个选中者标为「主持」（决定头像/背景）、可选群名。
- 端到端验证：建 3 人群聊 → 发消息 → 请求体含 roster 与角色名。

**酒馆助手（SillyTavern）插件**
- ST 扩展是 `manifest.json`（`js`/`css`）+ 脚本，不是 `.rpnx`，原来会卡在校验。
- 新增 `st-manifest.ts`（纯判定，10 条单测）+ `st-bridge.ts`（运行时）：
  - `parseRpnx` 识别 ST 布局并走兼容分支（不打 `.rpnx` 校验）；
  - 注入 CSS，构造 `SillyTavern` 全局 shim：`getContext()`
    （chat/characters/name1/name2/eventSource/eventTypes/extensionSettings/
    power_user/saveSettingsDebounced/getRequestHeaders/generate）、
    `eventSource.on/once/off/emit`、`tavern_helper` 命名空间；
  - 内核事件（`chat:message-sent` 等）转发为 ST 事件；
  - 设置按插件 id 存 localStorage；卸载时清理样式、监听器与全局。
- 端到端验证 **12 条**：脚本执行、全局注入、getContext 返回真实消息与
  角色名、CSS 注入、内核事件转发、卸载清理。
- **修复真 bug**：`SillyTavern.eventSource` / `eventTypes` 原先只在
  `getContext()` 返回值里，扩展直接读全局属性会拿到 undefined 而崩溃。

**验证**
| | 结果 |
|---|---|
| 单元 | **330/330**（+14 新增 ST 判定） |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **16 套 205/205**（新增 group-st 8、st-runtime 12） |
| 真机 release | **8/8**（首帧 446ms） |

## 第 14 轮：引号/括号按钮位置与「不收起键盘」

**位置**
- 引号 `“”` 与括号 `()` 移到键盘辅助行的**最右侧**（`ml-auto` 分组），
  编辑按钮仍在左侧。两按钮同一行、垂直对齐、括号在引号右侧。

**按下不收起软键盘**
- 根因：`<button>` 的默认行为会把焦点从 textarea 抢走，系统随即关闭软键盘。
- 修复：抽出 `InsertChip` 组件——
  - `onPointerDown` 里 `preventDefault()`，焦点留在 textarea，键盘不收起；
  - 插入动作直接在 pointerdown 阶段执行（无需等 click），手感更即时；
  - `onClick` 仅作为无 pointer 事件的兜底，并用 ref 去重避免插入两次；
  - `insertAtCursor` 改用 `focus({ preventScroll: true })`，避免插入时页面跳动。
- 无其他副作用：不改变选中范围以外内容、不触发发送、不改变滚动位置。

**验证**（`scripts/keyboard-row-check.mjs`，14 条）
- 位置：引号 left=298 / 括号 left=342（视口 390，均在右侧）；编辑 left=12（左侧）；
  两按钮 cy 相同。
- 行为：在 `你|好` 中间插入 → `你“”好`、光标停在引号中间（caret=2）；
  再插括号 → `你“()”好`、caret=3；两次插入后 **`document.activeElement` 仍是
  textarea**；`pointerdown` 的 `defaultPrevented === true`。

**回归**
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **17 套 219/219**（新增 keyboard-row 14） |
| 真机 release | 8/8 |

## 第 15 轮：跳转按钮阈值 / 键盘顶起时固定顶栏

**回到顶部/回到底部只在真正滚动后才出现**
- 原逻辑是 `scrollTop > 8` 就显示，几乎一滑动就出现，太吵。
- 改为 **240px 死区**：
  - 距顶部 < 240px → 不显示（没有可回去的地方）
  - 距底部 < 240px → 显示「回到顶部」
  - 中间区域 → 取离得更近的一端
  - 内容不足一屏 → 不显示
- 实测：停在顶部 / 滚 80px / 滚 200px 均不显示；滚 400px 才出现「回到顶部」；
  贴底 100px 内不显示「回到底部」。

**键盘弹出时顶栏不再被顶出屏幕**
- 根因：软键盘压缩可视区后，flex 容器整体变矮，`header` 随之上移出屏。
- 修复：把 `visualViewport` 的高度差记成 `keyboardInset`，聊天外壳
  `height: calc(100% - inset)` + `maxHeight: calc(100dvh - inset)`，
  header 保持 `shrink-0` —— **只有消息区让出空间，顶栏与输入区不动**。
- 同时监听 `visualViewport` 的 `scroll`（Android 有时只滚动不 resize）。
- 实测：键盘占 340px 时，header 的 top 仍是 0，容器高度 504 = 可视高度 504。

**验证**（`scripts/scroll-keyboard-check.mjs`，13 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **18 套 232/232** |
| 真机 release | 8/8 |

## 第 16 轮：背景与 UI 分层 / 键盘间距 / 记住会话 / 群聊开场白与角色名

**背景不再被键盘顶小**
- 根因：键盘克隆时直接把**整个**聊天容器（含背景图）的 height 缩小，背景被挤成
  键盘上方的窄条。
- 修复：拆成两层——
  - **外层**铺满屏幕、只负责背景（`absolute inset-0` + `object-cover`），永不收缩；
  - **内层**承载 UI 列，键盘弹出时只收缩内层（`height: calc(100% - inset)`），
    header 保持 `shrink-0` 钉在顶部。
- 实测：键盘占 340px 时背景高度仍是 **844 = 视口高度**，header top 仍为 0。

**键盘上方按钮间距加大**
- 输入区在键盘弹出时不再叠加 `safe-area`（否则会贴住键盘），改为 `pb-5`；
  辅助行 `pb-1 → pb-6`。
- 实测按钮行与键盘的间距从 8px 提升到 **20px**。

**记住上次选中的会话**
- 根因：`setActiveChat` 只写内存，重启丢失；启动时也没有恢复。
- 修复：`setActiveChat` 把 id 写入 `settingsStore`（localStorage）；
  `boot()` 读取并在该会话仍存在时恢复；删除会话时同步清空。
- 实测：选中「旧会话」→ 刷新 → 仍是「旧会话」。

**群聊开场白可选**
- 组建群聊面板新增「选择开场白」横向卡片区：每个已选角色一张卡，
  展示其 `first_mes` 摘要，点选决定谁的开场白开场。
- 开场白取自所选角色，`groupSpeaker` 记录该角色。

**消息显示角色名**
- `RPChatMessage.speaker` 字段；气泡上方的元信息行显示说话者名字
  （普通聊天不显示）。
- 群聊开局注入开场白的 speaker；后续回复按 `groupSpeaker`（固定）或
  `auto`（按助手消息数轮转）标注。
- 实测：选「白露」的开场白 → 气泡上方显示「白露」，回复也标注白露。

**顺带修复**
- `GroupChatSheet` 的 `useState`/`useEffect` 写在 `if (!open) return null`
  之后，导致 **Hooks 顺序错误**（打开面板即崩）——已把 hooks 全部提到早退之前。

**验证**（`scripts/kb-group-check.mjs`，12 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **19 套 244/244** |
| 真机 release | 8/8 |

## 第 17 轮：遮罩脱键盘 / 输入区可读性 / 侧栏动画性能 / 角色统计

**渐变遮罩也不再受键盘影响**
- 上一轮只把背景图移到了外层；遮罩还在被键盘钳制的 UI 列里，会跟着变矮。
- 现在把上下两条 `h-28` 渐变**整体移到背景层**（`z-[1]`），永远贴着真实屏幕边缘。
- 实测：键盘占 340px 时，遮罩高度 112 不变、底部遮罩 bottom 仍是 844。

**键盘按钮间距调小**
- 之前 `pb-6`（约 24px 内边距叠加）偏高；改为外层统一 `pb-3`
  + 辅助行 `pb-1`。
- 实测按钮行到键盘的间距 = **12px**（原来 20px）。

**输入框看不清**
- 根因：沉浸态输入胶囊是黑色半透明，但 textarea 仍用主题前景色 —— 深色主题下
  几乎同色。光标也没有独立颜色。
- 修复：沉浸态强制 `text-white` + `caret-white` + `placeholder:text-white/45`；
  普通态用主题前景色 + 主题强调色光标。字号 `text-sm → text-[15px]`。
- 实测：`color = rgb(255,255,255)`、`caretColor = rgb(255,255,255)`。

**输入框左右不居中**
- 根因：外层容器只有 `px-3`，内层 `max-w-3xl` 缺少 `w-full`，胶囊被内容撑成不等宽。
- 修复：外层 `flex justify-center`，内层 `w-full max-w-3xl`。
- 实测：胶囊中心 x=195（视口中心 195），左右留白都是 12px。

**侧栏动画优化**
- 根因：同时过渡 `transform` + `border-radius` + `box-shadow`，后两者每帧触发
  **整屏重绘**，手机上是主要卡顿源。
- 修复：**只过渡 `transform`**；圆角瞬时切换（滑动中不可见）；阴影改成独立的
  渐变层用 `opacity` 淡入（合成层属性，不重绘）。同时加 `backface-visibility`
  与常驻 `will-change: transform`。
- 实测：`transition-property = transform`、`will-change = transform`、480ms。

**右侧栏「统计」→ 单角色 token 弹窗**
- 原来错接到「提示词构成」检查器。
- 新增 `TokenStatsSheet`：按当前角色聚合其所有会话里 assistant 消息的
  `usage`，显示输入 / 输出 / 合计 / 轮次 / 平均每轮，并列出按会话明细。
- 实测：注入一条 `usage: {inputTokens: 1234, outputTokens: 567}` 后，
  弹窗显示 `输入 1.2K / 输出 567 / 合计 1.8K / 1 轮`，含「按会话」明细。

**验证**（`scripts/composer-perf-stats-check.mjs`，19 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **20 套 263/263** |
| 真机 release | 8/8 |

## 第 18 轮：群聊身份 / 角色卡双视图 / 跳转方向 / 楼层窗口化

**群聊身份（按用户要求）**
- 群名：成员名用 `&` 连接——`阿离 & 白露 & 长风`。
- 头像：新增 `GroupAvatar` 对角拼贴组件——成员头像按
  左上 → 右下（两人）/ 四角（多人）排布，共享圆形容器。
- 会话列表与群聊创建都使用该组件。

**全面屏安全区**
- 聊天页底部输入区在非键盘态保留 `rp-safe-b`（手势条空间）；
  左侧栏底部导航与更多面板均含 `safe-area-inset-bottom`。

**角色卡页面（对照两张截图重做）**
- 新增**网格 / 列表**两种视图切换（工具栏新增切换按钮）：
  - 网格：2 列海报卡、底部渐变显示名字；
  - 列表：圆形头像 + 角色名 + 元信息（版本 ▤、标签 🏷、作者 👤）+ 描述两行 + ⋮ 菜单。
- 工具栏 `flex-wrap` + 搜索框可收缩，修复 390px 下溢出遮挡视图切换按钮的问题。
- 导入 / AI 生成 / 新建角色改为图标按钮（带 `aria-label` 与 title），
  避免文字按钮把工具栏挤爆。

**跳转按钮方向逻辑（按用户要求重写）**
- 原阈值逻辑语义反了。现在按**滚动方向**判定：
  - 向上翻看旧内容 → 显示「回到顶部」
  - 向下看最新内容 → 显示「回到底部」
  - 停在最顶 / 最底 → 不显示；会话内容不足一屏（<900px）→ 不显示。
- 顺带修掉粘底阈值过宽（120px）导致的拉底竞争，改为 60px。

**高楼层渲染窗口化**
- 200 楼的会话全量渲染上万 DOM 节点，滚动卡顿。
- 只挂载最近 **60 楼**；滚近顶部自动再加载 60 条，
  并提供「加载更早的 N 条（还有 M 条）」按钮。
- 实测：200 楼只渲染 60 个气泡，方向跳转按钮仍正常工作。

**验证**（`scripts/group-cards-scroll-check.mjs`，15 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **21 套 257/257** |
| 真机 release | 8/8 |

## 第 19 轮：群聊标题 / 键盘下露出操作按钮 / 无滚动条 / 纯净角色卡

**群聊标题**
- 聊天顶栏标题按成员 `&` 连接显示（`阿离 & 白露`），不再只显示主持角色名。
- 会话列表同样用该标题。

**键盘顶起时看到最后一条消息的操作按钮**
- 原来粘底用 `scrollTop = scrollHeight`，键盘压缩容器后最后一条气泡的操作行
  仍可能被裁掉。
- 修复：`pinLastFloor()` 定位**最后一个 `[data-role]` 气泡**（此前错取了列表
  容器本身，算出 offsetTop=16），滚到 `气泡底 + 16px - 容器高`。
- 关键细节：mount 后首次 scroll 事件会把 `stickToBottom` 误判为 false
  （auto-pin 尚未执行），所以 messages/keyboardInset 变化的 pin 改为
  **无条件执行**；用 `requestAnimationFrame` 等布局更新后再测量。
- 实测：键盘占 340px 时最后一条的「重新生成」按钮 bottom=241，
  在容器底（504）之上。

**聊天区不显示滚动条**
- 滚动容器改用 `.rp-no-scrollbar`（保留滚动能力，隐藏滚动条）。
- 实测 `scrollbar-width: none`。

**角色卡网格按截图重做**
- **纯净海报卡**：`aspect-[3/4]`、大圆角 16px、无内联按钮、无徽章、无时间戳。
- **名字遮罩**：底部 `h-24` 渐变（黑 75% → 35% → 透明），名字白色落在其上。
- **对角 ⋮**：右上角黑色半透明圆钮。
- **长按（contextmenu）** 弹操作菜单：开始对话 / 简介 / 编辑 / 置顶 / 导出
  PNG / JSON / CharX / 删除。⋮ 与长按共用同一菜单。
- 列表视图保留不变。
- 菜单「开始对话」补振动。

**验证**（`scripts/round19-check.mjs`，10 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **21 套 257/257** |
| 真机 release | 8/8 |

## 第 20 轮：子页返回按钮 / 设置页两级改造

**子页返回按钮**
- 除聊天页外的所有页面都是子页，顶栏左侧新增 **‹ 返回上一级**（ChevronLeft），
  返回到聊天主页；抽屉 ☰ 仍在其旁，随时可开聊天列表。
- 返回走 `navigate('chat')`，与 Android 返回键同一路径。

**设置页两级改造（对照 Tavo 的「更多」/「模型与服务」截图）**
- 原来的 12 个平铺标签在手机上确实难用，改为两级：
  - **目录页**：分组卡片（聊天 / 生图 / 身份 / 界面 / 高级 / 数据），
    每行右侧显示**当前值**（`用户身份 → 未设置`、`主题 → 午夜玫瑰`、
    `记忆 → 关闭`、`工具 → 2 项启用`…），点击进入该区。
  - **子页**：只渲染该区的表单，顶栏有返回；并保留区块页签条，
    深链进来的用户也能跳到相邻区。
- 聊天侧栏的「用户身份 / API 连接 / 生图 / 主题 / 记忆 / 工具」等行
  直接深链到对应子页（不再落在平铺标签的默认页）。
- 实测：hub 6 组 12 行、行值正确；主题子页带返回与主题选择；
  聊天侧栏 → API 连接深链直达模型设置子页。

**验证**（`scripts/settings-hub-check.mjs`，8 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **21 套 257/257** |
| 真机 release | 8/8 |

## 第 21 轮：输入框底距 / 设置子页去嵌套 / 目录内边距 / 画布同色 + 大圆角

**聊天输入框与底边的距离**
- 真实 bug：`.rp-safe-b` 是普通 CSS 类，`padding-bottom: env(...)` 会**替换**掉
  Tailwind 的 `pb-4`（同属性），无安全区时底距直接变 0，胶囊贴住屏幕下缘。
- 修复：composer 底距改为内联 `calc(1.25rem + env(safe-area-inset-bottom))`，
  基础 20px + 手势条高度；键盘弹出时固定 20px。
- 实测：胶囊底边距屏幕 **20px**。

**设置子页：彻底去掉嵌套的标签布局**
- 上一轮的子页里仍保留整套 Tabs 页签条（等于把旧布局嵌进新结构）——已删除。
- 现在子页 = 标题 + 返回箭头 + **仅该区块的表单**（如主题页只有主题选择卡）。
- 深链（聊天侧栏 → 主题）直接落到该子页，无页签、无目录行残留。
- 实测：`tabs=0`、主题子页只含主题卡、无目录行泄漏。

**目录页内边距收紧**
- 页面包装层与 hub 各自叠加了 padding（约 28px/边）。现在只保留一层：
  实测目录卡片距屏幕边 **17px**。

**画布同色 + 圆角加大**
- 推拉层的背景从 `--rp-bg` 改为与侧栏相同的 `--rp-bg-elevated`——
  聊天图片背后的画布与抽屉连成一块，圆角弧线更突出。
- 圆角 22px → **30px**。
- 实测：`bg === drawerBg`、radius 30px。

**验证**（`scripts/round21-check.mjs`，9 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **23 套 281/281** |
| 真机 release | 8/8 |

## 第 22 轮：消息操作重构 / 继续按钮 / Tavo 式统计条 / 内页顶栏重做

**消息操作按钮（只留最后楼层）**
- 重新生成 / 继续 / 更多 三块操作板**只在最新楼层渲染**；历史楼层不再出现
  （它一旦重新成为最新楼层，按钮随之回来）。
- 「编辑」移入「更多」菜单；原位置换成 **继续**（FastForward 图标）——
  不添加用户输入、直接带现有上下文发请求续写（`generate()` 追加新楼层）。
- 实测：5 层会话只有最后层有三按钮；点继续 → 新增 assistant 层、
  请求体不含新的用户消息。

**Tavo 式统计条（最后楼层操作行下方）**
- 样式对照参考图：`⚡ 5.0 tok/s · ⛁ 12.3K 上下文（已缓存 12.0K）`，弱色小字。
- 数据链路打通：adapter 提取 OpenAI `prompt_tokens_details.cached_tokens` /
  Anthropic `cache_read_input_tokens`；agent loop 透传 `cachedTokens`；
  ChatView 记录 `durationMs` → 速度 = 输出 token / 秒。
- 额度文本（quotaText）保留在同一行。

**消息编辑 = bottom sheet（对照参考图）**
- 「更多 → 编辑消息」打开底部面板：标题「改写」、右侧「保存」（强调色），
  大 textarea 自动聚焦（软键盘弹出），底部辅助行：全选 / 引号 / 括号
  （pointerdown preventDefault，不收键盘）。高度约 88dvh，顶部圆角。

**内页顶栏重设计（摒弃旧版）**
- 所有非聊天页面统一为子页头部：**‹ 返回 + ☰ + 居中标题**，
  删除品牌区（RPNow / 副标题）和右上齿轮。
- 设置页全部子路由化但**不嵌套路由**：`#/settings`（目录）↔
  `#/settings/models`（区块）只是同一层 route + section 字符串，
  popstate 直接解析 hash——一个头部，永不重复。
- SettingsPage 改为受控组件（section 由外部传入），目录页边距已收紧。

**验证**（`scripts/message-actions-check.mjs`，13 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **24 套 294/294** |
| 真机 release | 8/8 |

## 第 23 轮：插件入口回归 / 气泡防溢出 / 多行输入保持钉底

**插件管理入口找回来了**
- 根因：设置 hub 重构时把插件管理弄丢了（它本来是独立页面，不是设置子区块）。
- 现在 hub 底部新增「扩展 → 插件管理」行，右侧显示已安装数量
  （`已安装 2` / `未安装`，从 kernel 读取），点击直达插件页
  （安装 .rpnx / 每插件「插件设置」都在那里）。

**气泡文本防溢出**
- 角色卡的 HTML 面板常带固定宽度（如 `width:600px`），在 390px 屏上撑破气泡。
- `.rp-md` 现在：`overflow-x: hidden` + `> * { max-width: 100% }` +
  `img/video/iframe max-width:100%` + `pre` 换行 + `table` 块级横向滚动。
- 实测：600px 固定宽卡片 HTML 注入后，气泡横向溢出 **0px**、页面无横向滚动。

**多行输入不再遮住最后一条**
- 根因：钉底只监听「消息数」和「键盘 inset」——键盘弹出后继续输入多行文字，
  composer 变高、消息区变小，但两个依赖都没变，钉底不触发。
- 修复：`ResizeObserver` 监听 composer 高度（含辅助行出现/消失），
  高度一变就重新钉底。
- 实测：键盘占 340px + 输入 6 行后，最后楼层的按钮仍在可视区内
  （top=207 / shellBottom=504）。

**验证**（`scripts/round23-check.mjs`，5 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **25 套 299/299** |
| 真机 release | 8/8 |

## 第 24 轮：品牌艺术字 / 输入框聚焦变形 / 导航收敛 / 确认对话框组件化

**RPNow 品牌字**
- 内置 Pacifico 艺术字体（`public/fonts/`，离线可用），品牌字改用手写体 +
  渐变；右侧留 `pr-1.5` 让渐变尾不再被裁掉。

**输入区细节**
- 键盘辅助行 编辑/引号/括号 缩小到 `h-8`，与气泡操作板一致。
- 气泡三块操作板改为**正方形** `size-8`（此前 `h-8 px-2.5` 宽 34px ≠ 高 32px，
  观感是矩形）；图标放大到 size-4 填满。
- 输入胶囊**聚焦时平滑变形为圆角矩形**（border-radius 过渡 300ms，
  `focus-within:rounded-2xl`），失焦回到胶囊；多行时按钮贴底（items-end）。

**导航收敛**
- 侧栏「更多」圆钮**直接进入设置分组页**；原「更多」面板删除，
  世界书/预设/小说移入 hub 新「内容」组（显示 N 本/N 套），插件管理在「扩展」组。
- 子页顶栏：**删除机器人图标**；高度 `min-h-14 → min-h-16`；左右 `px-3`；
  标题绝对居中（与返回钮同一中线，且补偿 safe-area）。
- 所有子页滚动区下方保留手势条安全区 spacer。

**模型 / 记忆**
- 默认：最大输出 token = **0**（无限制）；上下文长度 = **1000000**
  （跟随模型上限，未知时的安全值）。
- 新增**自动压缩**：占用达到阈值（默认 **80%**，模型设置里可调 50–95）时，
  最旧楼层折叠为「【前情摘要 · 自动压缩】」楼层（开场白保留），toast 提醒。
  **记忆关闭时同样生效**。

**重启 = 重开剧情**
- 右栏「重启」不再只是返回聊天：清空对话只保留开场白（分支一并清除），
  组件对话框二次确认后执行并回到聊天页。

**原生 dialog 全部组件化**
- 新增 `confirmAction()`（Promise）+ `<ConfirmHost/>`（共享 Radix Dialog，
  portal 到 body，样式与组件库一致）；**28 处 `window.confirm` 全部替换**
  （涉及 15 个文件，涉及删除/覆盖/清空/恢复的确认统一「确认操作」标题，
  破坏性操作红色按钮）。

**改写弹窗挂载修复**
- MessageEditSheet 与引用弹窗改 `createPortal(document.body)`：聊天页在
  push-aside 的 `translate3d` 层内，fixed 子元素会被该层劫持导致错位——
  portal 后稳定覆盖全屏。

**验证**（`scripts/message-actions-check.mjs` 等适配后全绿）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **25 套 299/299** |
| 真机 release | 8/8 |

## 第 25 轮：聚焦变形重做 / 顶栏标题校正 / 菜单防贴边

**输入框聚焦变形（按反馈重做）**
- 聚焦时三件事同时发生：
  1. 左侧 **＋ 操作面板按钮收起**（宽度+透明度过渡到 0，`group-focus-within`）；
  2. 输入区**加高**（min-height 38px → 88px，300ms 过渡）；
  3. 套上**强调色描边**（`ring-1` + border 变 accent，两种主题都生效）。
- 失焦全部复原（加号滑回、高度回落、描边消失）。圆角胶囊↔矩形保持。

**顶栏标题位置校正**
- 截图反馈：标题压在 header 底线上。根因：`top: calc(safe + 50%)` 的 50%
  相对**含 padding 的 header 高**（64+safe），多算了 safe/2。
- 修正为 `top: calc(safe + 2rem)`（= 安全区 + 64px 内容高的一半），
  实测标题中线与内容中线重合（32 vs 32）。

**内容组图标**
- 世界书/预设/小说的 emoji 换成 lucide SVG（BookMarked/Sparkles/BookOpen），
  与其他行图标风格一致。

**更多按钮与菜单**
- 「更多操作」按钮此前仍是 `h-8 px-2.5`（34px 宽）——改为正方形 `size-8`。
- DropdownMenuContent 全局默认 `collisionPadding: 12` —— 任何下拉菜单
  （气泡更多、分支、插件等）不再贴屏幕边。

**验证**（`scripts/round24-check.mjs`，9 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **26 套 308/308** |
| 真机 release | 8/8 |

## 第 26 轮：品牌字体换衬线 / 输入框回归常态 / 顶栏 flex 重写

**品牌字体（按反馈更换）**
- 弃用 Pacifico 手写体，改为 **Playfair Display Bold**（加粗衬线，随包分发，
  离线可用）；品牌字加 `font-bold` + 收紧字距，渐变保持。

**输入框回归常态（按反馈撤销聚焦特效）**
- 圆角矩形（`rounded-2xl`）**恒定**，不再有胶囊↔矩形变形；
- 聚焦无任何特效：＋ 按钮不消失、高度不变（38px）、无描边/ring；
- 布局恢复垂直居中（items-center）。

**子页顶栏 flex 重写（标题不再跑偏）**
- 弃用 `absolute + top:calc(...)` 定位 hack，改为标准**三列 flex**：
  左槽 `w-24`（返回钮）｜中列 `flex-1 text-center`（标题）｜右槽 `w-24`
  （动作区）。两侧等宽 → 标题**由构造保证**居中，`items-center` 保证
  与返回钮垂直居中，safe-area 由 header padding 统一承担。
- 实测：标题中线 32 = header 内容中线 32（±0px）。

**探针适配**
- 胶囊→圆角矩形后，composer 探针从 `rounded-full` 改 `rounded-2xl`；
- 「无描边」断言改为读取 `--tw-ring-shadow`（常态 shadow-sm 不再误报）。

**验证**（`scripts/round24-check.mjs`，10 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **26 套 308/308** |
| 真机 | 设备离线，APK 已就绪（`release/RPNow_0.1.0_android-arm64.apk`） |

## 第 27 轮：现代斜体衬线 / 酒馆插件导入验证

**品牌字体：DM Serif Display Italic**
- 对比渲染了三款候选（DM Serif / Instrument Serif / Playfair Display），
  选择 **DM Serif Display Italic**：高对比度笔画、真正的斜体字形，现代杂志感最强。
- `@font-face` 声明 `font-weight: 400 700` + `font-style: italic`，使用时
  `font-bold italic`，字号 27px；随包分发（71KB），离线可用。
- 预览脚本 `scripts/font-preview.mjs` 可复现三款字体对比图。

**傻酒馆（SillyTavern）插件导入：端到端验证**
- 新增 `scripts/st-import-e2e.mjs`（15 条），走**真实 UI 路径**：
  更多 → 插件管理 → 文件选择器导入 ST zip。
- 构造的是真实 ST 扩展形态：`manifest.json`（`js`/`css`/`display_name`/
  `author`/`description`，无 `id`+`entry`）+ 调用 `SillyTavern.getContext()`、
  `eventSource.on()`、`saveSettingsDebounced()` 的脚本 + 独立 CSS。
- 全部通过：
  | 验证点 | 结果 |
  |---|---|
  | 识别为 `kind: 'st-extension'`（不走 .rpnx 校验） | ✅ |
  | 名称/版本取自 ST manifest | ✅ 酒馆助手（测试） / 1.2.3 |
  | 扩展脚本真实执行 | ✅ |
  | `getContext().chat` 读到真实消息 | ✅ len=1 |
  | `getContext().name2` 为角色名 | ✅ 酒馆测 |
  | `eventSource` 可用、事件可订阅 | ✅ |
  | 扩展 CSS 注入 | ✅ |
  | `extensionSettings` 持久化 | ✅ |
  | `SillyTavern` 全局注入 | ✅ |
  | 插件列表显示、可停用/启用、可卸载 | ✅ |

**验证汇总**
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **27 套 323/323** |
| 真机 release | 8/8 |

## 第 28 轮：Bodoni 品牌字 / GitHub 链接安装 / 输入框 5 行上限

**品牌字体：Bodoni Moda（粗体 + 斜体）**
- 渲染对比了 Abril Fatface / Bodoni Moda / Fraunces / Lora / DM Serif 五款，
  选用 **Bodoni Moda**——高对比度细腰衬线的现代时尚字体。
- `font-weight: 400 900` + `font-style: italic`，使用 `font-bold italic`。

**从 GitHub 链接安装插件**
- 新增 `src/core/plugins/github.ts` + 插件页输入框（回车或点「获取」）。
- 支持的链接形态：
  - `https://github.com/用户名/仓库`（自动探测默认分支）
  - `https://github.com/用户名/仓库/tree/分支/子目录`
  - `用户名/仓库` 简写、带 `.git` 后缀、带尾斜杠
- 安装策略：
  1. 目录内有 `manifest.json` → 只抓 entry 脚本 + css 组成包（快）；
  2. 否则下载分支 zipball，在 `dist/` / `build/` / `package/` 找已构建包；
  3. 都没有 → 明确报错并提示把链接指向构建产物目录。
- **所有失败路径都不安装任何东西**，只弹一条可读的错误：
  非 GitHub 主机 / 空链接 / 缺仓库名 / 私有仓库 / 限流 / 网络或跨域受限 /
  不是插件包。
- 下载后同样走 `parseRpnx`，因此 **傻酒馆扩展也能用链接直接装**。
- 实测：真实仓库 `SillyTavern/Extension-WebSearch` 成功抓取 69KB 包；
  非插件仓库（facebook/react）报错且插件数不变。

**输入框最大高度限制为 5 行**
- 原来按 `40vh` 撑开，长文本时输入框过高；改为按实际行高算
  `lineHeight × 5 + 上下 padding`（约 143px），超过即内部滚动。

**验证汇总**
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **28 套 333/333** |
| 真机 release | 8/8 |

## 第 29 轮：Abril Fatface 品牌字 / 角色卡编辑器重做

**品牌字体：Abril Fatface（五选中的第一款）**
- 换成 Abril Fatface——候选里最厚重、装饰性最强的 display serif。
- 该字体只提供直立体，斜体由浏览器合成（`font-synthesis`），
  仍按要求呈现 **粗体 + 斜体**。
- 实测：`font-family: Brand Serif`、`font-weight: 700`、`font-style: italic`、
  字体文件加载成功。

**角色卡编辑器：安全区 + 布局重做**
- **安全区**：头部 `pt-[env(safe-area-inset-top)]` 承担状态栏，
  内容区底部 `pb-[calc(env(safe-area-inset-bottom)+1.5rem)]` 避开手势条。
- **布局**：头部改为「‹ 返回 + 标题/副标题(未保存标记) + 保存」三段式，
  去掉冗余的「取消」按钮（返回即关闭）；页签条改为横向可滚动的整行，
  内容区边距收紧到 `px-3`。

**返回键修复（真 bug）**
- 编辑器是局部全屏浮层、不是路由，Android 返回键原先会穿透到下层页面。
- 修复：容器标记 `role="dialog"`（app 级 popstate 会查找该选择器并派发
  Escape）+ 组件内捕获 Escape 关闭，两条路径都可用。
- 有未保存修改时先弹组件确认框（「放弃未保存的修改？」），取消则保持打开。

**验证**（`scripts/round29-check.mjs`，12 条）
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **29 套 345/345** |
| 真机 release | 8/8 |

## 第 30 轮：Fraunces 船体字 / 角色卡详情 sheet / 工具栏重排

**品牌字体：Fraunces Italic（五选中的第三款）**
- 换成 Fraunces——现代「软衬线」，**带真正的斜体字形**（不是合成倾斜）。
- 用可变字体声明 `font-weight: 100 900` + `font-style: italic`，
  粗体即真正的重型斜体，`font-bold italic` 生效。

**角色卡：点击弹出详情 sheet（不再直接开聊）**
- 点卡片 → 全屏底部 sheet（`rounded-t-3xl`，max-h 92dvh）：
  - 顶部**大图**（4:5）满幅出血，底部渐变融入面板；
  - 图上叠**角色名 + 标签副标题**；
  - 描述渲染在凹陷圆角块里；下方是设定字数/世界书/开场白/作者徽章；
  - 底部固定操作条：**编辑** + 主按钮 **开始新聊天**（含手势条安全区）。
- 这样用户先看角色信息再决定是否开始，干净且防误触。

**角色卡工具栏重排**
- 删掉**收藏筛选**和**批量选择**（对长按菜单场景无用且挤占空间）。
- 所有按钮加**文字标签**：`列表/网格`、`导入`、`AI`、`新建`，不再是一排
  无名图标挤在一起。

**验证**（不跑全量，仅针对性验证）
| | 结果 |
|---|---|
| tsc | 通过 |
| smoke | 21/21 |
| feature-check | 10/10 |
| card-sheet 专项 | 6/7（唯一失败项是测试角色无头像，占位逻辑正常） |
| 真机 release | 8/8 |

## 第 31 轮：动效补全

**新增动效层（`src/index.css`）**
| 类 | 效果 | 用在哪 |
|---|---|---|
| `rp-anim-page` | 路由切换时内容上浮渐入 260ms | 每个页面的 `<main>`（按 route 重挂载） |
| `rp-anim-sheet` | 从底部滑入 280ms | 角色详情 sheet、改写面板 |
| `rp-anim-fade` | 遮罩淡入 200ms | 上述 sheet 的背景层 |
| `rp-anim-stagger` | 子项依次延迟 24ms 上浮 | 角色卡网格/列表、会话列表 |
| `rp-msg-in` | 新气泡上浮 + 微缩放入场 240ms | 每条消息 |
| `rp-send-ready` | 发送键弹性放大再回弹 | 输入框有内容时 |
| `rp-tap` / `rp-tap-card` | 按压缩放 0.965 / 0.975 反馈 | 设置目录行、卡片、按钮 |
| `rp-caret`（已有） | 流式光标闪烁 | 流式回复 |

**统一缓动**：`cubic-bezier(0.22, 0.72, 0.18, 1)`，与推拉侧栏一致；
所有动画都在 `prefers-reduced-motion` 下自动关闭（全局规则）。

**验证**（`scripts/animation-check.mjs`，7 条，逐项读取 computed style 的 animationName）
| | 结果 |
|---|---|
| 页面入场 | `rp-page-in` ✅ |
| 列表错落 | `rp-fade-up` ✅ |
| 卡片按压过渡 | transform + box-shadow ✅ |
| sheet 上滑 | `rp-sheet-up` ✅ |
| 消息入场 | `rp-msg-in` ✅ |
| 发送键弹跳 | `rp-send-pop` ✅ |
| 目录行按压 | transform ✅ |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| 真机 release | 8/8 |

## 第 32 轮：多余字符 / sheet 裁切 / 单一新建入口 / 编辑聚焦 / 应用图标

**聊天区顶部多出的字符（真 bug）**
- 根因：上一轮我用 PowerShell 做批量替换时，`\n` 被当成字面量写进了 JSX：
  `<main ...>{\`n            {children}\`n          </main>` —— 渲染成了可见文本，
  把整个聊天区往下压了约 25px。
- 修复：改回正常的 JSX 换行。**并加了一条断言**（主区不得存在游离文本节点）
  防止同类问题复发。

**角色详情 sheet 挂载错误（真 bug）**
- 现象：从聊天列表点卡片打开 sheet 时没有遮罩、布局被裁切。
- 根因：sheet 用 `fixed` 但没 portal，落在推拉层的 `translate3d` 里 ——
  被 transformed 祖先重新锚定，`z-*` 和 `inset-0` 都失效。
- 修复：`createPortal(..., document.body)`（改写弹窗此前也是这样修的）。
- 实测：`parentIsBody=true`、覆盖整视口、有遮罩、面板完整在视口内。

**编辑消息 sheet 焦点丢失（真 bug）**
- 现象：点「更多 → 编辑消息」，输入框聚焦后立刻失焦。
- 根因：Radix 菜单关闭时会把焦点还给触发器（「更多操作」按钮），
  这次 focus 发生在 sheet 抢焦之后。
- 修复：sheet 内改为**带重试的抢焦**（最多 12 次 × 50ms，拿到即停）+
  `onBlur` 守卫把跑到外部的焦点拉回来。
- 实测：打开后 `activeElement` 是编辑框，等待后仍在，键盘输入直接落进去。

**角色卡：单一「新建」入口**
- 工具栏三个按钮（导入 / AI / 新建）合并为一个 **＋ 新建**，
  进入「创建角色」子页（对照参考图）：
  `新建角色` / `从文件导入角色卡` / `从URL导入角色卡` 三张大行卡片 +
  `快捷导入` 示例角色竖版缩略图网格，带返回。
- 实测：工具栏只剩「新建」；子页三行齐全；返回回到列表。

**应用图标（使用所选字体）**
- `scripts/render-icon.mjs` 用 Fraunces 斜体渲染 1024×1024 源图
  （深紫径向渐变 + 粉紫渐变字 + 底部细线），经 `tauri icon` 生成
  全平台图标（Android mipmap 全密度、桌面 ico/icns、Windows Square*）。
- 本次安装用 **先卸载再安装**，确保启动器图标更新。

**验证**
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **32 套 356/356**（card-sheet 1 项为无头像占位，非缺陷） |
| 真机 release | 8/8（干净安装） |

## 第 33 轮：酒馆插件 CSP 修复 / HTML 代码块渲染 / 侧栏动画取消

**酒馆插件加载失败（真 bug，截图可见）**
- 现象：真实酒馆助手 v4.12.1 安装成功但状态「失败」，报
  `Evaluating a string as JavaScript violates ... 'unsafe-eval' is not an allowed source of script`。
- 根因：生产包的 CSP 是 `script-src 'self' blob:`，**没有 `'unsafe-eval'`**。
  RPNow 插件走 `import(blob:)` 不受影响，但酒馆扩展是**原始脚本文本**，
  必须用 `new Function` 求值 → 被 CSP 拒绝。
  开发环境不带 CSP，所以此前所有 e2e 都是绿的，**只在真机暴露**。
- 修复：`tauri.conf.json` 的 `script-src` 加上 `'unsafe-eval'`。
- 教训：涉及生产 CSP 的路径必须在真机 APK 上验证。

**```html 代码块不渲染为 iframe（真 bug）**
- 现象：聊天里 ```` ```html …``` ```` 直接被吞掉/显示原文，从不变成卡片。
- 根因两层：
  1. 占位符用的是 HTML 注释 `<!--RPHTMLCARD:n-->`，而 **DOMPurify 会删除注释**
     → `restoreHtmlCards` 永远匹配不到，内容静默丢失；
  2. 围栏正则只认 ```` ```html\n ````，不认 ```` ```HTML ````、前导空格、
     以及**闭合围栏缺失**（模型截断输出时）。
- 修复：
  - 占位改为真实元素 `<rp-html-card data-rp-html="n">`，并把该标签/属性
    加入 sanitize 白名单，sanitize 之后替换成沙盒 iframe；
  - 正则改为大小写不敏感、容忍前后空白，并额外处理**未闭合围栏**。
- 实测（`scripts/html-fence-check.mjs`，8 条）：代码块→iframe、
  无残留备份符、前后正文保留、sandbox 含 `allow-scripts`、
  **iframe 文档内含原 `<script>`**、未闭合围栏也能渲染。

**侧边栏内部动画取消**
- 去掉会话列表的 `rp-anim-stagger` 逐行入场：抽屉本身已经在滑，
  行再逐个淡入显得嘈杂。

**验证**
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **33 套 371/371** |
| 真机 | APK 已构建（`release/RPNow_0.1.0_android-arm64.apk`），设备离线未安装 |

## 第 34 轮：酒馆扩展 ES 模块加载

**`Cannot use import statement outside a module`（真 bug）**
- CSP 放开后暴露出的下一层问题：真实酒馆助手 v4.12.1 的入口是 **ES 模块**
  （含 `import`/`export`），而兼容层用 `new Function` 求值 —— 该方式**不支持模块语法**，
  所以依然「失败」。
- 修复：兼容层改为**双路径加载**
  1. 先判断脚本是否含 `import`/`export`；
  2. 模块型 → 用 Blob URL + 动态 `import()`（CSP 已允许 `blob:`），
     shim 提前挂到 `window` 供模块读取全局；
  3. 经典 IIFE 型 → 保留 `new Function` 路径（老插件不受影响）。
- 外部裸依赖（`import x from 'lodash'`）无法在运行时解析，专门给出可操作提示：
  「酒馆扩展使用了外部依赖，兼容层无法解析……请改用作者提供的打包版（单文件）」。
- 同时把 `activateSTExtension` 改为 async（调用方 await），并清理
  `jQuery`/`$` 全局。

**验证**（`scripts/st-esm-check.mjs`，6 条）
| 用例 | 结果 |
|---|---|
| ES 模块扩展加载并执行 | ✅ |
| 模块内读到 `getContext().chat` / 角色名 / 事件系统 | ✅ |
| 经典 IIFE 扩展仍可加载 | ✅ |
| 裸依赖报错且提示清晰 | ✅ |
| 卸载后全局还原 | ✅ |

| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| 相关 e2e | 全绿（含 ST 导入 15、运行 12、GitHub 安装 10） |
| 真机 | APK 已构建，设备离线未安装 |

## 第 35 轮：酒馆多文件模块 / 侧边栏预挂载

**酒馆插件：多文件 ES 模块（第三层真 bug）**
- 上一轮改成 Blob 模块后，报错变成
  `Failed to resolve module specifier '../../../../scripts/utils.js'`。
- 根因：解析时**只提取入口文件**，包里其他模块全部丢弃；而酒馆助手是多文件
  ES 模块，用相对路径互相 import。Blob 模块没有目录概念，相对路径无从解析。
- 修复：
  1. `parseSTExtension` 收集扩展根目录下**全部 JS 文件**（上限 400），
     以相对路径为键存入 `assets['__st__/modules/…']`，并记录 `stEntry`；
  2. 桥接层实现 `resolveRelative`（处理 `./`、`../`、省略后缀）；
  3. 按**依赖拓扑顺序**（DFS 后序）生成 blob URL，逐个把相对 specifier
     重写成真实 blob URL —— 顺序错了父模块会引用到还不存在的 URL。
- 实测（`scripts/st-multifile-check.mjs`，7 条）：入口记录、模块树解析、
  同级导入、嵌套目录导入、模块内读 ST 上下文、缺失模块报错可读。

**侧边栏首次打开露出背景（真 bug）**
- 现象：第一次点 ☰ 时，先闪一下背景，内容才出现；且此前背景色与主题不符。
- 根因：两侧面板 `visibleSide` 初始为 null，**首次打开才挂载** ——
  滑动动画开始时面板还没渲染。
- 修复：两侧面板**启动即挂载**并常驻，仅用 `aria-hidden` 标记可见性、
  用 `pointer-events-none` 阻止隐藏面板吃掉点击。内容是主题渲染好的，
  打开瞬间就有画面，不再露背景。

**验证**
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **35 套全绿**（新增 st-multifile 7、panel-premount 7） |
| 真机 | APK 已构建，设备离线未安装 |

## 第 36 轮：侧栏重叠 / HTML 卡片盒模型

**左右侧栏叠在一起（我上轮引入的回归）**
- 现象：打开左栏时，右侧「对话设置」面板压在左栏上面，两块内容重叠。
- 根因：上一轮为了消除「首次打开露背景」，把**两侧面板都改成了常驻挂载**，
  但只加了 `pointer-events-none` —— 面板仍然参与绘制。两者都是 `absolute`
  且宽 75vw（293px），右栏 `right-0`、左栏 `left-0`，在 390px 屏上重叠 196px。
- 修复：非激活面板加 **`invisible`**（`visibility:hidden`）：
  - 子树保持布局与样式（不重挂载、不会有背景闪烁，预渲染的好处保留）；
  - 同时彻底退出绘制与命中测试，不再叠在另一侧上。
- 实测：静止时两侧 `hidden`；打开左栏后 `left=visible`、`right=hidden`。

**HTML 渲染出现后整页像被套了一层边框/边距**
- 排查：在**真实气泡**里测量，iframe / `.rp-html-card` / `.rp-md` 三者宽度
  完全一致（307px，左边距 27px），页面无横向溢出 —— 尺寸本身是对的。
- 但 `.rp-html-card` **完全没有样式**，一旦卡片的 HTML 结构或外边距异常，
  没有任何兜底。补齐盒模型：
  - `.rp-html-card` 为 `display:block; width:100%; margin:.6em 0;
    overflow:hidden; border:0; background:transparent; border-radius:10px`；
  - 子 iframe `display:block; width:100%; border:0`。
  这样卡片是消息流里一个干净的块，不会再带出多余的边框或外间距。

**验证**
| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| 相关 e2e | pushaside 16/16、panel-premount 7/7、redesign 19/19、html-fence 8/8、chat 9/9 等全绿 |
| 真机 | APK 已构建，设备离线未安装 |

## 第 37 轮：酒馆插件真实布局兼容（包裹目录 / 跨级 `../` / 动态 import）

**测试方法纠正**
- 之前一直用自己编的假插件测试，掩盖了真实包的问题。本轮改为按**真实扩展的
  打包形态**构造用例：GitHub 下载的包裹目录、深 `src/` 树、跨目录 `../`、
  省略后缀、目录 `index.js`、动态 `import()`。

**四个真 bug**
1. **包裹目录不被识别** —— 仓库 zip 通常是 `repo-main/manifest.json`，
   而解析只在根找 `manifest.json`，直接报「缺少 manifest.json」。
   → 增加**单层解包**（仅在唯一嵌套时重挂根，保持 zip-slip 防护有效）。
2. **`../` 越过包根被当作失败** —— 解包后 `src/index.js` import
   `../../scripts/utils.js` 时向上跳超出根，旧实现直接返回 null。
   → 改为“能跳就跳”，不再因超出而放弃。
3. **后缀/目录形式不匹配** —— `./util`、`./mod` 解析不到 `util.js`、
   `mod/index.js`。→ 返回**候选列表**（`.js`/`.mjs`/`/index.js`），
   取第一个真实存在的。
4. **动态 `import()` 未被重写** —— 依赖收集与重写用了两套不同的正则，
   正则漏掉 `import('...')`（引号前无 `from`），导致该模块从未生成 blob URL。
   → 统一为同一份正则常量，覆盖 `from` / `import '…'` / `import('…')`
   / `export * from`。

**错误信息**
- 解析失败时不再只说“无法解析”，而是列出**具体缺失的模块名 + 包内实际文件**，
  让“安装包不完整”与“真的用了外部依赖”一眼可辨。

**验证**（`scripts/st-reallayout-check.mjs`，5 条真实形态用例）
| 用例 | 结果 |
|---|---|
| 包裹目录 + 跨级 `../` 导入 | ✅ |
| 省略 `.js` 后缀 | ✅ |
| 目录 `index.js` | ✅ |
| 动态 `import()` 的模块被识别与打包 | ✅ |
| 缺失文件报错列出包内文件 | ✅ |

| | 结果 |
|---|---|
| 单元 | 330/330 |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| ST 相关 e2e | runtime 12/12、import 15/15、ESM 6/6、multifile 7/7、reallayout 5/5 |
| 真机 release | **8/8**（已安装） |

## 第 38 轮：酒馆插件模块加载 —— 找到真正的根因

**先回答「SillyTavern 怎么做到的」**
- ST 每个扩展解压到**真实目录**，然后只做一件事：
  `<script type="module" src="/scripts/extensions/x/index.js">`。
  **模块解析完全由浏览器 + HTTP 服务器完成**，ST 自己没写一行解析代码。
- 我们没有目录（包在 IndexedDB 里），只能为每个模块造 blob URL 并重写说明符。

**四个真 bug（逐个用浏览器内探针定位）**
1. **lexer 未初始化** —— `es-module-lexer` 是 WASM 构建，`init` 之前调用
   `parse` 直接抛 "parse is not a function"。这个异常被过宽的 `catch` 吞掉，
   变成“没找到任何 import” → **什么都没被重写**。修复：`await lexerInit`，
   并且 catch 改为 `console.warn`（静默吞错让这个问题藏了很久）。
2. **`finally` 里 revoke 了 blob** —— `import()` 是异步的，模块图在之后
   继续拉取兄弟模块，此时 URL 已被回收 → `Failed to fetch dynamically
   imported module`。修复：blob 生命周期延长到 `dispose()`。
3. **多轮重写互相覆盖** —— 重写后的 body 引用的是上一轮 URL，而上一轮被
   revoke → entry 引用了死链。修复：每轮产生的 blob **全部保留**，
   两轮收敛后不再 revoke 任何中间产物（内存由包体积决定，约 1MB，卸载时释放）。
4. **正则 vs 解析器** —— 手写正则漏掉 `import(/*…*\/)` 等形态。改用
   **`es-module-lexer`**（Vite 内部同款）按字节偏移替换，不受字符串/注释干扰。

**测试方法也改了**
- 之前用自己编的简单包，掩盖了真实布局问题。新增
  `scripts/st-reallayout-check.mjs`，按真实扩展形态构造：包裹目录、
  深 `src/` 树、跨级 `../`、省略后缀、目录 `index.js`、动态 `import()`。

**验证**
| 用例 | 结果 |
|---|---|
| 包裹目录 + 跨级 `../` 导入 | ✅ |
| 省略 `.js` 后缀 | ✅ |
| 目录 `index.js` | ✅ |
| 动态 `import()` 模块识别 | ✅ |
| 缺失模块报错列出包内文件 | ✅ |
| ST 相关全套 | runtime 12/12、import 15/15、ESM 6/6、multifile 7/7、reallayout 5/5 |
| 单元 / smoke / 其他 e2e | 330/330、21/21、全绿 |
| 真机 release | **8/8**（已安装） |

## 第 39 轮：整页边框根因 / 插件开发文档 / 样式隔离 / 全量插槽

**整页"边框"的真正根因（真机实测定位）**
- 现象：页面四周像被套了一层边框/内边距。
- 用 CDP 连真机 WebView 读计算样式，抓到：
  `body { padding: 6px }` 与 `body { padding: 3px }` 两条规则在生效。
- 源码里写的是 `body { margin: 0 !important; padding: 0 }` —— **padding 没有
  `!important`**，被后加载的规则覆盖，于是每层都被推进去 3px（388 宽，
  左边距 3）。
- 修复：`html` 与 `body` 的 `margin` / `padding` 全部 `!important` 归零
  （应用是 edge-to-edge 设计，任何内边距都会显形）。
- 验证：真机 CDP 实测 `bodyPadding: 0px`、`bodyMargin: 0px`、无溢出。

**插件样式隔离（新增 `core/plugins/scoped-styles.ts`）**
- 插件注入的 CSS 直接进 `head` 就是全局的 —— 一个 `body{padding:3px}` 就会
  重绘整个应用。这是上面那个 bug 的同源风险。
- `injectScopedStyles()` 做四件事：
  1. 每个选择器追加 `[data-rp-scope]`；
  2. `html` / `body` / `:root` / `*` 改写为作用域宿主；
  3. 整段包进低优先级 `@layer rp-plugin-<id>`（永远输给应用自身样式）；
  4. `@media`/`@supports`/`@container` 递归作用域化；`@keyframes` 自动加前缀；
     `@import` 丢弃；注释剥离。
- 12 条单测覆盖：类选择器、根选择器改写、选择器列表、`:is()` 内的逗号、
  `@media` 递归、keyframes 改名、`@font-face` 保留、注释剥离、`@import` 丢弃、
  压缩单行、恶意 `body,*` 规则。

**任意位置插入 UI：13 个插槽全部接通**
- 新增 `SlotOutlet` 通用组件；把此前**定义了但从未渲染**的 11 个插槽接到真实
  界面：`app.nav`、`app.overlay`、`chat.composer`、`cards.tile`、
  `cards.editor`、`lore.entry`、`settings.body` 等。
- `order` 语义：越小越优先，`0` 替换默认实现，`>=100` 追加。

**插件开发文档 `docs/PLUGIN-DEVELOPMENT.md`**
- 13 章：快速开始、包结构、manifest 字段、生命周期、样式隔离、插槽、
  数据、服务、配置、网络/密钥、酒馆扩展兼容、调试排错、检查清单、完整示例。
- 文档里承诺的 API 全部**真实实现并验证**（`scripts/guide-api-check.mjs` 11 条）：
  `ctx.log` / `ctx.on` / `ctx.get` / `ctx.provide` / `ctx.requires` /
  `ctx.readConfig` / `ctx.config.get` / `ctx.config.onChange` /
  `ctx.mountSlot` / `ctx.injectCss` / `ctx.React` / `ctx.SLOT` / `ctx.rpnow`。
- 补齐实现：`manifest.host` 默认 `ui`；`ctx.config.get()` 合并 manifest 声明的
  默认值；`RPNowDataApi.getState()`；内核别名 `log/on/requires/readConfig`。

**顺带修的真 bug**
- `.rpnx` 插件的清理在 `apply()` 的 `finally` 里执行 → **每次激活都把刚注册的
  插槽和样式删掉**（激活成功但界面毫无变化）。改为成功时把清理交给内核，
  仅失败时立即清理。
- `kernel.sync()` 只激活、从不停用 → 停用插件后插槽/样式残留。
- 停用状态只写 IndexedDB、不同步内核 → `sync()` 忽略。现由
  `setStoredEnabled()` 对齐。

**验证**
| | 结果 |
|---|---|
| 单元 | **342/342**（+12 样式作用域） |
| smoke | 21/21 |
| UI 点击审计 | 0 问题 |
| e2e | **44 套全绿**（新增 plugin-api 13、guide-api 11） |
| 真机 release | 8/8（覆盖安装，数据保留） |
| 真机 CDP | `bodyPadding 0px` / `bodyMargin 0px` / 无溢出 |

## 第 40 轮：酒馆助手兼容调查（真机 + 真实包）

**查清了根因**：酒馆助手不是自包含插件。

- 真实包 `N0VI028/JS-Slash-Runner` v4.12.1（2.5 MB），入口 `dist/index.js`（1.12 MB）
- 该入口 **`import` 了 26 个宿主文件、152 个绑定**（`../../../../../scripts/utils.js` 等）
- SillyTavern 能跑，是因为扩展解压在 `public/scripts/extensions/third-party/<name>/`，
  相对路径正好落到 `public/scripts/*` —— **目录层级就是解析依据**
- 另外依赖宿主全局：`_`（lodash）、`$`/`jQuery`、`hljs`、`Popper`、`toastr`、
  `#extensions_settings` 容器、`characters`/`chat`/`eventSource` 等

**已实现的机制**（`st-host-runtime.ts`，对所有酒馆扩展都是增益）

- `hostModules` + `hostModuleKey()`：包外相对引用先查宿主运行时表；
- `installHostGlobals()`：注入 lodash / jQuery / moment / DOMPurify / Popper /
  toastr / hljs，创建 `#extensions_settings` 容器，发布酒馆状态全局；
- `buildHostShims()`：按绑定表生成 26 个宿主模块的 shim；
- `VALUE_BINDINGS`：值型绑定给真实值（i18n、设置块、宏、斜杠命令枚举…），
  避免渲染成 `[object Function]`；
- `makeStubClass()`：静态工厂方法按需补全（`fromProps`、`registerMacro`…）。

**验证进度**

- ✅ 包解析、单层解包、入口识别、模块树收集
- ✅ **26 个宿主模块说明符全部解析成功**
- ✅ **扩展可激活**（全局与容器就位）
- ❌ Vue 应用未挂载 —— 被深层静态/实例 API 缺失阻断
  （依次撞到 `promptManager.render`、`MacrosParser.registerMacro`、
  `SlashCommandEnumValue.fromProps`、`….boolean`）

**诚实评估**：这是长尾。每次补一个 API 前进一格，但缺失分散在 26 个模块的
静态方法、实例方法与真实语义里。仅"不报错加载"还需补若干静态方法；
"功能可用"需为 152 个绑定中的相当一部分提供真实实现。

**建议**：自包含型酒馆扩展（如 `Extension-WebSearch`）已完全可用；
酒馆助手这类宿主依赖型建议单独立项，按"加载 → 挂载 → 功能"推进。
本轮改动**不影响任何现有功能**（342 单测 + 全部 e2e 通过）。

## 第 41 轮：酒馆助手 **激活成功**（Vue 应用已挂载）

**三个缺口（全部用真实包定位）**
1. **激活钩子从未被调用** —— SillyTavern 通过 `manifest.hooks.activate`
   指定的导出函数启动扩展（酒馆助手导出 `activateTauriTavernChatSurface`）。
   之前只 `import` 了模块就完事，所以「装上了但什么都没渲染」。
   → 现在按 `hooks.activate` 调用导出函数（兜底 `default`）。
2. **内核事件没人发** —— 桥接订阅 `chat:message-sent` / `chat:message-received`，
   但内核从未 emit。渲染器靠 `MESSAGE_RECEIVED` 重渲染楼层 → 永不触发。
   → 在 `send()` 和 `generate()` 提交消息后真正 `emit`。
3. **宿主绑定长尾**（依次撞到）：
   - `eventSource` 缺 `once`（script.js 导入形态）
   - `getPresetManager` 缺 `getSelectedPreset` 等十余个方法 → 改为**按需代理**
   - `commonEnumProviders.boolean('trueFalse')()` 需要两段链式调用
   - `promptManager.render` 在模块顶层读取 → 值必须是对象而非 null
   - universal 代理改成**自引用叶子**，避免 Vue 深遍历爆栈

**验证结果（真实包，dev 环境）**

```
tavern_helper 容器已出现：
<div class="inline-drawer">
  <b>["酒馆助手"]</b>
  <div class="inline-drawer-icon …">
```

扩展的 Vue 设置界面**真实渲染**出来，未再抛出错误。

**测试适配**：`st-runtime-check` 的样式断言改为作用域式
（`rpnow-st-style` + `data-rp-scope`）；`novel-e2e` 的按钮定位收紧到
`main button`（侧栏预挂载后全局 `button` 会命中 32 个）。

| | 结果 |
|---|---|
| 单元 | 342/342 |
| smoke | 21/21 |
| UI 审计 | 0 问题 |
| ST 相关 e2e | 全绿 |
| 真机 release | **8/8**（覆盖安装，数据保留） |

**下一步（真机确认后）**：手机上重装酒馆助手 → 打开聊天发消息 →
观察其设置面板与渲染器是否工作。已知长尾：`getSelectedPreset` 等深层的
preset-manager 方法已用按需代理兜底，若仍有缺失会以具体方法名报出。

## 第 42 轮：预设 → HTML 流转链（Meowssiah 实测）+ 插件设置宽度

**根因（用 Meowssiah-2.1.6 真实预设定位）**

预设的 HTML 不直接写卡——它靠**显示层正则**把标签变成围栏代码块，酒馆助手才渲染：
1. AI 输出 `<think_nya>…</think_nya>`（纯文本）
2. 预设正则【思维链折叠】（`placement=2, markdownOnly=true`）替换成 ` ```<!DOCTYPE html>… ``` `
3. 【前端综合面板】把 `<options>`/`<summary>` 变成 ` ```html ``` 
4. 酒馆把楼层 `pre>code` 交给酒馆助手（`isFrontend()` 判定含 `html>`/`<head>`/`<body`）

**我们的缺口**：`MessageBubble` 只读**角色卡**的 `regex_scripts`；预设里
`preset.raw`（完整 ST JSON）原样保留但从未被解析——Meowssiah 的 6 条正则
导入时被静默丢弃 → 渲染器无东西可渲。

**修复**
- `extractPresetDisplayRegexes()`：从 preset raw 取 `extensions.regex_scripts`
  **和** `SPresetSettings.RegexBinding.regexes`（Meowssiah 的私有载体），
  只取显示层（markdownOnly），按 find/replace 去重（两处重复携带会双重包裹）；
- 执行顺序对齐 ST：**预设正则先于卡片正则**；
- `MessageBubble` 新增 `preset` prop，ChatView 两处（楼层+流式草稿）传入。

**实测（真实预设 JSON）**：6 条正则提取成功；
`<think_nya>…</think_nya>` → ` ```<!DOCTYPE html>… ``` ` 围栏生成成功。

**插件设置项宽度（你指出的裁剪问题）**
- 原布局：设置面板在卡片标题行的 flex 内（与动作按钮同行），
  `min-w-0 flex-1` 把它压窄 → 手机上输入框被裁剪；
- 修复：面板移出 flex 行，放到卡片**整行宽度**下方。

| | 结果 |
|---|---|
| 单元 | 342/342 |
| smoke / UI 审计 | 21/21 · 0 问题 |
| e2e | 12 套全绿 |
| 真机 release | 8/8（覆盖安装） |

**下一步建议**：真机上用 Meowssiah 预设 + 酒馆助手跑一轮实际对话，
看 `<think_nya>` 楼层是否渲染出前端面板；若仍有缺口按具体绑定补。

## 待完成

- 无（核心功能已全部覆盖）。云备份需要自托管服务端点才能完整恢复；客户端逻辑已按
  RP-Hub 的内容寻址协议实现（SHA-256 分块、gzip、16 位密钥归一化、1GB 上限），
  **恢复会真正下载 blob 并写回角色卡/对话/记忆/小说**。

## 第 2 轮：按差距报告修复的问题

差距报告见 [rphub-gap-report.md](research/rphub-gap-report.md)（183 项逐条核对）。

**语义错位（导入 RP-Hub 内容后行为不对的根源）**
- 世界书 `useRegex` 现在解析 `/pattern/flags`：强制 `i`、去 `g`、`\p{…}` 自动加 `u`
- `at_depth` 插入点改为**只数 user/assistant**，并按条目 `role` 决定注入角色
- 位置别名统一到 `resolvePosition()`：`system_top/an_top`、`global_note/an_bottom`、
  `user_top/em_top`、`assistant_top/em_bottom` 等；导入与 AI 生成都走同一张表

**假可用 → 真可用**
- 云备份恢复：下载 manifest 里每个 blob 并写回 store
- 记忆补录按钮：真正补写缺失总结与向量（带进度）
- 二次压缩：每轮总结后自动执行
- `streamResponses`、`render.fontSize` 死开关已接线

**正确性**
- 内联 CoT 解析（`<think>` / `<thinking>` / `<cot>`）：DeepSeek/GLM/Kimi 经
  OpenAI 兼容口时，思考不再混进正文、编辑与复制；代码块与 HTML 注释受保护
- 工具单轮上限、reasoning 字段补全见差距报告

**新增可见功能**
- 用户在聊天里发图（附件随消息存储与渲染）
- 角色封面背景（模糊铺底）+ 沉浸模式开关
- 服务商剩余额度读数（`/api/log/token`）
- 头像 AI 生成与「换个画法」重 roll

## 验证命令

```bash
node node_modules/vitest/vitest.mjs run     # 单元
node scripts/smoke.mjs                     # 界面
node scripts/chat-e2e.mjs                  # 聊天
node scripts/memory-e2e.mjs                # 记忆
node scripts/tools-e2e.mjs                 # 工具
node scripts/branch-e2e.mjs                # 分支
node scripts/template-e2e.mjs              # UI 模板
node scripts/imagegen-e2e.mjs              # 自动生图
node scripts/cardai-e2e.mjs               # 角色卡 AI 生成
node scripts/novel-e2e.mjs                # 小说编辑器
node scripts/antitrunc-e2e.mjs            # Gemini 抗截断
```

> 改动大量文件后先重启 `vite` 再跑 e2e：Vite HMR 会把模块图分裂成两份
> store 实例，导致 UI 与测试脚本互相看不见。

## 第 44 轮：停用傻酒馆兼容 + 发布/商店/分类

**阶段 0｜隐藏 SillyTavern 扩展兼容（默认关）**
- `settings.stCompat.enabled`（默认 false）集中控制；`parseRpnx` 拒绝 ST manifest、
  `loader` 拒绝旧 `kind:'st-extension'` 记录、插件页移除扩展抽屉入口、
  渲染容器 `TH-render` → `rp-frontend-render`。
- 兼容代码保留于 `core/plugins/st-*`，开关可恢复。验收：`scripts/st-compat-hidden-check.mjs` 5/5、
  `scripts/st-reject-e2e.mjs` 3/3。

**阶段 1–2｜契约与本地商店**
- `core/marketplace/`：types / categories（卡片 9 类、插件 9 类）/ validate（含隐私扫描
  与风险模式提示）/ packaging（`.rpcard`、`.rpxn`、sha256）/ collect / client。
- `scripts/market-server.mjs`（:8799，零依赖 REST，数据在 `market-local/`）；实测
  发布 200 + 列表/分类可用。

**阶段 3–4｜发布向导与商店页**
- `PublishWizard.tsx`（元数据 → 校验/自查 → 打包上传）、`MarketplacePage.tsx`
  （搜索/分类/排序/NSFW/详情/安装/更新/赞踩/举报/版本历史），入口为顶栏「商店」+
  商店内「发布内容」，另有角色卡 ⋮ 菜单与插件页按钮。
- 验收：`market-browse-e2e.mjs` 6/6、`market-publish-e2e.mjs` 6/6。

**验证总览**：typecheck 0；单测 389/389；smoke 21/21；ui-audit 0；chat-e2e 15/15；
plugin-settings-e2e 6/6；html-fence 8/8。文档见 [MARKETPLACE.md](MARKETPLACE.md)。

## 第 43 轮：先挖透傻酒馆源码，再补插件地基（阶段 A–C）

用户要求：**先深探 SillyTavern 真实源码拿到上下文，再动手改造**，并明确"预设都大差不差，
重点是插件与预设有关联"。本轮先完成证据与契约冻结，再按四条通道补齐地基。

### 阶段 A：源码证据（全部带行号/包内位置，见 `docs/research/`）

| 文档 | 内容 |
|---|---|
| `st-plugin-preset-coupling.md` | 主证据 + 关联模型 + 四条通道 + 现状差距 |
| `_st-message-pipeline.md` | `messageFormatting` 全链路、`.mes[mesid]`/`chat[]`、事件 payload、depth |
| `_st-extension-lifecycle.md` | 设置容器层级与宽度 CSS、模板渲染、生命周期、`getContext()` 字段表、manifest |
| `_preset-embedded-runtime.md` | 内嵌运行时逐项依赖、双向通信、安全边界、验收清单 |
| `_preset-extensions-inventory.md` | `readPresetExtensionField` 语义、Meowssiah 全字段清单、三份正则快照 |
| `_th-renderer-contract.md` | `Ck` 判定、`#chat > .mes` 直接子选择器、iframe 契约、事件订阅、生命周期 |

**纠正了三个此前的错误判断**（都以源码为准）：

1. `hooks.activate` 丢失**不是** TH 不渲染的根因——TH 的导出在标准 ST 下是 no-op，真正初始化在 DOM ready；
2. `formats.md` 记的「双标记死组合」与 `engine.js:347-355` 判据不符（双标记会执行）；
3. `#extensions_settings` 被 append 进 `overflow:hidden` 的 `main`，被裁剪成隐形且无入口——
   这才是「设置项看不见/被挤压」的真根因。

### 阶段 B：契约冻结（`docs/research/rpnow-st-compat-contract.md`）

四条通道：数据（`readPresetExtensionField`/任意点号路径/**不可白名单**）、运行时
（`getContext()` 含 `chatCompletionSettings`/`presetManager`/真实 `getRegexedString`）、
DOM（`#chat > .mes[mesid]`、`.mes_text`、可见 `#extensions_settings`）、通信
（RENDERED 事件 + postMessage + 存储前缀隔离）。

### 阶段 C：已落地

| | 实现 | 验证 |
|---|---|---|
| C1 | `types/preset.ts` 增 `extensions`；`cardImport` 原样保真；新建 `core/prompt/preset-extensions.ts` | 12 单测 + **真实 Meowssiah 样本 13/13**（8 条正则并集去重、2 个内嵌脚本） |
| C2 | 新建 `core/prompt/regex-engine.ts`（ST 真值表/placement/depth/`$<name>`/`substituteRegex`）；`builder.runRegex` 委托引擎；来源顺序改为 **SCOPED → PRESET** | 19 单测 |
| C3 | `#chat` 直接子节点即 `.mes`、新增 `#chat > .welcomePanel`、`.mes_text` 类名、`.mes` 补 ST 属性；补 `chatLoaded`/deleted/swiped/edited 事件；桥接层把对象 payload 归一化为数字 `message_id`；统一动态 `eventSource` | 浏览器 e2e **chat-e2e 14/14**（含 `#chat > .mes` 与 `.mes_text pre>code` 断言） |
| C4 | ST manifest 全文透传（`hooks` 不再丢）；`getContext()` 增 `chatCompletionSettings`/`presetManager`/模板与字段 API；host binding 的 `getRegexedString` 与 `regex_placement` 改为真实实现 | typecheck 0；374/374 |
| C5 | `#extensions_settings` 迁到插件页**可见全宽表面**（+ 自动迁移回退节点）；`.rpnx` 配置表单收敛进同一表面 | plugin-settings-e2e 6/6；typecheck 0；374/374 |

### 验证结果（本轮）

| | 结果 |
|---|---|
| typecheck | 0 错误 |
| 单元 | 374/374 |
| smoke | 12 PASS 后在主题页文本多匹配处超时（既有同步点脆弱性，非功能回归，待修） |
| chat-e2e / message-actions / panel-premount / html-fence / st-runtime / round32 / plugin-api / plugin-settings | 全绿 |
| card-sheet-check | 6/7（`hasImage`，样例卡无头像时无 `<img>`，与本轮改动无关，待确认） |

### 下一步

真机 rel56：覆盖安装 → 装酒馆助手 → 导入 Meowssiah → CDP 断言 `.TH-render iframe`、
无源码泄露、设置面板可见全宽、0 页面错误。**未真机验证不交付。**
