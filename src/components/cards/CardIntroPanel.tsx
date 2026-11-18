/**
 * 角色卡详情 sheet（点击卡片时弹出，而不是直接开聊）。
 *
 * Layout mirrors the reference: big portrait bleeding to the rounded top
 * corners, name + tag subtitle over the fade, a summary card, then a full-width
 * primary action. Users can read who they are about to chat with first — and
 * the sheet is the only path into a new chat from the grid.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Pencil, MessageSquarePlus, X } from 'lucide-react';
import type { RPCard } from '@/core/types/card.js';
import { useKernelService } from '@/hooks/useKernel.js';
import { SERVICE } from '@/core/plugin/kernel-types.js';
import type { RendererService } from '@/core/agent/types.js';
import { Button } from '@/components/ui/button.js';

export function CardIntroPanel({
  card,
  onClose,
  onEdit,
  onStartChat,
}: {
  card: RPCard | null;
  onClose: () => void;
  onEdit: (card: RPCard) => void;
  /** 开始新聊天 —— 详情页是进入对话的唯一入口。 */
  onStartChat?: (card: RPCard) => void;
}) {
  const renderer = useKernelService<RendererService>(SERVICE.RENDERER);
  // Hooks must run before the early return, or React sees a changing hook
  // order between renders.
  const html = React.useMemo(() => {
    const source = card?.data.description || '（没有描述）';
    try {
      return renderer?.render(source, { styleScope: '.rp-md' }) ?? escapeHtml(source);
    } catch {
      return escapeHtml(source);
    }
  }, [card?.data.description, renderer]);

  // Esc closes (matching every other sheet in the app).
  React.useEffect(() => {
    if (!card) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [card, onClose]);

  if (!card) return null;

  const words = [card.data.description, card.data.personality, card.data.scenario]
    .filter(Boolean)
    .reduce((sum, s) => sum + [...String(s)].length, 0);
  const tags = (card.data.tags ?? []).filter(Boolean).slice(0, 6);

  return createPortal(
    <div
      role="dialog"
      aria-label={`角色详情：${card.data.name}`}
      className="rp-anim-fade fixed inset-0 z-[60] flex items-end justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="rp-anim-sheet relative flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] shadow-rp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button floats over the art. */}
        <button
          type="button"
          aria-label="关闭"
          onClick={onClose}
          className="absolute right-3 top-[calc(env(safe-area-inset-top,0px)+0.75rem)] z-10 flex size-8 cursor-pointer items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm transition-colors hover:bg-black/65"
        >
          <X className="size-4" aria-hidden="true" />
        </button>

        <div className="rp-scroll min-h-0 flex-1 overflow-y-auto">
          {/* Portrait: full-bleed at the top, melting into the panel.
              Height is capped (48dvh) so the text below — description, stats,
              author notes — fits above the fold instead of being cut off
              behind the action bar; the image crops from the bottom
              (`object-top`) so faces and head details survive. */}
          <div className="relative aspect-[4/5] max-h-[48dvh] w-full overflow-hidden bg-[var(--rp-bg-sunken)]">
            {card.avatar ? (
              <img src={card.avatar} alt="" className="size-full object-cover object-top" />
            ) : (
              <div className="flex size-full items-center justify-center bg-gradient-to-br from-[var(--rp-accent-soft)] to-[var(--rp-bg-sunken)] text-5xl font-semibold text-[var(--rp-accent)]">
                {card.data.name.slice(0, 1)}
              </div>
            )}
            <div
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[var(--rp-bg-elevated)] via-[var(--rp-bg-elevated)]/70 to-transparent"
            />
            <div className="absolute inset-x-0 bottom-0 px-4 pb-3 text-center">
              <h2 className="truncate text-[22px] font-bold leading-tight text-[var(--rp-fg)]">
                {card.data.name}
              </h2>
              {(tags.length > 0 || card.data.character_version) && (
                <p className="mt-0.5 truncate text-[12.5px] text-[var(--rp-fg-muted)]">
                  {tags.length ? `［${tags.join('，')}］` : ''}
                  {card.data.character_version ? ` ${card.data.character_version}` : ''}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-3 px-4 pb-4 pt-3">
            {/* Summary card: description in a sunken rounded block — the
                main text, kept prominent. */}
            <div className="rounded-2xl bg-[var(--rp-bg-sunken)] p-3">
              <div
                className="rp-md text-[13px] leading-relaxed text-[var(--rp-fg)]"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            </div>

            {/* Stats are trivia, not content: quiet text, no pill borders. */}
            <p className="text-[11px] leading-relaxed text-[var(--rp-fg-subtle)]">
              {card.data.character_book?.entries?.length ?? 0} 条世界书 · {words} 字设定
              {(card.data.alternate_greetings?.length ?? 0) > 0
                ? ` · 开场 +${card.data.alternate_greetings!.length}`
                : ''}
              {card.data.creator ? ` · 作者 ${card.data.creator}` : ''}
            </p>

            {card.data.creator_notes ? (
              <div>
                <p className="mb-1 text-[11px] font-semibold text-[var(--rp-fg-subtle)]">作者注释</p>
                <p className="text-[12px] leading-relaxed text-[var(--rp-fg-muted)]">{card.data.creator_notes}</p>
              </div>
            ) : null}
          </div>
        </div>

        {/* Actions pinned to the bottom, clear of the gesture bar. */}
        <div className="flex shrink-0 items-center gap-2 border-t border-[var(--rp-border)] px-4 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.85rem)]">
          <Button variant="outline" size="sm" onClick={() => onEdit(card)} aria-label="编辑角色卡">
            <Pencil className="size-3.5" aria-hidden="true" /> 编辑
          </Button>
          <Button
            className="flex-1"
            onClick={() => onStartChat?.(card)}
            aria-label={`和 ${card.data.name} 开始新聊天`}
          >
            <MessageSquarePlus className="size-4" aria-hidden="true" /> 开始新聊天
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
