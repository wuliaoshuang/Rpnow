# 角色卡发布 · 插件发布 · 本地商店（Marketplace）

第一版目标：**完全本地可跑**的内容发布与商店，不接生产后端、不做账号体系。
接口按生产可用设计，将来换后端只需改 `settings.market.baseURL`。

## 1. 组成

| 模块 | 位置 | 职责 |
|---|---|---|
| 契约 | `src/core/marketplace/types.ts` | `PublishManifest` / `MarketItem` / 权限枚举 / 分级 |
| 分类 | `core/marketplace/categories.ts` | 卡片 9 类、插件 9 类（一级分类 + 自由标签） |
| 校验 | `core/marketplace/validate.ts` | 必填、semver、许可白名单、插件权限枚举 + **隐私扫描**（sk-/AWS/GitHub token/JWT）+ **风险模式提示**（动态注入 script、eval、携带凭据请求） |
| 打包 | `core/marketplace/packaging.ts` | `.rpcard` / `.rpxn`（= `.rpnx` + `publish.json`）、sha256、解包读取 |
| 组装 | `core/marketplace/collect.ts` | RPCard / InstalledPlugin → 打包输入（复用既有序列化） |
| 客户端 | `core/marketplace/client.ts` | 列表/详情/下载/发布/安装计数/点赞点踩/举报 + 已装来源记录 |
| 本地服务 | `scripts/market-server.mjs` | `:8799` REST，数据在 `market-local/` |
| 向导 | `components/marketplace/PublishWizard.tsx` | 元数据 → 校验/自查 → 打包上传 |
| 商店 | `pages/MarketplacePage.tsx` | 搜索/分类/排序/NSFW 开关/详情/安装/更新/评分/举报 |

## 2. 发布包结构

`.rpcard`（zip）：`publish.json` + `card.json` + `avatar.png?` + `worldbook.json?` +
`preset.json?` + `screenshots/*` + `README.md?`

`.rpxn`（zip）：`publish.json` + `manifest.json` + `plugin.js` + `assets/**` + `screenshots/*`

`publish.json` 关键字段：`id`（`card.<author>.<slug>`）、`name/version/summary/author/
license/category/tags/rating/contentWarnings/screenshots/requires?/permissions?/
minHostVersion?/changelog?`。

## 3. 使用

```bash
node scripts/market-server.mjs          # 启动本地商店 :8799
node scripts/_market-smoke.mjs          # （可选）写入一条冒烟数据
```

应用内：顶栏「商店」→ 浏览/搜索/筛选/详情/安装；或「发布内容」→ 选择卡片或已装插件 →
填元数据 → 校验并发布。角色卡页的 ⋮ 菜单、插件页标题也各有一个发布入口。

## 4. 兼容层状态

SillyTavern（傻酒馆）扩展兼容**默认隐藏**（`settings.stCompat.enabled=false`）：
ST 扩展包会被明确拒绝，渲染不再产生 `TH-render`。见
[TAURN-HELPER-COMPAT.md](TAURN-HELPER-COMPAT.md)。

## 5. 已知边界（第一版）

- 无真实后端/账号：作者取设置里的名字或手填；`id` 冲突靠命名规避。
- 内容审核与下架在**服务端**；客户端只有举报入口（服务端记录到 `reports`）。
- 评分仅赞/踩与计数，无评论。
- 更新策略：详情页对比本地版本与最新版；回滚依赖本地保留版本（服务侧保留全部版本）。
- 截图不压缩（上限 6 张），大文件请自行裁剪。

## 6. 测试

```bash
node node_modules/vitest/vitest.mjs run src/core/marketplace/marketplace.test.ts
RPNOW_E2E_BASE=http://127.0.0.1:5175/ node scripts/market-browse-e2e.mjs   # 浏览/搜索/详情/安装
RPNOW_E2E_BASE=http://127.0.0.1:5175/ node scripts/market-publish-e2e.mjs  # 商店内发布
node scripts/st-compat-hidden-check.mjs                                    # 兼容层隐藏
```
