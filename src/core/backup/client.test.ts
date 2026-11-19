import { describe, expect, it } from 'vitest';
import {
  BACKUP_KEY_LENGTH,
  checkBlobs,
  downloadBackup,
  getBlob,
  gzipBytes,
  gunzipBytes,
  isValidKey,
  makeBlob,
  normalizeKey,
  putBlob,
  uploadBackup,
  type BackupBlob,
} from './client.js';

describe('key handling', () => {
  it('normalises case, punctuation and lookalikes', () => {
    expect(normalizeKey('ab-o_1')).toBe('AB01');
    expect(normalizeKey('OIL0')).toBe('0110');
    expect(normalizeKey('abcd-efgh-ijkl-mnop')).toHaveLength(BACKUP_KEY_LENGTH);
  });

  it('validates length after normalisation', () => {
    expect(isValidKey('ABCD-EFGH-IJKL-MNOP')).toBe(true);
    expect(isValidKey('short')).toBe(false);
  });
});

describe('blob encoding', () => {
  it('content-addresses a value', async () => {
    const a = await makeBlob({ x: 1 });
    const b = await makeBlob({ x: 1 });
    expect(a.hash).toBe(b.hash);
    expect(a.bytes).toEqual(b.bytes);
  });

  it('changes the hash when the value changes', async () => {
    const a = await makeBlob({ x: 1 });
    const b = await makeBlob({ x: 2 });
    expect(a.hash).not.toBe(b.hash);
  });

  it('round-trips gzip', async () => {
    const raw = new TextEncoder().encode('雨镇'.repeat(200));
    const gz = await gzipBytes(raw);
    expect(gz.length).toBeLessThan(raw.length);
    const back = await gunzipBytes(gz);
    expect(back).toEqual(raw);
  });
});

describe('server round-trip', () => {
  function makeHarness(hashes: string[]) {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const stored = new Map<string, Uint8Array>();
    // Pre-seed the server with the hashes it is expected to already have.
    for (const hash of hashes) stored.set(hash, new Uint8Array([1]));
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      const method = init?.method ?? 'GET';
      calls.push({ url: u, method, body: init?.body });
      if (u.includes('/v1/backup/check')) {
        const body = JSON.parse(String(init?.body)) as { hashes: string[] };
        return new Response(JSON.stringify({ missing: body.hashes.filter((h) => !stored.has(h)) }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('/v1/backup/blobs/') && method === 'PUT') {
        stored.set(u.split('/').pop()!, new Uint8Array(init?.body as ArrayBufferLike));
        return new Response('ok', { status: 200 });
      }
      if (u.includes('/v1/backup/blobs/') && method === 'GET') {
        const hash = u.split('/').pop()!;
        if (!stored.has(hash)) return new Response('nope', { status: 404 });
        return new Response(stored.get(hash)! as BlobPart, { status: 200 });
      }
      if (u.endsWith('/v1/backup') && method === 'POST') {
        return new Response(JSON.stringify({ key: 'ABCD-EFGH-IJKL-MNOP' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('/v1/backup/ABCDEFGH1JK1MN0P')) {
        return new Response(
          JSON.stringify({
            type: 'rpnow-backup',
            version: 1,
            createdAt: new Date().toISOString(),
            characters: [{ id: 'c1', name: '卡', hash: 'h1' }],
            scopes: [],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;
    return { fakeFetch, calls, stored };
  }

  it('checks which blobs are missing', async () => {
    const { fakeFetch } = makeHarness([]);
    const missing = await checkBlobs('https://x', ['a', 'b'], fakeFetch);
    expect(missing).toEqual(['a', 'b']);
  });

  it('uploads a blob gzipped', async () => {
    const { fakeFetch, stored } = makeHarness([]);
    const blob = await makeBlob({ hello: 'world' });
    await putBlob('https://x', blob, fakeFetch);
    expect(stored.has(blob.hash)).toBe(true);
  });

  it('skips blobs the server already has', async () => {
    const { fakeFetch, calls } = makeHarness(['existing']);
    const blob: BackupBlob = { hash: 'existing', bytes: new TextEncoder().encode('{}') };
    const newBlob = await makeBlob({ fresh: true });
    await uploadBackup({
      baseURL: 'https://x',
      blobs: [blob, newBlob],
      manifest: { type: 'rpnow-backup', version: 1, createdAt: '', characters: [], scopes: [] },
      fetchImpl: fakeFetch,
    });
    const puts = calls.filter((c) => c.method === 'PUT');
    // Only the fresh blob plus the manifest blob are uploaded.
    expect(puts).toHaveLength(2);
    expect(puts[0].url).toContain(newBlob.hash);
  });

  it('returns a normalised key', async () => {
    const { fakeFetch } = makeHarness([]);
    const key = await uploadBackup({
      baseURL: 'https://x',
      blobs: [await makeBlob({ a: 1 })],
      manifest: { type: 'rpnow-backup', version: 1, createdAt: '', characters: [], scopes: [] },
      fetchImpl: fakeFetch,
    });
    expect(key).toBe('ABCDEFGH1JK1MN0P');
  });

  it('O10: reports check/upload/publish stages through onProgress', async () => {
    const { fakeFetch } = makeHarness([]);
    const stages: string[] = [];
    await uploadBackup({
      baseURL: 'https://x',
      blobs: [await makeBlob({ a: 1 })],
      manifest: { type: 'rpnow-backup', version: 1, createdAt: '', characters: [], scopes: [] },
      fetchImpl: fakeFetch,
      onProgress: (_done, _total, stage) => stages.push(stage),
    });
    expect(stages).toContain('check');
    expect(stages).toContain('upload');
    expect(stages).toContain('publish');
    expect(stages[stages.length - 1]).toBe('done');
  });

  it('downloads and decodes a blob', async () => {
    const { fakeFetch, stored } = makeHarness([]);
    const value = { 名字: '阿尔' };
    const blob = await makeBlob(value);
    stored.set(blob.hash, await gzipBytes(blob.bytes));
    expect(await getBlob('https://x', blob.hash, fakeFetch)).toEqual(value);
  });

  it('fetches a manifest by key', async () => {
    const { fakeFetch } = makeHarness([]);
    const manifest = await downloadBackup('https://x', 'ABCD-EFGH-IJKL-MNOP', fakeFetch);
    expect(manifest.type).toBe('rpnow-backup');
    expect(manifest.characters).toHaveLength(1);
  });

  it('rejects a backup over the size limit', async () => {
    const { fakeFetch } = makeHarness([]);
    const huge = { hash: 'h', bytes: new Uint8Array(1024 * 1024 * 1024 + 1) };
    await expect(
      uploadBackup({
        baseURL: 'https://x',
        blobs: [huge],
        manifest: { type: 'rpnow-backup', version: 1, createdAt: '', characters: [], scopes: [] },
        fetchImpl: fakeFetch,
      }),
    ).rejects.toThrow('1GB');
  });
});
