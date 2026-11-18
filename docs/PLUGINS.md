# RPNow 插件开发（`.rpnx`）

> **范围说明**：RPNow 只支持自己的 `.rpnx` 插件。SillyTavern 扩展（如酒馆助手）
> 的兼容层已默认停用——安装这类包会被明确拒绝；详见
> [TAURN-HELPER-COMPAT.md](TAURN-HELPER-COMPAT.md)。

RPNow 的一切功能都是插件——包括它自己的渲染器、Agent 循环和主题。因此第三方插件
拥有和内置功能完全相同的能力，不存在「只有核心才能做的事」。

## 1. 打包格式

`.rpnx` 就是一个 ZIP：

```
my-plugin.rpnx
├── manifest.json     必需 — 声明身份与依赖
├── plugin.js         必需 — ESM 模块，导出 apply(ctx)
├── README.md         可选 — 在插件页展示
└── assets/           可选 — 主题 CSS、图标等文本资源
```

### manifest.json

```json
{
  "id": "yourname.fancy-theme",
  "name": "华丽主题",
  "version": "1.0.0",
  "description": "替换全部配色的主题插件",
  "author": "你的名字",
  "license": "MIT",
  "apiVersion": 1,
  "host": "host",
  "provides": ["theme"],
  "uses": ["settings"],
  "priority": 100,
  "tags": ["theme"]
}
```

| 字段 | 说明 |
|---|---|
| `id` | 唯一标识，小写字母/数字/点/下划线/横线。不可与已有插件重复 |
| `apiVersion` | 内核 API 版本，当前为 `1`；高于内核版本时只警告不阻止 |
| `host` | `"host"`（内核侧）或 `"ui"`（React 界面侧） |
| `provides` | 本插件提供的服务键。**同名服务会被替换**，这就是「装个主题就换掉原主题」的机制 |
| `uses` | 必须先存在的服务键。缺任何一个，插件停在 `等待依赖` 状态而不报错 |
| `optionalUses` | 软依赖，缺失也能激活 |
| `priority` | 激活顺序提示，数字小的先激活（默认 100） |

## 2. plugin.js

```js
export function apply(ctx) {
  // 这里是插件生命周期
  ctx.logger.info('插件已激活');

  // 返回清理函数（可选）
  return () => ctx.logger.info('插件已停用');
}
```

`apply` 可以返回一个函数或 `{ dispose() }` 对象作为清理回调。除此之外，
通过 `ctx.provide` / `ctx.observe` / `ctx.use` 注册的一切资源都会在停用时自动释放。

## 3. 服务键

| 键 | 接口 | 替换后效果 |
|---|---|---|
| `llm` | `LLMService` | 更换全部模型传输实现 |
| `agentLoop` | `AgentLoop` | 更换对话生成循环（单轮 / 多阶段 / 带工具） |
| `renderer` | `RendererService` | 更换消息渲染（Markdown / HTML 净化策略） |
| `theme` | `ThemeService` | 更换整套配色 |
| `image` | `ImageService` | 更换出图实现 |
| `settings` | `SettingsService` | 更换设置存储 |
| `prompt` / `worldbook` 等 | 见 `src/core/plugin/kernel-types.ts` | — |

## 4. 数据 API

`ctx.rpnow` 是与应用内功能同等的读写接口：

```js
ctx.rpnow.cards.list()            // 全部角色卡
ctx.rpnow.cards.get(id)
await ctx.rpnow.cards.add({ data: { name: '…', description: '…' } })
await ctx.rpnow.cards.update(id, { avatar })

ctx.rpnow.chats.list()
await ctx.rpnow.chats.appendMessage(chatId, 'assistant', '…')
await ctx.rpnow.chats.replaceLastAssistant(chatId, '改写后的回复')

await ctx.rpnow.lorebooks.save(book)
await ctx.rpnow.lorebooks.enableForChat(chatId, bookId)  // ← 让世界书影响该对话

await ctx.rpnow.presets.save(preset)   // ← 插入预设
ctx.rpnow.settings.get('themeId')
```

