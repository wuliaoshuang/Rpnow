# 酒馆插件 × 预设 耦合机制：源码证据总览（阶段 A）

> 本文件是「先深挖傻酒馆真实源码与真实包、再改造 RPNow」这一阶段的主证据文档。
> 每条结论都必须带 `[ST-SRC]` / `[TH-PKG]` / `[PRESET]` 来源；**未在源码中找到的一律标注，不臆测**。
> 法律边界沿用 [REFERENCE-SOURCES.md](../REFERENCE-SOURCES.md)：ST 为 AGPL-3.0，只实现开放格式与契约，不复制源码。

---

## 0. 结论先行：三者耦合，不是两个独立东西

用户判断「预设其实都大差不差，主要是要考虑到酒馆的插件可能和预设有所关联」。本轮实地探查证实并细化了这个判断：

- **预设不是一段正则，而是一个把数据/脚本/HTML 模板塞进 `extensions.*` 命名空间的分布式应用**。`Meowssiah-2.1.6.json`（660700 B）里，`prompt_order`/`prompts` 只是骨架，真正的"应用"在 `extensions`：`SPreset`（174840B）、`regex_scripts`（52433B / 8 条）、`tavern_helper`（183352B，内嵌 2 个插件运行时脚本）；四份快照里只有 2 条正则真的产出 HTML 文档。
- **HTML 全部由预设产出**：8 条显示层正则（`placement:[2]`, `markdownOnly:true`）把模型吐出的 `<think_nya>`/`<options>`/`<summary>`/`<comment>` 标签替换成 ``` 围栏包裹的完整 `<!DOCTYPE html>` 文档（折叠栏约 10 KB、神谕面板约 36 KB）。
- **酒馆助手不产 HTML，它接管预设产物**：扫 `#chat > .mes[mesid=N]` 的 `pre>code`，按内容判定是否前端文档，包进 `<div class="TH-render">` 的 iframe。
- **预设反向依赖插件与宿主**：内嵌的 165 KB「神域控制台」要"找到挂着 `SillyTavern` 的顶层窗口，把运行时注入成那里的 `<script>`"；生成的 HTML 文档直接调 `window.top.SillyTavern.getContext()`、`#send_textarea`、`context.generate()`、`saveSettingsDebounced()`、`postMessage({type:'resizeIframe'})`、`localStorage.CatGod_Oracle_UI`。
- **ST 是平台层**：提供 `getContext()`、正则引擎、楼层 DOM、事件总线、设置容器、`readPresetExtensionField`。**"插件拿到预设上下文"的官方通道就是 ST 的 `readPresetExtensionField({path})`**，路径可任意点号嵌套。

所以"强行兼容某个预设"是死路；要补的是**平台地基**与**插件↔预设的关联通道**。

---

## 1. 证据来源清单（本轮实际打开过的文件）

| 标记 | 路径 | 用途 |
|---|---|---|
| `[ST-SRC]` | `_ref/SillyTavern/public/script.js` (12599 行) | `messageFormatting`、事件、楼层 DOM |
| `[ST-SRC]` | `_ref/SillyTavern/public/scripts/extensions/regex/engine.js` (465 行) | 正则引擎、placement、trust gate |
| `[ST-SRC]` | `_ref/SillyTavern/public/scripts/preset-manager.js` (1250 行) | `readPresetExtensionField` |
| `[ST-SRC]` | `_ref/SillyTavern/public/scripts/extensions.js` (2324 行) | 扩展生命周期、模板渲染、hooks |
| `[ST-SRC]` | `_ref/SillyTavern/public/scripts/st-context.js` | `getContext()` 字段表 |
| `[ST-SRC]` | `_ref/SillyTavern/public/index.html` (8231 行) | `#extensions_settings` 容器 |
| `[ST-SRC]` | `_ref/SillyTavern/public/scripts/streaming-display.js` | 流式 `messageFormatting` |
| `[TH-PKG]` | `tavern-helper-real.zip` → `JS-Slash-Runner-main/dist/index.js` (1.12 MB) | TH 渲染器 |
| `[TH-PKG]` | 同包 → `JS-Slash-Runner-main/src/iframe/predefine.js` | iframe 内 `getContext` |
| `[PRESET]` | `C:\Users\shuang\Downloads\Meowssiah-2.1.6.json` | 真实预设样本 |
| `[DOC]` | `docs/research/formats.md` / `docs/TAURN-HELPER-COMPAT.md` / `docs/RPHUB-PARITY.md` | 已有行号级笔记 |

---

## 2. 已确证的核心事实（本轮主代理实地读取）

### 2.1 预设结构 `[PRESET]`

```
Meowssiah-2.1.6.json (660700 B)
├─ prompts[] / prompt_order[]              # ST 预设骨架
│  └─ identifier === 'SPresetSettings'     # content 是 JSON，含 RegexBinding
├─ extensions  （四个键；大小口径 = 紧凑 JSON 的 UTF-8 字节/字符数，来自 `_preset-extensions-inventory.md` 的可复现测量）
│  ├─ SPreset — 174840B / 162811c，10 字段
│  │  ├─ RegexBinding — 52062B / 50799c（`regexes` 7 条 / 52050B）
│  │  ├─ FinalRequestProcessing — 116612B / 106164c（`script` 112948B / 102500c，重度依赖宿主 API）
│  │  ├─ OutputPreprocessing — 4015B / 3753c（含 `toolCallFormatter.script` 3462B）
│  │  ├─ ToolBindings 1082B / ChatSquash 774B / MessageInjections {} / MacroNest false / FixedPresetName "" / ForcedPostProcessing 26B / LogUpload 74B
│  ├─ extensions — 194B / 178c（`presetdetailnfo` 元信息）
│  ├─ regex_scripts — 52433B / 51160c，8 条（标准 ST 载体）
│  └─ tavern_helper — 183352B / 177893c，2 字段（★ 内嵌插件运行时；`scripts` 2 条 183325B，`variables` {}）
│     ├─ scripts[0] SPreset — content 701B（injectScript 外链注入器）
│     └─ scripts[1] 菜单 — content 169589B / 165086c（CatGodOracle 控制台 v1.4.6）
```

8 条 `regex_scripts` 全为 `placement:[2]`，混合 `markdownOnly` / `promptOnly` / `minDepth`(1, 24) / `trimStrings:["```"]`。`extensions.regex_scripts`(8) 与 `SPreset.RegexBinding.regexes`(7) 是**重复携带**，必须去重（详见 `_preset-extensions-inventory.md`）。

### 2.2 内嵌脚本的耦合证据 `[PRESET]`

`extensions.tavern_helper.scripts[0].content` 全文：

