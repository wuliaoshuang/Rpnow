# RPNow 插件开发指南

> 这份文档写给要**自己写插件**的人。读完你应该能：打包一个 `.rpnx`、
> 在任意 UI 位置挂载组件、注册服务、并且**不污染** RPNow 自身的样式。
>
> 文档里的每个 API 都有对应的自动化验证：
> `scripts/plugin-api-check.mjs`（13 条）会在真机上装一个示例插件，
> 断言 `ctx.React` / `ctx.SLOT` / `ctx.mountSlot` / `ctx.injectCss` 可用、
> 组件真的渲染到屏幕上、以及**恶意 CSS（`body{padding:17px}`）不会影响应用外壳**。

---

## 目录

1. [快速开始](#1-快速开始)
2. [插件包结构](#2-插件包结构)
3. [manifest 字段](#3-manifest-字段)
4. [生命周期](#4-生命周期)
5. [样式隔离（重要）](#5-样式隔离重要)
6. [插入 UI：任意位置](#6-插入-ui任意位置)
7. [数据与状态](#7-数据与状态)
8. [服务注册](#8-服务注册)
9. [配置项（用户可调）](#9-配置项用户可调)
10. [用 API / 网络 / 密钥](#10-用-api--网络--密钥)
11. [SillyTavern 扩展兼容](#11-sillytavern-扩展兼容)
12. [调试与排错](#12-调试与排错)
13. [检查清单](#13-检查清单)

---

## 1. 快速开始

最小可运行插件只有两个文件：

```
my-plugin/
├── manifest.json
└── plugin.js
```

**manifest.json**

```json
{
  "id": "com.you.my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "apiVersion": 2,
  "author": "you",
  "description": "一句话说明它做什么"
}
```

> `host` 字段可省略，默认 `ui`（界面型插件）；需要宿主运行时的写 `"host"`。

**plugin.js**

```js
export function apply(ctx) {
  ctx.log('我的插件已启动');   // = ctx.logger.info
}
```

打包成 zip，把后缀改成 `.rpnx`，在 **插件管理 → 安装 .rpnx** 里选中即可。
也可以把 zip 上传到 GitHub，在插件页粘贴链接直接安装（见 §11.2）。

---

## 2. 插件包结构

```
my-plugin/
├── manifest.json      必需
├── plugin.js          必需（入口）
├── style.css          可选（通过 ctx.injectCss 注入，见 §5）
├── assets/            可选（图片、字体…）
└── lib/               可选（plugin.js 里用相对路径 import）
```

入口文件的 ES 模块相对导入是支持的（`import { x } from './lib/x.js'`）。

---

## 3. manifest 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 全局唯一，建议反向域名。**不能**含空格 |
| `name` | ✅ | 显示名 |
| `version` | ✅ | 语义化版本，升级时用于覆盖判断 |
| `apiVersion` | ✅ | 目前为 `2` |
| `host` | | `"host"` 或 `"ui"`，默认 `ui` |
| `author` |  | 作者 |
| `description` |  | 简介 |
| `entry` |  | 默认 `plugin.js` |
| `provides` |  | 声明的服务名，如 `["llm"]`；用于「界面插槽」页展示 |
| `uses` |  | 依赖的服务名，缺一不可启动 |
| `config` |  | 用户可视配置（见 §9） |
| `permissions` |  | 如 `["network"]`，见 §10 |

`id` 和 `version` 会参与插件去重：同 `id` 重新安装会走「覆盖安装」确认。

---

## 4. 生命周期

插件入口导出一个 `apply` 函数：

```js
export function apply(ctx) {
  // 启动：注册 UI、服务、事件
  const off = ctx.on('chat:message-sent', (e) => { /* … */ });

  // 返回的清理函数在停用 / 卸载 / 覆盖安装时调用
  return () => {
    off();
  };
}
```

要点：

- `apply` **可以是 async**，返回值可以是清理函数。
- 异常会被捕获并显示为插件的**失败状态**，错误消息直接展示在插件卡片上 ——
  所以请抛出可读的中文错误，不要吞掉异常。
- 停用时 RPNow 会自动清理：该插件注册的 **UI 插槽**、**作用域样式**、
  **内核服务**。
- 但你自己加的 `window` 全局、`setInterval`、`document` 监听**必须自己清**。

```js
export function apply(ctx) {
  const timer = setInterval(tick, 5000);
  let disposed = false;
  const tick = () => { if (!disposed) doWork(); };

  const onKey = (e) => { /* … */ };
  window.addEventListener('keydown', onKey);

  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener('keydown', onKey);
  };
}
```

---

## 5. 样式隔离（重要）

**问题**：如果你把 CSS 直接注入 `document.head`，它的选择器是全局的。
一个 `body { padding: 3px }` 或 `* { margin: 0 }` 会把**整个 RPNow 应用**
往里推 —— 用户看到的是"整页多了一圈边框"。这不是假设：真实设备上量到过
`body padding: 3px`，修掉之后是 `0px`。

**规则**：插件样式必须**限定在自己的作用域内**。

### 5.1 用 `ctx.injectCss()`（推荐）

```js
export function apply(ctx) {
  ctx.injectCss(`
    .my-panel { padding: 12px; border-radius: 12px; }
    .my-panel h3 { font-size: 14px; }
  `);
}
```

RPNow 会把上面的 CSS 自动转换成等价于：

```css
@layer rp-plugin-com.you.my-plugin {
  .my-panel[data-rp-scope] { padding: 12px; border-radius: 12px; }
  .my-panel[data-rp-scope] h3 { font-size: 14px; }
}
```

具体做了四件事：

| 处理 | 效果 |
|---|---|
| 每个选择器追加 `[data-rp-scope]` | 只命中插件自己的 DOM 子树 |
| `html` / `body` / `:root` / `*` → 作用域宿主 | 插件想"设置整页背景"时不会影响 RPNow |
| 整段包进 `@layer rp-plugin-<id>` | **永远**输给应用自身样式（优先级低） |
| 前导的 `html body` 前缀被剥离 | `html body .x` 不会命中真实 `<body>` |

其他自动处理：

- `@media` / `@supports` / `@container` 递归作用域化
- `@keyframes` 名字自动加前缀（`rp-<id>-`），`animation` 引用同步改名
- `@font-face` 原样保留
- **`@import` 会被丢弃**（它会加载未作用域的 CSS）
- 注释会被移除（防止用注释夹带规则）

### 5.2 手动隔离（不推荐，但可行）

如果非要用 Shadow DOM：

```js
export function apply(ctx) {
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' }).innerHTML = `
    <style>:host { all: initial } .x { color: red }</style>
    <div class="x">Hello</div>`;
  document.body.appendChild(host);
  return () => host.remove();
}
```

代价：拿不到 RPNow 的主题变量（`--rp-accent` 等），视觉会割裂。优先用 5.1。

### 5.3 正确使用主题变量

**不要**写死颜色，用变量才能跟随主题切换：

```css
.my-panel {
  background: var(--rp-bg-elevated);
  color: var(--rp-fg);
  border: 1px solid var(--rp-border);
}
.my-panel .muted { color: var(--rp-fg-muted); }
.primary { background: var(--rp-accent); color: var(--rp-accent-fg); }
```

可用变量：`--rp-bg` / `--rp-bg-elevated` / `--rp-bg-sunken` / `--rp-fg` /
`--rp-fg-muted` / `--rp-fg-subtle` / `--rp-border` / `--rp-border-strong` /
`--rp-accent` / `--rp-accent-fg` / `--rp-accent-soft` / `--rp-danger` / `--rp-warn`。

---

## 6. 插入 UI：任意位置

RPNow 的界面上**预埋了命名插槽（slot）**，你往任意一个插槽里注册组件，
它就会出现在对应位置 —— 不需要改 RPNow 的代码。

```js
export function apply(ctx) {
  ctx.mountSlot('chat.composer', function MyBar({ chat, card }) {
    return ctx.React.createElement('div', { className: 'my-panel' },
      `当前角色：${card?.data?.name ?? '无'}`);
  });
}
```

> 没有 JSX 构建流程也没关系 —— 用 `ctx.React.createElement` 即可。

### 6.1 全部插槽

| 插槽常量 | 字符串 | 位置 | 传给组件的 props |
|---|---|---|---|
| `ctx.SLOT.APP_SHELL` | `app.shell` | 整个应用外壳（替换即换肤） | `{ children }` |
| `ctx.SLOT.NAV` | `app.nav` | 桌面端左侧导航栏底部 | `{ route, onNavigate }` |
| `ctx.SLOT.TOPBAR` | `app.topbar` | 顶栏右侧动作区 | `{ route, onNavigate }` |
| `ctx.SLOT.OVERLAY` | `app.overlay` | 主区域最上层（浮层/全局小部件） | `{ route }` |
| `ctx.SLOT.MESSAGE` | `chat.message` | 每条消息气泡（可替换整个气泡） | `{ message, card }` |
| `ctx.SLOT.MESSAGE_ACTIONS` | `chat.message.actions` | 消息操作行追加按钮 | `{ message, card }` |
| `ctx.SLOT.COMPOSER` | `chat.composer` | 聊天输入区**上方** | `{ chat, card }` |
| `ctx.SLOT.CHAT_SIDEBAR` | `chat.sidebar` | 聊天右侧面板 | `{ chat, card }` |
| `ctx.SLOT.CARD_TILE` | `cards.tile` | 每张角色卡下 | `{ card }` |
| `ctx.SLOT.CARD_EDITOR` | `cards.editor` | 角色卡编辑器「高级」页签 | `{ card, data }` |
| `ctx.SLOT.LORE_ENTRY` | `lore.entry` | 世界书页工具栏 | `{ books }` |
| `ctx.SLOT.SETTINGS` | `settings.body` | 设置目录页底部 | — |

### 6.2 顺序与叠加

同一插槽可以被多个插件（和 RPNow 自身）同时占用：

```js
ctx.mountSlot('chat.message.actions', MyButton, { order: 10 }); // 越小越靠前
```

- `order` **越小优先级越高**；RPNow 自带的兜底实现是 `100`。
- 想**替换**某个位置的默认实现（例如整个消息气泡），用 `order: 0`。
- 想**追加**在旁边，用 `order: 100` 以上。

### 6.3 拿到 React

```js
export function apply(ctx) {
  const React = ctx.React;            // React 本体
  ctx.mountSlot('app.overlay', function Badge() {
    return React.createElement('div', { className: 'my-badge' }, '插件运行中');
  });
}
```

### 6.4 插槽组件里的 hooks 规则

组件就是普通 React 组件，可以自由用 `useState` / `useEffect`。
**不要**在插槽组件里调用 `ctx.mountSlot`（会随每次渲染重复注册）。

---

## 7. 数据与状态

`ctx.rpnow` 是数据接口，**同步**读取当前状态：

```js
export function apply(ctx) {
  ctx.mountSlot('app.overlay', function Stat() {
    const s = ctx.rpnow.getState();
    return ctx.React.createElement('div', { className: 'my-badge' },
      `${s.chats.length} 个会话 · ${s.cards.length} 张卡`);
  });
}
```

常用字段：`cards` / `chats` / `activeChatId` / `lorebooks` / `presets` /
`personas` / `settings` / `memories` / `llmConnections`。

写入请走 store 的 action（`saveCard` / `saveChat` / `setSettings`…），
不要直接改对象。

---

## 8. 服务注册

插件可以提供内核服务，供其他插件（和 RPNow 本身）使用：

```js
export function apply(ctx) {
  ctx.provide('my.translator', {
    translate: async (text, lang) => {
      // …
      return text;
    },
  });
}

// 依赖方：
export function apply(ctx) {
  ctx.requires('my.translator');   // = 声明依赖（同 manifest.uses）
  const t = ctx.get('my.translator');   // 取服务；ctx.use() 是「登记可释放资源」
  // …
}
```

服务在插件停用时自动注销。

---

## 9. 配置项（用户可调）

在 manifest 里声明 `config`，RPNow 会自动在插件卡片上生成设置表单：

```json
{
  "config": {
    "apiKey": { "type": "string", "label": "API 密钥", "secret": true },
    "endpoint": { "type": "string", "label": "接口地址", "default": "https://api.example.com" },
    "maxItems": { "type": "number", "label": "最多条数", "default": 5, "min": 1, "max": 50 },
    "enabled": { "type": "boolean", "label": "启用", "default": true },
    "mode": { "type": "select", "label": "模式", "options": ["fast", "accurate"], "default": "fast" }
  }
}
```

读取：

```js
export function apply(ctx) {
  const cfg = ctx.config.get();      // 当前值（含 manifest 默认值合并）
  ctx.config.onChange((next) => { /* 重新初始化 */ });
  // 便捷写法：ctx.readConfig()
}
```

| 类型 | 说明 |
|---|---|
| `string` | 文本；`secret: true` 会用密码框并遮蔽 |
| `number` | 数字；支持 `min` / `max` |
| `boolean` | 开关 |
| `select` | 下拉；`options` 为字符串数组 |

---

## 10. 用 API / 网络 / 密钥

- 用户配置里的 `secret: true` 字段**只存本地存储**，不会同步到任何地方。
- 跨域请求请遵守目标服务的 CORS；RPNow 不做代理（除非用户在设置里开了代理）。
- 声明 `"permissions": ["network"]` 后用户能看清你要联网。
- **不要**把密钥写进插件代码 —— 一定会被打包进插件、被所有人看到。

发请求：

```js
const res = await fetch('https://api.example.com/v1/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.config.get().apiKey}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
});
```

---

## 11. SillyTavern 扩展兼容

RPNow 能直接安装 **酒馆（SillyTavern）扩展**的 zip，不需要改写。

### 11.1 zip 直接导入

扩展的 `manifest.json` 是这种形态（没有 `id` + `entry`，只有 `js` / `css`）：

```json
{
  "display_name": "酒馆助手",
  "name": "JS-Slash-Runner",
  "version": "4.12.1",
  "js": "index.js",
  "css": "style.css"
}
```

RPNow 会自动识别为 `st-extension`，并做以下事情：

| 能力 | 说明 |
|---|---|
| 多文件 ES 模块 | 按目录树收集全部 `.js`，相对路径 `import`（含 `../` 跨级、省略 `.js`、目录 `index.js`、动态 `import()`）全部解析 |
| `SillyTavern` 全局 | `getContext()`（chat / characters / name1 / name2 / eventSource / eventTypes / extensionSettings / power_user / saveSettingsDebounced / getRequestHeaders / generate）、`eventSource.on/once/off/emit`、`tavern_helper` |
| 事件桥接 | RPNow 内核事件 `chat:message-sent` 等转发成 ST 事件 |
| 设置持久化 | 按插件 id 存本地，命名空间 `rpnow:st:<id>` |
| 样式 | 走 §5 的作用域化，**不会污染**主界面 |
| 卸载 | 清理样式、监听器、全局、模块 blob |

**打包要求**：zip 里可以直接是 `manifest.json`，也可以套一层目录
（GitHub 「Download ZIP」那种 `repo-main/manifest.json`）。

**不支持**：裸模块依赖（`import x from 'lodash'`）。这类包需要作者提供
打包好的单文件版本，否则会提示「依赖了包外模块：lodash」。

### 11.2 从 GitHub 安装

插件管理页有「从 GitHub 安装」输入框，支持：

- `https://github.com/用户/仓库`
- `https://github.com/用户/仓库/tree/分支/子目录`
- `用户/仓库`
- 带 `.git` 后缀、带尾斜杠

安装流程：目录里有 `manifest.json` → 只抓入口脚本 + css；
否则下载分支 zip，在 `dist/` / `build/` / `package/` 找构建好的包。
都不是则**明确报错，不安装任何东西**。

---

## 12. 调试与排错

### 12.1 看错误

插件卡片上的红色文字就是 `apply()` 抛出的错误消息。请让消息可操作，
例如「缺少 API 密钥，请先在插件设置里填写」而不是 `undefined is not a function`。

### 12.2 真机 / WebView 调试

RPNow 的 WebView **始终**开启远程调试（`release` 包也一样）：

```bash
adb shell cat /proc/net/unix | grep webview_devtools_remote
adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>
# 浏览器打开 http://127.0.0.1:9222/json
```

这能抓到真机上的 DOM 与计算样式 —— 排查"整页多了一圈边框"这类问题
（`body` 被插件 padding）靠的就是它。

### 12.3 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 卡片显示「失败」+ `Cannot use import statement outside a module` | 用了 ES 模块语法但被打包成普通脚本 → 确保是 `import`/`export` 写法（RPNow 会自动识别并按模块加载） |
| 「依赖了包外模块：xxx。包内文件：…」 | 要么装的是源码仓库（没构建），要么真的用了外部依赖。看提示里的包内文件列表判断 |
| 插件装上但界面没变化 | 插槽名字写错，或 `order` 被更高优先级的实现盖住（用 `order: 0` 替换） |
| 样式影响了别的地方 | 没走 `ctx.injectCss()`，直接改 `document.head` 了 |
| 停用后还有副作用 | `setInterval` / 全局监听没在清理函数里释放 |
| 停用后样式没消失 | 已通过 `removeScopedStylesByOwner` 自动清理；若仍残留，检查是否用了非 `injectCss` 的注入方式 |

---

## 13. 检查清单

发布前过一遍：

- [ ] `manifest.json` 有唯一的 `id`、递增的 `version`
- [ ] `apply()` 捕获了所有可能的错误，并抛出**可读的中文消息**
- [ ] 返回的清理函数释放了所有定时器、监听器、全局变量
- [ ] 所有 CSS 都通过 `ctx.injectCss()` 注入，**没有**直接操作 `document.head`
- [ ] 颜色用 `var(--rp-*)` 主题变量，深色/浅色主题都验证过
- [ ] 插槽组件不会随渲染重复注册插槽
- [ ] 用户可调的参数都放进了 `manifest.config`，密钥标了 `secret: true`
- [ ] 在真机上装过一次，确认没有布局/样式副作用

---

## 附：完整示例

一个在聊天输入框上方显示"本会话字数"的插件。

```json
{
  "id": "com.example.wordcount",
  "name": "字数统计",
  "version": "1.0.0",
  "apiVersion": 2,
  "author": "example",
  "description": "在输入区上方显示本会话的总字数",
  "config": {
    "showDetails": { "type": "boolean", "label": "显示消息条数", "default": true }
  }
}
```

```js
export function apply(ctx) {
  const React = ctx.React;

  ctx.injectCss(`
    .wc-bar {
      display: flex; gap: 10px; align-items: center;
      padding: 6px 12px; font-size: 11.5px;
      color: var(--rp-fg-muted);
      background: var(--rp-bg-sunken);
      border-radius: 999px;
    }
    .wc-bar .n { color: var(--rp-fg); font-weight: 600; font-variant-numeric: tabular-nums; }
  `);

  function WordCount({ chat }) {
    const cfg = ctx.config.get();
    const msgs = chat?.messages ?? [];
    const chars = msgs.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    return React.createElement(
      'div',
      { className: 'wc-bar' },
      React.createElement('span', null, '字数 ', React.createElement('span', { className: 'n' }, chars)),
      cfg.showDetails
        ? React.createElement('span', null, '· ', msgs.length, ' 条')
        : null,
    );
  }

  ctx.mountSlot('chat.composer', WordCount, { order: 50 });
}
```

打包成 `wordcount.rpnx` → 插件管理 → 安装 → 打开任意聊天即可看到。


> 这份文档写给要**自己写插件**的人。读完你应该能：打包一个 `.rpnx`、
> 在任意 UI 位置挂载组件、注册服务、并且**不污染** RPNow 自身的样式。

---

## 目录

1. [快速开始](#1-快速开始)
2. [插件包结构](#2-插件包结构)
3. [manifest 字段](#3-manifest-字段)
4. [生命周期](#4-生命周期)
5. [样式隔离（重要）](#5-样式隔离重要)
6. [插入 UI：任意位置](#6-插入-ui任意位置)
7. [数据与状态](#7-数据与状态)
8. [服务注册](#8-服务注册)
9. [配置项（用户可调）](#9-配置项用户可调)
10. [用 API / 网络 / 密钥](#10-用-api--网络--密钥)
11. [SillyTavern 扩展兼容](#11-sillytavern-扩展兼容)
12. [调试与排错](#12-调试与排错)
13. [检查清单](#13-检查清单)

---

## 1. 快速开始

最小可运行插件只有两个文件：

```
my-plugin/
├── manifest.json
└── plugin.js
```

**manifest.json**

```json
{
  "id": "com.you.my-plugin",
  "name": "我的插件",
  "version": "0.1.0",
  "apiVersion": 2,
  "author": "you",
  "description": "一句话说明它做什么"
}
```

**plugin.js**

```js
export function apply(ctx) {
  ctx.log('我的插件已启动');   // = ctx.logger.info
}
```

打包成 zip，把后缀改成 `.rpnx`，在 **插件管理 → 安装 .rpnx** 里选中即可。
也可以把 zip 上传到 GitHub，在插件页粘贴链接直接安装（见 §11.2）。

---

## 2. 插件包结构

```
my-plugin/
├── manifest.json      必需
├── plugin.js          必需（入口）
├── style.css          可选（需要时自己 inject，见 §5）
├── assets/            可选（图片、字体…）
└── lib/               可选（plugin.js 里用相对路径 import）
```

入口文件的 ES 模块相对导入是支持的（`import { x } from './lib/x.js'`）。

---

## 3. manifest 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | ✅ | 全局唯一，建议反向域名。**不能**含空格 |
| `name` | ✅ | 显示名 |
| `version` | ✅ | 语义化版本，升级时用于覆盖判断 |
| `apiVersion` | ✅ | 目前为 `2` |
| `author` |  | 作者 |
| `description` |  | 简介 |
| `entry` |  | 默认 `plugin.js` |
| `provides` |  | 声明的服务名，如 `["llm"]`；用于「界面插槽」页展示 |
| `requires` |  | 依赖的服务名，缺一不可启动 |
| `config` |  | 用户可视配置（见 §9） |
| `permissions` |  | 如 `["network"]`，见 §10 |

`id` 和 `version` 会参与插件去重：同 `id` 重新安装会走「覆盖安装」确认。

---

## 4. 生命周期

插件入口导出一个 `apply` 函数：

```js
export function apply(ctx) {
  // 启动：注册 UI、服务、事件
  const off = ctx.on('chat:message-sent', (e) => { /* … */ });

  // 返回的清理函数在停用 / 卸载 / 覆盖安装时调用
  return () => {
    off();
  };
}
```

要点：

- `apply` **可以是 async**，返回值可以是清理函数。
- 异常会被捕获并显示为插件的**失败状态**，错误消息直接展示在插件卡片上 ——
  所以请抛出可读的中文错误，不要吞掉异常。
- 停用时 RPNow 会自动清理：该插件注册的 **UI 插槽** 和 **内核服务**。
  但你自己加的 `window` 全局、`setInterval`、`document` 监听**必须自己清**。

```js
export function apply(ctx) {
  const timer = setInterval(tick, 5000);
  let disposed = false;
  const tick = () => { if (!disposed) doWork(); };

  const onKey = (e) => { /* … */ };
  window.addEventListener('keydown', onKey);

  return () => {
    disposed = true;
    clearInterval(timer);
    window.removeEventListener('keydown', onKey);
  };
}
```

---

## 5. 样式隔离（重要）

**问题**：如果你把 CSS 直接注入 `document.head`，它的选择器是全局的。
一个 `body { padding: 3px }` 或 `* { margin: 0 }` 会把**整个 RPNow 应用**
往里推 3px —— 用户看到的是"整页多了一圈边框"。这不是假设，是真实发生过的 bug。

**规则**：插件样式必须**限定在自己的作用域内**。

### 5.1 用 `ctx.injectCss()`（推荐）

```js
export function apply(ctx) {
  ctx.injectCss(`
    .my-panel { padding: 12px; border-radius: 12px; }
    .my-panel h3 { font-size: 14px; }
  `);
}
```

RPNow 会把上面的 CSS 自动转换成等价于：

```css
@layer rp-plugin-com.you.my-plugin {
  .my-panel[data-rp-scope] { padding: 12px; border-radius: 12px; }
  .my-panel[data-rp-scope] h3 { font-size: 14px; }
}
```

具体做了三件事：

| 处理 | 效果 |
|---|---|
| 每个选择器追加 `[data-rp-scope]` | 只命中插件自己的 DOM 子树 |
| `html` / `body` / `:root` / `*` → 作用域宿主 | 插件想"设置整页背景"时不会影响 RPNow |
| 整段包进 `@layer rp-plugin-<id>` | **永远**输给应用自身样式（优先级低） |

其他自动处理：

- `@media` / `@supports` / `@container` 会递归作用域化
- `@keyframes` 名字自动加前缀（`rp-<id>-`），`animation` 引用同步改名
- `@font-face` 原样保留
- **`@import` 会被丢弃**（它会加载未作用域的 CSS）
- 注释会被移除（防止用注释夹带规则）

### 5.2 手动隔离（不推荐，但可行）

如果非要用 Shadow DOM：

```js
export function apply(ctx) {
  const host = document.createElement('div');
  host.attachShadow({ mode: 'open' }).innerHTML = `
    <style>:host { all: initial } .x { color: red }</style>
    <div class="x">Hello</div>`;
  document.body.appendChild(host);
  return () => host.remove();
}
```

代价：拿不到 RPNow 的主题变量（`--rp-accent` 等），视觉会割裂。优先用 5.1。

### 5.3 正确使用主题变量

**不要**写死颜色，用变量才能跟随主题切换：

```css
.my-panel {
  background: var(--rp-bg-elevated);
  color: var(--rp-fg);
  border: 1px solid var(--rp-border);
}
.my-panel .muted { color: var(--rp-fg-muted); }
.primary { background: var(--rp-accent); color: var(--rp-accent-fg); }
```

可用变量：`--rp-bg` / `--rp-bg-elevated` / `--rp-bg-sunken` / `--rp-fg` /
`--rp-fg-muted` / `--rp-fg-subtle` / `--rp-border` / `--rp-border-strong` /
`--rp-accent` / `--rp-accent-fg` / `--rp-accent-soft` / `--rp-danger` / `--rp-warn`。

---

## 6. 插入 UI：任意位置

RPNow 的界面上**预埋了命名插槽（slot）**，你往任意一个插槽里注册组件，
它就会出现在对应位置 —— 不需要改 RPNow 的代码。

```js
import * as React from 'react';

export function apply(ctx) {
  ctx.mountSlot('chat.composer', function MyBar({ chat, card }) {
    return React.createElement('div', { className: 'my-panel' },
      `当前角色：${card?.data?.name ?? '无'}`);
  });
}
```

> 没有 JSX 构建流程也没关系 —— 用 `React.createElement` 即可，
> `React` 可以从 `ctx.React` 拿到（见下）。

### 6.1 全部插槽

| 插槽常量 | 字符串 | 位置 | 传给组件的 props |
|---|---|---|---|
| `ctx.SLOT.APP_SHELL` | `app.shell` | 整个应用外壳（替换即换肤） | `{ children }` |
| `ctx.SLOT.NAV` | `app.nav` | 桌面端左侧导航栏底部 | `{ route, onNavigate }` |
| `ctx.SLOT.TOPBAR` | `app.topbar` | 顶栏右侧动作区 | `{ route, onNavigate }` |
| `ctx.SLOT.OVERLAY` | `app.overlay` | 主区域最上层（浮层/全局小部件） | `{ route }` |
| `ctx.SLOT.MESSAGE` | `chat.message` | 每条消息气泡（可替换整个气泡） | `{ message, card }` |
| `ctx.SLOT.MESSAGE_ACTIONS` | `chat.message.actions` | 消息操作行追加按钮 | `{ message, card }` |
| `ctx.SLOT.COMPOSER` | `chat.composer` | 聊天输入区**上方** | `{ chat, card }` |
| `ctx.SLOT.CHAT_SIDEBAR` | `chat.sidebar` | 聊天右侧面板 | `{ chat, card }` |
| `ctx.SLOT.CARD_TILE` | `cards.tile` | 每张角色卡下 | `{ card }` |
| `ctx.SLOT.CARD_EDITOR` | `cards.editor` | 角色卡编辑器「高级」页签 | `{ card, data }` |
| `ctx.SLOT.LORE_ENTRY` | `lore.entry` | 世界书页工具栏 | `{ books }` |
| `ctx.SLOT.SETTINGS` | `settings.body` | 设置目录页底部 | — |

### 6.2 顺序与叠加

同一插槽可以被多个插件（和 RPNow 自身）同时占用：

```js
ctx.mountSlot('chat.message.actions', MyButton, { order: 10 }); // 越小越靠前
```

- `order` **越小优先级越高**；RPNow 自带的兜底实现是 `100`。
- 想**替换**某个位置的默认实现（例如整个消息气泡），用 `order: 0`。
- 想**追加**在旁边，用 `order: 100` 以上。

### 6.3 拿到 React

```js
export function apply(ctx) {
  const React = ctx.React;            // React 本体
  ctx.mountSlot('app.overlay', function Badge() {
    return React.createElement('div', { className: 'my-badge' }, '插件运行中');
  });
}
```

### 6.4 插槽组件里的 hooks 规则

组件就是普通 React 组件，可以自由用 `useState` / `useEffect`。
**不要**在插槽组件里调用 `ctx.mountSlot`（会随每次渲染重复注册）。

---

## 7. 数据与状态

`ctx.rpnow` 是只读数据接口，**同步**读取当前状态：

```js
export function apply(ctx) {
  ctx.mountSlot('app.overlay', function Stat() {
    const s = ctx.rpnow.getState();
    return ctx.React.createElement('div', { className: 'my-badge' },
      `${s.chats.length} 个会话 · ${s.cards.length} 张卡`);
  });
}
```

常用字段：`cards` / `chats` / `activeChatId` / `lorebooks` / `presets` /
`personas` / `settings` / `memories` / `llmConnections`。

写入请走 store 的 action（`saveCard` / `saveChat` / `setSettings`…），
不要直接改对象。

---

## 8. 服务注册

插件可以提供内核服务，供其他插件（和 RPNow 本身）使用：

```js
export function apply(ctx) {
  ctx.provide('my.translator', {
    translate: async (text, lang) => {
      // …
      return text;
    },
  });
}

// 依赖方：
export function apply(ctx) {
  ctx.requires('my.translator');   // = 声明依赖（同 manifest.uses）
  const t = ctx.get('my.translator');   // 取服务；ctx.use() 是「登记可释放资源」
  // …
}
```

服务在插件停用时自动注销。

---

## 9. 配置项（用户可调）

在 manifest 里声明 `config`，RPNow 会自动在插件卡片上生成设置表单：

```json
{
  "config": {
    "apiKey": { "type": "string", "label": "API 密钥", "secret": true },
    "endpoint": { "type": "string", "label": "接口地址", "default": "https://api.example.com" },
    "maxItems": { "type": "number", "label": "最多条数", "default": 5, "min": 1, "max": 50 },
    "enabled": { "type": "boolean", "label": "启用", "default": true },
    "mode": { "type": "select", "label": "模式", "options": ["fast", "accurate"], "default": "fast" }
  }
}
```

读取：

```js
export function apply(ctx) {
  const cfg = ctx.config.get();      // 当前值（含 manifest 默认值合并）
  ctx.config.onChange((next) => { /* 重新初始化 */ });
  // 便捷写法：ctx.readConfig()
}
```

| 类型 | 说明 |
|---|---|
| `string` | 文本；`secret: true` 会用密码框并遮蔽 |
| `number` | 数字；支持 `min` / `max` |
| `boolean` | 开关 |
| `select` | 下拉；`options` 为字符串数组 |

---

## 10. 用 API / 网络 / 密钥

- 用户配置里的 `secret: true` 字段**只存在本地存储**，不会同步到任何地方。
- 跨域请求请遵守目标服务的 CORS；RPNow 不做代理（除非用户在设置里开了代理）。
- 声明 `"permissions": ["network"]` 后用户能看清你要联网。
- **不要**把密钥写进插件代码 —— 一定会被打包进插件、被所有人看到。

发请求：

```js
const res = await fetch('https://api.example.com/v1/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctx.config.get().apiKey}` },
  body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
});
```

---

## 11. SillyTavern 扩展兼容

RPNow 能直接安装 **酒馆（SillyTavern）扩展**的 zip，不需要改写。

### 11.1 zip 直接导入

扩展的 `manifest.json` 是这种形态（没有 `id` + `entry`，只有 `js` / `css`）：

```json
{
  "display_name": "酒馆助手",
  "name": "JS-Slash-Runner",
  "version": "4.12.1",
  "js": "index.js",
  "css": "style.css"
}
```

RPNow 会自动识别为 `st-extension`，并做以下事情：

| 能力 | 说明 |
|---|---|
| 多文件 ES 模块 | 按目录树收集全部 `.js`，相对路径 `import`（含 `../` 跨级、省略 `.js`、目录 `index.js`、动态 `import()`）全部解析 |
| `SillyTavern` 全局 | `getContext()`（chat / characters / name1 / name2 / eventSource / eventTypes / extensionSettings / power_user / saveSettingsDebounced / getRequestHeaders / generate）、`eventSource.on/once/off/emit`、`tavern_helper` |
| 事件桥接 | RPNow 内核事件 `chat:message-sent` 等转发成 ST 事件 |
| 设置持久化 | 按插件 id 存本地，命名空间 `rpnow:st:<id>` |
| 样式 | 走 §5 的作用域化，**不会污染**主界面 |
| 卸载 | 清理样式、监听器、全局、模块 blob |

**打包要求**：zip 里可以直接是 `manifest.json`，也可以套一层目录
（GitHub 「Download ZIP」那种 `repo-main/manifest.json`）。

**不支持**：裸模块依赖（`import x from 'lodash'`）。这类包需要作者提供
打包好的单文件版本，否则会提示「依赖了包外模块：lodash」。

### 11.2 从 GitHub 安装

插件管理页有「从 GitHub 安装」输入框，支持：

- `https://github.com/用户/仓库`
- `https://github.com/用户/仓库/tree/分支/子目录`
- `用户/仓库`
- 带 `.git` 后缀、带尾斜杠

安装流程：目录里有 `manifest.json` → 只抓入口脚本 + css；
否则下载分支 zip，在 `dist/` / `build/` / `package/` 找构建好的包。
都不是则**明确报错，不安装任何东西**。

---

## 12. 调试与排错

### 12.1 看错误

插件卡片上的红色文字就是 `apply()` 抛出的错误消息。请让消息可操作，
例如「缺少 API 密钥，请先在插件设置里填写」而不是 `undefined is not a function`。

### 12.2 真机 / WebView 调试

RPNow 的 WebView **始终**开启远程调试（`release` 包也一样）：

```bash
adb shell cat /proc/net/unix | grep webview_devtools_remote
adb forward tcp:9222 localabstract:webview_devtools_remote_<PID>
# 浏览器打开 chrome://inspect，或直接连 http://127.0.0.1:9222/json
```

这能抓到真机上的 DOM 与计算样式 —— 排查"整页多了一圈边框"这类问题
（`body` 被插件 padding）靠的就是它。

### 12.3 常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 卡片显示「失败」+ `Cannot use import statement outside a module` | 用了 ES 模块语法但被打包成普通脚本 → 确保是 `import`/`export` 写法（RPNow 会自动识别并按模块加载） |
| 「依赖了包外模块：xxx。包内文件：…」 | 要么装的是源码仓库（没构建），要么真的用了外部依赖。看提示里的包内文件列表判断 |
| 插件装上但界面没变化 | 插槽名字写错，或 `order` 被更高优先级的实现盖住（用 `order: 0` 替换） |
| 样式影响了别的地方 | 没走 `ctx.injectCss()`，直接改 `document.head` 了 |
| 停用后还有副作用 | `setInterval` / 全局监听没在清理函数里释放 |

---

## 13. 检查清单

发布前过一遍：

- [ ] `manifest.json` 有唯一的 `id`、递增的 `version`
- [ ] `apply()` 捕获了所有可能的错误，并抛出**可读的中文消息**
- [ ] 返回的清理函数释放了所有定时器、监听器、全局变量
- [ ] 所有 CSS 都通过 `ctx.injectCss()` 注入，**没有**直接操作 `document.head`
- [ ] 颜色用 `var(--rp-*)` 主题变量，深色/浅色主题都验证过
- [ ] 插槽组件不会随渲染重复注册插槽
- [ ] 用户可调的参数都放进了 `manifest.config`，密钥标了 `secret: true`
- [ ] 在真机上装过一次，确认没有布局/样式副作用

---

## 附：完整示例

一个在聊天输入框上方显示"本会话字数"的插件。

```json
{
  "id": "com.example.wordcount",
  "name": "字数统计",
  "version": "1.0.0",
  "apiVersion": 2,
  "author": "example",
  "description": "在输入区上方显示本会话的总字数",
  "config": {
    "showDetails": { "type": "boolean", "label": "显示消息条数", "default": true }
  }
}
```

```js
export function apply(ctx) {
  const React = ctx.React;

  ctx.injectCss(`
    .wc-bar {
      display: flex; gap: 10px; align-items: center;
      padding: 6px 12px; font-size: 11.5px;
      color: var(--rp-fg-muted);
      background: var(--rp-bg-sunken);
      border-radius: 999px;
    }
    .wc-bar .n { color: var(--rp-fg); font-weight: 600; font-variant-numeric: tabular-nums; }
  `);

  function WordCount({ chat }) {
    const cfg = ctx.config.get();
    const msgs = chat?.messages ?? [];
    const chars = msgs.reduce((n, m) => n + (m.content?.length ?? 0), 0);
    return React.createElement(
      'div',
      { className: 'wc-bar' },
      React.createElement('span', null, '字数 ', React.createElement('span', { className: 'n' }, chars)),
      cfg.showDetails
        ? React.createElement('span', null, '· ', msgs.length, ' 条')
        : null,
    );
  }

  ctx.mountSlot('chat.composer', WordCount, { order: 50 });
}
```

打包成 `wordcount.rpnx` → 插件管理 → 安装 → 打开任意聊天即可看到。
