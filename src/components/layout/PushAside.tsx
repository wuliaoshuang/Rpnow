/**
 * Push-aside layout — Tavo's side-panel behaviour (reference: push_sidebar_demo).
 *
 * The page is the MOVING layer: opening a panel slides it sideways by exactly
 * the drawer width (no scaling — text keeps its size), rounds the inner edge,
 * casts a soft shadow and takes a very light scrim. The panel itself sits
 * static behind the screen; nothing slides except the page.
 *
 * Geometry (from the reference):
 *   panel width   min(76vw, 310px)
 *   transition    transform/border-radius/box-shadow .48s cubic-bezier(.22,.72,.18,1)
 *   pushed radius 22px on the side facing the panel
 *   scrim         rgba(0,0,0,.10) over the whole page, tap-to-close only on
 *                 the sliver that remains visible beyond the drawer edge
 *
 * Edge swipes: from the left edge → open left panel; from the right edge →
 * open right panel; swipe back towards the edge closes.
 */

import * as React from 'react';
import { cn } from '@/lib/utils.js';

export type PanelSide = 'left' | 'right' | null;

const DURATION_MS = 480;

/**
 * How much of the screen the drawer takes. The page keeps the remaining 25% as
 * a visible sliver, which is the tap-to-close target.
 */
const DRAWER_RATIO = 0.75;
const DRAWER_MAX = 480;

/** Drawer width in px: 75vw, capped so it never looks stretched on tablets. */
function drawerWidth(): number {
  return Math.round(Math.min(window.innerWidth * DRAWER_RATIO, DRAWER_MAX));
}

