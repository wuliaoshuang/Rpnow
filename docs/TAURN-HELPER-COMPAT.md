# 酒馆助手（Tavern Helper）兼容性 —— 调查报告

> ⛔ **状态：已停用（默认隐藏）**。RPNow 不再投入 SillyTavern 扩展兼容。
> - 安装 ST 扩展（含酒馆助手）会被明确拒绝：`core/plugins/rpnx.ts` 在开关
>   `settings.stCompat.enabled === false`（默认）时直接报错「这是 SillyTavern
>   扩展，RPNow 当前暂不支持」；`loader.ts` 对旧的 `kind:'st-extension'` 记录同样拒绝激活。
> - UI 不再暴露任何 ST 入口（插件页无「扩展设置/扩展抽屉」，GitHub 安装仅接受 `.rpnx`）。
> - 渲染器改用自有容器 `rp-frontend-render`，不再产生 `TH-render`。
> - 兼容代码保留在 `core/plugins/st-*`，便于将来需要时恢复；恢复方式即打开上述开关。
> - 验收脚本：`scripts/st-compat-hidden-check.mjs`（5/5）。
>
> 以下内容为历史调查记录与真机/活体证据，保留作为将来恢复时的参考。

---

调查方式：真机 + **真实发布包**（`N0VI028/JS-Slash-Runner` v4.12.1，2.5 MB）。

## 结论

**酒馆助手不是自包含插件。** 它假设自己运行在 SillyTavern 宿主里，靠目录层级
引用宿主脚本，并直接使用大量宿主全局对象。

## 证据

### 1. 入口脚本引用了 26 个宿主模块（包外）

`dist/index.js`（1.12 MB Vite 产物）开头：

```js
import{…}from"../../../../../scripts/utils.js"
import{getCurrentLocale as f,t as p}from"../../../../../scripts/i18n.js"
import{Generate as m,…,chat as x,characters as b,eventSource as k,…}from"../../../../../script.js"
```

去重后 **26 个宿主文件、152 个绑定**：

| 宿主文件 | 绑定数 |
|---|---|
| `script.js` | 61 |
| `world-info.js` | 20 |
| `openai.js` | 15 |
| `utils.js` | 12 |
| `slash-commands/*.js`（5 个） | 9 |
| `extensions.js` | 4 |
| `personas.js` | 4 |
| `power-user.js` | 3 |
| `slash-commands/SlashCommandArgument.js` | 3 |
| `authors-note.js` | 3 |
| `PromptManager.js` / `RossAscends-mods.js` / `extensions/regex/engine.js` / `i18n.js` / `macros.js` / `popup.js` / `SlashCommandCommonEnumsProvider.js` / `SlashCommandEnumValue.js` | 各 2 |
| 其余 7 个 | 各 1 |

### 2. SillyTavern 为什么能跑

扩展被解压到 `public/scripts/extensions/third-party/<name>/`，
`../../../../../scripts/utils.js` 正好解析到 `public/scripts/utils.js`。
**目录层级就是解析依据**，ST 自己不写解析代码。

### 3. 宿主脚本本身也是交叉引用的 ES 模块

抽样 10 个：`utils.js` ↔ `extensions.js` 循环引用，且都依赖
`../lib.js`、`../script.js`、`./constants.js`、`./group-chats.js` 等。
属于 SillyTavern 整个前端核心，不是几行工具函数。

### 4. 还依赖宿主全局

- `_`（lodash，bundle 内 439 处引用，如 `_.debounce`）
- `$` / `jQuery`
- `hljs`（highlight.js）
- `Popper`
- `toastr`
- `#extensions_settings` DOM 容器（Vue 挂载点）
- `characters` / `chat` / `eventSource` / `name2` 等酒馆全局

## 已完成的工作

### 机制层（已落地，对所有酒馆扩展都是增益）

- `STExtensionFiles.hostModules` + `hostModuleKey()`：
  包外相对引用先查"宿主运行时表"，再落到包内。
- `st-host-runtime.ts`：
  - `installHostGlobals()` —— 注入 `_`/`$`/`jQuery`/`moment`/`DOMPurify`/`Popper`/
    `toastr`/`hljs`，创建 `#extensions_settings` 容器，发布酒馆状态全局；
  - `buildHostShims()` —— 按绑定表生成 26 个宿主模块的 shim；
  - `VALUE_BINDINGS` —— 值型绑定（i18n/设置块/宏/斜杠命令枚举…）给真实值，
    避免被渲染成 `[object Function]`；
  - `makeStubClass()` —— 静态工厂方法（`fromProps`/`registerMacro`…）按需补全，
    不用逐个枚举。

### 验证结果