```js
function injectScript(iframe, id, url) {
  let parent = iframe.parentElement;
  while (parent && parent.tagName !== 'BODY') parent = parent.parentElement;
  if (document.getElementById(id)) return;
  const script = document.createElement('script');
  script.id = id; script.src = url;
  parent.appendChild(script);
}
$(() => {
  SillyTavern.extensionSettings.regexBinding_scriptId = getScriptId();
  injectScript(window.frameElement, getScriptId(),
    'https://jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js');
});
```

`scripts[1]` 头部注释（逐字）：

> 可以放在酒馆正则 / 前端渲染的 iframe 里，也可以直接在顶层运行。加载器会找到挂着 SillyTavern 的顶层窗口，把真正的运行时注入成那里的 `<script>`，所以就算当前 iframe 随消息重绘被销毁，菜单也照常工作；重复加载只保留一个实例。
> 启用条件：只有当前预设的某个条目（开没开都行）里写着 `<<<|catgodml|enableMenu>>>` 时控制台才出现；换到其它预设会撤掉全部界面和事件钩子，只留一个监听预设切换的哨兵，切回来自动复活。

关键词普查（`scripts[1].content`，165 KB）：`SillyTavern`×16、`getContext`×2、`Preset`×30、`CatGodOracle`×14、`script`×14、`window.top`×7、`iframe`×4、`postMessage`×2、`send_textarea`×1；`tavern_helper`/`regex`/`regex_scripts`/`getScriptsByType` 均为 0 —— 说明该运行时**通过 `SillyTavern` 全局与预设门控间接耦合**，不直接读正则字段名。

### 2.3 预设生成的 HTML 反向调用宿主 `[PRESET]`

`extensions.regex_scripts` 中「前端综合面板」的 `replaceString`（36 KB 完整 HTML）内含：

```js
function getSillyTavern() {
  try { return window.top?.SillyTavern || window.parent?.SillyTavern || null; }
  catch (error) { console.warn('[Cat Oracle] SillyTavern context is unavailable', error); return null; }
}
// initToggle(): 读/写 extensionSettings.Astro.optionMode / directSend
const st = getSillyTavern();
const context = st?.getContext?.();
const settings = context?.extensionSettings?.Astro;
...
context.extensionSettings.Astro.optionMode = optionMode;
if (typeof st?.saveSettingsDebounced === 'function') st.saveSettingsDebounced();
// handleSelect(): 写入 #send_textarea 并发送
const textarea = parentDocument?.getElementById('send_textarea');
if (typeof context?.generate === 'function') context.generate();
else parentDocument.getElementById('send_but').click();
// 高度自适应
window.parent.postMessage({ type: 'resizeIframe', height: bodyHeight }, '*');
// 主题跟随
window.top.CatGodOracle / localStorage.getItem('CatGod_Oracle_UI')
window.addEventListener('message', e => e.data?.type === 'catgod-oracle:theme' && apply(e.data.theme));
// 选项面板自行销毁
function removeOwnIframe() { /* 遍历 window.parent.document.querySelectorAll('iframe') 找自己 */ }
```

「思维链折叠」文档（10 KB）同样含 `postMessage({type:'resizeIframe'})`、`catgod-oracle:theme` 主题跟随、`formatParagraphs()` 等。

### 2.4 ST 正则引擎 `[ST-SRC]`

`scripts/extensions/regex/engine.js`：

- `:11-16` `SCRIPT_TYPES = { GLOBAL: 0, PRESET: 2, SCOPED: 1 }`
- `:98-99` `getRegexScripts()` = `[...Object.values(SCRIPT_TYPES).flatMap(type => getScriptsByType(type, options))]` → **数值序 0→1→2 = global → scoped(卡片) → preset(预设)**（⚠️ 与 RPNow 现有注释「预设先于卡片」相反，必须纠正）
- `:108-130` scoped 读 `characters[this_chid]?.data?.extensions?.regex_scripts`；PRESET 读 `presetManager?.readPresetExtensionField({ path: 'regex_scripts' })`
- `:115` / `:122` trust gate：`character_allowed_regex` / `preset_allowed_regex[apiId].includes(presetName)`
- `:281-292` `regex_placement = { MD_DISPLAY:0, USER_INPUT:1, AI_OUTPUT:2, SLASH_COMMAND:3, WORLD_INFO:5, REASONING:6 }`
- `:334-381` `getRegexedString(rawString, placement, {characterOverride,isMarkdown,isPrompt,isEdit,depth})` 真值表：
  ```
  (markdownOnly && isMarkdown) || (promptOnly && isPrompt)
  || (!markdownOnly && !promptOnly && !isMarkdown && !isPrompt)  → run
  ```
  另含 `isEdit && !runOnEdit` 跳过、minDepth/maxDepth、`placement.includes()`、末尾 `substituteParams`。
- `:391-447` `runRegexScript`：`{{match}}`→`$0`、`$<name>` 命名组、`trimStrings`、`substituteRegex` 0/1/2（`:304-324` `sanitizeRegexMacro`）、末尾 `substituteParams`。
- `:419` 替换基于 `rawString.replace(findRegex, fn)` —— **每次从原串替换，脚本链按序累加**。
- `script.js:1800-1868` `messageFormatting()` 内 `getRegexedString(mes, regexPlacement, {characterOverride:ch_name, isMarkdown:true, depth})`，depth 由 `:1851-1853` "非系统消息距末尾数"算出。**显示层正则在楼层 HTML 生成阶段跑，产出 `pre>code` 代码围栏**。

### 2.5 ST 插件获取预设上下文的官方通道 `[ST-SRC]`

`scripts/preset-manager.js:853-873`：

```js
readPresetExtensionField({ name, path }) {
    const { settings } = this.getPresetList();
    const selectedName = this.getSelectedPresetName();
    const presetName = name || selectedName;
    if (settings && selectedName === presetName) {
        const settingsExtensions = ensurePlainObject(settings.extensions || {});
        return path ? lodash.get(settingsExtensions, path, null) : settingsExtensions;
    }
    const preset = this.getCompletionPresetByName(presetName);
    if (!preset) return null;
    const presetExtensions = ensurePlainObject(preset.extensions || {});
    return path ? lodash.get(presetExtensions, path, null) : presetExtensions;
}
```

- `path` 是 **lodash.get 的任意点号嵌套路径** → `tavern_helper.scripts`、`SPreset.RegexBinding.regexes` 天然可读。
- 选中预设时优先读 `settings.extensions`（运行时可变），否则读 `preset.extensions`（文件态）。
- 找不到返回 `null`，不抛。
- 消费方：`engine.js:126`（PRESET 正则）、`extensions/regex/index.js:1685`、全仓其它调用点见分节。

### 2.6 ST 扩展设置容器与生命周期 `[ST-SRC]`

