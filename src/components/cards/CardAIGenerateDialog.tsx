/**
 * "Generate with AI" dialog.
 *
 * One prompt in, a full card out: the model writes labelled sections, the parser
 * tolerates the usual formatting drift, and the result is added to the library
 * ready to play.
 */

import * as React from 'react';
import { Sparkles, Square } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { useLLM } from '@/hooks/useKernel.js';
import {
  CARD_GEN_STATUS_TEXT,
  CARD_GEN_TOTAL_SECTIONS,
  buildCardGenMessages,
  cardGenProgress,
  cardGenSectionsSeen,
  extractOutputReplyContent,
  outputReplyToolDef,
  parseCardSections,
  shouldRetryCardGen,
  type CardGenStatus,
} from '@/core/cardai/generate.js';
import { REPLY_TOOL_INSTRUCTION } from '@/core/tools/engine.js';
import { cardFromSections } from '@/core/cardai/map.js';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast.js';

export function CardAIGenerateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated?: (cardId: string) => void;
}) {
  const connections = useApp((s) => s.llmConnections);
  const settings = useApp((s) => s.settings);
  const addCard = useApp((s) => s.addCard);
  const llm = useLLM();

  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [streamText, setStreamText] = React.useState('');
  /** P02: RP-Hub style progress — 60% for the 7 base sections, +20% for the
      Regex Scripts section, 100% only when generation finishes. */
  const [progress, setProgress] = React.useState(0);
  const [status, setStatus] = React.useState<CardGenStatus>('preparing');
  /** P03: true while the one Gemini truncation retry is running. */
  const [retrying, setRetrying] = React.useState(false);
  const abortRef = React.useRef<AbortController | null>(null);

  const sectionsDone = cardGenSectionsSeen(streamText).totalDone;

  // Esc closes (matching every other sheet in the app).
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);

  if (!open) return null;

  const connection = connections.find((c) => c.id === settings.defaultConnectionId) ?? connections[0];

  const stop = () => {
    abortRef.current?.abort();
    setBusy(false);
  };

  const generate = async () => {
    if (!prompt.trim()) {
      toast.error('请先描述你想创建的角色');
      return;
    }
    if (!llm) return;
    if (!connection) {
      toast.error('没有可用的模型连接', '请先在设置里添加 API 连接');
      return;
    }
    setBusy(true);
    setStreamText('');
    setProgress(0);
    setStatus('waiting');
    setRetrying(false);
    const controller = new AbortController();
    abortRef.current = controller;
    const model = connection.defaultModel || '';
    try {
      const messages = buildCardGenMessages(prompt.trim());
      let text = '';
      const stream = llm.stream(connection.id, {
        model,
        messages,
        stream: true,
        temperature: 1,
        signal: controller.signal,
      });
      let sawText = false;
      for await (const ev of stream) {
        if (ev.type === 'text') {
          if (!sawText) {
            sawText = true;
            setStatus('generating');
          }
          text += ev.delta;
          setStreamText(text);
          setProgress(cardGenProgress(text));
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        }
      }
      // P03: Gemini often truncates the tail (<image> avatar block and/or the
      // Regex Scripts section). One retry through the output_reply tool.
      if (shouldRetryCardGen(text, model)) {
        setRetrying(true);
        setStatus('generating');
        let retryText = '';
        let toolText = '';
        const retryStream = llm.stream(connection.id, {
          model,
          messages: [
            ...messages,
            { role: 'assistant', content: text },
            {
              role: 'user',
              content: `${REPLY_TOOL_INSTRUCTION}\n上一次输出不完整（缺少头像或正则脚本章节），请把上面未完成的部分补全，重新输出完整角色卡（全部 10 节）。`,
            },
          ],
          stream: true,
          temperature: 1,
          signal: controller.signal,
          tools: [outputReplyToolDef()],
          toolChoice: 'required',
        });
        for await (const ev of retryStream) {
          if (ev.type === 'text') {
            retryText += ev.delta;
          } else if (ev.type === 'tool_call') {
            toolText = extractOutputReplyContent(ev.call) ?? toolText;
          } else if (ev.type === 'error') {
            throw new Error(ev.message);
          }
        }
        const replacement = toolText || retryText;
        if (replacement && parseCardSections(replacement).name.trim()) {
          text = replacement;
          setStreamText(text);
        }
        setRetrying(false);
      }
      setProgress(cardGenProgress(text, true));
      setStatus('done');
      const sections = parseCardSections(text);
      if (!sections.name.trim()) {
        throw new Error('模型没有返回角色名，请重试或换一个模型');
      }
      const card = cardFromSections(sections);
      await addCard(card);
      onCreated?.(card.id);
      onOpenChange(false);
      setPrompt('');
      setStreamText('');
      toast.success('已生成角色卡', card.data.name);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        toast.info('已停止生成');
      } else {
        setStatus('failed');
        toast.error('生成失败', err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  return (
    <div
      role="dialog"
      aria-label="AI 生成角色卡"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:items-center"
      onClick={() => !busy && onOpenChange(false)}
    >
      <div
        className="flex max-h-[86vh] w-[min(40rem,100%)] flex-col overflow-hidden rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] shadow-rp"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--rp-border)] px-3 py-2">
          <Sparkles className="size-4 text-[var(--rp-accent)]" aria-hidden="true" />
          <p className="text-[13px] font-semibold">AI 生成角色卡</p>
          {connection && (
            <span className="ml-auto text-[11px] text-[var(--rp-fg-subtle)]">
              {connection.name} · {connection.defaultModel || '默认模型'}
            </span>
          )}
        </div>

        <div className="rp-scroll flex-1 space-y-3 overflow-y-auto p-3">
          <div className="space-y-1.5">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="描述你想创建的角色…例如：一个话很少、守承诺的银发流浪剑士"
              rows={4}
              disabled={busy}
              aria-label="角色描述"
            />
            <p className="text-[10.5px] text-[var(--rp-fg-subtle)]">
              模型会输出角色名、描述、设定、开场白、作者注释、头像提示词、世界书和正则脚本。
            </p>
          </div>

          {busy && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-[var(--rp-fg-muted)]">
                <span>
                  {CARD_GEN_STATUS_TEXT[status]}…{retrying ? '（检测到内容截断，正在重试）' : ''}
                </span>
                <span className="tabular-nums">
                  {progress}% · 已完成 {sectionsDone}/{CARD_GEN_TOTAL_SECTIONS} 节
                </span>
              </div>
              <div
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="生成进度"
                className="h-1.5 overflow-hidden rounded-full bg-[var(--rp-bg-sunken)]"
              >
                <div
                  className="h-full rounded-full bg-[var(--rp-accent)] transition-[width] duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] p-2.5 text-[11px] leading-relaxed text-[var(--rp-fg-muted)] rp-scroll">
                {streamText || '等待模型响应…'}
              </pre>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-[var(--rp-border)] px-3 py-2">
          {busy ? (
            <Button size="sm" variant="outline" onClick={stop}>
              <Square className="size-3.5" aria-hidden="true" /> 停止
            </Button>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>
                关闭
              </Button>
              <Button size="sm" onClick={() => void generate()} disabled={!llm || !connection}>
                <Sparkles className="size-3.5" aria-hidden="true" /> 开始生成
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
