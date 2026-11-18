/**
 * Group chat identity: title + avatar.
 *
 * A group is named `A & B & C` and its avatar is the members' portraits laid out
 * **diagonally** (top-left → bottom-right), so a two-person room reads as a pair
 * and larger rooms still resolve to "several people" at a glance.
 */

import { cn } from '@/lib/utils.js';
import type { RPCard } from '@/core/types/card.js';

/** `["阿离","白露"] → "阿离 & 白露"`. */
export function groupTitle(names: string[]): string {
  return names.filter(Boolean).join(' & ');
}

/**
 * Diagonal composite avatar.
 *
 * `size` is the outer diameter in px. Members are placed corner-to-corner; with
 * more than four we keep the first four (the rest still contribute to the name).
 */
export function GroupAvatar({
  cards,
  size = 44,
  className,
}: {
  cards: RPCard[];
  size?: number;
  className?: string;
}) {
  const shown = cards.slice(0, 4);
  if (!shown.length) return null;

  // 1 member → single round portrait (no diagonal needed).
  if (shown.length === 1) {
    const c = shown[0]!;
    return (
      <span
        className={cn('flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)]', className)}
        style={{ width: size, height: size }}
      >
        {c.avatar ? (
          <img src={c.avatar} alt="" className="size-full object-cover" />
        ) : (
          <span className="text-[13px] font-semibold text-[var(--rp-fg-muted)]">{c.data.name.slice(0, 1)}</span>
        )}
      </span>
    );
  }

  /*
   * Two-plus members: each tile is a circle, positioned on a diagonal inside a
   * shared square. `gap` keeps them from overlapping the container edge.
   */
  const inset = Math.max(0, Math.round(size * 0.06));
  const inner = size - inset * 2;
  const tile = Math.round(inner * 0.62);
  const positions = [
    { left: inset, top: inset },
    { left: size - inset - tile, top: size - inset - tile },
    { left: size - inset - tile, top: inset },
    { left: inset, top: size - inset - tile },
  ];

  return (
    <span
      className={cn('relative shrink-0 overflow-hidden rounded-full bg-[var(--rp-bg-sunken)]', className)}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {shown.map((c, i) => (
        <span
          key={c.id}
          className="absolute flex items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-elevated)] ring-2 ring-[var(--rp-bg-elevated)]"
          style={{ ...positions[i], width: tile, height: tile }}
        >
          {c.avatar ? (
            <img src={c.avatar} alt="" className="size-full object-cover" />
          ) : (
            <span className="text-[10px] font-semibold text-[var(--rp-fg-muted)]">{c.data.name.slice(0, 1)}</span>
          )}
        </span>
      ))}
    </span>
  );
}