- 容器层级（`index.html:5750-5832`）：`#extensions-settings-button.drawer > #rm_extensions_block.drawer-content > .extensions_block.flex-container > #extensions_settings(2).flex1.wide50p > .extension_container#<name>_container{display:contents}`。**内置扩展有硬编码容器**（`#regex_container` 等 16×2 个），**第三方扩展没有预置容器，自己 append 到 `#extensions_settings`/`#extensions_settings2`**（两者是该菜单左右两栏）。设置面板在**独占抽屉**里，不是聊天列表 item —— 列表 item 只有 toggle/icon/textBlock/actionsDiv（`extensions.js:890-1055`），没有任何表单。这直接回答了用户「设置项是不是在已安装插件列表内部渲染」：**ST 里不是**。
- **宽度根因**：`.drawer-content` 宽 `var(--sheldWidth)=50vw`（`style.css:92,5555-5563`，另 `min-width:450px`），两栏各 `flex1+wide50p` ≈ **25vw**；`.extension_container{display:contents}`（`extensions-panel.css:146-148`）让容器不生成盒子；移动端才 `width:100% !important`（`mobile-styles.css:180-184`）。所以「窄」在 ST 里是**设计**而非渲染 bug；RPNow 的情况更严重（见第 4 节：隐形 div）。
- `renderExtensionTemplate(Async)`（`extensions.js:125-139`）**只返回 HTML 字符串**（模板路径 `scripts/extensions/<name>/<templateId>.html`，Handlebars + 可选 sanitize/localize），**不查找容器、不 append、不套壳**。挂载完全由扩展 JS 自己做，例如 `regex/index.js:1728-1729` `$('#regex_container').append(await renderExtensionTemplateAsync('regex','dropdown'))`；quick-reply/memory/vectors 等同构。
- `callExtensionHook`（`extensions.js:406-466`）：读 `manifest.hooks[hookName]` → 动态 `import('/scripts/extensions/<name>/<manifest.js>')` → `module[fnName]()`；**无参数、可 await、5 秒超时仅告警**。支持的 7 个钩子：`install/update/delete/clean/enable/disable/activate`（`:385-403`）。这是通用机制，`hooks.activate` 是内置/第三方扩展初始化的标准入口。
- 生命周期真实顺序：`SETTINGS_LOADED_BEFORE`(`script.js:7940`) → `SETTINGS_LOADED_AFTER`(`:7982`) → `EXTENSIONS_FIRST_LOAD`(`extensions.js:1794`，⚠️ 此时扩展**尚未加载**，首次监听不到) → `discoverExtensions`(`fetch /api/extensions/discover`) → `getManifests` → 丢弃无 manifest 者 → `activateExtensions`（按 `loading_order` **顺序 await**：locale → JS+CSS 并行 → `activeExtensions.add` → `activate` 钩子）→ `EXTENSION_SETTINGS_LOADED` → `SETTINGS_LOADED` → `APP_INITIALIZED` → `APP_READY`。`requires`/`dependencies`/`minimum_client_version` 任一不满足则不加载。
- 持久化：`getContext().extensionSettings` 与 `extensions.js` 的 `extension_settings` 是**同一对象引用**（`st-context.js:201`）；`saveSettingsDebounced()` 把整份 settings POST 回服务端（payload 含 `extension_settings`，`script.js:8085`）；装载时 `Object.assign(extension_settings, settings.extension_settings)`。**`getRegexedString` 不在 `getContext()`**（`regex/engine.js:334`），`power_user` 也不在（只有 `powerUserSettings`，camelCase）。`window.SillyTavern = { libs, getContext }` **只有两个键**（`script.js:293-296`）。

### 2.7 TH 真实包契约 `[TH-PKG]`

`tavern-helper-real.zip` → `JS-Slash-Runner-main/dist/index.js`（1.12 MB，11 个 JS 文件）。关键词普查：

| 关键词 | 次数 | 含义 |
|---|---|---|
| `CHARACTER_MESSAGE_RENDERED` | 16 | 楼层渲染完成事件 |
| `USER_MESSAGE_RENDERED` | 14 | 用户楼层事件 |
| `mes[mesid` | 11 | 楼层 DOM 定位 |
| `TH-render` | 21 | iframe 包裹容器 |
| `html>` | 7 | 前端文档判定 |
| `chatLoaded` | 6 | 首次全量重扫 |
| `activateTauriTavernChatSurface` | 2 | manifest `hooks.activate` 导出钩子 |
| `regex_scripts` | 18 | 预设/正则关联 |
| `extensions_settings` | 1 | 设置容器 |
| `getContext` | 10 (+ predefine.js 4) | 宿主上下文 |

`isFrontend` 字面量**未找到** —— 真判定是 `Ck`（`['html>','<head>','body'].some(...)`，已确证，见 §2.14）。

---

## 2.8 ★ 实地抓到的地基级 bug：`manifest.hooks` 全程丢失

**TH 真包 manifest**（`tavern-helper-real.zip` → `JS-Slash-Runner-main/manifest.json`，原样抄录）：

```json
{
  "display_name": "酒馆助手",
  "loading_order": 100,
  "requires": [],
  "optional": [],
  "js": "dist/index.js",
  "css": "dist/index.css",
  "hooks": { "activate": "activateTauriTavernChatSurface" },
  "author": "KAKAA",
  "version": "4.12.1",
  "homePage": "https://github.com/N0VI028/JS-Slash-Runner",
  "auto_update": true,
  "minimum_client_version": "1.13.0",
  "i18n": { "en": "i18n/en.json", "en-us": "i18n/en.json", "en-gb": "i18n/en.json", "en-ca": "i18n/en.json", "en-au": "i18n/en.json" }
}
```

包内 HTML 资产只有 2 个：`src/iframe/third_party_message.html`、`src/iframe/third_party_script.html`（**没有 `settings.html`** → TH 的设置 UI 是 JS 运行时自注入 DOM，与 `_st-extension-lifecycle.md` 的容器契约直接相关）。

**我方链路逐段核对**：

