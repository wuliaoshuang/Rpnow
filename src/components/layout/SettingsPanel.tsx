/**
 * Right panel — the active conversation's settings (Tavo's right sidebar).
 *
 * Header: character avatar + name + new-chat button. Then one row per concern,
 * each showing the **current value** on the right (`用户身份 → 林离`,
 * `正则 → 2 条启用`, `长记忆 → 关闭`). Bottom row: three round buttons.
 *
 * The rows deliberately mirror left-panel navigation: this panel answers "what
 * is this chat using", not "how do I browse".
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
  Plus,
  Repeat,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react';
import type { Route } from '@/components/layout/AppShell.js';
import type { RPCard } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';
import { useApp } from '@/state/store.js';
import { BUILTIN_THEMES, THEME_MAP } from '@/core/defaults/themes.js';
import { Switch } from '@/components/ui/input';
import { vibrate } from '@/lib/haptics';

export function SettingsPanel({
  chat,
  card,
  onNavigate,
  onOpenGroupChat,
  onOpenBranches,
  onOpenInspector,
  onOpenStats,
  onRestart,
  onToggleFullscreen,
  onClearChat,
}: {
  chat?: RPChat;
  card?: RPCard;
  onNavigate: (route: Route, tab?: string) => void;
  /** Opens the group-chat builder (the ＋ in the header). */
  onOpenGroupChat: () => void;
  onOpenBranches: () => void;
  onOpenInspector: () => void;
  /** Opens the per-character token usage sheet. */
  onOpenStats: () => void;
  /** 重启 = 清空对话只保留开场白（main 里带二次确认）。 */
  onRestart: () => void;
  onToggleFullscreen: () => void;
  onClearChat: () => void;
}) {
  const settings = useApp((s) => s.settings);
  const personas = useApp((s) => s.personas);
  const presets = useApp((s) => s.presets);
  const lorebooks = useApp((s) => s.lorebooks);
  const updateCard = useApp((s) => s.updateCard);
  const [regexOpen, setRegexOpen] = React.useState(false);

  const persona = personas.find((p) => p.id === chat?.personaId);
  const preset = presets.find((p) => p.id === (chat?.presetId ?? settings.defaultPresetId));
  const theme = THEME_MAP.get(settings.themeId) ?? BUILTIN_THEMES[0];
  const bookNames = (chat?.lorebookIds ?? [])
    .map((id) => lorebooks.find((b) => b.id === id)?.name)
    .filter(Boolean)
    .join('、');
  const scripts =
    (card?.data.extensions?.regex_scripts as Array<{ id: string; scriptName: string; disabled: boolean }> | undefined) ?? [];
  const enabledScripts = scripts.filter((s) => !s.disabled).length;
  const memoryLabel =
    settings.memory.mode === 'off' ? '关闭' : settings.memory.mode === 'classic' ? '基础' : '增强';
  const enabledTools = [settings.tools.keywordEnabled, settings.tools.webEnabled, settings.tools.randomEnabled].filter(
    Boolean,
  ).length;

  const toggleScript = (id: string) => {
    if (!card) return;
    void updateCard(card.id, (c) => ({
      ...c,
      data: {
        ...c.data,
        extensions: {
          ...c.data.extensions,
          regex_scripts: ((c.data.extensions?.regex_scripts ?? []) as Array<{ id: string; disabled: boolean }>).map(
            (s) => (s.id === id ? { ...s, disabled: !s.disabled } : s),
          ),
        },
      },
    }));
  };

  type Row = {
    label: string;
    value?: string;
    icon: React.ReactNode;
    onPress?: () => void;
    /** Expanding rows render extra content inline. */
    expandable?: boolean;
    danger?: boolean;
  };
  const groups: Array<Array<Row>> = [
    [
      { label: '用户身份', value: persona?.name || '未设置', icon: <UserRound className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'persona') },
    ],
    [
      { label: 'API 连接', value: '前往配置', icon: <SlidersHorizontal className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'models') },
      { label: '生图 API', value: settings.imageGen.key ? '已配置' : '未配置', icon: <ImagePlus className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'imagegen') },
      { label: '预设', value: preset?.name || '默认', icon: <Sparkles className="size-4" aria-hidden="true" />, onPress: () => onNavigate('presets') },
      { label: '世界书', value: bookNames || '未启用', icon: <BookMarked className="size-4" aria-hidden="true" />, onPress: () => onNavigate('lore') },
      {
        label: '正则',
        value: regexOpen ? undefined : `${enabledScripts}/${scripts.length} 启用`,
        icon: <ListChecks className="size-4" aria-hidden="true" />,
        expandable: true,
        onPress: () => setRegexOpen((v) => !v),
      },
      { label: '主题', value: theme.label, icon: <SlidersHorizontal className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'appearance') },
    ],
    [
      { label: '长记忆', value: memoryLabel, icon: <MessagesSquare className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'memory') },
      { label: '工具', value: enabledTools ? `${enabledTools} 项启用` : '关闭', icon: <Wrench className="size-4" aria-hidden="true" />, onPress: () => onNavigate('settings', 'tools') },
      { label: '剧情分支', value: `${chat?.branches?.length ?? 0} 条`, icon: <GitBranch className="size-4" aria-hidden="true" />, onPress: onOpenBranches },
      { label: '情景设定', value: '提示词构成', icon: <SlidersHorizontal className="size-4" aria-hidden="true" />, onPress: onOpenInspector },
    ],
    [
      { label: '全屏', icon: <Maximize className="size-4" aria-hidden="true" />, onPress: onToggleFullscreen },
      { label: '清空对话', icon: <Trash2 className="size-4" aria-hidden="true" />, onPress: onClearChat, danger: true },
    ],
  ];

  return (
    <>
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 px-4 pb-3 pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
        <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[14px] font-semibold text-[var(--rp-fg-muted)]">
          {card?.avatar ? (
            <img src={card.avatar} alt="" className="size-full object-cover" />
          ) : (
            (card?.data.name ?? '?').slice(0, 1)
          )}
        </span>
        <p className="min-w-0 flex-1 truncate text-[16px] font-bold">{card?.data.name ?? '未选择角色'}</p>
        <button
          type="button"
          aria-label="组建群聊"
          title="组建群聊"
          onClick={() => {
            vibrate('tap');
            onOpenGroupChat();
          }}
          className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-[var(--rp-border-strong)] text-[var(--rp-fg-muted)] transition-colors hover:text-[var(--rp-fg)]"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>

      {/* Rows */}
      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto">
        {groups.map((group, gi) => (
          <div key={gi} className="border-t border-[var(--rp-border)]">
            {group.map((row) => (
              <div key={row.label}>
                <button
                  type="button"
                  onClick={() => {
                    vibrate('tap');
                    row.onPress?.();
                  }}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[var(--rp-bg-sunken)]"
                  style={row.danger ? { color: 'var(--rp-danger)' } : undefined}
                >
                  <span className={row.danger ? 'text-[var(--rp-danger)]' : 'text-[var(--rp-fg-subtle)]'}>{row.icon}</span>
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">{row.label}</span>
                  {row.value !== undefined && (
                    <span className="max-w-[10rem] truncate text-[13.5px] text-[var(--rp-fg-muted)]">{row.value}</span>
                  )}
                  {row.onPress && (
                    <ChevronRight className="size-4 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
                  )}
                </button>

                {row.expandable && regexOpen && (
                  <div className="mx-4 mb-2 space-y-1 rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/60 p-2">
                    {scripts.length === 0 ? (
                      <p className="px-1 py-1.5 text-[12px] text-[var(--rp-fg-subtle)]">
                        这张卡没有正则脚本。在角色卡编辑器里可以添加。
                      </p>
                    ) : (
                      scripts.map((s) => (
                        <div key={s.id} className="flex items-center gap-2 rounded-lg px-1 py-1.5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[13px]">{s.scriptName}</p>
                            <p className="text-[11px] text-[var(--rp-fg-subtle)]">
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
                    <p className="px-1 pb-0.5 text-[11px] leading-snug text-[var(--rp-fg-subtle)]">
                      切换立即生效；停用后显示与提示词都会恢复原文。
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Bottom round navigation */}
      <div className="flex shrink-0 items-center justify-around border-t border-[var(--rp-border)] px-3 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
        {[
          { label: '重启', icon: <Repeat className="size-5" aria-hidden="true" />, go: onRestart },
          { label: '统计', icon: <ListChecks className="size-5" aria-hidden="true" />, go: onOpenStats },
          { label: '搜索', icon: <Search className="size-5" aria-hidden="true" />, go: () => onNavigate('chats') },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => {
              vibrate('tap');
              item.go();
            }}
            className="flex cursor-pointer flex-col items-center gap-1.5"
          >
            <span className="flex size-14 items-center justify-center rounded-full bg-[var(--rp-bg-sunken)] text-[var(--rp-fg-muted)] transition-colors hover:text-[var(--rp-fg)]">
              {item.icon}
            </span>
            <span className="text-[11px] font-medium text-[var(--rp-fg-muted)]">{item.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}
