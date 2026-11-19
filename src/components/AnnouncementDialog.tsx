/**
 * Announcement popup (L07 / R08).
 *
 * RP-Hub parity: when a new version is discovered, its release notes are
 * shown once as an announcement (title + content + 10s countdown). The
 * close button stays disabled until the countdown ends — the user has to
 * see the announcement before dismissing it. Closing writes the
 * announcement id (the versionCode) via `setSeenAnnouncementId`, so the
 * same announcement is never shown twice.
 *
 * The dialog itself never offers the update action: after it closes, the
 * caller shows the regular UpdateDialog (same queueing as RP-Hub, where a
 * pending remote-update notice is shown after the announcement closes).
 * Forced updates skip the announcement entirely and go straight to
 * UpdateDialog.
 */

import { useEffect, useState } from 'react';
import { Megaphone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ANNOUNCEMENT_COUNTDOWN_SECONDS } from '@/core/version.js';
import type { VersionInfo } from '@/core/version.js';

export interface AnnouncementDialogProps {
  /** The newly discovered version; its releaseNotes are the announcement. */
  info: VersionInfo;
  onClose: () => void;
}

export function AnnouncementDialog({ info, onClose }: AnnouncementDialogProps) {
  const [countdown, setCountdown] = useState(ANNOUNCEMENT_COUNTDOWN_SECONDS);

  // RP-Hub counts down from a fixed end time (250ms ticks) so the number
  // stays accurate even if a tick is delayed.
  useEffect(() => {
    const endsAt = Date.now() + ANNOUNCEMENT_COUNTDOWN_SECONDS * 1000;
    const tick = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setCountdown(left);
      if (left <= 0) window.clearInterval(timer);
    };
    const timer = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="网站公告"
      className="fixed inset-0 z-[80] flex items-end justify-center bg-black/50 p-4 backdrop-blur-[2px] sm:items-center"
    >
      <div className="flex max-h-[85dvh] w-[min(26rem,100%)] flex-col overflow-hidden rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] shadow-rp">
        <div className="border-b border-[var(--rp-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <Megaphone className="size-4 shrink-0 text-[var(--rp-accent)]" aria-hidden="true" />
            <p className="text-[15px] font-semibold">网站公告</p>
            <span className="rounded-full bg-[var(--rp-accent)]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[var(--rp-accent)]">
              New
            </span>
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--rp-fg-subtle)]">
            v{info.version}
            {info.publishedAt ? ` · ${info.publishedAt.slice(0, 10)}` : ''}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {info.releaseNotes ? (
            <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--rp-fg)]">
              {info.releaseNotes}
            </p>
          ) : (
            <p className="text-[12.5px] text-[var(--rp-fg-muted)]">新版本已发布，包含功能改进与问题修复。</p>
          )}
        </div>
        <div className="border-t border-[var(--rp-border)] px-4 py-3">
          <Button className="w-full rounded-full" disabled={countdown > 0} onClick={onClose}>
            知道了{countdown > 0 ? ` (${countdown}s)` : ''}
          </Button>
        </div>
      </div>
    </div>
  );
}