1. `src/core/plugins/rpnx.ts:219-220` `looksLikeSTExtension(manifestRaw)` 命中 → `parseSTExtension(zip, manifestRaw as STManifest)`。
2. `parseSTExtension` 返回 `{ manifest, script, styles, modules, entryPath }`，`:162` 原样带回 `manifest`（**此步还没丢**）。
3. `parseRpnx` `:223-235` 构造 `PluginManifest` 时**只挑了 8 个字段**：`id/name/version/apiVersion/host/description/author/kind/stEntry`。`hooks`、`requires`、`optional`、`loading_order`、`i18n`、`minimum_client_version` 全部丢弃。`STM` 原始对象没有存进 `assets`（`:237-245` 只存 css + modules）。
4. `src/core/plugins/loader.ts:204-216` `register()` 里用 `activateSTExtension(manifest.id, { manifest: { display_name, version, description, js }, ... })` **重建了一个全新 manifest**，连 `id/name/author` 都换了形状，`hooks` 依然不存在。
5. `src/core/plugins/st-bridge.ts:611-617`：
   ```ts
   const hooks = (files.manifest as { hooks?: { activate?: string } }).hooks;
   const hookName = hooks?.activate;
   if (hookName && typeof mod[hookName] === 'function') {
     await (mod[hookName] as () => unknown)();
   } else if (typeof mod.default === 'function') { ... }
   ```
   `hooks` 恒为 `undefined` → **TH 的 `activateTauriTavernChatSurface` 从未被调用**。之前的调查笔记（`TAURN-HELPER-COMPAT.md`）把"扩展能激活但 Vue 未挂载"归因于深层 API 缺失——**该推断已被真包证据否定，见下条修正**。

   ⚠️ **修正（来自 `_th-renderer-contract.md` §5.1）**：这**不是 TH 不渲染的根因**。该导出（包内别名 `$V`，`dist/index.js:651:9454`）只在 `window.__TAURITAVERN__?.api?.chatSurface` 存在时注册「managed ChatSurface participant」，**标准 ST 下是 no-op**；TH 的全部渲染能力由 **DOM ready 即执行**的初始化链驱动（注册宏/斜杠命令/`globalThis.TavernHelper`，并把 `<div id="tavern_helper">` append 到 `#extensions_settings` 后挂 Vue，`dist/index.js:884`），与 `activate` 钩子无关。因此「Vue 未挂载是因为钩子没调」的推断**不成立**：设置 UI 不可见的真根因是 `#extensions_settings` 落在裁剪区外且无入口（第 4 节 C5）；楼层不渲染的真根因是 DOM / 事件契约断裂（§2.9 + §2.14）。

**为什么这属于"地基不牢"而非"某个插件适配问题"**：ST 的 `extensions.js:420-444` `callExtensionHook` 是**通用机制**——`manifest.hooks[hookName]` → 动态 `import(url)` → `module[hookFunctionName]()`。我方 `st-manifest.ts:9-21` 的 `STM` 接口里**根本没有 `hooks` 字段**，`looksLikeSTExtension()` 也不认它，`rpnx.ts` 不保留它，bridge 只能靠"碰巧 `mod.default` 是函数"兜底。任何依赖 hooks 的 ST 扩展都会中招（内置 regex/quick-reply 就是 `"hooks":{"activate":"init"}`）。**注意边界**：TH 自身调不调该钩子都能跑（见上），但补全它仍是通用地基的一部分，不能因为"TH 不需要"就略过。

**阶段 C 必须修**（写进契约）：
- `STM` 补全 ST 真实字段：`hooks`（`Record<string,string>`）、`requires`/`optional`/`dependencies`、`loading_order`、`i18n`、`minimum_client_version`、`auto_update`、`homePage`、`generate_interceptor` 等。
- `parseRpnx` 把**原始 ST manifest 全文**存进 `assets['__st__/manifest.json']`（或 `stManifest` 字段），loader 原样透传给 `activateSTExtension`。
- `activateSTExtension` 的 `hooks.activate` 调用与 ST `callExtensionHook` 对齐（`:438` 先 `import(url)`，`:440` 校验导出是函数，另支持多钩子名与 `default` 兜底）。
- 生命周期补 `EXTENSIONS_FIRST_LOAD` / `SETTINGS_LOADED` / `CHAT_LOADED`，钩子在容器与全局就绪后调用（当前 `installHostGlobals()` → `publishHostState()` → `buildShim()` 顺序需与 ST 对齐）。

---

## 2.9 ★ 楼层 DOM 契约的三个实测缺口（主代理读我方源码）

TH 依赖 `#chat > .mes[mesid=N]` 与 `.mes_text`，而我方现状：

1. **`#chat` 与 `.mes` 之间夹着一层布局 div** —— `src/components/chat/ChatView.tsx:1110` 是 `id="chat"`，但 `:1130` 立刻是 `<div className="mx-auto flex flex-col gap-5 …">` 包裹所有楼层。ST/TH 用 `$('#chat > .mes')`（**直接子选择器**）→ 扫不到任何楼层。另有 `:1137` windowing（`hiddenCount` + 分批挂载）会让 `mesid` 与实际 `chat[]` 偏移错位。
2. **`.mes` 根类名已有、`mesid` 已是数组偏移** —— `src/components/chat/MessageBubble.tsx:268` `'… mes'`，`:276` `{...{ mesid: index }}`，注释明确写了对齐 TH 的 `chat[message_id]` 语义。这一条是对的，必须保留。
3. **正文容器是 `.rp-md`，没有 `.mes_text`** —— `MessageBubble.tsx:371-376` `<div className="rp-md" dangerouslySetInnerHTML>`；`:228` `renderMessageText(expanded, scripts, 2, depth)` → `renderer.render(processed, {styleScope:'.rp-md', sandboxHtml})`。全仓 grep `mes_text` 在 `src/` 下 **0 命中**（只出现在 ST 源码里）。TH 若按 `.mes_text pre>code` 取文档，取不到。

补充：`ChatView.tsx:554-570, 660-663` 已发内核事件 `chat:message-received` / `chat:message-sent` / `chat:message-regenerated`，payload 带 `message_id: floorId`（数组偏移），`st-bridge.ts:338-350` 把它们映射成 ST 事件名——**事件链是通的，DOM 链是断的**。这解释了"插件激活了、事件也发了、但楼层里什么都没渲染"的现象。

**阶段 C3 契约**：`#chat` 的直接子节点就是 `.mes[mesid=N]`（把布局类挪到 `#chat` 自身或用 `display:contents` 的中间层），正文节点带 `.mes_text`（可在 `.rp-md` 上加同类名），windowing 不改变 `mesid` 与 `chat[]` 的映射（或渲染 TH 可见范围内的全部楼层）。

---

## 2.10 待验证隐患：事件总线的时序与「双总线」分裂

`activateSTExtension`（`st-bridge.ts:400-403`）的顺序是：
`installHostGlobals()` → `publishHostState()` → `buildShim(pluginId)`。而 `setSharedEventBus(eventSource)` 发生在 `buildShim` 内的 `spy()`（`:331`），即**最后一步**。

- `publishHostValues()`（`st-host-runtime.ts:137-141`）把 `V.eventSource` 定义成 `get:()=>getEventBus()` 的动态 getter —— 这一步设计正确，shim 模块在 `import()`（`:603`，晚于 `spy()`）求值时能拿到 bridge 的真 bus。
- 但 `publishHostState()`（`:752-771`）在 `spy()` **之前**执行：`hostStateSnapshot()`（`:695`）先 `const bus = getEventBus()`，此时 `sharedEventBus` 尚未设置 → 拿到 fallback bus，并以 `Object.assign(w, rest)` 把 `window.eventSource` **写死成 fallback 包装对象**（非 getter）。

