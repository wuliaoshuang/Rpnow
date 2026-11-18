# RP-Hub 主聊天应用 — 功能清单（逆向审计）

审计对象：`D:\RPNow\_ref\RP-Hub\`（RP-Hub 2.0.6，浏览器本地 AI 角色扮演对话应用）。
本清单只覆盖**主聊天应用**（`index.html` + `assets/js/*` + `assets/css/*`）。
角色卡生成（`character/index.html`）与小说生成（`novel/index.html`）是独立页面，另由专门审计处理；本文只在“集成点”处提及它们，不展开其内部功能。

代码引用格式：`file:line`（行号以当前 checkout 为准）。所有 `assets/js/*` 都是立即执行函数/全局命名空间（`window.RPHubUtils`、`RPHubCardUtils`、`RPHubApiClient`、`RPHubStorage`、`RPHubMemoryUtils`、`RPHubContextUtils`、`RPHubStoryBranches`、`RPHubUiTemplateUtils`、`RPHubComposables`、`RPHubMessageRenderer`、`RPHubCloudBackup`、`RPHubBuiltinContent`、`RPHubBuiltinPresets`、`RPHubConfig`、`RPHubLayoutComponents`、`RPHubComponents`、`RPHubCustomSelect`）。主页面是 Vue 3（CDN `vue.global.prod.js`）+ Tailwind（CDN）+ marked + DOMPurify + SortableJS。

---

## 0. 全局形态与加载顺序

- 入口 `index.html:2517-2524` 用 `document.write` 按固定顺序加载：`built-in-content → core-utils → api-utils → data-services → runtime-services → cloud-backup → update-check → ui-components → app`；`theme.js` 在 `<head>` 单独加载（`index.html:6`）。所有本地资源带 `?v=Date.now()` 破坏缓存。
- `<meta name="rphub-update-api" content="https://rphub-presence.zeabur.app">`（`index.html:9`）。没有 `rphub-presence-api`，且 `presence.js` **未**被主页面加载（全仓库仅 `presence.js` 自身引用该 meta）→ 属于本发行包里的死代码/预留文件。
- 根 `#app`：`h-full flex flex-col md:flex-row`，`:class` 绑定 `app-native-fullscreen`、`mobile-keyboard-active`（`index.html:79-80`）。
- 启动遮罩：`.entry-transition` 书本/Logo 开场动画（`index.html:59-77`，纯 CSS）。
- 全局 Toast 容器（`index.html:87-94`）→ `.toast-stack` / `.toast-item--{success,info,warning,error}`。
- 应用挂载在 `app.js:8565`；`ModalShell`、`ModalHeader` 在 `app.js:8563-8564` 全局注册。

### 明确“不存在”的能力（避免复现时误加）
- 无 TTS / 语音朗读（全仓库无 `speechSynthesis`）。
- 无“冒充用户/impersonate”按钮；没有以用户身份自动补写消息的功能。最接近的是：预设可注入 `user`/`assistant` 角色消息（破限预注入），以及 HTML 卡片 `data-slash` 触发的“卡片交互”用户消息。
- 无群聊/多角色同屏（`groupChat`/`群聊` 无命中）。
- 无消息“隐藏/撤回”操作；只有：卡片交互消息默认折叠、思考/工具时间线可折叠、文风过滤详情弹层、Delete 删除。
- 无消息“滑动”手势（消息区无 touch/swipe 绑定）；滑动只存在于角色卡轮播（CharacterDeck）和剧情分支地图拖拽。
- 无独立“继续”按钮；“继续/重试”= 对最后一条消息点“重新生成”（若最后是用户消息则直接续写）。

---

## 1. 页面 / 视图

主导航 `AppNavigation`（`ui-components.js:285-417`）分三组（`index.html:97-101` 引用）：

| 分组 | 项（view key / 标签） | 说明 |
|---|---|---|
| 常用 | `chat` 聊天 | 对话主视图；默认视图（`app.js:263` `currentView='chat'`） |
| 常用 | `characters` 角色卡管理 | 列表/叠卡、搜索、收藏、批量删、导入导出 |
| 常用 | `memory` 记忆系统 | 记忆设置 + 记忆浏览/压缩率 |
| 常用 | `uitemplates` UI模板 | 变量模板列表 + 变量系统设置 |
| 常用 | `usage` 用量统计 | Token 用量日志 |
| 常用 | `settings` 设置 | 用户/API/高级/备份 |
| 在线 | `generator` 角色卡生成 | iframe `./character/index.html`（**另审**） |
| 在线 | `novel` 小说生成 | iframe `./novel/index.html`（**另审**） |
| 在线 | `square` 万相广场 | iframe `https://rphforum.zeabur.app/`（外部，卡片导入桥） |
| 高级 | `presets` 预设 | 预设管理（破限/防抢话/防神化/防重复/人格内核/去User中心化/文风/活人感/剧情面板/时间戳/人称/禁止规则/COT） |
| 高级 | `worldinfo` 世界书 | 条目管理 + 全局扫描设置 |
| 高级 | `regex` 正则 | 正则脚本管理 |
| 高级 | `tools` 工具 | 工具开关/策略/参数 |

其它“视图级”弹层（不是导航项）：上下文查看器、剧情分支、模型选择器、各类编辑器/确认弹窗、备份与转移、更新公告。

### 1.1 聊天视图（`index.html:108-855`）
- 角色背景层（`index.html:111-114`）：`settings.useCharacterBackground && currentCharacter.avatar` 时显示头像背景，`blur-[2px]`、`opacity:.9`、`char-bg-blur`；否则容器加 `chat-ambient`。
- 角色简介面板（`index.html:122-207`）：点头像/名字展开；显示 `楼` 数、正文字数，记忆开启时显示 `→ 压缩后字数`；只读渲染 `currentCharacter.description`（`renderMarkdown(...,'assistant',true)`）；头部“编辑角色”按钮。
- 聊天头部（`index.html:209-256`）：左侧导航按钮 + 头像/名字/下拉箭头；右侧“全屏聊天/退出全屏”“清空聊天”。
- 消息列表（`index.html:259-642`）：`ref=chatContainer`、`@scroll=handleChatScroll`、`space-y-12 md:space-y-14`；空态两种（未选角色 / 已选角色但无消息）。
- 输入岛（`index.html:645-853`）：卡片交互提示、待发图片预览、最新用量条、快捷面板、textarea、工具栏。

### 1.2 角色卡管理（`index.html:857-1041`）
- 头部：导航按钮、标题、搜索框（`检索角色卡名称或描述...`）、布局切换（叠卡/网格）、批量删除、添加角色卡。
- 叠卡模式 `character-deck`（默认，`useCharacterDeck` = 非批量 且 非 gridview，`app.js:1323`）；网格模式 `character-card` 列表 + “加载更多角色 (n)”。
- 空态提供“前往角色卡工坊”。

### 1.3 设置视图（`index.html:1064-1695`）
- 用户设置卡：头像上传、角色名、叙事视角（第二/第三人称分段开关）、偏好设定、详细设定；右上角人设下拉（切换/新建/删除）。
- API 连接与服务卡：服务连接状态（API 接口延迟、生图服务延迟+配额次数、“立即检测”）、API 提供商选择器（含“自定义”）、API 地址（自定义时）、API Key（`secret-input`）、四个模型入口（聊天主模型/记忆总结模型/记忆向量模型/变量分析模型）、“刷新可用模型列表”、生图设置（密钥/版本/风格/自定义画师串/比例/期望数量）。
- 高级设置卡：开关（使用封面背景、沉浸模式、显示最新用量、文风过滤）、高级参数（对话字体大小）、备份与转移（上传/下载，仅当 `cloudBackup.enabled`）。

### 1.4 预设 / UI模板 / 正则 / 工具 / 用量 / 记忆 / 世界书
见 §3 与 §5 对应小节。

---

## 2. 聊天功能

### 2.1 消息渲染（`runtime-services.js:createMessageRenderer`）
- Markdown：`marked.use({ breaks:true, tokenizer:{ code(){ return undefined } } })`（`app.js:141-149`）——**禁用缩进代码块**，以便缩进 HTML（details/summary 等）按 HTML 渲染。
- 渲染分支（`runtime-services.js:201-268`）：
  1. `allowHtml=false`：`markdownOnlyRenderer` 把 HTML 转义为纯文本，再 DOMPurify。
  2. 整段以 `<!doctype html>` / `<html>` 开头且无 ``` 代码围栏：抽取 `<html>…</html>`，前后文本走 Markdown，中间包成 `.html-card-container` + 沙箱 iframe。
  3. 以 `<div|table|section|article|aside|header|footer|style|script>` 开头且无围栏：直接 `DOMPurify.sanitize`（cleanConfig 白名单含 `script/style/div/span/iframe/svg/input/button/details/summary` 等）。
  4. 含 `<html`/`<!doctype` 的混合文本：剥掉 doctype/html/head/body 标签后走 Markdown。
  5. 常规 Markdown：`marked.parse` → DOMPurify → DOM 后处理：HTML 代码块（`language-html/xml` 或内容看起来像 HTML）替换为 iframe；以 `<` 开头的段落替换为 iframe；含 `<script>` 的 `div[style*=position|background]` / `div[class*=panel]` 面板替换为 iframe；助手消息补记忆引用角标。
- DOMPurify 白名单（`runtime-services.js:54-59`）：`ADD_TAGS` 含 `details,summary,iframe,svg,path,g,circle,rect,defs,linearGradient,stop,style,div,span,script,button,input`；`ADD_ATTR` 含 `style,open,srcdoc,sandbox,frameborder,allow,allowfullscreen,class,id,viewBox,fill,stroke,...,onclick,type,value,checked,data-slash`；`FORBID_ATTR=['onmouseover','onload']`；`FORCE_BODY:true`。
- 缓存：渲染缓存 + 帧检测缓存，各最多 2000 条（LRU 首条淘汰）；`styleFilterEnabled`/`regexScripts`/`user.name` 变化时清空（`app.js:3308-3310`）。
- 流式“正在构建 UI 界面”：`processMainContent`（`app.js:7992-8037`）检测未闭合的 ```/~/`/注释/`<script|style>`/`<!doctype`/`<html|div|script|style>`，未闭合时截断并显示 spinner；同时截断未写完的 `image###`。
- 代码高亮：**无**（marked 默认无 highlight）。

### 2.2 消息操作栏（`index.html:522-607`；逻辑 `app.js:4071-4161`）
显示条件（`index.html:523`）：非编辑中、非思考/工具运行中、非“最后一条 AI 且生成中”、非“自己是用户消息且会话忙且后面没有用户消息”。
- **重新生成**（`regenerateMessage`，仅当该消息是最后一条，且（是用户消息 或 前面已有用户消息））：
  - 最后是用户消息 → 直接续写（`app.js:4126-4136`）：中止后台任务，删除“当前轮”的记忆（`trimClassicMemoriesToTurn(items, currentTurn-1)`），再 `generateResponse(...,{reuseGeneratingState:true})`。
  - 最后是 AI 消息 → 弹确认“确定要重新生成这条消息吗？该楼层的记忆将被清除。”，截断到该条、裁剪记忆/变量变更/计时，再重新生成（`app.js:4137-4159`）。
- **编辑**（`editMessage`，`app.js:3719-3734`）：进入行内编辑；保留原 CoT（`originalCot`）与原 `<ui_template_updates>` 块（`originalUiTemplateUpdate`），编辑区只改 `parseCot(main)` 且去掉变量块；保存时（`saveEditMessage`，`app.js:3745-3780`）拼回、删除 `styleFilterHits`、中止后台、重算受影响轮次的记忆并触发自动补录；未改动提示“消息未改动”。取消恢复。
- **复制**（`copyMessage`，`app.js:3710-3717`）：复制前去掉 `<ui_template_updates>` 块与 `[M#]` 引用。
- **从这里分支**（仅 assistant，`createStoryBranch(index)`，见 §2.12）。
- **删除**（`canDeleteMessage(index)`，`app.js:1083-1098`）：仅“最后一条用户消息及其后连续的 assistant/system 消息”可删；删用户轮次会连带删除后续直到下一条用户消息（`app.js:4082-4088`），并清理记忆、UI 模板 changeLog/blocks、生成计时。
- **文风过滤详情**（仅 assistant 且有 `styleFilterHits`）：弹层列出被过滤片段（序号 + 高亮命中词），按钮标题“查看本条回复过滤的 N 处内容”。
- 移动端：操作栏常显（`opacity-100`），桌面端 hover 才显（`styles.css:1626-1678`）。

### 2.3 思考 / 推理显示（CoT + 原生 reasoning + 工具时间线）
- **原生 reasoning**：从 `reasoning_content/reasoning/thinking/thinking_content/thought/thoughts/reasoning_text`、`reasoning_details`、`content[]` 中 `thought===true` 或 `type` 含 reason/thinking/thought 的部分提取（`core-utils.js:278-311`）；多部分内容中推理部分不计入正文（`api-utils.js:34-36`）。转发生成时会把 `reasoning_content/reasoning/reasoning_details/extra_content` 原样回传（`api-utils.js:260-266`，`app.js:4747-4757`）。
- **CoT 解析** `parseCot`（`core-utils.js:19-69`）：把 `<thinking>/<think>/<cot>` 块视为思考；`<html>/<script>/<style>/<ui_template_updates>`、注释、``` 围栏、行内 `code`、任意标签视为受保护内容；重复开标签仍属分析；流式半截标签暂不展示；输出 `{cot,rawCot,ranges,closingTags,main,isFinished}`。
- **模型相关标签**：`usesThinkingCotTag(model) = /deepseek|glm|kimi/i`（`app.js:4225`）→ 用 `<thinking>`，否则 `<cot>`。
- **时间线 UI**（`index.html:370-459`；`getTimelineSteps` `app.js:5961-6019`）：一个“Thinking”卡片，含：① 原生思考；② 每个工具调用的 reason 行 + 调用行（状态 `receiving/queued/running/done/error/continuing`，详情含参数输入/执行输出/错误）；③ 分析过程（CoT）。可折叠（`isThinkingSummaryOpen`，默认运行中展开、结束后收起）；“详情”展开后记住。
- **自动折叠**：正文到达后自动折叠原生 reasoning（`collapseNativeReasoning`，`app.js:3345-3351`）；用户手动展开过则不自动折叠。
- 助手消息字段：`reasoning`（原生）、`toolCalls[]`、`content`（含 CoT）。

### 2.4 流式输出与中止
- `settings.stream` 默认 `true`，但 `loadData` 里**强制** `settings.stream = true`（`app.js:1766`）。
- 客户端每 60ms flush 一次 delta（`api-utils.js:365`）；`onDelta` 追加 content/reasoning/工具调用。
- 空闲超时 120s（每次收到 chunk 重置；`api-utils.js:81-120`）；非流式兜底：`content-type` 不是 `text/event-stream` 时按普通 JSON 解析（兼容 `data:` 开头）。
- “中止生成”按钮 → `stopGeneration`（`app.js:3509-3516`）：中止 UI 模板分析、主请求、工具队列；把运行中的工具调用标记为 `error`“生成已中止”。
- 等待动画：打字三点 + `GenerationTimer`（`waitTime / estimatedTime`，最近 5 次平均，`app.js:1297-1305`）。

### 2.5 Gemini 抗截断（`settings.preventTruncation`，仅 Gemini 显示）
- 开启时 `replyInTool=true`，请求注入 `output_reply` 工具（`api-utils.js:66-78`）；`tool_choice` 在无其它工具时为 `{type:'function',function:{name:'output_reply'}}`，有其它工具时为 `'required'`（`api-utils.js:294-305`）。
- 只解码已收齐的 JSON 字符串字符；容忍末尾缺失闭合符；正文为空且无普通正文时抛“API 未返回抗截断输出…”，标记 `retryableEmptyToolReply`（仅当无工具调用且无 reasoning），`requestChatCompletion` 最多重试到 **3 次请求**（`api-utils.js:406-413`）。
- 开启抗截断会把 `settings.stream` 自动设为 true（`index.html:776`），并临时禁用 COT 预设（`isPresetEnabled`，`app.js:919-920`；UI 提示“Gemini抗截断已临时关闭 COT”）。
- Gemini 输入混淆（`obfuscateInput = /gemini/i`，`app.js:4263`）：把最新用户消息替换为“读取 `read_user_input` 的返回内容…”，真实输入放进工具结果；每次实际请求（含重试）用零宽字符编码一个新 UUID 前缀（`app.js:4727-4740, 4758-4767`）。

### 2.6 工具系统（关键词检索 / 联网搜索 / 随机）
- 三个内置工具（`built-in-content.js:318-372`，默认全关）：
  1. **关键词检索** `tool_grep` / `keyword_dialogue`：查**当前对话历史原文片段**，不是联网搜索。返回命中轮次、说话方、片段（`app.js:5505-5551`）。
  2. **Tavily 联网搜索** `tool_web` / `web_search`：`query` 为搜索词→Tavily `/search`（`search_depth=advanced`、`max_results=tool.resultCount`、`topic=general`、`include_favicon`）；`query` 含真实 HTTP(S)/www URL→Tavily `/extract`（`extract_depth=advanced`、`format=markdown`、`timeout=30`），最多取 5 个 URL（`app.js:5583-5711`）。需单独 Tavily Key。
  3. **随机生成** `tool_random` / `random_number`：传 `min/max` 生成含两端整数（安全整数、跨度 ≤ 2^53-1），或传 `choices` 数组等概率抽一项（去重）；用 `crypto.getRandomValues` 拒绝采样保证均匀（`app.js:5721-5743`）。
- 调用策略（`settings.activeToolAggressiveness`）：`adaptive`（默认）/`force`（`app.js:1155-1174`）。force 时 `tool_choice:'required'`；系统提示追加对应 reminder（`built-in-content.js:322-332`）。
- 工具定义：`parallel_tool_calls:false`；非随机工具参数 `{query, reason?}`，随机工具 `{min,max,choices,reason?}`（`app.js:4190-4214`）。
- 执行：单次最多 5 项、自动续写最多 **4 轮**（`ACTIVE_TOOL_MAX_AUTO_CONTINUE=4`）；结果按原始调用顺序以 `role:'tool'` 消息追加（**不持久化**，`activeToolMessages`，`app.js:280-281`）；UI 状态 `receiving→queued→running→done/error/continuing`（`app.js:5787-6101`）。
- 返回条数：`resultCount` 5–10，默认 5（`built-in-content.js:320`）；“检索条数”不影响增强记忆固定最多 10 条的召回。

### 2.7 世界书（World Info / Lorebook）
- 条目字段：`comment/content/enabled/scope/keys[]/useRegex/constant/position/order/depth/scanDepth/probability/useProbability`（`core-utils.js:568-635`）。
- 位置 `position`：`system_top`（系统最顶层）、`global_note`（全局备注）、`before_char`（角色设定前）、`after_char`（角色设定后）、`at_depth`（按深度插入对话）、`user_top`（最新用户消息顶部）、`assistant_top`（最新助手消息顶部）；旧别名（`before_character`、`an_top`、数字 0-4 等）会归一化（`core-utils.js:593-616`）。
- 触发：`constant` 恒触发；否则按 `keys` 在“最近 scanDepth 条消息拼接文本”里匹配（普通子串，大小写不敏感；`useRegex` 用 `/pattern/flags`，强制 `i`、去 `g`、遇 `\p{` 加 `u`，`core-utils.js:541-574`）。`probability`（默认 100，`useProbability` 默认 true）按条目缓存随机；`order` 排序。
- 注入（`data-services.js:748-805`）：`at_depth` 作为 `role:'user'` 消息插在“从末尾数第 depth 个 user/assistant 之前”（`depth=4` 即第 5 条前；计数只算 user/assistant）；`user_top` 前插到最新用户消息；`assistant_top` 前插到最新助手消息；`system_top/global_note` 进系统提示；`before_char/after_char` 进角色前导用户消息。`safeTargetLimit` 防止插进预设/角色定义区。
- 全局设置：`worldInfoSettings.scanDepth` 默认 2（0–20）、`maxDepth` 默认 0（0–50，作为条目扫描深度上限）（`app.js:1312-1315`）。
- “自动生图”是世界书里的**系统条目**（`comment==='自动生图'`，`constant:true`），由“自动生图开关”控制（`app.js:1902-1940, 6711-6736`）。

### 2.8 预设 / 指令注入（context & instruct presets）
- 预设字段：`{name, content, enabled, role}`，`role ∈ {system,user,assistant}`（默认 system）（`app.js:923-932`）。
- 注入顺序（`generateResponse`，`app.js:4343-4398`）：
  1. `破限`（system）→ 系统提示开头；
  2. `system_top` 世界书 → 3. `global_note` 世界书；
  4. `[System Presets]`：其它 system 预设（不含破限），以 `\n\n---\n\n` 连接；
  5. 角色前导（`before_char` 世界书 + `[Character]\nName: …\nPersonality: …` + `mes_example` + `after_char` 世界书）作为 `role:'user'`；
  6. `[User Info]`（Name/Description/Preferences，`built-in-content.js:59-64`）；
  7. 记忆引用说明（仅当已开启记忆且上下文超过保留楼层）；
  8. 工具系统提示；9. UI 模板变量上下文；10. 主模型 UI 模板更新提示；11. COT 预设内容。
  - `role:user/assistant` 的预设作为消息插在系统消息之后、角色前导之前（`messagePresets`，`app.js:4414-4420`）。
  - `文风（抗八股）` 预设内容会被剥掉 `<writing_style>` 包裹，拼进 `<next_response>` 的写作风格位（`app.js:4322, 4608-4617`）。
- 内置核心预设 `corePresets`（`built-in-content.js:384-448`）：`破限`、`破限预注入 · User 1`、`破限预注入 · AI 1`、`破限预注入 · User 2`、`破限预注入 · AI 2`；启动时按原顺序强制置于最前，已存在则保留用户开关状态（`app.js:7758-7787`）。
- 托管预设 `managedPresets`（`built-in-content.js:450-667`）：`NSFW增强`（别名 色情内容增强）、`防抢话`、`防神化`、`防重复`、`人格内核`、`去User中心化`、`文风（抗八股）`、`活人感`、`剧情面板`、`时间戳`、`第二人称`、`第三人称`、`禁止规则`；用 `syncBuiltinPreset` 按 `before/after/move` 维护顺序（`app.js:933-963`）。其中 `第二人称/第三人称` 在列表里隐藏（`index.html:1721`），由人设 `person` 决定启用。
- `COT` 预设：动态生成内容（`buildCotPresetContent`，`built-in-content.js:669-751`），随记忆/UI 模板/剧情面板/模型标签/抗截断开关变化；`破限预注入 · AI 1/2` 在 COT 启用时被替换为两阶段预注入内容（`prefillPhase`）。
- 预设管理：列表拖动排序、启用开关、编辑（名称/注入位置/内容）、删除；导入 JSON（数组或单对象）/导出（数组）。

### 2.9 记忆系统（基础 / 增强 / 二次压缩 / 补录 / 召回）
- 开关 `memorySettings.enabled`（默认 false）；模式 `classic`（基础，默认）/`enhanced`（增强）（`app.js:1137-1144`）。
- **逐轮总结（基础）**：每轮结束后异步调用总结模型（`temperature 0.2`、非流式），把该轮压缩成第三人称高密度记忆（目标 200–250 字，`built-in-content.js:23-47`）；上下文里超过 `summaryKeepFloors` 的轮次，**AI 原文被对应总结替换**（用户原文保留），聊天界面不改（`app.js:4480-4555`）。
- **保留最近楼层**：10–50、步长 2、默认 20（`app.js:1130-1133, 1177-1181`）。
- **二次压缩**：最近 25 轮保留逐轮总结；更早的按每 **5 轮**分组压缩成一条（目标 350–500 字）；“确认没有正文的空轮可跳过，有正文但缺总结的轮次必须补录”；合并记忆仍保存 `sourceMemories`，增强召回用逐轮总结而非合并结果（`app.js:5099-5217`；README 第 38 行）。合并后用 `总结记忆 第 X-Y 轮` 标记用户消息、总结作为助手消息，组内更早消息移除。
- **增强模式**：在基础总结之上，把“用户原输入 + 本轮总结”生成向量（embedding，批量 16，int8 量化存储），按最新用户输入召回相似度 ≥ **0.48** 的记忆，最多 **10 条**，按原时间顺序以 `<enhanced_memory_recall><memory_fragment id="M#">…` 附在最新用户消息后，仅本次请求使用（`app.js:5437-5471`，`data-services.js:389-408`）。
- **补录**：手动（弹窗，三阶段 逐轮总结/向量记忆/二次压缩，显示进度与预计时间，可停止/继续）与自动（每轮结束后 patrol，若正在补录则置 rescan 标志；等待当前回复结束再继续）（`app.js:6137-6309`）。
- **记忆编号 [M#]**：持久编号 `no`，正文引用 `[M12]` 在显示时变成可点角标，并给所在句加虚线下划线；点击打开“判断依据”弹窗显示对应总结（`runtime-services.js:105-196`，`app.js:8155-8184`）。复制/发回模型/总结/检索前会去掉 `[M#]`（`app.js:2600`）。
- **压缩率**：记忆视图显示 `压缩率%` 与“原 X 字 → 后 Y 字”条形（`app.js:3013-3069`）。
- **清空**：记忆页“清空当前模式记忆”确认后清空（两模式共享）（`app.js:8247-8254`）。
- 单条总结可“重新生成这条总结”（`retryClassicMemory`，会删旧 embedding 并重索引）。

### 2.10 剧情分支（branch / rollback）
- 分支字段：`{id,name,parentId,createdAt,updatedAt,forkFloor,floorCount,messageCount,wordCount}`；`main` 固定名“主线”、不可改名/删除（`data-services.js:848-892`）。
- 创建：① 消息操作栏“从这里分支”（仅 assistant 消息，从该条截断复制）；② 分支弹窗选中节点后创建子分支（复制整条聊天+记忆）（`app.js:7000-7121`）。新分支名 `分支 N`，名称 ≤30 字。
- 切换：先保存当前分支（聊天、记忆、UI 模板 runtime、分支元数据），再载入目标分支；分支 scope id = `uuid` 或 `uuid__branch__<branchId>`（`data-services.js:829-834`）。
- 删除：子分支顺延到父节点；删除该分支聊天/记忆/UI runtime（`app.js:6949-6998`）。
- 分支地图：SVG 树（`createStoryRouteMap`，`data-services.js:894-991`），节点显示名称/楼层/字数（W 单位），可拖拽滚动、选中、进入、改名、删除。
- 导出：角色“导出聊天记录”一次性导出全部分支为 JSONL（见 §4）。

### 2.11 图片附件（用户发图）
- 输入岛回形针按钮 → 文件选择（`accept="image/*" multiple`），最多 **3 张**、每张 ≤ **20 MB**（`app.js:3526, 3571-3601`）；超出提示“单次最多发送 3 张图片，且每张不能超过 20 MB”。
- 图片压缩：`compressImage(dataUrl, 1600, 0.86)`（JPEG，白底）（`app.js:3591`）。
- 发送：用户消息 `imageAttachments:[{dataUrl}]`；显示为 1–3 宫格（3 张时第一张跨两列）；发给模型时转成 OpenAI 多模态 `content:[{type:'text'},{type:'image_url',image_url:{url,detail:'high'}}]`（`app.js:3527-3547`）。
- 文本里会附加“图片 N：描述/用户上传的图片”（`appendMessageImageDescriptions`）。
- 2.0.6 起图片由聊天主模型直接识别，不需要单独识图模型（`built-in-content.js:765-772` 更新公告）。

### 2.12 自动生图（NAI）
- 输入岛“图片”按钮 = 自动生图开关（`isAutoImageGenEnabled`），实际读写世界书 `自动生图` 条目；开启会启用 `NAI画图正则` 并按当前设置改写其替换 URL（`app.js:2158-2248, 6679-6746`）。
- 提示词要求模型输出 `image###英文Tag###`，每次回复插入 `settings.imageGenCount`（2–8，默认 2）张，分散在段落之间（`built-in-content.js:237-295`）。
- `image###Tag###` 正则：`/image###((?:(?!image###|###)[^\r\n])*?)(?:###|(?=\r?\n)|$)/gi`（`core-utils.js:72`）——Tag 内不能有换行、不能含 `###`/`image###`。
- 正则替换为 `.generated-image-card`（含 `data-image-request` URL、进度条、重roll 按钮）；聊天容器 MutationObserver 自动挂载未初始化的卡片（`app.js:2076-2095`）。
- 生图服务：`IMAGE_GEN_BASE_URL = https://nai.sta1n.cn`（`core-utils.js:955`）；`POST /api/jobs`（query 参数转 body，`token` 取 URL 或 `settings.imageGenKey`），轮询 `GET /api/jobs/{id}?token=` 每 150ms，最多 5 次轮询失败；状态 `queued/running/done/failed`，图片 URL 或 `/api/jobs/{id}/content?token=`（`app.js:1945-2074`）。
- 生成参数：`steps=40&scale=6&cfg=0&sampler=k_dpmpp_2m_sde&negative=…`（`app.js:6688`）；`model`/`artist`/`size` 由设置注入；比例映射 竖图 832/1216、横图 1216/832、方图 1。
- **重新生成单图**（`handleGeneratedImageReroll`）：点击卡片重roll，随机交换两个相邻 Tag、`nocache=1` 重新请求；成功后改写消息正文里的 `image###…###`；Tag 少于 2 个提示“提示词太短，无法重新生成”；会话忙时禁止（`app.js:2097-2156`）。
- 配额：`POST /api/api/getUser {toUserId:key}`，`status==='ok' && type==='sta1n'` 时显示 `data.value` 次（`app.js:292-321`）。
- V5（`nai-diffusion-5-full`）不支持 `r18/lolita25d/anime`，选择 V5 时自动切回 `vertical`（`app.js:594-597, 2229-2237`）。

### 2.13 UI 模板（HTML 状态栏 + 变量 JSON）
- 模板字段：`{id,name,enabled,scope('character'|'global'),order,placement('top'|'bottom'),htmlTemplate,initialVariableState,variableState,variableSchema,changeLog[],runtimeByCharacter{},updateMode}`（`data-services.js:1037-1060`）。
- 渲染：`{{ expression }}` 与 `{{#each path as alias}}…{{else}}…{{/each}}`（最多 50 层嵌套）；路径支持 `a.b`、`a['b']`、`$root`、`this`、`@index/@number/@first/@last/@key`、`root.`、`../`、别名；值经 HTML 转义（`data-services.js:1168-1216`）。渲染结果包进沙箱 iframe（`sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-same-origin allow-downloads allow-pointer-lock allow-presentation allow-top-navigation-by-user-activation"`），注入 viewport/reset 样式、jQuery 3.7.1、高度自适应脚本、`data-slash` 点击桥、记忆引用装饰（`data-services.js:1218-1369`）。
- 插入位置：`top`（助手消息正文上方）/ `bottom`（正文下方）；模板按 `order` 降序；角色模板 + 全局模板合并（`app.js:2368-2374`）。
- 更新方式：
  - **主模型**（`uiTemplateMainModelAnalysis=true`，默认）：在系统提示里要求模型在正文后输出 `<ui_template_updates>{JSON}</ui_template_updates>`（单模板直接对象/数组；多模板必须数组 `[{id,variables}]`），正文结束后解析校验并应用（`app.js:2407-2488`；协议规则 `built-in-content.js:148-200`）。
  - **副模型**（false）：每轮结束后用 `settings.uiTemplateModel`、`temperature 0.4`、非流式分析最近 `uiTemplateAnalysisDepth`（4–10，默认 4）层对话，逐模板输出变量块（`app.js:3828-3987`）。可“立即分析”。
  - `uiTemplateInjectContext`：把某轮变量快照以 `<ui_template_state_context>` 注入系统提示（仅副模型模式）。
- 校验：字段必须来自初始状态/说明允许新增的动态键；类型/结构校验；重复模板、未知 ID、未定义变量、类型错误都会报错；失败会生成“修正提示”附加到下一条用户消息（`app.js:2490-2534`）。
- 变更记录：每模板最多 50 条 `changeLog`（`{id,time,source,model,turn,changes:{path:{from,to}}}`）；历史 tab 只显示最近一条（`ui-components.js:1642-1664`）。
- 分支/角色运行时：`runtimeByCharacter[scopeId] = {variableState, changeLog}`，切换分支/角色时存取（`app.js:2695-2734`）。
- 删除/编辑轮次时按 turn 裁剪 changeLog 与消息里的 `uiTemplateBlocks`（`app.js:2644-2680`）。

### 2.14 上下文查看器（`index.html:813-821`；`ui-components.js:1980-2097`）
- 显示“实际发给模型”的消息列表（请求发出后异步构建，`app.js:4745-4772`）：角色标签（系统提示词/用户/AI/记忆/工具）、楼层 `F#` 或“预注入”、预览、字数；可展开 `renderedContent`。
- 顶部组成条：系统提示词/世界书/记忆/原文/工具各占多少字。
- 插入的世界书标签（名称 + 触发关键词/楼层/常驻）。
- 高亮：世界书关键词黄色 `mark`，`[M#]` 与 `<memory_fragment>` 紫色 `mark`（`data-services.js:637-746`）。

### 2.15 Token 用量统计
- 每次 API 请求（chat / tool_continuation / summary / embedding / ui_template）记录 `{id,timestamp,type,model,apiUrl,isStream,durationMs,outputCharacters,inputTokens,outputTokens,totalTokens,cacheReadTokens,cacheWriteTokens,reasoningTokens,reported,actualQuota?,usageGroup?,usageLogKey?}`（`app.js:1385-1391`，`runtime-services.js:410-426`）。
- 输入 token 优先用 `prompt_tokens`，否则 `input_tokens + cacheRead + cacheWrite`；兼容 Gemini `usageMetadata`（`candidatesTokenCount` 等）（`core-utils.js:99-156`）。
- 部分流式响应中止也会记账（`api-utils.js:398-402`）。
- “新 API”额度查询：`GET {apiRoot}/api/log/token`（去掉 `/v1`），延迟 500ms、5000ms 各试一次，匹配 `type===2`、同模型、时间 ±120s、token 数一致，写入 `actualQuota/usageGroup/usageLogKey`（`runtime-services.js:379-409`）。
- 输入岛“显示最新用量”条：最新一条 chat/tool_continuation 的 输入（去缓存）/缓存/输出，单位 `w`（万）（`app.js:687-698`）。
- 用量页：分类 全部/主对话/记忆系统/变量分析；时间 全部/24小时/7天/30天；总用量（输入含缓存 + 输出）、请求数；日志行含模型/类型/时间/时长/输出速度（字/s）/输入/缓存/输出/消耗（`¥`，`quota/500000`）；分页 10 条；可清空（`ui-components.js:2099-2275`）。

### 2.16 全屏 / 沉浸模式 / 背景
- 全屏：`document.documentElement` 原生 fullscreen；`isChatFullscreen` 控制 `.app-native-fullscreen`，监听 `fullscreenchange`（`app.js:3673-3708`）。
- 沉浸模式 `settings.immersiveMode`（默认 false）：隐藏头像与名字标签，消息居中、窄列（桌面 50vw）（`styles.css:2549-2562`）。
- 封面背景：见 §1.1；移动端 `.char-bg-blur` 高度受 `--chat-bg-height` 控制（`styles.css:2577-2586`）。

### 2.17 卡片交互（HTML 卡片 slash）
- UI 模板/HTML 卡片里带 `data-slash="命令"` 的元素被点击时，`window.triggerSlash(command)` 把命令写入 `pendingCardInteraction` 并聚焦输入框（`app.js:7721-7733`；iframe 内点击由注入脚本转发，`data-services.js:1269-1275`）。
- 发送时作为独立用户消息入史：`{role:'user',content:command,isSelf:true,isTriggered:true}`；默认折叠显示“触发了卡片交互”，点击展开 raw（`index.html:342-359`）。会话忙时拒绝并提示“正在生成中，请稍后...”。

### 2.18 滚动 / 渲染窗口
- 初始只渲染最后 20 条（`CHAT_RENDER_INITIAL_LIMIT=20`），滚动到顶部附近（≤80px，且先向下滚过 >160px 解锁）加载更早 10 条（`CHAT_RENDER_BATCH_SIZE=10`），用锚点恢复滚动位置（`app.js:2784-2882`）。
- 消息进入视口时 IntersectionObserver 触发 `scroll-reveal` 动画（`app.js:361-388`）。

---

## 3. 设置与配置（含默认值）

### 3.1 用户与人设
| 字段 | 默认 | 说明 |
|---|---|---|
| `user.name` | `请前往设置自定义你的名称` | 首次启动弹“欢迎使用 RP Hub”强制设置；保存时校验非空且不等于默认 |
| `user.description` | `''` | 详细设定（外貌/性格/背景） |
| `user.preferences` | `''` | 偏好设定 |
| `user.avatar` | `''` | 上传压缩 200px/0.6（`app.js:8515`） |
| `user.person` | `second` | `second`/`third`，控制第二/第三人称预设启用与 UI 标签 |
| `user.uuid` | 启动生成 | 用于 profile 迁移 |
| `userProfiles[]` | 迁移自 user | `{uuid,name,description,preferences,avatar,person}` |
| `activeProfileId` | 首个 profile | 切换即 `Object.assign(user, profile)` |

### 3.2 API 连接
| 字段 | 默认 | 说明 |
|---|---|---|
| `settings.apiProviderId` | `sta1n` | 可选 `sta1n` / `deepseek` / `openrouter` / `siliconflow` / `custom` |
| `settings.apiUrl` | `https://sta1n.ai/v1` | 自定义时手填；保存时按 provider 归一化 |
| `settings.apiKey` | `''` | 每个 provider 独立保存于 `apiProviderKeys[providerId]` |
| `settings.customApiUrl` | `''` | 自定义地址 |
| `settings.model` | `''` | 当前聊天模型；由槽位或选择器写入 |
| `settings.qualityModel/balancedModel/fastModel` | `''` | 三槽位（快捷面板“槽位 1/2/3”） |
| `settings.contextSize` | `1000000` | **无 UI、无实际截断逻辑**，仅每次保存被强制赋值（`app.js:1631,1765`） |
| `settings.reasoningEffort` | `''`（默认） | 选项：`none` 关闭 / `low` 低（Low）/ `medium` 中（Medium）/ `high` 高（High）/ `max` 最高（Max）/ `''` 默认（`app.js:862-869`）；旧值 `xhigh` 迁移为 `max` |
| `settings.temperature` | `1.0` | 快捷面板滑块 0–1 步长 0.01；**每次启动强制重置 1.0**（`app.js:7753-7754`） |
| `settings.stream` | `true` | **加载时强制 true**（`app.js:1766`） |
| `settings.preventTruncation` | `false` | 仅 Gemini 模型显示；开启强制 `stream=true` |
| `settings.activeToolAggressiveness` | `adaptive` | `adaptive`/`force` |
| `settings.imageGenKey` | `''` | 生图密钥；保存时触发 `enforceSpecialRules` + 配额查询 |

提供商列表（`core-utils.js:965-990`）：STA1N API `https://sta1n.ai/v1`；DeepSeek `https://api.deepseek.com/v1`；OpenRouter `https://openrouter.ai/api/v1`；SiliconFlow `https://api.siliconflow.cn/v1`；自定义。API 端点拼接：以 `/v1` 结尾则直接用，否则加 `/v1`（`api-utils.js:5-9`）。

### 3.3 生图设置
| 字段 | 默认 | 选项 |
|---|---|---|
| `settings.imageModel` | `nai-diffusion-4-5-full` | `V4.5 完整版（-1）` / `V5 完整版（-6）` |
| `settings.imageStyle` | `vertical` | 韩漫小清新风 / 动漫同人风 / 2.5D唯美风(r18) / 2.5D唯美风（萝）(lolita25d) / 本子里番风(anime) / GalGame风 / 自定义 |
| `settings.customImageArtists` | `''` | style=custom 时显示 |
| `settings.imageSize` | `竖图` | 竖图 / 横图 / 方图 |
| `settings.imageGenCount` | `2` | 2–8 张（钳制 2–8） |
| `settings.imageGenKey` | `''` | STA1N/NAI 密钥 |

### 3.4 高级 / 外观
| 字段 | 默认 | 说明 |
|---|---|---|
| `settings.useCharacterBackground` | `true` | 使用封面背景 |
| `settings.immersiveMode` | `false` | 沉浸模式 |
| `settings.showLatestUsageBar` | `false` | 输入岛显示最新用量 |
| `settings.styleFilterEnabled` | `true` | 文风过滤 |
| `settings.fontSize` | 桌面 16 / 移动 14 | 12–20px 整数（钳制） |
| `settings.uiTemplateEnabled` | `false` | 变量分析总开关 |
| `settings.uiTemplateMainModelAnalysis` | `true` | 主模型/副模型分段 |
| `settings.uiTemplateInjectContext` | `false` | 副模型时注入变量快照 |
| `settings.uiTemplateModel` | `''` | 变量分析（副模型）模型 |
| `settings.uiTemplateAnalysisDepth` | `4` | 分析对话层数 4–10 |

主题：`localStorage['rphub-appearance'] = light|dark`，写在 `<html data-app-theme>`；导航底部日月开关切换，`storage` 事件跨标签同步，并向本地 `character/novel` iframe 广播 `RPHUB_THEME`（`theme.js`）。

### 3.5 记忆设置
| 字段 | 默认 | 范围/说明 |
|---|---|---|
| `memorySettings.enabled` | `false` | 记忆系统总开关 |
| `memorySettings.mode` | `classic` | `classic` 基础 / `enhanced` 增强；旧 `vector` 迁移为 enhanced |
| `memorySettings.classicModel` | `''` | 总结模型（旧 `model` 迁移） |
| `memorySettings.embeddingModel` | `''` | 向量模型（仅增强；选择器过滤 embedding） |
| `memorySettings.summaryKeepFloors` | `20` | 10–50 步长 2（`keepFloorsSlider`） |
| `memorySettings.classicConcurrency` | `5` | 1–10 |
| `worldInfoSettings.scanDepth` | `2` | 0–20 |
| `worldInfoSettings.maxDepth` | `0` | 0–50（0=不限制） |

### 3.6 工具设置
- 全局策略：强制 / 自适应（默认自适应）。
- 每个工具：启用开关；`resultCount` 5–10（默认 5）；web 工具有 `tavilyApiKey`（未填时列表显示“需要填写 Tavily API Key”）。
- 工具不可新建/删除，只能编辑参数；规范化时按 `id`/`callName` 去重并补全默认（`app.js:1228-1295`）。

---

## 4. 数据模型与存储

### 4.1 IndexedDB（主存储）
- DB 名 `RPHubDB`，版本 1，对象仓库 `store`（键值对，`data-services.js:5-25`）。
- 键前缀 `rp_hub_`；旧库名 `SillyTavernDB`（由 charCode 拼接）、旧前缀 `silly_tavern_` 会自动读取并回写迁移（`data-services.js:100-160`）。
- 写保护：云恢复期间 `writesPaused`，非 `force` 写直接丢弃（`data-services.js:15, 113-123`）。
- 存储键（`app.js:1634-1652, 1840` 等）：
  - 全局：`rp_hub_settings`、`rp_hub_presets`、`rp_hub_regex`、`rp_hub_global_regex`、`rp_hub_worldinfo`、`rp_hub_global_worldinfo`、`rp_hub_worldinfo_settings`、`rp_hub_global_ui_templates`、`rp_hub_active_tools`、`rp_hub_user`、`rp_hub_user_profiles`、`rp_hub_active_profile_id`、`rp_hub_last_active_char`、`rp_hub_memory_settings`、`rp_hub_token_usage_history`、`rp_hub_characters`。
  - 角色/分支作用域（`scopedStorageKey(name,id)`）：`rp_hub_chat_<scopeId>`、`rp_hub_classic_memories_<scopeId>`、`rp_hub_branches_<characterUuid>`；`scopeId` = `uuid`（主线）或 `uuid__branch__<branchId>`。
- 保存时机：`saveData()` 写全局；聊天历史防抖（空闲 300ms / 生成中 1500ms）；`watch(chatHistory.length)` 触发；设置/预设/正则/世界书/工具/user 变更 1s 防抖；记忆设置 500ms 防抖。存储失败提示“存储空间不足/聊天记录保存失败…”（`app.js:1539-1597`）。

### 4.2 localStorage
| Key | 用途 |
|---|---|
| `rphub-appearance` | 主题 `light`/`dark` |
| `roleplay_hub_update_id` | 已读更新公告版本号（5 位数字） |
| `rp_hub_cloud_backup` | 最近备份 `{key,expiresAt}` |
| `rphub_presence_client_id` | presence.js 用（主页面未加载） |

### 4.3 记录结构（关键字段）
- **character**：`{uuid,name,description,personality,first_mes,creator_notes,avatar,worldInfo[],regexScripts[],uiTemplates[],recentGenerationTimes[],createdAt,favoriteAt?}`；迁移会补 `uuid`/`createdAt` 并删除 `scenario`（`app.js:1703-1733`）。
- **chat message**：`{id,role,name,content,reasoning?,toolCalls?,isSelf?,shouldAnimate?,skipReveal?,isEditing_Message?,editMessageContent?,editMessageHeight?,originalCot?,originalUiTemplateUpdate?,originalEditMessageContent?,imageAttachments?[{dataUrl}],styleFilterHits?[],responseError?,uiTemplateBlocks?{top[],bottom[],updatedAt},uiTemplateAnalysisFailure?,uiTemplateCorrection?,isTriggered?,showRaw?,isCotOpen?,isReasoningOpen?,isReasoningUserToggled?,isReasoningAutoCollapsed?,isSummaryOpen?,hasOpenedSummaryDetail?}`；上下文副本另带 `_sourceIndexes/_contextFloor/_preventContextMerge/_classicMemory/_memoryNo/_worldInfoEntries/_suppressUiTemplateCorrection/_enhancedMemoryRecallCount`（内部字段，不持久化语义）。
- **classic memory**：`{id,no,timestamp,turn,turnStart?,turnEnd?,summary,enabled,classicMemory:true,secondaryCompressed?,summaryModel,sourceUserIds[],sourceAssistantIds[],sourceUserText,sourceAssistantText,sourceMemories?,embeddingQ?,embeddingScale?,embeddingDims?,embeddingEncoding?,embeddingModel?,embeddingApiUrl?}`；embedding 为 int8 量化 base64（`int8:maxabs:v1`）（`data-services.js:222-243`）。
- **preset**：`{name,content,enabled,role}`。
- **regex script**：`{name,regex,flags,replacement,placement[1,2],markdownOnly,promptOnly,runOnEdit,minDepth,maxDepth,scope,enabled}`（导出用 `disabled` 镜像）。
- **world info entry**：见 §2.7。
- **UI template**：见 §2.13。
- **active tool**：`{id,name,enabled,type,callName,resultCount,resultCountVersion,description,displayDescription,tavilyApiKey?}`。
- **token usage record**：见 §2.15。
- **branch**：见 §2.10；存储 `{version:1,activeBranchId,branches}`。
- **user profile**：见 §3.1。

### 4.4 导入 / 导出格式
- **角色卡 JSON**：`{data:{name,description,personality,first_mes,creator_notes,uiTemplates?,extensions:{rp_hub_watermark:'rp-hub',regex_scripts:[…],rp_hub_ui_templates:[…]},character_book:{entries:[…]}}}`（`core-utils.js:764-797`）。
- **角色卡 PNG**：读取 `tEXt/iTXt` 的 `chara`/`ccv3`（或任意 >50 字符、`{`/`ey` 开头的值），base64 解码；导出时把 `chara` 块注入 IHDR 之后（`core-utils.js:404-489, 838-861`）。
- **角色导入**：`.json` / `.png` / `.jsonl`（聊天记录）；PNG 头像整张图作为 `avatar` 保存（可能很大，显示时转 blob URL，`app.js:2296-2316`）。
- **聊天记录导出**：JSONL。首行 manifest `{type:'rp-hub-branch-chat',version:1,characterName,exportedAt,activeBranchId,branches:[…]}`，其后每行 `{branchId,messages:[…]}`；文件名 `<角色名>_全部分支_chat.jsonl`（`app.js:7603-7668`）。
- **聊天记录导入**：JSONL（分支 manifest 或纯消息数组）；纯消息导入到当前分支（`app.js:7430-7549`）。
- **预设导出**：直接数组；**正则导出**：`toRegexExportEntry` 数组；**世界书导出**：`{entries:[…]}`；**UI 模板导出**：`{type:'rp-hub-ui-templates',templates:[…]}`；均通过“选择导出项目”多选弹层。
- **云备份/恢复**：见 §4.5。

### 4.5 云备份 / 同步（`cloud-backup.js`）
- 需 `meta rphub-update-api` 非空；需要 `crypto.subtle`（https）。
- 上传：先 `saveAll()`；把每张角色卡与其名下 `chat`/`branches` 作用域数据各作为一个“块”，块名 = JSON 字节 SHA-256；先 `POST /v1/backup/check {hashes}`（每批 1000）询问缺失，再 gzip `PUT /v1/backup/blobs/{hash}`（XHR 以获上传进度）；最后 `POST /v1/backup {characters:manifest, replaces:旧key}` 得到 16 位密钥。
- 上限：单次 **1 GB**（超出报“角色卡和聊天加起来超过 1GB”）；密钥 **15 天**有效；重新上传作废旧密钥。
- 恢复：输入密钥（`normalizeKey` 大写、去非字母数字、O→0、I/L→1，长度必须 16）→ `GET /v1/backup/{key}` → 比对本地卡（规范化字段排序/忽略空字段后 JSON 比较）：新增/替换/跳过；下载块并写入（替换聊天时删对应 `classic_memories`）；替换卡会删除本机多出的分支；完成后 1.5s 刷新页面。
- 进度：阶段标签 + 百分比 + 详情；错误走 toast。

---

## 5. UI 组件与交互

### 5.1 导航（`AppNavigation`）
- 分组 常用/在线/高级；在线项在选中时面板居中，否则锚定触发按钮；Esc 关闭、Tab 焦点陷阱、关闭后还原焦点（`ui-components.js:285-417`）。
- 底部：用户头像/名字 + 主题开关（`role="switch"`）。
- 状态点：记忆处理中（`memory`）、UI 模板运行中（`uitemplates`）。

### 5.2 聊天头部 / 简介面板
- 点头像切换简介面板；面板显示楼层/字数/压缩预测；遮罩点击关闭；编辑按钮。

### 5.3 消息气泡
- 玻璃拟态 `.msg-bubble-glass`（背景/边框/阴影变量），自消息 `.msg-bubble--self`（primary-50），系统消息 `.msg-bubble--system`（红色）。
- 名字标签 `.msg-name-tag`（标准模式显示，沉浸模式隐藏）。
- 头像：用户用 `msg.avatar||user.avatar`，否则首字符渐变块；助手用角色头像。
- 编辑态：行内 textarea + 取消/保存。
- 操作栏：胶囊背景，桌面 hover 显示、移动常显；触摸点击有 `.is-tapped` 反馈。

### 5.4 输入岛
- 自动增高 textarea（`autoResizeInput`）；`enterkeyhint="enter"`；**Enter 只换行，不发送**（无 Enter 发送快捷键），发送用按钮。
- 工具栏：发图（标题 `发送图片（n/3）`）、自动生图、上下文查看器、剧情分支、快捷面板、发送/中止。
- 待发图片横排预览，可单个移除；卡片交互提示条可取消。
- 快捷面板（`chat-quick-panel`）：槽位 1/2/3 模型切换、推理强度滑块（0–5）、温度滑块、流式输出、沉浸模式、Gemini 抗截断（仅 Gemini）；Esc 关闭。

### 5.5 弹层 / 模态
- `ModalShell`：遮罩 + 面板过渡，可选 `close-on-backdrop`。
- `ActionConfirmModal`（红色警告，确认/取消，z-160）；`RetryConfirmModal`（补录重试，取消中断/立即重试，z-200）。
- `MemoryBackfillModal`：三阶段进度条、预计剩余、停止/继续/后台继续/关闭，Esc 关闭、焦点陷阱。
- `ModelSelectorModal`：搜索、分类标签（全部/claude/gemini/deepseek/llama/glm/moonshot/grok/其他 + 计数）、3 槽位草稿（聊天主模型）、embedding 目标只读搜索“embedding”。
- 编辑器：角色（4 tab：基础/描述/人设/开场白）、预设（名称/注入位置/内容计数）、正则（名称/作用范围/正则+flags/替换/高级：生效位置、仅用户可见/仅AI可见、最小/最大深度）、世界书（备注/范围/关键词标签/正则匹配/始终常驻/插入位置/顺序/概率/自定义扫描深度/插入深度/内容）、UI 模板（变更记录/编辑内容；HTML/变量JSON/变量说明三 tab + 实时预览 + 协议检查）、工具（返回条数、Tavily Key）、分支改名。
- `SecretInput`：password + 复制 + 显示/隐藏；失焦自动隐藏。
- `SettingsHelp`：问号触发，popover teleport 到 body，跟随滚动/缩放重新定位；外部点击关闭。
- `ExportSelectionModal`：全选/取消全选/多选/导出选中。
- `CharacterExportModal`：JSON / PNG / 聊天记录。
- `AddCharacterModal`：新建角色卡 / 生成角色卡 / 导入角色卡(.png,.json) / 导入聊天记录(.jsonl)。
- `AutoImageGenModal`：新导入角色后询问是否开启自动生图（暂不开启/立即开启）。
- `UpdateNotificationModal`：内置公告（10s 倒计时才能关）+ 远程新版本事件（提示手动刷新）。
- `ContextViewerModal`、`StoryBranchModal`（含改名子模态）、`MemoryCitationModal`（判断依据）、备份与转移对话框。

### 5.6 拖拽 / 排序
- SortableJS：`#presets-list`、`#regex-list`、`#worldinfo-list`；手柄 `.sortable-list-handle`，拖完把 DOM 还原再按稳定 key 更新数组并 `saveData()`；同一时间只保留一个 Sortable 实例（切换视图销毁）；尊重 `prefers-reduced-motion`（`app.js:1467-1497`）。
- 角色卡叠卡：拖拽横向切换（阈值/快速滑动）、左右箭头、键盘 ←/→、点击侧卡聚焦；按钮颜色从封面取色（失败回退默认）；导入新卡有入场动画（`ui-components.js:2792-3026`）。
- 剧情分支地图：pointer 拖拽滚动，拖拽后抑制节点点击。

### 5.7 Toast
- 顶部居中堆叠，默认 2000ms；图标按消息关键词自动选择（正在/稍后/等待→wait，复制→copy，删除/清空/清理/清除→trash，导出→download，导入→upload，收藏→star，图片/生图→image，重新生成/重试→refresh，改名→rename，分支→branch，模型→model，中止/停止→stop，切换/进入→swap，保存→save）；error 恒为错误图标（`core-utils.js:204-249`）。

### 5.8 响应式 / 移动端
- 断点：`≤768px` 移动（隐藏滚动条、禁用 backdrop-filter、输入岛 `bottom: var(--keyboard-inset)`、`--app-visual-height` 控制 html/body/#app 高度、角色背景高度 `--chat-bg-height`）；`≥769px` 消息列居中 50vw；`≤767px` 样式微调；`≤640px` 分支操作按钮等分；`≤480px`、`≤360px` 局部。
- 键盘：`visualViewport` resize/scroll → 计算 `--keyboard-inset`、`isMobileKeyboardOpen`；输入框聚焦/失焦（180ms 延迟）强制同步。
- 主题：明/暗变量切换；暗色下弱化卡片 HTML 亮度（`theme.css:378-380`）。
- 动效：`prefers-reduced-motion` 全局降级。

### 5.9 iframe 集成
- `EmbeddedViewContent`：沙箱 `allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads`，加载菜单按钮与 loading 文案；切换视图时 URL 加 `?t=Date.now()` 重新加载。
- 角色卡工坊：`WORKSHOP_READY` → `SYNC_SETTINGS`；`WORKSHOP_IMPORT_AND_PLAY` → 导入并进入对话，失败回 `WORKSHOP_IMPORT_RESULT`。
- 万相广场：`RPH_FORUM_READY` → `RPHUB_IMPORT_READY`；`RPH_FORUM_IMPORT_CARD`（ArrayBuffer ≤100MB）→ 解析 PNG 卡并导入；主题经 `RPHUB_THEME`/`RPH_FORUM_THEME_REQUEST` 同步。
- 小说页：`REQUEST_RPHUB_API_SETTINGS` → 回传 provider/apiKey/customApiUrl 列表。

### 5.10 更新检查
- `update-check.js`：页面可见时每 20s `GET {api}/v1/version?current=<5位id>`；`updateAvailable && latest>current && >已通知` → 派发 `rphub:update-available`；公告弹窗读 `localStorage['roleplay_hub_update_id']`，未读则显示并 10s 倒计时；远程事件显示“发现新版本，手动刷新页面后更新”。

---

## 6. 边界情况与易错点（复现必须照抄）

1. **宏/占位符**：`{{user}}`（大小写不敏感、允许空格 `{{\s*user\s*}}`）替换为当前用户名（`app.js:532-533`）；`{{char}}` **未**实现。HTML 模板里变量语法是另一套 `{{path}}`（见 §2.13），两者别混。
2. **消息正文结构**：`content` 可能含 `<cot>`/`<thinking>` 与 `<ui_template_updates>`；显示只取 `parseCot(content).main`，编辑只改 main 并保留原 CoT/变量块；复制/发回模型要去掉变量块、`[M#]`、`<next_response>`、`<ui_template_state_context>`、被禁用的生图标记。
3. **`image###Tag###`**：Tag 内不能换行、不能含 `###`/`image###`；流式未写完的 `image###` 会被 `processMainContent` 截掉。
4. **正则语义**：`placement` 1=用户、2=AI；`markdownOnly`（仅用户可见）与 `promptOnly`（仅AI可见）互斥，**都不勾 = 仅用户可见**（`app.js:3231-3233`）；`depth` 从消息数组末尾算起（`array.length-1-index`）；不含 `<`/`>`/``` 的正则只作用于“未保护文本”（HTML/代码/CoT 受保护），整条匹配的包裹只执行一次；`NAI画图正则` 永远排最后并使用专用 image 正则。`/pattern/flags` 写法会解析 flags；`(?s)(?i)(?m)` 会被转成 flags。
5. **世界书正则**：`/pattern/flags` 强制加 `i`、去 `g`，`\p{...}` 加 `u`；扫描文本只取最近 N 条消息 `content` 拼接（换行连接）；`depth` 插入点只数 user/assistant；`user_top/assistant_top` 是“前插”到消息内容开头。
6. **预设注入位置**：`破限` 留 system；`文风（抗八股）` 被剥壳后注入 `<next_response>`；`role:user/assistant` 预设作为消息插入在角色定义之前；COT 预设内容动态生成且随设置变化。
7. **抗截断**：只重试“完全空回”且无 reasoning/工具，最多 3 次请求；COT 预设被临时禁用（不改写用户开关）；Gemini 输入混淆会用零宽字符前缀，复现时不要当成乱码。
8. **工具**：`parallel_tool_calls:false`；force 才 `tool_choice:'required'`；单轮最多 5 项、最多 4 轮自动续写；工具结果消息不进聊天历史（仅当轮请求）；随机数用拒绝采样，`choices` 去重、与 min/max 互斥。
9. **记忆**：楼层≠轮次（一次用户+AI 通常 2 楼 1 轮）；保留楼层 10–50 步长 2；增强召回固定 10 条、阈值 0.48，与工具“检索条数”无关；二次压缩 25 轮 + 每 5 轮一组，空轮跳过、缺总结必须补录；合并记忆保留 `sourceMemories` 供召回；删除/编辑/重roll/分支都要同步记忆与 `[M#]` 编号。
10. **上下文无硬截断**：`settings.contextSize=1000000` 是残留字段，没有任何按 token/字数裁剪历史的逻辑（除记忆替换）。长对话会把全部（合并后）消息发给模型——复现时必须明确是否照搬该行为。
11. **发送/流式**：`stream` 与 `temperature=1.0` 会在加载/启动时被强制；温度控件只在快捷面板。非流式响应、SSE 缺空行、`data:` 多行 JSON 都有兼容；120s 无输出才超时。
12. **删除约束**：只能删“最后一条用户消息 + 其后连续 assistant/system”；删用户轮会带走整轮。AI 消息单独删除不受支持（只能删整轮或重新生成截断）。
13. **重新生成语义**：最后是用户消息=续写（只删当前轮记忆）；最后是 AI=截断重写（删该轮记忆、裁剪 UI 变更）。
14. **分支**：`main` 名称/删除受限；分支作用域键 `uuid__branch__id`；切分支前必须保存当前分支；删除分支子级顺延父级；分支名 ≤30 字。
15. **云备份**：密钥 16 位、O→0、I/L→1；1GB 上限；15 天；恢复替换卡会删本机多余分支；恢复期写保护 + 完成后刷新。
16. **更新检查**：版本号是 5 位数字；公告 id 10226；20s 轮询；本地已读 id 存 localStorage。
17. **主题**：key `rphub-appearance`，值 `light|dark`，写到 `<html data-app-theme>`；本地 iframe 同步。
18. **主题/样式**：移动端禁用 backdrop-filter 与滚动条；消息操作栏移动常显、桌面 hover；`hover:none` 时操作按钮用 `.is-tapped` 反馈。
19. **Sortable**：同一时刻只有一个实例；拖完先还原 DOM 再更新数组，避免 Vue key 错乱。
20. **HTML/面板**：正文若以 HTML 开头或含 HTML 代码块/脚本面板，会走 iframe 沙箱分支；`data-slash` 点击转发为卡片交互；iframe 高度由注入脚本自适应。
21. **UI 模板协议**：单模板直接对象/数组，多模板必须 `[{id,variables}]` 且 id 逐字复制；只允许已定义字段或说明允许的新增键；数组要输出完整数组；`changeLog` 最多 50 条；失败会生成修正提示注入下一轮。
22. **Token 统计**：输入 token 显示会减去缓存读取；额度查询走 `{apiRoot去/v1}/api/log/token`，匹配窗口 ±120s；部分流式也记账。
23. **首次启动**：默认用户名为占位串时强制弹设置；启动强制 `temperature=1.0`、`stream=true`、`contextSize=1e6`；`第二/第三人称` 预设按 `user.person` 自动启用。
24. **角色卡字段**：`scenario` 已废弃并删除；旧索引聊天键会迁移到 uuid；PNG 头像整图入库（显示转 blob URL）。
25. **文件名/链接**：导出的聊天文件名带 `_全部分支_chat.jsonl`；“获取API”链接 `https://sta1n.ai/keys`，“获取生图密钥”链接 `https://www.qianxun1688.com/links/D07F549B`；Tavily 获取链接 `https://www.tavily.com/`。

---

## 7. 明确不属于本聊天清单（另审）

- `character/index.html`（角色卡工坊）：AI 生成/修改角色卡、画师串、兼容模式重试、角色卡详情编辑与导出等——**角色卡生成器审计**。
- `novel/index.html`（小说生成与编辑）：小说生成、章节编辑、搜索替换、从主应用请求 API 配置等——**小说生成器审计**。
- `presence-server/*`（可选更新检测/在线服务）：与聊天后端无关。
- 主应用只通过 iframe + postMessage 集成上述页面；聊天功能本身不依赖它们。
