# RPNow

**专注于 AI 角色扮演的本地优先应用。** 角色卡、世界书、预设都能导入导出；界面、主题、Agent 循环全部由插件组成，可插拔替换。

React 19 · TypeScript · Vite 7 · Tailwind v4 · shadcn/ui · 纯浏览器运行

---

## 它解决什么问题

市面上的酒馆类应用大多把「角色卡 / 世界书 / 预设」当成三套独立的功能。实际上它们是**同一个提示词的不同部分**：

| 概念 | 在提示词里的角色 |
|---|---|
| **预设** | 骨架：有哪些区块、按什么顺序、每块的默认文字 |
| **角色卡** | 内容：描述 / 性格 / 场景 / 对话示例填充进对应区块；可覆盖主提示 |
| **世界书** | 叠加层：按关键词激活，插入到指定位置（角色定义前/后、按深度、作者注释……） |
| **我的身份** | 某些预设才包含的一个区块 |

RPNow 把这四者放进一条可检视的流水线，并提供一个「提示词构成」面板——你能亲眼看到**这次请求到底发了什么、每条世界书为什么被激活、为什么没被激活**。

## 功能

**角色卡**
- 导入：PNG（`chara` / `ccv3` 数据块）、JSON（V1 / V2 / V3）、YAML、CharX / BYAF 压缩包
- 导出：PNG（同时写入 V2 + V3 数据块）、JSON、CharX
- 写卡工具：分区表单、实时字数与 token 估算、`{{宏}}` 插入菜单、多开场白管理、卡内正则脚本编辑
- 兼容细节：`character_book` 位置双轨（字符串 + `extensions.position` 数字）、`{{original}}` 覆盖、`depth_prompt`、未知字段无损保留

**世界书**
- 关键词 / 次要关键词 + 四种组合逻辑（AND_ANY / NOT_ALL / NOT_ANY / AND_ALL）
- 七种插入位置，含按深度插入
- 递归扫描、`preventRecursion` / `excludeRecursion`、概率、分组权重、粘性 / 冷却 / 延迟
- 诊断：每条条目为何激活 / 未激活

**预设**
- 导入市面主流对话补全预设 JSON，保留区块顺序、区块文字与采样参数
- 可视化调整区块顺序、启停、编辑文字、调采样参数
- 兼容 `prompt_order` 中 `character_id` 100001（Chat Completion 全局桶）的语义与导入修复规则

**模型与出图**
- 约 38 家模型服务商 + 任意 OpenAI 兼容接口；原生适配 Anthropic Messages 与 Gemini generateContent
- 图像生成：GPT Image、Seedream（火山方舟 / BytePlus）、NovelAI
- 明确标注哪些服务商需要代理（CORS 实情）

**插件化**
- 一切皆插件：`llm`、`agentLoop`、`renderer`、`theme`、`tts`、`settings` 都由插件提供
- `.rpnx` 插件包（ZIP = manifest + plugin.js + 资源），带可视化配置表单
- 插件可获得数据读写 API（角色卡 / 对话 / 世界书 / 预设），插入世界书并绑定到对话即可影响后续聊天
- 替换主题、替换 Agent 循环、替换渲染器、注册界面插槽
- **只支持自己的 `.rpnx`**；SillyTavern（酒馆助手）扩展兼容层默认停用（见下文「兼容边界」）
- 内置示例：[MiMo TTS 语音朗读插件](docs/PLUGIN-MIMO-TTS.md) — 一键听读角色回复

**发布与商店**
- 角色卡可打包成发布包（`.rpcard`），插件可发布 `.rpxn`（= `.rpnx` + `publish.json`）
- 商店页：搜索、分类筛选、排序、详情、安装、更新提示、版本历史、赞踩、举报
- 一级分类：卡片 9 类 / 插件 9 类；内容分级 SFW/轻度/NSFW（NSFW 默认隐藏）
- 发布前自动校验 + **隐私扫描**（疑似密钥/令牌）+ 插件权限声明与安装前明示
- 本地商店服务：`node scripts/market-server.mjs`（零依赖，`:8799`）；接口按生产形状设计，
  换真实后端只需改 `设置 → 商店源`
- 详见 [docs/MARKETPLACE.md](docs/MARKETPLACE.md)

**多端**
- Windows 已构建：NSIS 安装包 + MSI + 免安装 exe
- Android 已构建：arm64 / x86_64 APK，已签名，**在真机（OPPO PFUM10 / Android 12）上验证通过**
- Web / PWA 已构建：可安装、离线可启动
- 移动端适配：状态栏安全区、底部导航（4 页 + 更多）、设置入口在顶栏齿轮
- iOS 需 macOS 环境构建，见 [docs/PACKAGING.md](docs/PACKAGING.md)

