# 预设内嵌运行时逐项依赖表（Meowssiah-2.1.6）

> 研究阶段文档。只做只读研究，未修改 `src/` 与 `docs/` 其它文件。
>
> **来源标记**
> - `[PRESET]` = `C:\Users\shuang\Downloads\Meowssiah-2.1.6.json`（617962 B，本轮实测）
> - `[ST-SRC]` = `D:\RPNow\_ref\SillyTavern\public`
> - `[TH-PKG]` = `D:\RPNow\tavern-helper-real.zip` → `JS-Slash-Runner-main`（manifest `version 4.12.1`）
>
> **行号约定**：`注入器:12` = `extensions.tavern_helper.scripts[0].content`（701 B）；`菜单:123` = `extensions.tavern_helper.scripts[1].content`（165086 B，3096 行）；`折叠栏:123` = `extensions.regex_scripts[1].replaceString`（10373 B）；`神谕面板:123` = `extensions.regex_scripts[5].replaceString`（36300 B）；`FRP:123` = `extensions.SPreset.FinalRequestProcessing.script`（102500 B，2963 行）。
>
> **方法**：用 Node 脚本（`$env:TEMP\dsh-pr2\extract.cjs`）从预设导出脚本与 `replaceString`，再用 `grep`/正则统计计数并抽样精读；未整份打印。所有 URL 原样抄录。

---

## 0. 先校正三处前提

1. `extensions.regex_scripts` 实际有 **8 条**，其中只有 2 条的 `replaceString` 是完整 HTML 文档：`[1] 思维链折叠 2.5 by To: mato`（10373 B）与 `[5] 前端综合面板`（36300 B）。其余 6 条是纯文本/空替换（`[0][2][3][4][6][7]`）。
2. `extensions.SPreset.RegexBinding.regexes`（7 条）是 `extensions.regex_scripts`（8 条）的**真子集**（id 全同，后者多出 `1c7de08e-90f5-4b98-b104-003aa6b6ed69`「修剪小总结」）。
3. 内嵌 loader 不止一份：`scripts[0]` 是新版；`prompt_order[0].xiaobai_ext.scheduledTasks[0].commands`（317 B）还藏着一份**旧版** loader，URL 不同（见 §1.3）。

---

## 1. 两张内嵌脚本概览

### 1.1 `scripts[0]`「SPreset」`[PRESET]` 全文（701 B，原样）

```js
function injectScript(iframe, id, url) {
  /* inject a script into the parent window */
  let parent = iframe.parentElement;
  // go up until body
  while (parent && parent.tagName !== 'BODY') {
    parent = parent.parentElement;
  }
  console.log(parent);
  // skip if script already exists
  if (document.getElementById(id)) {
    console.log('script already exists');
    return;
  }
  const script = document.createElement('script');
  script.id = id;
  script.src = url;
  parent.appendChild(script);
}


$(() => {
  SillyTavern.extensionSettings.regexBinding_scriptId = getScriptId();
  injectScript(window.frameElement, getScriptId(), 'https://jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js');
});
```

元数据：`type=script, enabled=true, name=SPreset, id=f0801c1a-3b0f-4e1c-82b6-f0f8990fbde6`；`info` 是一段 7674 B 的「Regex Preset Binder」说明页 HTML（只在 TH 脚本信息面板展示，不执行）；`button.enabled=false`。

### 1.2 `scripts[1]`「菜单」结构 `[PRESET]`

- 引导 IIFE `bootCatGodOracle()`（`菜单:34`），常量 `VERSION='1.4.6'`（`菜单:37`）。
- `resolveHostWindow()`（`菜单:3048-3065`）：从 `window` 向上最多 10 层，取**最顶层的、同时有 `document` 与 `SillyTavern` 的窗口**；失败回退 `window.top`（try/catch），再退回 `window`。
- 自注入：若 `W !== window`，把 `CatGodOracleRuntime.toString()` 包成 `<script>` 追加到 `W.document.head`（`菜单:3084-3093`），并把自己 iframe 的 `frameElement` 隐藏（`菜单:3069`）。
- 工厂 `CatGodOracleRuntime(W, VERSION)`（`菜单:39-3035`）在宿主窗口 `W` 的 realm 内运行，产出全局 `W.CatGodOracle`（`菜单:3030`，成员见 §2.6）。
- 版本去重：已有实例版本 ≥ 当前则只调 `ensureMounted()` 并 return；否则 `destroy()` 旧实例（`菜单:3074-3081`）。

### 1.3 旧版 loader 副本 `[PRESET]`（`prompt_order[0].xiaobai_ext.scheduledTasks[0].commands`）

```js
<<taskjs>>
function injectScript(iframe, id, url) {
  const script = document.createElement('script');
  script.id = id;
  script.src = url;
  document.body.appendChild(script);
}
injectScript(window.frameElement, "spreset_inject", 'https://starowo.github.io/regex_bind/inject.js');
<</taskjs>>
/echo SPreset Loaded
```

与 `scripts[0]` 的差异：**忽略 `iframe` 参数**，直接注入**当前文档**（`document.body`），不是父窗口；id 固定 `"spreset_inject"`；URL 是 `starowo.github.io`。该字段位于 `prompt_order[0]`（非 `extensions`），由 `<<taskjs>>` 宏执行，属于另一条（更早的）注入链。

---

## 2. 逐项依赖表

### 2.1 `scripts[0]` 注入器逐项

