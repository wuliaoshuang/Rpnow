/**
 * PhoneImageConfig — 小手机生图设置（底部弹层）。
 *
 * 改动即时写回 `settings.phone`，不用点保存。
 */
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { PHONE_IMAGE_SIZES } from '@/core/phone/types.js';

export function PhoneImageConfig({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const settings = useApp((s) => s.settings);
  const imageConnections = useApp((s) => s.imageConnections);
  const phone = settings.phone ?? {};

  if (!open) return null;

  const write = (patch: Partial<typeof phone>) => {
    useApp.getState().setSettings({ phone: { ...phone, ...patch } });
  };

  const selectedConnection =
    imageConnections.find((c) => c.id === phone.imageConnectionId) ??
    imageConnections[0];

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end justify-center">
      <button
        type="button"
        aria-label="关闭设置"
        onClick={() => onOpenChange(false)}
        className="absolute inset-0 cursor-pointer bg-black/50"
      />
      <div className="relative w-full max-w-[390px] rounded-t-3xl bg-[var(--rp-bg-elevated)] px-4 pt-3 pb-3 text-[var(--rp-fg)] shadow-2xl">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-base font-semibold">小手机生图设置</h2>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-[var(--rp-bg-muted)]"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-4 py-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">生图连接</span>
            <select
              value={phone.imageConnectionId ?? ''}
              onChange={(e) => write({ imageConnectionId: e.target.value || '' })}
              className="w-full cursor-pointer rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg)] px-3 py-2 text-sm outline-none"
            >
              <option value="">默认（第一个）</option>
              {imageConnections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}（{c.provider}）
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">模型</span>
            <input
              value={phone.imageModel ?? ''}
              onChange={(e) => write({ imageModel: e.target.value })}
              placeholder={selectedConnection?.defaultModel || '默认模型'}
              className="w-full rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg)] px-3 py-2 text-sm outline-none"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">画师串</span>
            <input
              value={phone.imageArtistTags ?? ''}
              onChange={(e) => write({ imageArtistTags: e.target.value })}
              placeholder="画师/画风标签，用逗号分隔，会加到提示词后面"
              className="w-full rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg)] px-3 py-2 text-sm outline-none"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">负面提示词</span>
            <textarea
              value={phone.imageNegativePrompt ?? ''}
              onChange={(e) => write({ imageNegativePrompt: e.target.value })}
              placeholder="不想出现的东西，会传给生图接口"
              rows={2}
              className="w-full resize-none rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg)] px-3 py-2 text-sm outline-none"
            />
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">图片尺寸</span>
            <div className="flex gap-2">
              {PHONE_IMAGE_SIZES.map((opt) => {
                const active = (phone.imageSize ?? 'square') === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => write({ imageSize: opt.value })}
                    className={`flex-1 cursor-pointer rounded-full border px-3 py-2 text-sm transition-colors ${
                      active
                        ? 'border-[#07C160] bg-[#07C160] font-medium text-white'
                        : 'border-[var(--rp-border)] bg-[var(--rp-bg)] text-[var(--rp-fg)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
