# RP-Hub → RPNow 能力差距分析报告

- **参考清单**：`docs/research/rphub-chat-features.md`（主聊天，463 行）、`docs/research/rphub-card-novel-features.md`（角色卡工坊 + 小说，515 行）
- **目标应用**：`D:\RPNow`（React + TypeScript + Vite，源码 `src/`）
- **方法**：把两份清单拆成 **183 项**用户可见能力（比 80–150 的目标区间更细，因为把“预设库”“世界书位置”“设置字段”这类复合能力拆成了独立项），逐项在 `src/` 内 grep/read 验证；只有真正读到实现代码才记 IMPLEMENTED。
- **口径**：RPNow 的架构与 RP-Hub 不同（预设采用 SillyTavern 的 completion/context/instruct/reasoning 四族；内核/渲染/主题/Agent 循环都是可替换插件；世界书用 SillyTavern 的 0–7 数字位置）。因此“IMPLEMENTED”指**用户可见能力存在**，不要求内部实现一致；语义不同即记 PARTIAL。

---

## 1. 总结

| 状态 | 数量 | 含义 |
|---|---|---|
| IMPLEMENTED | 60 | 找到了实现代码，能力可用（含 RPNow 超出 RP-Hub 的部分） |
| PARTIAL | 56 | 有能力但语义/范围/UI 与 RP-Hub 不一致，或设置项是死开关 |
| MISSING | 67 | 完全没有 |
| **合计** | **183** | |

> 注：MISSING 数量偏高是因为 RPNow 的架构选择了不同的实现路径（例如用 SillyTavern 预设取代 RP-Hub 命名预设库、用插件取代独立页面），其中相当一部分是“RP-Hub 有、RPNow 用别的方式覆盖或明确不做”。PARTIAL 中最有价值的是**死开关**（设置了但无消费者）与**语义错位**（世界书位置/深度、正则 flags），而不是“做了一半”。

**一句话结论**：RPNow 在**提示词组装、世界书引擎、记忆四模式、分支、工具、卡片互操作格式、插件化**上已达到或超过 RP-Hub；差距集中在 **① 用量/更新/云备份恢复这类“后台账本”能力，② 世界书 7 位置与正则语义这类“容易抄错”的细节，③ 头像 AI 生成 / 用户发图 / 智能修改 diff 展示 / 小说评论区交互 这四个“看得见的功能”，④ 大量 RP-Hub 设置项在 RPNow 里是死开关（stream、字号、沙盒子开关、副模型模板、reasoning 模板）。**

---

## 2. 分区域差距（仅列 PARTIAL / MISSING）

### A. 聊天视图与导航

**A04 角色卡收藏 — MISSING**
- RP-Hub：角色卡可收藏（`favoriteAt`），列表可按收藏筛选。
- RPNow：`RPCard` 无 `favorite` 字段，`CardLibrary.tsx:67-78` 只按更新时间排序，搜索匹配 name/creator/tags/description。
- 建议：`types/card.ts` 加 `favorite?: boolean`，库页加星标切换与“只看收藏”筛选。

**A05 角色卡批量删 — MISSING**
- RP-Hub：列表可进入批量模式，多选后一次删除。
- RPNow：`CardLibrary.tsx:287-295` 只有单卡 `window.confirm` + `removeCard`。
- 建议：库页加多选模式，复用 `removeCard` 循环，删除前 confirm 数量。

**A06 叠卡 / 网格布局切换 — MISSING**
- RP-Hub：默认 `character-deck` 叠卡轮播（拖拽/箭头/键盘 ←/→、按钮取色），可切网格。
- RPNow：`CardLibrary.tsx:221` 只有响应式网格（`grid-cols-2…5`），无叠卡轮播、无布局切换。
- 建议：加 `viewMode` 状态；叠卡用横向 scroll-snap 实现，键盘左右键切换。

**A07 角色简介面板（楼层/字数/压缩预测） — MISSING**
- RP-Hub：点头像展开简介面板，显示楼层数、正文字数、记忆开启时“→ 压缩后字数”，只读渲染 `description`，带“编辑角色”按钮。
- RPNow：`ChatView.tsx:514-527` 头部只有头像/名字/连接/模型/token 估算/分支徽章，无展开面板、无压缩预测。
- 建议：头部头像点击打开弹层，复用 `card.data.description` + `renderMarkdown`，并用 `estimateTokens` 展示原/压缩后字数。

**A08 用量统计视图 — MISSING**（详见 L）

**A09 正则管理视图 — PARTIAL**
- RP-Hub：独立“正则”视图，可管理名称/正则+flags/替换/placement(用户/AI)/仅用户可见/仅AI可见/最小最大深度/作用范围/启用，支持拖动排序、导入导出。
- RPNow：无独立页面；`CardEditor.tsx:657-763` 的内联编辑器只有 **名称、findRegex、replaceString** 三个字段，其余字段用默认值写死（`placement:[2]`、`markdownOnly:true`、`runOnEdit:true`、`minDepth/maxDepth:null`），不能编辑；卡片库也只能整卡导入导出，没有“正则-only”导入。
- 建议：新增正则管理页；编辑器补齐 flags（g/i/m/s/u）、placement 多选、markdownOnly/promptOnly 互斥、minDepth/maxDepth、runOnEdit、trimStrings、substituteRegex；支持 JSON 导入导出。

**A10 万相广场（外部论坛卡片导入） — MISSING**
- RP-Hub：`square` 视图 iframe 嵌外部论坛，`RPH_FORUM_IMPORT_CARD` 接收 ArrayBuffer(≤100MB) 解析 PNG 卡导入，并双向同步主题。
- RPNow：无该视图、无 postMessage 桥。`AppShell.tsx:45-53` 只有 7 个本地路由。
- 建议：若产品定位需要“在线广场”，加一个 iframe 路由 + 导入桥；否则建议在文档里明确声明该能力不计划复刻。

**A12 记忆浏览视图 — MISSING**
- RP-Hub：独立“记忆”视图，列出总结、显示压缩率条形（原 X 字 → 后 Y 字）、可清空当前模式、可重新生成单条总结。
- RPNow：`SettingsPage.tsx:301-304` 只挂 `MemorySettingsPanel`，该面板 `MemorySettingsPanel.tsx:255-256` 只显示“N 条记忆”计数，没有记录列表、压缩率、清空、重生成。
- 建议：新增记忆页，数据源是 `store.memories[chatId]`；压缩率 = 原文字数 / 总结字数，复用 `summarySources()`。

**A13 世界书/预设/工具/设置视图 — IMPLEMENTED**（位置与 RP-Hub 不同：世界书在左侧导航，工具/模板在设置页签）

### B. 消息渲染与操作

**B02 禁用缩进代码块 — MISSING（语义差异，可能有害）**
- RP-Hub：`marked.use({ breaks:true, tokenizer:{ code(){ return undefined } } })`，**禁用缩进代码块**，让缩进的 HTML（details/summary 等）按 HTML 渲染。
- RPNow：`renderer.ts:30-33` 只设 `gfm:true, breaks:true`，没有禁用 indented code；marked 默认会把 4 空格缩进解析成 `<code>`，卡片里的缩进 HTML 面板会被破坏。
- 建议：在 `marked.setOptions` 里加 `tokenizer: { code() { return undefined } }`（与 RP-Hub 一致），并补一条渲染测试。

**B03 HTML 卡片沙箱与白名单 — PARTIAL**
- RP-Hub：整段 `<!doctype html>`/`<html>` 或 HTML 代码块 → 抽成 `.html-card-container` + **沙箱 iframe**；白名单含 `details,summary,iframe,svg,path,g,circle,rect,defs,linearGradient,stop,style,div,span,script,button,input`，`FORBID_ATTR=[onmouseover,onload]`。
- RPNow：`renderer.ts:187-221` 走 **内联渲染**：`encodeStyleTags` → marked → DOMPurify（`FORBID_TAGS:[script,iframe,object,embed,form,input,textarea,base,link,meta]`，`renderer.ts:152`）→ class 命名空间 → CSS 作用域。`settings.render.sandboxHtml`（`types/chat.ts:159`）**没有任何消费者**（grep 仅命中 SettingsPage），是死开关。
- 影响：RPNow 默认禁止 iframe/script（更安全），但**卡片里的 `<script>` 交互面板、`<iframe>` 内嵌 UI、`<svg>` 图形会丢失或退化**；RP-Hub 用户会直接看到“卡片效果不一样”。
- 建议：要么实现 `sandboxHtml`（对以 `<!doctype`/`<html>` 开头或含 ```html 围栏的消息走 `renderSandboxedFrame` + iframe，函数已存在于 `renderer.ts:228-239`），要么删掉该设置并明确记录差异。

**B04 渲染缓存 / 流式 HTML 截断 — MISSING**
- RP-Hub：渲染缓存 + 帧检测缓存（各 2000 条 LRU），`styleFilterEnabled/regexScripts/user.name` 变化时清空；流式时 `processMainContent` 检测未闭合的 ``` / `<script>` / `<html>` 等并截断显示 spinner。
- RPNow：`MessageBubble.tsx:80-87` 每次 render 都重跑 `renderMessageText` + `renderer.render`，无缓存；流式 draft 直接渲染（`ChatView.tsx:666-680`），未闭合 HTML 会被 DOMPurify 截断但不提示。
- 建议：对 `renderer.render` 结果做按 `message.id + content.length + scripts` 的 LRU；流式时复用 `extractHtmlFences`/标签平衡检测。

**B05 操作栏显示条件 — PARTIAL**
- RP-Hub：非编辑中、非思考/工具运行中、非“最后一条 AI 且生成中”、非“自己是用户消息且会话忙且后面没有用户消息”才显示；重新生成仅最后一条。
- RPNow：`MessageBubble.tsx:229` 操作栏**始终渲染**（`opacity-70`，hover 100%）；`ChatView.tsx:325-331` 允许对**任意** assistant 消息重新生成（截断到该条），没有“仅最后一条”限制，也没有 busy 时禁用。
- 建议：按 RP-Hub 规则加 `canAct`/`canRegenerate` 判断；或明确接受“更宽松”并在文档记录。

**B06 重新生成语义 — PARTIAL**
- RP-Hub：最后是用户消息 → 直接续写（删当前轮记忆）；最后是 AI → 弹确认“该楼层的记忆将被清除”，截断+裁剪记忆/变量/计时再重写。
- RPNow：`ChatView.tsx:325-331` 一律 `slice(0, idx)` 后重写，无确认、**不裁剪记忆**（`store.memories[chatId]` 仍保留被截断轮次的总结，下次 prompt 会把已删轮次的总结当成旧历史）、不裁剪 UI 模板 changeLog/变量。
- 建议：复用 `core/memory/engine.ts` 的 `buildRounds`/`numberMemories`，在截断后把 `sourceAssistantIds` 命中被删消息的记录一并移除并重编号；UI 模板按 turn 裁剪 changeLog。

