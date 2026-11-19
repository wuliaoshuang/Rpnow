/**
 * Selective-export modal (P10 / O07, RP-Hub parity).
 *
 * RP-Hub's "选择导出项目" sheet: every exportable group gets a checkbox list
 * with 全选 / 取消全选, and only the checked items leave the app. The modal is
 * deliberately dumb — it only collects ids; the caller builds and downloads
 * the file from `onExport`.
 *
 * Used by: card export (lorebook entries + regex scripts), preset export,
 * UI-template export. Lorebook-page wiring is intentionally left to the
 * LorePage owner (see `lorebookExportDoc` in `core/export/selective.ts`).
 */

import * as React from 'react';
import { Download } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

export interface ExportSelectionItem {
  id: string;
  label: string;
  hint?: string;
}

export interface ExportSelectionGroup {
  id: string;
  label: string;
  items: ExportSelectionItem[];
}

/** `onExport` receives the checked item ids, grouped by group id. */
export function ExportSelectionModal({
  open,
  onOpenChange,
  title,
  description,
  groups,
  onExport,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  groups: ExportSelectionGroup[];
  onExport: (selected: Record<string, string[]>) => void;
}) {
  const allIds = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const g of groups) map[g.id] = g.items.map((i) => i.id);
    return map;
  }, [groups]);

  const [selected, setSelected] = React.useState<Record<string, ReadonlySet<string>>>({});

  // (Re)select everything each time the sheet opens.
  React.useEffect(() => {
    if (!open) return;
    const next: Record<string, ReadonlySet<string>> = {};
    for (const g of groups) next[g.id] = new Set(g.items.map((i) => i.id));
    setSelected(next);
  }, [open, groups]);

  if (!open) return null;

  const totalSelected = Object.values(selected).reduce((sum, s) => sum + (s?.size ?? 0), 0);
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);

  const toggle = (groupId: string, itemId: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev[groupId] ?? []);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return { ...prev, [groupId]: next };
    });
  };

  const toggleGroup = (groupId: string, all: boolean) => {
    setSelected((prev) => ({
      ...prev,
      [groupId]: all ? new Set(allIds[groupId] ?? []) : new Set<string>(),
    }));
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onOpenChange(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="rp-scroll max-h-[55vh] space-y-4 overflow-y-auto px-5 pb-2">
          {totalItems === 0 ? (
            <p className="py-4 text-center text-[12px] text-[var(--rp-fg-muted)]">没有可选择的导出内容。</p>
          ) : (
            groups.map((group) => {
              if (!group.items.length) return null;
              const checked = selected[group.id] ?? new Set<string>();
              const allChecked = checked.size === group.items.length;
              return (
                <section key={group.id} aria-label={group.label}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <p className="text-[12px] font-semibold">
                      {group.label}（{checked.size}/{group.items.length}）
                    </p>
                    <button
                      type="button"
                      className="ml-auto cursor-pointer text-[11px] text-[var(--rp-accent)] hover:underline"
                      onClick={() => toggleGroup(group.id, !allChecked)}
                    >
                      {allChecked ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <ul className="space-y-1">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <label className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--rp-border)] px-2.5 py-2">
                          <input
                            type="checkbox"
                            checked={checked.has(item.id)}
                            onChange={(e) => toggle(group.id, item.id, e.target.checked)}
                            aria-label={item.label}
                          />
                          <span className="min-w-0 flex-1 truncate text-[12.5px]">{item.label}</span>
                          {item.hint && (
                            <span className="shrink-0 text-[10.5px] text-[var(--rp-fg-subtle)]">{item.hint}</span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            disabled={totalSelected === 0}
            onClick={() => {
              const out: Record<string, string[]> = {};
              for (const g of groups) out[g.id] = [...(selected[g.id] ?? [])];
              onExport(out);
              onOpenChange(false);
            }}
          >
            <Download className="size-3.5" aria-hidden="true" /> 导出选中（{totalSelected}）
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
