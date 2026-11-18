/**
 * Session rail: the list of chats. Hidden on phones (the bottom nav covers
 * navigation there), shown as a narrow column from tablet up.
 */

import { useState } from 'react';
import { MessageSquarePlus, PanelLeftClose, PanelLeftOpen, Trash2 } from 'lucide-react';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { RPChat } from '@/core/types/chat.js';
import type { RPCard } from '@/core/types/card.js';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/misc.js';
import { useApp } from '@/state/store.js';
import { confirmAction } from '@/components/ui/confirm.js';

export interface SessionRailProps {
  chats: RPChat[];
  cards: RPCard[];
  activeId: string;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function SessionRail({ chats, cards, activeId, onSelect, onNew }: SessionRailProps) {
  const [collapsed, setCollapsed] = useState(false);
  const removeChat = useApp((s) => s.removeChat);

  if (collapsed) {
    return (
      <div className="hidden w-11 shrink-0 flex-col items-center gap-2 border-r border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/50 py-2 md:flex">
        <Hint label="展开会话列表" side="right">
          <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(false)} aria-label="展开会话列表">
            <PanelLeftOpen className="size-4" aria-hidden="true" />
          </Button>
        </Hint>
        <Hint label="新建对话" side="right">
          <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="新建对话">
            <MessageSquarePlus className="size-4" aria-hidden="true" />
          </Button>
        </Hint>
      </div>
    );
  }

  return (
    <div className="hidden w-60 shrink-0 flex-col border-r border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/50 md:flex">
      <div className="flex items-center gap-1 px-2 py-2">
        <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--rp-fg-subtle)]">
          会话
        </span>
        <div className="ml-auto flex items-center">
          <Hint label="新建对话">
            <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="新建对话">
              <MessageSquarePlus className="size-4" aria-hidden="true" />
            </Button>
          </Hint>
          <Hint label="收起列表">
            <Button variant="ghost" size="icon-sm" onClick={() => setCollapsed(true)} aria-label="收起会话列表">
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </Button>
          </Hint>
        </div>
      </div>
      <ul className="rp-scroll min-h-0 flex-1 space-y-0.5 overflow-y-auto px-1.5 pb-3">
        {chats.length === 0 && (
          <li className="px-2 py-6 text-center text-[12px] text-[var(--rp-fg-subtle)]">还没有会话</li>
        )}
        {chats.map((chat) => {
          const card = cards.find((c) => c.id === chat.cardId);
          const active = chat.id === activeId;
          return (
            <li key={chat.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(chat.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                  active
                    ? 'bg-[var(--rp-accent-soft)] text-[var(--rp-fg)]'
                    : 'text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-elevated)]',
                )}
              >
                {card?.avatar ? (
                  <img src={card.avatar} alt="" className="size-8 shrink-0 rounded-md object-cover" />
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-[var(--rp-bg-sunken)] text-[11px] font-semibold">
                    {(card?.data.name ?? '?').slice(0, 1)}
                  </div>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium">{chat.title}</span>
                  <span className="block truncate text-[10.5px] text-[var(--rp-fg-subtle)]">
                    {chat.messages.length} 条 · {formatRelativeTime(chat.updatedAt)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-label={`删除会话 ${chat.title}`}
                onClick={async () => {
                  if (await confirmAction({ title: '确认操作', description: `删除会话「${chat.title}」？` })) void removeChat(chat.id);
                }}
                className="absolute right-1 top-1/2 hidden size-7 -translate-y-1/2 cursor-pointer items-center justify-center rounded text-[var(--rp-fg-subtle)] hover:bg-[var(--rp-danger)]/10 hover:text-[var(--rp-danger)] group-hover:flex"
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