| 依赖 | 位置 | 调用形式 | ST/TH 对应实现 | RPNow 需提供 |
|---|---|---|---|---|
| `getScriptId()` | `注入器:22-23` | 全局函数调用，无参数 | **预设内未定义**（全库仅此 2 处调用）。`[TH-PKG]` `src/iframe/predefine.js` 把 `TavernHelper._bind` 逐项 `bind(window)` 并去掉前导 `_`，`_getScriptId` → `getScriptId`；dist 中 `bI`/`yI`：要求 `this.frameElement.id` 以 `TH-script--` 开头并 `replace(/TH-script--.+--/,'')` | 在脚本 iframe 全局提供 `getScriptId()`，返回当前脚本 uuid；或显式声明不支持 |
| `$()`（jQuery ready） | `注入器:21` | `$(callback)` | `[TH-PKG]` `src/iframe/script_iframe.ts:11` 先注入 `parent_jquery_url`，再注入 `predefine.js` | 脚本 iframe 内提供 jQuery `$`，且 ready 回调可用 |
| `window.frameElement` | `注入器:23` | 读取 iframe 元素 | `[TH-PKG]` `Iframe.vue`（dist `:794`）设 `id/name = TH-script--${name}--${id}`；`predefine.js:2` 也读它 | 脚本 iframe 必须真实嵌在宿主文档中，`frameElement` 非 null，且 `id` 带脚本 uuid |
| `iframe.parentElement` 上溯到 `BODY` | `注入器:3-7` | DOM 遍历 | 无（纯 DOM） | 宿主文档有 `BODY`，iframe 的父链可达 `BODY` |
| `document.getElementById(id)`（去重） | `注入器:10` | 在当前 iframe 文档查重 | 无 | 注意：查的是 **iframe 文档**，而被注入的 `<script>` 在**父文档**，跨文档查重无效（见 §4.1） |
| `document.createElement('script')` + `script.src` + `parent.appendChild` | `注入器:14-17` | 往父文档注入外链 `<script>` | 无 | 允许向宿主文档动态插 `<script src>`（安全上应默认阻断，见 §4） |
| `SillyTavern.extensionSettings` 写入 | `注入器:22` | `SillyTavern.extensionSettings.regexBinding_scriptId = getScriptId()` | `[ST-SRC]` `script.js:293-296` 顶层 `SillyTavern = {libs, getContext}`，**没有** `extensionSettings`；`extensionSettings` 在 `getContext()` 返回值里（`st-context.js:201`）。`[TH-PKG]` `predefine.js:26-34` 在脚本 iframe 内定义 `window.SillyTavern` getter = `{...getContext(), getContext}`，故 `extensionSettings` 是父上下文 `extension_settings` 的**同一对象引用** | 脚本 iframe 内提供 `SillyTavern.extensionSettings`（与上下文 `extensionSettings` 同引用），或提供等价写入通道 |
| 外链 URL | `注入器:23` | `https://jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js` | 无 | 默认阻断；若要放行需可配置白名单 + SRI（见 §4） |
| 旧版外链 URL | `prompt_order[0].xiaobai_ext.scheduledTasks[0].commands` | `https://starowo.github.io/regex_bind/inject.js` | 无 | 同上 |

**为什么必须注入到顶层窗口**：`[PRESET]` 注释明说「inject a script into the parent window」；`[TH-PKG]` 脚本 iframe 是 `Teleport to body` 的临时 iframe（`Script.vue:28-38`），会随脚本重载/角色切换被销毁，且 iframe 内 `window.parent` 才是挂着 `SillyTavern` 的宿主文档。注入到父文档后脚本生命周期与宿主一致。

