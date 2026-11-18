/**
 * Global navigation drawer — Tavo's left panel.
 *
 * Three panes driven by the bottom round buttons:
 *   聊天  — the chat list (tapping a row opens that chat),
 *   应用  — the feature grid (角色卡 / 世界书 / 预设 / 插件 / 小说),
 *   更多  — per-chat settings rows (身份 / 模型 / 生图 / 预设 / 正则…).
 *
 * Unlike `ChatDrawer` (the in-chat ☰), this one works on every page and does
 * not require an active chat, so it can render before any chat exists.
 */

import * as React from 'react';
import {
  BookMarked,
  ChevronRight,
  GitBranch,
  IdCard,
  ImagePlus,
  Layers,
  ListChecks,
  MessagesSquare,
  MoreHorizontal,
  Puzzle,
  Sparkles,
  UserRound,
  Wrench,
  X,
} from 'lucide-react';
import type { Route } from '@/components/layout/AppShell.js';
import { useApp } from '@/state/store.js';
import { useSidebarStatus } from '@/hooks/useSidebarStatus.js';
import { BUILTIN_THEMES, THEME_MAP } from '@/core/defaults/themes.js';
import { vibrate } from '@/lib/haptics';

export function GlobalDrawer({
  open,
  onOpenChange,
  onNavigate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onNavigate: (route: Route, tab?: string) => void;
}) {
  const chats = useApp((s) => s.chats);
  const cards = useApp((s) => s.cards);
  const activeChatId = useApp((s) => s.activeChatId);
  const setActiveChat = useApp((s) => s.setActiveChat);
  const settings = useApp((s) => s.settings);
  const presets = useApp((s) => s.presets);
  const sidebar = useSidebarStatus(chats.find((c) => c.id === activeChatId)?.personaId);
  const lorebooks = useApp((s) => s.lorebooks);
  const [navTab, setNavTab] = React.useState<'chats' | 'apps' | 'more'>('chats');

  // Esc closes (standard sheet behaviour).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const activeChat = chats.find((c) => c.id === activeChatId);
  const activeCard = cards.find((c) => c.id === activeChat?.cardId);
  const preset = presets.find((p) => p.id === (activeChat?.presetId ?? settings.defaultPresetId));
  const theme = THEME_MAP.get(settings.themeId) ?? BUILTIN_THEMES[0];
  const bookNames = (activeChat?.lorebookIds ?? [])
    .map((id) => lorebooks.find((b) => b.id === id)?.name)
    .filter(Boolean)
    .join('、');
  const scripts = (activeCard?.data.extensions?.regex_scripts as Array<{ id: string; disabled: boolean }> | undefined) ?? [];
  const memoryLabel =
    settings.memory.mode === 'off' ? '关闭' : settings.memory.mode === 'classic' ? '基础' : '增强';
  const enabledTools = [settings.tools.keywordEnabled, settings.tools.webEnabled, settings.tools.randomEnabled].filter(Boolean).length;

  type Row = { label: string; value?: string; icon: React.ReactNode; onPress?: () => void };
  const moreRows: Row[] = [
    { label: '用户身份', value: sidebar.personaName || '未设置', icon: <UserRound className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'persona') },
    { label: '模型连接', value: sidebar.apiConnectionName ?? '未配置', icon: <Layers className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'models') },
    { label: '生图', value: sidebar.imageConfigured ? '已配置' : '未配置', icon: <ImagePlus className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'image') },
    { label: '自动生图', value: sidebar.autoImageConfigured ? '已配置' : '未配置', icon: <ImagePlus className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'imagegen') },
    { label: '预设', value: preset?.name || '默认', icon: <Sparkles className="size-4" aria-hidden="true" />, onPress: () => onNavigate('presets') },
    { label: '世界书', value: bookNames || '未启用', icon: <BookMarked className="size-4" aria-hidden="true" />, onPress: () => onNavigate('lore') },
    { label: '正则', value: `${scripts.filter((s) => !s.disabled).length}/${scripts.length} 启用`, icon: <ListChecks className="size-4" aria-hidden="true" />, onPress: () => onNavigate('cards') },
    { label: '主题', value: theme.label, icon: <Layers className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'appearance') },
    { label: '记忆', value: memoryLabel, icon: <MessagesSquare className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'memory') },
    { label: '工具', value: enabledTools ? `${enabledTools} 项启用` : '关闭', icon: <Wrench className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'tools') },
    { label: '剧情分支', value: `${activeChat?.branches?.length ?? 0} 条`, icon: <GitBranch className="size-4" aria-hidden="true" />, onPress: () => onNavigate('chats') },
    { label: '备份', icon: <Layers className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'backup') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="导航抽屉">
      <button
        type="button"
        aria-label="关闭"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
      />
      <div className="rp-anim-pop relative flex h-full w-[min(20rem,86vw)] shrink-0 flex-col border-r border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] shadow-rp">
        {/* Header */}
        <div className="flex items-center gap-2.5 border-b border-[var(--rp-border)] px-3 py-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[13px] font-semibold text-[var(--rp-fg-muted)]">
            {activeCard?.avatar ? (
              <img src={activeCard.avatar} alt="" className="size-full object-cover" />
            ) : (
              <MessagesSquare className="size-5" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">RPNow</p>
            {activeCard && <p className="truncate text-[11px] text-[var(--rp-fg-subtle)]">当前：{activeCard.data.name}</p>}
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Content pane: `w-full` would let it stretch past the panel inside
            the flex row, covering the mask. It is a column child, so it fills
            the panel's width — nothing more. */}
        <div className="rp-scroll min-h-0 w-full flex-1 overflow-y-auto py-1">
          {navTab === 'chats' && (
            <div className="px-2 pb-2">
              <div className="flex items-center gap-2 px-1 py-2">
                <h2 className="text-[13px] font-semibold">全部聊天</h2>
                <button
                  type="button"
                  aria-label="新建对话"
                  title="从角色卡开始新对话"
                  onClick={() => {
                    vibrate('tap');
                    onOpenChange(false);
                    onNavigate('cards');
                  }}
                  className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded-full border border-[var(--rp-border)] text-[var(--rp-fg-muted)]"
                >
                  +
                </button>
              </div>
              {[...chats]
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map((c) => {
                  const cc = cards.find((x) => x.id === c.cardId);
                  const name = cc?.data.name || c.title || '未命名';
                  const last = c.messages.at(-1);
                  const active = c.id === activeChatId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      aria-label={`打开与 ${name} 的对话`}
                      onClick={() => {
                        vibrate('tap');
                        setActiveChat(c.id);
                        onOpenChange(false);
                        onNavigate('chat');
                      }}
                      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2.5 text-left transition-colors ${
                        active ? 'bg-[var(--rp-accent-soft)]' : 'hover:bg-[var(--rp-bg-sunken)]'
                      }`}
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[13px] font-semibold text-[var(--rp-fg-muted)]">
                        {cc?.avatar ? <img src={cc.avatar} alt="" className="size-full object-cover" /> : name.slice(0, 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-[13px] font-semibold ${active ? 'text-[var(--rp-accent)]' : ''}`}>
                          {name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--rp-fg-muted)]">
                          {(last?.content ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || '（空对话）'}
                        </span>
                      </span>
                    </button>
                  );
                })}
              {chats.length === 0 && (
                <p className="px-2 py-6 text-center text-[12px] text-[var(--rp-fg-subtle)]">
                  还没有对话。点右上角 ＋ 从角色卡开始。
                </p>
              )}
            </div>
          )}

          {navTab === 'apps' && (
            <div className="grid grid-cols-3 gap-2 px-3 py-3">
              {[
                { label: '角色卡', icon: <IdCard className="size-5" aria-hidden="true" />, go: () => onNavigate('cards') },
                { label: '世界书', icon: <BookMarked className="size-5" aria-hidden="true" />, go: () => onNavigate('lore') },
                { label: '预设', icon: <Sparkles className="size-5" aria-hidden="true" />, go: () => onNavigate('presets') },
                { label: '插件', icon: <Puzzle className="size-5" aria-hidden="true" />, go: () => onNavigate('plugins') },
                { label: '小说', icon: <BookMarked className="size-5" aria-hidden="true" />, go: () => onNavigate('novel') },
                { label: '设置', icon: <Layers className="size-5" aria-hidden="true" />, go: () => onNavigate('settings') },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    vibrate('tap');
                    item.go();
                    onOpenChange(false);
                  }}
                  className="flex min-h-[84px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--rp-border)] text-[12px] transition-colors hover:bg-[var(--rp-bg-sunken)]"
                >
                  <span className="text-[var(--rp-accent)]">{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {navTab === 'more' && (
            <div className="py-1">
              {moreRows.map((row) => (
                <button
                  key={row.label}
                  type="button"
                  onClick={() => {
                    vibrate('tap');
                    row.onPress?.();
                    onOpenChange(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-2.5 text-left text-[13px] transition-colors hover:bg-[var(--rp-bg-sunken)]"
                >
                  <span className="text-[var(--rp-fg-subtle)]">{row.icon}</span>
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>
                  {row.value !== undefined && (
                    <span className="max-w-[9rem] truncate text-[11.5px] text-[var(--rp-fg-subtle)]">{row.value}</span>
                  )}
                  {row.onPress && <ChevronRight className="size-3.5 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Bottom navigation — Tavo's three round buttons. */}
        <nav
          aria-label="抽屉导航"
          className="flex items-center justify-around border-t border-[var(--rp-border)] px-2 py-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]"
        >
          {(
            [
              { key: 'chats', label: '聊天', icon: <MessagesSquare className="size-5" aria-hidden="true" /> },
              { key: 'apps', label: '应用', icon: <IdCard className="size-5" aria-hidden="true" /> },
              { key: 'more', label: '更多', icon: <MoreHorizontal className="size-5" aria-hidden="true" /> },
            ] as const
          ).map((t) => (
            <button
              key={t.key}
              type="button"
              aria-label={t.label}
              aria-current={navTab === t.key ? 'true' : undefined}
              onClick={() => {
                vibrate('tap');
                setNavTab(t.key);
              }}
              className={`flex size-14 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full text-[10px] transition-colors ${
                navTab === t.key
                  ? 'bg-[var(--rp-accent-soft)] text-[var(--rp-accent)]'
                  : 'text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)]'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
