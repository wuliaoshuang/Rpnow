/**
 * ImageViewer — full-screen image viewer with gesture zoom.
 *
 * Tap an image to open it; then:
 *   - pinch (two fingers) to zoom in/out, drag to pan while zoomed;
 *   - double-tap / double-click to toggle between fit and 2.5×;
 *   - mouse wheel zooms (desktop);
 *   - the + / − / reset buttons do the same without gestures.
 *
 * The transform is applied straight to the <img> element (no React
 * re-render per pointer move) so panning stays smooth on phones.
 */
import React from 'react';
import { X, ZoomIn, ZoomOut, Maximize } from 'lucide-react';
import { isMediaRef, resolveImageSrc } from '@/core/media/store.js';

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;

interface Point {
  x: number;
  y: number;
}

export function ImageViewer({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [url, setUrl] = React.useState<string | undefined>(isMediaRef(src) ? undefined : src);
  const [zoomPct, setZoomPct] = React.useState(100);
  const transform = React.useRef({ scale: 1, tx: 0, ty: 0 });
  const pointers = React.useRef(new Map<number, Point>());
  const pinchStart = React.useRef<{ dist: number; scale: number; mid: Point } | null>(null);

  const apply = React.useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const { scale, tx, ty } = transform.current;
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
  }, []);

  const reset = React.useCallback(() => {
    transform.current = { scale: 1, tx: 0, ty: 0 };
    setZoomPct(100);
    apply();
  }, [apply]);

  // Resolve a media: reference to a display URL; reset the zoom on open/src change.
  React.useEffect(() => {
    if (!open) return;
    reset();
    if (!isMediaRef(src)) {
      setUrl(src);
      return;
    }
    let alive = true;
    setUrl(undefined);
    void resolveImageSrc(src).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [open, src, reset]);

  const clamp = React.useCallback(() => {
    const { scale } = transform.current;
    transform.current.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    if (transform.current.scale === MIN_SCALE) {
      transform.current.tx = 0;
      transform.current.ty = 0;
    }
  }, []);

  const zoomAt = React.useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const img = imgRef.current;
      const container = containerRef.current;
      if (!img || !container) return;
      const rect = container.getBoundingClientRect();
      const cx = clientX - rect.left - rect.width / 2;
      const cy = clientY - rect.top - rect.height / 2;
      const t = transform.current;
      const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, t.scale * factor));
      // Keep the point under the cursor fixed while scaling.
      const k = nextScale / t.scale;
      t.tx = cx - (cx - t.tx) * k;
      t.ty = cy - (cy - t.ty) * k;
      t.scale = nextScale;
      if (nextScale === MIN_SCALE) {
        t.tx = 0;
        t.ty = 0;
      }
      apply();
      setZoomPct(Math.round(nextScale * 100));
    },
    [apply],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    // Capture so the gesture keeps coming here even if the finger slides
    // off the image. Capture can throw for a pointer the browser does not
    // track (e.g. a synthetic one); the gesture must still work then.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinchStart.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: transform.current.scale,
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      // One finger: pan, but only while zoomed in.
      if (transform.current.scale > MIN_SCALE) {
        transform.current.tx += e.clientX - prev.x;
        transform.current.ty += e.clientY - prev.y;
        apply();
      }
    } else if (pointers.current.size === 2 && pinchStart.current) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 0 && pinchStart.current.dist > 0) {
        const factor = dist / pinchStart.current.dist;
        const nextScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, pinchStart.current.scale * factor));
        const container = containerRef.current;
        if (container) {
          const rect = container.getBoundingClientRect();
          const mid = pinchStart.current.mid;
          const cx = mid.x - rect.left - rect.width / 2;
          const cy = mid.y - rect.top - rect.height / 2;
          const t = transform.current;
          const k = nextScale / t.scale;
          t.tx = cx - (cx - t.tx) * k;
          t.ty = cy - (cy - t.ty) * k;
          t.scale = nextScale;
          if (nextScale === MIN_SCALE) {
            t.tx = 0;
            t.ty = 0;
          }
        }
        apply();
        setZoomPct(Math.round(nextScale * 100));
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    if (pointers.current.size === 0) {
      clamp();
      apply();
      setZoomPct(Math.round(transform.current.scale * 100));
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    // Double-tap / double-click toggles between fit and 2.5× at the tap point.
    // The browser's dblclick already means "two quick taps", so toggle here.
    const target = transform.current.scale > 1 ? 1 : DOUBLE_TAP_SCALE;
    zoomAt(e.clientX, e.clientY, target / transform.current.scale);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/95"
      role="dialog"
      aria-label={`查看图片：${alt}`}
      onClick={() => onOpenChange(false)}
    >
      <div className="flex items-center justify-between px-3 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] text-white">
        <span className="text-[13px] text-white/80">{zoomPct}% · 捏合缩放，双击放大</span>
        <button
          type="button"
          aria-label="关闭查看器"
          onClick={(e) => {
            e.stopPropagation();
            onOpenChange(false);
          }}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full bg-white/15"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: 'none' }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onWheel={onWheel}
      >
        {url ? (
          <img
            ref={imgRef}
            src={url}
            alt={alt}
            className="max-h-full max-w-full object-contain"
            draggable={false}
            style={{ transformOrigin: 'center center' }}
          />
        ) : (
          <span className="text-[13px] text-white/60">图片找不到了（可能已被删除）</span>
        )}
      </div>
      <div className="flex items-center justify-center gap-3 pb-[calc(env(safe-area-inset-bottom,0px)+1.25rem)] pt-1 text-white">
        <button
          type="button"
          aria-label="缩小"
          onClick={(e) => {
            e.stopPropagation();
            zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1 / 1.4);
          }}
          className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/15"
        >
          <ZoomOut className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="恢复原始大小"
          onClick={(e) => {
            e.stopPropagation();
            reset();
          }}
          className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/15"
        >
          <Maximize className="size-5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="放大"
          onClick={(e) => {
            e.stopPropagation();
            zoomAt(window.innerWidth / 2, window.innerHeight / 2, 1.4);
          }}
          className="flex size-10 cursor-pointer items-center justify-center rounded-full bg-white/15"
        >
          <ZoomIn className="size-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
