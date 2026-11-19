import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ANNOUNCEMENT_COUNTDOWN_SECONDS,
  APP_VERSION,
  APP_VERSION_CODE,
  checkForUpdate,
  clearSeenAnnouncementId,
  getIgnoredVersionCode,
  getSeenAnnouncementId,
  setIgnoredVersionCode,
  setSeenAnnouncementId,
  UPDATE_POLL_INTERVAL_MS,
} from './version.js';

describe('version', () => {
  it('current version is 1.0.0 / code 1', () => {
    expect(APP_VERSION).toBe('1.0.0');
    expect(APP_VERSION_CODE).toBe(1);
  });

  it('ignored version round-trips through localStorage', () => {
    // node test env has no localStorage — stub a minimal one.
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    setIgnoredVersionCode(5);
    expect(getIgnoredVersionCode()).toBe(5);
    vi.unstubAllGlobals();
  });

  it('seen announcement id round-trips through localStorage', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    expect(getSeenAnnouncementId()).toBeNull();
    setSeenAnnouncementId(2);
    expect(getSeenAnnouncementId()).toBe(2);
    clearSeenAnnouncementId();
    expect(getSeenAnnouncementId()).toBeNull();
    vi.unstubAllGlobals();
  });

  it('polls every 20s and the announcement countdown is 10s (RP-Hub parity)', () => {
    expect(UPDATE_POLL_INTERVAL_MS).toBe(20_000);
    expect(ANNOUNCEMENT_COUNTDOWN_SECONDS).toBe(10);
  });
});

describe('checkForUpdate', () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
  });

  it('reports an update when the server versionCode is higher', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { version: '1.1.0', versionCode: 2, forceUpdate: false, downloadUrl: 'https://example.com/a.apk', releaseNotes: 'x', publishedAt: '' },
      }),
    });
    const r = await checkForUpdate();
    expect(r?.available).toBe(true);
    expect(r?.forced).toBe(false);
    expect(r?.info?.version).toBe('1.1.0');
  });

  it('marks a forced update', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        ok: true,
        data: { version: '2.0.0', versionCode: 3, forceUpdate: true, downloadUrl: 'https://example.com/a.apk', releaseNotes: '', publishedAt: '' },
      }),
    });
    const r = await checkForUpdate();
    expect(r?.available).toBe(true);
    expect(r?.forced).toBe(true);
  });

  it('reports no update when the server versionCode is not higher', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true, data: { version: '1.0.0', versionCode: 1, forceUpdate: false, downloadUrl: '', releaseNotes: '', publishedAt: '' } }),
    });
    const r = await checkForUpdate();
    expect(r?.available).toBe(false);
    expect(r?.info).toBeNull();
  });

  it('returns null when the request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await checkForUpdate()).toBeNull();
  });
});
