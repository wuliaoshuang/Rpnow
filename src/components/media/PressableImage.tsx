/**
 * PressableImage — one generated / attached picture with gestures.
 *
 *   - Tap (click) → open the full-screen viewer (pinch zoom, pan,
 *     double-tap, wheel).
 *   - Long-press (500ms) → the action sheet: 保存本地 / 提取 metadata /
 *     删除.
 *
 * The parent supplies the actions; this component only owns the viewer and
 * the sheet state, and makes sure a long-press never also opens the viewer.
 */
import React from 'react';
import { MediaImage } from '@/core/media/MediaImage.js';
import { ImageViewer } from './ImageViewer.js';
import { ImageActionSheet, type ExtractedImageMeta } from './ImageActionSheet.js';
import { useLongPress } from './useLongPress.js';

export function PressableImage({
  src,
  alt,
  className,
  onDelete,
  onExtractMetadata,
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  onDelete?: () => void;
  onExtractMetadata?: (meta: ExtractedImageMeta) => void;
  onError?: React.ReactEventHandler<HTMLImageElement>;
}) {
  const [viewerOpen, setViewerOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const hasMenu = Boolean(onDelete || onExtractMetadata);
  const { handlers, wasLongPress } = useLongPress(() => {
    if (hasMenu) setMenuOpen(true);
  });

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${alt}，点开放大，长按弹出菜单`}
        className="cursor-pointer"
        {...(hasMenu ? handlers : {})}
        onClick={() => {
          if (wasLongPress.current) return;
          setViewerOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setViewerOpen(true);
          }
        }}
      >
        <MediaImage src={src} alt={alt} className={className} onError={onError} />
      </div>
      <ImageViewer src={src} alt={alt} open={viewerOpen} onOpenChange={setViewerOpen} />
      {hasMenu ? (
        <ImageActionSheet
          src={src}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onDelete={() => onDelete?.()}
          onExtractMetadata={(meta) => onExtractMetadata?.(meta)}
        />
      ) : null}
    </>
  );
}
