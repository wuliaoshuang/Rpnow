/**
 * Left panel — the chat list (Tavo's left sidebar).
 *
 * Brand header + "全部聊天" + new-chat button, then the conversation rows
 * (avatar / name / last-message snippet / ⋮ menu). The bottom row holds three
 * round navigation buttons that open the feature pages.
 *
 * This is content only: `PushAside` owns the slide-in and the pushed layout.
 */

import * as React from 'react';
import { ChevronDown, IdCard, MoreHorizontal, MoreVertical, Plus, SlidersHorizontal } from 'lucide-react';
import type { Route } from '@/components/layout/AppShell.js';
import { useApp } from '@/state/store.js';
import { vibrate } from '@/lib/haptics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/misc';
import { toast } from '@/components/ui/toast.js';
import { CreateChatSheet } from '@/components/chat/CreateChatSheet.js';
import { formatRelativeTime } from '@/lib/utils.js';
import { GroupAvatar } from '@/components/chat/GroupAvatar.js';
import { cn } from '@/lib/utils.js';
import { confirmAction } from '@/components/ui/confirm.js';

/** Flatten a message into a one-line snippet. */
function snippet(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
}

export function ChatListPanel({
  onOpenChat,
  onOpenCards,
  onNavigate,
  onClose,
}: {
  onOpenChat: (id: string) => void;
  onOpenCards: () => void;
  onNavigate: (route: Route, tab?: string) => void;
  /** Called before navigating away, so the panel does not stay pushed open. */
  onClose?: () => void;
}) {
  const chats = useApp((s) => s.chats);
  const cards = useApp((s) => s.cards);
  const activeChatId = useApp((s) => s.activeChatId);
  const removeChat = useApp((s) => s.removeChat);

  /** 按角色筛选：null = 全部聊天。 */
  const [filterCardId, setFilterCardId] = React.useState<string | null>(null);
  /** 创建聊天 sheet（选择角色）。 */
  const [createSheetOpen, setCreateSheetOpen] = React.useState(false);

  /** Navigate and dismiss the panel in one step. */
  const go = (route: Route, tab?: string) => {
    onClose?.();
    onNavigate(route, tab);
  };

  const sorted = React.useMemo(() => [...chats].sort((a, b) => b.updatedAt - a.updatedAt), [chats]);

  /** 有对话的角色，按最近对话排序（筛选用）。 */
  const filterableCards = React.useMemo(() => {
    const seen: string[] = [];
    for (const chat of sorted) {
      const ids = [chat.cardId, ...(chat.groupCardIds ?? [])];
      for (const id of ids) {
        if (id && !seen.includes(id)) seen.push(id);
      }
    }
    return seen.map((id) => cards.find((c) => c.id === id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  }, [sorted, cards]);

  const filterCard = filterCardId ? cards.find((c) => c.id === filterCardId) : undefined;
  const visibleChats = filterCardId
    ? sorted.filter((chat) => chat.cardId === filterCardId || chat.groupCardIds?.includes(filterCardId))
    : sorted;

  return (
    <>
      {/* Brand header. Modern italic serif mark; right padding keeps the
          gradient tail from clipping against the version chip. */}
      <div className="flex shrink-0 items-end gap-2 px-4 pb-2 pt-[calc(env(safe-area-inset-top,0px)+1rem)]">
        <span
          className="bg-gradient-to-r from-[var(--rp-accent)] to-[var(--rp-fg)] bg-clip-text pr-1.5 text-[27px] font-bold italic leading-none tracking-tight text-transparent"
          style={{ fontFamily: 'var(--rp-font-brand)' }}
        >
          RPNow
        </span>
        <span className="pb-0.5 text-[10.5px] text-[var(--rp-fg-subtle)]">v0.1.0</span>
      </div>

      {/* Section header — Tavo layout: "全部聊天" opens a per-character filter,
          the ＋ opens a small menu (创建聊天 / 导入聊天). */}
      <div className="flex shrink-0 items-center gap-1 px-4 pb-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 text-[15px] font-bold"
              aria-label={filterCard ? `只看和 ${filterCard.data.name} 的聊天` : '全部聊天'}
            >
              {filterCard ? filterCard.data.name : '全部聊天'}
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-[70dvh] w-64 overflow-y-auto p-2">
            {/* Tavo 的样式：标题行本身就是"全部聊天"选项（点它恢复全部），
                下面直接跟角色行，中间没有分割线，行高和字号都比默认菜单大。 */}
            <DropdownMenuItem
              onSelect={() => setFilterCardId(null)}
              className="px-3 py-2.5 text-[16px] font-bold"
            >
              全部聊天
            </DropdownMenuItem>
            {filterableCards.map((card) => (
              <DropdownMenuItem
                key={card.id}
                onSelect={() => setFilterCardId(card.id)}
                className="gap-3 px-3 py-2.5"
              >
                <GroupAvatar cards={[card]} size={40} />
                <span className={cn('text-[15px]', filterCardId === card.id && 'font-semibold')}>
                  {card.data.name}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="新建对话"
              onClick={() => vibrate('tap')}
              className="ml-auto flex size-8 cursor-pointer items-center justify-center rounded-full border border-[var(--rp-border-strong)] text-[var(--rp-fg-muted)] transition-colors hover:text-[var(--rp-fg)]"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={() => {
                vibrate('tap');
                setCreateSheetOpen(true);
              }}
            >
              创建聊天
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                vibrate('tap');
                toast.info('导入聊天还没做', '现在只能在角色卡页导入角色卡');
              }}
            >
              导入聊天
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Rows */}
      {/* No entrance animation on the sidebar contents: the panel itself
          slides, and staggering every row on top of that felt busy. */}
      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto px-2">
        {visibleChats.map((chat) => {
          const card = cards.find((c) => c.id === chat.cardId);
          const name = card?.data.name || chat.title || '未命名';
          const last = chat.messages.at(-1);
          const active = chat.id === activeChatId;
          return (
            <div
              key={chat.id}
              className={cn(
                'mb-1 flex items-center gap-2 rounded-2xl px-2 py-2.5 transition-colors',
                active ? 'bg-[var(--rp-bg-sunken)]' : 'hover:bg-[var(--rp-bg-sunken)]/60',
              )}
            >
              <button
                type="button"
                onClick={() => {
                  vibrate('tap');
                  onOpenChat(chat.id);
                }}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                aria-label={`打开与 ${name} 的对话`}
              >
                <GroupAvatar
                  cards={
                    chat.groupCardIds?.length
                      ? (chat.groupCardIds.map((id) => cards.find((c) => c.id === id)).filter(Boolean) as typeof cards)
                      : card
                        ? [card]
                        : []
                  }
                  size={44}
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-[14.5px] font-semibold',
                      active ? 'text-[var(--rp-accent)]' : 'text-[var(--rp-fg)]',
                    )}
                  >
                    {name}
                  </span>
                  <span className="mt-0.5 block truncate text-[12px] text-[var(--rp-fg-muted)]">
                    {last ? snippet(last.content) || '…' : '（空对话）'}
                  </span>
                </span>
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`${name} 的对话选项`}
                    className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--rp-fg-subtle)] transition-colors hover:text-[var(--rp-fg)]"
                  >
                    <MoreVertical className="size-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => onOpenChat(chat.id)}>继续对话</DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    onSelect={async () => {
                      if (await confirmAction({ title: '确认操作', description: `删除与「${name}」的对话？此操作不可恢复。` })) {
                        void removeChat(chat.id);
                      }
                    }}
                  >
                    删除对话
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        })}
        {visibleChats.length === 0 && (
          <p className="px-3 py-8 text-center text-[12.5px] text-[var(--rp-fg-subtle)]">
            {filterCard
              ? `还没有和「${filterCard.data.name}」的对话。`
              : '还没有对话。点右上角 ＋ 从角色卡开始。'}
          </p>
        )}
      </div>

      {/* Bottom round navigation */}
      <div className="flex shrink-0 items-center justify-around px-3 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)]">
        {[
          { label: '聊天 API', icon: <SlidersHorizontal className="size-5" aria-hidden="true" />, go: () => go('settings', 'models') },
          { label: '角色', icon: <IdCard className="size-5" aria-hidden="true" />, go: () => go('cards') },
          { label: '更多', icon: <MoreHorizontal className="size-5" aria-hidden="true" />, go: () => go('settings') },
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

      {/* Timestamp of the newest chat, Tavo shows relative times per row instead */}
      <span className="sr-only">{sorted[0] ? formatRelativeTime(sorted[0].updatedAt) : ''}</span>

      {/* 创建聊天：选择角色 sheet。 */}
      <CreateChatSheet
        open={createSheetOpen}
        onClose={() => setCreateSheetOpen(false)}
        onCreated={onOpenChat}
        onOpenCards={() => {
          onClose?.();
          onOpenCards();
        }}
      />
    </>
  );
}