export function PushAside({
  side,
  left,
  right,
  children,
  onDismiss,
  onRequestOpen,
}: {
  side: PanelSide;
  left: React.ReactNode;
  right: React.ReactNode;
  children: React.ReactNode;
  onDismiss: () => void;
  /** Edge-swipe support: called with the panel the gesture wants to open. */
  onRequestOpen?: (side: 'left' | 'right') => void;
}) {
  const open = side !== null;
  const [drawerW, setDrawerW] = React.useState(() =>
    typeof window === 'undefined' ? 300 : drawerWidth(),
  );
  /**
   * The panel must stay mounted while the page slides back over it — closing is
   * a *cover* animation, not a hide: the page moves right/left to cover the
   * drawer, and only then is the drawer removed. Without this the panel would
   * blink out before the page arrives.
   */
  const [visibleSide, setVisibleSide] = React.useState<PanelSide>(side);
  const hideTimer = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    if (side !== null) {
      setVisibleSide(side);
    } else if (visibleSide !== null) {
      hideTimer.current = window.setTimeout(() => {
        setVisibleSide(null);
        hideTimer.current = null;
      }, DURATION_MS);
    }
    return () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [side, visibleSide]);

  React.useEffect(() => {
    const onResize = () => setDrawerW(drawerWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Esc closes, matching every other sheet in the app.
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onDismiss]);

  // Edge swipes (reference lines 160-168): <28px from the edge and >65px of
  // horizontal travel opens; >65px back towards the edge closes.
  React.useEffect(() => {
    const root = ref.current;
    if (!root) return;
    let sx = 0;
    let sy = 0;
    const onStart = (e: TouchEvent) => {
      sx = e.changedTouches[0].clientX;
      sy = e.changedTouches[0].clientY;
    };
    const onEnd = (e: TouchEvent) => {
      const dx = e.changedTouches[0].clientX - sx;
      const dy = Math.abs(e.changedTouches[0].clientY - sy);
      if (dy > 85) return;
      if (side === null) {
        if (sx < 28 && dx > 65) onRequestOpen?.('left');
        else if (window.innerWidth - sx < 28 && dx < -65) onRequestOpen?.('right');
      } else if (side === 'left' && dx < -65) {
        onDismiss();
      } else if (side === 'right' && dx > 65) {
        onDismiss();
      }
    };
    root.addEventListener('touchstart', onStart, { passive: true });
    root.addEventListener('touchend', onEnd, { passive: true });
    return () => {
      root.removeEventListener('touchstart', onStart);
      root.removeEventListener('touchend', onEnd);
    };
  }, [side, onDismiss, onRequestOpen]);

  const ref = React.useRef<HTMLDivElement>(null);

  // The page slides by exactly the drawer width and keeps full size.
  const offset = side === 'left' ? drawerW : side === 'right' ? -drawerW : 0;
  // Larger sweep reads better next to the drawer (Tavo reference uses ~30px).
  const radius =
    side === 'left' ? '30px 0 0 30px' : side === 'right' ? '0 30px 30px 0' : '0px';


  return (
    <div ref={ref} className="relative flex h-full min-h-0 w-full overflow-hidden isolate">
      {/*
        Both panels are mounted from the first render — so their contents are
        laid out and themed before the user ever taps ☰ (mounting lazily showed
        a frame of bare background on first open).

        ONLY the active panel is painted. Both are `absolute` at 75vw wide, so
        keeping the inactive one painted made the right panel sit on top of the
        left one — the two drawers visually overlapped.

        `invisible` keeps the subtree laid out and styled (no remount cost, no
        background flash) while removing it from paint AND hit-testing.
      */}
      <aside
        role="dialog"
        aria-label="聊天列表"
        aria-hidden={visibleSide !== 'left'}
        className={cn(
          'absolute inset-y-0 left-0 z-0 flex h-full flex-col overflow-hidden bg-[var(--rp-bg-elevated)]',
          visibleSide === 'left' ? 'visible' : 'invisible pointer-events-none',
        )}
        style={{ width: drawerW }}
      >
        {left}
      </aside>
      <aside
        role="dialog"
        aria-label="对话设置"
        aria-hidden={visibleSide !== 'right'}
        className={cn(
          'absolute inset-y-0 right-0 z-0 flex h-full flex-col overflow-hidden bg-[var(--rp-bg-elevated)]',
          visibleSide === 'right' ? 'visible' : 'invisible pointer-events-none',
        )}
        style={{ width: drawerW }}
      >
        {right}
      </aside>

      {/*
        The page — the moving layer, pushed aside when open.

        Perf note: ONLY `transform` is animated. Animating `border-radius` and
        `box-shadow` alongside it forced a repaint of the whole screen on every
        frame, which is what made the slide feel janky on a phone. The corner
        radius now switches instantly (invisible during the slide) and the shadow
        is a separate layer that fades with opacity — both cheap, composited
        properties.
      */}
      <div
        className="absolute inset-0 z-10 overflow-hidden"
        style={{
          transform: `translate3d(${offset}px, 0, 0)`,
          transformOrigin: 'left center',
          borderRadius: radius,
          transitionProperty: 'transform',
          transitionDuration: `${DURATION_MS}ms`,
          transitionTimingFunction: 'cubic-bezier(0.22, 0.72, 0.18, 1)',
          // Promote to its own compositor layer once, up front.
          willChange: 'transform',
          backfaceVisibility: 'hidden',
          // Same paint as the drawer: the sliver of background behind the chat
          // art then matches the panel, so the rounded corner reads as one
          // canvas with the sidebar instead of a mismatched patch.
          background: 'var(--rp-bg-elevated)',
        }}
      >
        {/* NOTE: the page is deliberately NOT inert while a panel is open —
            matching the reference, where the ☰ stays tappable to close and the
            scrim is purely visual. Only the sliver button intercepts taps. */}
        {children}
        {/* Scrim: opacity-only transition (composited, no repaint). */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 transition-opacity"
          style={{
            opacity: open ? 1 : 0,
            background: 'rgba(0,0,0,.10)',
            transitionDuration: `${DURATION_MS}ms`,
            transitionTimingFunction: 'cubic-bezier(0.22, 0.72, 0.18, 1)',
          }}
        />
        {/*
          Inner shadow along the edge facing the drawer: a separate absolutely
          positioned gradient that fades with opacity, instead of an animated
          `box-shadow` (which repaints the whole layer each frame).
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 w-6 transition-opacity"
          style={{
            opacity: open ? 1 : 0,
            [side === 'right' ? 'left' : 'right']: 0,
            background:
              side === 'right'
                ? 'linear-gradient(to right, rgba(0,0,0,.18), transparent)'
                : 'linear-gradient(to left, rgba(0,0,0,.18), transparent)',
            transitionDuration: `${DURATION_MS}ms`,
          }}
        />
      </div>

      {/* Tap-to-close lives ONLY on the sliver visible beyond the drawer edge. */}
      {open && (
        <button
          type="button"
          aria-label="关闭侧栏"
          onClick={onDismiss}
          className="absolute inset-y-0 z-20 cursor-default bg-transparent"
          style={
            side === 'left'
              ? { left: drawerW, right: 0 }
              : { left: 0, right: drawerW }
          }
        />
      )}
    </div>
  );
}
