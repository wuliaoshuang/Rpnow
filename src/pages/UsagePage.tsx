/**
 * Usage page (用量统计) — RP-Hub L05 / A08.
 *
 * Totals, request count and a per-request log over the `usageHistory`
 * recorded by `core/usage.ts`: every chat turn, memory summary/compression
 * and embedding call. Filters mirror RP-Hub: kind (全部/主对话/记忆系统/
 * 向量) and time (全部/24h/7d/30d). Ten log rows per page; 清空 drops the
 * whole history after a confirm.
 */

import * as React from 'react';
import { ChevronLeft, ChevronRight, Trash2 } from 'lucide-react';
import {
  USAGE_KIND_LABELS,
  USAGE_TIME_RANGES,
  clearUsageHistory,
  filterUsage,
  formatDuration,
  formatSpeed,
  formatTokens,
  summarizeUsage,
  useUsageHistory,
  type UsageKind,
  type UsageRecord,
  type UsageTimeRange,
} from '@/core/usage.js';
import { Button } from '@/components/ui/button.js';
import { EmptyState } from '@/components/ui/misc.js';
import { confirmAction } from '@/components/ui/confirm.js';
import { toast } from '@/components/ui/toast.js';
import { cn } from '@/lib/utils.js';

const PAGE_SIZE = 10;

const KIND_FILTERS: Array<{ id: UsageKind | 'all'; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'chat', label: USAGE_KIND_LABELS.chat },
  { id: 'memory', label: USAGE_KIND_LABELS.memory },
  { id: 'embedding', label: USAGE_KIND_LABELS.embedding },
];

function formatTime(at: number): string {
  return new Date(at).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function StatCell({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] px-3 py-2.5">
      <p className="text-[11px] text-[var(--rp-fg-muted)]">{label}</p>
      <p className="mt-0.5 text-[17px] leading-tight font-semibold">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-[var(--rp-fg-muted)]">{sub}</p>}
    </div>
  );
}

function LogRow({ record }: { record: UsageRecord }) {
  return (
    <li className="border-b border-[var(--rp-border)] px-3 py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium">
          {record.label ?? record.model ?? USAGE_KIND_LABELS[record.kind]}
          <span className="ml-1.5 rounded-full bg-[var(--rp-bg-sunken)] px-1.5 py-0.5 text-[10px] font-normal text-[var(--rp-fg-muted)]">
            {USAGE_KIND_LABELS[record.kind]}
          </span>
        </p>
        <span className="shrink-0 text-[11px] text-[var(--rp-fg-muted)]">{formatTime(record.at)}</span>
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-[var(--rp-fg-muted)]">
        输入 {formatTokens(record.inputTokens)}
        {record.estimated ? '（估算）' : ''}
        {' · '}缓存 {formatTokens(record.cachedTokens)}
        {' · '}输出 {formatTokens(record.outputTokens)}
        {record.reasoningTokens ? ` · 推理 ${formatTokens(record.reasoningTokens)}` : ''}
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--rp-fg-subtle)]">
        {record.model ?? '未知模型'}
        {' · '}
        {formatDuration(record.durationMs)}
        {record.durationMs ? ` · ${formatSpeed(record)}` : ''}
      </p>
    </li>
  );
}

export function UsagePage() {
  const rows = useUsageHistory();
  const [kind, setKind] = React.useState<UsageKind | 'all'>('all');
  const [range, setRange] = React.useState<UsageTimeRange>('all');
  const [page, setPage] = React.useState(0);

  const filtered = React.useMemo(
    () => filterUsage(rows, { kind, range }).sort((a, b) => b.at - a.at),
    [rows, kind, range],
  );
  const summary = React.useMemo(() => summarizeUsage(filtered), [filtered]);

  // A filter change can leave the page past the end of the list.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const onClear = async () => {
    if (
      !(await confirmAction({
        title: '清空用量记录',
        description: `将删除全部 ${rows.length} 条用量记录，此操作不可恢复。`,
        confirmText: '清空',
        destructive: true,
      }))
    ) {
      return;
    }
    await clearUsageHistory();
    setPage(0);
    toast.success('用量记录已清空');
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-5">
      {/* Totals */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCell label="总用量" value={formatTokens(summary.totalTokens)} sub="输入 + 缓存 + 输出" />
        <StatCell label="请求数" value={String(summary.requests)} sub={`累计耗时 ${formatDuration(summary.durationMs)}`} />
        <StatCell label="输入" value={formatTokens(summary.inputTokens)} sub={`缓存 ${formatTokens(summary.cachedTokens)}`} />
        <StatCell label="输出" value={formatTokens(summary.outputTokens)} sub={summary.reasoningTokens ? `推理 ${formatTokens(summary.reasoningTokens)}` : '不含推理 token'} />
      </div>

      {/* Filters */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="按分类筛选">
          {KIND_FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => {
                setKind(f.id);
                setPage(0);
              }}
              aria-pressed={kind === f.id}
              className={cn(
                'cursor-pointer rounded-full px-3 py-1.5 text-[12px] transition-colors',
                kind === f.id
                  ? 'bg-[var(--rp-accent)] font-semibold text-[var(--rp-accent-fg)]'
                  : 'bg-[var(--rp-bg-elevated)] text-[var(--rp-fg-muted)] hover:text-[var(--rp-fg)]',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <select
          value={range}
          onChange={(e) => {
            setRange(e.target.value as UsageTimeRange);
            setPage(0);
          }}
          aria-label="按时间筛选"
          className="ml-auto cursor-pointer rounded-full border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] px-2.5 py-1.5 text-[12px] text-[var(--rp-fg)] outline-none"
        >
          {USAGE_TIME_RANGES.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {/* Log */}
      {filtered.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="还没有用量记录"
            description="和角色聊一句天、或等记忆总结跑一次，这里就会出现每一次请求的 token 与耗时。"
          />
        </div>
      ) : (
        <>
          <ul className="mt-3 overflow-hidden rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]">
            {pageRows.map((r) => (
              <LogRow key={r.id} record={r} />
            ))}
          </ul>
          <div className="mt-3 flex items-center justify-between gap-2">
            <p className="text-[12px] text-[var(--rp-fg-muted)]">
              第 {safePage * PAGE_SIZE + 1}–{Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)} 条，共{' '}
              {filtered.length} 条
            </p>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                disabled={safePage === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                aria-label="上一页"
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </Button>
              <span className="text-[12px] text-[var(--rp-fg-muted)]">
                {safePage + 1} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={safePage >= pageCount - 1}
                onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                aria-label="下一页"
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* Clear */}
      {rows.length > 0 && (
        <div className="mt-5 flex justify-center">
          <Button size="sm" variant="ghost" onClick={onClear} className="text-[var(--rp-danger)]">
            <Trash2 className="size-3.5" aria-hidden="true" /> 清空用量记录
          </Button>
        </div>
      )}
    </div>
  );
}