**B07 编辑语义 — PARTIAL**
- RP-Hub：编辑只改 `parseCot(content).main`，保留 `originalCot`/`originalUiTemplateUpdate`，保存时删除 `styleFilterHits`、中止后台、重算受影响轮次记忆并触发自动补录；未改动提示“消息未改动”。
- RPNow：`ChatView.tsx:343-345` 直接改 `content`；`MessageBubble.tsx:159-182` 行内 textarea。因为 RPNow 生成时就剥掉了 `<ui_template_updates>`（`ChatView.tsx:382`）且 reasoning 单独存字段，**CoT/变量块丢失的问题不存在**；但仍**不重算记忆**，也没有“未改动”提示。
- 建议：保存前比对原文，未变则 toast；编辑 assistant 消息后调用 `MemoryService` 重算该轮总结。

**B08 复制语义 — PARTIAL**
- RP-Hub：复制前去掉 `<ui_template_updates>` 与 `[M#]` 引用。
- RPNow：`MessageBubble.tsx:275-284` 复制 `message.content` 原文。RPNow 生成时已剥变量块，但**模型按 `<memory_citation>` 指令写在正文里的 `[M12]` 会一并复制**；`core/memory/types.ts:147-149` 的 `stripCitations()` 已实现但**无任何调用者**（grep 仅定义处）。
- 建议：`onCopy` 里调用 `stripCitations(content)`。

**B10 删除约束 — PARTIAL**
- RP-Hub：仅“最后一条用户消息及其后连续 assistant/system”可删；删用户轮会带走整轮并清理记忆/UI 变更/计时。
- RPNow：`ChatView.tsx:339-341` 可按 id 删除**任意单条**消息，无约束、无记忆/变量/激活快照清理（`chat.activation` 会残留）。
- 建议：至少补上“删除后重算记忆与 `activation` 快照”，并明确是否保留更自由的单条删除。

**B11 文风过滤详情 — MISSING**
- RP-Hub：`styleFilterEnabled` 默认开，助手消息被过滤的片段记录在 `styleFilterHits`，操作栏显示“查看本条回复过滤的 N 处内容”弹层。
- RPNow：全仓库无 `styleFilter`/文风过滤实现（grep 无命中）。
- 建议：这是内容侧的“抗八股”能力，需先定义词表/规则来源；若不做，建议把 RP-Hub 的“文风”预设内容并入提示词（见 F03/F05），而不是做消息后处理。

**B12 移动端操作栏常显 / 触摸反馈 — PARTIAL**
- RP-Hub：移动端操作栏常显（`opacity-100`），桌面 hover 才显；`hover:none` 时用 `.is-tapped` 反馈。
- RPNow：`MessageBubble.tsx:229` 统一 `opacity-70` + `group-hover:opacity-100`，桌面不是“隐藏到 hover 才显”，移动也不是全显；无 `.is-tapped`。
- 建议：用 `@media (hover:hover)` 区分，移动端 `opacity-100`。

**B13 用户头像 / 系统消息气泡 — PARTIAL**
- RP-Hub：用户头像取 `msg.avatar || user.avatar`，否则首字符渐变块；系统消息 `.msg-bubble--system`（红色）。
- RPNow：`MessageBubble.tsx:77` `const avatar = isUser ? undefined : card.avatar` —— **用户消息永远没有头像**；`RPPersona.avatar`（`types/chat.ts:18`）存在但 `PersonaSettings.tsx` 无上传 UI、聊天也不用。`role:'system'` 消息走 `isUser=false` 分支，渲染成角色气泡而非红色系统气泡。
- 建议：persona 加头像上传；`MessageBubble` 按 `message.role==='system'` 单独样式。

### C. 思考与流式

**C01 原生 reasoning 多字段提取 — PARTIAL**
- RP-Hub：从 `reasoning_content/reasoning/thinking/thinking_content/thought/thoughts/reasoning_text`、`reasoning_details`、以及 `content[]` 中 `thought===true` 或 `type` 含 reason/thinking/thought 的部分提取。
- RPNow：`adapters.ts:30-45` 只认 `reasoning_content`、`reasoning`、`thinking` 和 `reasoning_details[].text`；Gemini 走 `parts[].thought`（`adapters.ts:419,442`）。缺 `thinking_content/thought/thoughts/reasoning_text`，OpenAI 兼容渠道的 `content[] thought` 也缺。
- 建议：把候选键补全，并加 `Array.isArray(delta.content)` 的 thought 分片分支。

**C02 CoT 解析与模型标签 — MISSING**
- RP-Hub：`parseCot` 把 `<thinking>/<think>/<cot>` 当思考，保护 HTML/代码/注释/变量块；`usesThinkingCotTag(model)=/deepseek|glm|kimi/i` 决定用 `<thinking>` 还是 `<cot>`。
- RPNow：全仓库无 `parseCot`、无 `<cot>`/`<thinking>` 内容解析（grep 仅命中 `defaults/presets.ts:240` 的 reasoning 模板 prefix）。RPNow 只依赖原生 reasoning 字段。
- 影响：用会输出 `<think>…</think>` 的模型（DeepSeek/GLM/Kimi 经 OpenAI 兼容口）时，思考内容会**混在正文里**被渲染给用户，且编辑/复制会带上。
- 建议：实现 `parseCot` 并在 `renderMessageText` 里剥掉思考段；或强制所有 reasoning 模型改用原生字段。

**C03 思考 / 工具时间线 UI — MISSING**
- RP-Hub：一个“Thinking”卡片，含原生思考、每个工具调用的 reason 行+调用行（状态 receiving/queued/running/done/error/continuing，详情含参数/输出/错误）、分析过程；可折叠。
- RPNow：`defaultLoop.ts:97` 收集了 `toolTrace`，`AgentResult.toolTrace`（`agent/types.ts:52`）已定义，但 **UI 完全不渲染**（grep `toolTrace` 无 tsx 命中）；消息只显示 `message.reasoning`（`MessageBubble.tsx:131-149`）。
- 建议：在 MessageBubble 的 reasoning 折叠块下渲染 `toolTrace`（名称、参数、结果摘要、错误），或用 `chat.message.actions` 插件槽暴露。

**C04 自动折叠 reasoning — PARTIAL**
- RP-Hub：正文到达后自动折叠原生 reasoning；用户手动展开过则不再自动折叠。
- RPNow：`MessageBubble.tsx:71` `reasoningOpen` 默认 false，无“正文到达”检测、无“用户手动展开过”记忆（`isReasoningUserToggled` 之类字段不存在）。
- 建议：加 `autoCollapsed` 状态，`useEffect` 在 `message.content` 非空时折叠，用户点击后置 `userToggled=true`。

**C05 stream 开关 — PARTIAL（死开关）**
- RP-Hub：`settings.stream` 默认 true，但加载时**强制** true（用户改不了）。
- RPNow：`types/chat.ts:171,253` 有 `streamResponses`，`SettingsPage.tsx:265-271` 有开关，但 `defaultLoop.ts:41-50` **无条件 `stream:true`**，`LLMService.complete` 也强制 `stream:true`（`builtins.ts:109`）。开关无效果。
- 建议：`sendTurn` 把 `settings.chat.streamResponses` 传进 loop，由 loop 决定 `stream` 与是否走 `llm.complete`；或删掉开关。

**C06 delta flush / 空闲超时 — MISSING**
- RP-Hub：客户端每 60ms flush 一次 delta；120s 无 chunk 超时。
- RPNow：`ChatView.tsx:194-201` 每个 delta 都 `setDraft`（无节流）；`sse.ts` 无超时逻辑。
- 建议：加 60ms 合并；SSE reader 加 120s idle `AbortController`。

**C07 非流式 / 非 SSE 兜底 — PARTIAL**
- RP-Hub：`content-type` 不是 `text/event-stream` 时按普通 JSON 解析（兼容 `data:` 开头）。
- RPNow：`adapters.ts:103-120` 处理了 `req.stream===false` 的 JSON 响应，但默认循环从不走这条路；若服务端忽略 `stream:true` 返回 JSON，`sseJson` 解析会失败。
- 建议：在 `stream()` 里检查 `res.headers.get('content-type')`，非 SSE 直接 `res.json()`。

**C08 中止生成 — PARTIAL**
- RP-Hub：中止 UI 模板分析、主请求、工具队列；运行中的工具调用标记 `error`“生成已中止”。
- RPNow：`ChatView.tsx:304-306` `abortRef.current?.abort()`，loop 抛 `AbortError`，`ChatView.tsx:270-282` 把已流式部分存为“（已中断）”消息。无工具队列可中止（工具是同步 await），也不标记工具状态。
- 建议：补工具调用状态标记；其余可接受。

**C09 等待动画 / GenerationTimer — MISSING**
- RP-Hub：打字三点 + `waitTime / estimatedTime`（最近 5 次平均）。
- RPNow：`ChatView.tsx:741` 只有一个 `Loader2` spinner，无计时、无预估。
- 建议：存最近 5 次 `durationMs` 到 chat.meta，显示 `已等待 Xs / 约 Ys`。

**C11 抗截断禁用 COT 预设 — MISSING**（RPNow 无 COT 预设，见 C02/F06）

**C12 Gemini 输入混淆 — MISSING**
- RP-Hub：把最新用户消息替换为“读取 `read_user_input` 的返回内容…”，真实输入放工具结果；每次请求用零宽字符编码新 UUID 前缀。
- RPNow：`orchestrator.ts:364-443` 只做 `output_reply` 工具重试，无 `read_user_input` 混淆。
- 建议：若 Gemini 截断仍频发再补；优先级低。

### D. 工具系统

**D06 单轮最多 5 项 — PARTIAL（设置不生效）**
- RP-Hub：单次最多执行 5 个工具调用。
- RPNow：`tools/types.ts:54` `maxToolCalls:5`，`provider.ts:131-140` `executeTools` 会 `slice(0, maxToolCalls)`；**但默认循环 `defaultLoop.ts:84-103` 直接遍历 `toolCalls`，从不调用 `executeTools`**，所以上限不生效。
- 建议：在 `defaultLoop` 里 `toolCalls.slice(0, opts.context.maxToolCalls ?? 5)`，或改调 `executeTools`。

**D09 工具调用 UI 时间线 — MISSING**（见 C03）

### E. 世界书

**E01 条目字段完整性 — PARTIAL**
- RP-Hub：`comment/content/enabled/scope/keys[]/useRegex/constant/position/order/depth/scanDepth/probability/useProbability`。
- RPNow：`types/lorebook.ts:30-82` 字段更全（含 secondaryKeys/selective/group/sticky/cooldown/delay/outlet 等），但 **没有 `scope`**（RPNow 用“卡片内嵌 + 聊天勾选”代替）；`scanDepth` 字段存在但 **LorebookEditor.tsx 没有暴露该输入**（只暴露全局 scanDepth，`SettingsPage.tsx:238-253`）。
- 建议：条目编辑加“扫描深度”数字输入，绑定 `entry.scanDepth`。

