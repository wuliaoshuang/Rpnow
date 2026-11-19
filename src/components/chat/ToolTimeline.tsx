/**
 * Tool timeline (C03/D09).
 *
 * The agent loop already collects every tool call into `AgentResult.toolTrace`
 * (`core/agent/defaultLoop.ts`), but the transcript never showed it — the user
 * could not see which tools the model called, with what arguments, or what
 * came back. This component renders that trace, one row per call, under the
 * message's reasoning block.
 *
 * The trace is carried on the message as `meta.toolTrace` (written by
 * ChatView when a turn finishes); no tool-calling logic lives here, this is
 * render-only. Entries without a string `name` are dropped so a corrupt or
 * hand-edited `meta` can never break the transcript.
 */

import * as React from 'react';
import { ChevronRight, Wrench } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RPChatMessage } from '@/core/types/chat.js';

/** One collected tool call, as produced by `defaultLoop`. */
export interface ToolTraceEntry {
  name: string;
  args: unknown;
  result: unknown;
}

/**
 * Read the tool trace off a message's `meta`. Returns `undefined` when the
 * message has no usable trace (most messages: no tools were called).
 */
export function extractToolTrace(message: RPChatMessage): ToolTraceEntry[] | undefined {
  const raw = message.meta?.toolTrace;
  if (!Array.isArray(raw)) return undefined;
  const entries = raw.filter(
    (e): e is ToolTraceEntry =>
      typeof e === 'object' && e !== null && typeof (e as { name?: unknown }).name === 'string',
  );
  return entries.length ? entries : undefined;
}

/** A call counts as failed when its result carries an `error` field. */
export function isErrorResult(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    (result as { error?: unknown }).error !== undefined
  );
}

/** One-line summary of an argument/result value for the collapsed row. */
export function summarizeValue(value: unknown, maxLen = 160): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') {
    const oneLine = value.replace(/\s+/g, ' ').trim();
    return oneLine.length > maxLen ? `${oneLine.slice(0, maxLen)}…` : oneLine || '—';
  }
  try {
    const json = JSON.stringify(value);
    if (json === undefined) return String(value);
    return json.length > maxLen ? `${json.slice(0, maxLen)}…` : json;
  } catch {
    return String(value);
  }
}

/** Full (untruncated) JSON for the expandable detail view. */
export function prettyValue(value: unknown): string {
  if (value === undefined) return '—';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export function ToolTimeline({ trace }: { trace: ToolTraceEntry[] }) {
  const [open, setOpen] = React.useState(false);
  const errorCount = trace.filter((e) => isErrorResult(e.result)).length;

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mb-1 inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] px-2 py-1 text-[11px] text-[var(--rp-fg-muted)] transition hover:text-[var(--rp-fg)]"
        aria-expanded={open}
      >
        <Wrench className="size-3" aria-hidden="true" />
        工具调用（{trace.length}）
        {errorCount > 0 && (
          <span className="rounded bg-[var(--rp-danger)]/15 px-1 py-px text-[10px] font-semibold text-[var(--rp-danger)]">
            {errorCount} 出错
          </span>
        )}
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} aria-hidden="true" />
      </button>
      {open && (
        <ol className="mb-1 space-y-1.5 rounded-md border border-dashed border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/70 p-2.5 rp-scroll">
          {trace.map((entry, i) => {
            const failed = isErrorResult(entry.result);
            return (
              <li key={i} className="flex gap-2 text-[12px] leading-relaxed">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 size-1.5 shrink-0 rounded-full',
                    failed ? 'bg-[var(--rp-danger)]' : 'bg-[var(--rp-accent)]',
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-mono text-[12px] font-semibold break-all text-[var(--rp-fg)]">
                      {entry.name}
                    </span>
                    <span
                      className={cn(
                        'rounded px-1 py-px text-[10px] font-semibold',
                        failed
                          ? 'bg-[var(--rp-danger)]/15 text-[var(--rp-danger)]'
                          : 'bg-[var(--rp-accent-soft)] text-[var(--rp-accent)]',
                      )}
                    >
                      {failed ? '出错' : '已完成'}
                    </span>
                  </div>
                  <p className="mt-0.5 break-words text-[var(--rp-fg-muted)]">
                    <span className="text-[var(--rp-fg-subtle)]">返回：</span>
                    {summarizeValue(entry.result)}
                  </p>
                  <details className="mt-0.5 text-[11px]">
                    <summary className="cursor-pointer text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)]">
                      参数 / 完整返回
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-[var(--rp-bg)] p-2 font-mono text-[11px] leading-relaxed text-[var(--rp-fg-muted)] rp-scroll">
                      参数：{prettyValue(entry.args)}
                      {'\n\n'}返回：{prettyValue(entry.result)}
                    </pre>
                  </details>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
