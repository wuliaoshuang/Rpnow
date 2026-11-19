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
import { Dices, FileText, ImageIcon, Loader2, Sparkles, Wand2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/input';
import { Badge, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState } from '@/components/ui/misc';
import { useImage, useLLM } from '@/hooks/useKernel.js';
import { DEFAULT_TAG_PROMPT, extractSceneText } from '@/core/image/nai.js';
import { loadStudioDraft, saveStudioDraft } from '@/core/image/studioDraft.js';
import { estimateAnlasCost, maxNSamplesForArea, NAI_NOISE_SCHEDULES, NAI_SAMPLER_LABELS, NAI_SAMPLERS, NAI_SIZE_TIER_LABELS, NAI_UC_PRESETS, naiSizeFor, opusFreeStatus, SIZE_MAP, type NAIImageSizeTier } from '@/core/image/types.js';
import { buildTagInjection } from '@/core/image/tagContext.js';
import { describeEmptyTagResult, TAG_CONVERT_MAX_TOKENS } from '@/core/image/tagFailure.js';
import { BUILTIN_PRESETS } from '@/core/defaults/presets.js';
import { dataUrlToBlob, deleteMediaImage, getMediaImage, listMediaImages, mediaIdFromRef, mediaRef, saveMediaImage, type GeneratedImageMeta } from '@/core/media/store.js';
import { PressableImage } from '@/components/media/PressableImage.js';
import type { ExtractedImageMeta } from '@/components/media/ImageActionSheet.js';
import { confirmAction } from '@/components/ui/confirm.js';
import { formatMessageTime } from '@/lib/utils.js';
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

/**
 * A slider + typeable number, the way NovelAI's own panel does it: drag
 * the bar for a quick change, tap the number to type an exact value.
 * `value` undefined means "use the provider default" (shown as placeholder).
 */
function ParamSlider({
  id, label, min, max, step, value, placeholder, onChange, hint, className,
}: {
  id: string;
  label: string;
  min: number;
  max: number;
  step: number;
  value: number | undefined;
  placeholder: string;
  onChange: (v: number | undefined) => void;
  hint?: string;
  className?: string;
}) {
  const shown = value ?? Number(placeholder);
  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          id={`${id}-slider`}
          type="range"
          aria-label={`${label}（拖动条）`}
          min={min}
          max={max}
          step={step}
          value={shown}
          onChange={(e) => onChange(Number(e.target.value))}
          className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[var(--rp-accent)]"
        />
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={step}
          value={value ?? ''}
          onChange={(e) => {
            const v = e.target.value === '' ? undefined : Math.min(max, Math.max(min, Number(e.target.value) || 0));
            onChange(v);
          }}
          placeholder={placeholder}
          className="w-16 shrink-0 text-right"
        />
      </div>
      {hint ? <p className="text-[11px] text-[var(--rp-fg-subtle)]">{hint}</p> : null}
    </div>
  );
}

