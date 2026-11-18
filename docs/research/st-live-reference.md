# 活体参照：真实 SillyTavern 中安装「酒馆助手」与 Meowssiah 预设

> 目的：不再只看源码推断，而是真的把 SillyTavern 跑起来、放入预设与插件，观察
> 「预设 × 正则 × 插件」的真实关系。本文所有结论都有可复现的操作步骤与现象记录。
>
> - 参照物：`_ref/SillyTavern`（v1.19.0 release，commit 06bde93），`node server.js`，`http://127.0.0.1:8000`
> - 预设定：`data/default-user/presets/openai/Meowssiah-2.1.6.json`
> - 插件：`public/scripts/extensions/third-party/JS-Slash-Runner/`（取自 `tavern-helper-real.zip`）

---

## 1. 扩展的安装方式与目录约定

ST 的第三方扩展目录：`public/scripts/extensions/third-party/<name>/`，入口由
`manifest.json` 的 `js`/`css` 指定（TH 为 `dist/index.js` / `dist/index.css`）。

服务端 `GET /api/extensions/discover` 立即识别并把它标为 **`type=global`**：

```json
{"type":"global","name":"third-party/JS-Slash-Runner"}
```

## 2. ★ 第一次真实失败：漏了 `lib/`，ST 报「加载失败」

只解压 `manifest.json` + `dist/` 时，ST 管理弹窗显示：

> 扩展程序 "**酒馆助手**" 加载失败：**[object Event]**

网络面板（CDP 监听）给出真实 404：

```
404  /scripts/extensions/third-party/JS-Slash-Runner/lib/jsoneditor.js
FAILED net::ERR_ABORTED …/lib/jsoneditor.js
```

`[object Event]` 就是 `<script>`/`<link>` 的 error 事件被 ST 直接 `.toString()` 的结果
——**排查时必须看网络面板而不是这句提示**。

包内实际自带（zip 条目）：

```
JS-Slash-Runner-main/manifest.json
JS-Slash-Runner-main/dist/index.js      (1.15 MB)
JS-Slash-Runner-main/dist/index.css     (94 KB)
JS-Slash-Runner-main/lib/jsoneditor.js  (1.22 MB)   ← 缺这个就全盘失败
JS-Slash-Runner-main/lib/tailwindcss.min.js (260 KB)
JS-Slash-Runner-main/i18n/*.json
```

ST 宿主**不**提供这些（`public/lib/jsoneditor.js` 不存在），所以扩展必须自带完整运行时。

## 3. 补齐 `lib/` 后的真实激活链

浏览器 console（ST 自带 debug 日志）：

```
[debug] Activating extension third-party/JS-Slash-Runner
[debug] callExtensionHook: Calling hook "activate" (function "activateTauriTavernChatSurface") for extension "third-party/JS-Slash-Runner"
[debug] callExtensionHook: Hook "activate" completed for extension "third-party/JS-Slash-Runner"
```

页面状态：

- `#extensions_settings` 存在（ST 静态写在 `index.html:5773`）；
- `#tavern_helper` 挂载成功，**389 个 DOM 节点**；
- 面板文本：`酒馆助手 Ver 4.12.1 / 扩展信息 渲染 脚本 工具 优化 开发`，
  渲染分区含「启用渲染器 / 渲染深度 / 忽略隐藏楼层 / 启用代码折叠 / Blob URL /
  取消前端代码高亮 / 允许流式渲染」等开关。

> 这条链印证了 RPNow 兼容层的方向：**`manifest.hooks.activate` 必须真正调用**
> （RPNow 早期压字段丢失 hooks，见 §2.8 更正），且**包内运行时必须收全**
> （loader 收集所有 `.m?js$` 作为模块，已覆盖 `lib/*.js`）。

## 4. 预设与 API 的关系（活体确认）

- 用户预设按 **API 分目录**存放：`data/<user>/presets/{openai,textgenerationwebui,kobold,novelai,context,instruct}/`。
- 顶部预设列表 `#settings_preset` 只列**当前 `main_api`** 对应目录的内容：
  - `main_api=koboldhorde` → 只有 Kobold 系预设；
  - `main_api=textgenerationwebui` → 只有 textgen 预设。
- Meowssiah 是 **Chat Completion（OpenAI 格式）** 预设，只有 `main_api` 属于
  Chat Completion 家族时才出现在列表里。
- `main_api` 由**服务端内存中的设置**决定：直接改 `data/default-user/settings.json`
  后必须重启 ST 才生效（否则前端仍持旧值并回写）。

## 5. 对 RPNow 的对照结论

| 观察 | 对 RPNow 的意义 |
|---|---|
| 扩展自带 `lib/jsoneditor.js`、`lib/tailwindcss.min.js` | loader 必须收集**全部** `.m?js$`（含 lib/），不能只收 dist/ —— 现状已满足 |
| 缺失文件的报错是 `[object Event]`，必须看网络面板 | 我们的错误信息应指出具体缺失模块（`st-bridge` 已能列出 `missingSpecifiers`） |
| 激活走 `hooks.activate` 且成功后立即挂 `#tavern_helper` | C4 的 manifest 透传 + 钩子调用是必要修复 |
| 设置面板挂在 `#extensions_settings`，ST 静态拥有该节点 | RPNow 改为**宿主常驻抽屉**（React 之外）是正确方向 |
| 预设按 API 分类、随 `main_api` 过滤 | RPNow 的 `chatCompletionSettings`/预设对象需按"当前预设"聚合，而非按 API 目录 |

## 6. 未完成的一环（诚实记录）

尚未在真 ST 的 UI 里完成「切到 Chat Completion 并选中 Meowssiah → 发消息 →
观察 `.TH-render iframe`」的完整闭环：`main_api` 被 ST 的服务端设置/前端持久化
反复改写，自动化点击未能稳定切到 OpenAI 家族。下一步可用两种确定性做法补齐：
① 通过 ST 的用户设置接口把 `main_api` 写成 `openai` 并重启后再选预设；
② 直接在聊天中注入一条含 `<think_nya>` 的消息（编辑消息或导入聊天）触发渲染，
   再对比 `.mes_text pre>code` → `.TH-render iframe#TH-message--N--M` 的真实 DOM。

（前面几轮已在**设备上的 RPNow** 侧验证过这条渲染链的等价断言。）
