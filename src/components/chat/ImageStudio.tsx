/**
 * Image studio.
 *
 * Prompt authoring + generation for the three supported backends. Key UX
 * decisions:
 *   - the description box only holds the 正文 (from 提取正文 or typed in);
 *     转写 Tag / AI 扩写 turns it into tags and fills the 正面提示词 box,
 *   - the final prompt sent to the model is 正面提示词 + 画师串 stacked
 *     together (falling back to the description when no positive prompt yet),
 *   - providers that need a proxy say so *before* the user burns a request,
 *   - results are kept as data URLs so they survive reloads and can be attached
 *     to a message or used as the card avatar.
 */

import * as React from 'react';
import { FileText, ImageIcon, Loader2, Sparkles, Wand2 } from 'lucide-react';
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
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState } from '@/components/ui/misc';
import { useImage, useLLM } from '@/hooks/useKernel.js';
import { artistsForStyle, DEFAULT_TAG_PROMPT, extractSceneText } from '@/core/image/nai.js';
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
  /** 正面提示词：转写 Tag 的结果填这里，可再改；出图时和画师串叠在一起发给模型。 */
  const [positive, setPositive] = React.useState('');
  /** 画师串（自定义）：出图时叠在正面提示词后面。 */
  const [artist, setArtist] = React.useState('');
  const [negative, setNegative] = React.useState('');
  const [size, setSize] = React.useState<'portrait' | 'square' | 'landscape'>('portrait');
  const [connectionId, setConnectionId] = React.useState<string>('');
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    if (!connectionId) setConnectionId(connections[0]?.id ?? '');
    // 画师串默认取设置里当前风格的画师串，可改；清空后下次打开会重新取。
    if (!artist) {
      const s = artistsForStyle(settings.imageGen.style, settings.imageGen.customArtists ?? '');
      if (s) setArtist(s);
    }
    if (prompt) return;
    // Seed a prompt from the card plus the most recent RP beat.
    const last = [...chat.messages].reverse().find((m) => m.role === 'assistant');
    const scene = (last?.content ?? card.data.scenario ?? '').replace(/<[^>]+>/g, ' ').slice(0, 260);
    setPrompt(
      [`${card.data.name}`, card.data.description.slice(0, 160), scene].filter(Boolean).join(', '),
    );
  }, [open, connectionId, connections, prompt, artist, card.data, chat.messages, settings.imageGen]);

  const adapter = imageService?.adapters().find((a) => a.key === connections.find((c) => c.id === connectionId)?.provider);

  // Assistant floors, newest first (floor number = position in the message list).
  const assistantFloors = React.useMemo(() => {
    const out: Array<{ floor: number; content: string }> = [];
    chat.messages.forEach((m, i) => {
      if (m.role === 'assistant') out.push({ floor: i + 1, content: m.content });
    });
    return out.reverse();
  }, [chat.messages]);

  /**
   * Pull the narrative text out of a reply floor into the scene description.
   * Preset markup, image markers and the （插图） placeholder are dropped, so
   * the box holds clean 正文 ready for 转写 Tag.
   */
  function extractFloor(floor: number, content: string) {
    const text = extractSceneText(content);
    if (!text) {
      toast.error(`第 ${floor} 楼没有能提取的正文`);
      return;
    }
    setPrompt(text);
    toast.success(`已提取第 ${floor} 楼正文`);
  }

  async function run() {
    if (!imageService) return;
    if (!connectionId) {
      toast.error('还没有配置图像服务', '请到「设置 → 图像」添加一个提供商');
      return;
    }
    // 出图的正面提示词 = 正面提示词 + 画师串叠在一起；正面提示词没填时用画面描述顶上。
    const base = positive.trim() || prompt.trim();
    const finalPrompt = [base, artist.trim()].filter(Boolean).join(', ');
    if (!finalPrompt) {
      toast.error('请先填画面描述或正面提示词');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await imageService.generate(connectionId, {
        prompt: finalPrompt,
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

  /**
   * Rewrite the scene description into image tags and put them in the
   * positive-prompt box (the description box itself keeps the 正文).
   *
   * NovelAI gets the tag-conversion prompt + model from 「设置 → 生图」里的
   * Tag 转写配置（默认跟随当前对话）；其它提供商沿用原来的通用扩写。
   */
  async function enhance() {
    const isNovel = connections.find((c) => c.id === connectionId)?.provider === 'novelai';
    const tagCfg = settings.imageGen;
    const tagConn = isNovel ? llmConnections.find((c) => c.id === (tagCfg.tagConnectionId || '')) : undefined;
    const conn =
      tagConn ??
      llmConnections.find((c) => c.id === (chat.connectionId ?? settings.defaultConnectionId)) ??
      llmConnections[0];
    if (!llm || !conn) {
      toast.error('需要先配置对话模型才能自动扩写提示词');
      return;
    }
    const model =
      (isNovel && tagCfg.tagModel) || (tagConn ? conn.defaultModel || '' : chat.model || conn.defaultModel || '');
    const systemPrompt = isNovel
      ? tagCfg.tagPrompt || DEFAULT_TAG_PROMPT
      : 'You are a prompt engineer for image models. Convert the user\'s scene description into ONE dense English image prompt: ' +
        'subject, appearance, clothing, pose, environment, lighting, camera, art style, quality tags. ' +
        'Output only the prompt, comma-separated, no preamble, no markdown.';
    setBusy(true);
    try {
      const res = await llm.complete(conn.id, {
        model,
        maxTokens: 400,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      });
      if (res.text.trim()) setPositive(res.text.trim().replace(/^["']|["']$/g, ''));
    } catch (err) {
      toast.error(isNovel ? '转写 Tag 失败' : '扩写失败', err instanceof Error ? err.message : String(err));
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
            <div className="flex items-center justify-between gap-1">
              <Label htmlFor="img-prompt">画面描述</Label>
              <div className="flex items-center">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" disabled={busy || assistantFloors.length === 0}>
                      <FileText className="size-3.5" aria-hidden="true" /> 提取正文
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="max-h-[50vh] w-[19rem] overflow-y-auto">
                    <DropdownMenuLabel>从哪条回复提取正文</DropdownMenuLabel>
                    {assistantFloors[0] && (
                      <DropdownMenuItem
                        onSelect={() => extractFloor(assistantFloors[0]!.floor, assistantFloors[0]!.content)}
                      >
                        最新一条回复
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuSeparator />
                    {assistantFloors.slice(0, 8).map((f) => (
                      <DropdownMenuItem key={f.floor} onSelect={() => extractFloor(f.floor, f.content)}>
                        <span className="min-w-0">
                          <span className="font-medium">第 {f.floor} 楼</span>
                          <span className="block truncate text-[11px] text-[var(--rp-fg-muted)]">
                            {extractSceneText(f.content).slice(0, 40) || '（无正文）'}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="sm" onClick={enhance} disabled={busy || !prompt.trim()}>
                  <Sparkles className="size-3.5" aria-hidden="true" />{' '}
                  {connections.find((c) => c.id === connectionId)?.provider === 'novelai' ? '转写 Tag' : 'AI 扩写'}
                </Button>
              </div>
            </div>
            <Textarea
              id="img-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={5}
              placeholder="例如：黄昏的钟塔顶层，机械少女在给齿轮上油，暖色逆光，电影感构图"
            />
            <p className="text-[11px] text-[var(--rp-fg-subtle)]">画面描述只放正文，转写 Tag 的结果填到下面的正面提示词。</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="img-positive">正面提示词</Label>
            <Textarea
              id="img-positive"
              value={positive}
              onChange={(e) => setPositive(e.target.value)}
              rows={4}
              placeholder="转写 Tag 的结果会填到这里，也可以直接写英文 Tag"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="img-artist">画师串（自定义）</Label>
            <Textarea
              id="img-artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              rows={2}
              placeholder="例如：1.1::tianlianghe::, 1.2::monju_rou::"
            />
            <p className="text-[11px] text-[var(--rp-fg-subtle)]">出图时和正面提示词叠在一起发给模型。</p>
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
          <Button onClick={run} disabled={busy || !(positive.trim() || prompt.trim())}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
            {busy ? '生成中…' : '生成'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
