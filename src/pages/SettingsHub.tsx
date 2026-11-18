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
  Info,
  Layout,
  MessageSquare,
  Palette,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Wrench,
} from 'lucide-react';
import { useApp } from '@/state/store.js';
import { APP_VERSION } from '@/core/version.js';
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
  | 'data'
  | 'about';

export const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId;
  label: string;
  icon: React.ReactNode;
  group: string;
}> = [
  { id: 'models', label: '聊天 API', icon: <SlidersHorizontal className="size-4" aria-hidden="true" />, group: '聊天' },
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
  { id: 'about', label: '关于', icon: <Info className="size-4" aria-hidden="true" />, group: '关于' },
];

/** Current-value string for a section, or undefined to show nothing. */
export function useSectionValue(id: SettingsSectionId): string | undefined {
  const settings = useApp((s) => s.settings);
  const personas = useApp((s) => s.personas);
  const llmConnections = useApp((s) => s.llmConnections);
  const imageConnections = useApp((s) => s.imageConnections);
  const apiConnection =
    llmConnections.find((c) => c.id === settings.defaultConnectionId) ?? llmConnections[0];
  switch (id) {
    case 'persona':
      return personas[0]?.name || '未设置';
    case 'models':
      return apiConnection?.name ?? '未配置';
    case 'image':
      return imageConnections.length ? '已配置' : '未配置';
    case 'imagegen':
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
    case 'about':
      return `v${APP_VERSION}`;
    default:
      return undefined;
  }
}

/** 商店轮播的两张图：每张图上招牌字就是店名。图片是 webp、1200×400、每张约 50–70KB。 */
const STORE_SLIDES: Array<{
  route: 'card-store' | 'plugin-store';
  label: string;
  img: string;
  alt: string;
  caption: string;
}> = [
  {
    route: 'card-store',
    label: '角色卡商店',
    img: '/carousel-card.webp',
    alt: '角色卡商店：暖光小店，漂浮的角色卡',
    caption: '逛逛角色卡，找你的下一个主角',
  },
  {
    route: 'plugin-store',
    label: '插件商店',
    img: '/carousel-plugin.webp',
    alt: '插件商店：青光工坊，漂浮的拼图和齿轮',
    caption: '给应用装上新本事',
  },
];

export function SettingsHub({
  onOpen,
  /** Opens the standalone plugins page (插件管理不是设置子区块). */
  onOpenPlugins,
  /** Opens sibling content pages (世界书/预设/小说 — separate routes). */
  onOpenRoute,
}: {
  onOpen: (id: SettingsSectionId) => void;
  onOpenPlugins?: () => void;
  onOpenRoute?: (route: 'lore' | 'presets' | 'novel' | 'card-store' | 'plugin-store') => void;
}) {
  const settings = useApp((s) => s.settings);
  const personas = useApp((s) => s.personas);
  const llmConnections = useApp((s) => s.llmConnections);
  const imageConnections = useApp((s) => s.imageConnections);
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
    const apiConnection =
      llmConnections.find((c) => c.id === settings.defaultConnectionId) ?? llmConnections[0];
    switch (id) {
      case 'persona':
        return personas[0]?.name || '未设置';
      case 'models':
        return apiConnection?.name ?? '未配置';
      case 'image':
        return imageConnections.length ? '已配置' : '未配置';
      case 'imagegen':
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

  const [slide, setSlide] = React.useState(0);
  const touchX = React.useRef<number | null>(null);
  // 每 4 秒自动切下一张；手动切过后重新计时。
  React.useEffect(() => {
    const t = window.setTimeout(() => setSlide((s) => (s + 1) % STORE_SLIDES.length), 4000);
    return () => window.clearTimeout(t);
  }, [slide]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-1">
      {/* 商店轮播：两张图各是一家商店，图上的招牌字就是店名（图里自带文字）。点图进店，左右滑或点圆点切换。 */}
      <section aria-label="商店">
        <div
          className="relative h-[132px] overflow-hidden rounded-2xl border border-[var(--rp-border)]"
          onTouchStart={(e) => {
            touchX.current = e.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(e) => {
            if (touchX.current == null) return;
            const dx = (e.changedTouches[0]?.clientX ?? touchX.current) - touchX.current;
            if (Math.abs(dx) > 40) {
              setSlide((s) => (dx < 0 ? (s + 1) % STORE_SLIDES.length : (s + STORE_SLIDES.length - 1) % STORE_SLIDES.length));
            }
            touchX.current = null;
          }}
        >
          {STORE_SLIDES.map((s, i) => (
            <button
              key={s.route}
              type="button"
              aria-label={`进入${s.label}`}
              onClick={() => {
                vibrate('tap');
                onOpenRoute?.(s.route);
              }}
              className={`absolute inset-0 block h-full w-full cursor-pointer transition-opacity duration-500 ${i === slide ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
            >
              <img src={s.img} alt={s.alt} className="block h-full w-full object-cover" />
              <span className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-black/55 to-transparent p-3 pt-8">
                <span className="text-[12.5px] text-white/90">{s.caption}</span>
                <span className="shrink-0 rounded-full bg-white/95 px-3 py-1 text-[12.5px] font-medium text-[#241b3d]">进入商店 →</span>
              </span>
            </button>
          ))}
          <div className="absolute right-3 top-3 flex gap-1.5">
            {STORE_SLIDES.map((s, i) => (
              <button
                key={s.route}
                type="button"
                aria-label={`切换到${s.label}`}
                onClick={() => setSlide(i)}
                className={`h-1.5 rounded-full transition-all ${i === slide ? 'w-4 bg-white' : 'w-1.5 bg-white/60'}`}
              />
            ))}
          </div>
        </div>
      </section>
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