## 快速开始

### 直接使用

**Windows**（`release/` 目录）：
```bash
release/RPNow_0.1.0_x64-setup.exe   # 安装包（推荐）
release/RPNow_0.1.0_portable.exe    # 免安装绿色版
```

**Android**：
```bash
adb install release/RPNow_0.1.0_android-arm64.apk
```

**Web / PWA**：把 `dist/` 丢到任意静态托管，浏览器地址栏「安装」。

原生版（桌面 / 安卓）最大的好处：**OpenAI / NovelAI / 火山方舟等不发送 CORS 头的服务无需任何代理**，
请求由系统原生发出。详见 [docs/BUILD-RESULTS.md](docs/BUILD-RESULTS.md)。

### 从源码运行

```bash
npm install            # 或 pnpm install
npm run dev            # http://127.0.0.1:5173
npm run build          # 产出 dist/（Web + PWA）
npm run build:desktop  # 产出 Windows 安装包
npm run build:android  # 产出 Android arm64 APK
```

首次打开会看到内置示例角色卡（含内嵌世界书、多开场白、卡内正则），可以直接开始对话。

### 配置模型

1. 打开 **设置 → 模型 → 添加连接**
2. 选择服务商（或「自定义（OpenAI 兼容）」），填入接口地址与 API Key
3. 点「测试连接」确认可用，保存并设为默认

> 想零成本试用：选 **Ollama**（`http://localhost:11434/v1`，需设置 `OLLAMA_ORIGINS=*`），
> 或 **OpenRouter**（支持浏览器直连，一个 Key 可用多家模型）。

## 验证

```bash
npm test                      # 389 个单元测试：世界书引擎 / 提示词组装 / 插件内核 / 商店契约

# 浏览器端到端（需先 npm run dev）
node scripts/smoke.mjs        # 21 项界面与交互检查
node scripts/chat-e2e.mjs     # 用本地 mock 模型跑完整一轮对话（15 项）
node scripts/plugin-e2e.mjs   # 插件热插拔：激活 → 替换主题 → 卸载还原
node scripts/rpnx-e2e.mjs     # .rpnx 打包→校验→安装→执行→注入世界书（8 项）
node scripts/tts-e2e.mjs      # MiMo TTS 插件端到端，含 mock 服务商（16 项）
node scripts/plugin-settings-e2e.mjs  # 插件配置表单（6 项）
node scripts/market-browse-e2e.mjs      # 商店：浏览/搜索/详情/安装（6 项）
node scripts/market-publish-e2e.mjs     # 发布：向导→上传→商店可见（6 项）
node scripts/st-compat-hidden-check.mjs # 确认酒馆扩展兼容已隐藏（5 项）
node scripts/st-reject-e2e.mjs          # 装 SillyTavern 扩展被明确拒绝（3 项）

# 打包产物验证
node scripts/desktop-e2e.mjs    # 打包后的 exe 能启动并渲染（8 项）
node scripts/installed-e2e.mjs  # 实际安装的副本能运行、数据能持久化（7 项）
node scripts/cors-bypass-e2e.mjs # 证明原生版真的绕过了 CORS（4 项）
node scripts/pwa-e2e.mjs        # PWA 可安装、可离线启动（11 项）
node scripts/android-functional.mjs   # 安卓 WebView 内完整功能（15 项，需模拟器）
node scripts/android-release-check.mjs # 安卓 Release APK 运行检查（8 项）
node scripts/realdevice-check.mjs      # 真机布局测量：状态栏/设置入口（10 项，需 debug 包）
```

已覆盖的关键行为：

- 世界书递归、粘性、冷却、分组互斥、概率、位置排序（32 个用例）
- `{{original}}` 覆盖、主提示 / 越狱覆盖、「角色卡覆盖关闭」、按深度插入、
  历史预算裁剪、隐藏消息排除、outlet 宏（26 个用例）
- 插件依赖解析、失效级联、服务覆盖栈还原、失败隔离（14 个用例）
- 真实浏览器中：提示词组装正确、流式渲染、卡内 HTML/正则渲染、无横向溢出、主题切换
- 打包产物中：安装包可静默安装、已安装应用可启动且数据持久化、原生网络绕过 CORS、PWA 离线启动

## 目录结构

