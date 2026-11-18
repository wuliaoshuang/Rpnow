/**
 * Settings hub — the directory view (Tavo's 「更多」/「模型与服务」).
 *
 * Grouped rows, each showing the **current value** on the right. Tapping a row
 * drills into that section as a sub-page (the actual forms live in
 * `SettingsSection`). This replaces the twelve-tab flat layout, which was
 * unusable on a phone.
 */

import * as React from 'react';
import {
  BookMarked,
  BookOpen,
  ChevronRight,
  Puzzle,
  Database,
  FileText,
  ImagePlus,
  Layout,
  MessageSquare,
  Palette,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useApp } from '@/state/store.js';
import { BUILTIN_THEMES, THEME_MAP } from '@/core/defaults/themes.js';
import { cn } from '@/lib/utils.js';
import { vibrate } from '@/lib/haptics';

export type SettingsSectionId =
  | 'models'
  | 'image'
  | 'appearance'
  | 'chat'
  | 'memory'
  | 'tools'
  | 'templates'
  | 'imagegen'
  | 'backup'
  | 'persona'
  | 'network'
  | 'data';

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  icon: React.ReactNode;
  group: string;
}> = [
  { id: 'models', label: '模型连接', icon: <SlidersHorizontal className="size-4" aria-hidden="true" />, group: '聊天' },
  { id: 'chat', label: '模型设置', icon: <MessageSquare className="size-4" aria-hidden="true" />, group: '聊天' },
  { id: 'image', label: '生图 API', icon: <ImagePlus className="size-4" aria-hidden="true" />, group: '生图' },
  { id: 'imagegen', label: '生图设置', icon: <ImagePlus className="size-4" aria-hidden="true" />, group: '生图' },
  { id: 'persona', label: '用户身份', icon: <UserRound className="size-4" aria-hidden="true" />, group: '身份' },
  { id: 'appearance', label: '主题', icon: <Palette className="size-4" aria-hidden="true" />, group: '界面' },
  { id: 'templates', label: '模板', icon: <Layout className="size-4" aria-hidden="true" />, group: '界面' },
  { id: 'memory', label: '记忆', icon: <Sparkles className="size-4" aria-hidden="true" />, group: '高级' },
  { id: 'tools', label: '工具', icon: <Wrench className="size-4" aria-hidden="true" />, group: '高级' },
  { id: 'backup', label: '备份', icon: <Database className="size-4" aria-hidden="true" />, group: '数据' },
  { id: 'data', label: '数据管理', icon: <Database className="size-4" aria-hidden="true" />, group: '数据' },
  { id: 'network', label: '网络', icon: <FileText className="size-4" aria-hidden="true" />, group: '数据' },
];

/** Current-value string for a section, or undefined to show nothing. */
export function useSectionValue(id: SettingsSectionId): string | undefined {
  const settings = useApp((s) => s.settings);
  const personas = useApp((s) => s.personas);
  switch (id) {
    case 'persona':
      return personas[0]?.name || '未设置';
    case 'models':
      return settings.defaultConnectionId ? '已配置' : '未配置';
    case 'image':
      return settings.imageGen?.key ? '已配置' : '未配置';
    case 'appearance':
      return (THEME_MAP.get(settings.themeId) ?? BUILTIN_THEMES[0]).label;
    case 'memory':
      return settings.memory.mode === 'off' ? '关闭' : settings.memory.mode === 'classic' ? '基础' : '增强';
    case 'tools': {
      const n = [settings.tools.keywordEnabled, settings.tools.webEnabled, settings.tools.randomEnabled].filter(Boolean).length;
      return n ? `${n} 项启用` : '关闭';
    }
    case 'chat':
      return settings.chat.maxTokens > 0 ? `输出 ${settings.chat.maxTokens}` : '输出无限制';
    default:
      return undefined;
  }
}

