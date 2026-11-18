# 打包结果（已验证）

> 构建日期：2026-11-15 · RPNow 0.1.0

## 产物清单

| 平台 | 产物 | 大小 | 说明 |
|---|---|---|---|
| **Windows**（推荐） | `release/RPNow_0.1.0_x64-setup.exe` | 4.17 MiB | NSIS 安装包，当前用户安装，含中英文界面 |
| Windows | `release/RPNow_0.1.0_x64_en-US.msi` | 5.78 MiB | MSI，适合企业批量分发 |
| Windows | `release/RPNow_0.1.0_portable.exe` | 14.95 MiB | 免安装绿色版 |
| **Android**（真机） | `release/RPNow_0.1.0_android-arm64.apk` | 17.69 MiB | 已签名，绝大多数安卓手机用这个 |
| Android（模拟器） | `release/RPNow_0.1.0_android-x86_64.apk` | 17.16 MiB | 已签名，x86 模拟器/平板 |
| **插件** | `release/rpnow.tts.mimo.rpnx` | 3.7 KiB | MiMo TTS 朗读插件，应用内导入 |
| **Web / PWA** | `dist/` | ~1 MB | 可静态托管，支持安装与离线启动 |

> ⚠️ **不要分发 `app-universal-debug.apk`（326 MiB）**。那是 debug + 4 ABI 的调试产物，
> 正式包用 `--split-per-abi --release` 只有 17.7 MiB。原因见 [ANDROID.md](ANDROID.md#安装包体积为什么测试包有-300mb)。

Windows 安装位置：`%LOCALAPPDATA%\RPNow\`。
Android 详见 [ANDROID.md](ANDROID.md)。

## 环境要求

### Windows 桌面

| 依赖 | 要求 | 本机状态 |
|---|---|---|
| Windows | 10 / 11 x64 | ✅ |
| WebView2 Runtime | 任意近期版本 | ✅ 已安装（安装包也会自动补） |
| Rust | ≥ 1.90 | ✅ 1.94.0 |
| MSVC 生成工具 | VS 2022 + Windows SDK | ✅ VS 2022 Community |

最终用户**不需要** Rust 或 Node。

### Android

JDK 21、Android SDK Platform 37.0、Build-Tools 37.0.0、NDK 27.0.12077973、
Rust 4 个 Android target。详见 [ANDROID.md](ANDROID.md)。

## 已验证的行为

这些不是「应该能跑」，而是实际启动进程并用 DevTools 驱动界面确认的：

**桌面应用**（`scripts/desktop-e2e.mjs`，8/8）
- 打包后的 `rpnow.exe` 能启动，WebView2 渲染出完整界面
- 检测到 Tauri 运行时（`__TAURI_INTERNALS__`）
- 主题变量注入成功，全部 6 个页面可访问
- 界面正确显示为「桌面版（原生网络）」
- 零页面错误

**安装与安装后运行**（`scripts/installed-e2e.mjs`，7/7）
- NSIS 静默安装退出码 0，文件落到 `%LOCALAPPDATA%\RPNow`
- 已安装的副本可从 `tauri.localhost` 加载本地资源（不依赖开发服务器）
- 通过界面新建角色卡 → 重启应用后数据仍在（IndexedDB 正常）

**CORS 绕过**（`scripts/cors-bypass-e2e.mjs`，4/4）
这是桌面版存在的核心理由。测试启动了一个**故意不发送任何 CORS 头**的 HTTP 服务，然后验证：
- 普通 `fetch` → 失败（`Failed to fetch`，浏览器同源策略拦截）
- 原生通道 → `200 OK`，正常拿到响应体

也就是说，OpenAI、NovelAI、火山方舟这些「不支持浏览器直连」的服务，在桌面版里**无需任何代理**即可使用。

**PWA**（`scripts/pwa-e2e.mjs`，11/11）
- manifest 合法、`display: standalone`、含 maskable 图标
- 全部图标返回 200
- Service Worker 激活
- **断网后重新加载仍能启动**（离线壳生效）

**Android 功能**（`scripts/android-functional.mjs`，15/15）
在真实 Android WebView（API 31 模拟器）里通过 CDP 驱动界面：
- 应用渲染完成、导航 6 个按钮、主题注入
- 六个页面全部可打开且有内容
- 新建角色卡 → 输入 → 保存 → 出现在列表
- 对话页可打开并显示输入框
- 重载后仍可用
- 无 JS 运行时错误
- 截图见 `screenshots/26-android-webview.png`（移动端布局正确）

**Android Release APK**（`scripts/android-release-check.mjs`，8/8）
- 安装成功、版本 0.1.0、进程存活、Activity 前台
- 无崩溃、WebView 加载 bundle、首帧绘制完成
- `apksigner verify` 通过（APK Signature Scheme v2）

## 复现构建

```bash
pnpm install

# Windows 桌面（NSIS + MSI）
pnpm build:desktop
pnpm build:desktop:exe      # 只出免安装 exe

# Android（自动探测 JDK/SDK/NDK）
pnpm build:android          # arm64
pnpm build:android:all      # 全部 ABI

# Web / PWA
pnpm build                  # → dist/
```

## 与 Web 版的差别

| | 桌面版 / 安卓版（Tauri） | Web / PWA |
|---|---|---|
| 无 CORS 服务商（OpenAI / NovelAI / 方舟 / Groq） | ✅ 直接可用 | ⚠️ 需配置代理 |
| 本地模型（Ollama / LM Studio） | ✅ 直接连 | ⚠️ 需服务端开 CORS |
| 数据存储 | WebView IndexedDB | 浏览器 IndexedDB |
| 离线 | ✅ 完全离线 | ✅ 壳离线，模型仍需网络 |
| 安装 | 安装包 / APK | 浏览器「安装」菜单 |

## 与 Web 版的差别

| | 桌面版（Tauri） | Web / PWA |
|---|---|---|
| 无 CORS 服务商（OpenAI / NovelAI / 方舟 / Groq） | ✅ 直接可用 | ⚠️ 需配置代理 |
| 数据存储 | WebView2 IndexedDB | 浏览器 IndexedDB |
| 离线 | ✅ 完全离线 | ✅ 壳离线，模型仍需网络或本地服务 |
| 本地模型（Ollama / LM Studio） | ✅ 直接连 | ⚠️ 需服务端开 CORS |
| 安装 | 双击安装包 | 浏览器「安装」菜单 |

## 已知限制

- **安装包与 APK 均未做代码签名（Windows）/ 使用开发密钥（Android）。**
  Windows SmartScreen 会提示「未知发布者」，正式分发需购买代码签名证书；
  Android 的签名密钥是开发用的（密码写在 `docs/ANDROID.md`），正式发布前必须替换并妥善保管。
- **仅构建了 Windows x64 与 Android arm64/x86_64。** macOS 包必须在 macOS 上构建并公证；
  Linux 包需在 Linux 上构建；Android armv7 未构建（可用 `pnpm build:android:all` 补）。
- **自动更新未启用。** 需要配置签名密钥对和更新服务器端点。
- **iOS 未构建。** 必须在 macOS + Xcode 环境下构建。
