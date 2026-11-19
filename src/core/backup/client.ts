/**
 * Cloud backup client.
 *
 * RP-Hub's backup works by content addressing: each card/chat is serialised to
 * JSON, named by the SHA-256 of those exact bytes, gzipped and uploaded. The
 * server only stores blobs; a 16-character key references a manifest. That
 * makes uploads deduplicating and resumable — re-running a backup only sends
 * blobs the server does not already have.
 *
 * Limits carried over from RP-Hub: 1 GB per backup, 15-day key validity, and
 * key normalisation (uppercase, strip non-alphanumerics, O→0, I/L→1).
 */

export const BACKUP_MAX_BYTES = 1024 * 1024 * 1024;
export const BACKUP_KEY_LENGTH = 16;
export const BACKUP_TTL_DAYS = 15;
export const BACKUP_BATCH_SIZE = 1000;

export interface BackupBlob {
  /** SHA-256 hex of the JSON bytes. */
  hash: string;
  bytes: Uint8Array;
}

export interface BackupManifest {
  type: 'rpnow-backup';
  version: 1;
  createdAt: string;
  characters: Array<{ id: string; name: string; hash: string }>;
  /** Chat/branch data keyed by card id. */
  scopes: Array<{ key: string; hash: string }>;
}

/** O10: backup progress stages (RP-Hub shows stage + percent + detail). */
export type BackupProgressStage = 'prepare' | 'check' | 'upload' | 'publish' | 'done';

export const BACKUP_STAGE_LABELS: Record<BackupProgressStage, string> = {
  prepare: '准备中',
  check: '检查已有数据',
  upload: '上传中',
  publish: '发布备份清单',
  done: '完成',
};

/** Restore progress stages, for the panel's restore run. */
export type RestoreProgressStage = 'manifest' | 'cards' | 'chats' | 'done';

export const RESTORE_STAGE_LABELS: Record<RestoreProgressStage, string> = {
  manifest: '下载备份清单',
  cards: '恢复角色卡',
  chats: '恢复对话与记忆',
  done: '完成',
};
export function normalizeKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .slice(0, BACKUP_KEY_LENGTH);
}

export function isValidKey(key: string): boolean {
  return normalizeKey(key).length === BACKUP_KEY_LENGTH;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.subtle) {
    // Non-secure fallback so the logic still runs in odd runtimes.
    let h = 0;
    for (let i = 0; i < bytes.length; i++) h = (Math.imul(31, h) + bytes[i]) | 0;
    return `legacy${h.toString(16)}`;
  }
  const digest = await cryptoObj.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** gzip bytes using the platform stream API. */
export async function gzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/** Build a content-addressed blob from any JSON-serialisable value. */
export async function makeBlob(value: unknown): Promise<BackupBlob> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return { hash: await sha256Hex(bytes), bytes };
}

/** What the server reports as missing. */
export async function checkBlobs(
  baseURL: string,
  hashes: string[],
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const res = await fetchImpl(`${baseURL}/v1/backup/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hashes }),
  });
  if (!res.ok) throw new Error(`check 失败（${res.status}）`);
  const json = (await res.json()) as { missing?: string[] };
  return json.missing ?? [];
}

export async function putBlob(
  baseURL: string,
  blob: BackupBlob,
  fetchImpl: typeof fetch,
): Promise<void> {
  const gz = await gzipBytes(blob.bytes);
  const res = await fetchImpl(`${baseURL}/v1/backup/blobs/${blob.hash}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/gzip' },
    body: gz as BlobPart,
  });
  if (!res.ok) throw new Error(`上传失败（${res.status}）`);
}

export interface UploadParams {
  baseURL: string;
  blobs: BackupBlob[];
  manifest: BackupManifest;
  /** Manifest blob hash, used as the `replaces` hint. */
  fetchImpl?: typeof fetch;
  /**
   * O10: called with bytes done/total plus the current stage
   * (`check` while asking the server what it already has, `upload` while
   * sending missing blobs, `publish` while publishing the manifest).
   */
  onProgress?: (done: number, total: number, stage: BackupProgressStage) => void;
}

/** Upload missing blobs, then publish the manifest. Returns the backup key. */
export async function uploadBackup(params: UploadParams): Promise<string> {
  const { baseURL, blobs, manifest } = params;
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;

  const total = blobs.reduce((sum, b) => sum + b.bytes.length, 0);
  if (total > BACKUP_MAX_BYTES) throw new Error('角色卡和聊天加起来超过 1GB');

  let done = 0;
  for (let i = 0; i < blobs.length; i += BACKUP_BATCH_SIZE) {
    const batch = blobs.slice(i, i + BACKUP_BATCH_SIZE);
    params.onProgress?.(done, total, 'check');
    const missing = new Set(await checkBlobs(baseURL, batch.map((b) => b.hash), fetchImpl));
    for (const blob of batch) {
      if (missing.has(blob.hash)) {
        params.onProgress?.(done, total, 'upload');
        await putBlob(baseURL, blob, fetchImpl);
      }
      done += blob.bytes.length;
      params.onProgress?.(done, total, 'upload');
    }
  }

  params.onProgress?.(done, total, 'publish');
  const manifestBlob = await makeBlob(manifest);
  if (!manifestBlob.hash) throw new Error('清单生成失败');
  await putBlob(baseURL, manifestBlob, fetchImpl);

  const res = await fetchImpl(`${baseURL}/v1/backup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ manifest: manifestBlob.hash, characters: manifest.characters }),
  });
  if (!res.ok) throw new Error(`发布失败（${res.status}）`);
  const json = (await res.json()) as { key?: string };
  if (!json.key) throw new Error('服务器没有返回备份密钥');
  params.onProgress?.(done, total, 'done');
  return normalizeKey(json.key);
}

/** Fetch and decode a blob by hash. */
export async function getBlob(baseURL: string, hash: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<unknown> {
  const res = await fetchImpl(`${baseURL}/v1/backup/blobs/${hash}`);
  if (!res.ok) throw new Error(`下载失败（${res.status}）`);
  const gz = new Uint8Array(await res.arrayBuffer());
  const raw = await gunzipBytes(gz);
  return JSON.parse(new TextDecoder().decode(raw));
}

/** Download a whole backup described by a key. */
export async function downloadBackup(
  baseURL: string,
  key: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<BackupManifest> {
  const normalized = normalizeKey(key);
  const res = await fetchImpl(`${baseURL}/v1/backup/${normalized}`);
  if (!res.ok) throw new Error(`恢复失败（${res.status}）`);
  const manifest = (await res.json()) as BackupManifest;
  if (manifest.type !== 'rpnow-backup') throw new Error('备份格式不正确');
  return manifest;
}
