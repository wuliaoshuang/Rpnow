/**
 * 创建角色 —— 通用入口子页面（对照参考图）。
 *
 * Three big rows (new / import file / import URL) plus a 快捷导入 strip of
 * sample characters. Reached from the single ＋ button on the cards page, so
 * the toolbar stays clean instead of carrying three competing actions.
 */

import { ChevronLeft, ImagePlus, Link2, UserPlus } from 'lucide-react';
import type { RPCard } from '@/core/types/card.js';
import { vibrate } from '@/lib/haptics';

export interface CreateCharacterPageProps {
  onBack: () => void;
  onNew: () => void;
  onImportFile: () => void;
  onImportUrl: () => void;
  /** Sample characters offered as one-tap imports. */
  quickPicks: RPCard[];
  onQuickPick: (card: RPCard) => void;
}

export function CreateCharacterPage({
  onBack,
  onNew,
  onImportFile,
  onImportUrl,
  quickPicks,
  onQuickPick,
}: CreateCharacterPageProps) {
  const rows = [
    {
      key: 'new',
      icon: <UserPlus className="size-5" aria-hidden="true" />,
      title: '新建角色',
      desc: '从头开始，创建一个新角色',
      onPress: onNew,
    },
    {
      key: 'file',
      icon: <ImagePlus className="size-5" aria-hidden="true" />,
      title: '从文件导入角色卡',
      desc: '支持 JSON 或 PNG 文件',
      onPress: onImportFile,
    },
    {
      key: 'url',
      icon: <Link2 className="size-5" aria-hidden="true" />,
      title: '从URL导入角色卡',
      desc: '使用各大社区角色网址，自动识别导入',
      onPress: onImportUrl,
    },
  ];

  return (
    <div className="rp-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pt-2">
        {/* Compact back header — this is a nested sub-page, not a route. */}
        <div className="mb-4 flex items-center gap-1">
          <button
            type="button"
            onClick={onBack}
            aria-label="返回角色卡"
            className="rp-tap flex size-10 cursor-pointer items-center justify-center rounded-lg text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)] hover:text-[var(--rp-fg)]"
          >
            <ChevronLeft className="size-6" aria-hidden="true" />
          </button>
          <h1 className="flex-1 text-center text-[16px] font-semibold">创建角色</h1>
          <span className="size-10" aria-hidden="true" />
        </div>

        <div className="rp-anim-stagger space-y-3">
          {rows.map((row) => (
            <button
              key={row.key}
              type="button"
              onClick={() => {
                vibrate('tap');
                row.onPress();
              }}
              className="rp-tap flex w-full cursor-pointer items-center gap-3 rounded-2xl bg-[var(--rp-bg-sunken)] p-4 text-left"
            >
              <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--rp-bg-elevated)] text-[var(--rp-accent)]">
                {row.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-semibold">{row.title}</span>
                <span className="mt-0.5 block truncate text-[12.5px] text-[var(--rp-fg-muted)]">
                  {row.desc}
                </span>
              </span>
            </button>
          ))}
        </div>

        {quickPicks.length > 0 && (
          <section className="mt-7">
            <h2 className="mb-3 text-center text-[12.5px] font-semibold text-[var(--rp-fg-subtle)]">
              快捷导入
            </h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {quickPicks.slice(0, 6).map((card) => (
                <button
                  key={card.id}
                  type="button"
                  onClick={() => {
                    vibrate('tap');
                    onQuickPick(card);
                  }}
                  aria-label={`快捷导入 ${card.data.name}`}
                  className="rp-tap-card group relative aspect-[3/4] w-full cursor-pointer overflow-hidden rounded-2xl bg-[var(--rp-bg-sunken)]"
                >
                  {card.avatar ? (
                    <img src={card.avatar} alt="" loading="lazy" className="size-full object-cover" />
                  ) : (
                    <span className="flex size-full items-center justify-center text-2xl font-semibold text-[var(--rp-accent)]">
                      {card.data.name.slice(0, 1)}
                    </span>
                  )}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/75 to-transparent"
                  />
                  <span className="pointer-events-none absolute inset-x-2 bottom-2 truncate text-[13px] font-semibold text-white drop-shadow">
                    {card.data.name}
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
