/**
 * Smart-edit diff review (P07): word-level diff rendering + first_mes preview.
 *
 * One `ChangeDiffView` per change: the label with `+added/−removed` counts,
 * the body as LCS word diff (`<del>` removed, `<ins>` added, `……` for folded
 * unchanged context), and — only for the 开场白 (`first_mes`) change — a
 * 预览 toggle that shows the new first message as it would appear as the
 * first chat message (修改前 / 修改后 switchable).
 */

import * as React from 'react';
import { Eye } from 'lucide-react';
import type { Change } from '@/core/cardai/diff.js';
import { wordDiff } from '@/core/cardai/wordDiff.js';

function DiffCounts({ original, modified }: { original: string; modified: string }) {
  const { added, removed } = React.useMemo(() => wordDiff(original, modified), [original, modified]);
  if (!added && !removed) return null;
  return (
    <span className="shrink-0 text-[11px] font-medium tabular-nums">
      {added > 0 && <span className="text-[var(--rp-ok)]">+{added}</span>}
      {added > 0 && removed > 0 && <span className="text-[var(--rp-fg-subtle)]"> / </span>}
      {removed > 0 && <span className="text-[var(--rp-danger)]">−{removed}</span>}
    </span>
  );
}

function DiffBody({ change }: { change: Change }) {
  const { parts } = React.useMemo(
    () => wordDiff(change.original, change.modified),
    [change.original, change.modified],
  );
  return (
    <div
      className={
        'mt-0.5 break-words whitespace-pre-wrap text-[12px] leading-relaxed ' +
        (change.kind === 'regex' ? 'font-mono text-[11px]' : '')
      }
    >
      {parts.map((part, i) => {
        if (part.type === 'del') {
          return (
            <del key={i} className="text-[var(--rp-danger)] decoration-[var(--rp-danger)]">
              {part.text}
            </del>
          );
        }
        if (part.type === 'add') {
          return (
            <ins key={i} className="text-[var(--rp-ok)] no-underline">
              {part.text}
            </ins>
          );
        }
        if (part.type === 'gap') {
          return (
            <span key={i} className="text-[var(--rp-fg-subtle)]">
              {part.text}
            </span>
          );
        }
        return <span key={i}>{part.text}</span>;
      })}
    </div>
  );
}

/** Preview of the new first message as the opening chat bubble. */
function FirstMesPreview({
  cardName,
  avatar,
  original,
  modified,
}: {
  cardName: string;
  avatar?: string;
  original: string;
  modified: string;
}) {
  const [view, setView] = React.useState<'modified' | 'original'>('modified');
  const text = view === 'modified' ? modified : original;
  return (
    <div className="mt-2 rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] p-2">
      <div className="mb-1.5 flex items-center gap-1">
        <span className="text-[11px] text-[var(--rp-fg-subtle)]">第一条消息预览</span>
        <span className="ml-auto flex overflow-hidden rounded-full border border-[var(--rp-border)] text-[11px]">
          <button
            type="button"
            onClick={() => setView('modified')}
            className={
              'cursor-pointer px-2 py-0.5 ' +
              (view === 'modified'
                ? 'bg-[var(--rp-accent)] text-[var(--rp-accent-fg)]'
                : 'text-[var(--rp-fg-subtle)]')
            }
          >
            修改后
          </button>
          <button
            type="button"
            onClick={() => setView('original')}
            className={
              'cursor-pointer px-2 py-0.5 ' +
              (view === 'original'
                ? 'bg-[var(--rp-accent)] text-[var(--rp-accent-fg)]'
                : 'text-[var(--rp-fg-subtle)]')
            }
          >
            修改前
          </button>
        </span>
      </div>
      <div className="flex items-start gap-2">
        {avatar ? (
          <img src={avatar} alt="" className="size-7 shrink-0 rounded-full object-cover" />
        ) : (
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--rp-accent)] text-[12px] font-semibold text-[var(--rp-accent-fg)]">
            {(cardName || '？').slice(0, 1)}
          </span>
        )}
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-[var(--rp-fg-muted)]">{cardName || '未命名'}</p>
          <p className="mt-0.5 break-words whitespace-pre-wrap text-[12.5px] leading-relaxed">
            {text || '（空）'}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ChangeDiffView({
  change,
  cardName,
  avatar,
}: {
  change: Change;
  cardName: string;
  avatar?: string;
}) {
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const isFirstMes = change.field === 'first_mes';
  return (
    <li className="rounded-lg border border-[var(--rp-border)] p-2 text-[11.5px]">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 font-medium">{change.label}</p>
        <DiffCounts original={change.original} modified={change.modified} />
        {isFirstMes && (
          <button
            type="button"
            onClick={() => setPreviewOpen((v) => !v)}
            aria-expanded={previewOpen}
            className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] text-[var(--rp-accent)] hover:bg-[var(--rp-bg-sunken)]"
          >
            <Eye className="size-3" aria-hidden="true" />
            预览
          </button>
        )}
      </div>
      <DiffBody change={change} />
      {isFirstMes && previewOpen && (
        <FirstMesPreview
          cardName={cardName}
          avatar={avatar}
          original={change.original}
          modified={change.modified}
        />
      )}
    </li>
  );
}
