/**
 * Runtime capability flags shared by the UI.
 *
 * The UI must tell the truth about what the current shell can do: on desktop,
 * providers without CORS work natively, so the "needs proxy" warning would be
 * wrong and would send users hunting for a proxy they do not need.
 */

import { isDesktop } from '@/core/transport/native.js';

/** True when running inside a Tauri shell (desktop *or* mobile). */
function isNativeShell(): boolean {
  return isDesktop();
}

/** Android/iOS Tauri shell, as opposed to the desktop window. */
function isMobileShell(): boolean {
  if (!isNativeShell()) return false;
  return typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export const runtime = {
  /** Running inside a Tauri shell (desktop or mobile). */
  get native(): boolean {
    return isNativeShell();
  },
  /** Running inside the desktop Tauri window. */
  get desktop(): boolean {
    return isNativeShell() && !isMobileShell();
  },
  /** Running inside the mobile Tauri shell. */
  get mobile(): boolean {
    return isMobileShell();
  },
  /** Which packaging target this build is running under. */
  get target(): 'desktop' | 'android' | 'web' {
    if (isMobileShell()) return 'android';
    return isDesktop() ? 'desktop' : 'web';
  },
  /** Short label for the header. */
  get label(): string {
    switch (this.target) {
      case 'desktop':
        return '桌面版（原生网络）';
      case 'android':
        return '安卓版（原生网络）';
      default:
        return '本地优先';
    }
  },
};

/**
 * Whether the current device is primarily touch-driven.
 *
 * Used to decide whether keyboard-centric hints ("Enter to send", "Shift+Enter")
 * make sense. Matches on pointer capability rather than screen width, so a
 * narrow desktop window still shows keyboard help and a tablet shows none.
 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
  const noHover = window.matchMedia?.('(hover: none)')?.matches ?? false;
  return coarse || noHover;
}

/**
 * Whether a provider needs a proxy *right now*.
 *
 * `browserCors === false` means "the API sends no CORS headers"; that only
 * blocks a browser, never the native transport (desktop or Android).
 */
export function providerNeedsProxy(browserCors: boolean): boolean {
  return !browserCors && !isNativeShell();
}