**ST/TH 里的执行机制**：`[TH-PKG]` 全局脚本在独立 iframe 中跑：`Iframe.vue`（dist `:794`）→ `id/name=TH-script--<name>--<id>`；`src/iframe/script_iframe.ts:5-22` 用 `createSrcContent` 构造 srcdoc，依次加载 `parent_jquery_url`、`predefine.js`、log.js，把脚本内容（剥掉首尾 ` ``` ` 围栏）放进 `<script type="module">`。`predefine.js` 提供 `_`（lodash）、`$`（jQuery）、`TavernHelper` 系列绑定、以及 `window.SillyTavern` shim。

### 2.2 `scripts[1]` 主机上下文 API（`W.SillyTavern` / `ctx`）

`getCtx()`（`菜单:232-238`）唯一入口：`W.SillyTavern.getContext()`。

| 依赖 | 位置 | 调用形式 | ST 对应实现 | RPNow 需提供 |
|---|---|---|---|---|
| `W.SillyTavern.getContext()` | `菜单:234` | 方法调用 | `[ST-SRC]` `script.js:293-296`（全局）+ `st-context.js:110-260`（上下文字段） | 顶层 `SillyTavern.getContext()` 返回上下文对象 |
| `ctx.chat` | `菜单:405,424,644,764` | 数组读取 | `st-context.js`（`chat` 字段） | 当前聊天消息数组 |
| `ctx.chatMetadata` | `菜单:168,180,421` | 对象读写 | `st-context.js:135`（= `chat_metadata`） | 聊天元数据对象 |
| `ctx.saveMetadataDebounced()` | `菜单:171,431` | 方法调用 | `st-context.js:136`；`[ST-SRC]` `scripts/extensions.js:89` | 保存元数据方法 |
| `ctx.getCurrentChatId()` / `ctx.chatId` | `菜单:242` | 方法或字段 | `st-context.js:128,125` | 当前聊天 id |
| `ctx.characterId` | `菜单:252-253` | 字段 | `st-context.js:123`（= `this_chid`） | 当前角色 id |
| `ctx.mainApi` | `菜单:267` | 字段 | `st-context.js:200`（= `main_api`） | 当前 API 类型 |
| `ctx.chatCompletionSettings` | `菜单:263,316,677` | 字段 | `st-context.js:227`（= `oai_settings`） | 当前预设设置对象 |
| `settings.prompts` | `菜单:264,271,2862` | 数组读取 | `[ST-SRC]` `scripts/openai.js:377` | 当前预设的 prompt 条目数组（含 `identifier/name/content/role/marker/injection_position/injection_depth`） |
| `settings.prompt_order` | `菜单:250,255-257` | 数组读取 | `[ST-SRC]` `scripts/openai.js:378`；`PromptManager.js:1208` | 角色/预设的 prompt 顺序表（`character_id`、`order[].identifier`、`order[].enabled`） |
| `settings.preset_settings_openai` | `菜单:266` | 字段 | `[ST-SRC]` `scripts/openai.js:412` | 当前预设名 |
| `settings.openai_max_context` | `菜单:693` | 字段 | `[ST-SRC]` `scripts/openai.js:361` | 上下文上限 |
| `ctx.saveSettingsDebounced()` | `菜单:328` | 方法调用 | `st-context.js:132`；`[ST-SRC]` `script.js:470` | 保存设置方法 |
| `ctx.getTokenCountAsync(text)` | `菜单:589` | 异步方法 | `[ST-SRC]` `scripts/tokenizers.js:443` | 分词计数 |
| `ctx.getTokenizerModel()` | `菜单:679` | 方法调用 | `[ST-SRC]` `scripts/tokenizers.js:569` | 分词器型号 |
| `ctx.eventSource` | `菜单:801` | `.on/.removeListener` | `[ST-SRC]` `scripts/events.js:113`（EventEmitter） | 事件总线，含 `on(type,fn)` / `removeListener(type,fn)` |
| `ctx.eventTypes` / `ctx.event_types` | `菜单:802` | 映射表 | `[ST-SRC]` `scripts/events.js:3-111`；`st-context.js:139,223` | 事件名常量表（键为 `GENERATION_STARTED` 等大写名） |
| `ctx.extensionSettings`（回退） | `菜单:328` | `W.SillyTavern.saveSettingsDebounced` 回退 | 顶层 `SillyTavern` 无此字段 | 顶层 `SillyTavern` 建议合并 `getContext()` 字段（RPNow 的 shim 可这样做） |
| `ctx.generate()` | 仅 `神谕面板:891` | 方法调用 | `st-context.js:143`（= `Generate`）；`[ST-SRC]` `script.js:4290` | 触发一次生成 |
| `ctx.getRequestHeaders()` | **未出现** | — | `st-context.js:129`；`script.js:647` | 上下文里有，但内嵌运行时不用 |

### 2.3 `scripts[1]` 事件依赖（`bindStEvents`，`菜单:813-868`）

事件名经 `ctx.eventTypes[name]` 映射成字符串后 `eventSource.on(type, handler)`。下表「ST 事件字符串」见 `[ST-SRC]` `scripts/events.js`。

| 常量名 | ST 事件字符串 | 回调 | 用途 |
|---|---|---|---|
| `GENERATION_STARTED` | `generation_started` | `onGenerationStarted` / `onUsageGenerationStarted` | 记录本次生成模式/纸条/缓存基线；开启用量作业 |
| `GENERATION_STOPPED` | `generation_stopped` | `onGenerationStopped` | 标记 `armed.stopped`、`usageJob.stopped` |
| `GENERATION_ENDED` | `generation_ended` | `onGenerationEnded` / `onUsageEnded` | 收尾：恢复剧场模式、结算用量 |
| `MESSAGE_RECEIVED` | `message_received` | `onMessageReceived` / `onUsageReply` | 投递纸条、自动回剧场、统计回复 token |
| `MESSAGE_SENT` | `message_sent` | 内联 | 清 `lastChatReply` |
| `CHAT_COMPLETION_SETTINGS_READY` | `chat_completion_settings_ready` | `onUsageRequest` | 抓取最终请求体做 token 统计 |
| `STREAM_TOKEN_RECEIVED` | `stream_token_received` | `onUsageStream` | 流式输出本地估算 |
| `IMPERSONATE_READY` | `impersonate_ready` | `onUsageImpersonate` | 统计代入回复 |
| `CHAT_CHANGED` | `chat_id_changed` | `onChatChanged` | 切聊天：清状态、恢复元数据、重挂 inline、门禁 |
| `SETTINGS_UPDATED` | `settings_updated` | `presetChanged` | 刷新预设视图（debrief 120ms） |
| `OAI_PRESET_CHANGED_AFTER` | `oai_preset_changed_after` | 内联 | 强制刷新预设视图 |
| `WORLD_INFO_ACTIVATED` | `world_info_activated` | 内联 | 记录 `W.__catgodLastActivatedWi` 供 Stage1 用 |
| `CHARACTER_MESSAGE_RENDERED` | `character_message_rendered` | `scheduleInline` | 重挂消息内菜单 |
| `USER_MESSAGE_RENDERED` | `user_message_rendered` | `scheduleInline` | 同上 |
| `MESSAGE_DELETED` | `message_deleted` | `scheduleInline` | 同上 |
| `MESSAGE_SWIPED` | `message_swiped` | `scheduleInline` | 同上 |
| `MORE_MESSAGES_LOADED` | `more_messages_loaded` | `scheduleInline` | 同上 |
| `APP_READY` | `app_ready` | `scheduleGate`（门禁） | 预设门控哨兵 |
| `SETTINGS_LOADED_AFTER` | `settings_loaded_after` | `scheduleGate` | 同上 |
| `OAI_PRESET_CHANGED_AFTER` | `oai_preset_changed_after` | `scheduleGate` | 同上 |
| `SETTINGS_UPDATED` | `settings_updated` | `scheduleGate` | 同上 |
| `CHAT_CHANGED` | `chat_id_changed` | `scheduleGate` | 同上 |
| `catgod-oracle:final-request` | （CustomEvent，非 ST 事件） | 内联 `listen(W, ...)` `菜单:822` | 接收 Stage1 最终请求体 |

> 回调签名沿用 ST 的多参数透传（如 `MESSAGE_RECEIVED(messageId, type)`、`WORLD_INFO_ACTIVATED(entries)`）。RPNow 事件总线需支持多参数与 `removeListener`。

### 2.4 `scripts[1]` localStorage 键与数据结构

| 键 | 位置 | 结构（代码 schema，已核对） |
|---|---|---|
| `CatGod_Oracle_State` | `菜单:44,142,159,186,2878` | `{schema:1, mode:'theater'\|'chat', chat:{autoReturn:boolean}, deepThink:boolean, rebuildCache:boolean, note:{text:string, autoClear:boolean}, rev:number, updatedAt:number}`（`normalizeState` `菜单:102-116`） |
| `CatGod_Oracle_UI` | `菜单:45,143,221` | `{dock:'float'\|'message'\|'qr', theme:'light'\|'dark', float:{side:'left'\|'right', y:number}, tab:'status'\|'preset', presetView:'menu'\|'all', inlineOpen:boolean, collapsed:string[], history:string[](≤6)}`（`normalizeUi` `菜单:127-140`） |
| `CatGod_Oracle_Usage` | `菜单:531,543,569,696` | `{id, at, kind, status:'sending'\|'streaming'\|'done'\|'stopped'\|'failed', input, messages, tools, output, reasoning, live:boolean, maxContext, tokenizer}`（`loadUsage` `菜单:542-563`） |

- 访问方式：`storage = W.localStorage`（`菜单:83`），`readJson/writeJson`（`菜单:85-100`），并监听宿主的 `storage` 事件同步（`菜单:2883-2885`）。
- 两个 HTML 文档读 `window.top.localStorage.getItem('CatGod_Oracle_UI')`（`折叠栏:157`、`神谕面板:519`）。
- 键名**无命名空间前缀**，直接落在宿主 origin 上，跨预设/跨聊天共享（见 §4.3）。

### 2.5 `scripts[1]` postMessage / CustomEvent

| 方向 | 通道 | 位置 | 内容 |
|---|---|---|---|
| 控制台 → 所有子 iframe | `child.postMessage(msg,'*')` | `菜单:1876-1891`（`broadcastTheme`） | `{type:'catgod-oracle:theme', theme:'light'\|'dark'}`；递归 `W.frames`，深度 ≤3 |
| 控制台 → 本窗口 | `W.dispatchEvent(new W.CustomEvent(...))` | `菜单:213` | `catgod-oracle:change`，`detail:{state,prev,reason}` |
| 控制台 → 本窗口 | 同上 | `菜单:335` | `catgod-oracle:prompts`，`detail:{changes}` |
| 控制台 → 本窗口 | 同上 | `菜单:571` | `catgod-oracle:usage`，`detail:{usage}` |
| 控制台 → 本窗口 | 同上 | `菜单:1893` | `catgod-oracle:theme`，`detail:{theme}` |
| Stage1 → 控制台 | `hostWin.dispatchEvent(new hostWin.CustomEvent(...))` | `FRP:2952-2957` | `catgod-oracle:final-request`，`detail:{at,messages,tools}` |

> `catgod-oracle:usage` 是 **CustomEvent**，不是 postMessage（`grep` 计数 `postMessage=2`，全部在 `broadcastTheme`）。`type:'button'` / `type:'search'` 是 DOM 属性，与 postMessage 无关。

### 2.6 `scripts[1]` DOM 依赖

| 依赖 | 位置 | 说明 |
|---|---|---|
| `W.document` / `D.body` / `D.head` | `菜单:42,1407,2165` | 宿主文档 |
| `#chat`、`.mes`、`.mes_block` | `菜单:2511-2518` | `lastMessageBlock()` 取最后一条消息的 `.mes_block` 挂 inline 菜单 |
| `#send_form` | `菜单:2668,2725,2726` | 加 `catgod-chat-mode` class；QR 回退栏挂载点 |
| `#send_textarea` | `菜单:2727-2737` | 聊天模式切换 placeholder（`和小猫之神本体聊聊…（聊天模式）`） |
| `#qr--bar` / `.qr--buttons` | `菜单:2675,2680` | QR 栏挂载点；`[ST-SRC]` `scripts/extensions/quick-reply/src/ui/ButtonUi.js:62`（`id='qr--bar'`）、`:83`（`.qr--buttons`） |
| `#catgod-oracle-qrbar`（回退） | `菜单:50,2696-2705` | 无 QR 栏时 `prepend` 到 `#send_form` |
| `#completion_prompt_manager` | `菜单:2107` | MutationObserver 观察目标 |
| `#completion_prompt_manager_list`、`[data-pm-identifier]`、`.prompt-manager-toggle-action` | `菜单:344-355` | 同步开关态；`[ST-SRC]` `scripts/openai.js:687`（listIdentifier）、`scripts/PromptManager.js:1740`（data-pm-identifier） |
| `body.qra-enabled` | `菜单:2607,2676` | QR Assistant 启用标志 |
| `W.qrAssistantExtensionApi` | `菜单:2658-2665` | 数组，注册 `{dom_id:'catgod-oracle-qr-button', group_name:'小猫之神', button_name:'打开神域控制台'}` |
| `W.quickReplyMenu.applyWhitelistDOMChanges()` | `菜单:2687` | QR Assistant 白名单刷新 |
| `#catgod-oracle-global-style` | `菜单:48,1402-1410` | 注入全局 `<style>`（含 `@font-face`、`.catgod-qr-btn`、`#send_form.catgod-chat-mode`） |
| `<catgod-oracle-layer data-swipe-ignore>` | `菜单:2127-2165` | 自定义元素 + `attachShadow({mode:'open'})`，z-index 10010，挂 `D.body`；含 `.ball`/`.scrim`/`.pop`/`.toast` |
| `<catgod-oracle-inline data-swipe-ignore>` | `菜单:2488-2508` | 自定义元素 + shadow root，挂到最后 `.mes_block` |
| `#catgod-oracle-qr-button` | `菜单:49,2610-2632` | `<div class="qr--button menu_button catgod-qr-btn" role="button" tabindex="0">` |
| `W.CatGodOracle` | `菜单:3030` | 全局 api（成员见下） |

