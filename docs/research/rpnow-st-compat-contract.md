# RPNow ↔ SillyTavern 兼容契约（阶段 B 定稿）

> 依据：[`st-plugin-preset-coupling.md`](st-plugin-preset-coupling.md)（阶段 A 主证据）及其 5 个分节。
> 本文是**改造前的设计冻结**：每条契约都标注 `[ST-SRC]`/`[TH-PKG]` 证据与对应验收项。
> 法律边界：只实现开放格式与契约，不复制 AGPL 源码。

---

## 0. 一句话原则

**RPNow 只做「平台」该做的事：把预设产物变成符合 ST 契约的楼层 DOM 与事件；HTML 的渲染交给插件（TH）自己按 `Ck` 判定并挂 iframe。** 不再由渲染器替插件猜预设吐什么形状。

---

## 1. 四条关联通道（冻结）

### 通道 1｜数据：插件读取预设 `extensions`

| 契约 | 内容 | 证据 |
|---|---|---|
| D1 | 预设对象上保留**完整 `extensions` 原文**（`Record<string,unknown>`），导入/保存不丢字段 | `[PRESET]` `cardImport.ts:79` 已存进 `raw`，但无显式建模 |
| D2 | 提供 `readPresetExtensionField(preset, {name?, path})`：空 `path` 取整块；非空走 lodash.get 任意点号；找不到返回 `null` | `[ST-SRC] preset-manager.js:853-873` |
| D3 | 提供 `writePresetExtensionField(...)`：**双写**（运行时份 + 文件份） | `[ST-SRC] preset-manager.js:883-908` |
| D4 | **优先读运行时份**（选中预设时的 `settings.extensions` 等价物） | `[ST-SRC] openai.js:5052-5054` 等 |
| D5 | 命名空间**不可白名单**：`SPreset.*` / `tavern_helper.*` / 未来任意 key 都必须可读写 | `[TH-PKG] tavern_regex.ts:129` 直读；`preset.ts:9/20/33` 写 `tavern_helper` |
| D6 | `SPresetSettings` 这类「数据通道 prompt」（`enabled:false`、不在 `prompt_order`）**不得当提示词注入**，但 content JSON 要保留 | `[PRESET]` §2.13 |

**我方缺口**：只有 `extractPresetDisplayRegexes()` 硬编码两个载体；`RPPreset` 无 `extensions` 字段。

### 通道 2｜运行时：`getContext()` 与宿主全局

必须提供（★=硬依赖，缺则对应功能不可用）：

- ★ `chat`、`characters`、`name1/name2`、`characterId`、`chatId/getCurrentChatId`
- ★ **`chatCompletionSettings`**（`prompts` / `prompt_order` / `openai_max_context`）——预设门控直读它，我方当前**完全没有**
- ★ `extensionSettings`（单一对象，可被插件写入 `['tavern_helper']` 等命名空间）+ `saveSettingsDebounced()`
- ★ `eventSource`（`on/once/off/emit/makeFirst/makeLast`，多参数透传）+ `eventTypes`/`event_types` 常量表
- ★ `generate`、`getRequestHeaders`、`messageFormatting`
- `getRegexedString` / `regex_placement`（**真实实现**，非 `(s)=>s`）
- `getPresetManager()`（D2/D3）、`renderExtensionTemplateAsync`、`writeExtensionField`、`getExtensionManifest`
- `powerUserSettings`（camelCase）；`power_user` 按现状作为附加别名保留

**证据**：`[ST-SRC] st-context.js:115-309` 全字段表；`[PRESET]` CatGodOracle 门控读 `chatCompletionSettings.prompts`；`[TH-PKG]` §2.14 持久化四载体。

### 通道 3｜DOM：楼层与设置容器

| 契约 | 内容 | 现状 |
|---|---|---|
| M1 | `#chat` 的**直接子节点**就是 `.mes[mesid=N]`（`N = chat[] 下标`）；布局层用 `display:contents` 或把类挪到 `#chat` 自身 | ❌ 中间夹一层 div（`ChatView.tsx:1130`） |
| M2 | `.mes` 属性：`mesid/is_user/is_system/swipeid/ch_name/type/timestamp` | 部分有（`mesid`/`data-role`） |
| M3 | 正文容器同时带 `.mes_text` 类名（可挂在现有 `.rp-md` 上） | ❌ 只有 `.rp-md` |
| M4 | 正文内 ``` 围栏 → 标准 `<pre><code>`，`code.textContent` 不被污染 | ✅ marked 已产出 pre>code |
| M5 | `#chat > .welcomePanel`（空聊天占位，决定首次重扫时机） | ❌ 无 |
| M6 | `#send_form` / `#send_textarea` / `#send_but` | 部分有，ID 需核对 |
| M7 | `#extensions_settings` **可见且有入口**（独占表面/抽屉），块级全宽 | ❌ append 进 `overflow:hidden` 的 `main`，被裁剪成隐形 |
| M8 | `#qr--bar` / `.qr--buttons`、`#completion_prompt_manager*` | ❌ 无（决定：桩节点或优雅降级） |
| M9 | `#tavern_helper`（TH 自建，挂进 `#extensions_settings`） | 由 TH 创建，宿主只需 M7 |

