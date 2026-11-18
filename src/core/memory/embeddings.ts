/**
 * Embedding helpers for enhanced memory recall.
 *
 * Vectors are stored quantised to int8 (max-abs scaling) because a 1536-dim
 * float32 vector is ~6 KB of JSON per memory, which does not survive long chats
 * in IndexedDB. int8 + a single scale factor is ~1.5 KB and loses almost nothing
 * for cosine similarity.
 *
 * Encoding: `int8:maxabs:v1` — `round(value / maxAbs * 127)`, stored base64, with
 * `embeddingScale = maxAbs / 127` recorded alongside.
 */

import { EMBEDDING_ENCODING } from './types.js';

export function bytesToBase64(source: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < source.length; i += chunk) {
    binary += String.fromCharCode(...source.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Quantise a float vector to the on-disk int8 representation. */
export function quantizeEmbedding(embedding: ArrayLike<number>): {
  embeddingQ: string;
  embeddingScale: number;
  embeddingDims: number;
  embeddingEncoding: string;
} | null {
  const values = Array.from(embedding as ArrayLike<number>, (v) => Number(v) || 0);
  if (!values.length) return null;
  let maxAbs = 0;
  for (const v of values) {
    const a = Math.abs(v);
    if (a > maxAbs) maxAbs = a;
  }
  if (maxAbs <= 0) return null;

  const quantized = new Int8Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const scaled = Math.round((values[i] / maxAbs) * 127);
    quantized[i] = Math.max(-127, Math.min(127, scaled));
  }
  return {
    embeddingQ: bytesToBase64(new Uint8Array(quantized.buffer)),
    embeddingScale: maxAbs / 127,
    embeddingDims: values.length,
    embeddingEncoding: EMBEDDING_ENCODING,
  };
}

/** Decode a stored vector back to floats (approximate, but cosine-equivalent). */
export function dequantizeEmbedding(record: {
  embeddingQ?: string;
  embeddingScale?: number;
  embeddingDims?: number;
}): number[] {
  if (!record.embeddingQ) return [];
  const bytes = base64ToBytes(record.embeddingQ);
  const ints = new Int8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (record.embeddingDims && ints.length !== record.embeddingDims) return [];
  const scale = record.embeddingScale ?? 1;
  return Array.from(ints, (v) => v * scale);
}

/** Cosine similarity; returns -1 when the vectors cannot be compared. */
export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a.length || a.length !== b.length) return -1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : -1;
}

/**
 * Rank memories against a query vector.
 *
 * Only memories with a usable embedding participate; the caller applies the
 * threshold and cap. Ties break on the later turn so newer context wins.
 */
export function rankBySimilarity(
  memories: Array<{ record: { embeddingQ?: string; embeddingScale?: number; embeddingDims?: number; turn: number } }>,
  query: number[],
  threshold: number,
  max: number,
): Array<{ record: (typeof memories)[number]['record']; score: number }> {
  const scored: Array<{ record: (typeof memories)[number]['record']; score: number }> = [];
  for (const m of memories) {
    const vec = dequantizeEmbedding(m.record);
    if (!vec.length) continue;
    const score = cosineSimilarity(query, vec);
    if (score >= threshold) scored.push({ record: m.record, score });
  }
  scored.sort((a, b) => b.score - a.score || b.record.turn - a.record.turn);
  return scored.slice(0, max);
}