**插入世界书影响聊天**的完整写法：构造 `RPLorebook` → `save()` → `enableForChat()`；
之后每次生成都会走激活引擎，关键词命中就插入。

## 5. 界面插槽

UI 侧插件可以注册界面插槽（`host: "ui"`）：

```js
export function apply(ctx) {
  ctx.slot('chat.message.actions', MyButton, { order: 50 });
}
```

`order` 越小越优先。插槽默认实现的 `order` 是 100，所以小于 100 即可替换它；
在追加型插槽（如消息操作按钮）里，同一插槽的所有注册会依次渲染。

可用插槽见「插件 → 界面插槽」页面，或 `src/core/plugin/slots.ts` 的 `SLOT` 常量。

## 6. 完整示例：主题插件

```js
// plugin.js
const tokens = {
  '--rp-bg': 'oklch(0.16 0.02 260)',
  '--rp-fg': 'oklch(0.95 0.01 260)',
  '--rp-accent': 'oklch(0.72 0.17 220)',
};

export function apply(ctx) {
  const handle = ctx.provide('theme', {
    id: 'yourname.ocean',
    tokens: () => tokens,
    css: () => '.rp-md{font-family:Georgia,serif}',
    activate(id) {},
    list: () => [{ id: 'yourname.ocean', label: '深海' }],
  });
  // 返回清理时，内核自动把原主题放回服务栈
  return () => handle.dispose();
}
```

## 7. 完整示例：注入世界书

```js
export function apply(ctx) {
  ctx.rpnow.lorebooks.save({
    id: 'lb_plugin_demo',
    name: '插件注入的世界书',
    entries: [{
      id: 'e1',
      comment: '触发示例',
      keys: ['魔法', 'magic'],
      content: '这个世界的魔法需要以记忆为代价。',
      enabled: true, constant: false, selective: false, selectiveLogic: 0,
      position: 0, depth: 4, role: 0, order: 100, probability: 100,
      useProbability: false, caseSensitive: false, matchWholeWords: false,
      useRegex: false, group: '', groupWeight: 100, groupOverride: false,
      excludeRecursion: false, preventRecursion: false, delayUntilRecursion: false,
      scanDepth: null, sticky: 0, cooldown: 0, delay: 0, outletName: '',
      ignoreBudget: false, displayIndex: 0, secondaryKeys: [],
    }],
    scanDepth: null, tokenBudget: null, recursiveScanning: true,
    source: 'plugin', createdAt: Date.now(), updatedAt: Date.now(),
  });
}
```

## 8. 生命周期与故障隔离

1. 安装 → 校验 `manifest.json`（不执行任何代码）
2. 注册到内核 → 检查 `uses` 是否齐全
3. 激活 → `import()` `plugin.js` → 调用 `apply(ctx)`
4. 停用 / 卸载 → 调用清理函数 → 释放所有服务与插槽注册

只要 `apply` 抛错，插件被标记为 `失败`，它注册的服务被回滚，**应用其余部分不受影响**。
`uses` 的提供者被停用时，依赖它的插件会先被级联停用，再重新激活——因此热替换是安全的。

## 9. 开发调试

- 「插件 → 开发」页可**导出一个可运行的示例插件**，解压即可看到目录结构。
- 浏览器控制台里 `localStorage.setItem('rpnow:debug','1')` 可打开内核调试日志。
- 安装或卸载后若界面未完全刷新，刷新页面即可（正在运行的插件实例会被完全替换）。

## 10. 限制

- 插件在应用同源执行，拥有与应用相同的权限。没有能力沙箱——请只安装可信来源的插件。
- 不鼓励在插件里直接 import 应用内部模块；用 `ctx` 暴露的接口，跨版本更稳定。
- `apiVersion` 提升时会给出兼容说明；破坏性变更会同时提升版本号。