**E02 七位置语义 — PARTIAL（最易错）**
- RP-Hub 七位置：`system_top`（系统最顶层）、`global_note`（全局备注）、`before_char`、`after_char`、`at_depth`、`user_top`（最新用户消息顶部）、`assistant_top`（最新助手消息顶部）。
- RPNow 用 SillyTavern 0–7：`before(0)/after(1)/ANTop(2)/ANBottom(3)/atDepth(4)/EMTop(5)/EMBottom(6)/outlet(7)`（`types/card.ts:97-118`）。**没有 user_top / assistant_top**；`system_top`/`global_note` 在 AI 生成映射里被映射成 `ANTop(3)`/`ANBottom(4)`（`cardai/map.ts:17-28`），语义不同（作者注释顶/底 ≠ 系统最顶层/全局备注）。
- 建议：要么新增两个位置枚举（会破坏与 ST 卡互操作），要么在导入/AI 生成时把 `user_top`/`assistant_top` 明确映射到最接近的 ST 位置并在 UI 上标注差异。当前 `cardai/map.ts` 的映射表把 RP-Hub 名字硬编码成 ST 数字，**会把 RP-Hub 世界书导入成错误位置**，至少该映射表需要 review。

**E03 位置别名 / 数字归一化 — PARTIAL**
- RP-Hub：`before_character`、`an_top`、数字 0-4 等旧别名会归一化。
- RPNow：`fromCardEntry`（`types/lorebook.ts:140-156`）只认 `extensions.position` 数字 + `position==='after_char'?'after':'before'` 字符串；RP-Hub 的 `system_top/user_top/...` 字符串会**全部落到 before**。`cardai/map.ts` 的别名表只用于 AI 生成，不用于导入。
- 建议：把 `POSITION_MAP` 提到 `types/lorebook.ts`，在 `fromCardEntry` 里统一使用。

**E05 useRegex `/pattern/flags` 解析 — PARTIAL**
- RP-Hub：`/pattern/flags` 强制加 `i`、去 `g`，遇 `\p{` 加 `u`。
- RPNow：`lorebook/engine.ts:125-131` 直接 `new RegExp(key, entry.caseSensitive ? '' : 'i')` —— **不解析 `/…/flags` 字面量**（`/dragon/i` 会因非法正则而永远不命中），也不做去 `g`/加 `u`。
- 建议：复用 `prompt/builder.ts:212-229` 的 `/…/flags` 解析思路，在 `keyMatches` 里统一处理。

**E07 at_depth 注入与计数 — PARTIAL**
- RP-Hub：`at_depth` 作为 `role:'user'` 插在“从末尾数第 depth 个 user/assistant 之前”，**计数只算 user/assistant**（depth=4 即第 5 条前）。
- RPNow：`prompt/builder.ts:463-464` 注入为 **`role:'system'`**；`prompt/builder.ts:526-529` 用 `withDepth.length - depth`，**把系统提示/世界书注入也算进计数**，落点会更深。
- 建议：改为按“只数 user/assistant”计算插入点，并允许 `entry.role`（0/1/2）决定注入角色（`extensions.role` 已经读进来了，见 `types/lorebook.ts:156`，但 builder 没用）。

**E08 user_top / assistant_top — MISSING**
- RPNow 的 8 个位置里没有这两个；`WI_POSITION_LABELS`（`types/card.ts:109-118`）也没有对应标签。
- 建议：若不做独立枚举，可在 `atDepth` 基础上用 `role` + `depth` 组合模拟；或在 UI 上把 EMTop/EMBottom 改名以覆盖“示例消息顶/底”语义。

**E09 system_top / global_note — PARTIAL**
- RP-Hub：进系统提示（最顶层 / 全局备注）。
- RPNow：ANTop/ANBottom 作为**独立 system 消息**注入（`prompt/builder.ts:466-472`），并因 `builder.ts:516-518` 的合并规则与相邻 system 合并；顺序按 position 排序，不是“最顶层”。
- 建议：明确 ANTop 的“最前”语义，或补两个位置。

**E11 scanDepth / maxDepth — PARTIAL**
- RP-Hub：全局 `scanDepth` 默认 2（0–20）、`maxDepth` 默认 0（0–50，条目深度上限）。
- RPNow：`types/chat.ts:196` 默认 **4**，`SettingsPage.tsx:246-250` 范围 **1–20**；无 `maxDepth` 概念。
- 建议：默认值对齐（2）或文档说明；`maxDepth` 可在 `activate()` 里 clamp `entry.scanDepth`。

### F. 预设与注入

**F01 预设 role 与 user/assistant 消息注入 — PARTIAL**
- RP-Hub：预设 `{name,content,enabled,role}`，`role ∈ {system,user,assistant}`；`role:user/assistant` 的预设作为消息插在系统消息之后、角色前导之前。
- RPNow：`RPPromptEntry` 有 `role`（`types/preset.ts:47`），`builder.ts:431-443` 会按 role 发出消息；但**没有“插在角色前导之前”的固定规则**（顺序完全由 `prompt_order` 决定），也没有 RP-Hub 那种“简单 name+content+role 列表”预设。
- 建议：接受差异；若要兼容 RP-Hub 预设文件，需要一个导入器把 `{name,content,role}` 映射成 completion preset 的两个区块。

**F02 注入顺序 — PARTIAL**
- RP-Hub 顺序：破限(system) → system_top 世界书 → global_note 世界书 → `[System Presets]` → 角色前导(before_char + `[Character]` + mes_example + after_char) → `[User Info]` → 记忆引用说明 → 工具提示 → UI 模板变量上下文 → 主模型 UI 更新提示 → COT。
- RPNow：顺序由 preset 的 `prompt_order` 决定，内置默认是 `main → worldInfoBefore → charDescription → charPersonality → scenario → personaDescription → worldInfoAfter → dialogueExamples → chatHistory → jailbreak`（`defaults/presets.ts:26-37`）；`extraSystem`（User Info / 工具 reminder / UI 模板 / 自动生图）**统一追加在整个骨架之后**（`orchestrator.ts:219-265`，`builder.ts:489-491`）。
- 影响：RP-Hub 的“破限最前 / User Info 在角色前导之后 / 工具提示在历史之前”在 RPNow 里无法用内置预设表达。
- 建议：把 `extraSystem` 拆成可定位的块（至少在 `chatHistory` 之前注入 User Info / 工具 reminder），或提供“破限”专用区块标识符。

**F03 文风（抗八股）预设 `<next_response>` 注入 — MISSING**
- RP-Hub：文风预设内容剥掉 `<writing_style>` 包裹后拼进 `<next_response>` 的写作风格位。
- RPNow：无 `<next_response>` / `<writing_style>` 协议。
- 建议：若需要，可在预设里加一个 `nextResponse` 标识符区块，由 builder 注入到历史之后。

**F04 核心预设（破限 / 破限预注入 User 1/2、AI 1/2） — MISSING**
- RPNow：`defaults/presets.ts:76-183` 只有 3 个通用角色扮演预设，没有破限/预注入系列，也没有“启动时强制置顶”逻辑。
- 建议：作为内置预设导入即可（放 `core/defaults/`），注意 RP-Hub 的“预注入”是 role:user/assistant 消息，需要 F01 的兼容层。

**F05 托管预设库（防抢话/防神化/防重复/人格内核/去User中心化/活人感/剧情面板/时间戳/人称/禁止规则） — MISSING**
- RPNow：无这些命名预设，也无 `syncBuiltinPreset` 的顺序维护。
- 建议：把 RP-Hub 的文本内容移植为 RPNow 预设区块（内容是 CC BY-NC 行为描述，文本需自行重写），按主题分组。

**F06 COT 预设动态生成 — MISSING**（见 C02）

**F08 人称预设 — MISSING**
- RP-Hub：`user.person = second|third` 决定启用第二/第三人称预设。
- RPNow：`RPPersona` 无 `person` 字段（`types/chat.ts:14-22`），`settings` 也无。
- 建议：persona 加 `person`，或提供两个可启用区块。

**F09 `{{user}}` / `{{char}}` 宏 — PARTIAL**
- RP-Hub：`{{user}}` 大小写不敏感、允许空格（`{{\s*user\s*}}`）；`{{char}}` 未实现。
- RPNow：`macros.ts:129-132` 用 `replaceAll('{{user}}', …)` 精确匹配，**`{{ User }}` / `{{user }}` 不替换**；`{{char}}` 已实现（RPNow 超出）。
- 建议：改成正则 `\{\{\s*key\s*\}\}`（注意 longest-first 与 `charIfNotGroup` 的优先级，现有实现已按长度排序，可平滑切换）。

### G. 记忆系统

**G02 逐轮总结 — PARTIAL**
- RP-Hub：总结模型 `temperature 0.2`、非流式、目标 200–250 字。
- RPNow：`service.ts:130-135` `temperature: 0.3`、`maxTokens:1200`；`llm.complete` 内部强制流式再收集（`builtins.ts:104-110`），语义上等同非流式。字数目标 200–250 已实现（`prompts.ts:16`）。
- 建议：温度对齐 0.2，或做成设置项。

**G04 二次压缩 — PARTIAL（实现了但从不触发）**
- RP-Hub：最近 25 轮保留逐轮总结，更早的每 5 轮合并成一条（350–500 字），空轮跳过、缺总结补录，合并记录保留 `sourceMemories`。
- RPNow：`service.ts:173-239` `compressSecondary()` 完整实现，`engine.ts:209-255` 应用逻辑完整，设置项齐全（`MemorySettingsPanel.tsx:149-201`）；**但 `compressSecondary` 没有任何调用者**（grep 仅定义处），所以二次压缩永远不会发生。
- 建议：在 `ChatView.generate` 的后台记忆任务里，于 `summariseNewestRound` 之后按设置调用 `compressSecondary`；并加“立即压缩”按钮。

**G06 补录 — PARTIAL**
- RP-Hub：手动三阶段（逐轮总结/向量记忆/二次压缩）弹窗，显示进度与预计时间，可停止/继续；自动 patrol。
- RPNow：`orchestrator.ts:176-189` 会在增强召回前**自动补写缺失向量**（这部分可用）；但 `MemorySettingsPanel.tsx:257-274` 的“补录缺失记忆”按钮**只 `toast.info('补录已排队')`，不执行任何操作**，也没有进度 UI、没有补写缺失总结的能力。
- 建议：实现 `MemoryService.backfill()`（总结 + 向量 + 二次压缩三阶段，带 `BackfillProgress`），把按钮接上；补一个进度弹窗。

**G07 `[M#]` 角标与“判断依据”弹窗 — PARTIAL**
- RP-Hub：正文里 `[M12]` 渲染成可点角标并给句加虚线下划线，点击弹“判断依据”显示对应总结；复制/发回模型/总结/检索前去掉 `[M#]`。
- RPNow：`types.ts:134-149` 有 `MEMORY_CITATION_RE/parseCitations/stripCitations`，**全部无调用者**；`MessageBubble` 直接渲染 `[M12]` 文本，无角标、无点击、无下划线；复制会带上（见 B08）。
- 建议：在 `MessageBubble` 里把 `[M#]` 替换成按钮，点击打开记忆弹窗（数据取 `useApp.memories[chat.id]`，按 `no` 匹配）；复制走 `stripCitations`。

**G08 压缩率显示 — MISSING**（见 A12）