若 TH 某些代码用全局 `window.eventSource` 订阅、而 `getContext().eventSource` 与 shim `script.js:eventSource` 用 bridge bus，就会出现「订阅在 A、发射在 B」的分裂，表现为事件发了但渲染器不重扫。与 §2.9 的 DOM 断裂叠加，正好对应"插件激活了却什么都没渲染"。

**阶段 C4 处理**：`publishHostState` 也把 `eventSource`/`event_types` 发布成动态 getter，或把 `setSharedEventBus` 提前到 `publishHostState` 之前；统一到**唯一一条总线**。**阶段 D 真机验证**时专门断言两处 `eventSource.on` 的监听都被同一次 emit 命中。

---

## 2.11 ST 管线补充事实（来自 `_st-message-pipeline.md`，行号可回溯）

主代理只摘录对兼容契约有直接影响的部分，完整细节见该分节文档。

**事件定义不在 `script.js`**：常量表在 `[ST-SRC] scripts/events.js:3-70`。字符串值坑位：
- `CHAT_LOADED = 'chatLoaded'`（**驼峰**，源码自带 TODO 说命名不一致），payload 是**对象** `{detail:{id, character}}`，不是 id（`script.js:7669`）。
- `CHARACTER_MESSAGE_RENDERED = 'character_message_rendered'`，payload `(message_id, type)`（`script.js:3798-3803, 6690-6693, 7703-7707`）。
- `USER_MESSAGE_RENDERED`/`MESSAGE_UPDATED`/`MESSAGE_SWIPED` 单参数 `(message_id)`（`script.js:5912/5919, 8337/8431, 10315`）。
- `MESSAGE_DELETED` 传 **`chat.length`（删除后剩余长度）**，不是被删 id（`script.js:1611`）。
- `MORE_MESSAGES_LOADED` **无 payload**（`script.js:1474`）。
- `eventSource.emit` 是 **await 的异步多参数透传**；监听器有 `on / makeFirst / makeLast` 优先级（`extensions/translate/index.js:768-772`）。

**`.mes[mesid=N]` 的完整属性集**：`mesid / swipeid / ch_name / is_user / is_system / bookmark_link / force_avatar / timestamp / type`（`script.js:2647-2658`）。模板在 `index.html:7391-7471`，`#chat` 容器 `script.js:449`，正文 `.mes_block > .mes_text`（`index.html:7403/7461`）。**`.mes_text` 写入是全量 `innerHTML =` 替换**（`script.js:2696/2037/3728`）。

**正则顺序（再次确证）**：显示层正则在 showdown **之前**（`getRegexedString` `:1860-1864` → `converter.makeHtml` `:1935`），所以 ``` 围栏能变成 `pre>code`。`markdownOnly=true` 的脚本只在 `isMarkdown:true` 时跑；默认（`false/false`）脚本在写入 chat 历史时已改源文本，显示层**不重跑**（`engine.js:350`）。`depth` = 「距末尾的非系统消息数」（`script.js:1851-1853`），`messageId<0` 时 `undefined`、门控整体跳过。

**对 TH 契约的关键含义**：
1. TH 若靠 `.mes_text` 里的 `pre>code` 挂 iframe，而 RPNow 每次重绘都是全量 `innerHTML` 替换 → **TH 必须在 `CHARACTER_MESSAGE_RENDERED`/`MESSAGE_UPDATED` 后重新扫描挂载**（或 MutationObserver），否则一次编辑就丢。这与我方 `ChatView.tsx:554-570` 已发的事件链正好配套，但 DOM 侧需按 §2.9 修好。
2. ST 的 sanitize 钩子 `uponSanitizeAttribute` 会把 class 改名为 `custom-<原名>`（`chats.js:1910-1935`），仅 `fa-*`/`note-*`/`monospace`（及系统 UI 白名单）豁免 —— 与我方 `renderer.ts` 的 `namespaceClasses()` 行为一致，说明**按 class 定位楼层内容不可靠，应改用 `.mes_text` + `pre>code` 结构定位**。
3. `addCopyToCodeBlocks` 会往 `<code>` 内追加 `<i class="code-copy">`（`script.js:2479-2486`），TH 取文档文本时不能假设 `code.textContent` 干净。
4. 系统消息（`isSystem`）**不进 showdown**（跳过 `1892-1951`）→ 预设想产出 HTML 面板的楼层绝不能是 system 角色。
5. `updateMessageBlock(..., {rerenderMessage:false})` 只刷新 reasoning/媒体/复制按钮，不重画 `.mes_text`（`script.js:2033-2044`）——RPNow 重绘调度要区分「正文变」与「只变元数据」。
6. `encode_tags`（`power_user.encode_tags`）开启时会转义尖括号（`script.js:1875-1879`），预设注入 HTML 必须依赖**代码围栏**（`1900-1901` 保护），裸 `<div>` 会被吃。

---

## 2.12 预设内嵌运行时 = 「通用能力」硬依赖清单（来自 `_preset-embedded-runtime.md`）

**先校正三处前提**（子代理实测）：
- `extensions.regex_scripts` 8 条中**只有 2 条**的 `replaceString` 是完整 HTML 文档：`[1] 思维链折叠`（10373 B 折叠栏）、`[5] 前端综合面板`（36300 B 神谕面板）；其余 6 条是纯文本/空替换。
- `extensions.SPreset.RegexBinding.regexes`（7 条）是 `extensions.regex_scripts`（8 条）的**真子集**（id 全同，后者多出 `1c7de08e-90f5-4b98-b104-003aa6b6ed69`「修剪小总结」）。**去重是必须的，但不是"两份等价"，而是包含关系**。
- 内嵌 loader 有**两份**：`scripts[0]`（新版，URL `https://jnai2d9kgnbs6xzx5c.com/regex_bind/inject.js`）；`prompt_order[0].xiaobai_ext.scheduledTasks[0].commands`（旧版，URL `https://starowo.github.io/regex_bind/inject.js`，只注入自身 iframe）。两者都属**远程脚本注入**，默认应阻断。

**★ 最强耦合证据**：`scripts[0]` 用到的 `getScriptId()` / `$`(jQuery) / `window.frameElement` **都不在预设里定义**，来自 TH 的 `src/iframe/predefine.js`（`_getScriptId` 要求 iframe id 形如 `TH-script--<name>--<uuid>`）。也就是说：**这份预设的脚本层只有在酒馆助手的脚本 iframe 契约里才能运行**——这正是"插件与预设有关联"的实体，不是猜测。