- ✅ 包解析、单层解包、入口识别、模块树收集
- ✅ **26 个宿主模块的说明符全部解析成功**
- ✅ **扩展可以激活**（`activated: true`，全局与容器就位）
- ❌ Vue 应用未挂载 —— 被深层静态/实例 API 缺失阻断
  （已依次撞到 `promptManager.render`、`MacrosParser.registerMacro`、
  `SlashCommandEnumValue.fromProps`、`….boolean` …）

## 剩余工作量（诚实评估）

这是一个**长尾**：每次补一个 API 就前进一格，但缺失分散在 26 个模块的
静态方法、实例方法、getter 与真实语义里。

- 只让扩展**不报错地加载**：还需要补若干静态方法（可自动代理）。
- 让扩展**功能可用**：需要为 152 个绑定中的相当一部分提供真实语义
  （斜杠命令、世界书、提示词管理、消息操作…），工作量大且会反复。

## 建议

1. **自包含型酒馆扩展**（如 `SillyTavern/Extension-WebSearch`）已经**完全可用**，
   无需任何额外工作。
2. 酒馆助手这类**宿主依赖型**扩展，建议：
   - 要么作为独立阶段单独立项，按"加载 → 挂载 → 功能"三步推进；
   - 要么等作者提供自包含构建。
3. 当前代码**不影响任何现有功能**（回归 342 单测 + 全部 e2e 通过）。

---

# 真机实测补充（第 43 轮）：渲染链的最后一环

真机（设备 UWO7RGLB7LRWWSBQ，rel56）实测结果把问题精确定位到了**宿主 shim**，
而不是 TH 自身：

## 现象

- TH 激活成功，设置面板 `#tavern_helper` 可见且挂载（302 节点）；
- `#chat > .mes[mesid=N]` / `.mes_text` / `pre>code` 契约成立；
- `window.eventSource.emit('chatLoaded')` 后 TH **立即**建出 `<div class="TH-render">`
  并给对应 `pre` 加 `hidden!`、插入「显示前端代码块」按钮 —— 但 **始终没有 iframe**。

## 根因（包内源码级）

TH 的渲染队列读 `chat.length` 与 `chat[mesid]`：

```js
// dist/index.js:535:1977（源 src/store/iframe_runtimes/message.ts:42-56）
const min_showed_message_id = Number($('#chat > .mes').first().attr('mesid'));
return _.range(depth === 0 ? min_showed_message_id : Math.max(min, chat.length - depth), chat.length);
```

而 RPNow 生成的 `scripts/script.js` shim 里 `chat` 是 `VALUE_BINDINGS.chat = []`
的**静态快照**（`export const chat = V.chat`，模块求值时捕获一次）。于是
`_.range(min, 0) === []` → `runtimes` 恒空 → `Render.vue` 的 `Teleport`（`768:70115`）
没有元素可挂 → 永远 0 个 iframe。

我们看到的 `.TH-render` 容器来自**另一条不读 `chat`** 的折叠功能
（`useCollapseCodeBlock`/`AV`，`651:3227`），所以出现了「容器有、按钮有、iframe 无」。

## 修复（已落地）

1. `VALUE_BINDINGS` 移除静态 `chat`，改由 getter 提供 **ST 形状实时数组**
   （`stChatArray()`：`{name,is_user,is_system,mes,send_date,extra}`）；
2. `buildHostShims()` 对 `chat` 生成 **live Proxy**（`LIVE_ARRAY_BINDINGS`），
   每次属性访问都转发到当前数组 —— 否则 `export const chat = V.chat` 仍会捕获快照；
3. 顺带修掉一个视觉隐患：TH 的 CSS 被作用域化后，`.TH-render` / `.hidden!` /
   `.TH-collapse-code-block-button` 这些**跨边界协议类**（渲染进 `#chat`，不在插件
   子树）会失效 → `scoped-styles.ts` 现在对纯协议选择器保持全局。

## 同时落地的可用性兜底（渲染器）

此前页面会把 preset 产出的 HTML 文档**当源码文本显示**（用户反馈「完全不能用」）。
根因是只按 ``` 围栏预处理，模型少打一个围栏就漏。现改为**内容级判定**，复刻 TH 的
`Ck`（`['html>','<head>','body'].some(...)`），命中即渲染成 RPNow 的 HTML 卡片
（`renderer.ts` 的 `sandboxDetectedFrontendCode`），不再依赖设置开关。卡片外层标记
`TH-render`，使 TH 的 `wk()` 视其为已渲染容器而不重复处理。

## 验证

- 桌面：`typecheck` 0；单测 374/374；`html-fence-check` 8/8；`chat-e2e` 15/15
  （含「渲染成卡片」「源码未泄露」断言）；`fence-unit`/`glued-doc-test` 卡片数上升；
- 真机：CDP 派发 `chatLoaded` 后应出现
  `.mes_text .TH-render iframe#TH-message--<mesid>--<idx>`（待 rel57 复测）。