**G09 清空当前模式记忆 / 重新生成单条总结 — MISSING**
- RP-Hub：记忆页可清空当前模式（两模式共享）；单条总结可“重新生成这条总结”（删旧 embedding 并重索引）。
- RPNow：只有 `store.clearMemories(chatId)`（`store.ts:296-301`）这个内部动作，无 UI；无单条重生成。
- 建议：记忆页加“清空”与每行“重生成”。

**G10 删除/编辑/分支同步记忆 — PARTIAL**
- RP-Hub：删除/编辑/重roll/分支都同步记忆与 `[M#]` 编号。
- RPNow：`ChatView.tsx:339-345` 删除/编辑消息不动 `store.memories`；分支切换（`branch/engine.ts:141-164`）只换 `messages`，`activation` 快照与记忆是**聊天级共享**的，分支间会互相污染。
- 建议：删除/编辑后重算受影响轮次；分支作用域化记忆（或在切换时保存/恢复记忆快照）。

### H. 分支

**H03 分支弹窗创建子分支 — PARTIAL**
- RP-Hub：消息操作栏“从这里分支”；分支弹窗选中节点后可创建子分支（复制整条聊天 + 记忆）。
- RPNow：消息操作栏分支可用（`ChatView.tsx:425-433` → `branch/engine.ts:105-139`）；`BranchPanel.tsx` 只能切换/改名/删除/导出，**不能在树上选节点开新分支**，也不复制记忆。
- 建议：BranchPanel 每行加“从此处分支”，复用 `createBranch`（需先按节点 floor 定位）。

**H05 分支地图 SVG — PARTIAL**
- RP-Hub：SVG 树，节点显示名称/楼层/字数（W 单位），可拖拽滚动、选中、进入、改名、删除。
- RPNow：`BranchPanel.tsx:92-123` 是**缩进列表**（`marginLeft = depth*14`），显示 `楼层 · W`，可切换/改名/删除；无 SVG、无拖拽滚动、无画布缩放。
- 建议：若需要“地图感”，用 SVG 画树形连线 + 平移；否则保持列表（信息等价）。

**H07 聊天记录导入 JSONL — MISSING**
- RP-Hub：可导入分支 manifest 或纯消息数组 JSONL，纯消息导入当前分支。
- RPNow：`branch/engine.ts:218-265` 只有 `exportBranches`，无 import；`features/import/cardImport.ts` 也不处理 `.jsonl`。
- 建议：实现 `importBranches(chat, jsonl)`，兼容 RP-Hub 的 `rp-hub-branch-chat` manifest 与纯消息数组。

### I. 图片

**I01 用户发图（回形针/3 张/20MB/压缩） — MISSING**
- RP-Hub：输入岛回形针 → `accept="image/*" multiple`，最多 3 张、每张 ≤20MB，`compressImage(dataUrl,1600,0.86)`（JPEG 白底）；用户消息 `imageAttachments:[{dataUrl}]`；发给模型转 OpenAI 多模态 `content:[{type:'text'},{type:'image_url',image_url:{url,detail:'high'}}]`；正文附加“图片 N：描述”。
- RPNow：`ChatView.tsx:686-746` 输入岛只有 textarea + 发送/停止，**没有文件选择**；`RPChatMessage` 无 `imageAttachments`；`types/chat.ts` 的 `images` 只存**生成图**（data URL），不参与 prompt。全仓库 `accept="image/*"` 只在 `CardEditor.tsx:291`（头像）。
- 建议：加 `pendingImages` 状态 + 隐藏 file input；压缩后存 `message.images`，并在 `assemblePrompt` 里把最新用户消息的 content 转成 multimodal parts（需 LLMMessage 支持 `content` 为数组，或新增 `imageUrls` 字段由各 adapter 转换）。

**I02 图片宫格 — PARTIAL**
- RP-Hub：1–3 宫格，3 张时第一张跨两列。
- RPNow：`MessageBubble.tsx:193-217` 固定 `grid-cols-2`，无 3 张跨列规则；且只显示生成图。
- 建议：按 `images.length` 切布局。

**I03 多模态发送 — MISSING**（同 I01）

**I07 风格 / 画师串 — MISSING**
- RP-Hub：`imageStyle` 六选一（韩漫小清新/动漫同人/2.5D唯美(r18)/2.5D唯美(萝)/本子里番/GalGame）+ `customImageArtists` 自定义画师串，注入生图 `artist` 参数。
- RPNow：`ImageGenSettingsPanel.tsx:14-17,58-90` 只有模型（V4.5/V5）与尺寸；`nai.ts:145-168` `submitJob` **不发送 artist/style**；`ImageStudio.tsx` 也没有风格选择。
- 建议：加风格预设（含 RP-Hub 的画师串文本），在 `submitJob` 与 `novelaiAdapter` 加 `artist`/`style` 字段。

**I08 单图重roll — PARTIAL**
- RP-Hub：点卡片重roll → 随机交换两个相邻 Tag、`nocache=1` 重新请求，成功后**改写消息正文里的 `image###…###`**；Tag < 2 提示“提示词太短”；会话忙时禁止。
- RPNow：`ChatView.tsx:462-501` 交换相邻 Tag 重新生成并替换 `message.images[i]` 与 `meta.imageTags[i]`；**不发送 nocache**（`nai.ts:147-157` 无该参数），**不改写正文**（因为正文已被 `stripImageMarkers` 清成“（插图）”，`ChatView.tsx:422`）。
- 建议：加 `nocache=1`；正文保留原始 marker 或记录 tag 与段落的映射，以便重写。

**I09 配额查询显示 — PARTIAL**
- RP-Hub：`POST /api/api/getUser {toUserId:key}`，`status==='ok' && type==='sta1n'` 时显示 `data.value` 次。
- RPNow：`nai.ts:192-210` `fetchQuota` 已实现但**无任何调用者**；UI 不显示配额。
- 建议：在 `ImageGenSettingsPanel` 加“查询剩余次数”，保存密钥后自动查一次。

**I10 V5 风格限制自动切换 — MISSING**
- RP-Hub：V5（`nai-diffusion-5-full`）不支持 `r18/lolita25d/anime`，选择 V5 时自动切回 `vertical`。
- RPNow：`ImageGenSettingsPanel.tsx:120` 只有一句静态提示文案，无自动切换逻辑。
- 建议：模型切换时若 `model==='nai-diffusion-5-full'` 则强制 `size='vertical'` 并提示。

### J. UI 模板

**J01 模板字段 — PARTIAL**
- RP-Hub：含 `scope/placement/order/htmlTemplate/initialVariableState/variableState/variableSchema/changeLog[]/runtimeByCharacter{}/updateMode`。
- RPNow：`uitemplate/types.ts:22-38` 有除 `updateMode`/`runtimeByCharacter` 外的全部字段；`TemplateSettingsPanel.tsx` 不暴露 `variableSchema` 与 `order`。
- 建议：模板编辑器加 `variableSchema`（JSON）与 `order` 输入。

**J06 副模型分析 — MISSING（死设置）**
- RP-Hub：`uiTemplateMainModelAnalysis=false` 时，每轮后用 `uiTemplateModel`、`temperature 0.4`、非流式分析最近 `uiTemplateAnalysisDepth`(4–10) 层，逐模板输出变量块；可“立即分析”。
- RPNow：`TemplateSettingsPanel.tsx:76-113` 有 mode/model/analysisDepth/injectContext 设置，但 **grep `mainModelAnalysis`/`analysisDepth`/`uiTemplate.model` 在 features/chat 下零命中**；`ChatView.tsx:353-383` 只处理主模型 `<ui_template_updates>`。
- 建议：实现副模型路径（在 `generate()` 末尾按深度取最近 N 层，逐模板调 `llm.complete` 解析变量块），或删掉设置。

**J07 `uiTemplateInjectContext` — MISSING（死设置）**（同 J06）

**J09 失败修正提示 — MISSING**
- RP-Hub：变量校验失败会生成“修正提示”附加到下一条用户消息。
- RPNow：`ChatView.tsx:360-364` 校验失败只 `console.warn` 并跳过该模板更新，无修正提示。
- 建议：把错误拼成 `<ui_template_correction>` 追加到下一条用户消息（或存 `chat.meta` 供下次注入）。

**J10 changeLog / 历史 + 分支运行时 — PARTIAL**
- RP-Hub：每模板最多 50 条 changeLog，历史 tab 只显示最近一条；`runtimeByCharacter[scopeId]` 按分支/角色存取；删除/编辑轮次按 turn 裁剪。
- RPNow：`ChatView.tsx:367-379` 写入 changeLog 并 `slice(0,50)`；`TemplateChange` 类型有 `turn` 但写入时未填（`ChatView.tsx:370-377`），也无历史 UI；模板状态是**全局单份**（`store.uiTemplates`），不随角色/分支切换。
- 建议：补 changeLog 查看 tab；若要分支隔离，把 `variableState/changeLog` 存进 `chat`。

### K. 上下文查看器

**K02 顶部组成条 — MISSING**
- RP-Hub：系统提示词/世界书/记忆/原文/工具各占多少字。
- RPNow：`PromptInspector.tsx:135-167` 有“总大小约 N tokens”和区块列表（含每块字数），但没有“系统/世界书/记忆/原文/工具”五类聚合条。
- 建议：按 `message.source` 聚合（`preset/card:*/worldInfo*/history/plugin`）展示条形。

**K03 世界书插入标签 — PARTIAL**
- RP-Hub：在消息里标出插入的世界书条目（名称 + 触发关键词/楼层/常驻）。
- RPNow：`PromptInspector.tsx:169-206` 有独立的“世界书”页签，列出已激活/未激活条目及 `reason`（含命中关键词），但**不在消息正文里标注**是哪一条插在哪。
- 建议：给 `injected` 加 `messageIndex`，在消息卡片上显示“← 世界书：银鹭酒馆”。

**K04 关键词 / `[M#]` 高亮 — MISSING**
- RP-Hub：世界书关键词黄色 `mark`，`[M#]`/`<memory_fragment>` 紫色 `mark`。
- RPNow：`PromptInspector.tsx:127-129` 消息内容是纯 `<pre>`，无高亮。
- 建议：复用 lorebook 的 `matchedKey` 与 `MEMORY_CITATION_RE` 做 `<mark>`。

### L. 用量与更新

**L01 请求 usage 记录 — PARTIAL**
- RP-Hub：每次 API 请求（chat/tool_continuation/summary/embedding/ui_template）记录完整字段（含 `cacheReadTokens/cacheWriteTokens/reasoningTokens/durationMs/outputCharacters/reported/actualQuota/usageGroup/usageLogKey`）。
- RPNow：`defaultLoop.ts:66-70,113` 只把 `inputTokens/outputTokens` 存进 `message.usage`（`types/chat.ts:39-40`）；记忆/ embeddings 调用不留账；无历史数组。
- 建议：加 `usageHistory` 集合（idb），在 `sendTurn`、`MemoryService`、`embedFrom` 处埋点。

**L02 缓存 token 统计 — MISSING**
- RPNow：`adapters.ts:134-140` 只取 `prompt_tokens/completion_tokens`；无 `prompt_tokens_details.cached_tokens` 等。
- 建议：解析 `usage.prompt_tokens_details`、Gemini `thoughtsTokenCount` 等并展示。