`window.top.CatGodOracle` 成员（`Object.freeze`，`菜单:2962-3026`）：
`version, storageKey, state(get), dock(get), theme(get), active(get), usage(get), setTheme, getState, setState, setMode, toggleMode, setDeepThink, rebuildCache, setNote, reload, subscribe, getPreset, setPromptEnabled, open, close, toggle, setDock, ensureMounted, diagnose, destroy`。

### 2.7 `scripts[1]` 预设门控与 DSL

| 依赖 | 位置 | 调用形式 | 说明 |
|---|---|---|---|
| `chatCompletionSettings.prompts` | `菜单:2862` | 直接读数组 | **不用** `getSelectedPreset` / `readPresetExtensionField`；直接扫当前预设的 `prompts` |
| `<<<\|catgodml\|enableMenu>>>` | `ENABLE_SOURCE` `菜单:53,2864` | 正则 `ENABLE_SOURCE` 测试 `prompt.content`（先剥 `{{// ...}}` 注释）或 `prompt.name` | 门控：命中则 `activate()`，否则 `deactivate()` |
| `<<<\|catgodml\|(menu\|radio)[:：]分组[:：]名称>>>` | `MARKER_SOURCE` `菜单:52,274,284` | 正则提取 `kind/group/label` | 生成预设开关视图的菜单/单选分组 |
| `<<<\|catgodml\|[^>]*>>>` | `DIRECTIVE_SOURCE` `菜单:54,276` | 正则剥除 | 显示名称前剥掉所有指令 |
| `prompt.spreset_hidden` | `菜单:281` | 字段 | SPreset 隐藏条目对菜单同样隐藏 |
| `prompt.marker` + `FORCE_TOGGLE` | `菜单:55,288,295` | 集合 | 标记型条目默认可开关 |
| `chatCompletionSettings.prompt_order` | `菜单:249-259,265` | `findOrder` | 先按 `characterId`，再按 `100001`、`100000` |
| `saveSettingsDebounced()` + `patchPromptManagerDom` + `promptManager.render(false)` | `菜单:314-395` | 见下 | 写入开关后保存并重渲染 prompt manager |

