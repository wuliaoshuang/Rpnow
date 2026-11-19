/**
 * Inline image generation settings (RP-Hub's auto-image feature).
 *
 * The model writes `image###English,Tag###` markers in its reply; the app turns
 * each into a real picture through the NovelAI-style jobs endpoint.
 */

import * as React from 'react';
import { ImageIcon, KeyRound } from 'lucide-react';
import { IMAGE_STYLES, isV5, fetchQuota } from '@/core/image/nai.js';
import { Badge } from '@/components/ui/misc.js';
import { useApp } from '@/state/store.js';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Switch } from '@/components/ui/input';
import { SecretInput } from '@/components/ui/SecretInput.js';
import { toast } from '@/components/ui/toast.js';

const MODELS = [
  { value: 'nai-diffusion-4-5-full', label: 'V4.5 完整版' },
  { value: 'nai-diffusion-5-full', label: 'V5 完整版' },
];

export function ImageGenSettingsPanel() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const cfg = settings.imageGen;
  const patch = (p: Partial<typeof cfg>) => setSettings({ imageGen: { ...cfg, ...p } });
  const [quota, setQuota] = React.useState<{ value: number } | null>(null);
  /** N08: last image-service test latency in ms (null = not tested yet). */
  const [testLatencyMs, setTestLatencyMs] = React.useState<number | null>(null);
  const [testing, setTesting] = React.useState(false);
  // Key already queried once — avoids re-querying on every blur.
  const queriedKey = React.useRef('');

  const queryQuota = async (opts?: { quiet?: boolean }) => {
    if (!cfg.key) return;
    setQuota(null);
    const q = await fetchQuota(cfg.key);
    if (q?.value === undefined) {
      if (!opts?.quiet) toast.info('该服务没有返回配额');
      return;
    }
    queriedKey.current = cfg.key;
    setQuota({ value: q.value });
    if (!opts?.quiet) toast.success('生图剩余次数', String(q.value));
  };

  /** N08: test the image service and report latency + remaining quota. */
  const testImageService = async () => {
    if (!cfg.key) {
      toast.error('请先填写生图密钥');
      return;
    }
    setTesting(true);
    const startedAt = performance.now();
    try {
      const q = await fetchQuota(cfg.key);
      const latencyMs = Math.round(performance.now() - startedAt);
      setTestLatencyMs(latencyMs);
      if (q?.value !== undefined) {
        queriedKey.current = cfg.key;
        setQuota({ value: q.value });
        toast.success('生图服务正常', `延迟 ${latencyMs} 毫秒 · 剩余 ${q.value} 次`);
      } else {
        toast.success('生图服务正常', `延迟 ${latencyMs} 毫秒（该服务没有返回配额）`);
      }
    } catch (err) {
      const latencyMs = Math.round(performance.now() - startedAt);
      setTestLatencyMs(latencyMs);
      toast.error('生图服务连接失败', `${err instanceof Error ? err.message : String(err)}（${latencyMs} 毫秒后失败）`);
    } finally {
      setTesting(false);
    }
  };

  // I09: query once after the key is entered (blur), so the quota shows
  // without the user hunting for the button; failures stay silent here.
  const queryQuotaOnBlur = () => {
    if (cfg.key && queriedKey.current !== cfg.key) void queryQuota({ quiet: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 rounded-lg border border-[var(--rp-border)] p-3">
        <div className="min-w-0 flex-1">
          <Label htmlFor="img-enabled" className="cursor-pointer">
            自动生图
          </Label>
          <p className="mt-0.5 text-[11px] leading-snug text-[var(--rp-fg-muted)]">
            回复里出现 <code className="rounded bg-[var(--rp-bg-sunken)] px-1">image###英文Tag###</code> 时自动生成插图，图片附在消息上，不在正文里重复显示。
          </p>
        </div>
        <Switch id="img-enabled" checked={cfg.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
      </div>

      {cfg.enabled && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="img-key" className="flex items-center gap-1.5">
              <KeyRound className="size-3.5" aria-hidden="true" /> 生图密钥
            </Label>
            <SecretInput
              id="img-key"
              value={cfg.key}
              onChange={(v) => patch({ key: v })}
              onBlur={queryQuotaOnBlur}
              placeholder="STA1N / NAI 密钥"
              ariaLabel="生图密钥"
            />
            <p className="text-[11px] text-[var(--rp-fg-subtle)]">
              需要密钥才会注入生图提示词，否则模型不会输出图片标记。
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => void queryQuota()}>
                查询剩余次数
              </Button>
              <Button size="sm" variant="outline" onClick={() => void testImageService()} disabled={testing}>
                测试连接
              </Button>
              {quota && <Badge variant="outline">{quota.value} 次</Badge>}
              {testLatencyMs !== null && (
                <span className="text-[11px] tabular-nums text-[var(--rp-fg-muted)]">延迟 {testLatencyMs} 毫秒</span>
              )}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="img-model">模型</Label>
              <Select
                value={cfg.model}
                onValueChange={(v) => {
                  const next: Partial<typeof cfg> = { model: v };
                  const notes: string[] = [];
                  if (isV5(v)) {
                    // V5 dropped the r18 / lolita25d / anime styles; fall back
                    // to the neutral vertical style rather than shipping tags
                    // V5 rejects.
                    if (['r18', 'lolita25d', 'anime'].includes(cfg.style)) {
                      next.style = 'vertical';
                      notes.push('该风格 V5 不支持，已切回韩漫小清新风');
                    }
                    // I10: V5 also resets the direction to vertical.
                    if (cfg.size !== 'vertical') {
                      next.size = 'vertical';
                      notes.push('方向已切回竖图');
                    }
                  }
                  if (notes.length) toast.info(`V5：${notes.join('；')}`);
                  patch(next);
                }}
              >
                <SelectTrigger id="img-model">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MODELS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="img-size">尺寸</Label>
              <Select
                value={cfg.size}
                onValueChange={(v) => patch({ size: v as typeof cfg.size })}
              >
                <SelectTrigger id="img-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vertical">竖图 832×1216</SelectItem>
                  <SelectItem value="horizontal">横图 1216×832</SelectItem>
                  <SelectItem value="square">方图 1024×1024</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="img-style">风格（画师串）</Label>
            <Select value={cfg.style} onValueChange={(v) => patch({ style: v })}>
              <SelectTrigger id="img-style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {IMAGE_STYLES.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {cfg.style === 'custom' && (
              <Input
                value={cfg.customArtists}
                onChange={(e) => patch({ customArtists: e.target.value })}
                placeholder="自定义画师串，例如：artist:xxx, 1.2::yyy::"
                aria-label="自定义画师串"
              />
            )}
            <p className="text-[10.5px] text-[var(--rp-fg-subtle)]">
              V5（nai-diffusion-5-full）不支持 r18 / lolita25d / anime。
            </p>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>每次回复插图数量</Label>
              <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">{cfg.count} 张</span>
            </div>
            <Slider
              value={[cfg.count]}
              min={2}
              max={8}
              step={1}
              onValueChange={([v]) => patch({ count: v })}
              aria-label="每次回复插图数量"
            />
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-[12px]">
            <Switch checked={cfg.autoGenerate} onCheckedChange={(v) => patch({ autoGenerate: v })} />
            回复结束后自动生成
          </label>

          <div className="rounded-lg border border-dashed border-[var(--rp-border)] p-3 text-[11.5px] leading-relaxed text-[var(--rp-fg-muted)]">
            <p className="flex items-center gap-1.5 font-medium text-[var(--rp-fg)]">
              <ImageIcon className="size-3.5" aria-hidden="true" /> 使用说明
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>Tag 必须是英文，用逗号分隔；太短的提示词无法重新生成。</li>
              <li>图片按模型给的顺序分散在正文段落之间。</li>
              <li>悬停图片上的按钮可随机交换两个相邻 Tag 重新生成。</li>
              <li>V5 模型不支持 r18 / lolita25d / anime 风格。</li>
            </ul>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => toast.success('已保存', '下次回复时生效')}
          >
            保存设置
          </Button>
        </>
      )}
    </div>
  );
}
