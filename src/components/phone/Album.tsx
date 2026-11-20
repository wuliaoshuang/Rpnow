/**
 * 相册 — 小手机里的第二个应用。
 *
 * 手机里生成的所有图片都会留在这里：生图保存时打了 `source: 'phone'`，
 * 这里只列这些图，不分聊天、按时间倒序。点一张缩略图放大看（复用
 * PressableImage 的查看器），下面是当时用的提示词。
 */
import * as React from 'react';
import { ChevronLeft } from 'lucide-react';
import type { GeneratedImageMeta } from '@/core/media/store.js';
import { listMediaImages, mediaRef } from '@/core/media/store.js';
import { PressableImage } from '@/components/media/PressableImage.js';

export function Album({ onBack, active = true }: { onBack: () => void; active?: boolean }) {
  const [images, setImages] = React.useState<GeneratedImageMeta[] | null>(null);

  // 主屏幕切回来时重新读一遍：应用常驻挂载（切走不卸载），微信或朋友圈
  // 里新生的图要在这里出现，不能只在第一次挂载时读。
  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const all = await listMediaImages();
        if (!cancelled) setImages(all.filter((m) => m.source === 'phone'));
      } catch {
        if (!cancelled) setImages([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active]);

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 px-2 py-2.5">
        <button
          type="button"
          aria-label="返回主屏幕"
          onClick={onBack}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
        >
          <ChevronLeft className="size-6" />
        </button>
        <h2 className="text-base font-semibold">相册</h2>
        {images !== null && images.length > 0 && (
          <span className="ml-auto pr-2 text-xs text-neutral-400">{images.length} 张</span>
        )}
      </div>
      {images === null ? (
        <p className="px-4 py-8 text-center text-sm text-neutral-500">正在打开相册…</p>
      ) : images.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-neutral-500">
          还没有图片，在微信里生图就会出现在这里
        </p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <div className="grid grid-cols-3 gap-2">
            {images.map((img) => (
              <figure key={img.id} className="min-w-0">
                <PressableImage
                  src={mediaRef(img.id)}
                  alt={img.prompt || '手机生成的图片'}
                  className="aspect-square w-full rounded-lg object-cover"
                />
                <figcaption className="mt-1 line-clamp-2 text-[11px] leading-tight text-neutral-500">
                  {img.prompt || ''}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
