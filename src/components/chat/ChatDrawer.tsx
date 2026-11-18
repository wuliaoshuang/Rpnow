/**
 * Chat drawer — the hamburger menu inside an immersive chat.
 *
 * Mirrors Tavo's drawer: one row per concern, each showing the **current
 * value** on the right (预设：名字 >、正则：N 条 >、记忆：关闭 >), so the user
 * can see the chat's active configuration at a glance and jump straight to it.
 *
 * The 正则 row expands in place: every card script gets a Switch, so enabling
 * and disabling a regex is one tap from inside the chat.
 */

import * as React from 'react';
import {
  BookMarked,
  ChevronRight,
  GitBranch,
  ImagePlus,
  ListChecks,
  Maximize,
  MessagesSquare,
  MoreHorizontal,
  Puzzle,
  Sparkles,
  UserRound,
  Wrench,
  CloudUpload,
  Layers,
  IdCard,
  X,
} from 'lucide-react';
import type { RPCard } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';
import type { Route } from '@/components/layout/AppShell.js';
import { useApp } from '@/state/store.js';
import { useSidebarStatus } from '@/hooks/useSidebarStatus.js';
import { BUILTIN_THEMES, THEME_MAP } from '@/core/defaults/themes.js';
import { Switch } from '@/components/ui/input';
import { vibrate } from '@/lib/haptics';

export interface DrawerNavigate {
  (route: Route, tab?: string): void;
}

