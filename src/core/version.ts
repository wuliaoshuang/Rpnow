/**
 * App version + update check.
 *
 * Release rule (bump together on every release):
 *   - APP_VERSION: the display version, e.g. "1.1.0" (keep package.json in sync).
 *   - APP_VERSION_CODE: an integer that only ever increases (1, 2, 3, ...).
 * The server publishes a version manifest at GET /api/v1/version. When the
 * manifest's versionCode is greater than APP_VERSION_CODE, an update is
 * available. `forceUpdate` in the manifest decides whether the user may
 * dismiss the popup.
 */

import { marketBase } from './marketplace/client.js';

export const APP_VERSION = '1.0.0';
export const APP_VERSION_CODE = 1;

export interface VersionInfo {
  version: string;
  versionCode: number;
  /** True = the user cannot dismiss the update popup. */
  forceUpdate: boolean;
  /** Where to download the new package (APK). Empty = no download link. */
  downloadUrl: string;
  /** Changelog shown in the popup / About page. */
  releaseNotes: string;
  publishedAt: string;
}

export interface UpdateCheckResult {
  available: boolean;
  forced: boolean;
  info: VersionInfo | null;
}

const IGNORED_KEY = 'rpnow:ignored-update-version';

/** The versionCode the user chose to ignore (non-forced updates only). */
export function getIgnoredVersionCode(): number | null {
  try {
    const v = localStorage.getItem(IGNORED_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function setIgnoredVersionCode(code: number): void {
  try {
    localStorage.setItem(IGNORED_KEY, String(code));
  } catch {
    /* ignore */
  }
}

export function clearIgnoredVersionCode(): void {
  try {
    localStorage.removeItem(IGNORED_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Ask the server for the latest published version.
 * Returns null when the check itself fails (offline / server down) — the
 * caller treats that as "no update" and never shows an error for it.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult | null> {
  let body: unknown;
  try {
    const res = await fetch(`${marketBase()}/api/v1/version`, { method: 'GET' });
    if (!res.ok) return null;
    body = (await res.json()) as unknown;
  } catch {
    return null;
  }
  // The backend wraps every response in { data, ok }; accept a bare body too.
  const info =
    body !== null && typeof body === 'object' && 'data' in (body as Record<string, unknown>)
      ? (body as { data: VersionInfo }).data
      : (body as VersionInfo);
  if (!info || typeof info.versionCode !== 'number') return null;
  const available = info.versionCode > APP_VERSION_CODE;
  return { available, forced: available && info.forceUpdate === true, info: available ? info : null };
}
