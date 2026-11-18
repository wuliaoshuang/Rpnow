/**
 * Update popup.
 *
 * Two modes, decided by the server manifest:
 *   - Forced: no close button, no "later" — the only way out is "立即更新".
 *     The app stays usable behind the dialog, but the dialog does not go
 *     away until the user updates (or closes the app).
 *   - Non-forced: "立即更新" / "稍后再说" (dismiss for this session) /
 *     "忽略此版本" (never show this version again).
 */

import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { setIgnoredVersionCode } from '@/core/version.js';
import type { VersionInfo } from '@/core/version.js';

export interface UpdateDialogProps {
  info: VersionInfo;
  forced: boolean;
  onClose: () => void;
}

export function UpdateDialog({ info, forced, onClose }: UpdateDialogProps) {
  const ignoreThisVersion = () => {
    setIgnoredVersionCode(info.versionCode);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="发现新版本"
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-4 backdrop-blur-[2px] sm:items-center"
    >
      <div className="w-[min(26rem,100%)] overflow-hidden rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] shadow-rp">
        <div className="border-b border-[var(--rp-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="text-[15px] font-semibold">发现新版本</p>
            {forced && (
              <span className="rounded-full bg-[var(--rp-danger)] px-2 py-0.5 text-[10.5px] font-semibold text-white">
                强制更新
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--rp-fg-subtle)]">
            v{info.version}
            {info.publishedAt ? ` · ${info.publishedAt.slice(0, 10)}` : ''}
          </p>
        </div>
        <div className="px-4 py-3">
          {info.releaseNotes ? (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--rp-fg)]">{info.releaseNotes}</p>
          ) : (
            <p className="text-[12.5px] text-[var(--rp-fg-muted)]">本次更新包含功能改进与问题修复。</p>
          )}
          {forced && (
            <p className="mt-2 rounded-xl bg-[var(--rp-danger)]/10 px-3 py-2 text-[11.5px] leading-relaxed text-[var(--rp-danger)]">
              这是一次强制更新，旧版本将无法继续使用，请先更新到最新版。
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2 border-t border-[var(--rp-border)] px-4 py-3">
          {info.downloadUrl ? (
            <Button asChild className="w-full rounded-full">
              <a href={info.downloadUrl} target="_blank" rel="noopener noreferrer">
                <Download className="size-3.5" aria-hidden="true" /> 立即更新
              </a>
            </Button>
          ) : (
            <Button className="w-full rounded-full" onClick={onClose}>
              知道了
            </Button>
          )}
          {!forced && (
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-full" onClick={onClose}>
                稍后再说
              </Button>
              <Button variant="ghost" className="flex-1 rounded-full" onClick={ignoreThisVersion}>
                忽略此版本
              </Button>
            </div>
          )}
        </div>
        {!forced && (
          <button
            type="button"
            aria-label="关闭更新弹窗"
            onClick={onClose}
            className="absolute right-3 top-3 flex size-8 cursor-pointer items-center justify-center rounded-full text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
