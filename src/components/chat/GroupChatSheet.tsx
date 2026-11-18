/**
 * Group chat builder — opened by the ＋ in the right side panel.
 *
 * Pick any number of character cards as participants, name the room, and start
 * the conversation. The first pick becomes the host (its avatar and background
 * drive the chat chrome), the rest join as the cast; a roster block is injected
 * into every subsequent prompt so the model keeps all voices distinct.
 */

import * as React from 'react';
import { Check, Search, Users, X } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { buildGreetings } from '@/features/chat/orchestrator.js';
import { toast } from '@/components/ui/toast.js';
import { vibrate } from '@/lib/haptics';
import { cn } from '@/lib/utils.js';
import type { RPChat } from '@/core/types/chat.js';
import { uid } from '@/lib/utils.js';

export function GroupChatSheet({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the new chat id so the caller can switch to it. */
  onCreated: (chatId: string) => void;
}) {
  const cards = useApp((s) => s.cards);
  const personas = useApp((s) => s.personas);
  const settings = useApp((s) => s.settings);
  const saveChat = useApp((s) => s.saveChat);
  const setActiveChat = useApp((s) => s.setActiveChat);

  const [query, setQuery] = React.useState('');
  const [picked, setPicked] = React.useState<string[]>([]);
  const [title, setTitle] = React.useState('');
  /**
   * Whose greeting opens the room. Declared with the other hooks — before the
   * `if (!open)` early return — or React sees a changing hook order once the
   * sheet opens.
   */
  const [openingCardId, setOpeningCardId] = React.useState<string>('');

  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setPicked([]);
    setTitle('');
    setOpeningCardId('');
  }, [open]);

  // Keep the opener valid as the cast changes: it must be one of the picks.
  React.useEffect(() => {
    if (!open) return;
    if (!picked.includes(openingCardId)) setOpeningCardId(picked[0] ?? '');
  }, [open, picked, openingCardId]);

  // Esc closes.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = cards.filter((c) =>
    query.trim() ? c.data.name.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );
  const pickedCards = picked.map((id) => cards.find((c) => c.id === id)).filter(Boolean);

  const toggle = (id: string) => {
    vibrate('tap');
    setPicked((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
  };

  const create = () => {
    if (picked.length < 2) {
      toast.error('群聊至少要选两个角色');
      return;
    }
    const host = pickedCards[0]!;
    const opener = pickedCards.find((c) => c!.id === openingCardId) ?? host;
    const names = pickedCards.map((c) => c!.data.name);
    // Group title: names joined by `&` — "阿离 & 白露 & 长风".
    const name = title.trim() || names.join(' & ');
    /*
     * The greeting comes from the chosen opener, and each message is named so
     * the transcript shows who spoke. `speaker` is what MessageBubble renders.
     */
    const greeting = buildGreetings(opener).map((m) => ({
      ...m,
      speaker: m.role === 'assistant' ? opener.data.name : undefined,
    }));
    const chat: RPChat = {
      id: uid('chat'),
      title: name,
      cardId: host.id,
      groupCardIds: picked,
      groupSpeaker: opener.id,
      lorebookIds: [],
      useCardLorebook: true,
      personaId: personas[0]?.id,
      connectionId: settings.defaultConnectionId,
      messages: greeting,
      variables: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    void saveChat(chat);
    setActiveChat(chat.id);
    toast.success(`群聊「${name}」已创建`, `${picked.length} 位角色`);
    onCreated(chat.id);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--rp-bg)]" role="dialog" aria-label="组建群聊">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--rp-border)] px-3 py-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]">
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full text-[var(--rp-fg-muted)] hover:text-[var(--rp-fg)]"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
        <p className="flex-1 text-[14px] font-semibold">组建群聊</p>
        <span className="text-[11.5px] text-[var(--rp-fg-subtle)]">已选 {picked.length}</span>
        <button
          type="button"
          onClick={create}
          disabled={picked.length < 2}
          className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--rp-accent)] px-4 text-[12.5px] font-medium text-[var(--rp-accent-fg)] disabled:opacity-40"
        >
          <Users className="size-4" aria-hidden="true" /> 创建
        </button>
      </div>

      <div className="shrink-0 space-y-2 border-b border-[var(--rp-border)] px-3 py-2.5">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="群聊名称（可选）"
          aria-label="群聊名称"
          className="h-9 w-full rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] px-3 text-[13px] outline-none focus:border-[var(--rp-accent)]"
        />
        <div className="flex items-center gap-2 rounded-lg border border-[var(--rp-border)] px-2.5">
          <Search className="size-3.5 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索角色卡"
            aria-label="搜索角色卡"
            className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none"
          />
        </div>
      </div>

      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <p className="px-3 py-8 text-center text-[12.5px] text-[var(--rp-fg-subtle)]">
            没有匹配的角色卡。
          </p>
        ) : (
          filtered.map((card) => {
            const on = picked.includes(card.id);
            const order = picked.indexOf(card.id);
            return (
              <button
                key={card.id}
                type="button"
                onClick={() => toggle(card.id)}
                aria-pressed={on}
                className={cn(
                  'mb-1 flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors',
                  on ? 'bg-[var(--rp-accent-soft)]' : 'hover:bg-[var(--rp-bg-sunken)]',
                )}
              >
                <span className="relative flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[13px] font-semibold text-[var(--rp-fg-muted)]">
                  {card.avatar ? (
                    <img src={card.avatar} alt="" className="size-full object-cover" />
                  ) : (
                    card.data.name.slice(0, 1)
                  )}
                  {on && (
                    <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-[var(--rp-accent)] text-[9px] font-bold text-[var(--rp-accent-fg)]">
                      {order + 1}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold">{card.data.name}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-[var(--rp-fg-muted)]">
                    {(card.data.description || '（没有描述）').replace(/\s+/g, ' ').slice(0, 46)}
                  </span>
                </span>
                {order === 0 && on && (
                  <span className="shrink-0 rounded bg-[var(--rp-accent)]/15 px-1.5 py-0.5 text-[10px] font-medium text-[var(--rp-accent)]">
                    主持
                  </span>
                )}
                {on ? (
                  <Check className="size-4 shrink-0 text-[var(--rp-accent)]" aria-hidden="true" />
                ) : (
                  <span className="size-4 shrink-0" aria-hidden="true" />
                )}
              </button>
            );
          })
        )}
      </div>

      {/* Opening-greeting picker: the user must choose whose greeting opens
          the room, since every picked character ships its own. */}
      {pickedCards.length > 0 && (
        <div className="shrink-0 border-t border-[var(--rp-border)] px-3 py-2">
          <p className="mb-1.5 text-[11.5px] font-medium text-[var(--rp-fg-muted)]">选择开场白</p>
          <div className="rp-scroll flex gap-2 overflow-x-auto pb-1">
            {pickedCards.map((c) => {
              const on = c!.id === openingCardId;
              return (
                <button
                  key={c!.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={`用 ${c!.data.name} 的开场白`}
                  onClick={() => {
                    vibrate('tap');
                    setOpeningCardId(c!.id);
                  }}
                  className={cn(
                    'flex w-[9.5rem] shrink-0 cursor-pointer flex-col gap-1 rounded-xl border p-2 text-left transition-colors',
                    on
                      ? 'border-[var(--rp-accent)] bg-[var(--rp-accent-soft)]'
                      : 'border-[var(--rp-border)] hover:bg-[var(--rp-bg-sunken)]',
                  )}
                >
                  <span className="truncate text-[11.5px] font-semibold text-[var(--rp-fg)]">
                    {c!.data.name}
                  </span>
                  <span className="line-clamp-2 text-[10.5px] leading-snug text-[var(--rp-fg-muted)]">
                    {(c!.data.first_mes || '（没有开场白）').replace(/\{\{[^}]*\}\}/g, c!.data.name).slice(0, 40)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <p className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] pt-1 text-[11px] text-[var(--rp-fg-subtle)]">
        第 1 个选中的角色作为主持（决定头像与背景），其余为同场角色。
      </p>
    </div>
  );
}