export function ImageStudio({ open, onOpenChange, card, chat, onAttach, onUseAsAvatar }: ImageStudioProps) {
  const imageService = useImage();
  const llm = useLLM();
  const connections = useApp((s) => s.imageConnections);
  const llmConnections = useApp((s) => s.llmConnections);
  const presets = useApp((s) => s.presets);
  const lorebooks = useApp((s) => s.lorebooks);
  const persons = useApp((s) => s.personas);
  const settings = useApp((s) => s.settings);
  const imageStudioPrefill = useApp((s) => s.imageStudioPrefill);

  const [prompt, setPrompt] = React.useState('');
  /** 正面提示词：转写 Tag 的结果填这里，可再改；出图时和画师串叠在一起发给模型。 */
  const [positive, setPositive] = React.useState('');
  /** 画师串（自定义）：出图时叠在正面提示词后面。不默认填写，由用户自己填。 */
  const [artist, setArtist] = React.useState('');
  const [negative, setNegative] = React.useState('');
  const [size, setSize] = React.useState<'portrait' | 'square' | 'landscape'>('portrait');
  const [connectionId, setConnectionId] = React.useState<string>('');
  /** 生图模型：跟着当前图像服务走，可自由选；空着就用这个连接的默认模型。 */
  const [model, setModel] = React.useState('');
  /** 生图参数（NovelAI）：步数 / CFG / 采样器 / 种子 / 噪声计划 / 张数 /
   * 负面预设 / CFG Rescale / Decrisper / 质量开关。空着用默认值。 */
  const [steps, setSteps] = React.useState<number | undefined>(undefined);
  const [genScale, setGenScale] = React.useState<number | undefined>(undefined);
  const [sampler, setSampler] = React.useState<string | undefined>(undefined);
  const [seed, setSeed] = React.useState<number | undefined>(undefined);
  const [noiseSchedule, setNoiseSchedule] = React.useState<string | undefined>(undefined);
  const [nSamples, setNSamples] = React.useState<number | undefined>(undefined);
  const [ucPreset, setUcPreset] = React.useState<number | undefined>(undefined);
  const [cfgRescale, setCfgRescale] = React.useState<number | undefined>(undefined);
  const [variety, setVariety] = React.useState<boolean | undefined>(undefined);
  const [transparentBg, setTransparentBg] = React.useState<boolean | undefined>(undefined);
  const [qualityToggle, setQualityToggle] = React.useState<boolean | undefined>(undefined);
  /** NovelAI 尺寸档位（小 / 标准 / 大 / 壁纸），默认标准。 */
  const [sizeTier, setSizeTier] = React.useState<NAIImageSizeTier | undefined>(undefined);
  const [busy, setBusy] = React.useState(false);
  const [results, setResults] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  /** 打开时只恢复/预填一次；用户清空后不再自动填回来，否则框就没法自由编辑了。 */
  const seededRef = React.useRef(false);
  /** 恢复草稿的那一次渲染不存（这时 state 还是旧值，存了会把草稿冲掉）。 */
  const skipPersistRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      seededRef.current = false;
      return;
    }
    // 长按图片“提取 metadata”时带的预填：把那张图的提示词（和模型）填进
    // 生图输入框，只用一次，用完就清掉。
    if (imageStudioPrefill) {
      if (imageStudioPrefill.positive) setPositive(imageStudioPrefill.positive);
      if (imageStudioPrefill.model) setModel(imageStudioPrefill.model);
      useApp.getState().setImageStudioPrefill(null);
    }
    if (!connectionId) setConnectionId(connections[0]?.id ?? '');
    if (seededRef.current) return;
    seededRef.current = true;
    skipPersistRef.current = true;
    // 恢复这个对话的输入状态（持久化过的）；没有存过的，才从卡片和最近
    // 回复里预填一次画面描述。画师串不默认填写，由用户自己填。
    const draft = loadStudioDraft(chat.id);
    if (draft) {
      setPrompt(draft.prompt);
      setPositive(draft.positive);
      setArtist(draft.artist);
      setNegative(draft.negative);
      setSize(draft.size);
      if (draft.connectionId) setConnectionId(draft.connectionId);
      if (draft.model) setModel(draft.model);
      setSteps(draft.steps);
      setGenScale(draft.scale);
      setSampler(draft.sampler);
      setSeed(draft.seed);
      setNoiseSchedule(draft.noiseSchedule);
      setNSamples(draft.nSamples);
      setUcPreset(draft.ucPreset);
      setCfgRescale(draft.cfgRescale);
      setVariety(draft.variety);
      setTransparentBg(draft.transparentBg);
      setQualityToggle(draft.qualityToggle);
      setSizeTier(draft.sizeTier);
      return;
    }
    if (prompt) return;
    // Seed a prompt from the card plus the most recent RP beat.
    const last = [...chat.messages].reverse().find((m) => m.role === 'assistant');
    const scene = (last?.content ?? card.data.scenario ?? '').replace(/<[^>]+>/g, ' ').slice(0, 260);
    setPrompt(
      [`${card.data.name}`, card.data.description.slice(0, 160), scene].filter(Boolean).join(', '),
    );
  }, [open, connectionId, connections, prompt, artist, card.data, chat.messages, settings.imageGen, imageStudioPrefill]);

  // 所有输入的状态都要保留、持久化：每改一次就存一份（按对话分开存），
  // 关掉工作室、刷新页面再打开，输入都还在。
  React.useEffect(() => {
    if (!open || !seededRef.current) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    saveStudioDraft(chat.id, {
      prompt,
      positive,
      artist,
      negative,
      size,
      connectionId,
      model,
      steps,
      scale: genScale,
      sampler,
      seed,
      noiseSchedule,
      nSamples,
      ucPreset,
      cfgRescale,
      variety,
      transparentBg,
      qualityToggle,
      sizeTier,
    });
  }, [open, chat.id, prompt, positive, artist, negative, size, connectionId, model, steps, genScale, sampler, seed, noiseSchedule, nSamples, ucPreset, cfgRescale, variety, transparentBg, qualityToggle, sizeTier]);

  const adapter = imageService?.adapters().find((a) => a.key === connections.find((c) => c.id === connectionId)?.provider);

  // 生图模型选项：跟着当前图像服务走；选了哪个就用哪个，空着用连接的默认模型。
  const selectedConn = connections.find((c) => c.id === connectionId);
  const modelOptions = adapter?.knownModels ?? (selectedConn?.defaultModel ? [selectedConn.defaultModel] : []);
  const effectiveModel = model || selectedConn?.defaultModel || modelOptions[0] || '';
  /** V5 强制用 karras 噪声计划，噪声计划那一栏要锁掉。 */
  const isV5Model = effectiveModel.startsWith('nai-diffusion-5');
  /** NovelAI 时预估这张图要多少 Anlas，点生成之前就让用户看到。
   * 免费规则是像素面积（宽×高 ≤ 1,048,576 px），不是“两边 ≤1024”：
   * 832×1216 也在免费额度内。V4.5 免费不限量，V5 从 Opus 额度电池里扣。
   * 尺寸按档位 × 画幅算（官网 Small / Normal / Large / Wallpaper）。 */
  const isNovelConn = selectedConn?.provider === 'novelai';
  const naiSize: [number, number] = isNovelConn
    ? naiSizeFor(sizeTier ?? 'normal', size)
    : SIZE_MAP[size].nai;
  const estSteps = steps ?? 23;
  const estNSamples = nSamples ?? 1;
  const estFree = isNovelConn
    ? opusFreeStatus({ model: effectiveModel, width: naiSize[0], height: naiSize[1], steps: estSteps, nSamples: estNSamples })
    : null;
  const estAnlas = isNovelConn
    ? estimateAnlasCost({ width: naiSize[0], height: naiSize[1], steps: estSteps, model: effectiveModel, nSamples: estNSamples, opusFree: estFree !== null })
    : null;
  /** 当前尺寸允许的最多张数（官网按像素面积限：小图 6–8 张，普通图 4 张）。 */
  const maxNSamples = maxNSamplesForArea(naiSize[0] * naiSize[1]);

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
    // 画面描述只放正文，绝不进生图提示词。出图的正面提示词 = 正面提示词
    // + 画师串叠在一起；正面提示词是空的就拦住，先去转写 Tag 或手写 Tag。
    const base = positive.trim();
    if (!base) {
      toast.error('正面提示词是空的', '先点「转写 Tag」把画面描述转成 Tag，或直接在正面提示词里写英文 Tag');
      return;
    }
    const finalPrompt = [base, artist.trim()].filter(Boolean).join(', ');
    setBusy(true);
    setError(null);
    try {
      const out = await imageService.generate(connectionId, {
        prompt: finalPrompt,
        negativePrompt: negative || undefined,
        size,
        // NovelAI 的实际像素由档位 × 画幅决定，直接传宽高，省得适配器再猜。
        ...(isNovelConn ? { width: naiSize[0], height: naiSize[1] } : {}),
        model: effectiveModel || undefined,
        steps,
        scale: genScale,
        sampler,
        seed,
        noiseSchedule,
        nSamples,
        ucPreset,
        cfgRescale,
        variety,
        transparentBg,
        qualityToggle,
        watermark: false,
      });
      // 生成的图立刻存进媒体库（Blob 存 IndexedDB，消息里只留 media: 引用，
      // 不占对话的内存），就算关掉窗口不加入对话也不会丢。
      const refs: string[] = [];
      for (const r of out) {
        try {
          const blob = await dataUrlToBlob(r.dataUrl);
          const saved = await saveMediaImage(blob, {
            chatId: chat.id,
            cardId: card.id,
            prompt: finalPrompt,
            provider: r.provider,
            model: r.model,
          });
          refs.push(mediaRef(saved.id));
        } catch {
          // 媒体库存不下时退回 data URL，图还能用，只是占内存。
          refs.push(r.dataUrl);
        }
      }
      setResults((prev) => [...refs, ...prev]);
      if (!out.length) setError('生成失败：服务没有返回图片');
    } catch (err) {
      // 生成失败要把失败的原因填进去：服务商返回的状态和报错原文都在这里。
      setError(`生成失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 从本次结果里删掉一张图：列表里去掉，原文件（媒体库里的 Blob）也一起删掉。
   */
  async function deleteResult(src: string) {
    const ok = await confirmAction({
      title: '删除这张图？',
      description: '原文件也会一起删掉，删了就找不回来了。',
      confirmText: '删除',
      destructive: true,
    });
    if (!ok) return;
    setResults((prev) => prev.filter((r) => r !== src));
    const id = mediaIdFromRef(src);
    if (id) await deleteMediaImage(id);
    toast.success('已删除');
  }

  /** 把一张生成图设为角色头像。头像存在角色卡里，用 data URL（单张小图）。 */
  async function useAsAvatar(src: string) {
    const id = mediaIdFromRef(src);
    if (!id) {
      onUseAsAvatar(src);
      return;
    }
    const blob = await getMediaImage(id);
    if (!blob) {
      toast.error('头像设置失败', '原图找不到了');
      return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(blob);
    });
    onUseAsAvatar(dataUrl);
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
    // 转写 Tag 时注入和聊天一样的世界书 + 预设（正文是画面描述里的内容，
    // 由用户指定，不进注入）。其它提供商的通用扩写不注入。
    // 注入放在系统提示词的最前面、注入深度最高（系统级），优先级高于
    // 配置里的转写提示词：世界书与预设里的设定（包括 NSFW 相关）转写
    // 时必须遵循，并翻译成英文 Danbooru Tag 写进结果里。转写提示词只
    // 管输出格式，不管内容取舍；两者冲突时以世界书与预设为准。
    const injection = isNovel
      ? buildTagInjection({
          card,
          chat,
          preset:
            presets.find((p) => p.id === chat.presetId) ??
            presets.find((p) => p.id === settings.defaultPresetId) ??
            BUILTIN_PRESETS[0],
          lorebooks,
          settings,
          personaName: persons.find((p) => p.id === chat.personaId)?.name ?? persons[0]?.name,
          description: prompt,
        })
      : '';
    const basePrompt = isNovel
      ? tagCfg.tagPrompt || DEFAULT_TAG_PROMPT
      : 'You are a prompt engineer for image models. Convert the user\'s scene description into ONE dense English image prompt: ' +
        'subject, appearance, clothing, pose, environment, lighting, camera, art style, quality tags. ' +
        'Output only the prompt, comma-separated, no preamble, no markdown.';
    const systemPrompt = injection
      ? `【系统级设定 · 注入深度最高 · 优先级高于转写提示词】\n以下是本次对话的世界书与预设。它的优先级高于下面「转写提示词（配置）」里的任何内容；如果转写提示词里的某条规则和这里的设定冲突（比如“只用画面描述、不加别的细节”），以这里的设定为准，那条规则作废。\n${injection}\n\n其中与画面、人物、氛围有关的内容（包括 NSFW 相关设定），要翻译成对应的英文 Danbooru Tag 写进结果里，不要照搬中文原文。世界书与预设里的内容算作已知设定，直接用，不算凭空编造。\n\n【转写提示词（配置）· 优先级低于系统级设定 · 只管输出格式】\n${basePrompt}`
      : basePrompt;
    setBusy(true);
    try {
      const res = await llm.complete(conn.id, {
        model,
        maxTokens: TAG_CONVERT_MAX_TOKENS,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      });
      if (res.text.trim()) {
        // 转写完的 Tag 必须填进正面提示词（画面描述不动，继续留着正文）。
        setPositive(res.text.trim().replace(/^["']|["']$/g, ''));
        toast.success('Tag 已填进正面提示词');
      } else {
        // 模型空手而回：把真正的原因说出来，别只说“没有返回内容”。
        const d = describeEmptyTagResult(res, model || conn.defaultModel || conn.name);
        toast.error(isNovel ? '转写 Tag 失败' : '扩写失败', `${d.cause}${d.nextStep}`);
      }
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
              <Select
                value={connectionId}
                onValueChange={(v) => {
                  setConnectionId(v);
                  setModel('');
                }}
              >
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

          {/* 生图模型：跟着当前图像服务走，可自由选。 */}
          {modelOptions.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="img-model">生图模型</Label>
              <Select value={effectiveModel} onValueChange={setModel}>
                <SelectTrigger id="img-model">
                  <SelectValue placeholder="选择模型" />
                </SelectTrigger>
                <SelectContent>
                  {modelOptions.map((m) => (
                    <SelectItem key={m} value={m}>
                      {m}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

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
                  <SelectItem value="portrait">竖版 2:3 · {naiSizeFor(sizeTier ?? 'normal', 'portrait').join('×')}</SelectItem>
                  <SelectItem value="square">方形 1:1 · {naiSizeFor(sizeTier ?? 'normal', 'square').join('×')}</SelectItem>
                  <SelectItem value="landscape">横版 3:2 · {naiSizeFor(sizeTier ?? 'normal', 'landscape').join('×')}</SelectItem>
                </SelectContent>
              </Select>
              {isNovelConn && (
                <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                  当前 {naiSize[0]}×{naiSize[1]}（{naiSize[0] * naiSize[1] > 1_048_576 ? '超 1,048,576 px，不免费' : '面积 ≤1,048,576 px，Opus 免费额度内'}）
                </p>
              )}
            </div>
            {isNovelConn && (
              <div className="space-y-1.5">
                <Label htmlFor="img-sizetier">尺寸</Label>
                <Select value={sizeTier ?? 'normal'} onValueChange={(v) => setSizeTier(v as NAIImageSizeTier)}>
                  <SelectTrigger id="img-sizetier">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(NAI_SIZE_TIER_LABELS) as NAIImageSizeTier[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {NAI_SIZE_TIER_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {/* 生图参数（NovelAI）：这些参数直接决定出图质量，空着用默认值。 */}
          <div className="space-y-3 rounded-xl border border-[var(--rp-border)] p-3">
            <p className="text-[13px] font-medium">生图参数</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {/* 步数 / CFG / 张数 / CFG Rescale：官网是拖动条 + 可点数字，
                  照着做。拖动条占满一行（手机上两列太挤，拖不动），默认值按
                  官网：步数 23，CFG 强度 V4.5 是 5、V5 是 7。 */}
              <ParamSlider
                id="img-steps"
                label="步数"
                min={1}
                max={50}
                step={1}
                value={steps}
                placeholder="23"
                onChange={(v) => setSteps(v === undefined ? undefined : Math.min(50, Math.max(1, Math.round(v))))}
                hint="Opus 免费上限是 28 步。"
                className="col-span-2 sm:col-span-3"
              />
              <ParamSlider
                id="img-scale"
                label="CFG 强度"
                min={0}
                max={10}
                step={0.1}
                value={genScale}
                placeholder={isV5Model ? '7' : '5'}
                onChange={(v) => setGenScale(v === undefined ? undefined : Math.min(10, Math.max(0, v)))}
                className="col-span-2 sm:col-span-3"
              />
              <ParamSlider
                id="img-samples"
                label="生成张数"
                min={1}
                max={maxNSamples}
                step={1}
                value={nSamples}
                placeholder="1"
                onChange={(v) => setNSamples(v === undefined ? undefined : Math.min(maxNSamples, Math.max(1, Math.round(v))))}
                hint={`当前尺寸最多 ${maxNSamples} 张；多于 1 张一定花 Anlas。`}
                className="col-span-2 sm:col-span-3"
              />
              <div className="space-y-1.5">
                <Label htmlFor="img-sampler">采样器</Label>
                <Select value={sampler ?? 'k_euler_ancestral'} onValueChange={setSampler}>
                  <SelectTrigger id="img-sampler">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NAI_SAMPLERS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {NAI_SAMPLER_LABELS[s] ?? s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="img-noise">噪声计划</Label>
                <Select
                  value={isV5Model ? 'karras' : (noiseSchedule ?? 'karras')}
                  onValueChange={setNoiseSchedule}
                  disabled={isV5Model}
                >
                  <SelectTrigger id="img-noise">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NAI_NOISE_SCHEDULES.map((n) => (
                      <SelectItem key={n} value={n}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isV5Model && <p className="text-[11px] text-[var(--rp-fg-subtle)]">V5 固定用 karras。</p>}
              </div>
              <ParamSlider
                id="img-cfgrescale"
                label="CFG Rescale"
                min={0}
                max={1}
                step={0.01}
                value={cfgRescale}
                placeholder="0"
                onChange={(v) => setCfgRescale(v === undefined ? undefined : Math.min(1, Math.max(0, v)))}
                className="col-span-2 sm:col-span-3"
              />
              <div className="space-y-1.5">
                <Label htmlFor="img-ucpreset">负面预设</Label>
                <Select value={String(ucPreset ?? 0)} onValueChange={(v) => setUcPreset(Number(v))}>
                  <SelectTrigger id="img-ucpreset">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NAI_UC_PRESETS.map((p) => (
                      <SelectItem key={p.value} value={String(p.value)}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="img-seed">种子</Label>
                <div className="flex gap-1.5">
                  <Input
                    id="img-seed"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={seed ?? ''}
                    onChange={(e) => {
                      const v = e.target.value === '' ? undefined : Math.max(0, Math.floor(Number(e.target.value) || 0));
                      setSeed(v);
                    }}
                    placeholder="随机"
                    className="min-w-0 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    title="随机一个种子"
                    aria-label="随机种子"
                    onClick={() => setSeed(Math.floor(Math.random() * 999999999))}
                  >
                    <Dices className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>其它开关</Label>
                <div className="flex flex-wrap gap-3 pt-1.5 text-[13px]">
                  {!isV5Model && (
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={variety ?? false}
                        onChange={(e) => setVariety(e.target.checked)}
                        className="size-4 accent-[var(--rp-accent)]"
                      />
                      Variety+
                    </label>
                  )}
                  {isV5Model && (
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={transparentBg ?? false}
                        onChange={(e) => setTransparentBg(e.target.checked)}
                        className="size-4 accent-[var(--rp-accent)]"
                      />
                      透明背景
                    </label>
                  )}
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={qualityToggle ?? true}
                      onChange={(e) => setQualityToggle(e.target.checked)}
                      className="size-4 accent-[var(--rp-accent)]"
                    />
                    质量标签
                  </label>
                </div>
                {!isV5Model && <p className="text-[11px] text-[var(--rp-fg-subtle)]">Variety+ 只在 V4.5 有；Decrisper 和 SMEA 是 V3 的，V4.5/V5 不发。</p>}
                {isV5Model && <p className="text-[11px] text-[var(--rp-fg-subtle)]">透明背景只在 V5 有，出图是带透明通道的 PNG。</p>}
              </div>
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
                  <PressableImage
                    src={src}
                    alt={`生成结果 ${i + 1}`}
                    className="w-full object-cover"
                    onDelete={() => void deleteResult(src)}
                    onExtractMetadata={(meta) => {
                      setPositive(meta.prompt);
                      if (meta.model) setModel(meta.model);
                      toast.success('已把这张图的提示词填进正面提示词');
                    }}
                  />
                  <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 flex gap-1 bg-black/60 p-1.5 opacity-0 backdrop-blur-sm transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <Button size="sm" variant="secondary" className="pointer-events-auto h-7 flex-1 text-[11px]" onClick={() => onAttach(src)}>
                      加入对话
                    </Button>
                    <Button size="sm" variant="secondary" className="pointer-events-auto h-7 flex-1 text-[11px]" onClick={() => void useAsAvatar(src)}>
                      设为头像
                    </Button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {results.length > 0 && <Badge variant="outline">{results.length} 张结果</Badge>}
          <HistorySection
            chatId={chat.id}
            refreshKey={results.length}
            onAttach={onAttach}
            onExtractMetadata={(meta) => {
              setPositive(meta.prompt);
              if (meta.model) setModel(meta.model);
              toast.success('已把这张图的提示词填进正面提示词');
            }}
          />
        </div>

        {/* 底部：费用提示单独一行居中，关闭和生成并排两个等宽按钮。
            原来的 DialogFooter 在手机上是 flex-col-reverse，生成跑到上
            面、关闭单独占满一行，布局是散的，这里不用它了。 */}
        <div className="space-y-2 border-t border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/50 p-4">
          {isNovelConn && estAnlas !== null && (
            <p className="text-center text-[11px] text-[var(--rp-fg-muted)]">
              {estFree === 'free'
                ? 'Opus 免费（V4.5、面积 ≤1,048,576 px、≤28 步、单张）'
                : estFree === 'battery'
                  ? 'V5 额度（Opus 电池里扣，不花 Anlas）'
                  : `约 ${estAnlas} Anlas`}
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button className="flex-1" onClick={run} disabled={busy || !positive.trim()} title={positive.trim() ? undefined : '先转写 Tag 或填写正面提示词'}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Wand2 className="size-4" aria-hidden="true" />}
              {busy ? '生成中…' : '生成'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 历史生成 — 这个对话里以前生成过的图（都存在媒体库里，关掉窗口也不会丢）。
 * 每张都能重新加入对话，也能手动删除；删除会把原文件一起删掉。
 */
function HistorySection({ chatId, refreshKey, onAttach, onExtractMetadata }: { chatId: string; refreshKey: number; onAttach: (src: string) => void; onExtractMetadata: (meta: ExtractedImageMeta) => void }) {
  const [items, setItems] = React.useState<GeneratedImageMeta[]>([]);
  const [open, setOpen] = React.useState(false);

  const refresh = React.useCallback(async () => {
    const all = await listMediaImages();
    setItems(all.filter((m) => m.chatId === chatId));
  }, [chatId]);

  React.useEffect(() => {
    if (open) void refresh();
  }, [open, refresh, refreshKey]);

  async function remove(item: GeneratedImageMeta) {
    const ok = await confirmAction({
      title: '删除这张图？',
      description: '原文件也会一起删掉，删了就找不回来了。',
      confirmText: '删除',
      destructive: true,
    });
    if (!ok) return;
    await deleteMediaImage(item.id);
    await refresh();
    toast.success('已删除');
  }

  if (items.length === 0 && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full cursor-pointer rounded-lg border border-dashed border-[var(--rp-border)] px-3 py-2 text-left text-[12px] text-[var(--rp-fg-muted)]"
      >
        历史生成（这个对话以前生成的图，存在媒体库里）
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full cursor-pointer text-left text-[13px] font-medium"
      >
        历史生成（{items.length} 张）{open ? '▾' : '▸'}
      </button>
      {open && items.length === 0 && (
        <p className="text-[12px] text-[var(--rp-fg-muted)]">这个对话还没有生成过图。</p>
      )}
      {open && items.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          {items.map((item) => (
            <figure key={item.id} className="group relative overflow-hidden rounded-lg border border-[var(--rp-border)]">
              <PressableImage
                src={mediaRef(item.id)}
                alt={item.prompt ?? '生成图'}
                className="w-full object-cover"
                onDelete={() => void remove(item)}
                onExtractMetadata={(meta) => onExtractMetadata(meta)}
              />
              <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/60 p-1.5 backdrop-blur-sm">
                <p className="text-[10px] text-white/80">{formatMessageTime(item.createdAt)}</p>
                <div className="mt-1 flex gap-1">
                  <Button size="sm" variant="secondary" className="pointer-events-auto h-7 flex-1 text-[11px]" onClick={() => onAttach(mediaRef(item.id))}>
                    加入对话
                  </Button>
                  <Button size="sm" variant="secondary" className="pointer-events-auto h-7 flex-1 text-[11px]" onClick={() => void remove(item)}>
                    删除
                  </Button>
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}