export function ChatDrawer({
  open,
  onOpenChange,
  chat,
  card,
  onNavigate,
  onOpenBranches,
  onToggleFullscreen,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chat: RPChat;
  card: RPCard;
  /** Navigate to a route, or to a specific settings tab. */
  onNavigate: DrawerNavigate;
  onOpenBranches: () => void;
  onToggleFullscreen: () => void;
}) {
  const settings = useApp((s) => s.settings);
  const presets = useApp((s) => s.presets);
  const sidebar = useSidebarStatus(chat.personaId);
  const lorebooks = useApp((s) => s.lorebooks);
  const updateCard = useApp((s) => s.updateCard);
  const chats = useApp((s) => s.chats);
  const cards = useApp((s) => s.cards);
  const setActiveChat = useApp((s) => s.setActiveChat);
  const [regexOpen, setRegexOpen] = React.useState(false);
  // Which of the bottom navigation buttons is highlighted.
  const [navTab, setNavTab] = React.useState<'chats' | 'apps' | 'more'>('chats');

  // Esc closes the drawer (standard sheet behaviour).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const preset = presets.find((p) => p.id === (chat.presetId ?? settings.defaultPresetId));
  const bookNames = chat.lorebookIds
    .map((id) => lorebooks.find((b) => b.id === id)?.name)
    .filter(Boolean)
    .join('、');
  const scripts = (card.data.extensions?.regex_scripts as Array<{ id: string; scriptName: string; disabled: boolean }> | undefined) ?? [];
  const enabledTools = [settings.tools.keywordEnabled, settings.tools.webEnabled, settings.tools.randomEnabled].filter(Boolean).length;
  const theme = THEME_MAP.get(settings.themeId) ?? BUILTIN_THEMES[0];
  const memoryLabel =
    settings.memory.mode === 'off' ? '关闭' : settings.memory.mode === 'classic' ? '基础' : '增强';

  const toggleScript = (id: string) => {
    void updateCard(card.id, (c) => ({
      ...c,
      data: {
        ...c.data,
        extensions: {
          ...c.data.extensions,
          regex_scripts: ((c.data.extensions?.regex_scripts ?? []) as Array<{ id: string; disabled: boolean }>).map((s) =>
            s.id === id ? { ...s, disabled: !s.disabled } : s,
          ),
        },
      },
    }));
  };

  type Row = { label: string; value?: string; icon: React.ReactNode; onPress?: () => void };
  const rows: Array<Row | 'divider'> = [
    { label: '用户身份', value: sidebar.personaName || '未设置', icon: <UserRound className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'persona') },
    { label: '模型连接', value: sidebar.apiConnectionName ?? '未配置', icon: <Layers className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'models') },
    { label: '生图', value: sidebar.imageConfigured ? '已配置' : '未配置', icon: <ImagePlus className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'image') },
    { label: '自动生图', value: sidebar.autoImageConfigured ? '已配置' : '未配置', icon: <ImagePlus className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'imagegen') },
    { label: '预设', value: preset?.name || '默认', icon: <Sparkles className="size-4" aria-hidden="true" />, onPress: () => onNavigate('presets') },
    { label: '世界书', value: bookNames || '未启用', icon: <BookMarked className="size-4" aria-hidden="true" />, onPress: () => onNavigate('lore') },
    { label: '正则', value: regexOpen ? undefined : `${scripts.filter((s) => !s.disabled).length}/${scripts.length} 启用`, icon: <ListChecks className="size-4" aria-hidden="true" />, onPress: () => setRegexOpen((v) => !v) },
    { label: '主题', value: theme.label, icon: <Layers className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'appearance') },
    'divider',
    { label: '记忆', value: memoryLabel, icon: <MessagesSquare className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'memory') },
    { label: '工具', value: enabledTools ? `${enabledTools} 项启用` : '关闭', icon: <Wrench className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'tools') },
    { label: '剧情分支', value: `${chat.branches?.length ?? 0} 条`, icon: <GitBranch className="size-4" aria-hidden="true" />, onPress: () => { onOpenChange(false); onOpenBranches(); } },
    { label: '全屏', icon: <Maximize className="size-4" aria-hidden="true" />, onPress: () => { onOpenChange(false); onToggleFullscreen(); } },
    { label: '备份', icon: <CloudUpload className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'backup') },
  ];

  return (
    <div className="fixed inset-0 z-50 flex" role="dialog" aria-label="对话菜单">
      <button
        type="button"
        aria-label="关闭菜单"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
      />
      <div className="rp-anim-pop relative flex h-full w-[min(20rem,86vw)] flex-col border-r border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] shadow-rp">
        {/* Character header */}
        <div className="flex items-center gap-2.5 border-b border-[var(--rp-border)] px-3 py-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)]">
          <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[13px] font-semibold text-[var(--rp-fg-muted)]">
            {card.avatar ? <img src={card.avatar} alt="" className="size-full object-cover" /> : card.data.name.slice(0, 1)}
          </span>
          <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{card.data.name}</p>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        {/* Main pane: the chat list (Tavo-style) or the app grid. */}
        <div className="rp-scroll min-h-0 flex-1 overflow-y-auto py-1">
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
                  const active = c.id === chat.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        vibrate('tap');
                        setActiveChat(c.id);
                        onOpenChange(false);
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
                  还没有对话。从角色卡开始。
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
              {rows.map((row, i) =>
                row === 'divider' ? (
                  <div key={`d${i}`} className="my-1.5 border-t border-[var(--rp-border)]" />
                ) : (
                  <div key={row.label}>
                    <button
                      type="button"
                      onClick={() => {
                        vibrate('tap');
                        row.onPress?.();
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

                    {/* Regex scripts expand inline with per-script toggles. */}
                    {row.label === '正则' && regexOpen && (
                      <div className="mx-3 mb-1.5 space-y-1 rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/60 p-2">
                        {scripts.length === 0 ? (
                          <p className="py-1.5 text-[11px] text-[var(--rp-fg-subtle)]">
                            这张卡没有正则脚本。在角色卡编辑器里可以添加。
                          </p>
                        ) : (
                          scripts.map((s) => (
                            <div key={s.id} className="flex items-center gap-2 rounded-md px-1 py-1">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12px]">{s.scriptName}</p>
                                <p className="text-[10px] text-[var(--rp-fg-subtle)]">
                                  {s.disabled ? '已停用' : '运行中'}
                                </p>
                              </div>
                              <Switch
                                checked={!s.disabled}
                                onCheckedChange={() => toggleScript(s.id)}
                                aria-label={`${s.disabled ? '启用' : '停用'} ${s.scriptName}`}
                              />
                            </div>
                          ))
                        )}
                        <p className="px-1 pb-0.5 text-[10px] leading-snug text-[var(--rp-fg-subtle)]">
                          切换立即生效；停用后显示与提示词都会恢复原文。
                        </p>
                      </div>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
        </div>

        {/* Bottom navigation, mirroring Tavo's three round buttons. */}
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
              className={`flex size-12 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-full text-[10px] transition-colors ${
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
