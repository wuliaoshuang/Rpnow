/**
 * <MediaImage> — renders one stored image source.
 *
 * `src` is whatever `message.images` holds: a legacy data URL / http URL
 * (rendered directly) or a `media:<id>` reference (resolved to an object
 * URL for the Blob in the media store). When the Blob is gone (deleted),
 * the image renders nothing instead of a broken icon.
 */
import React from 'react';
import { isMediaRef, resolveImageSrc } from './store.js';

export function MediaImage({
  src,
  alt,
  className,
  loading = 'lazy',
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  onError?: React.ReactEventHandler<HTMLImageElement>;
}) {
  const [url, setUrl] = React.useState<string | undefined>(isMediaRef(src) ? undefined : src);
  const [gone, setGone] = React.useState(false);

  React.useEffect(() => {
    if (!isMediaRef(src)) {
      setUrl(src);
      setGone(false);
      return;
    }
    let alive = true;
    setUrl(undefined);
    setGone(false);
    void resolveImageSrc(src).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setGone(true);
    });
    return () => {
      alive = false;
    };
  }, [src]);

  if (gone || !url) return null;
  return <img src={url} alt={alt} className={className} loading={loading} onError={onError} />;
}