**`菜单`（CatGodOracle v1.4.6，165 KB）的关键依赖**：
- `resolveHostWindow()` 递归找带 `SillyTavern` 的顶层窗口并自注入 `<script>`（`菜单:3048-3065`）。
- 主机上下文 API：`getContext()` 全字段 + **`chatCompletionSettings.prompts` / `prompt_order`**（门控直接扫当前预设 prompts，**不用** `getSelectedPreset`/`readPresetExtensionField`）；写 `extensionSettings.Astro` / `regexBinding_scriptId` 后 `saveSettingsDebounced()`。
- 绑定 **19 个 ST 事件**（`bindStEvents` `菜单:813-868`）；DOM 依赖 `#chat/.mes/.mes_block`、`#send_form`、`#send_textarea`、`#send_but`、**`#qr--bar` / `.qr--buttons`**、`#completion_prompt_manager(_list)`、`[data-pm-identifier]`；注入自定义元素 `<catgod-oracle-layer data-swipe-ignore>`（shadow DOM）。
- localStorage 仅 3 键 `CatGod_Oracle_State/UI/Usage`（**无前缀**）；`postMessage` 只有父→子 `{type:'catgod-oracle:theme'}`（`broadcastTheme` 递归 `W.frames`），子→父 `{type:'resizeIframe',height}`（**ST/TH 均无消费者**，TH 用 `adjust_iframe_height.js` 自动量高）。
- 预设切换时 `deactivate()` 全清理（监听/Observer/计时器/全局 style/textarea placeholder），**门禁哨兵保留**，切回命中 `<<<|catgodml|enableMenu>>>` 的预设自动复活。

**神谕面板的输入劫持**（安全敏感）：取 `parentDocument.getElementById('send_textarea')`，用 `HTMLTextAreaElement.prototype` 的 value setter 写入（绕过框架劫持），派发 `input`/`change`（`bubbles:true`），再 `context.generate()` 或 `#send_but.click()`；收尾 `removeOwnIframe()` 遍历 `window.parent.document.querySelectorAll('iframe')` 按 `contentWindow` 匹配删除自己。

**阶段 C 的硬依赖（★）摘要**（完整清单见分节 §5）：
1. `getContext()` 必须含 **`chatCompletionSettings`**（`prompts`/`prompt_order`/`openai_max_context`…）——我方 `st-bridge.ts` 目前完全没有这个字段，是新增项。
2. `#qr--bar`/`.qr--buttons`、`#completion_prompt_manager*` 是我方 UI 里不存在的 DOM 约定，需要决定"提供桩节点"还是"让扩展优雅降级"。
3. `eventSource` 需支持 19 个事件名与多参数透传；`localStorage` 需前缀隔离。
4. 脚本 iframe 契约：id `TH-script--<name>--<uuid>`、`window.frameElement` 同源、全局 `getScriptId()`/`$`。
5. 安全：远程注入默认阻断；`$1`（模型可控文本）进 iframe innerHTML 有 XSS 面；`iframe` sandbox 需在「隔离」与「`window.parent` 兼容」间显式取舍。

---

## 2.13 官方通道语义与「谁真的在消费」（来自 `_preset-extensions-inventory.md`）

**`readPresetExtensionField({name, path})` 精确语义**（`[ST-SRC] scripts/preset-manager.js:853-873`）：
- `path` 为空串 → 返回**整个 `extensions` 对象**；非空 → `lodash.get(extensions, path, null)`，**任意点号嵌套**。
- **选中同名预设时优先读 `settings.extensions`（运行时份）**，否则读 `preset.extensions`（文件份）。原因：切预设时 ST 会把 `preset.extensions` 整体拷进 `oai_settings` 等运行时对象（`openai.js:5052-5054`、`kai-settings.js:136-138`、`nai-settings.js:211`、`textgen-settings.js:1200-1203`）。
- 找不到返回 `null`，不抛。
- `writePresetExtensionField`（`:883-908`）是**双写**（settings 与文件，`:889-907` 之间没有 `else`）。

**消费者事实（关键）**：全仓 `readPresetExtensionField|writePresetExtensionField|preset_allowed_regex|presetExtensions` 共 19 处命中，**ST 核心真正的 precondition 消费者只有 regex 扩展，且只读 `regex_scripts`**（`engine.js:126`，trust gate 在 `:122`）。**`SPreset` / `tavern_helper` 在 ST 核心 0 命中** —— 这两个命名空间就是为第三方插件（TH / SPreset）准备的。

**TH 根本不走官方通道**（真包逐行确认）：直读 `preset.extensions.regex_scripts`（`src/store/.../tavern_regex.ts:129`），并把 `extensions.tavern_helper` 当作**自己的预设脚本存储**（`store/settings/preset.ts:9/20/33`、`type/settings.ts:3`、`function/character.ts:42-49/78-86/338-340`）。

> **对阶段 C 的直接结论**：通用能力必须同时提供 (a) `presetManager.readPresetExtensionField/writePresetExtensionField` 的 lodash 路径读写，(b) **预设 `extensions` 全文透传（不可白名单）**，(c) 让 TH 能拿到 `extensions.regex_scripts` 与 `extensions.tavern_helper`。只做前者不够——TH 是直读的。

**正则三份快照是包含关系，不是"两份等价"**：`SPresetSettings`(C, 6 条) ⊂ `SPreset.RegexBinding`(A, 7 条) ⊂ `extensions.regex_scripts`(B, 8 条)；**A 与 B 的前 7 条逐字节相同**（7/7 `JSON.stringify` 相等），B 多「修剪小总结」，C 缺「修剪多余思考」。显示层（`markdownOnly:true` 且非 `promptOnly`）= 5 条；按 RPNow 现有 `extractPresetDisplayRegexes()` 口径 = 6 条。

**`SPresetSettings` prompt 是数据通道而非提示词**：其 `content` 是 JSON，10 个键中 9 个与 `extensions.SPreset` 逐字节相同（仅 `RegexBinding` 差 1 条）；且它 `enabled:false`、`marker:false`、**不在 `prompt_order` 里**。私有 DSL `<<<|catgodml|…>>>` 在 `prompts.content` 出现 54 处 / 52 种，由内嵌 165KB 运行时解释；另有 `prompt_order[0].xiaobai_ext` 第三方命名空间（全文 1 次，消费方未知）。

---

## 2.14 TH 渲染契约（来自 `_th-renderer-contract.md`，763 行真包逐行）

**文档判定真源 `Ck`**（`dist/index.js:74:67584`）：

```js
function Ck(e){return [`html>`,`<head>`,`<body`].some(t=>e.includes(t))}
```

- **大小写敏感**、作用于 **`pre` 的文本内容**（`textContent`/`text()`），不是渲染后 DOM；包内 `isFrontend` 字面量 **0 处**。
- `<head>` 必须带 `>`；`<body` 不带 `>`；`<!DOCTYPE` 只因含 `html>` 间接命中。→ 纯 `<div>`、大写 `<HTML>`、`<head ` 都不渲染。
- 副产物：灌入前把文档里的 `vh` 改写成 `var(--TH-viewport-height)` / `calc(...)`。