**L03 新 API 额度查询 — MISSING**
- RP-Hub：`GET {apiRoot去/v1}/api/log/token`，延迟 500ms/5000ms 各试一次，匹配 `type===2`、同模型、±120s、token 一致，写 `actualQuota/usageGroup/usageLogKey`。
- RPNow：无。
- 建议：仅对 STA1N 类渠道有价值，可作为 provider 可选能力。

**L04 最新用量条 — MISSING**
- RP-Hub：输入岛显示最新一条 chat/tool_continuation 的 输入（去缓存）/缓存/输出，单位 `w`（万）。
- RPNow：`ChatView.tsx:729-745` 输入岛只有“提示词/出图”两个按钮和预设名；无用量条。`showLatestUsageBar` 不存在。
- 建议：读 `message.usage` 显示“输入 X · 缓存 Y · 输出 Z”。

**L05 用量页 — MISSING**
- RP-Hub：分类（全部/主对话/记忆系统/变量分析）、时间（全部/24h/7d/30d）、总用量、请求数、日志行（模型/类型/时间/时长/速度/输入/缓存/输出/消耗 ¥）、分页 10、可清空。
- RPNow：无页面、无路由（`AppShell.tsx:45-53` 无 usage）。
- 建议：新增 `/usage` 路由 + 页面，数据源为 L01 的 `usageHistory`。

**L06 更新检查轮询 — PARTIAL**
- RP-Hub：页面可见时每 20s `GET {api}/v1/version?current=<5位id>`，`latest>current && >已通知` 派发事件。
- RPNow：`BackupSettingsPanel.tsx:177-200` 只有“立即检查更新”手动按钮，`fetch(`${url}/v1/version`)` 后**无条件 `toast.success('已是最新')`**，不比较版本；无轮询。
- 建议：加 20s `setInterval`（仅当 `checkURL` 非空且页面可见），比较 `id`。

**L07 更新公告弹窗 / 已读 id — MISSING**
- RP-Hub：公告弹窗读 `localStorage['roleplay_hub_update_id']`，未读则显示并 10s 倒计时；远程事件提示手动刷新。
- RPNow：`types/chat.ts:150-154` 有 `update.seenAnnouncementId` 字段但**无消费者**；无公告弹窗。
- 建议：实现公告模态框（标题/内容/10s 倒计时），写 `seenAnnouncementId`。

### M. 外观 / 全屏

**M01 全屏聊天 — MISSING**
- RP-Hub：`document.documentElement` 原生 fullscreen，`isChatFullscreen` 控制 `.app-native-fullscreen`，监听 `fullscreenchange`。
- RPNow：无 fullscreen 调用（grep 无）。
- 建议：头部加全屏按钮，`document.documentElement.requestFullscreen()`。

**M02 沉浸模式 — MISSING**
- RP-Hub：`settings.immersiveMode` 默认 false，隐藏头像与名字标签、消息居中窄列（桌面 50vw）。
- RPNow：无该设置；`types/chat.ts` 无 `immersiveMode`。`render.messageWidth` 只有全局 narrow/full。
- 建议：加 `immersive` 开关，隐藏 `.msg-name-tag`/头像，容器 `max-w-[50vw]`。

**M03 角色封面背景 — MISSING**
- RP-Hub：`settings.useCharacterBackground && currentCharacter.avatar` 时显示头像背景（`blur-[2px]`、`opacity:.9`），否则 `chat-ambient`；移动端 `--chat-bg-height`。
- RPNow：`types/chat.ts:85` 有 `chat.background` 字段但**无消费者**；聊天容器无背景层。
- 建议：实现 `chat.background`/卡片头像背景层，或删掉字段。

**M05 跨标签主题同步 — MISSING**
- RP-Hub：`storage` 事件跨标签同步，并向本地 iframe 广播。
- RPNow：`boot.ts:28-45` `applyTheme` 只作用于当前文档，无 `storage` 监听。
- 建议：`window.addEventListener('storage', …)` 重新 `applyTheme`。

**M06 正文字号 — PARTIAL（死开关）**
- RP-Hub：`settings.fontSize` 桌面 16 / 移动 14，12–20 整数。
- RPNow：`types/chat.ts:160,250` 有 `render.fontSize`（13–20），`SettingsPage.tsx:152-169` 有滑块，但 **grep `fontSize` 在 components 下零命中** —— 设置不影响任何渲染。
- 建议：在 `.rp-md` 容器加 `style={{ fontSize: settings.render.fontSize }}`，或删设置。

**M07 文风过滤开关 — MISSING**（见 B11）

### N. 设置字段

**N01 reasoningEffort — MISSING**
- RP-Hub：`none/low/medium/high/max/''`，旧 `xhigh` → `max`。
- RPNow：无该字段；`LLMRequest.extra` 注释提到可传 reasoning effort（`llm/types.ts:57`），但无 UI、无注入。
- 建议：`settings.chat.reasoningEffort` + 在 `sendTurn` 里映射成 `extra.reasoningEffort`（OpenRouter/DeepSeek 语义不同，需按 provider 分支）。

**N02 温度快捷滑块 — PARTIAL**
- RP-Hub：快捷面板温度滑块 0–1 步长 0.01。
- RPNow：`PresetsPage.tsx:379` 有温度滑块（0–2，步长 0.05），但**不在聊天快捷面板**，且改的是预设（影响所有聊天）；无 per-chat 温度。
- 建议：输入岛加快捷面板（温度/推理强度/流式/沉浸），写入 `chat.params.temperature`（`sendTurn` 已读 `ctx.chat.params?.temperature`，`orchestrator.ts:392`）。

**N03 模型槽位 1/2/3 — MISSING**
- RP-Hub：`qualityModel/balancedModel/fastModel` 三槽位，快捷面板可切。
- RPNow：`LLMConnection.defaultModel` 只有一个（`llm/types.ts:89`），无槽位概念。
- 建议：要么加三槽位，要么在快捷面板做“最近使用模型”列表（更轻）。

**N06 用户名称/描述/偏好/头像/人称 — PARTIAL**
- RP-Hub：`user.name`（默认占位串，保存校验非空）、`description`、`preferences`、`avatar`（200px/0.6）、`person`（second/third）。
- RPNow：`RPPersona`（`types/chat.ts:14-22`）有 `name/description/avatar`，**无 `preferences`、无 `person`**；`avatar` 无编辑 UI；`PersonaSettings.tsx:958-993` 只有名称+描述。
- 建议：persona 加 `preferences` 与 `person`；`buildUserInfoPrompt`（`prompts.ts:63-65`）已经收 `preferences`，但 `orchestrator.ts:220-228` 传的是空字符串。

**N07 首次启动强制设置 — MISSING**
- RP-Hub：默认用户名为占位串时强制弹“欢迎使用 RP Hub”，保存校验非空。
- RPNow：`ChatPage.tsx:34-48` 只是空态引导去角色卡页，不强制填名字；`SAMPLE_PERSONA` 直接给“旅人”。
- 建议：若认为“强制设定身份”重要，加首次启动向导；否则可接受。

**N08 API 延迟 / 生图配额检测 — PARTIAL**
- RP-Hub：服务连接状态显示 API 接口延迟、生图服务延迟+配额次数，可“立即检测”。
- RPNow：`SettingsPage.tsx:491-517` `testConnection` 只 toast 成功/失败与模型回复前 40 字，**不显示延迟毫秒**；生图服务无测试按钮。
- 建议：`testConnection` 记录 `performance.now()` 差值并展示；图像服务加同样的测试。

### O. 数据 / 导入导出 / 云备份

**O02 云恢复写保护 — MISSING**
- RP-Hub：云恢复期间 `writesPaused`，非 `force` 写直接丢弃。
- RPNow：`storage/index.ts` 无写保护；`importAll`（`storage/index.ts:102-113`）直接覆盖。
- 建议：若实现云恢复，加全局 `writesPaused` 到 `idbStorage.set`/`settingsStore.set`。

**O06 聊天记录导入 JSONL — MISSING**（见 H07）

**O07 预设/世界书/正则/UI 模板选择性导出 — PARTIAL**
- RP-Hub：预设导出数组、正则导出 `toRegexExportEntry` 数组、世界书导出 `{entries:[…]}`、UI 模板导出 `{type,templates:[…]}`，均通过“选择导出项目”多选弹层。
- RPNow：`PresetsPage.tsx:266-274` 整预设导出；`LorePage.tsx:154-179` 整本世界书导出；正则只能随整卡导出（`CardLibrary.tsx:277-285`）；UI 模板无导出。
- 建议：加统一“选择性导出”弹层；正则/UI 模板导出补齐。

**O09 云备份恢复 — PARTIAL（关键）**
- RP-Hub：输入密钥 → `GET /v1/backup/{key}` → 比对本地卡（规范化 JSON 比较）决定新增/替换/跳过 → 下载块写入（替换聊天时删对应 `classic_memories`）→ 替换卡删本机多余分支 → 1.5s 刷新。
- RPNow：`backup/client.ts:161-173` `downloadBackup` 只拉取 manifest；`BackupSettingsPanel.tsx:88-109` `runRestore` **只 `setInfo('已读取备份：N 张角色卡…')`，不下载任何 blob、不写任何数据**。恢复按钮实质是“只读探测”。
- 建议：实现 `restoreBackup()`：按 manifest 下载 `getBlob`（`client.ts:152-159` 已存在），按 `characters/scopes` 写回 `store`，并在替换聊天时 `clearMemories`；完成后 `reloadAll()` + 刷新。

**O10 云备份进度 — PARTIAL**
- RP-Hub：阶段标签 + 百分比 + 详情。
- RPNow：`BackupSettingsPanel.tsx:150-157` 只有字节百分比，无阶段（check/upload/publish）与详情。
- 建议：`onProgress` 增加阶段回调。

### P. 角色卡工坊

**P02 生成进度 60/20/100 — MISSING**
- RP-Hub：按章节计数（基础 7 节 60%，Regex +20%，最后 100%），状态字符串“准备中/等待API响应/正在思考/正在生成/生成完成/生成失败”。
- RPNow：`CardAIGenerateDialog.tsx:138-145` 只有“正在生成…”+ 原始流文本，无进度条、无章节解析进度。
- 建议：流式时用 `parseCardSections` 增量解析已完成的 `##` 章节，计算 60/20/100。

**P03 Gemini 截断兼容重试 — MISSING**
- RP-Hub：生成后检查 `<image>…</image>` 与 `### Regex Scripts` 是否缺失，且模型 `/gemini/i`，则用 `replyInTool:true` 重试一次（`output_reply` + 工具提交指令）。
- RPNow：`CardAIGenerateDialog.tsx:61-99` 只有一次生成，无重试；`tools/engine.ts:234-251` 有 `OUTPUT_REPLY_SCHEMA`/`REPLY_TOOL_INSTRUCTION` 但无调用者。
- 建议：生成结束后检查 marker，必要时用现成的 `OUTPUT_REPLY_SCHEMA` 再请求一次。