切换预设时的卸载（`deactivate`，`菜单:2896-2928`）：移除 popover、清 `armed/lastChatReply`、执行全部 `cleanups`（事件监听）、断 `MutationObserver/ResizeObserver`、清 8 个计时器、`stopInline`、`stopQr`、移除 `layer.host`、恢复 textarea placeholder、移除全局 `<style>`。**门禁监听（`gateCleanups`）保留**，切回命中 `enableMenu` 的预设自动复活。

### 2.8 `scripts[1]` 其它宿主能力

| 依赖 | 位置 | 对应实现 | RPNow 需提供 |
|---|---|---|---|
| 动态 `import('./scripts/openai.js')` | `菜单:363-382` | 先找 `script[type="module"][src]` 里 `src` 以 `script.js` 结尾的标签，用 `new W.URL(path, main.src)` 解析，再 `new W.Function('url','return import(url)')` | 宿主文档里有 `<script type="module" src=".../script.js">`，且 `scripts/openai.js` 可 import，导出 `promptManager`（`[ST-SRC]` `openai.js:535,682`） |
| `promptManager.render(false)` | `菜单:389` | `[ST-SRC]` `PromptManager.js` | 模块导出 `promptManager` 且可 `render` |
| `W.CSSStyleSheet` + `adoptedStyleSheets` | `菜单:1390-1400` | 构造样式表 | 支持 `CSSStyleSheet`/`adoptedStyleSheets`（失败回退 `<style>`） |
| `W.MutationObserver` | `菜单:2109,2523,2636` | DOM 观察 | 提供 |
| `W.ResizeObserver` | `菜单:2886-2889` | 提供 | 提供（可选） |
| `W.visualViewport` | `菜单:2880-2881,3008` | 提供 | 提供（可选） |
| `W.matchMedia('(prefers-reduced-motion: reduce)')` | `菜单:70-72` | 提供 | 提供 |
| `W.requestAnimationFrame` / `cancelAnimationFrame` | `菜单:67,2643` | 提供 | 提供 |
| `W.setTimeout/clearTimeout/setInterval/clearInterval` | `菜单:65-66,2892,2914` | 提供 | 提供 |
| `W.frames` 递归遍历 | `菜单:1878-1891` | 提供 | 提供 |
| `W.Function` / `W.URL` | `菜单:369-370` | 提供 | 提供 |
| `W.dispatchEvent` / `W.CustomEvent` | `菜单:213,335,571,1893` | 提供 | 提供 |
| `W.localStorage` | `菜单:83` | 提供 | 提供 |
| 自定义元素 + `attachShadow({mode:'open'})` | `菜单:2127,2490` | 提供 | 提供 |
| `Element.animate` | `菜单:940-943` | 提供 | 可选 |

### 2.9 `折叠栏`（`regex_scripts[1]`，10373 B）对宿主的调用点

| 依赖 | 位置 | 调用形式 | 说明 |
|---|---|---|---|
| `window.top.CatGodOracle.theme` | `折叠栏:154-157` | 属性读取 | 失败回退 `window.top.localStorage.getItem('CatGod_Oracle_UI')` |
| `window.top.localStorage` | `折叠栏:157` | `getItem` | 主题字符串 |
| `message` 监听 | `折叠栏:162-164` | `window.addEventListener('message', ...)` | 收 `catgod-oracle:theme` 后 `apply(theme)` |
| `window.parent.postMessage` | `折叠栏:250-252` | `{type:'resizeIframe', height:document.body.scrollHeight}`，`'*'` | 高度自适应（**宿主无消费者**，见 §3.1） |
| `$1` 捕获组注入 | `折叠栏:178` | `<div class="cat-content-inner">$1</div>` | 正则捕获的 `<think_nya>` 内容插入 |
| `formatParagraphs()` | `折叠栏:240-247` | `textContent` → 按行拆 → `innerHTML = <p>…</p>` | **innerHTML 重建，存在 XSS 面**（见 §4.4） |
| 外链图片 | `折叠栏:172,184-195` | `files.catbox.moe/6bjhoo.png` + 10 个 `i.postimg.cc/...png` | 随机头像 |
| 无 ST API 调用 | — | — | 不调 `getContext`/`generate`/`send_textarea` |

### 2.10 `神谕面板`（`regex_scripts[5]`，36300 B）对宿主的调用点

