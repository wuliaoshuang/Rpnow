/**
 * Haptic feedback via the Android vibration motor.
 *
 * `navigator.vibrate` is only present where the platform supports it (Android
 * WebView, Chrome Android). Every call is a no-op elsewhere, so callers never
 * need to guard. The permission is declared in the Android manifest; without
 * it the API silently does nothing, which is why 设置 exposes a test button.
 */

import { useApp } from '@/state/store.js';

export type HapticPattern = 'tap' | 'toggle' | 'send' | 'message' | 'warn' | 'success';

const PATTERNS: Record<HapticPattern, number | number[]> = {
  // Short enough to feel like a click, not a notification.
  tap: 8,
  toggle: 14,
  send: 20,
  message: 12,
  warn: [28, 40, 28],
  success: [10, 30, 10],
};

/** True when the platform exposes the Vibration API at all. */
export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Fire a pattern, honouring the user's 设置 → 触感 switch. */
export function vibrate(pattern: HapticPattern = 'tap'): void {
  if (!hapticsSupported()) return;
  if (!useApp.getState().settings.haptics.enabled) return;
  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    /* some WebViews throw on permission denial — never break the UI over it */
  }
}

/** Run the motor once for the 设置 preview, ignoring the master switch. */
export function vibratePreview(): void {
  if (!hapticsSupported()) return;
  try {
    navigator.vibrate([20, 40, 20]);
  } catch {
    /* ignore */
  }
}

/**
 * Buzz when an AI reply starts arriving.
 *
 * Separate from `vibrate` because it has its own 设置 switch: some users want
 * taps to buzz but not every message.
 */
export function vibrateMessage(): void {
  if (!hapticsSupported()) return;
  const { enabled, onMessage } = useApp.getState().settings.haptics;
  if (!enabled || !onMessage) return;
  try {
    navigator.vibrate(PATTERNS.message);
  } catch {
    /* ignore */
  }
}
