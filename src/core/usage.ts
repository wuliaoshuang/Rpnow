/**
 * Usage history (用量历史) — RP-Hub L01 / L04 / L05 / A08.
 *
 * Every LLM request the app makes is recorded here: the main chat turn
 * (`sendTurn`, recorded at its call site in `ChatView`), memory summaries and
 * secondary compression (through the wrapped LLM service handed to
 * `MemoryService`), and embedding calls for enhanced recall. The history
 * lives in IndexedDB under one key (`rpnow:usage-history`, so it rides along
 * with the normal full backup), capped at the newest 2000 entries.
 *
 * Token counts come from the provider's own `usage` payload. Two known gaps:
 *
 *   - **Reasoning tokens**: `UsageRecord.reasoningTokens` is filled from
 *     `completion_tokens_details.reasoning_tokens` (OpenAI) and
 *     `thoughtsTokenCount` (Gemini), parsed in `core/llm/adapters.ts`.
 *   - **Embeddings**: `embedFrom` returns vectors only, no usage, so the
 *     input token count is an estimate (`estimateTokens`) and the record is
 *     marked `estimated`.
 */

import * as React from 'react';
import { idbStorage } from './storage/index.js';
import { estimateTokens } from '../lib/utils.js';
import type { LLMService } from './llm/types.js';

/** What the request was for. Mirrors RP-Hub's usage groups (chat / memory). */
export type UsageKind = 'chat' | 'memory' | 'embedding';

export const USAGE_KIND_LABELS: Record<UsageKind, string> = {
  chat: '主对话',
  memory: '记忆系统',
  embedding: '向量',
};

export interface UsageRecord {
  id: string;
  /** Epoch ms, for time-range filtering. */
  at: number;
  kind: UsageKind;
  /** Model that served the request, when known. */
  model?: string;
  /** Chat the request belongs to (chat turns and memory jobs). */
  chatId?: string;
  /** Human label shown in the log, e.g. the character name. */
  label?: string;
  inputTokens?: number;
  /** Prompt tokens served from the provider's cache. */
  cachedTokens?: number;
  outputTokens?: number;
  /**
   * Reasoning tokens, when the provider reports them. Not yet plumbed through
   * the adapters — see the module doc comment.
   */
  reasoningTokens?: number;
  /** Wall-clock time of the request. */
  durationMs?: number;
  /** True when a token count is estimated rather than provider-reported. */
  estimated?: boolean;
}

const KEY = 'rpnow:usage-history';
/** Keep the newest N records; older ones are dropped on write. */
const MAX_RECORDS = 2000;

let uidCounter = 0;
function uid(): string {
  uidCounter += 1;
  return `u_${Date.now().toString(36)}_${uidCounter}_${Math.random().toString(36).slice(2, 8)}`;
}

/** In-memory copy, so reads never await IndexedDB after the first load. */
let cache: UsageRecord[] | null = null;
let loadPromise: Promise<UsageRecord[]> | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of [...listeners]) fn();
}