**P04 头像 AI 生成与重roll — MISSING**
- RP-Hub：解析 `Avatar Prompt` → `avatar_prompt`；若 `imageGenKey` 已配置，立即拼 `…/generate?tag=…&token=…&model=…&artist=…` 得到远程 URL 赋给 `avatar`；未配置则 toast“生图密钥未配置，已跳过图片生成”。`rerollAvatar()` 需 ≥2 个逗号分隔 tag，交换一对相邻 tag 后重建 URL 并写回 `avatar_prompt`。
- RPNow：`cardai/map.ts:99` 把 `avatar_prompt` 存进 `extensions`，**全仓库无任何消费者**（grep `avatar_prompt` 只命中 generate/map/test）；`CardEditor.tsx` 头像只能上传，无“生成/重roll”按钮。
- 建议：生成卡片后若 `avatar_prompt` 非空且 `imageGen.key` 已配置，调用 `submitJob`/`fetchAsDataUrl` 生成头像；编辑器加“重绘头像”（复用 `rerollTags`）。

**P07 智能修改 diff — PARTIAL**
- RP-Hub：编号 `1..7`/`W1…`/`R1…`/`W+`/`R+`；`finishReason==='length'` 拒绝；无调用/多个调用/坏 JSON/重复 id/未知 id 都有专门文案；只显示实际变化；逐字 diff（LCS + 60 字上下文折叠 + `+added/−removed`）；`first_mes` 变化带“预览”；应用前重新快照，过期拒绝；世界书改名同步 `name`。
- RPNow：`cardai/diff.ts` 实现了编号解析、重复 id 检测、`W+/R+` 新增、`diffCard` 计算 `Change[]`；`CardEditDiffButton.tsx:153-168` 只显示**截断 120 字的原文/新文**，无逐字 diff、无 `+/−` 计数、无 `first_mes` 预览、**无过期拒绝**（`apply()` 直接用旧 draft，`CardEditDiffButton.tsx:97-102`）。截断检测（`finishReason==='length'`）也没有。
- 建议：加 LCS diff 渲染（可复用 RP-Hub 的 `DIFF_CONTEXT_CHARS=60` 思路）、`first_mes` 预览、`apply` 前重新 `describeCardForEdit` 比对快照。

**P08 diff 逐字对比 / 预览 — MISSING**（见 P07）

**P09 diff 过期拒绝 — MISSING**（见 P07）

**P09b 世界书/正则独立导入 — PARTIAL**
- RP-Hub：世界书-only 与 正则-only JSON 可独立导入（裸数组或卡负载），自动跳到对应 tab。
- RPNow：`features/import/cardImport.ts` 能识别世界书（`entries`/`originalData`）与预设，**不识别“只有 regex_scripts 的 JSON”**；正则只能随卡导入。
- 建议：`tryParseStructured` 加 regex-only 分支。

**P10 选择性导出（世界书/正则多选） — MISSING**
- RPNow：卡片导出为整卡 JSON/PNG/CharX（`CardLibrary.tsx:277-285`），无按条目多选导出。
- 建议：加 `ExportSelectionModal`。

### Q. 小说编辑器

**Q02 清空所有内容 — MISSING**
- RP-Hub：侧栏底部“清空所有内容”，确认文案明确“将清空本地所有数据且不可撤销”。
- RPNow：`NovelPage.tsx` 只能删单本（`:517-519`）或删章节（`:760-765`），无清空全部。
- 建议：书名单页加“清空全部书籍”。

**Q04 成人模式生效 — MISSING**
- RP-Hub：成人模式开启时 prepend 长段 NSFW 指令并禁用内容审查。
- RPNow：`NovelPage.tsx:547-550` 有 R18 开关，`novel/types.ts:87` 存 `isAdultMode`，但 `buildNovelContext`（`novel/types.ts:109-133`）**完全不读它**。
- 建议：`isAdultMode` 时向 system 注入 NSFW 指令块。

**Q08 手风琴 + 滚动定位 — PARTIAL**
- RP-Hub：一次只展开一个；`scrollToChapter` 只展开目标并 400ms 后平滑滚动；目录点击跳转。
- RPNow：`NovelPage.tsx:679-687` 一次只展开一个（正确）；但“目录”tab 与“章节列表”是同一个 tab，**没有独立目录点击滚动定位**（`scrollToChapter` 不存在）。
- 建议：加 `scrollIntoView` 到展开的章节标题。

**Q09 搜索替换跳转 — PARTIAL**
- RP-Hub：结果列表点击 `jumpToMatch` 展开章节并滚到 `#match-N`，正文高亮当前命中。
- RPNow：`NovelPage.tsx:221-247` 搜索正则、±10 字上下文、上一处/下一处；`NovelPage.tsx:914-930` 结果列表只切换 `currentMatch` 高亮，**不展开章节、不滚动、正文无高亮**。
- 建议：结果点击时展开对应章节并 `scrollIntoView` + 正文 `<mark>`。

**Q10 章节书评（回复 / 点赞 / 作者赞过） — PARTIAL**
- RP-Hub：评论含 `replies[]`（楼中楼，`回复 @targetUser`）、like 按钮（评论与回复）、**作者赞过** 标记、随机 level、34 省 IP 属地；生成后自动调用。
- RPNow：`novel/types.ts:21-42` 数据模型**有** `replies/likes/liked/authorLiked`；`NovelPage.tsx:851-863` 只渲染用户名/等级/热评/楼层/时间/IP/正文，**不渲染回复、没有点赞按钮、没有作者赞过**；且生成评论需手动点（`NovelPage.tsx:834-846`），RP-Hub 在每章生成后自动 `generateChapterComments`。
- 建议：补回复嵌套渲染与点赞交互；章节生成后自动触发一次评论生成。

**Q13 章节 Markdown 渲染 — MISSING**
- RP-Hub：`renderChapterContent` 用 marked 渲染。
- RPNow：`NovelPage.tsx:726` 用 `whitespace-pre-wrap` 纯文本，Markdown 标记会原样显示。
- 建议：复用 `defaultRenderer.render`（注意 DOMPurify 已内置）。

**Q14 书评团 / 评论区模型与 provider 设置 — PARTIAL**
- RP-Hub：设置弹窗可选 provider（显示已配置/未配置）+ 模型列表（搜索/刷新），目标含 **正文生成 / 书评团 / 评论区** 三个；per-book `localSettings`。
- RPNow：`NovelPage.tsx:551-560` 只有“正文模型”“评论区模型”两个自由文本输入，**没有书评团模型**（`runReview` 用 `book.reviewModel || connection.defaultModel`，`NovelPage.tsx:281`，而 `reviewModel` 无 UI）；provider 固定取全局默认连接（`:95`），不能按书切换；无模型列表拉取。
- 建议：设置 tab 补书评团模型；书籍加 `connectionId`；用 `llm.listModels` 做选择器。

### R. UI 组件

**R01 Toast 堆叠与图标关键词映射 — PARTIAL**
- RP-Hub：顶部居中堆叠，默认 2000ms，图标按消息关键词（正在/复制/删除/导出/导入/收藏/图片/重试/改名/分支/模型/停止/切换/保存）自动选择。
- RPNow：`toast.tsx:33-52` 堆叠 + 4200/8000ms，图标只有 success/error/info 三类（`toast.tsx:70`），无关键词映射。
- 建议：接受差异（信息等价），或加 `toast.success(title, desc, icon)`。

**R03 MemoryBackfill 弹窗 — MISSING**（见 G06）

**R04 模型选择器弹窗 — MISSING**
- RP-Hub：`ModelSelectorModal` 搜索 + 分类标签（全部/claude/gemini/deepseek/llama/glm/moonshot/grok/其他 + 计数）、3 槽位草稿、embedding 目标只读搜索。
- RPNow：`SettingsPage.tsx:637-654` 用 `<datalist>` 提供模型名建议；聊天里没有模型选择器，只能靠 `chat.model` 手动改（实际无 UI）。
- 建议：加模型选择弹窗，或在聊天头部加连接/模型下拉。

**R05 SecretInput 显示/隐藏 — PARTIAL**
- RP-Hub：password + 复制 + 显示/隐藏，失焦自动隐藏。
- RPNow：`SettingsPage.tsx:624-631`、`ImageGenSettingsPanel.tsx:45-52`、`ToolSettingsPanel.tsx:97-104` 都是纯 `type="password"`，无切换、无复制。
- 建议：封一个 `SecretInput` 组件。

**R06 SettingsHelp / 选择性导出弹窗 — MISSING**
- RP-Hub：`SettingsHelp` 问号 popover（teleport、跟随滚动、外部点击关闭）；`ExportSelectionModal` 全选/取消全选/多选/导出选中。
- RPNow：有 `Hint`（`components/ui/misc.tsx`）但语义不同；无选择性导出。
- 建议：合并实现。

**R07 自动生图询问弹窗 — MISSING**
- RP-Hub：新导入角色后询问是否开启自动生图（暂不开启/立即开启）。
- RPNow：`CardLibrary.tsx:80-100` 导入后只弹 `ImportDialog` 结果，不询问自动生图。
- 建议：导入成功后加一个轻量确认。

**R08 更新公告弹窗 — MISSING**（见 L07）

**R09 记忆引用弹窗 — MISSING**（见 G07）

**R10 拖拽排序 — PARTIAL**
- RP-Hub：SortableJS 拖 `.sortable-list-handle`，拖完还原 DOM 再按稳定 key 更新数组；同一时刻只有一个实例；尊重 `prefers-reduced-motion`。
- RPNow：`PresetsPage.tsx:336-342` 用上下箭头；`LorebookEditor.tsx:290-298` 用数字输入 `order`；都无拖拽。
- 建议：可用原生 HTML5 drag 或 dnd-kit；至少世界书条目加拖拽。

**R11 叠卡轮播 — MISSING**（见 A06）

**R13 移动端键盘高度 — MISSING**
- RP-Hub：`visualViewport` resize/scroll → `--keyboard-inset`、`isMobileKeyboardOpen`，输入框聚焦 180ms 延迟同步。
- RPNow：只有 `rp-safe-b`（`index.css`）处理 home-indicator，无 `visualViewport` 逻辑；`ChatView.tsx:686` 输入岛固定底部。
- 建议：监听 `visualViewport` 设置 `--keyboard-inset`，输入岛 `bottom: var(--keyboard-inset)`。

---

## 3. 十大最值得补的差距（按用户影响排序）

