/**
 * ImageActionSheet — the long-press menu for a generated image.
 *
 * Three actions:
 *   - 删除：removes the image (the caller deletes the original file too);
 *   - 保存本地：downloads the image file to the device;
 *   - 提取 metadata：takes the generation record (prompt / model) and hands
 *     it to the caller, which fills it into the image-generation input box.
 *
 * 提取 metadata is only offered when the image has a generation record
 * (a `media:` reference saved by the studio); legacy data-URL pictures
 * carry no record.
 */
import React from 'react';
import { Download, FileText, Trash2, X } from 'lucide-react';
import { dataUrlToBlob, getMediaImage, getMediaMeta, mediaIdFromRef, type GeneratedImageMeta } from '@/core/media/store.js';
import { saveBlobToDevice } from '@/lib/utils.js';
import { toast } from '@/components/ui/toast.js';

export interface ExtractedImageMeta {
  prompt: string;
  model?: string;
}

export function ImageActionSheet({
  src,
  open,
  onOpenChange,
  onDelete,
  onExtractMetadata,
}: {
  src: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDelete: () => void;
  onExtractMetadata: (meta: ExtractedImageMeta) => void;
}) {
  const [meta, setMeta] = React.useState<GeneratedImageMeta | undefined>(undefined);

  React.useEffect(() => {
    if (!open) return;
    const id = mediaIdFromRef(src);
    if (!id) {
      setMeta(undefined);
      return;
    }
    let alive = true;
    void getMediaMeta(id).then((m) => {
      if (alive) setMeta(m);
    });
    return () => {
      alive = false;
    };
  }, [open, src]);

  async function saveLocal() {
    try {
      const id = mediaIdFromRef(src);
      let blob: Blob | undefined;
      let ext = 'png';
      if (id) {
        blob = await getMediaImage(id);
        const m = await getMediaMeta(id);
        if (m?.mime) ext = m.mime.split('/')[1] ?? 'png';
      } else if (src.startsWith('data:')) {
        blob = await dataUrlToBlob(src);
        const match = /^data:image\/([a-z]+);/.exec(src);
        if (match) ext = match[1] === 'jpeg' ? 'jpg' : match[1];
      }
      if (!blob) {
        toast.error('保存失败', '原图找不到了');
        return;
      }
      // 手机上 <a download> 点了常常没反应（文件根本没存下来），改走
      // 系统分享面板，让用户自己选存到相册还是文件里。
      const outcome = await saveBlobToDevice(blob, `rpnow-${id ?? Date.now()}.${ext}`);
      if (outcome === 'shared') toast.success('已打开分享，选个位置保存');
      else if (outcome === 'downloaded') toast.success('已保存到「下载」目录');
      onOpenChange(false);
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : String(err));
    }
  }

  function extract() {
    if (!meta?.prompt) {
      toast.error('没有可提取的 metadata', '这张图没有生成记录');
      return;
    }
    onExtractMetadata({ prompt: meta.prompt, model: meta.model });
    onOpenChange(false);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[85] flex items-end justify-center bg-black/50"
      role="dialog"
      aria-label="图片操作"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="w-full max-w-md rounded-t-2xl bg-[var(--rp-bg-elevated)] p-3 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[14px] font-medium">图片操作</span>
          <button
            type="button"
            aria-label="关闭"
            onClick={() => onOpenChange(false)}
            className="flex size-8 cursor-pointer items-center justify-center rounded-full text-[var(--rp-fg-muted)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={saveLocal}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] hover:bg-[var(--rp-bg-sunken)]"
        >
          <Download className="size-4 text-[var(--rp-fg-muted)]" aria-hidden="true" />
          保存本地
        </button>
        {meta?.prompt ? (
          <button
            type="button"
            onClick={extract}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] hover:bg-[var(--rp-bg-sunken)]"
          >
            <FileText className="size-4 text-[var(--rp-fg-muted)]" aria-hidden="true" />
            提取 metadata（填入生图输入框）
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
            onDelete();
          }}
          className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-left text-[14px] text-[var(--rp-danger)] hover:bg-[var(--rp-bg-sunken)]"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          删除
        </button>
      </div>
    </div>
  );
}
