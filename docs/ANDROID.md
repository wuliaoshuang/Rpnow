# Android 打包结果（已验证）

> 构建日期：2026-11-15 · 目标：Android 7.0+ (API 24) · RPNow 0.1.0

## 产物

| 文件 | 大小 | 用途 |
|---|---|---|
| `release/RPNow_0.1.0_android-arm64.apk` | 17.69 MiB | **真机安装用**（绝大多数安卓手机是 arm64） |
| `release/RPNow_0.1.0_android-x86_64.apk` | 17.16 MiB | 模拟器 / x86 平板 |

两个 APK 均已通过 **APK Signature Scheme v2** 签名校验。

- 包名：`app.rpnow.desktop`
- 版本：`0.1.0`（versionCode 1000）
- minSdk **24**（Android 7.0），targetSdk **37**
- 权限：仅 `INTERNET`
- 原生库：每包只含对应 ABI，避免体积翻倍（universal 包会是 60 MB）

## 安装

```bash
adb install release/RPNow_0.1.0_android-arm64.apk
# 或直接把 APK 传到手机点击安装（需允许"未知来源"）
```

## 复现构建

```bash
pnpm build:android          # arm64（真机）
pnpm build:android:all      # 全部 ABI
pnpm build:android:debug    # 可调试版
pnpm dev:android            # 真机热重载开发
```

`scripts/android-env.mjs` 会自动探测 JDK 21+、`ANDROID_HOME` 和 `$ANDROID_HOME/ndk/<version>`，
无需手动设置环境变量。

## 环境要求

| 组件 | 版本 | 说明 |
|---|---|---|
| JDK | **21** | Tauri 的 Gradle 需要 21，JDK 19 会失败 |
| Android SDK Platform | **37.0** | 注意平台目录名是 `android-37.0`，不是 `android-37` |
| Build-Tools | 37.0.0 | |
| NDK | 27.0.12077973 | 必须放在 `$ANDROID_HOME/ndk/<version>/`；Tauri CLI 只扫这个路径，**不认 NDK_HOME** |
| Rust targets | `aarch64-linux-android` 等 4 个 | `rustup target add ...` |

## 构建过程中踩到并修复的 4 个坑

**1. Gradle 调用 `npm.bat` / `pnpm.bat` 失败。**
Tauri 生成的 `buildSrc/.../BuildTask.kt` 里写死了 `npm`，而 Windows 上 Gradle 会把裸命令名解析成
`xxx.bat`，本机只有 `pnpm.cmd` / `pnpm.ps1`。已改为：
- 优先用 `RPNOW_PM` 环境变量；
- 否则找仓库里 `scripts/tauri-android-build.bat` 包装脚本；
- 再否则回退 `pnpm`。

**2. 包装脚本路径算错了一层。**
Gradle 传进来的 `projectDir` 是 `gen/android/app`（app 模块），不是 `gen/android`，
所以 `../../../scripts/...` 才对。已在 `BuildTask.kt` 里同时尝试多个候选路径。

**3. `pnpm run tauri` 缺少脚本。**
Gradle 实际执行的是 `pnpm run -- tauri android android-studio-script`，
要求 `package.json` 里有名为 `tauri` 的脚本。已补上 `"tauri": "tauri"`。

**4. 白屏 —— 真正的问题：WebView 太旧。**
模拟器的 WebView 是 **91.0.4472.114（2021 年）**，不支持 ES2020 的 `??` / `?.`，
而原构建目标是 `es2022`，于是 JS 一加载就语法报错，页面全白。
已把 Vite 构建目标降到 `['es2019', 'chrome70', 'safari13']`，
现代浏览器没有任何影响，老设备则能正常渲染。

顺带修掉一个噪音：Service Worker 在 `tauri.localhost` 下注册必然失败，
会在控制台抛出未捕获异常，误导判断。现在只在 Web 端注册。

## 验证结果

**功能验证（`pnpm test:android`，15/15 通过）**
在真实 Android WebView 里通过 CDP 驱动界面，逐项检查：
- 应用渲染完成，导航 6 个按钮齐全
- 主题变量注入成功
- 六个页面（角色卡 / 世界书 / 预设 / 插件 / 设置 / 对话）全部可打开且有内容
- 新建角色卡表单可打开、可输入、可保存
- 角色卡出现在列表网格中
- 对话页可打开并显示输入框
- 重载后应用仍可用
- 无 JS 运行时错误

截图（`screenshots/26-android-webview.png`）确认移动端布局正确：
底部导航、卡片布局、中文排版均正常。

**Release APK 验证（`pnpm test:android:release`，8/8 通过）**
- APK 已安装、版本号 0.1.0
- 进程存活、Activity 处于前台
- 无崩溃
- WebView 已加载前端 bundle
- 首帧绘制完成
- APK 实际落盘于 `/data/app/...`

## 移动端适配（真机验证）

在 **OPPO PFUM10（Android 12，1080×2400，arm64-v8a）** 上实测：

| 检查项 | 结果 |
|---|---|
| 状态栏不再遮挡顶栏 | ✅ 安全区 40px，顶栏 `padding-top` = 40px，标题顶部 51px |
| body 外边距归零 | ✅ `0px`（原先 8px 导致整体下移） |
| 顶栏设置齿轮可进入设置页 | ✅ 点击有效 |
| 底部导航 ≤ 5 项 | ✅ 对话 / 角色卡 / 世界书 / 预设 / 更多 |
| 「更多」弹层含设置 | ✅ 插件、设置 |
| 输入框不显示 Enter 提示 | ✅ 显示「以 X 的身份说点什么…」 |
| 状态栏沉浸式 + 白色图标 | ✅ 背景透明（透出应用暗色），图标/时钟为白色 |
| 冷启动 | ✅ 862ms |

