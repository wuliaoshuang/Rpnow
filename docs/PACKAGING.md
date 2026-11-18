# 多端打包

RPNow 是单一的 React + Vite 产物。同一份 `dist/` 被不同外壳包装，因此没有按平台分叉的代码。

```
            ┌──────────────┐
            │  dist/ (web) │  ← pnpm build
            └──────┬───────┘
      ┌────────────┼─────────────┐
      ▼            ▼             ▼
  Browser      Tauri          Capacitor
 (PWA 已构建)  (Windows 已构建)  (Android/iOS，兜底)
```

**已构建并验证的目标见 [BUILD-RESULTS.md](BUILD-RESULTS.md)。** 本文档描述各目标的实现方式。

所有持久化都走 `StorageService`（IndexedDB + localStorage），在三种外壳中行为一致——
Tauri 的 WebView2 与 Capacitor 的 WebView 都提供这两者。需要换成原生文件存储时，
提供一个 `storage` 服务插件即可，功能代码无需改动。

## Tauri 桌面版（已构建）

```bash
pnpm build:desktop        # 出 NSIS + MSI
pnpm build:desktop:exe    # 只出免安装 exe（最快）
pnpm dev:desktop          # 开发模式，热重载 + 原生窗口
```

### 为什么桌面版是主力目标

不是因为"多个图标"，而是因为**绕开了 CORS**：

| 服务商 | 浏览器 | 桌面版 |
|---|---|---|
| OpenAI 官方、NovelAI、火山方舟、Groq | ❌ 需代理 | ✅ 直接可用 |
| Ollama / LM Studio / vLLM | ⚠️ 需服务端开 CORS | ✅ 直接可用 |

实现方式：`src/core/transport/native.ts` 在检测到 Tauri 运行时后，
把 `fetch` 换成 `@tauri-apps/plugin-http`，请求由 Rust 发出，不受同源策略约束。
各传输适配器只接收一个 `fetchImpl` 参数，无法感知自己跑在哪个运行时，因此**适配器代码零改动**。

```ts
// 一次解析，全应用生效
const f = await resolveFetch(settings.network);   // desktop → 原生；web → 代理或 window.fetch
await adapter.stream(conn, req, f);
```

### 关键配置

`src-tauri/capabilities/default.json` 的 HTTP scope 必须覆盖用户可能配置的地址：

```json
{ "identifier": "http:default",
  "allow": [{ "url": "https://*" }, { "url": "http://*" },
            { "url": "http://localhost:*" }, { "url": "http://127.0.0.1:*" }] }
```

> ⚠️ 构建过程中真实踩到的坑：早期只写了 `https://*` 和 `http://*`，
> Tauri 的 URL 模式匹配**不包含** localhost，导致 Ollama 等本地模型被拒
> （报错 `url not allowed on the configured scope`）。另外 `http://[::1]:*`
> 这种 IPv6 写法会让 scope 反序列化直接失败，不要用。

`tauri.conf.json` 里另外几处值得注意：
- `csp` 放开 `connect-src` 到 `https: http:`，否则自定义接口地址全部被拦；
- `img-src` 允许 `data:`（角色卡头像是 data URL）与 `http(s):`（外链图片）；
- `script-src` 允许 `blob:`——`.rpnx` 插件通过 blob URL 动态 `import()`；
- `windows.webviewInstallMode` 设为 `downloadBootstrapper`，用户机器缺 WebView2 时安装包会自动补。

### 图标

`pnpm icons` 会从 `scripts/make-icons.mjs` 里的单一 SVG 母版生成全部尺寸
（`.ico`、`.icns`、Windows Store 方形图、PWA 图标、iOS 触控图标），
避免出现各平台图标不一致。

## Web / PWA（已构建）

```bash
pnpm build     # → dist/，含 manifest.webmanifest + sw.js
pnpm preview   # 本地验证
```

已配置 `vite-plugin-pwa`：应用可安装到桌面、离线可启动（壳被预缓存）。
**API 请求永远不缓存**——模型回复是用户特定且流式的，缓存它们是错的。

把 `dist/` 丢到任意静态托管即可。

## Android / iOS — Capacitor（兜底）

本轮未构建（本机缺 JDK 21 与 Android `cmdline-tools`）。步骤：

```bash
pnpm add -D @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios
npx cap init RPNow app.rpnow.mobile --web-dir=dist
pnpm build
npx cap add android
npx cap add ios
npx cap sync
```

需要注意的点：

- **明文 HTTP**：连本地模型服务需要在 Android
  `network_security_config.xml` 中允许 `localhost` 与局域网网段的 cleartext。
- **CORS 依旧生效**：Capacitor WebView 和浏览器一样执行同源策略，
  所以 `browserCors: false` 的服务商仍然需要代理——这一点和 Tauri 不同，
  也是"Tauri 主力、Capacitor 兜底"的原因。
- **键盘与安全区**：输入框用 `textarea` + `env(safe-area-inset-bottom)`；
  聊天页是 `min-h-0` 的 flex 列，键盘弹起时布局收缩而不是把内容顶走。

## 跨平台通用事项

| 关注点 | 处理方式 |
|---|---|
| 存储配额 | 角色卡头像以 data URL 保存在 IndexedDB；库很大时换成桌面文件存储插件 |
| API Key | 存在 `localStorage`，备份里也会包含（否则备份不完整）；桌面可后续接系统钥匙串插件 |
| 离线 | 应用壳完全静态；对话需要模型端点（本地模型可完全离线） |
| 跨平台构建 | macOS 包只能在 macOS 上构建并公证；Linux 包只能在 Linux 上构建 |