**证据**：`[TH-PKG] §2.14` DOM 表；`[ST-SRC] index.html:7391-7471` 模板属性集。

### 通道 4｜通信：事件 / postMessage / 存储 / 全局

- **事件**：正文 HTML 写入完成后发 `character_message_rendered(message_id[,type])` / `user_message_rendered(message_id)`；编辑 → `message_updated(id)`；滑动 → `message_swiped(id)`；删除 → `message_deleted(剩余长度)`；聊天载入 → `chatLoaded`（payload `{detail:{id,character}}`）；另需 `app_ready`/`settings_updated`/`chat_id_changed`/`oai_preset_changed_after`/`preset_*`/`character_*`/`generation_*` 等（TH 订阅 ~28 个）。**唯一一条 eventSource**（消除 §2.10 的双总线分裂）。
- **postMessage**：父→子 `{type:'catgod-oracle:theme',theme}`、`{type:'TH_UPDATE_VIEWPORT_HEIGHT'}`；子→父 `{type:'resizeIframe',height}`（TH 实际靠直写 `frameElement.style.height`，此消息无人接，属尽力信号）。宿主统一桥并校验 `origin/source`。
- **存储**：`localStorage` 可读写，但**按 `rpnx:<插件/预设>:` 前缀隔离**映射，避免 `CatGod_Oracle_*` 全局键污染。
- **全局**：`window.top.CatGodOracle` 之类由预设脚本自注入（前提是同源 + 允许注入，默认策略见 §3）。

---

## 2. 显示层 HTML 的归属（核心决策）

**决策：TH 装了就由 TH 渲染，RPNow 不重复渲染。**

- RPNow 的职责收敛为：① 跑正则管线（显示层）→ ② marked 把 ``` 围栏转成 `<pre><code>` → ③ 保证 M1–M4 契约 → ④ 发事件。
- `renderer.ts` 现有的 `escapeCustomTags` + `sandboxHtmlFences` + `htmlCardFrame` 属于**替插件猜形状的第二套渲染器**，与 TH 的 `Ck`/`TH-render` 冲突。处置：
  - `escapeCustomTags`：保留其「预设私有标签转义」语义，但**必须在正则管线之后**、且仅作用于非 HTML 语义标签（避免把已由正则生成的文档再破坏）。
  - `sandboxHtmlFences` / `restoreHtmlCards`：**不再自动替换**为 `rp-html-card` iframe；降为「用户显式预览」路径（已有 `extractHtmlFences`）。
  - 理由：TH 用 `Ck` 判定 `pre` 文本并 `wrap('<div class="TH-render">')`，若 RPNow 先把 `pre` 换成 iframe，TH 就看不到 `pre` → 双重渲染或渲染失效。
- 未安装任何 ST 扩展时，用户仍可在消息操作里「预览 HTML」（`extractHtmlFences` 已实现），不改变安全性。

**兜底与插件共存（细化，避免体验退化）**

「TH 装了就交给 TH」不能以「卸载 TH 后 HTML 卡片消失」为代价。因此 RPNow 的自造 iframe **不删除**，改为**让路**：

- `st-host-runtime.ts` 维护一个全局标记 `frontendRendererActive`（首个 ST 扩展的 `activate`/DOM-ready 初始化链置位）。
- `renderer.ts` 仅在 **`frontendRendererActive === false`** 时启用 `sandboxHtmlFences` + `rp-html-card`；为 true 时只产出标准 `<pre><code>`，由插件接管。
- 这样：未装插件 → 现有 `.rpnx` 用户行为不变；装了 TH → TH 的 `Ck`/`TH-render` 生效，不会双重渲染。

**验收**：装了 TH 时，`#chat > .mes[mesid=N] .mes_text` 内出现 `div.TH-render > iframe#TH-message--N--0`，原 `pre` 被隐藏，页面无明文源码泄露；卸载 TH 后恢复 RPNow 兜底卡片。

---

## 3. 安全与边界（冻结）

| # | 策略 |
|---|---|
| S1 | 预设产生的**远程脚本注入默认阻断**（Meowssiah 有两份 loader、两个外链域名），提供白名单开关 + 审计日志 |
| S2 | 预设正则默认 **trust gate 关闭**（对齐 ST `character_allowed_regex`/`preset_allowed_regex`），UI 提供逐条审阅与全局 kill switch |
| S3 | `$1`（模型可控文本）进入 iframe 前**必须净化**；iframe sandbox 需在「隔离」与「`window.parent` 兼容」间显式取舍（TH 自己**不设 sandbox**，见 §2.14） |
| S4 | `localStorage` 前缀隔离；`postMessage` 校验 `origin/source`；跨域 `window.top` 访问依赖同源，保留 try/catch 回退 |
| S5 | 父文档遍历类操作（`removeOwnIframe`）允许但审计 |
| S6 | `getContext().extensionSettings` 写操作走节流保存 + 命名空间前缀/配额 |

---

## 4. 阶段 C 任务分解（文件级）

> 顺序硬约束：C1 → C2 → C3/C4 → C5 → D。每个任务都可独立测试。

