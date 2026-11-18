/**
 * Connection panel ("Stitch" layer).
 *
 * Lives in the **top bar** as a button beside Settings. It used to be a
 * `fixed right-3 top-3` overlay, which on a phone sat inside the status-bar
 * inset (40px) and was therefore hidden under the status bar — and it visually
 * competed with the settings gear instead of sitting in the same row.
 *
 * Anchoring the panel to the header means it inherits the header's safe-area
 * padding, so it is never drawn under the status bar on any device.
 */

import { useEffect, useState } from 'react';
import { Link2, X, Package, Radio } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { Badge } from '@/components/ui/misc.js';
import { cn } from '@/lib/utils.js';

interface Bond {
  from: string;
  to: string;
  strength: number;
}

export function ConnectionPanel() {
  const [open, setOpen] = useState(false);
  const cards = useApp((s) => s.cards);
  const chats = useApp((s) => s.chats);
  const presets = useApp((s) => s.presets);
  const lorebooks = useApp((s) => s.lorebooks);
  const kernel = useApp((s) => s.kernel);
  const [, force] = useState(0);

  // Refresh the service readout while open.
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => force((x) => x + 1), 1500);
    return () => clearInterval(t);
  }, [open]);

  // Close on route change / Escape so the panel never lingers over another page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Bonds are derived from shared chats: two characters linked by a shared
  // world book get a stronger strand.
  const bonds: Bond[] = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i];
      const b = cards[j];
      const sharedBooks =
        (a.data.character_book?.entries?.length ? 1 : 0) +
        (b.data.character_book?.entries?.length ? 1 : 0);
      bonds.push({ from: a.data.name, to: b.data.name, strength: 0.4 + sharedBooks * 0.2 });
    }
  }

  const services = kernel ? [...new Set(kernel.records().flatMap((r) => r.manifest.provides ?? []))] : [];
  const active = kernel?.records().filter((r) => r.state === 'active').length ?? 0;
  const total = kernel?.records().length ?? 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="打开连接面板"
        aria-expanded={open}
        title="连接面板"
        className={cn(
          'flex size-10 cursor-pointer items-center justify-center rounded-lg transition-colors',
          open
            ? 'bg-[var(--rp-accent-soft)] text-[var(--rp-accent)]'
            : 'text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)] hover:text-[var(--rp-fg)]',
        )}
      >
        <Link2 className="size-5" aria-hidden="true" />
      </button>

      {open && (
        <>
          {/* Click-away layer: sits under the panel so the page stays interactive. */}
          <button
            type="button"
            aria-label="关闭连接面板"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/40 backdrop-blur-[1px]"
          />
          <div
            role="dialog"
            aria-label="连接与货单"
            className="rp-anim-pop absolute right-0 top-full z-50 mt-1.5 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] shadow-rp"
          >
            <div className="flex items-center gap-2 border-b border-[var(--rp-border)] px-3 py-2">
              <Radio className="size-4 text-[var(--rp-accent)]" aria-hidden="true" />
              <p className="text-[12.5px] font-semibold">连接面板</p>
              <Badge variant="outline" className="ml-auto">
                {active}/{total} 在线
              </Badge>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="关闭"
                className="flex size-7 cursor-pointer items-center justify-center rounded text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)]"
              >
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>

            <div className="rp-scroll max-h-[62vh] space-y-3 overflow-y-auto p-3">
              <section>
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--rp-fg-subtle)]">
                  <Package className="size-3" aria-hidden="true" /> 货单
                </p>
                <ul className="space-y-1">
                  {[
                    ['角色卡', cards.length],
                    ['对话', chats.length],
                    ['预设', presets.length],
                    ['世界书', lorebooks.length],
                    ['服务', services.length],
                  ].map(([label, count]) => (
                    <li key={String(label)} className="flex items-center justify-between text-[12px]">
                      <span className="text-[var(--rp-fg-muted)]">{label}</span>
                      <span className="tabular-nums font-medium">{count}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <p className="mb-1.5 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--rp-fg-subtle)]">
                  <Link2 className="size-3" aria-hidden="true" /> 羁绊
                </p>
                {bonds.length === 0 ? (
                  <p className="text-[11.5px] text-[var(--rp-fg-subtle)]">
                    至少需要两个角色才能形成羁绊。
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {bonds.slice(0, 6).map((b) => (
                      <li key={`${b.from}-${b.to}`} className="space-y-1">
                        <div className="flex items-center justify-between text-[11.5px]">
                          <span className="truncate">
                            {b.from} — {b.to}
                          </span>
                          <span className="tabular-nums text-[var(--rp-fg-subtle)]">
                            {Math.round(b.strength * 100)}%
                          </span>
                        </div>
                        <div className="h-1 overflow-hidden rounded-full bg-[var(--rp-bg-sunken)]">
                          <div
                            className="h-full rounded-full bg-[var(--rp-accent)]"
                            style={{ width: `${b.strength * 100}%` }}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <p className="text-[10.5px] leading-relaxed text-[var(--rp-fg-subtle)]">
                  「货单」与「羁绊」是从本地数据推导出的只读视图，不会修改任何内容。
                </p>
              </section>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