export function subscribeUsage(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadUsageHistory(): Promise<UsageRecord[]> {
  if (cache) return cache;
  if (!loadPromise) {
    loadPromise = idbStorage
      .get<UsageRecord[]>(KEY)
      .then((rows) => {
        cache = Array.isArray(rows) ? rows : [];
        return cache;
      })
      .catch((err) => {
        console.warn('[usage] 读取用量历史失败', err);
        cache = [];
        return cache;
      });
  }
  return loadPromise;
}

async function persist(rows: UsageRecord[]): Promise<void> {
  try {
    await idbStorage.set(KEY, rows);
  } catch (err) {
    console.warn('[usage] 写入用量历史失败', err);
  }
}

/**
 * Append one record. Fire-and-forget safe: callers `void` it and never await.
 * A failed write only logs — a usage record must never break the turn that
 * produced it.
 */
export async function recordUsage(
  entry: Omit<UsageRecord, 'id' | 'at'> & { at?: number },
): Promise<UsageRecord> {
  const record: UsageRecord = { ...entry, id: uid(), at: entry.at ?? Date.now() };
  const rows = [...(await loadUsageHistory()), record];
  cache = rows.length > MAX_RECORDS ? rows.slice(rows.length - MAX_RECORDS) : rows;
  notify();
  await persist(cache);
  return record;
}

/** Drop the whole history (usage page → 清空, with a confirm dialog). */
export async function clearUsageHistory(): Promise<void> {
  cache = [];
  notify();
  await persist(cache);
}

/** React hook: the history, live-updated whenever a request is recorded. */
export function useUsageHistory(): UsageRecord[] {
  const [rows, setRows] = React.useState<UsageRecord[]>(cache ?? []);
  React.useEffect(() => {
    let alive = true;
    void loadUsageHistory().then((loaded) => {
      if (alive) setRows(loaded);
    });
    const off = subscribeUsage(() => {
      void loadUsageHistory().then((loaded) => {
        if (alive) setRows(loaded);
      });
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return rows;
}

// ------------------------------------------------------------ presentation

/**
 * RP-Hub formats token counts in 万 (10k). Below 10k the raw number is
 * clearer than `0.12万`, so only large counts switch units.
 */
export function formatTokens(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return '—';
  if (n >= 10000) return `${(n / 10000).toFixed(2).replace(/\.?0+$/, '')}万`;
  return String(n);
}

/** `850ms` / `1.2s` / `1m05s`. */
export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m${String(s).padStart(2, '0')}s`;
}

/** Output tokens per second, for the log's speed column. */
export function formatSpeed(record: UsageRecord): string {
  const out = record.outputTokens;
  const ms = record.durationMs;
  if (out === undefined || !ms || ms <= 0) return '—';
  return `${(out / (ms / 1000)).toFixed(1)} tok/s`;
}

/** Total tokens for one record (input + cached + output). */
export function recordTotalTokens(record: UsageRecord): number {
  return (record.inputTokens ?? 0) + (record.cachedTokens ?? 0) + (record.outputTokens ?? 0);
}

// ------------------------------------------------------------- filtering

export type UsageTimeRange = 'all' | '24h' | '7d' | '30d';

export const USAGE_TIME_RANGES: Array<{ id: UsageTimeRange; label: string }> = [
  { id: 'all', label: '全部时间' },
  { id: '24h', label: '最近 24 小时' },
  { id: '7d', label: '最近 7 天' },
  { id: '30d', label: '最近 30 天' },
];

const TIME_RANGE_MS: Record<Exclude<UsageTimeRange, 'all'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

export function filterUsage(
  rows: UsageRecord[],
  opts: { kind?: UsageKind | 'all'; range?: UsageTimeRange; now?: number },
): UsageRecord[] {
  const kind = opts.kind ?? 'all';
  const range = opts.range ?? 'all';
  const now = opts.now ?? Date.now();
  const since = range === 'all' ? 0 : now - TIME_RANGE_MS[range];
  return rows.filter((r) => (kind === 'all' || r.kind === kind) && r.at >= since);
}

export interface UsageSummary {
  requests: number;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  durationMs: number;
}

export function summarizeUsage(rows: UsageRecord[]): UsageSummary {
  const out: UsageSummary = {
    requests: rows.length,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    durationMs: 0,
  };
  for (const r of rows) {
    out.inputTokens += r.inputTokens ?? 0;
    out.cachedTokens += r.cachedTokens ?? 0;
    out.outputTokens += r.outputTokens ?? 0;
    out.reasoningTokens += r.reasoningTokens ?? 0;
    out.totalTokens += recordTotalTokens(r);
    out.durationMs += r.durationMs ?? 0;
  }
  return out;
}

// ------------------------------------------------------- LLM instrumentation

/**
 * Wrap an LLM service so every call made through it is recorded.
 *
 * Used for the memory service: `MemoryService` only ever calls `complete`
 * (round summaries, secondary compression, backfill) and `embedFrom`
 * (enhanced recall), so wrapping those two methods covers all memory and
 * embedding usage without touching the service itself. The main chat turn is
 * recorded separately at the `sendTurn` call site, where the model and chat
 * are known.
 */
export function wrapLlmForUsage(
  llm: LLMService,
  meta: { chatId?: string; label?: string },
): LLMService {
  const wrapped: LLMService = {
    ...llm,
    async complete(connectionId, req) {
      const started = Date.now();
      const res = await llm.complete(connectionId, req);
      void recordUsage({
        kind: 'memory',
        model: req.model,
        chatId: meta.chatId,
        label: meta.label,
        inputTokens: res.usage?.inputTokens,
        cachedTokens: res.usage?.cachedTokens,
        outputTokens: res.usage?.outputTokens,
        durationMs: Date.now() - started,
      });
      return res;
    },
  };
  if (llm.embedFrom) {
    const embedFrom = llm.embedFrom.bind(llm);
    wrapped.embedFrom = async (conn, input, model) => {
      const started = Date.now();
      const vectors = await embedFrom(conn, input, model);
      const text = Array.isArray(input) ? input.join('\n') : input;
      void recordUsage({
        kind: 'embedding',
        model,
        chatId: meta.chatId,
        label: meta.label,
        // The embeddings endpoint reports no usage; estimate from the text.
        inputTokens: estimateTokens(text),
        durationMs: Date.now() - started,
        estimated: true,
      });
      return vectors;
    };
  }
  return wrapped;
}