### C1 预设模型与导入保真
- `src/core/types/preset.ts`：`RPCompletionPreset` 等增加 `extensions?: Record<string, unknown>`；新增 `PresetExtensions` 类型。
- `src/features/import/cardImport.ts`：`normalizePreset` 写入 `extensions`（同时保留 `raw`）；补 `applyCompletionRepairs` 不动 `extensions`。
- 新建 `src/core/prompt/preset-extensions.ts`：`readPresetExtensionField` / `writePresetExtensionField` / `getPresetRegexScripts` / `getPresetHelperScripts`（纯函数 + 单测）。
- 验收：Meowssiah 导入后 8 条正则 + 2 个 `tavern_helper.scripts` + `SPreset` 全字段字节数与源文件一致（按紧凑 JSON 口径）。

### C2 正则引擎地基
- 新建 `src/core/prompt/regex-engine.ts`：复刻 `[ST-SRC] regex/engine.js` 的三层来源与顺序（**global → scoped → preset**）、`regex_placement` 全量枚举、`getRegexedString(text, placement, {isMarkdown,isPrompt,isEdit,depth,characterOverride})` 真值表、`runRegexScript`（`{{match}}`/`$<name>`/`trimStrings`/`substituteRegex` 0-1-2/末尾宏替换）、`regexFromString`、trust gate。
- 重构 `src/features/chat/orchestrator.ts:523 renderMessageText()` 改为调用该引擎（删除简化实现）。
- 暴露 `getRegexedString`/`regex_placement` 给 host binding（替换 `(s)=>s` stub）。
- 验收：照 `formats.md:1105-1194` 的真值表建单测（placement/markdown/prompt/depth/trimStrings/坏 flags）。

### C3 楼层 DOM 与事件契约
- `ChatView.tsx`：去掉 `#chat` 与 `.mes` 之间的包裹层（或改 `display:contents`）；加 `#chat > .welcomePanel` 空态；windowing 不改 `mesid` 映射。
- `MessageBubble.tsx`：正文容器加 `.mes_text` 类名；`.mes` 补齐属性（`is_user`/`is_system`/`ch_name` 等）。
- 事件：新增 `chat:message-*` → ST 名的完整映射（含 `chatLoaded` 对象 payload、`message_deleted` 传剩余长度）；消除双总线（`publishHostState` 的 `eventSource` 改动态 getter 或提前 `setSharedEventBus`）。
- `renderer.ts`：按 §2 处置（不再自动包 iframe）。
- 验收：CDP 断言 `#chat > .mes[mesid="N"] .mes_text` 存在且 `pre>code` 文本干净。

### C4 扩展宿主运行时
- `st-manifest.ts`：`STM` 补 `hooks/requires/optional/dependencies/loading_order/i18n/minimum_client_version/auto_update/generate_interceptor`。
- `rpnx.ts`：原始 ST manifest 全文存 `assets['__st__/manifest.json']`；`loader.ts` 原样透传给 `activateSTExtension`。
- `st-bridge.ts`：按 ST `callExtensionHook` 调 `hooks.activate`（+ `enable/disable/install/clean`）；`getContext()` 补 `chatCompletionSettings`、`presetManager`(D2/D3)、`renderExtensionTemplateAsync`、`writeExtensionField`、`getExtensionManifest`、真实 `getRegexedString`；统一 eventSource。
- `st-host-runtime.ts`：把 `#extensions_settings` 迁移到可见容器（与 C5 联动）；`VALUE_BINDINGS` 中语义型绑定分级接真实服务。
- 验收：单测 + dev e2e（TH 激活后 `#tavern_helper` 出现在可见设置面板，非隐形）。

### C5 插件设置 UI 收敛与宽度修复
- 新建可见的「扩展设置」表面（独占抽屉或设置页区块），承载 `#extensions_settings` + 每插件 `#<pluginId>_container`。
- `.rpnx` 原生 `config` schema 表单（`PluginSettings`）迁入同一表面；两套机制合并为一套（容器 + 持久化 + 事件时序由宿主负责，DOM 由插件负责）。
- 宽度：容器 `width:100%`、脱离 `min-w-0 flex-1` 挤压、避免 `overflow-hidden` 祖先；移动端不两栏。
- 验收：真机上设置项全宽、无裁剪；展开/收起正常。

---

## 5. 阶段 D 验收门槛（真机）

`adb install -r -t` 覆盖安装 → force-stop/重启 → 装 TH → 导入 Meowssiah → 产生活动楼层 → CDP（`127.0.0.1:9222`）断言：

1. `#chat > .mes[mesid=N] .mes_text` 内出现 `div.TH-render > iframe#TH-message--N--0`；
2. `pre` 原文（`<!DOCTYPE html>`）不出现在可见文本中（无源码泄露）；
3. 预设标签按正则结果处理（显示层 5 条生效）；
4. 设置面板可见且全宽无裁剪；`#tavern_helper` 已挂载；
5. 控制台 0 页面错误；
6. 单元测试 ≥ 现有 342 + 新增引擎用例，全绿。

**未跑真机不交付。**
