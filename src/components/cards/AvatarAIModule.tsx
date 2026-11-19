/**
 * Avatar generation from an English tag prompt.
 *
 * The prompt lives in `extensions.avatar_prompt`. Generation goes through the
 * image service the user configured in 「设置 → 生图」 (`imageConnections`,
 * the same path the image studio uses): the first connection is used, square
 * output. A legacy `settings.imageGen` key is still honoured as a fallback
 * for accounts that configured the old auto-illustration panel. The reroll
 * swaps two adjacent tags so a near-miss can be re-rolled without rewriting
 * the whole prompt.
 */

import * as React from 'react';
import { Loader2, RefreshCw, Wand2 } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { useImage } from '@/hooks/useKernel.js';
import { fetchAsDataUrl, IMAGE_SIZES, pollJob, rerollTags, submitJob } from '@/core/image/nai.js';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { toast } from '@/components/ui/toast.js';

export function AvatarAIModule({
  prompt,
  onPromptChange,
  onGenerated,
}: {
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerated: (dataUrl: string) => void;
}) {
  const settings = useApp((s) => s.settings);
  const connections = useApp((s) => s.imageConnections);
  const imageService = useImage();
  const [busy, setBusy] = React.useState(false);
  const cfg = settings.imageGen;
  // 「设置 → 生图」配的是 imageConnections；旧版自动配图用的 imageGen.key
  // 只当后备。只读其中一套会让配了另一套的人点不动按钮。
  const hasConnection = Boolean(imageService && connections.length > 0);
  const ready = Boolean(prompt.trim() && (hasConnection || cfg.key));

  const generate = async (tags: string) => {
    if (!tags.trim()) return;
    setBusy(true);
    try {
      if (hasConnection) {
        const out = await imageService!.generate(connections[0].id, {
          prompt: tags,
          size: 'square',
        });
        const dataUrl = out[0]?.dataUrl;
        if (!dataUrl) throw new Error('服务没有返回图片');
        onGenerated(dataUrl);
      } else if (cfg.key) {
        const { width, height } = IMAGE_SIZES[cfg.size];
        const base = { token: cfg.key, tags, model: cfg.model, width, height };
        const submitted = await submitJob(base);
        if (!submitted.jobId) throw new Error(submitted.error ?? '没有拿到任务 id');
        const status = await pollJob(submitted.jobId, base);
        if (status.status !== 'done' || !status.imageUrl) {
          throw new Error(status.error ?? `任务状态：${status.status}`);
        }
        onGenerated(await fetchAsDataUrl(status.imageUrl));
      } else {
        return;
      }
      toast.success('头像已生成');
    } catch (err) {
      toast.error('头像生成失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label htmlFor="avatar-prompt">头像提示词（英文 Tag）</Label>
      <Input
        id="avatar-prompt"
        value={prompt}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder="1boy, white hair, cloak"
      />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || busy}
          onClick={() => void generate(prompt.trim())}
          title={hasConnection || cfg.key ? undefined : '请先在「设置 → 生图」配置生图服务'}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" aria-hidden="true" />}
          生成头像
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!ready || busy}
          onClick={() => {
            const next = rerollTags(prompt);
            if (!next.swapped) {
              toast.error('提示词太短，无法重绘', '至少需要两个 Tag 才能交换');
              return;
            }
            onPromptChange(next.tags);
            void generate(next.tags);
          }}
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> 换个画法
        </Button>
      </div>
      {!hasConnection && !cfg.key && (
        <p className="text-[10.5px] text-[var(--rp-fg-subtle)]">获取生图密钥，填在「设置 → 生图」。</p>
      )}
    </div>
  );
}
