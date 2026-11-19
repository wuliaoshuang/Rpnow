/**
 * Character deck — the RP-Hub `character-deck` stacked-card carousel.
 *
 * One card is focused in the middle, neighbours peek out left/right (up to
 * two each side, wrapping around). Switch with a drag/swipe, the arrow
 * buttons, or the keyboard (←/→ when the deck has focus). Tapping the
 * focused card opens its detail sheet; the middle button starts a chat.
 *
 * The enter button takes its colours from the focused card's avatar
 * (average colour, dark/light text by luminance), like RP-Hub; avatars that
 * fail to load fall back to the theme accent.
 */

import * as React from 'react';
import { ChevronLeft, ChevronRight, Star } from 'lucide-react';
import type { RPCard } from '@/core/types/card.js';
import { Button } from '@/components/ui/button';
import { vibrate } from '@/lib/haptics';

import { wrapIndex, deckVisibleOffsets } from './deck.js';

interface DeckColors {
  bg: string;
  text: string;
}

/** Average colour of an image, with a readable text colour for it. */
function sampleAvatarColors(src: string): Promise<DeckColors | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, size, size);
        const data = ctx.getImageData(0, 0, size, size).data;
        let r = 0;
        let g = 0;
        let b = 0;
        let w = 0;
        for (let i = 0; i < data.length; i += 4) {
          const a = data[i + 3] / 255;
          if (!a) continue;
          r += data[i] * a;
          g += data[i + 1] * a;
          b += data[i + 2] * a;
          w += a;
        }
        if (!w) return resolve(null);
        const rgb = [r / w, g / w, b / w].map((v) => Math.round(v));
        const linear = rgb.map((v) => {
          const s = v / 255;
          return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        });
        const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
        resolve({ bg: `rgb(${rgb.join(',')})`, text: luminance > 0.45 ? '#000' : '#fff' });
      } catch {
        // Cross-origin avatar or canvas failure: keep the theme accent.
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

export interface CharacterDeckProps {
  cards: RPCard[];
  /** Open the focused card's detail sheet (same as tapping a grid tile). */
  onOpen: (card: RPCard) => void;
  /** Start a chat with the focused card. */
  onStartChat: (card: RPCard) => void;
}

export function CharacterDeck({ cards, onOpen, onStartChat }: CharacterDeckProps) {
  const [focusedId, setFocusedId] = React.useState<string | null>(cards[0]?.id ?? null);
  const [dragOffset, setDragOffset] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const [buttonColors, setButtonColors] = React.useState<DeckColors | null>(null);
  const stageRef = React.useRef<HTMLDivElement>(null);
  const gesture = React.useRef<{
    id: number;
    x: number;
    y: number;
    time: number;
    step: number;
  } | null>(null);
  const suppressClickUntil = React.useRef(0);
  const reduceMotion = React.useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )[0];

  const count = cards.length;
  // Follow the same card when the list changes (search / delete); fall back
  // to the first card when the focused one is gone.
  React.useEffect(() => {
    if (count === 0) {
      setFocusedId(null);
      return;
    }
    if (!focusedId || !cards.some((c) => c.id === focusedId)) setFocusedId(cards[0].id);
  }, [cards, count, focusedId]);

  const focusedIndex = Math.max(
    0,
    cards.findIndex((c) => c.id === focusedId),
  );
  const focused = cards[focusedIndex] ?? null;

  // Enter-button colours follow the focused card's avatar.
  React.useEffect(() => {
    const src = focused?.avatar;
    if (!src) {
      setButtonColors(null);
      return;
    }
    let alive = true;
    void sampleAvatarColors(src).then((colors) => {
      if (alive) setButtonColors(colors);
    });
    return () => {
      alive = false;
    };
  }, [focused?.avatar]);

  const move = React.useCallback(
    (direction: 1 | -1) => {
      if (count < 2) return;
      vibrate('tap');
      setFocusedId(cards[wrapIndex(count, focusedIndex + direction)].id);
    },
    [count, cards, focusedIndex],
  );

  const focusCard = React.useCallback(
    (id: string) => {
      if (id === focusedId) return;
      vibrate('tap');
      setFocusedId(id);
    },
    [focusedId],
  );

  const onKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select')) return;
      e.preventDefault();
      move(e.key === 'ArrowLeft' ? -1 : 1);
    },
    [move],
  );

  const resetDrag = React.useCallback(() => {
    const state = gesture.current;
    gesture.current = null;
    setDragOffset(0);
    setDragging(false);
    if (state && stageRef.current?.hasPointerCapture(state.id)) {
      stageRef.current.releasePointerCapture(state.id);
    }
  }, []);

  const beginDrag = (e: React.PointerEvent) => {
    if (gesture.current || count < 2 || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Nav buttons live outside the stage; a peek button is a valid drag
    // surface (tap on it still focuses that card).
    if ((e.target as HTMLElement).closest('button:not(.deck-peek)')) return;
    const stage = e.currentTarget;
    const cardWidth =
      stage.querySelector('[data-deck-item]')?.clientWidth || stage.clientWidth;
    gesture.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      time: e.timeStamp,
      step: Math.max(1, cardWidth * 0.5),
    };
    if (!(e.target as HTMLElement).closest('button')) stage.setPointerCapture(e.pointerId);
  };

  const updateDrag = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 4) return;
      // Mostly vertical: let the page scroll instead of hijacking the swipe.
      if (Math.abs(dy) > Math.abs(dx) * 1.25 && Math.abs(dy) > 8) {
        resetDrag();
        return;
      }
      if (Math.abs(dx) < 4 || Math.abs(dx) < Math.abs(dy)) return;
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDragOffset(Math.max(-1, Math.min(1, dx / g.step)));
    e.preventDefault();
  };

  const endDrag = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    if (e.type === 'pointerup') updateDrag(e);
    if (!gesture.current) return;
    const wasDragging = dragging;
    const distance = e.clientX - g.x;
    const threshold = Math.max(20, Math.min(40, g.step * 0.25));
    const quickSwipe =
      Math.abs(distance) >= 12 &&
      Math.abs(distance) / Math.max(1, e.timeStamp - g.time) >= 0.4;
    resetDrag();
    if (e.type === 'pointerup' && wasDragging) {
      suppressClickUntil.current = performance.now() + 250;
      if (Math.abs(distance) >= threshold || quickSwipe) {
        move(distance < 0 ? 1 : -1);
      }
    }
  };

  const guardClick = (e: React.MouseEvent) => {
    if (performance.now() < suppressClickUntil.current) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  if (!focused || count === 0) return null;

  const offsets = deckVisibleOffsets(count, dragOffset);
  const transition = dragging || reduceMotion ? 'none' : 'transform 0.35s cubic-bezier(0.22,0.72,0.18,1), opacity 0.35s';

  return (
    <section
      aria-roledescription="轮播"
      aria-label="角色卡叠卡浏览"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="mx-auto w-full max-w-md select-none outline-none"
    >
      <div
        ref={stageRef}
        className="relative h-[380px] sm:h-[420px]"
        style={{ touchAction: 'pan-y' }}
        onPointerDown={beginDrag}
        onPointerMove={updateDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onClickCapture={guardClick}
        onDragStart={(e) => e.preventDefault()}
      >
        {offsets.map((offset) => {
          const card = cards[wrapIndex(count, focusedIndex + offset)];
          const position = offset + dragOffset;
          const depth = Math.abs(position);
          const isFocused = offset === 0 && depth < 0.5;
          return (
            <article
              key={card.id}
              data-deck-item
              aria-hidden={offset !== 0}
              className="absolute left-1/2 top-0 w-[min(72vw,260px)]"
              style={{
                transform: `translateX(-50%) translateX(${position * 58}%) translateY(${depth * 10}px) scale(${1 - depth * 0.1})`,
                opacity: 1 - depth * 0.28,
                zIndex: 100 - Math.round(depth * 10),
                transition,
                pointerEvents: offset === 0 ? 'auto' : 'none',
              }}
            >
              <div
                role={isFocused ? 'button' : undefined}
                tabIndex={isFocused ? 0 : -1}
                aria-label={isFocused ? `查看 ${card.data.name} 的角色详情` : undefined}
                onClick={() => {
                  if (isFocused) {
                    vibrate('tap');
                    onOpen(card);
                  }
                }}
                onKeyDown={(e) => {
                  if (isFocused && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onOpen(card);
                  }
                }}
                className="relative aspect-[3/4] w-full cursor-pointer overflow-hidden rounded-2xl bg-[var(--rp-bg-sunken)]"
              >
                {card.avatar ? (
                  <img
                    src={card.avatar}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    draggable={false}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-gradient-to-br from-[var(--rp-accent-soft)] to-[var(--rp-bg-sunken)] text-3xl font-semibold text-[var(--rp-accent)]">
                    {card.data.name.slice(0, 1)}
                  </div>
                )}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/75 via-black/35 to-transparent"
                />
                <span className="pointer-events-none absolute bottom-3 left-3 right-3 text-[15px] font-semibold leading-tight text-white drop-shadow">
                  {card.data.name}
                </span>
                {card.favorite && (
                  <Star
                    className="pointer-events-none absolute left-2 top-2 size-4 fill-current text-[var(--rp-warn)] drop-shadow"
                    aria-hidden="true"
                  />
                )}
              </div>
              {offset !== 0 && (
                <button
                  type="button"
                  className="deck-peek absolute inset-0 cursor-pointer"
                  aria-label={`浏览角色：${card.data.name}`}
                  onClick={() => focusCard(card.id)}
                />
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-2 flex items-center justify-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label="上一个角色"
          disabled={count < 2}
          onClick={() => move(-1)}
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Button>
        <Button
          className="min-w-[8rem] rounded-full"
          style={
            buttonColors
              ? { backgroundColor: buttonColors.bg, color: buttonColors.text }
              : undefined
          }
          onClick={() => {
            vibrate('tap');
            onStartChat(focused);
          }}
        >
          开始对话
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label="下一个角色"
          disabled={count < 2}
          onClick={() => move(1)}
        >
          <ChevronRight className="size-5" aria-hidden="true" />
        </Button>
      </div>
      <p className="mt-2 text-center text-[11.5px] text-[var(--rp-fg-subtle)]" aria-live="polite">
        第 {focusedIndex + 1} / {count} 张 · 拖拽、点左右箭头或按 ← → 切换
      </p>
    </section>
  );
}
