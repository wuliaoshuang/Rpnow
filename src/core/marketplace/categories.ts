/**
 * 分类体系（角色卡 / 插件各一棵一级树，另加自由标签）。
 *
 * 只做**一级分类 + 标签**：对内容量有限、需要快速上手的本地商店足够；多级树会
 * 把筛选 UI 复杂化。预留 `requestedCategories` 语义（用户可申请新分类），第一版
 * 由维护者手工增补。
 */

import type { Category, MarketKind } from './types.js';

export const CARD_CATEGORIES: Category[] = [
  { id: 'modern', kind: 'card', label: '现代', icon: 'Building2', order: 1 },
  { id: 'ancient', kind: 'card', label: '古风', icon: 'Landmark', order: 2 },
  { id: 'fantasy', kind: 'card', label: '奇幻', icon: 'Wand2', order: 3 },
  { id: 'scifi', kind: 'card', label: '科幻', icon: 'Rocket', order: 4 },
  { id: 'wuxia', kind: 'card', label: '武侠', icon: 'Swords', order: 5 },
  { id: 'horror', kind: 'card', label: '恐怖', icon: 'Ghost', order: 6 },
  { id: 'comedy', kind: 'card', label: '搞笑', icon: 'Laugh', order: 7 },
  { id: 'utility', kind: 'card', label: '辅助·工具', icon: 'Wrench', order: 8 },
  { id: 'other', kind: 'card', label: '其他', icon: 'Shapes', order: 99 },
];

export const PLUGIN_CATEGORIES: Category[] = [
  { id: 'render', kind: 'plugin', label: '渲染', icon: 'PanelsTopLeft', order: 1 },
  { id: 'prompt', kind: 'plugin', label: '提示词', icon: 'Sparkles', order: 2 },
  { id: 'worldinfo', kind: 'plugin', label: '世界书', icon: 'BookMarked', order: 3 },
  { id: 'tools', kind: 'plugin', label: '工具', icon: 'Wrench', order: 4 },
  { id: 'theme', kind: 'plugin', label: '主题', icon: 'Palette', order: 5 },
  { id: 'provider', kind: 'plugin', label: '模型接入', icon: 'Plug', order: 6 },
  { id: 'security', kind: 'plugin', label: '安全', icon: 'ShieldCheck', order: 7 },
  { id: 'dev', kind: 'plugin', label: '开发调试', icon: 'Bug', order: 8 },
  { id: 'other', kind: 'plugin', label: '其他', icon: 'Shapes', order: 99 },
];

const ALL = [...CARD_CATEGORIES, ...PLUGIN_CATEGORIES];

/** 某类发布物的分类树（按 order 排序）。 */
export function listCategories(kind: MarketKind): Category[] {
  return ALL.filter((c) => c.kind === kind).sort((a, b) => a.order - b.order);
}

/** 分类是否存在。 */
export function isValidCategory(kind: MarketKind, id: string): boolean {
  return ALL.some((c) => c.kind === kind && c.id === id);
}

/** 分类显示名（未知 id 原样返回，便于展示服务端新增分类）。 */
export function categoryLabel(id: string): string {
  return ALL.find((c) => c.id === id)?.label ?? id;
}
