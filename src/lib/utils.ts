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

/**
 * Message timestamp, precise to the second.
 *
 * Chat messages show their exact clock time (not a relative “x 分钟前”):
 * today → `18:32:05`, yesterday → `昨天 18:32:05`, this year → `11月18日
 * 18:32:05`, earlier years → `2025年11月18日 18:32:05`.
 */
export function formatMessageTime(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('zh-CN', { hour12: false });
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((startOf(now) - startOf(d)) / dayMs);
  if (diffDays <= 0) return time;
  if (diffDays === 1) return `昨天 ${time}`;
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${time}`;
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

/**
 * Save a Blob to the device. On mobile the `<a download>` click that
 * `downloadBlob` uses silently does nothing (Android WebView / mobile
 * browsers often swallow blob-URL downloads), so prefer the native share
 * sheet there: the user picks where the image goes (相册 / 文件 / …).
 * Returns 'shared' when the share sheet was used, 'downloaded' when the
 * anchor download was used, and 'cancelled' when the user dismissed the
 * share sheet without picking a target.
 */
export async function saveBlobToDevice(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  if (nav?.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file] });
      return 'shared';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

/** Filesystem-safe filename from arbitrary text. */
export function safeFilename(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'untitled';
  return `${base}.${ext}`;
}

export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
