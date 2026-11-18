/**
 * 本地商店（marketplace）契约。
 *
 * 两类发布物共用一套元数据：
 *   - `rpnow.card`：角色卡 + 可选世界书/预设/正则/头像/截图；
 *   - `rpnow.plugin`：`.rpnx` 包（manifest.json + plugin.js + assets）。
 *
 * 设计原则：**第一版完全本地**（本地 mock 商店 + 本地数据），但接口形状按生产
 * 可用设计（分页、错误码、鉴权头预留），将来接真实后端只替换 client。
 */

/** 发布物类型。 */
export type MarketKind = 'card' | 'plugin';

/** 插件权限声明（安装前必须明示）。 */
export type PluginPermission =
  | 'network' // 访问网络（API/图片/字体/脚本）
  | 'storage' // 读写本地存储 / IndexedDB
  | 'clipboard' // 读取剪贴板
  | 'filesystem' // 通过文件选择器读写用户文件
  | 'render-injection' // 注入/替换消息渲染结果（iframe / DOM）
  | 'top-window'; // 访问顶层窗口与跨 iframe 通信

export const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  network: '网络访问',
  storage: '本地存储',
  clipboard: '剪贴板',
  filesystem: '文件读写',
  'render-injection': '界面/渲染注入',
  'top-window': '顶层窗口访问',
};

/** 内容分级。 */
export type ContentRating = 'sfw' | 'suggestive' | 'nsfw';

/** 发布元数据（写入发布包的 `publish.json`，也是商店索引的基础）。 */
interface PublishManifestBase {
  /** 结构版本。 */
  schema: 1;
  /** 稳定唯一 id：`card.<author-slug>.<slug>` / `plugin.<manifest.id>`。 */
  id: string;
  name: string;
  version: string; // semver
  summary: string;
  description?: string;
  author: string;
  /** SPDX id 或 'all-rights-reserved' / 'custom'。必填。 */
  license: string;
  homepage?: string;
  category: string; // 一级分类 id（必须在分类树内）
  tags: string[];
  rating: ContentRating;
  contentWarnings: string[];
  screenshots: string[]; // 包内相对路径
  /** 最低 RPNow 版本（semver）。 */
  minHostVersion?: string;
  changelog?: string;
  createdAt: string;
  /** 统计（由商店维护，发布时可为空）。 */
  stats?: { downloads?: number; likes?: number; dislikes?: number };
}

/** 角色卡发布元数据：没有权限/依赖字段。 */
export interface CardPublishManifest extends PublishManifestBase {
  type: 'card';
}

/** 插件发布元数据：权限必填，依赖仅插件有。 */
export interface PluginPublishManifest extends PublishManifestBase {
  type: 'plugin';
  /** 依赖的插件 id（仅插件）。 */
  requires?: string[];
  /** 插件权限（仅插件，必填）。 */
  permissions: PluginPermission[];
}

export type PublishManifest = CardPublishManifest | PluginPublishManifest;

/** 商店列表项（服务端索引）。 */
export interface MarketItem {
  manifest: PublishManifest;
  /** 可用版本（降序）。 */
  versions: string[];
  updatedAt: string;
  size: number;
  sha256: string;
}

/** 分类。 */
export interface Category {
  id: string;
  kind: MarketKind;
  label: string;
  /** 图标名（lucide）或 emoji。 */
  icon?: string;
  order: number;
}

/** 搜索结果。 */
export interface MarketQuery {
  kind: MarketKind;
  q?: string;
  category?: string;
  tag?: string;
  sort?: 'newest' | 'downloads' | 'rating' | 'name';
  page?: number;
  pageSize?: number;
}

export interface MarketPage {
  items: MarketItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** 本地"已安装来源"记录。 */
export interface InstalledSource {
  id: string;
  kind: MarketKind;
  version: string;
  installedAt: string;
  source: string; // 商店 baseURL 或 'local'
}