**楼层定位 = 直接子选择器**：`#chat > .mes[mesid=N]`（包内 **21 处**），`mesid = chat[]` 下标；`.mes_text` 是正文容器（内部 `pre>code`）。`.mes_block` **TH 不依赖**（SPreset 控制台才用）。这确证了 §2.9 的判断：中间隔一层 div 就全盘扫不到。

**iframe 生命周期**：`pre` 命中 → `wrap('<div class="TH-render">')`（已有则复用）→ Vue `Teleport` 挂 `Iframe.vue`，清旧 iframe、隐藏非 iframe 兄弟。属性：`id/name = TH-message--<mesid>--<idx>`、`loading=lazy`、`class=w-full`、`frameborder=0`、**无 sandbox / 无 allow**；默认 `srcdoc`（或 `blob:` + 注入 `<base href=origin>`）。高度靠 **iframe 内 `ResizeObserver` 直写 `frameElement.style.height`**（rAF 节流 500ms）+ 父页 resize 时 `postMessage({type:'TH_UPDATE_VIEWPORT_HEIGHT'},'*')`。

**真正的初始化链（DOM ready，与 `activate` 钩子无关）**（`dist/index.js:884`）：注册斜杠命令 → `globalThis.TavernHelper` → `globalThis.YAML/z` → **`<div id="tavern_helper">` append 到 `#extensions_settings` 并挂 Vue**；`$(window).on('pagehide', unmount)`。全局 store 等 `APP_READY | 'chatLoaded' | SETTINGS_UPDATED` **任一 once** 命中即 ready。

**首次全量重扫时机**：① `chatLoaded` → 全楼重扫；② 空聊天给 `#chat > .welcomePanel` → 立即扫，否则 **3 秒兜底**；③ 宏开关变化 → 遍历 `#chat > .mes` **逐楼补发** `CHARACTER_MESSAGE_RENDERED`/`USER_MESSAGE_RENDERED`；④ 正则脚本增删 → **1 秒防抖**后重挂全部并发 `CHAT_CHANGED`。

**TH 订阅 ~28 个事件**：`chatLoaded`、`character_message_rendered`/`user_message_rendered`/`message_updated`/`message_swiped`/`message_edited`/`message_deleted`/`message_received`/`message_sent`/`message_swipe_deleted`(`{message_id,swipe_id}`)、`more_messages_loaded`、`stream_token_received`、`generate_after_data`、`chat_completion_settings_ready`、`settings_updated`、`chat_id_changed`、`oai_preset_changed_after`、`preset_renamed_before`/`preset_deleted`、`character_renamed/deleted/edited`、`generation_started/ended/stopped`、`world_info_activated`、`app_ready`、`chatcompletion_model_changed`。自建事件：`TH_REQUEST_RENDER_MESSAGE`、`message_iframe_render_started/ended`、`character_export_ready`。

**★ 设置持久化的四个载体**（阶段 C4/C5 必做）：`extension_settings['tavern_helper']`（全局）、`chat_metadata['tavern_helper']`（聊天）、`preset.extensions['tavern_helper']`（预设）、`character.data.extensions['tavern_helper']`（角色）。→ `getContext().extensionSettings` 必须能写入 `['tavern_helper']` 命名空间，且 preset/character 的 `extensions.tavern_helper` 可读写。

**脚本 iframe 预定义**（`src/iframe/predefine.js`）：用 getter 暴露 `SillyTavern.getContext()` 并附加 `writeExtensionField`，把父页 `_ / jQuery / YAML / showdown / toastr / EjsTemplate / TavernHelper(_bind)` pick 进 iframe；id 形如 `TH-script--<name>--<uuid>`，全局 `getScriptId()` 由此提供。

**最小契约（阶段 C 验收顺序）**：① DOM（`#chat > .mes[mesid]`、`.mes_text`、可见的 `#extensions_settings`、正文内 `pre>code` 文本干净）② 复刻 `Ck` ③ iframe 契约（无 sandbox、`TH-message--` id、高度协议、需加载 TH 的 `dist/index.css` 否则 `hidden!` 失效退化为明文）④ 事件（写入完成后发 RENDERED，`chatLoaded` 时 DOM 已就绪，**唯一一条 eventSource**）⑤ 预设（`regex_scripts` 三处读取 + `tavern_helper` 四载体读写 + 真实 `getRegexedString`）⑥ hooks 补全 ⑦ 样式。

---

## 3. 「插件 ↔ 预设 ↔ 宿主」关联模型

```mermaid
flowchart TD
  P[预设 extensions.*<br/>SPreset / regex_scripts / tavern_helper.scripts] -->|readPresetExtensionField(path)| HOST[ST 宿主 getContext()]
  P -->|显示层正则 placement=2 markdownOnly| FLOOR[楼层 .mes[mesid=N] .mes_text<br/>pre>code 里的 HTML 文档]
  P -->|内嵌脚本 injectScript| TOP[顶层 window<br/>SillyTavern / CatGodOracle]
  FLOOR -->|DOM 扫描| TH[酒馆助手 TH-render iframe]
  TH -->|postMessage resizeIframe / theme| FLOOR
  TH -->|getContext()| HOST
  HOST -->|#extensions_settings| UI[插件设置 UI]
  HOST -->|eventSource RENDERED/CHAT_LOADED| TH
  P -->|生成 HTML 内脚本| TOP
  TOP -->|#send_textarea / generate()| HOST
```

四条必须建成通用能力的关联通道：

| # | 通道 | ST 契约 | RPNow 现状缺口 |
|---|---|---|---|
| 1 | 数据 | `readPresetExtensionField(preset, path)`（lodash.get 任意点号路径） | 只有 `extractPresetDisplayRegexes()` 硬编码两个载体；`tavern_helper.scripts`/`SPreset.*` 全丢 |
| 2 | 运行时 | `getContext()` 全字段 + `presetManager` + `getRegexedString` + `extensionSettings` + 共享 `eventSource` | 152 绑定大半 stub；`getRegexedString:(s)=>s`、`getPresetManager` 万能代理、`extension_settings:{}`、`getContext:()=>({})` |
| 3 | DOM | `#chat` / `.mes[mesid=N]` / `.mes_text` / `#extensions_settings(2)` / `#send_textarea` / `#send_but` | `.mes`/`mesid` 已对齐，但 **`#chat > .mes` 被中间 div 隔断、正文缺 `.mes_text`（§2.9）**；`#extensions_settings` 是挂在 `main` 末尾的**隐形 div**——`main` 是 `overflow:hidden`（`AppShell.tsx:166`），扩展 append 的 DOM 落在裁剪区外且无用户入口（§4 C5） |
| 4 | 通信 | `eventSource` 生命周期事件 + `postMessage`(resizeIframe/theme) + `window.top.*` 全局 + `localStorage` 命名空间 | 事件名手工映射；无 postMessage 协议；无预设脚本全局；localStorage 未隔离 |