| # | 差距 | 影响 | 工作量 |
|---|---|---|---|
| 1 | **世界书 7 位置语义 + `at_depth` 计数/角色**（E02/E03/E07/E08/E09） | 直接决定“世界书插在哪”，是 RP 用户最敏感的行为；当前 RP-Hub 卡导入后位置会错位，`user_top/assistant_top` 完全丢失 | **M** |
| 2 | **用量统计与最新用量条**（L01–L05） | 用户完全无法看到 token 消耗与费用，长对话成本不可控；RP-Hub 有完整页面 | **M** |
| 3 | **云备份恢复**（O09） | 现在“恢复”按钮只读 manifest、不写数据，是**看似可用实则无效**的功能，用户可能以为已恢复 | **M** |
| 4 | **用户发图 + 多模态**（I01/I03） | 聊天里不能发图，多模态角色卡（看图回答）完全不可用 | **M** |
| 5 | **死开关清理：stream / 字号 / sandboxHtml / 副模型模板 / reasoning 模板**（C05/M06/B03/J06/C03-reasoning） | 5 个设置项对用户撒谎；尤其“流式关闭”和“副模型分析”会被误认为可用 | **S**（删）/ **M**（实现） |
| 6 | **头像 AI 生成与重roll**（P04） | 角色卡工坊的核心卖点之一；现在 `avatar_prompt` 解析出来就丢 | **M** |
| 7 | **智能修改 diff 展示**（P07/P08/P09） | 用户无法逐字确认 AI 改了什么，且可能应用到过期快照 | **M** |
| 8 | **补录 + 二次压缩触发**（G06/G04） | 二次压缩实现了但从不运行；补录按钮只弹 toast —— 长对话记忆成本压缩形同虚设 | **S**（接线）/ **M**（完整 UI） |
| 9 | **CoT `<thinking>/<cot>` 解析**（C02） | 用 DeepSeek/GLM/Kimi 时思考内容会混进正文，编辑/复制/再发送都带脏数据 | **M** |
| 10 | **沉浸式阅读三件套：全屏 / 沉浸模式 / 角色封面背景**（M01/M02/M03） | RP 用户长时间阅读的核心体验；现在只有“窄/宽”两档 | **S** |

---

## 4. 附录：完整能力清单（183 项）

状态列取值：IMPLEMENTED / PARTIAL / MISSING。证据列为关键文件。

### A. 聊天视图与导航（13）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| A01 | 主导航与视图切换 | IMPLEMENTED | `components/layout/AppShell.tsx:45-53` |
| A02 | 聊天默认视图 | IMPLEMENTED | `pages/ChatPage.tsx:26-32` |
| A03 | 角色卡库（搜索/导入/导出/删除） | IMPLEMENTED | `components/cards/CardLibrary.tsx:67-100,277-295` |
| A04 | 角色卡收藏 | MISSING | 无字段/UI |
| A05 | 角色卡批量删 | MISSING | 仅单删 `CardLibrary.tsx:287-295` |
| A06 | 叠卡/网格布局切换 | MISSING | 仅网格 `CardLibrary.tsx:221` |
| A07 | 角色简介面板 | MISSING | 头部 `ChatView.tsx:514-527` |
| A08 | 用量统计视图 | MISSING | 无路由 |
| A09 | 正则管理视图 | PARTIAL | `CardEditor.tsx:657-763` |
| A10 | 万相广场外部卡片导入 | MISSING | 无 |
| A11 | 在线工具页（角色卡工坊+小说） | IMPLEMENTED | `CardAIGenerateDialog.tsx`、`pages/NovelPage.tsx` |
| A12 | 记忆浏览视图 | MISSING | `MemorySettingsPanel.tsx:255-256` |
| A13 | 世界书/预设/工具/设置视图 | IMPLEMENTED | `pages/LorePage.tsx`、`pages/PresetsPage.tsx`、`SettingsPage.tsx` |

### B. 消息渲染与操作（13）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| B01 | Markdown breaks:true | IMPLEMENTED | `core/render/renderer.ts:30-33` |
| B02 | 禁用缩进代码块 | MISSING | `renderer.ts:30-33` 无 tokenizer |
| B03 | HTML 卡片沙箱与白名单 | PARTIAL | `renderer.ts:147-156,187-221`；`sandboxHtml` 死设置 |
| B04 | 渲染缓存/流式 HTML 截断 | MISSING | `MessageBubble.tsx:80-87` |
| B05 | 操作栏显示条件 | PARTIAL | `MessageBubble.tsx:229` |
| B06 | 重新生成 | PARTIAL | `ChatView.tsx:325-331` |
| B07 | 编辑 | PARTIAL | `ChatView.tsx:343-345`、`MessageBubble.tsx:159-182` |
| B08 | 复制 | PARTIAL | `MessageBubble.tsx:275-284`；`stripCitations` 未调用 |
| B09 | 从这里分支 | IMPLEMENTED | `ChatView.tsx:425-433`、`branch/engine.ts:105-139` |
| B10 | 删除约束 | PARTIAL | `ChatView.tsx:339-341` |
| B11 | 文风过滤详情 | MISSING | 无 |
| B12 | 移动端操作栏常显/触摸反馈 | PARTIAL | `MessageBubble.tsx:229` |
| B13 | 用户头像/系统消息气泡 | PARTIAL | `MessageBubble.tsx:77,184-190` |

### C. 思考与流式（12）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| C01 | 原生 reasoning 提取 | PARTIAL | `core/llm/adapters.ts:30-45,419,442` |
| C02 | CoT 解析与模型标签 | MISSING | 无 `parseCot` |
| C03 | 思考/工具时间线 UI | MISSING | `toolTrace` 未渲染 |
| C04 | 自动折叠 reasoning | PARTIAL | `MessageBubble.tsx:71,131-149` |
| C05 | stream 开关 | PARTIAL | `defaultLoop.ts:41-50`；`streamResponses` 死设置 |
| C06 | delta flush/空闲超时 | MISSING | `ChatView.tsx:194-201`；`sse.ts` |
| C07 | 非流式/非 SSE 兜底 | PARTIAL | `adapters.ts:103-120` 未走 |
| C08 | 中止生成 | PARTIAL | `ChatView.tsx:270-306` |
| C09 | 等待动画/GenerationTimer | MISSING | `ChatView.tsx:741` |
| C10 | Gemini 抗截断 output_reply+3 次重试 | IMPLEMENTED | `orchestrator.ts:364-443` |
| C11 | 抗截断禁用 COT 预设 | MISSING | 无 COT 预设 |
| C12 | Gemini 输入混淆 | MISSING | 无 |

### D. 工具系统（9）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| D01 | 关键词检索 | IMPLEMENTED | `core/tools/engine.ts:47-91`、`provider.ts:90-105` |
| D02 | Tavily 搜索/提取 | IMPLEMENTED | `provider.ts:26-80,106-112` |
| D03 | 随机生成 | IMPLEMENTED | `engine.ts:102-173` |
| D04 | adaptive/force 策略 | IMPLEMENTED | `types.ts:29,86-88`、`orchestrator.ts:419-431` |
| D05 | parallel_tool_calls:false | IMPLEMENTED | `adapters.ts:87` |
| D06 | 单轮最多 5 项 | PARTIAL | `defaultLoop.ts:84-103` 未用 `executeTools` |
| D07 | 自动续写最多 4 轮 | IMPLEMENTED | `defaultLoop.ts:13,35` |
| D08 | 工具结果不持久化 | IMPLEMENTED | `defaultLoop.ts:98-103` |
| D09 | 工具调用 UI 时间线 | MISSING | 无 |

### E. 世界书（12）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| E01 | 条目字段完整性 | PARTIAL | `types/lorebook.ts:30-82`；`scanDepth` 无 UI |
| E02 | 七位置语义 | PARTIAL | `types/card.ts:97-118`；`cardai/map.ts:17-28` |
| E03 | 位置别名/数字归一化 | PARTIAL | `types/lorebook.ts:140-156` |
| E04 | constant/keys 触发 | IMPLEMENTED | `lorebook/engine.ts:280-340` |
| E05 | useRegex /pattern/flags | PARTIAL | `lorebook/engine.ts:123-145` |
| E06 | probability/order | IMPLEMENTED | `engine.ts:321-330,419-429` |
| E07 | at_depth 注入与计数 | PARTIAL | `prompt/builder.ts:463-464,526-529` |
| E08 | user_top/assistant_top | MISSING | 无对应枚举 |
| E09 | system_top/global_note | PARTIAL | `builder.ts:466-472`（ANTop/ANBottom） |
| E10 | before_char/after_char | IMPLEMENTED | `builder.ts:183-188,475-484` |
| E11 | scanDepth/maxDepth | PARTIAL | `types/chat.ts:196`（默认 4）；无 maxDepth |
| E12 | 递归/粘性/冷却/分组 + 导入导出 | IMPLEMENTED | `engine.ts:220-416`、`pages/LorePage.tsx` |

### F. 预设与注入（10）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| F01 | 预设 role 与 user/assistant 消息注入 | PARTIAL | `types/preset.ts:43-57`、`builder.ts:431-443` |
| F02 | 注入顺序 | PARTIAL | `defaults/presets.ts:26-37`、`orchestrator.ts:219-265` |
| F03 | 文风 `<next_response>` | MISSING | 无 |
| F04 | 核心预设（破限/预注入） | MISSING | `defaults/presets.ts:76-183` |
| F05 | 托管预设库 | MISSING | 无 |
| F06 | COT 预设 | MISSING | 无 |
| F07 | 预设管理 | IMPLEMENTED | `pages/PresetsPage.tsx:78-155,266-290` |
| F08 | 人称预设 | MISSING | 无 `person` 字段 |
| F09 | `{{user}}/{{char}}` 宏 | PARTIAL | `core/prompt/macros.ts:129-132` |
| F10 | 预设采样参数 | IMPLEMENTED | `PresetsPage.tsx:374-422` |

### G. 记忆系统（10）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| G01 | 开关与 classic/enhanced | IMPLEMENTED | `types/chat.ts:197-211`、`MemorySettingsPanel.tsx:18-63` |
| G02 | 逐轮总结 | PARTIAL | `features/memory/service.ts:130-135`（温度 0.3） |
| G03 | 保留最近楼层 | IMPLEMENTED | `MemorySettingsPanel.tsx:129-147` |
| G04 | 二次压缩 | PARTIAL | `service.ts:173-239` 无调用者 |
| G05 | 增强召回 | IMPLEMENTED | `engine.ts:325-346`、`orchestrator.ts:175-199` |
| G06 | 补录 | PARTIAL | `MemorySettingsPanel.tsx:257-274` 只 toast |
| G07 | `[M#]` 角标/判断依据 | PARTIAL | `types.ts:134-149` 无调用者 |
| G08 | 压缩率显示 | MISSING | 无 |
| G09 | 清空/重生成单条总结 | MISSING | 仅内部 `clearMemories` |
| G10 | 删除/编辑/分支同步记忆 | PARTIAL | `ChatView.tsx:339-345`、`branch/engine.ts:141-164` |

### H. 剧情分支（7）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| H01 | 分支模型/主线保护 | IMPLEMENTED | `branch/engine.ts:43-84,170-204` |
| H02 | 消息操作栏分支 | IMPLEMENTED | `ChatView.tsx:425-433` |
| H03 | 分支弹窗创建子分支 | PARTIAL | `BranchPanel.tsx:92-123` 仅列表操作 |
| H04 | 切换前保存/删除顺延 | IMPLEMENTED | `engine.ts:141-192` |
| H05 | 分支地图 SVG | PARTIAL | `BranchPanel.tsx` 缩进列表 |
| H06 | 导出 JSONL | IMPLEMENTED | `engine.ts:218-265` |
| H07 | 导入 JSONL | MISSING | 无 |