```
src/
  core/
    card/parser.ts        角色卡解析与序列化（PNG chunk / ZIP / YAML）
    lorebook/engine.ts    世界书激活引擎（纯函数，可单测）
    prompt/builder.ts     提示词组装：预设骨架 + 卡内容 + 世界书插入
    prompt/macros.ts      宏替换
    llm/{providers,adapters,sse}.ts   服务商注册表与三种传输适配
    image/types.ts        图像生成适配（GPT Image / Seedream / NovelAI）
    agent/{types,defaultLoop}.ts      Agent 循环契约与默认实现
    render/renderer.ts    Markdown + 卡片 HTML 的安全渲染（前端文档沙箱化）
    plugin/{kernel-types,registry,slots,builtins}.ts   插件内核
    plugins/{rpnx,loader,github}.ts       .rpnx / GitHub 安装运行时
    st-compat.ts          SillyTavern 兼容层总开关（默认关闭；实现保留在 plugins/st-*）
    marketplace/          发布契约 / 分类 / 校验（含隐私扫描）/ 打包 / 商店客户端
    defaults/             内置预设、主题、示例数据
  features/
    chat/orchestrator.ts  对话编排：激活 → 组装 → 流式 → 持久化
    import/cardImport.ts  统一导入入口（卡 / 世界书 / 预设）
  components/
    marketplace/PublishWizard.tsx   发布向导
    cards/                角色卡列表 / 编辑器 / 简介
  pages/
    MarketplacePage.tsx   本地商店
    CardsPage.tsx  LorePage.tsx  PresetsPage.tsx  PluginsPage.tsx  SettingsPage.tsx
docs/
  ARCHITECTURE.md         架构与设计取舍
  PACKAGING.md            多端打包
  PLUGINS.md              .rpnx 插件开发
  MARKETPLACE.md          发布 / 商店 / 分类
  TAURN-HELPER-COMPAT.md  SillyTavern 兼容调查（已停用，代码保留）
  research/               角色卡 / 预设 / 服务商格式调研（含来源）
```

## 文档

- [打包结果](docs/BUILD-RESULTS.md) — 已构建的产物、验证记录、已知限制
- [Android 打包](docs/ANDROID.md) — APK 构建、环境要求、真机验证、踩坑记录
- [MiMo TTS 插件](docs/PLUGIN-MIMO-TTS.md) — 语音朗读插件：接口、配置、文本处理
- [架构说明](docs/ARCHITECTURE.md) — 为什么这样分层，提示词流水线如何工作
- [插件开发](docs/PLUGINS.md) — `.rpnx` 格式、API、示例
- [发布与商店](docs/MARKETPLACE.md) — 打包格式、分类、本地商店服务、验收
- [酒馆助手兼容性（已停用）](docs/TAURN-HELPER-COMPAT.md) — 调查记录与隐藏方式
- [多端打包](docs/PACKAGING.md) — Tauri / Capacitor / PWA 的实现方式
- [格式调研](docs/research/formats.md) — 角色卡 V1/V2/V3、世界书、预设、宏、HTML 渲染
- [服务商调研](docs/research/providers.md) — 各家接口差异与 CORS 实情

## 说明与边界

- **卡内 HTML/CSS 受控渲染。** 卡片自带 HTML 经 DOMPurify 净化、类名加前缀、样式作用域限定；
  预设正则产出的「前端文档」（含 `<!DOCTYPE html>` 的整页）由 RPNow 自己的沙箱 iframe 渲染，
  不与宿主页面共享 DOM/源。**卡内的 `<script>` 不会执行。**
- **插件是可信代码。** `.rpnx` 在应用同源执行，安装前会校验 manifest 并展示其声明的服务，
  但没有能力沙箱——这与浏览器扩展以外的插件模型一致，安装前请确认来源。
  发布插件时需**声明权限**（网络 / 存储 / 剪贴板 / 文件 / 渲染注入 / 顶层窗口），安装时会明示。
- **SillyTavern（酒馆助手）扩展不受支持**：兼容层默认关闭（`settings.stCompat.enabled=false`），
  安装这类包会被明确拒绝。相关调查与代码保留在 [docs/TAURN-HELPER-COMPAT.md](docs/TAURN-HELPER-COMPAT.md)。
- **商店第一版是本地实现**：无账号/支付/审核后台；接口按生产形状设计（分页/错误码/鉴权头预留）。
- 服务商的不支持浏览器直连时会明确提示并引导到代理设置，不做静默失败。
- 导出的备份包含 API Key（否则备份不完整），请自行妥善保管。

## 致谢

格式规范来自社区长期沉淀：角色卡 V2/V3 规范、SillyTavern 的世界书与预设字段、
CharX / BYAF 打包格式。RPNow 依据这些公开格式做了独立实现；架构上借鉴了
DeepSeek Harness 的「服务注册 + 依赖级联」插件模型。详见
[docs/REFERENCE-SOURCES.md](docs/REFERENCE-SOURCES.md)。