| 依赖 | 位置 | 调用形式 | 对应实现 | 说明 |
|---|---|---|---|---|
| `window.top.CatGodOracle.theme` / `window.top.localStorage` | `神谕面板:516-519` | 属性/`getItem` | 同 §2.9 | 主题跟随 |
| `message` 监听 | `神谕面板:524-526` | `addEventListener('message')` | — | 收 `catgod-oracle:theme` |
| `window.top?.SillyTavern \|\| window.parent?.SillyTavern` | `神谕面板:615-622` | `getSillyTavern()` | `[ST-SRC]` `script.js:293-296` | 取宿主全局 |
| `st.getContext()` | `神谕面板:808,827,890` | 方法 | `st-context.js` | 上下文 |
| `context.extensionSettings.Astro.optionMode / directSend` | `神谕面板:809-813` | 读 | `st-context.js:201` | 三者模式：`send/replace/append`；兼容旧 `directSend` 布尔 |
| `context.extensionSettings.Astro.optionMode = ...` | `神谕面板:829-832` | **写** | 同上 | 直接改宿主 `extension_settings` |
| `st.saveSettingsDebounced()` / `context.saveSettingsDebounced()` | `神谕面板:833-834` | 方法 | `script.js:470` | 保存 |
| `window.parent.postMessage({type:'resizeIframe',height})` | `神谕面板:629-634` | postMessage | — | 高度自适应 |
| `#send_textarea` | `神谕面板:860` | `parentDocument.getElementById` | `[ST-SRC]` `index.html:8106`（`<textarea id="send_textarea">`） | 目标输入框 |
| `HTMLTextAreaElement.prototype` 的 `value` setter | `神谕面板:874-877` | `Object.getOwnPropertyDescriptor(...).set.call(textarea, nextValue)` | — | 绕过 Vue/框架劫持写入 |
| `parentWindow.Event` + `dispatchEvent('input'/'change')` | `神谕面板:878-880` | 派发冒泡事件 | — | 触发宿主绑定 |
| `textarea.focus()` / `setSelectionRange` | `神谕面板:881-882` | 方法 | — | 聚焦并移动光标 |
| `context.generate()` | `神谕面板:891` | 方法 | `st-context.js:143`；`script.js:4290` | 直接发送 |
| `#send_but` `.click()` | `神谕面板:893-895` | DOM 点击 | `[ST-SRC]` `index.html:8122` | `generate` 不可用时的回退 |
| `removeOwnIframe()` | `神谕面板:843-855,906` | 遍历 `window.parent.document.querySelectorAll('iframe')`，找 `contentWindow===window` 移除 | — | 关闭自身 iframe |
| `$1` 捕获组注入 | `神谕面板:531` | `<template id="raw-data">$1</template>` | — | 模型输出原文 |
| 外链字体/头像 | `神谕面板:11,535` | `files.catbox.moe/0kgfu8.ttf`、`y9gi00.png` | — | CutieFont、头像 |

### 2.11 附加：Stage1（SPreset `FinalRequestProcessing`）↔ Stage2（控制台）契约

两者都内嵌在预设里，靠**宿主窗口全局 + `chatMetadata` + CustomEvent** 通信：

| 通道 | 生产方 | 消费方 | 位置 |
|---|---|---|---|
| `W.__catgodPendingCacheRebuild` | 控制台 `rebuildCache()` | Stage1 读 | `菜单:419` / `FRP:78,87` |
| `W.__catgodLastActivatedWi` | Stage1（WI 激活钩子） | 控制台清null / Stage1 读 | `FRP:1248,1254,1357` / `菜单:448` |
| `W.__catgodFallbackLedger[chatId]` | Stage1 | Stage1（缓存账本） | `FRP:2175-2191` |
| `W.__catgodFinalSentPayload` | Stage1 | （诊断用） | `FRP:2952` |
| `ctx.chatMetadata.catgod_oracle.oracleState` | 控制台写 | Stage1 读 | `菜单:170` / `FRP:65` |
| `ctx.chat[i].extra.catgod_oracle` | Stage1 写 | Stage1 读 | `FRP:2203,2357` |
| `catgod-oracle:final-request` CustomEvent | Stage1 `dispatchEvent` | 控制台 `listen(W,…)` | `FRP:2953-2957` / `菜单:822` |
| `<run_tool_replacement>` 标记 | 预设 prompt | 双方检测 | `FRP:2` / `菜单:662,666` |

---

## 3. 双向通信协议时序

### 3.1 控制台 ↔ 消息 iframe（主题 / 高度）

```
控制台(顶层 W)                          消息 iframe (折叠栏/神谕面板)
      |                                          |
      |-- postMessage({type:'catgod-oracle:theme',|
      |     theme}, '*') 递归 W.frames  -------->|--> addEventListener('message')
      |                                          |    apply(theme) -> html[data-theme]
      |                                          |
      |<-- postMessage({type:'resizeIframe',      |
      |     height}, '*')  -----------------------|
      |   （ST/TH 均无此消息的消费者；            |
      |     TH 用 adjust_iframe_height.js 自动量 |
      |     body.scrollHeight 写 frameElement）  |
```

- 主题：子 iframe **加载时读一次** `window.top.CatGodOracle.theme`，失败回退 `localStorage.CatGod_Oracle_UI.theme`；之后只跟 `message`。
- 高度：子 iframe 在 `DOMContentLoaded`/折叠/`resize`/`ResizeObserver`/`document.fonts.ready` 后发 `resizeIframe`；**RPNow 若实现该消息可直接设 iframe 高度，否则依赖宿主自动测高**。

### 3.2 神谕面板「选一条回应 → 填入输入框 → 发送」

```
模型输出 <options>...<option>文本</option>...</options>
  → 显示层正则(regex[5]) 把整段替换成 ```html 围栏文档
  → TH 扫 pre>code，isFrontend 命中，包 <div class=TH-render> + <iframe id=TH-message--… srcdoc=…>
  → 面板 parseAndRender(): 提取 <comment>/<summary>/<options>，渲染按钮
  → 用户点第 N 条 → handleSelect(text, button)
      1) parentDocument.getElementById('send_textarea')
      2) optionMode:
         send     : nextValue = text
         replace  : nextValue = text
         append   : nextValue = currentValue + 分隔符 + text
      3) 用 HTMLTextAreaElement.prototype 的 value setter 写入（绕过框架劫持）
      4) dispatchEvent(new parentWindow.Event('input',{bubbles:true}))
         dispatchEvent(new parentWindow.Event('change',{bubbles:true}))
      5) textarea.focus(); setSelectionRange(len,len)
      6) optionMode==='send':
            context.generate()  优先
            else #send_but.click()
         否则只提示“已填入/已追加”
      7) 收尾:
         有 <comment>/<summary> → 隐藏选项区，保留手札
         只有选项 → removeOwnIframe() 遍历父文档 iframe 移除自己