### I. 图片（10）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| I01 | 用户发图（3张/20MB/压缩） | MISSING | `ChatView.tsx:686-746` 无 file input |
| I02 | 图片宫格 | PARTIAL | `MessageBubble.tsx:193-217` |
| I03 | 多模态发送 | MISSING | 无 |
| I04 | 自动生图开关 | IMPLEMENTED | `orchestrator.ts:252-264`、`ImageGenSettingsPanel.tsx:27-37` |
| I05 | `image###Tag###` 解析 | IMPLEMENTED | `core/image/nai.ts:26-47` |
| I06 | 张数/jobs 轮询/生成参数 | IMPLEMENTED | `nai.ts:74-79,118-168`、`ImageGenSettingsPanel.tsx:92-105` |
| I07 | 风格/画师串 | MISSING | `nai.ts:145-168` 无 artist |
| I08 | 单图重roll | PARTIAL | `ChatView.tsx:462-501`；无 nocache/正文改写 |
| I09 | 配额显示 | PARTIAL | `nai.ts:192-210` 无调用者 |
| I10 | V5 风格限制切换 | MISSING | 仅提示文案 `ImageGenSettingsPanel.tsx:120` |

### J. UI 模板（10）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| J01 | 模板字段 | PARTIAL | `core/uitemplate/types.ts:22-38`；无 updateMode/runtime |
| J02 | 变量语法/each | IMPLEMENTED | `engine.ts:160-280` |
| J03 | 沙箱 iframe/高度/data-slash | IMPLEMENTED | `components/chat/TemplateCard.tsx:30-95` |
| J04 | 插入位置/顺序/合并 | IMPLEMENTED | `ChatView.tsx:451-456,651-657` |
| J05 | 主模型更新协议 | IMPLEMENTED | `ChatView.tsx:353-383`、`engine.ts:289-320` |
| J06 | 副模型分析 | MISSING | 设置存在、无实现（`TemplateSettingsPanel.tsx:76-113`） |
| J07 | injectContext | MISSING | 死设置 |
| J08 | 校验 | IMPLEMENTED | `engine.ts:334-355` |
| J09 | 失败修正提示 | MISSING | `ChatView.tsx:360-364` 只 warn |
| J10 | changeLog/历史 + 分支运行时 | PARTIAL | `ChatView.tsx:367-379`；无 UI/运行时隔离 |

### K. 上下文查看器（4）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| K01 | 消息列表+角色+字数 | IMPLEMENTED | `PromptInspector.tsx:111-133` |
| K02 | 顶部组成条 | MISSING | `PromptInspector.tsx:135-167` |
| K03 | 世界书插入标签 | PARTIAL | `PromptInspector.tsx:169-206` |
| K04 | 关键词/`[M#]` 高亮 | MISSING | 无 |

### L. 用量与更新（7）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| L01 | 请求 usage 记录 | PARTIAL | `defaultLoop.ts:66-70,113`；`types/chat.ts:39-40` |
| L02 | 缓存 token 统计 | MISSING | `adapters.ts:134-140` |
| L03 | 新 API 额度查询 | MISSING | 无 |
| L04 | 最新用量条 | MISSING | `ChatView.tsx:729-745` |
| L05 | 用量页 | MISSING | 无路由 |
| L06 | 更新检查轮询 | PARTIAL | `BackupSettingsPanel.tsx:177-200` 手动 |
| L07 | 更新公告弹窗/已读 id | MISSING | `seenAnnouncementId` 无消费者 |

### M. 外观/全屏（7）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| M01 | 全屏聊天 | MISSING | 无 |
| M02 | 沉浸模式 | MISSING | 无 |
| M03 | 角色封面背景 | MISSING | `chat.background` 无消费者 |
| M04 | 主题明暗切换 | IMPLEMENTED | `boot.ts:28-45`、`defaults/themes.ts` |
| M05 | 跨标签主题同步 | MISSING | 无 storage 监听 |
| M06 | 正文字号 | PARTIAL | `render.fontSize` 无消费者 |
| M07 | 文风过滤开关 | MISSING | 无 |

### N. 设置字段（11）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| N01 | reasoningEffort | MISSING | 无 |
| N02 | 温度快捷滑块 | PARTIAL | `PresetsPage.tsx:379`（非聊天面板） |
| N03 | 模型槽位 1/2/3 | MISSING | `llm/types.ts:89` 单一 defaultModel |
| N04 | 提供商列表 | IMPLEMENTED | `core/llm/providers.ts`（~38 家） |
| N05 | 生图密钥/模型/尺寸/数量 | IMPLEMENTED | `ImageGenSettingsPanel.tsx` |
| N06 | 用户名称/描述/偏好/头像/人称 | PARTIAL | `types/chat.ts:14-22`、`PersonaSettings` |
| N07 | 首次启动强制设置 | MISSING | `ChatPage.tsx:34-48` |
| N08 | API 延迟/配额检测 | PARTIAL | `SettingsPage.tsx:491-517` |
| N09 | 代理 | IMPLEMENTED | `types/chat.ts:183-186`、`SettingsPage.tsx:327-362` |
| N10 | 消息宽度 | IMPLEMENTED | `types/chat.ts:161`、`ChatView.tsx:640` |
| N11 | Gemini 抗截断开关 | IMPLEMENTED | `types/chat.ts:180`、`orchestrator.ts:365` |

### O. 数据/导入导出/云备份（11）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| O01 | IndexedDB 存储 | IMPLEMENTED | `core/storage/index.ts:17-34` |
| O02 | 云恢复写保护 | MISSING | 无 |
| O03 | 角色卡 PNG V2/V3 导入 | IMPLEMENTED | `core/card/parser.ts:232-277,377` |
| O04 | 角色卡 PNG 导出 | IMPLEMENTED | `parser.ts:606-652` |
| O05 | 聊天导出 JSONL | IMPLEMENTED | `branch/engine.ts:218-265` |
| O06 | 聊天导入 JSONL | MISSING | 无 |
| O07 | 预设/世界书/正则/UI 模板选择性导出 | PARTIAL | `PresetsPage.tsx:266-274`、`LorePage.tsx:154-179` |
| O08 | 云备份上传 | IMPLEMENTED | `backup/client.ts:119-150`、`BackupSettingsPanel.tsx:34-86` |
| O09 | 云备份恢复 | PARTIAL | `BackupSettingsPanel.tsx:88-109` 只读 manifest |
| O10 | 云备份进度 | PARTIAL | `BackupSettingsPanel.tsx:150-157` |
| O11 | 本地全量备份/恢复 | IMPLEMENTED | `storage/index.ts:77-113` |

### P. 角色卡工坊（10）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| P01 | AI 生成（章节解析/容错） | IMPLEMENTED | `core/cardai/generate.ts`、`CardAIGenerateDialog.tsx` |
| P02 | 生成进度 60/20/100 | MISSING | `CardAIGenerateDialog.tsx:138-145` |
| P03 | Gemini 截断重试 | MISSING | 无 |
| P04 | 头像 AI 生成与重roll | MISSING | `cardai/map.ts:99` 只存 `avatar_prompt` |
| P05 | 头像缓存 | IMPLEMENTED | `CardEditor.tsx:293-300`（data URL） |
| P06 | 智能修改 diff + 校验 | PARTIAL | `cardai/diff.ts`、`CardEditDiffButton.tsx` |
| P07 | diff 逐字对比/预览 | MISSING | `CardEditDiffButton.tsx:153-168` |
| P08 | diff 过期拒绝 | MISSING | `CardEditDiffButton.tsx:97-102` |
| P09 | 世界书/正则独立导入 | PARTIAL | `features/import/cardImport.ts:267-311` |
| P10 | 选择性导出 | MISSING | 无 |

### Q. 小说编辑器（14）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| Q01 | 书架/设定/角色/目录/查找 五 tab | IMPLEMENTED | `NovelPage.tsx:46-52` |
| Q02 | 清空所有内容 | MISSING | 无 |
| Q03 | 设定字段 | IMPLEMENTED | `NovelPage.tsx:532-562` |
| Q04 | 成人模式生效 | MISSING | `novel/types.ts:109-133` 不读 isAdultMode |
| Q05 | 角色管理 | IMPLEMENTED | `NovelPage.tsx:565-631` |
| Q06 | 章节生成选项 | IMPLEMENTED | `NovelPage.tsx:54-64,121-178` |
| Q07 | 章节编辑/复制/删除/重写 | IMPLEMENTED | `NovelPage.tsx:729-828` |
| Q08 | 手风琴+滚动定位 | PARTIAL | `NovelPage.tsx:679-687`；无 scrollToChapter |
| Q09 | 搜索替换跳转 | PARTIAL | `NovelPage.tsx:221-247,914-930` |
| Q10 | 章节书评（回复/点赞/作者赞过） | PARTIAL | `NovelPage.tsx:851-863` |
| Q11 | 书评团三 persona | IMPLEMENTED | `NovelPage.tsx:66-70,265-307` |
| Q12 | TXT 导出/导入往返 | IMPLEMENTED | `novel/types.ts:167-251` |
| Q13 | 章节 Markdown 渲染 | MISSING | `NovelPage.tsx:726` |
| Q14 | 书评/评论模型与 provider 设置 | PARTIAL | `NovelPage.tsx:95,551-560` |

### R. UI 组件（13）
| ID | 能力 | 状态 | 证据 |
|---|---|---|---|
| R01 | Toast 堆叠与图标关键词映射 | PARTIAL | `components/ui/toast.tsx:14,48-52,70` |
| R02 | 确认/角色导出/新建弹窗 | IMPLEMENTED | `ImportDialog.tsx`、`CardLibrary.tsx` |
| R03 | MemoryBackfill 弹窗 | MISSING | 无 |
| R04 | 模型选择器弹窗 | MISSING | `SettingsPage.tsx:637-654` 仅 datalist |
| R05 | SecretInput 显示/隐藏 | PARTIAL | `SettingsPage.tsx:624-631` |
| R06 | SettingsHelp/选择性导出弹窗 | MISSING | 无 |
| R07 | 自动生图询问弹窗 | MISSING | 无 |
| R08 | 更新公告弹窗 | MISSING | 无 |
| R09 | 记忆引用弹窗 | MISSING | 无 |
| R10 | 拖拽排序 | PARTIAL | `PresetsPage.tsx:336-342`、`LorebookEditor.tsx:290-298` |
| R11 | 叠卡轮播 | MISSING | 无 |
| R12 | 响应式 | IMPLEMENTED | `AppShell.tsx:85-113,174-211` |
| R13 | 移动端键盘高度 | MISSING | 无 visualViewport |

---

## 5. 复现优先级建议（工程向）

1. **先修“假可用”**：云备份恢复（O09）、补录按钮（G06）、5 个死开关（C05/M06/B03/J06/J07）。这类问题会直接误导用户。
2. **再修语义错位**：世界书位置与 `at_depth` 计数（E01–E09）、正则 `/pattern/flags`（E05）、CoT 解析（C02）。这些是“导入 RP-Hub 内容后行为不对”的根源。
3. **补账本能力**：用量历史 + 页面（L01–L05）、更新轮询与公告（L06/L07）。
4. **补可见功能**：用户发图（I01/I03）、头像生成（P04）、智能修改 diff（P07–P09）、小说评论区交互（Q10）。
5. **最后做体验向**：全屏/沉浸/背景（M01–M03）、叠卡轮播（A06/R11）、分支地图（H05）。
