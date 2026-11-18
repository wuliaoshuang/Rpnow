/**
 * Import result dialog.
 *
 * Shows one row per file with its outcome. Partial failures are the norm when
 * users drop a folder of mixed cards and presets, so the dialog must make it
 * obvious what landed and what did not — silence is the failure mode.
 */

import { AlertTriangle, CheckCircle2, FileWarning, Info } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/misc';
import type { ImportResult } from '@/features/import/cardImport.js';

const KIND_LABEL: Record<string, string> = {
  card: '角色卡',
  lorebook: '世界书',
  preset: '预设',
  unknown: '未识别',
  error: '失败',
};

export function ImportDialog({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const errors = result.outcomes.filter((o) => o.kind === 'error');
  const warnings = result.outcomes.filter((o) => o.warnings?.length);
  const extras = result.lorebooks.length + result.presets.length + result.contextTemplates.length + result.instructTemplates.length;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>导入结果</DialogTitle>
          <DialogDescription>
            角色卡 {result.cards.length} 张
            {extras > 0 && ` · 世界书/预设 ${extras} 个`}
            {errors.length > 0 && ` · 失败 ${errors.length} 个`}
          </DialogDescription>
        </DialogHeader>

        <div className="rp-scroll max-h-[50vh] space-y-1.5 overflow-y-auto px-5 pb-2">
          {result.outcomes.map((o) => {
            const isError = o.kind === 'error';
            return (
              <div
                key={`${o.file}-${o.name ?? ''}`}
                className={
                  isError
                    ? 'rounded-md border border-[var(--rp-danger)]/40 bg-[var(--rp-danger)]/5 p-2.5'
                    : 'rounded-md border border-[var(--rp-border)] p-2.5'
                }
              >
                <div className="flex items-center gap-2">
                  {isError ? (
                    <FileWarning className="size-4 shrink-0 text-[var(--rp-danger)]" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="size-4 shrink-0 text-[var(--rp-ok)]" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{o.file}</span>
                  <Badge variant={isError ? 'danger' : 'outline'}>{KIND_LABEL[o.kind] ?? o.kind}</Badge>
                </div>
                {o.name && <p className="mt-1 pl-6 text-[12px] text-[var(--rp-fg-muted)]">→ {o.name}</p>}
                {o.message && <p className="mt-1 pl-6 text-[11.5px] text-[var(--rp-danger)]">{o.message}</p>}
                {o.warnings?.map((w, i) => (
                  <p key={i} className="mt-1 flex items-start gap-1 pl-6 text-[11px] text-[var(--rp-warn)]">
                    <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
                    {w}
                  </p>
                ))}
              </div>
            );
          })}

          {extras > 0 && (
            <p className="flex items-start gap-1.5 rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/60 p-2.5 text-[11.5px] text-[var(--rp-fg-muted)]">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              识别到的世界书与预设已进入「世界书」和「预设」页面，可以在那里启用或编辑。
            </p>
          )}
          {warnings.length > 0 && !errors.length && (
            <p className="text-[11px] text-[var(--rp-fg-subtle)]">提示：部分卡片有兼容性提醒，内容仍可按原样使用。</p>
          )}
        </div>

        <DialogFooter>
          <Button onClick={onClose}>知道了</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