```

模式切换按钮 `directSendToggle` 循环 `send → replace → append`，并把 `optionMode`/`directSend` 写入 `extensionSettings.Astro` 后 `saveSettingsDebounced()`。

### 3.3 折叠栏

`toggleCollapsible()` → 展开/收起 → `updateIframeHeight()`（发 `resizeIframe`）；`DOMContentLoaded` 时 `formatParagraphs()`（`$1` 文本按行转 `<p>`）+ 随机头像。

### 3.4 Stage1 → Stage2（请求体回传）

```
用户发送 → Stage1 FinalRequestProcessing 重写 request.messages
        → hostWin.__catgodFinalSentPayload = {at,messages,tools}
        → hostWin.dispatchEvent(new CustomEvent('catgod-oracle:final-request',{detail}))
        → 控制台 listen(W,'catgod-oracle:final-request') → countRequest(final) 精确覆盖预计数
```

---

## 4. 安全边界与宿主隔离建议

| # | 风险 | 证据 | RPNow 隔离策略 |
|---|---|---|---|
| 4.1 | **远程脚本注入**：预设可往宿主文档插任意外链 `<script>`，等同任意代码执行 | `注入器:23` `https://jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js`；`prompt_order[0]…commands` `https://starowo.github.io/regex_bind/inject.js` | 默认**阻断**预设产生的远程脚本注入；如需放行，用 host 白名单 + SRI/CSP `script-src`，并记录审计日志 |
| 4.2 | **去重失效导致重复注入**：`document.getElementById(id)` 查的是 iframe 文档，被注入脚本在父文档 | `注入器:10` vs `:17` | 若实现注入，应在**父文档**按 id 去重 |
| 4.3 | **localStorage 全局键污染**：`CatGod_Oracle_*` 无前缀，跨预设/聊天共享，且 `storage` 事件会触发同步 | `菜单:44-45,531`；`折叠栏:157`；`神谕面板:519` | 命名空间前缀（如 `rpnx:<preset>:…`）或按预设/聊天隔离的存储沙箱；提供存储前缀映射 |
| 4.4 | **iframe 内 HTML 文档与 `$1` 的 XSS 面**：`regex` 替换进文档的是**模型可控文本**；`折叠栏:240-247` 用 `innerHTML` 重建；消息 iframe 无 `sandbox` 属性（`[TH-PKG]` `render_Iframe.vue` 仅 `srcdoc`），同 origin 可访问父 DOM | `折叠栏:178,240-247`；`神谕面板:531,641-661` | 渲染前对 `$1` 做 HTML 转义/净化；`iframe` 加 `sandbox="allow-scripts allow-same-origin"`（注意：去掉 `allow-same-origin` 会破坏 `window.parent` 访问，需在“隔离”与“兼容”间显式取舍）；CSP 限制内联脚本 |
| 4.5 | **跨域 `window.top` / `parent.document`**：`resolveHostWindow` 与 `removeOwnIframe` 都依赖同源 | `菜单:3048-3065,3069`；`神谕面板:843-855` | 明确同源策略；跨域时应有 try/catch 回退（代码已有部分 try/catch），RPNow 需保证预设 iframe 与宿主同源或提供受控桥 |
| 4.6 | **父文档遍历与移除**：`removeOwnIframe` 遍历 `window.parent.document.querySelectorAll('iframe')` 并按 `contentWindow` 匹配删除 | `神谕面板:843-855` | 允许但审计；避免给出超出自身 iframe 的删除能力（可改为向宿主发“请关闭我”的消息，由宿主校验身份） |
| 4.7 | **共享设置写入**：`extensionSettings.Astro`、`regexBinding_scriptId` 直接落宿主 `extension_settings` 并触发全量保存 | `神谕面板:829-834`；`注入器:22` | 为预设扩展设置加前缀/配额；`saveSettingsDebounced` 做节流与校验 |
| 4.8 | **隐藏自身 iframe**：`W!==window` 时把 `frameElement` 设为 `display:none` | `菜单:3069` | 允许，但需确保宿主允许脚本隐藏所在 iframe（否则菜单消失） |
| 4.9 | **全局变量污染**：`W.CatGodOracle`、`W.__catgod*`、`W.qrAssistantExtensionApi` | `菜单:3030,419,448,2659` | 命名空间前缀 + 生命周期清理（`destroy` 已删 `CatGodOracle`） |
| 4.10 | **postMessage 目标 `'*'`** | `菜单:1884`；`折叠栏:251`；`神谕面板:632` | 宿主收到消息应校验 `event.origin`/`event.source`；控制台广播应限定目标 origin |

---

## 5. 「通用能力」验收清单

宿主（RPNow）要让预设内嵌运行时跑起来，至少需要提供以下能力。**标 ★ 的是硬依赖（缺了对应功能不可用）**。

### 5.1 全局与上下文

