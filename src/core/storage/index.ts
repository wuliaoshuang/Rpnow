/**
 * Persistence.
 *
 * Two stores on purpose:
 *   - `localStorage` for small, synchronous state (settings, plugin toggles),
 *     so the first paint can read it without awaiting.
 *   - IndexedDB for collections (cards with avatars, chats, books), because
 *     data URLs blow past localStorage's ~5 MB quota immediately.
 *
 * Everything is behind {@link StorageService} so a desktop/mobile shell can
 * swap in a native file-backed implementation.
 */

import { get as idbGet, set as idbSet, del as idbDel, keys as idbKeys, clear as idbClear } from 'idb-keyval';
import type { StorageService } from '../agent/types.js';

export const idbStorage: StorageService = {
  async get<T>(key: string): Promise<T | undefined> {
    return (await idbGet<T>(key)) ?? undefined;
  },
  async set<T>(key: string, value: T): Promise<void> {
    await idbSet(key, value);
  },
  async remove(key: string): Promise<void> {
    await idbDel(key);
  },
  async keys(prefix?: string): Promise<string[]> {
    const all = (await idbKeys()) as string[];
    return prefix ? all.filter((k) => typeof k === 'string' && k.startsWith(prefix)) : all;
  },
  async clear(): Promise<void> {
    await idbClear();
  },
};

/** Synchronous settings access with change notification. */
export class SettingsStore {
  private cache = new Map<string, unknown>();
  private listeners = new Map<string, Set<(v: unknown) => void>>();
  private prefix = 'rpnow:';

  get<T>(key: string, fallback: T): T {
    if (this.cache.has(key)) return this.cache.get(key) as T;
    try {
      const raw = localStorage.getItem(this.prefix + key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw) as T;
      this.cache.set(key, parsed);
      return parsed;
    } catch {
      return fallback;
    }
  }

  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
    try {
      localStorage.setItem(this.prefix + key, JSON.stringify(value));
    } catch (err) {
      console.warn('[settings] 写入失败（配额可能已满）', err);
    }
    const set = this.listeners.get(key);
    if (set) for (const fn of [...set]) fn(value);
  }

  subscribe(key: string, handler: (value: unknown) => void): () => void {
    const set = this.listeners.get(key) ?? new Set();
    this.listeners.set(key, set);
    set.add(handler);
    return () => set.delete(handler);
  }
}

export const settingsStore = new SettingsStore();

/** Export the whole app state as one portable JSON document. */
export async function exportAll(): Promise<Blob> {
  const keys = await idbStorage.keys('rpnow:');
  const data: Record<string, unknown> = {};
  for (const k of keys) data[k] = await idbStorage.get(k);
  const settings: Record<string, unknown> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)!;
    if (k.startsWith('rpnow:')) {
      try {
        settings[k] = JSON.parse(localStorage.getItem(k)!);
      } catch {
        settings[k] = localStorage.getItem(k);
      }
    }
  }
  const doc = { format: 'rpnow-backup/1', exportedAt: Date.now(), data, settings };
  return new Blob([JSON.stringify(doc)], { type: 'application/json' });
}

/**
 * Restore a backup produced by {@link exportAll}.
 *
 * API keys are included deliberately (a backup that loses credentials is not a
 * backup), so the UI must warn before writing the file.
 */
export async function importAll(blob: Blob): Promise<void> {
  const doc = JSON.parse(await blob.text()) as {
    format?: string;
    data?: Record<string, unknown>;
    settings?: Record<string, unknown>;
  };
  if (doc.format !== 'rpnow-backup/1') throw new Error('不是 RPNow 的备份文件');
  for (const [k, v] of Object.entries(doc.data ?? {})) await idbStorage.set(k, v);
  for (const [k, v] of Object.entries(doc.settings ?? {})) {
    localStorage.setItem(k, JSON.stringify(v));
  }
}