### 状态栏：沉浸式 + 白色图标

RPNow 有暗色主题，系统默认的黑色状态栏图标在暗背景上不可见。做法是**栏透明、内容延伸、前景强制白色**：

- `themes.xml`：`statusBarColor=transparent`、`windowLightStatusBar=false`（false = 白色图标）、`enforceStatusBarContrast=false`
- `MainActivity.applyStatusBar()`：除 XML 外在代码里显式 `setSystemBarsAppearance(0, APPEARANCE_LIGHT_STATUS_BARS)`。**必须写代码**——`Theme.Material3.DayNight` 在系统浅色模式下会重新套用深色图标，只靠 XML 不稳。

真机像素验证：状态栏区域采样为 `R15 G9 B17`（应用暗色背景透出，证明透明沉浸），扫描到 1109 个近白像素（图标/时钟为白色）。

### 两个 UI bug 的根因

**1. 状态栏遮挡顶栏。** 三个原因叠加：
- Android 主题没设 `windowDrawsSystemBarBackgrounds` / 透明状态栏，边到边绘制与安全区不配套；
- 顶栏用的是固定高度 `h-14`，安全区内边距会挤压内容而不是撑开——改成 `min-h-14` + `pt-[env(safe-area-inset-top)]`；
- **最关键**：`body` 的 8px 默认外边距没被清掉。Tailwind v4 把 preflight 放在 `@layer base`，而这条规则在 Android WebView 里输给了浏览器默认样式。把 `html,body,#root{margin:0}` 移到**所有 `@layer` 之外**才生效。

> 这里踩了一个坑：模拟器的 GPU 渲染路径坏了，`screencap` 一直返回同一张白图，导致"改完还是白屏"的误判。真机上 `screencap` 正常，所有结论以真机测量为准。

**2. 移动端看不到设置。** 底部导航原先把 `settings` 排除在外，注释写着「设置放在顶栏」——但顶栏里根本没有设置按钮，于是设置页在手机上完全无法到达。现在：
- 顶栏右侧加了常驻齿轮按钮；
- 底部导航收敛为 4 个常用页 + 「更多」，弹层里放插件与设置。

## 安装包体积：为什么测试包有 300MB

| 产物 | 大小 | 说明 |
|---|---|---|
| `app-universal-debug.apk` | **326.5 MiB** | ← 你看到的「300MB」。debug + 4 个 ABI |
| `app-universal-release.apk` | 60.4 MiB | release，仍含 4 个 ABI |
| `app-arm64-release.apk` | **17.7 MiB** | 正式包，单 ABI |

三个因素叠加：

1. **debug 构建**：Rust 不做优化、调试符号全部保留，`.so` 体积是 release 的数倍。
2. **universal 打包**：一个 APK 内含 `arm64-v8a` / `armeabi-v7a` / `x86` / `x86_64` 四份 `.so`，每份十几 MB。
3. **debug 符号未 strip**：`librpnow_lib.so` 在 debug 下保留完整符号表。

**正式包用 `--split-per-abi --release`，只有 17.7MB。** 命令：

```bash
pnpm build:android        # arm64（真机）
```

Google Play 则用 AAB（`--aab`）+ App Signing，用户下载的是按设备 ABI 裁剪后的包，体积接近单 ABI。

> 另外 `app-universal-debug.apk` 只是 Tauri 为兼容所有模拟器的便利产物，**不要分发给用户**。

- **模拟器截图是白屏，但应用实际正常。** 该 AVD 的 GPU 渲染路径有问题
  （`eglChooseConfig failed`），`screencap` 一直返回同一张空白帧。
  因此改用 CDP 的 `Page.captureScreenshot` 和 DOM 断言验证——截图见
  `screenshots/26-android-webview.png`，那张是真实渲染结果。
- **未上架 Google Play。** 需要 AAB 格式（`--aab`）、应用的签名密钥托管到 Play App Signing、
  以及隐私政策。当前已本地签名，适合自用/分发 APK。
- **签名密钥是开发用的**（`src-tauri/gen/android/keystore/rpnow-release.jks`，
  密码 `rpnow-dev-2026`）。正式发布前必须换成你自己的密钥并妥善保管——
  一旦丢失，已安装用户将无法升级。
- **未构建 armv7 / x86 包。** 为节省磁盘只构建了 arm64 与 x86_64；
  需要时执行 `pnpm build:android:all`。
- **磁盘空间是硬约束。** 每个 Android ABI 的 Rust release 产物约 2.7 GB，
  四 ABI 全建需要约 15 GB 空闲。构建前建议清理 `src-tauri/target/<abi>`。

## 移动端的实际能力

Android 版和桌面版一样，通过 `@tauri-apps/plugin-http` 由 Rust 发起网络请求，
**不受 CORS 限制**。也就是说 OpenAI、NovelAI、火山方舟这些"浏览器连不上"的服务，
在安卓版里同样无需代理，可以直接填 API 地址使用。

界面会自动显示「安卓版（原生网络）」，并且设置里的代理警告会自动隐藏。
