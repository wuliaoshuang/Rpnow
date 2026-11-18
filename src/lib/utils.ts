import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Tailwind-aware class merge used by every UI primitive. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Rough character count → token estimate used by the UI token meters. */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  // CJK is ~1 token/char; latin is ~1 token/3.5 chars. This is an estimate for
  // context budgeting, not an exact tokenizer.
  const cjk = (text.match(/[\u3000-\u9fff\uff00-\uffef]/g) ?? []).length;
  const rest = text.length - cjk;
  return Math.ceil(cjk + rest / 3.5);
}

export function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小时前`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Debounce that keeps the latest arguments; used for autosave in editors. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const wrapped = (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
  };
  return wrapped;
}

/** Trigger a browser download for a blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Filesystem-safe filename from arbitrary text. */
export function safeFilename(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'untitled';
  return `${base}.${ext}`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
