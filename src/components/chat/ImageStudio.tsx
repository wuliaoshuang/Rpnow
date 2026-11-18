/**
 * Image studio.
 *
 * Prompt authoring + generation for the three supported backends. Key UX
 * decisions:
 *   - the prompt is pre-filled from the character and the last exchange, because
 *     "write a whole image prompt" is the hardest part for users,
 *   - providers that need a proxy say so *before* the user burns a request,
 *   - results are kept as data URLs so they survive reloads and can be attached
 *     to a message or used as the card avatar.
 */

import * as React from 'react';
import { ImageIcon, Loader2, Sparkles, Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/input';
import { Badge, EmptyState } from '@/components/ui/misc';
import { useImage, useLLM } from '@/hooks/useKernel.js';
import { useApp } from '@/state/store.js';
import type { RPCard } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';
import { toast } from '@/components/ui/toast.js';

export interface ImageStudioProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  card: RPCard;
  chat: RPChat;
  onAttach: (dataUrl: string) => void;
  onUseAsAvatar: (dataUrl: string) => void;
}

export function ImageStudio({ open, onOpenChange, card, chat, onAttach, onUseAsAvatar }: ImageStudioProps) {
  const imageService = useImage();
  const llm = useLLM();
  const connections = useApp((s) => s.imageConnections);
  const llmConnections = useApp((s) => s.llmConnections);
  const settings = useApp((s) => s.settings);

  const [prompt, setPrompt] = React.useState('');
  const [negative, setNegative] = React.useState('');
  const [size, setSize] = React.useState<'portrait' | 'square' | 'landscape'>('portrait');
  const [connectionId, setConnectionId] = React.useState<string>('');
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (!connectionId) setConnectionId(connections[0]?.id ?? '');
    if (prompt) return;
    // Seed a prompt from the card plus the most recent RP beat.
    const last = [...chat.messages].reverse().find((m) => m.role === 'assistant');
    const scene = (last?.content ?? card.data.scenario ?? '').replace(/<[^>]+>/g, ' ').slice(0, 260);
    setPrompt(
      [`${card.data.name}`, card.data.description.slice(0, 160), scene].filter(Boolean).join(', '),
    );
  }, [open, connectionId, connections, prompt, card.data, chat.messages]);

  const adapter = imageService?.adapters().find((a) => a.key === connections.find((c) => c.id === connectionId)?.provider);

  async function run() {
    if (!imageService) return;
    if (!connectionId) {
      toast.error('还没有配置图像服务', '请到「设置 → 图像」添加一个提供商');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await imageService.generate(connectionId, {
        prompt,
        negativePrompt: negative || undefined,
        size,
        watermark: false,
      });
      setResults((prev) => [...out.map((r) => r.dataUrl), ...prev]);
      if (!out.length) setError('服务没有返回图片');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  /** Use the chat model to rewrite a short scene description into a dense prompt. */
  async function enhance() {
    const conn = llmConnections.find((c) => c.id === (chat.connectionId ?? settings.defaultConnectionId)) ?? llmConnections[0];
    if (!llm || !conn) {
      toast.error('需要先配置对话模型才能自动扩写提示词');
      return;
    }
    setBusy(true);
    try {
      const res = await llm.complete(conn.id, {
        model: chat.model || conn.defaultModel || '',
        maxTokens: 400,
        temperature: 0.7,
        messages: [
          {
            role: 'system',
            content:
              'You are a prompt engineer for image models. Convert the user\'s scene description into ONE dense English image prompt: ' +
              'subject, appearance, clothing, pose, environment, lighting, camera, art style, quality tags. ' +
              'Output only the prompt, comma-separated, no preamble, no markdown.',
          },
          { role: 'user', content: prompt },
        ],
      });
      if (res.text.trim()) setPrompt(res.text.trim().replace(/^["']|["']$/g, ''));
    } catch (err) {
      toast.error('扩写失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>生成场景图片</DialogTitle>
          <DialogDescription>
            支持 GPT Image、Seedream（火山方舟）、NovelAI。未配置时请到「设置 → 图像」添加。
          </DialogDescription>
        </DialogHeader>

        <div className="rp-scroll max-h-[62vh] space-y-3 overflow-y-auto px-5 pb-2">
          {/* Connection picker */}
          <div className="space-y-1.5">
            <Label htmlFor="img-conn">图像服务</Label>
            {connections.length === 0 ? (
              <p className="rounded-md border border-dashed border-[var(--rp-border)] p-2.5 text-[12px] text-[var(--rp-fg-muted)]">
                还没有图像服务。到「设置 → 图像」里添加 GPT Image / Seedream / NovelAI。
              </p>
            ) : (
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger id="img-conn">
                  <SelectValue placeholder="选择一个图像服务" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}（{c.provider}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {adapter && !adapter.browserCors && (
              <p className="text-[11px] text-[var(--rp-warn)]">
                ⚠ {adapter.label} 不支持浏览器直连，需要在「设置 → 网络」里启用代理。
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="img-prompt">画面描述</Label>
              <Button variant="ghost" size="sm" onClick={enhance} disabled={busy || !prompt.trim()}>
                <Sparkles className="size-3.5" aria-hidden="true" /> AI 扩写
              </Button>
            </div>
            <Textarea
              id="img-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="例如：黄昏的钟塔顶层，机械少女在给齿轮上油，暖色逆光，电影感构图"
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="img-neg">负面提示词</Label>
              <Input
                id="img-neg"
                value={negative}
                onChange={(e) => setNegative(e.target.value)}
                placeholder="lowres, bad anatomy, watermark"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="img-size">画幅</Label>
              <Select value={size} onValueChange={(v) => setSize(v as typeof size)}>
                <SelectTrigger id="img-size">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="portrait">竖版 2:3</SelectItem>
                  <SelectItem value="square">方形 1:1</SelectItem>
                  <SelectItem value="landscape">横版 3:2</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && (
            <p className="rounded-md border border-[var(--rp-danger)]/40 bg-[var(--rp-danger)]/10 p-2.5 text-[12px] text-[var(--rp-danger)]">
              {error}
            </p>
          )}

          {results.length === 0 ? (
            <EmptyState icon={<ImageIcon className="size-5" />} title="还没有生成结果" description="填好描述后点击下方按钮生成。" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {results.map((src, i) => (
                <figure key={i} className="group relative overflow-hidden rounded-lg border border-[var(--rp-border)]">
                  <img src={src} alt={`生成结果 ${i + 1}`} className="w-full object-cover" loading="lazy" />
                  <figcaption className="absolute inset-x-0 bottom-0 flex gap-1 bg-black/60 p-1.5 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button size="sm" variant="secondary" className="h-7 flex-1 text-[11px]" onClick={() => onAttach(src)}>
                      加入对话
                    </Button>
                    <Button size="sm" variant="secondary" className="h-7 flex-1 text-[11px]" onClick={() => onUseAsAvatar(src)}>
                      设为头像
                    </Button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {results.length > 0 && <Badge variant="outline">{results.length} 张结果</Badge>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button onClick={run} disabled={busy || !prompt.trim()}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
            {busy ? '生成中…' : '生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
