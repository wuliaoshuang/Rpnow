/**
 * useLongPress — press-and-hold (500ms) without moving.
 *
 * Returns pointer handlers to spread on an element plus a `wasLongPress`
 * flag the click handler can check, so a long-press does not also fire the
 * tap action (e.g. opening the viewer right after the menu).
 *
 * Mirrors the bookshelf / card-library long-press (500ms, cancel when the
 * pointer moves more than 10px).
 */
import React from 'react';
import { vibrate } from '@/lib/haptics.js';

const LONG_PRESS_MS = 500;
const MOVE_TOLERANCE_PX = 10;

export function useLongPress(onLongPress: () => void) {
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = React.useRef<{ x: number; y: number } | null>(null);
  const wasLongPress = React.useRef(false);

  const clear = React.useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    start.current = null;
  }, []);

  React.useEffect(() => clear, [clear]);

  const handlers = React.useMemo(
    () => ({
      onPointerDown(e: React.PointerEvent) {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        wasLongPress.current = false;
        clear();
        start.current = { x: e.clientX, y: e.clientY };
        timer.current = setTimeout(() => {
          wasLongPress.current = true;
          vibrate('tap');
          onLongPress();
        }, LONG_PRESS_MS);
      },
      onPointerMove(e: React.PointerEvent) {
        const s = start.current;
        if (!s) return;
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > MOVE_TOLERANCE_PX) clear();
      },
      onPointerUp() {
        clear();
      },
      onPointerCancel() {
        clear();
      },
    }),
    [clear, onLongPress],
  );

  return { handlers, wasLongPress };
}