export function SettingsHub({
  onOpen,
  /** Opens the standalone plugins page (插件管理不是设置子区块). */
  onOpenPlugins,
  /** Opens sibling content pages (世界书/预设/小说 — separate routes). */
  onOpenRoute,
}: {
  onOpen: (id: SettingsSectionId) => void;
  onOpenPlugins?: () => void;
  onOpenRoute?: (route: 'lore' | 'presets' | 'novel') => void;
}) {
  const settings = useApp((s) => s.settings);
  const personas = useApp((s) => s.personas);
  const lorebooks = useApp((s) => s.lorebooks);
  const presets = useApp((s) => s.presets);
  // Installed user plugins live on the kernel (sync read, same as PluginsPage).
  const kernel = useApp((s) => s.kernel);
  const pluginCount = kernel?.records().filter((r) => r.origin !== 'builtin').length ?? 0;

  const groups: Array<{ name: string; sections: Array<(typeof SETTINGS_SECTIONS)[number]> }> = [];
  for (const section of SETTINGS_SECTIONS) {
    let g = groups.find((x) => x.name === section.group);
    if (!g) {
      g = { name: section.group, sections: [] };
      groups.push(g);
    }
    g.sections.push(section);
  }

  const valueFor = (id: SettingsSectionId): string | undefined => {
    switch (id) {
      case 'persona':
        return personas[0]?.name || '未设置';
      case 'models':
        return settings.defaultConnectionId ? '已配置' : '未配置';
      case 'image':
        return settings.imageGen?.key ? '已配置' : '未配置';
      case 'appearance':
        return (THEME_MAP.get(settings.themeId) ?? BUILTIN_THEMES[0]).label;
      case 'memory':
        return settings.memory.mode === 'off' ? '关闭' : settings.memory.mode === 'classic' ? '基础' : '增强';
      case 'tools': {
        const n = [settings.tools.keywordEnabled, settings.tools.webEnabled, settings.tools.randomEnabled].filter(Boolean).length;
        return n ? `${n} 项启用` : '关闭';
      }
      default:
        return undefined;
    }
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-1">
      {groups.map((group) => (
        <section key={group.name} aria-label={group.name}>
          <h2 className="mb-1.5 px-1 text-[12px] font-semibold text-[var(--rp-fg-subtle)]">{group.name}</h2>
          <div className="overflow-hidden rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]">
            {group.sections.map((section, i) => {
              const value = valueFor(section.id);
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => {
                    vibrate('tap');
                    onOpen(section.id);
                  }}
                  className={cn(
                    'rp-tap flex w-full cursor-pointer items-center gap-3 px-4 py-4 text-left hover:bg-[var(--rp-bg-sunken)]',
                    i > 0 && 'border-t border-[var(--rp-border)]',
                  )}
                >
                  <span className="text-[var(--rp-fg-subtle)]">{section.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{section.label}</span>
                  {value !== undefined && (
                    <span className="max-w-[10rem] truncate text-[13px] text-[var(--rp-fg-muted)]">{value}</span>
                  )}
                  <ChevronRight className="size-4 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {/* 内容组：世界书/预设/小说是独立页面，不是设置子区块。 */}
      <section aria-label="内容">
        <h2 className="mb-1.5 px-1 text-[12px] font-semibold text-[var(--rp-fg-subtle)]">内容</h2>
        <div className="overflow-hidden rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]">
          {(
            [
              { label: '世界书', route: 'lore' as const, value: lorebooks.length ? `${lorebooks.length} 本` : undefined },
              { label: '预设', route: 'presets' as const, value: presets.length ? `${presets.length} 套` : undefined },
              { label: '小说', route: 'novel' as const, value: undefined },
            ]
          ).map((item, i) => (
            <button
              key={item.route}
              type="button"
              onClick={() => {
                vibrate('tap');
                onOpenRoute?.(item.route);
              }}
              className={cn(
                'rp-tap flex w-full cursor-pointer items-center gap-3 px-4 py-4 text-left hover:bg-[var(--rp-bg-sunken)]',
                i > 0 && 'border-t border-[var(--rp-border)]',
              )}
            >
              <span className="text-[var(--rp-fg-subtle)]">
                {item.route === 'lore' ? <BookMarked className="size-4" aria-hidden="true" /> : item.route === 'presets' ? <Sparkles className="size-4" aria-hidden="true" /> : <BookOpen className="size-4" aria-hidden="true" />}
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{item.label}</span>
              {item.value !== undefined && (
                <span className="max-w-[10rem] truncate text-[13px] text-[var(--rp-fg-muted)]">{item.value}</span>
              )}
              <ChevronRight className="size-4 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
      {/* 插件管理：独立页面（安装 .rpnx / 每插件设置），不是设置子区块。 */}
      <section aria-label="插件">
        <h2 className="mb-1.5 px-1 text-[12px] font-semibold text-[var(--rp-fg-subtle)]">扩展</h2>
        <div className="overflow-hidden rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]">
          <button
            type="button"
            onClick={() => {
              vibrate('tap');
              onOpenPlugins?.();
            }}
            className="flex w-full cursor-pointer items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--rp-bg-sunken)]"
          >
            <Puzzle className="size-4 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate text-[15px] font-medium">插件管理</span>
            <span className="max-w-[10rem] truncate text-[13px] text-[var(--rp-fg-muted)]">
              {pluginCount > 0 ? `已安装 ${pluginCount}` : '未安装'}
            </span>
            <ChevronRight className="size-4 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
          </button>
        </div>
      </section>
    </div>
  );
}