- ★ 顶层 `window.SillyTavern`，含 `getContext()`，返回上下文对象。
- ★ `getContext()` 字段：`chat`、`chatMetadata`、`saveMetadataDebounced`、`getCurrentChatId`/`chatId`、`characterId`、`mainApi`、`chatCompletionSettings`、`extensionSettings`、`saveSettingsDebounced`、`eventSource`、`eventTypes`/`event_types`、`getTokenCountAsync`、`getTokenizerModel`、`generate`。
- ★ `chatCompletionSettings`：`prompts`（含 `identifier/name/content/role/marker/injection_position/injection_depth`）、`prompt_order`（`character_id`、`order[].identifier/enabled`）、`preset_settings_openai`、`openai_max_context`。
- ★ `extensionSettings` 与 `getContext()` 同对象引用（预设会写入 `Astro`、`regexBinding_scriptId`）。
- ★ `eventSource`：`on(type, fn)` / `removeListener(type, fn)`，支持多参数透传。
- ★ `eventTypes` 常量表至少含 §2.3 列出的 19 个不同事件（22 行中有 3 个复用）。
- 脚本 iframe 内 `SillyTavern` shim：`{...getContext(), getContext}`（`[TH-PKG]` `predefine.js:26-34` 的等价物）。
- 可选：顶层 `qrAssistantExtensionApi`（数组）、`quickReplyMenu.applyWhitelistDOMChanges`。

### 5.2 脚本 iframe 契约（对应 TH `predefine.js`）

- ★ iframe `id`/`name` 形如 `TH-script--<name>--<uuid>`；`window.frameElement` 非空且同源。
- ★ 全局 `getScriptId()`：返回脚本 uuid（可抛错当不在脚本 iframe 内）。
- ★ 全局 `$`（jQuery，ready 回调可用）。
- ★ 允许 iframe 内脚本访问 `window.parent`（同源），并能向父文档 `appendChild` 元素（若接受注入）。
- 建议：`window._`（lodash）与 `TavernHelper` 系列绑定（本预设只用 `getScriptId`）。

### 5.3 DOM 契约

- ★ `#chat`，其直接子节点 `.mes[mesid]`，`.mes_block`，`.mes_text`（正文）。
- ★ `#send_form`、`#send_textarea`、`#send_but`。
- ★ `#qr--bar` 与 `.qr--buttons`（QR 栏）。
- ★ `#completion_prompt_manager`、`#completion_prompt_manager_list`、`[data-pm-identifier]`、`.prompt-manager-toggle-action`。
- ★ `#send_form` 可被加 class（`catgod-chat-mode`）；`#send_textarea` 的 `placeholder` 可被改写。
- ★ 文档有 `BODY`，iframe 父链可达 `BODY`。
- 建议：`body.qra-enabled` 标志（QR Assistant 场景）。

### 5.4 事件

- ★ §2.3 全部 19 个不同 ST 事件（字符串值以 `[ST-SRC]` `events.js` 为准）。
- ★ 允许监听宿主干的 `CustomEvent`：`catgod-oracle:final-request`（收）；预设会派发 `catgod-oracle:change/prompts/usage/theme`（宿主一般只需允许 `dispatchEvent`）。
- ★ `storage` 事件（`localStorage` 同步）。

### 5.5 存储

- ★ `localStorage`（`W.localStorage`），可读写 `CatGod_Oracle_State/UI/Usage`。
- ★ `storage` 事件广播。
- 建议：按预设/聊天前缀隔离，或提供命名空间映射。

### 5.6 postMessage

- ★ 子 iframe → 父：`{type:'resizeIframe', height}`（ST/TH 现无消费者，RPNow 可实现为设高）。
- ★ 父 → 子：`{type:'catgod-oracle:theme', theme}`（预设内的消息面板会监听）。
- 建议：宿主导出统一 postMessage 桥，校验 `origin`/`source`。

### 5.7 渲染与样式

- ★ `CSSStyleSheet` + `adoptedStyleSheets`（失败可回退 `<style>`）。
- ★ `MutationObserver`、`ResizeObserver`（可选）、`visualViewport`（可选）、`matchMedia`。
- ★ `requestAnimationFrame`/`cancelAnimationFrame`、`setTimeout/clearTimeout/setInterval/clearInterval`。
- ★ `W.frames` 可枚举、`child.postMessage`。
- ★ 自定义元素 + `attachShadow({mode:'open'})`。
- ★ `W.Function`、`W.URL`，且宿主文档存在 `<script type="module" src="…/script.js">`，可 `import('./scripts/openai.js')` 拿到 `promptManager`。

### 5.8 验收测试建议

1. 在脚本 iframe 内执行 `注入器`，断言 `getScriptId()` 返回 uuid、`SillyTavern.extensionSettings.regexBinding_scriptId` 被写入；默认策略下外链注入被阻断并记录。
2. 加载 `菜单`，断言 `window.top.CatGodOracle` 出现、`active` 与 `enableMenu` 门控一致；切换到无 `enableMenu` 的预设后 `active=false`、DOM/监听被清理，切回复活。
3. 断言三个 `CatGod_Oracle_*` 键可读写且结构符合 §2.4。
4. 派发 `generation_started/message_received/chat_completion_settings_ready`，断言用量与模式状态变化。
5. 用 `regex[5]` 渲染含 `<options>` 的楼层，点击选项，断言 `#send_textarea` 被填入、`input/change` 冒泡、`context.generate()` 被调用（或 `#send_but` 点击）。
6. 断言 `resizeIframe` 与 `catgod-oracle:theme` 的行为符合 §3。

---

## 6. 未找到 / 不臆测

- `getRequestHeaders`：`菜单` 与两份 HTML 文档**均未出现**（`grep` 0 命中）。上下文里有，但内嵌运行时不用。
- `generate()`：仅 `神谕面板:891` 使用；`菜单` 不用。
- `resizeIframe`：ST 源码与 TH 4.12.1 包内**均无消费者**；TH 用 `adjust_iframe_height.js` 直接写 `frameElement.style.height`。该消息是“发了但没人接”的最佳努力信号。
- `getScriptId` / `$` / `frameElement`：**不在预设内定义**，来自 TH 的脚本 iframe 预定义（`predefine.js`）。
- `catgod-oracle:usage` 是 `CustomEvent`，不是 postMessage。
- `promptManager` 动态导入依赖 ST 内部模块路径 `./scripts/openai.js`，属实现耦合，非公开 API。
- `extensions.SPreset.FinalRequestProcessing.script`（102500 B）与 `extensions.SPreset.RegexBinding.regexes` 属同一预设的其它内嵌运行时，本文只在其与控制台有契约处（§2.11）涉及，未展开分析。
