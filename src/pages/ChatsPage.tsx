/**
 * Chat list — the app's home screen, mirroring a messaging app.
 *
 * Newest chat first; each row shows the character's avatar, the character name,
 * a one-line snippet of the last message and a relative time. A per-row menu
 * holds the destructive actions so the row itself is one tap to continue.
 */

import * as React from 'react';
import { MoreVertical, MessageSquarePlus, Trash2 } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/misc';
import { formatRelativeTime } from '@/lib/utils.js';
import { cn } from '@/lib/utils.js';
import { vibrate } from '@/lib/haptics';
import { confirmAction } from '@/components/ui/confirm.js';

/** Flatten a message into a one-line snippet (drop markup and macros). */
function snippetOf(text: string): string {
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, '')
    .replace(/[#*`>[\]()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
}

export function ChatsPage({ onOpenChat, onOpenCards }: { onOpenChat: (id: string) => void; onOpenCards: () => void }) {
  const chats = useApp((s) => s.chats);
  const cards = useApp((s) => s.cards);
  const removeChat = useApp((s) => s.removeChat);
  const setActiveChat = useApp((s) => s.setActiveChat);

  const sorted = React.useMemo(() => [...chats].sort((a, b) => b.updatedAt - a.updatedAt), [chats]);

  const open = (id: string) => {
    setActiveChat(id);
    onOpenChat(id);
  };

  return (
    <div className="rp-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-3 pb-4 pt-3 sm:px-5">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="text-[15px] font-semibold">全部聊天</h2>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="新建对话"
            title="从角色卡开始新对话"
            onClick={onOpenCards}
          >
            <MessageSquarePlus className="size-4" aria-hidden="true" />
          </Button>
        </div>

        {sorted.length === 0 ? (
          <EmptyState
            icon={<MessageSquarePlus className="size-6" aria-hidden="true" />}
            title="还没有对话"
            description="从角色卡里选一个角色，开始第一段故事。"
            action={
              <Button size="sm" onClick={onOpenCards}>
                去角色卡页面
              </Button>
            }
          />
        ) : (
          <ul className="space-y-1">
            {sorted.map((chat) => {
              const card = cards.find((c) => c.id === chat.cardId);
              const last = chat.messages.at(-1);
              const name = card?.data.name || chat.title || '未命名';
              const active = chat.id === useApp.getState().activeChatId;
              return (
                <li key={chat.id}>
                  <div
                    className={cn(
                      'group flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors',
                      active ? 'bg-[var(--rp-accent-soft)]' : 'hover:bg-[var(--rp-bg-sunken)]',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        vibrate('tap');
                        open(chat.id);
                      }}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left"
                      aria-label={`打开与 ${name} 的对话`}
                    >
                      <span className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[14px] font-semibold text-[var(--rp-fg-muted)]">
                        {card?.avatar ? (
                          <img src={card.avatar} alt="" className="size-full object-cover" />
                        ) : (
                          name.slice(0, 1)
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={cn(
                            'block truncate text-[13.5px] font-semibold',
                            active ? 'text-[var(--rp-accent)]' : 'text-[var(--rp-fg)]',
                          )}
                        >
                          {name}
                        </span>
                        <span className="mt-0.5 block truncate text-[11.5px] text-[var(--rp-fg-muted)]">
                          {last ? snippetOf(last.content) || '…' : '（空对话）'}
                        </span>
                      </span>
                      <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--rp-fg-subtle)]">
                        {formatRelativeTime(chat.updatedAt)}
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${name} 的对话选项`}
                          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-[var(--rp-fg-subtle)] transition hover:bg-[var(--rp-bg-elevated)] hover:text-[var(--rp-fg)]"
                        >
                          <MoreVertical className="size-4" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => open(chat.id)}>
                          继续对话
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          destructive
                          onSelect={async () => {
                            if (await confirmAction({ title: '确认操作', description: `删除与「${name}」的对话？此操作不可恢复。` })) {
                              void removeChat(chat.id);
                            }
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" /> 删除对话
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
