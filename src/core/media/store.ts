/**
 * Media store — where generated images actually live.
 *
 * Generated images are binary Blobs in their own IndexedDB database
 * (`rpnow-media`), NOT base64 data URLs inside chat objects. That matters
 * on phones:
 *
 *   - a data URL is ~33% bigger than the bytes it encodes, and it sits in
 *     the chat object as one giant string — loading a chat pulls every
 *     image into JS memory at once, which is how the app runs out of memory;
 *   - a Blob in IndexedDB lives on disk; the message only keeps a short
 *     `media:<id>` reference, and the browser decodes the image on demand.
 *
 * Deleting an image removes both the reference (from the message / the
 * generated-images record) and the Blob itself — the original file is gone,
 * not just hidden.
 */

import { createStore, get, set, del, keys, type UseStore } from 'idb-keyval';
import { uid } from '../../lib/utils.js';

/** Reference stored in `message.images` for a media-store image. */
export const MEDIA_PREFIX = 'media:';

export interface GeneratedImageMeta {
  /** Media id (without the `media:` prefix). */
  id: string;
  createdAt: number;
  /** Chat / card the image was generated for, when known. */
  chatId?: string;
  cardId?: string;
  /** Prompt that produced the image (the 正面提示词 + 画师串 that was sent). */
  prompt?: string;
  provider?: string;
  model?: string;
  mime: string;
  /** Blob size in bytes. */
  size: number;
}

const mediaStore: UseStore = createStore('rpnow-media', 'media');
/** Metadata lives in the same store, under a `meta:` key prefix. */
const metaKey = (id: string) => `meta:${id}`;

/** Object URLs handed out for display, cached per media id. */
const objectUrls = new Map<string, string>();

export function isMediaRef(src: string): boolean {
  return src.startsWith(MEDIA_PREFIX);
}

export function mediaIdFromRef(src: string): string | undefined {
  return isMediaRef(src) ? src.slice(MEDIA_PREFIX.length) : undefined;
}

export function mediaRef(id: string): string {
  return `${MEDIA_PREFIX}${id}`;
}

/** data URL → Blob (the image services return data URLs). */
export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return res.blob();
}

/**
 * Save an image Blob. Returns its metadata (with the new id).
 * The image is retained from this moment on, even if the user closes the
 * studio without attaching it anywhere.
 */
export async function saveMediaImage(
  blob: Blob,
  meta: Partial<Pick<GeneratedImageMeta, 'chatId' | 'cardId' | 'prompt' | 'provider' | 'model'>> = {},
): Promise<GeneratedImageMeta> {
  const id = `img_${uid()}`;
  const record: GeneratedImageMeta = {
    id,
    createdAt: Date.now(),
    mime: blob.type || 'image/png',
    size: blob.size,
    ...meta,
  };
  await set(id, blob, mediaStore);
  await set(metaKey(id), record, mediaStore);
  return record;
}

export async function getMediaImage(id: string): Promise<Blob | undefined> {
  return get<Blob>(id, mediaStore);
}

/** All generated-image records, newest first. */
export async function listMediaImages(): Promise<GeneratedImageMeta[]> {
  const allKeys = (await keys(mediaStore)) as string[];
  const records: GeneratedImageMeta[] = [];
  for (const key of allKeys) {
    if (!key.startsWith('meta:')) continue;
    const rec = await get<GeneratedImageMeta>(key, mediaStore);
    if (rec) records.push(rec);
  }
  return records.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Delete an image for good: the Blob and its record are both removed, and
 * any object URL handed out for it is revoked. After this the image cannot
 * be recovered.
 */
export async function deleteMediaImage(id: string): Promise<void> {
  await del(id, mediaStore);
  await del(metaKey(id), mediaStore);
  const url = objectUrls.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    objectUrls.delete(id);
  }
}

/**
 * Display URL for a stored image source.
 *
 *   - `media:<id>` → an object URL for the Blob (cached per id);
 *   - anything else (legacy data URL, http URL) → returned as-is.
 *
 * Returns `undefined` when a `media:` id has no Blob (already deleted).
 */
export async function resolveImageSrc(src: string): Promise<string | undefined> {
  const id = mediaIdFromRef(src);
  if (!id) return src;
  const cached = objectUrls.get(id);
  if (cached) return cached;
  const blob = await getMediaImage(id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  objectUrls.set(id, url);
  return url;
}
