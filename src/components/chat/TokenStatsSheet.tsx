/**
 * Token usage stats for the current character.
 *
 * Opened from the right side panel's 「统计」 button. Tavo shows a per-character
 * consumption breakdown; the numbers here come from the real message records —
 * every assistant reply stores its `usage` — so the totals are what the provider
 * actually reported, not an estimate.
 */

import * as React from 'react';
import { X } from 'lucide-react';
import type { RPCard } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';
import { cn } from '@/lib/utils.js';

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TokenStatsSheet({
  open,
  onClose,
  card,
  chats,
}: {
  open: boolean;
  onClose: () => void;
  card?: RPCard;
  /** All chats; we aggregate those belonging to this card. */
  chats: RPChat[];
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const own = card ? chats.filter((c) => c.cardId === card.id || (c.groupCardIds ?? []).includes(card.id)) : [];
  let input = 0;
  let output = 0;
  let turns = 0;
  const perChat: Array<{ title: string; input: number; output: number; turns: number }> = [];
  for (const chat of own) {
    let ci = 0;
    let co = 0;
    let ct = 0;
    for (const m of chat.messages) {
      if (m.role !== 'assistant' || !m.usage) continue;
      ci += m.usage.inputTokens ?? 0;
      co += m.usage.outputTokens ?? 0;
      ct += 1;
    }
    if (ct) perChat.push({ title: chat.title || '未命名', input: ci, output: co, turns: ct });
    input += ci;
    output += co;
    turns += ct;
  }
  perChat.sort((a, b) => b.input + b.output - (a.input + a.output));

  const rows: Array<{ label: string; value: string }> = [
    { label: '输入 token', value: input ? fmt(input) : '—' },
    { label: '输出 token', value: output ? fmt(output) : '—' },
    { label: '合计', value: input + output ? fmt(input + output) : '—' },
    { label: '统计轮次', value: String(turns) },
    { label: '平均每轮输入', value: turns ? fmt(Math.round(input / turns)) : '—' },
    { label: '平均每轮输出', value: turns ? fmt(Math.round(output / turns)) : '—' },
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center" role="dialog" aria-label="角色 token 统计">
      <button type="button" aria-label="关闭" onClick={onClose} className="absolute inset-0 cursor-default bg-black/50" />
      <div className="rp-anim-pop relative w-full max-w-md rounded-t-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] shadow-rp sm:rounded-2xl">
        <div className="flex items-center gap-2 border-b border-[var(--rp-border)] px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[13px] font-semibold text-[var(--rp-fg-muted)]">
            {card?.avatar ? (
              <img src={card.avatar} alt="" className="size-full object-cover" />
            ) : (
              (card?.data.name ?? '?').slice(0, 1)
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{card?.data.name ?? '未选择角色'}</p>
            <p className="text-[11px] text-[var(--rp-fg-subtle)]">
              {own.length} 个会话 · token 用量统计
            </p>
          </div>
          <button
            type="button"
            aria-label="关闭"
            onClick={onClose}
            className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2 p-3">
          {rows.map((r) => (
            <div key={r.label} className="rounded-xl border border-[var(--rp-border)] px-3 py-2">
              <p className="text-[10.5px] text-[var(--rp-fg-subtle)]">{r.label}</p>
              <p className="mt-0.5 text-[17px] font-semibold tabular-nums">{r.value}</p>
            </div>
          ))}
        </div>

        {perChat.length > 0 && (
          <div className="px-3 pb-1">
            <p className="mb-1.5 px-1 text-[11.5px] font-medium text-[var(--rp-fg-muted)]">按会话</p>
            <div className="rp-scroll max-h-52 space-y-1 overflow-y-auto">
              {perChat.map((c) => (
                <div
                  key={c.title}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border border-[var(--rp-border)] px-2.5 py-1.5',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px]">{c.title}</span>
                  <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--rp-fg-subtle)]">
                    {c.turns} 轮
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-[var(--rp-fg-muted)]">
                    ↑{fmt(c.input)} ↓{fmt(c.output)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {turns === 0 && (
          <p className="px-4 pb-2 pt-1 text-center text-[11.5px] text-[var(--rp-fg-subtle)]">
            还没有可统计的回复。模型返回用量后这里会自动累计。
          </p>
        )}
      </div>
    </div>
  );
}