---

## 4. 对 RPNow 现状的差距清单（主代理已读源码）

| 文件 | 现状 | 差距 |
|---|---|---|
| `src/components/chat/MessageBubble.tsx:44-95` | `extractPresetDisplayRegexes()` 只取 `raw.regex_scripts` / `ext.regex_scripts` / `SPresetSettings.RegexBinding`，只留 markdownOnly，按 find/replace 去重 | 未走官方通道；丢 `tavern_helper.scripts` 与 `SPreset.*`；注释「预设先于卡片」与 ST 相反；`raw` 是导入时文档快照，不是实时 `settings.extensions` |
| `src/features/chat/orchestrator.ts:523-539` | `renderMessageText()` 单层 scripts + placement/disabled/promptOnly/depth | 缺三层来源、trust gate、全量 placement、真值表、`$<name>`/`trimStrings`/`substituteRegex`/末尾宏替换 |
| `src/core/render/renderer.ts:204-348,402-438` | `escapeCustomTags` 白名单 + `sandboxHtmlFences` 逐行猜围栏 | **靠猜预设形状打补丁**，不是跑预设正则；预设标签被转义/文档被合并都源于此 |
| `src/core/plugins/st-host-runtime.ts:654-661` | 若 `#extensions_settings` 不存在则 `document.querySelector('main').appendChild(div)`（**main 内部末尾**）；152 绑定、`VALUE_BINDINGS`、万能代理 | 语义型绑定未接真实服务；**容器被 append 进 `overflow:hidden`、高度被 `flex-1` 限死的 `main`（`AppShell.tsx:166`，已亲自核实），页面内容填满后落在裁剪区外且无路由/抽屉入口**（用户问的宽度/裁剪问题真根因）；缺 `renderExtensionTemplateAsync`/`writeExtensionField`/`getExtensionManifest` 等 `getContext()` 字段；无 `readPresetExtensionField`；无 postMessage 协议 |
| `src/core/plugins/st-bridge.ts:153-367,611-617` | `getContext()` 快照、事件名手工映射、`hooks.activate` 调用 | 非实时上下文；无生命周期事件；无宿主 DOM 约定；**`hooks` 因 manifest 压字段而恒为 undefined（§2.8）** |
| `src/pages/PluginsPage.tsx:336-349` + `PluginSettings.tsx` | 设置在列表 item 内联，由 `manifest.config` schema 生成 | 与 ST「插件自注入 DOM 到设置容器」契约不同；宽度被 `min-w-0 flex-1` 挤压（用户反复指出的裁剪问题） |
| `src/features/import/cardImport.ts` | 导入把**整个 doc** 存进 `raw`（`:79`），`applyCompletionRepairs` 也保留 `raw`（`:180`） | `extensions` **没有被丢弃，而是原样躺在 `raw` 里从未被显式建模/消费**；`raw` 是导入时快照，不是 ST 的「选中预设的 `settings.extensions` 实时态」 |
| `src/core/types/preset.ts` | `RPCompletionPreset` 只有 `raw?: Record` | 缺 `extensions?: Record<string, unknown>` 一等字段 |
| `src/core/plugins/rpnx.ts:223-235` + `loader.ts:205-211` | ST manifest 被压成 8 字段（`id/name/version/apiVersion/host/description/author/kind/stEntry`），loader 重建时只传 `display_name/version/description/js` | **`hooks`/`requires`/`optional`/`loading_order`/`i18n`/`minimum_client_version` 全部丢失**；见 §2.8 |
| `src/boot.ts:188-196`, `loader.ts:191-224` | 插件在 `boot()` 里注册，安装后 `reloadInstalledPlugins()` 立即重同步 | 激活时预设可能尚未导入/选中，`getContext()` 拿不到当前预设是时序问题；需 CHAT_LOADED / 预设切换后重扫 |

---

## 5. 分节证据文档（子代理产出，本文件索引）

| 文档 | 负责 | 状态 |
|---|---|---|
| [`_st-message-pipeline.md`](_st-message-pipeline.md) | `messageFormatting` 全链路、`.mes_text`/`mesid`、事件表、depth（718 行） | ✅ 已交付，并入 §2.11 |
| [`_th-renderer-contract.md`](_th-renderer-contract.md) | TH 楼层扫描、`Ck` 判定、iframe、事件订阅、生命周期、预设关联（763 行） | ✅ 已交付，并入 §2.14 |
| [`_st-extension-lifecycle.md`](_st-extension-lifecycle.md) | 设置容器/宽度 CSS、模板渲染、生命周期、getContext 字段表、manifest（796+ 行） | ✅ 已交付，并入 §2.6 |
| [`_preset-extensions-inventory.md`](_preset-extensions-inventory.md) | 官方通道、调用点、Meowssiah 全字段清单、SPresetSettings 解析（506 行） | ✅ 已交付，并入 §2.1/§2.13 |
| [`_preset-embedded-runtime.md`](_preset-embedded-runtime.md) | 内嵌运行时逐项依赖表、双向通信、安全边界、验收清单（39.6 KB） | ✅ 已交付，并入 §2.12 |

> **阶段 B 已产出**：[`rpnow-st-compat-contract.md`](rpnow-st-compat-contract.md) —— 四条通道契约冻结、HTML 归属决策、安全边界、C1–C5 文件级任务分解与真机验收门槛。本文（阶段 A 证据）+ 该契约共同构成阶段 C 的施工依据。

---

## 6. 阶段 A 的硬约束（写进实施纪律）

1. **每个新行为在代码注释里标 `[ST-SRC] 路径:行号`**，可回溯到真实源码；不复制 AGPL 源码，只实现开放格式与契约。
2. **正则顺序以 ST 为准**：`global → scoped(卡片) → preset(预设)`，带 trust gate（默认关、逐条审阅、全局 kill switch）。
3. **不再往 `renderer.ts` 加预设特判**：预设标签/围栏形状由正则管线决定，渲染器只负责宿主契约与未安装 TH 时的兜底。
4. **预设外链注入默认阻断**，显式可配置放行，记录为已知限制与安全边界。
5. **设置 UI 收敛到一套容器**：ST 扩展自注入 DOM + `.rpnx` schema 表单都进同一个全宽容器，消除"列表 item 内联"与"隐形 div"两套机制。
6. **真机 CDP e2e 未通过不报完成**：装 TH → 导入 Meowssiah → 产出 `<think_nya>`/`<options>` 楼层 → 断言 `.TH-render` iframe、无源码块泄露、设置面板全宽、0 页面错误。
