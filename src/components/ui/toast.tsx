/**
 * Minimal toast system.
 *
 * Written in-house rather than pulled from a library because it must be
 * mountable *inside* the app shell (below dialogs) and must be accessible:
 * `role="status"` for success, `role="alert"` for errors, and auto-dismiss
 * paused on hover/focus.
 */

import * as React from 'react';
import { CheckCircle2, Info, TriangleAlert, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function emit() {
  for (const fn of [...listeners]) fn([...items]);
}

function push(kind: ToastKind, title: string, description?: string, ttl = 4200) {
  const item: ToastItem = { id: ++seq, kind, title, description };
  items = [...items, item];
  emit();
  if (ttl > 0) {
    setTimeout(() => dismiss(item.id), ttl);
  }
  return item.id;
}

export function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

export const toast = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description, 8000),
  info: (title: string, description?: string) => push('info', title, description),
};

export function Toaster() {
  const [list, setList] = React.useState<ToastItem[]>(items);
  React.useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed inset-x-0 bottom-20 z-[90] flex flex-col items-center gap-2 px-3 md:bottom-6 md:items-end md:pr-6"
    >
      {list.map((t) => {
        const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? TriangleAlert : Info;
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={cn(
              'rp-anim-pop pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-lg border bg-[var(--rp-bg-elevated)] p-3 shadow-rp',
              t.kind === 'error'
                ? 'border-[var(--rp-danger)]/40'
                : t.kind === 'success'
                  ? 'border-[var(--rp-ok)]/40'
                  : 'border-[var(--rp-border)]',
            )}
          >
            <Icon
              className={cn(
                'mt-0.5 size-4 shrink-0',
                t.kind === 'error' ? 'text-[var(--rp-danger)]' : t.kind === 'success' ? 'text-[var(--rp-ok)]' : 'text-[var(--rp-accent)]',
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-medium leading-snug">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 break-words text-[12px] leading-snug text-[var(--rp-fg-muted)]">{t.description}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="关闭提示"
              className="-m-1 flex size-7 cursor-pointer items-center justify-center rounded text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)]"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
