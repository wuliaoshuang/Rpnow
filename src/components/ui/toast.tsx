/**
 * Minimal toast system.
 *
 * Written in-house rather than pulled from a library because it must be
 * mountable *inside* the app shell (below dialogs) and must be accessible:
 * `role="status"` for success, `role="alert"` for errors, and auto-dismiss
 * paused on hover/focus.
 */

import * as React from 'react';
import {
  ArrowLeftRight,
  CheckCircle2,
  Copy,
  Cpu,
  Download,
  GitBranch,
  Image,
  Info,
  Loader2,
  Pencil,
  RotateCcw,
  Save,
  Square,
  Star,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastKind = 'success' | 'error' | 'info';

/**
 * RP-Hub picks the toast icon from the message keywords (正在/复制/删除/导出/
 * 导入/收藏/图片/重试/改名/分支/模型/停止/切换/保存…), not just the kind.
 * The first matching keyword wins; an explicit `icon` passed to `toast.*`
 * overrides the keyword scan.
 */
const KEYWORD_ICONS: Array<{ words: string[]; Icon: React.ComponentType<{ className?: string }> }> = [
  { words: ['正在', '加载', '生成中', '处理中'], Icon: Loader2 },
  { words: ['复制', '已复制'], Icon: Copy },
  { words: ['删除', '已删除'], Icon: Trash2 },
  { words: ['导出'], Icon: Download },
  { words: ['导入'], Icon: Upload },
  { words: ['收藏'], Icon: Star },
  { words: ['图片', '生图'], Icon: Image },
  { words: ['重试'], Icon: RotateCcw },
  { words: ['改名', '重命名'], Icon: Pencil },
  { words: ['分支'], Icon: GitBranch },
  { words: ['模型'], Icon: Cpu },
  { words: ['停止'], Icon: Square },
  { words: ['切换'], Icon: ArrowLeftRight },
  { words: ['保存', '已保存'], Icon: Save },
];

function iconFor(title: string, description?: string): React.ComponentType<{ className?: string }> | null {
  const haystack = `${title} ${description ?? ''}`;
  for (const { words, Icon } of KEYWORD_ICONS) {
    if (words.some((w) => haystack.includes(w))) return Icon;
  }
  return null;
}

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  description?: string;
  /** Explicit icon (component); when absent the keyword map decides. */
  icon?: React.ComponentType<{ className?: string }>;
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
const listeners = new Set<Listener>();
let seq = 0;

function emit() {
  for (const fn of [...listeners]) fn([...items]);
}

function push(kind: ToastKind, title: string, description?: string, ttl = 4200, icon?: React.ComponentType<{ className?: string }>) {
  const item: ToastItem = { id: ++seq, kind, title, description, icon };
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
  success: (title: string, description?: string, icon?: React.ComponentType<{ className?: string }>) =>
    push('success', title, description, 4200, icon),
  error: (title: string, description?: string, icon?: React.ComponentType<{ className?: string }>) =>
    push('error', title, description, 8000, icon),
  info: (title: string, description?: string, icon?: React.ComponentType<{ className?: string }>) =>
    push('info', title, description, 4200, icon),
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
        const KindIcon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? TriangleAlert : Info;
        const Icon = t.icon ?? iconFor(t.title, t.description) ?? KindIcon;
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
