/**
 * Message bubble.
 *
 * Renders one chat message. The hard parts live here:
 *   - HTML rendering through the renderer service (sanitized, scoped),
 *   - swipe navigation for greetings and regenerated replies,
 *   - reasoning/thinking disclosure,
 *   - per-message actions via the `chat.message.actions` slot.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useState } from 'react';
import { ChevronLeft, ChevronRight, Copy, Eye, EyeOff, FastForward, GitBranch, MoreHorizontal, RefreshCw, Trash2, Pencil, Volume2, X } from 'lucide-react';import { cn, formatRelativeTime } from '@/lib/utils';
import type { RPChatMessage } from '@/core/types/chat.js';
import type { RPCard } from '@/core/types/card.js';
import type { RPCompletionPreset } from '@/core/types/preset.js';
import { useKernelService } from '@/hooks/useKernel.js';
import { SERVICE } from '@/core/plugin/kernel-types.js';
import type { RendererService } from '@/core/agent/types.js';
import { SLOT, useSlots } from '@/core/plugin/slots.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/misc';
import { Hint } from '@/components/ui/misc';
import { renderMessageText } from '@/features/chat/orchestrator.js';
import { useApp } from '@/state/store.js';
import { substituteMacros } from '@/core/prompt/macros.js';
import { speakMessage } from '@/components/chat/ReadAloudButton.js';
import type { TTSService } from '@/core/tts/types.js';
import { TemplateCard } from '@/components/chat/TemplateCard.js';
import type { RPUITemplate } from '@/core/uitemplate/types.js';
import type { RPRegexScript } from '@/core/types/card.js';
import { getPresetRegexScripts } from '@/core/prompt/preset-extensions.js';

/**
 * 预设显示层正则（三载体并集，已按 find/replace 去重）。
 *
 * 实现在 `core/prompt/preset-extensions.ts`；这里只补上 ST 语义的「显示层」
 * 过滤：仅 `promptOnly` 的脚本不参与楼层渲染（见 `regex/engine.js:347-355`
 * 的真值表与 docs/research/st-plugin-preset-coupling.md §2.1/§2.13）。
 */
export function extractPresetDisplayRegexes(preset?: RPCompletionPreset): RPRegexScript[] {
  /*
   * Union of every carrier (`extensions.regex_scripts`,
   * `SPreset.RegexBinding.regexes`, and the `SPresetSettings` data-channel
   * prompt), already de-duplicated by find/replace. The preset snapshots are a
   * containment chain — `SPresetSettings`(6) ⊂ `RegexBinding`(7) ⊂
   * `regex_scripts`(8) — so de-dup is required or a tag gets wrapped twice.
   *
   * ST 语义下仅 `promptOnly` 的脚本不参与楼层显示。
   */
  return getPresetRegexScripts(preset).filter(
    (s) => !(s.markdownOnly === false && s.promptOnly === true),
  );
}

export interface MessageBubbleProps {
  message: RPChatMessage;
  card: RPCard;
  personaName?: string;
  /** Position in the visible message list, used for forking. */
  index: number;
  allowExternalMedia: boolean;
  showReasoning: boolean;
  /**
   * Active preset. Its display-layer regexes (ST `RegexBinding` /
   * `extensions.regex_scripts`) run BEFORE the card's own scripts — this is how
   * presets like Meowssiah turn `<think_nya>` tags into the fenced HTML blocks
   * that 酒馆助手 renders. Without it the renderer has nothing to render.
   */
  preset?: RPCompletionPreset;
  onSwipe?: (messageId: string, dir: -1 | 1) => void;
  onRegenerate?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  onEdit?: (messageId: string, content: string) => void;
  onToggleHidden?: (messageId: string) => void;
  onCopy?: (text: string) => void;
  /** Fork a branch from this assistant message. */
  onFork?: (index: number) => void;
  /** UI templates to render around the body. */
  templates?: Array<{ tpl: RPUITemplate; state: Record<string, unknown> }>;
  onTemplateSlash?: (text: string) => void;
  /** Reroll one generated picture by index. */
  onRerollImage?: (index: number) => void;
  /** Read-only font size override from settings. */
  fontSize?: number;
  /** Chat id, used to resolve `[M#]` citations. */
  chatId?: string;
  /** Render card HTML panels in a sandboxed iframe. */
  sandboxHtml?: boolean;
  /** Distance from the end of the conversation (0 = newest). */
  depth?: number;
  /** Immersive mode: translucent bubbles over the character art. */
  immersive?: boolean;
  /** Per-message token usage (shown on the newest assistant bubble). */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    durationMs?: number;
  } | null;
  /** Provider quota text (shown beside the usage). */
  quotaText?: string;
  /** True while this message is still streaming (drives the caret). */
  streaming?: boolean;
  /**
   * The action plates (重新生成 / 继续 / 更多) render ONLY under the newest
   * floor — older floors stay clean history unless they become the newest.
   */
  isLast?: boolean;
  /** Continue the story without typing a prompt (直接发请求续写). */
  onContinue?: () => void;
}

export function MessageBubble({
  message,
  card,
  personaName,
  index,
  allowExternalMedia,
  showReasoning,
  preset,
  onSwipe,
  onRegenerate,
  onDelete,
  onEdit,
  onToggleHidden,
  onCopy,
  onFork,
  templates,
  onTemplateSlash,
  onRerollImage,
  fontSize,
  chatId,
  sandboxHtml,
  depth,
  immersive,
  usage,
  quotaText,
  streaming,
  isLast,
  onContinue,
}: MessageBubbleProps) {
  const renderer = useKernelService<RendererService>(SERVICE.RENDERER);
  const tts = useKernelService<TTSService>(SERVICE.TTS);
  const extraActions = useSlots(SLOT.MESSAGE_ACTIONS);
  const memories = useApp((s) => (chatId ? s.memories[chatId] : undefined));
  const [reasoningOpen, setReasoningOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [citation, setCitation] = useState<{ no: number; summary: string; turn: number } | null>(null);

  const isUser = message.role === 'user';
  const isSystem = message.role === 'system';
  const settings = useApp((s) => s.settings);

  /*
   * Display-layer regex sources in **SillyTavern execution order**:
   * GLOBAL → SCOPED (character card) → PRESET.
   *
   * ST's `SCRIPT_TYPES` is `{GLOBAL:0, PRESET:2, SCOPED:1}` and `getRegexScripts()`
   * flatMaps over the numeric key order → 0,1,2 = global → scoped → preset
   * (`regex/engine.js:11-16,98-99`). An earlier version of this file assembled
   * PRESET first; that contradicts the source. The global layer comes from app
   * settings and is wired with the runtime context in C4.
   *
   * Meowssiah-style presets turn `<think_nya>` / `<options>` tags into fenced
   * HTML here — without them 酒馆助手's renderer has nothing to render.
   */
  const cardScripts = (card.data.extensions?.regex_scripts as RPRegexScript[] | undefined) ?? [];
  const presetScripts = extractPresetDisplayRegexes(preset);
  const scripts = [...cardScripts, ...presetScripts];
  // Greetings and imported messages can still carry raw macros; expanding here
  // means the user never sees `{{char}}`.
  const expanded = React.useMemo(
    () =>
      substituteMacros(message.content, {
        char: card.data.name,
        user: personaName || 'User',
        description: card.data.description,
        personality: card.data.personality,
        scenario: card.data.scenario,
        mesExamples: card.data.mes_example,
        charIfNotGroup: card.data.name,
        group: '',
        original: '',
        persona: '',
        lastMessage: message.content,
        lastUserMessage: message.content,
        lastCharMessage: message.content,
      }),
    [message.content, card.data, personaName],
  );
  const html = React.useMemo(() => {
    const processed = renderMessageText(expanded, scripts, 2, depth);
    try {
      return renderer?.render(processed, {
        allowExternalMedia,
        styleScope: '.rp-md',
        sandboxHtml,
      }) ?? escapeHtml(processed);
    } catch {
      return escapeHtml(processed);
    }
  }, [expanded, scripts, renderer, allowExternalMedia, sandboxHtml, depth]);

  const swipeCount = message.swipes?.length ?? 0;
  const swipeId = message.swipeId ?? 0;
  /**
   * Action plates reuse the message-bubble treatment: translucent with a
   * light blur, so the icons stay legible over character art — black in dark
   * mode, the theme's elevated surface in light mode (tokens, not hardcoded).
   */
  const actionPlate =
    'dark:bg-black/45 dark:text-white/80 bg-[var(--rp-bg-elevated)]/85 text-[var(--rp-fg-muted)] backdrop-blur-sm dark:hover:bg-black/60 hover:bg-[var(--rp-bg-elevated)] dark:hover:text-white hover:text-[var(--rp-fg)]';

  /** Turn `[M12]` markers into clickable badges that open the source memory. */
  const citedHtml = React.useMemo(() => {
    if (!/[[]M\d+[]]/.test(html)) return html;
    return html.replace(/\[M(\d+)\]/g, (_m, n: string) => {
      const num = Number(n);
      const known = (memories ?? []).some((r) => r.no === num);
      return `<button type="button" class="rp-cite" data-cite="${num}" data-known="${known ? '1' : '0'}" title="查看判断依据">[M${num}]</button>`;
    });
  }, [html, memories]);

  const openCitation = (event: React.MouseEvent<HTMLDivElement>) => {
    const el = (event.target as HTMLElement).closest?.('[data-cite]') as HTMLElement | null;
    if (!el) return;
    const no = Number(el.getAttribute('data-cite'));
    const record = (memories ?? []).find((r) => r.no === no);
    setCitation({ no, summary: record?.summary ?? '没有找到这条记忆的总结。', turn: record?.turn ?? 0 });
  };

  return (
    <div
      className={cn('rp-msg-in group flex w-full gap-2.5 sm:gap-3 mes', isUser && 'flex-row-reverse')}
      data-role={message.role}
      /*
       * SillyTavern extension compatibility: TH's renderer indexes the
       * transcript as `$('#chat > .mes').attr('mesid')` and uses that number to
       * index the `chat` global array directly (`chat[message_id]`), so this
       * MUST be the array offset, not a message uid.
       */
      {...{
        /*
         * ST message attributes. `mesid` MUST stay the array offset — TH's
         * renderer indexes the `chat` global with it (`chat[message_id]`), and
         * `is_user` is read as the string `'true'` by 酒馆助手.
         */
        mesid: index,
        ch_name: card.data.name,
        is_user: message.role === 'user' ? 'true' : 'false',
        is_system: isSystem ? 'true' : 'false',
        swipeid: String(message.swipeId ?? 0),
      }}
    >
      {/*
        No avatar and no speaker name: the transcript gives the whole width to
        the prose. Only the timestamp (and the 已隐藏 marker) stay, in small
        type above the bubble.
      */}
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-col gap-1',
          isUser ? 'items-end' : 'items-start',
          settings.render.messageWidth === 'full' ? 'w-full' : 'max-w-[92%] sm:max-w-[86%]',
        )}
      >
        {/* Meta line. In a group chat the speaker name leads, otherwise the
            transcript is a wall of un-attributed bubbles. */}
        <div
          className={cn(
            'flex items-center gap-2 text-[10.5px]',
            immersive ? 'dark:text-white/50 text-[var(--rp-fg-subtle)]' : 'text-[var(--rp-fg-subtle)]',
            isUser && 'flex-row-reverse',
          )}
        >
          {message.speaker && (
            <span
              className={cn(
                'truncate font-semibold',
                immersive ? 'dark:text-white/80 text-[var(--rp-fg-muted)]' : 'text-[var(--rp-fg-muted)]',
              )}
            >
              {message.speaker}
            </span>
          )}
          <span>{formatRelativeTime(message.createdAt)}</span>
          {message.hidden && (
            <span className="rounded bg-[var(--rp-bg-sunken)] px-1.5 py-px text-[10px]">已隐藏</span>
          )}
        </div>

        {/* Reasoning */}
        {showReasoning && message.reasoning && (
          <div className={cn('w-full', isUser && 'flex justify-end')}>
            <button
              type="button"
              onClick={() => setReasoningOpen((v) => !v)}
              className="mb-1 inline-flex cursor-pointer items-center gap-1 rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] px-2 py-1 text-[11px] text-[var(--rp-fg-muted)] transition hover:text-[var(--rp-fg)]"
              aria-expanded={reasoningOpen}
            >
              <span aria-hidden="true">🧠</span>
              思考过程
              <ChevronRight className={cn('size-3 transition-transform', reasoningOpen && 'rotate-90')} aria-hidden="true" />
            </button>
            {reasoningOpen && (
              <div className="mb-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md border border-dashed border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/70 p-2.5 text-[12px] leading-relaxed text-[var(--rp-fg-muted)] rp-scroll">
                {message.reasoning}
              </div>
            )}
          </div>
        )}

        {/* UI templates above the body */}
        {templates
          ?.filter((t) => t.tpl.placement === 'top' && t.tpl.enabled)
          .map(({ tpl, state }) => (
            <TemplateCard key={tpl.id} template={tpl} state={state} onSlash={onTemplateSlash} />
          ))}

        {/* Body */}
        <div
          className={cn(
            'w-full min-w-0 rounded-2xl px-3.5 py-2.5 shadow-sm sm:px-4 sm:py-3',
            isSystem
              ? 'rounded-lg border border-dashed border-[var(--rp-danger)]/40 bg-[var(--rp-danger)]/10 text-[var(--rp-fg-muted)]'
              : immersive
                ? isUser
                  ? // 沉浸气泡跟随主题：浅色用主题气泡色（--rp-user-bubble）磨砂，
                    // 深色才用半透明白；颜色取自当前主题预设。
                    'rounded-2xl backdrop-blur-sm bg-[var(--rp-user-bubble)]/85 text-[var(--rp-fg)] dark:bg-white/15 dark:text-white'
                  : 'rounded-2xl backdrop-blur-sm bg-[var(--rp-char-bubble)]/85 text-[var(--rp-fg)] dark:bg-black/45 dark:text-white'
                : isUser
                  ? 'rounded-tr-sm bg-[var(--rp-user-bubble)] text-[var(--rp-fg)]'
                  : 'rounded-tl-sm bg-[var(--rp-char-bubble)] text-[var(--rp-fg)] border border-[var(--rp-border)]',
          )}
        >
            {isUser && message.images?.length ? (
              <div className="mb-2 grid grid-cols-2 gap-2">
                {message.images.map((src, i) => (
                  <img
                    key={i}
                    src={src}
                    alt={`附件 ${i + 1}`}
                    className="w-full rounded-lg border border-[var(--rp-border)] object-cover"
                    loading="lazy"
                  />
                ))}
              </div>
            ) : null}
            {/*
               * `.mes_text` is SillyTavern's transcript body node: TH locates
               * `#chat > .mes[mesid=N]` then `.find('.mes_text')` and reads the
               * `pre>code` inside it (docs/research/st-plugin-preset-coupling.md
               * §2.9 / _th-renderer-contract.md §3.1). RPNow keeps its own
               * `.rp-md` class for styling.
               */
            }
            <div
              className="rp-md mes_text"
              style={fontSize ? { fontSize: `${fontSize}px` } : undefined}
              onClick={openCitation}
              dangerouslySetInnerHTML={{ __html: citedHtml }}
            />
            {/*
              Typewriter caret. The text itself already arrives progressively
              (streaming deltas render into `draft`), so the caret only has to
              sit after the newest character — which an element appended here
              does, since it follows the last block of the rendered HTML.
            */}
            {streaming && <span className="rp-caret" aria-hidden="true" />}
            {message.images?.length ? (
              <div className="mt-2 grid gap-2">
                {message.images.map((src, i) => (
                  <div key={i} className={cn('group/img relative', message.images!.length === 3 && i === 0 ? 'col-span-2' : '')}>
                    <img
                      src={src}
                      alt={`生成图 ${i + 1}`}
                      className={cn(
                        'w-full rounded-lg border border-[var(--rp-border)] object-cover',
                        message.images!.length === 1 ? 'max-h-[26rem]' : 'max-h-[16rem]',
                      )}
                      loading="lazy"
                    />
                    {onRerollImage && (
                      <button
                        type="button"
                        aria-label={`重新生成第 ${i + 1} 张图`}
                        title="随机调整提示词重新生成"
                        onClick={() => onRerollImage(i)}
                        className="absolute right-1 top-1 flex size-6 cursor-pointer items-center justify-center rounded-md bg-black/55 text-white transition lg:opacity-0 lg:group-hover/img:opacity-100"
                      >
                        <RefreshCw className="size-3" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

        {/* UI templates below the body */}
        {templates
          ?.filter((t) => t.tpl.placement === 'bottom' && t.tpl.enabled)
          .map(({ tpl, state }) => (
            <TemplateCard key={tpl.id} template={tpl} state={state} onSlash={onTemplateSlash} />
          ))}

        {/* Swipes + actions */}
        <div
          className={cn(
            'flex items-center gap-1 transition-opacity',
            // Touch devices have no hover: keep the actions visible. Desktop
            // reveals them on hover, matching RP-Hub.
            'opacity-100 md:opacity-70 md:group-hover:opacity-100 focus-within:opacity-100',
            isUser && 'flex-row-reverse',
          )}
        >
          {/* Swipe pager: pill shape. */}
          {swipeCount > 1 && (
            <div className="flex h-8 items-center gap-0.5 rounded-full px-1 backdrop-blur-sm dark:bg-black/45 bg-[var(--rp-bg-elevated)]/85">
              <button
                type="button"
                aria-label="上一段开场白"
                className="flex size-6 cursor-pointer items-center justify-center rounded-full transition dark:text-white/80 text-[var(--rp-fg-muted)] dark:hover:bg-white/15 hover:bg-[var(--rp-fg)]/10 dark:hover:text-white hover:text-[var(--rp-fg)]"
                onClick={() => onSwipe?.(message.id, -1)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
              </button>
              <span className="min-w-[2.2rem] text-center text-[11px] tabular-nums dark:text-white/80 text-[var(--rp-fg-muted)]">
                {swipeId + 1}/{swipeCount}
              </span>
              <button
                type="button"
                aria-label="下一段开场白"
                className="flex size-6 cursor-pointer items-center justify-center rounded-full transition dark:text-white/80 text-[var(--rp-fg-muted)] dark:hover:bg-white/15 hover:bg-[var(--rp-fg)]/10 dark:hover:text-white hover:text-[var(--rp-fg)]"
                onClick={() => onSwipe?.(message.id, 1)}
              >
                <ChevronRight className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {/*
            Action plates — ONLY under the newest floor. History stays clean;
            when a floor becomes the newest again (swipe/regenerate) its plates
            reappear. 重新生成 + 继续 for assistant floors; everything else
            lives behind 更多.
          */}
          {isLast && !isUser && (
            <Hint label="重新生成">
              <button
                type="button"
                aria-label="重新生成这条回复"
                onClick={() => onRegenerate?.(message.id)}
                className={cn(
                  'flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors',
                  actionPlate,
                )}
              >
                <RefreshCw className="size-4" aria-hidden="true" />
              </button>
            </Hint>
          )}
          {isLast && !isUser && (
            <Hint label="继续剧情（不输入提示词，直接续写）">
              <button
                type="button"
                aria-label="继续剧情"
                onClick={() => onContinue?.()}
                className={cn(
                  'flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors',
                  actionPlate,
                )}
              >
                <FastForward className="size-4" aria-hidden="true" />
              </button>
            </Hint>
          )}

          {/*
            Everything else lives behind one "更多" menu — including 编辑,
            which opens the bottom-sheet editor.
          */}
          {isLast && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="更多操作"
                  className={cn(
                    'flex size-8 cursor-pointer items-center justify-center rounded-lg transition-colors',
                    actionPlate,
                  )}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setEditing(true);
                  }}
                >
                  <Pencil className="size-3.5" aria-hidden="true" /> 编辑消息
                </DropdownMenuItem>
                {!isUser && (
                  <DropdownMenuItem onSelect={() => onFork?.(index)}>
                    <GitBranch className="size-3.5" aria-hidden="true" /> 从这里分支
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => onCopy?.(message.content)}>
                  <Copy className="size-3.5" aria-hidden="true" /> 复制
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onToggleHidden?.(message.id)}>
                  {message.hidden ? (
                    <>
                      <Eye className="size-3.5" aria-hidden="true" /> 显示并加入上下文
                    </>
                  ) : (
                    <>
                      <EyeOff className="size-3.5" aria-hidden="true" /> 从上下文中隐藏
                    </>
                  )}
                </DropdownMenuItem>
                {tts && (
                  <DropdownMenuItem onSelect={() => void speakMessage(tts, message.content, { charName: card.data.name, userName: personaName })}>
                    <Volume2 className="size-3.5" aria-hidden="true" /> 朗读这条消息
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  destructive
                  onSelect={() => onDelete?.(message.id)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> 删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isLast &&
            extraActions.map((entry) => {
              const C = entry.component;
              return <C key={entry.id} message={message} card={card} />;
            })}
        </div>

        {/*
          Round stats (Tavo-style readout): speed, context size, cache hit.
          Sits directly under the action row of the newest floor. quotaText
          alone (no usage yet) still renders so the provider readout survives.
        */}
        {isLast && (usage || quotaText) && (
          <div
            className={cn(
              'flex items-center gap-1.5 whitespace-nowrap text-[10.5px] tabular-nums',
              immersive ? 'dark:text-white/45 text-[var(--rp-fg-subtle)]' : 'text-[var(--rp-fg-subtle)]',
              isUser && 'flex-row-reverse',
            )}
          >
            {usage?.outputTokens && usage?.durationMs ? (
              <span title="生成速度">
                ⚡ {(usage.outputTokens / Math.max(0.001, usage.durationMs / 1000)).toFixed(1)} tok/s
              </span>
            ) : null}
            {usage?.inputTokens ? (
              <span title="本轮占用的上下文（prompt token）">
                ⛁ {fmtTokens(usage.inputTokens)} 上下文
                {usage.cachedTokens ? `（已缓存 ${fmtTokens(usage.cachedTokens)}）` : ''}
              </span>
            ) : null}
            {quotaText && <span title="服务商剩余额度">· {quotaText}</span>}
          </div>
        )}
      </div>

      {/* Citation popup: the reasoning behind an `[M#]` marker. Portaled to
          the body for the same transformed-ancestor reason as the editor. */}
      {citation &&
        createPortal(
          <div
            role="dialog"
            aria-label="记忆判断依据"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setCitation(null)}
          >
            <div
              className="w-[min(26rem,100%)] rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3 shadow-rp"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-semibold text-[var(--rp-accent)]">M{citation.no}</p>
                {citation.turn > 0 && (
                  <span className="text-[11px] text-[var(--rp-fg-subtle)]">第 {citation.turn} 轮</span>
                )}
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={() => setCitation(null)}
                  className="ml-auto flex size-7 cursor-pointer items-center justify-center rounded text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)]"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[var(--rp-fg)]">
                {citation.summary}
              </p>
            </div>
          </div>,
          document.body,
        )}

      {/* Message editor: a bottom sheet (Tavo-style 改写面板). */}
      <MessageEditSheet
        open={editing}
        initial={message.content}
        onCancel={() => setEditing(false)}
        onSave={(text) => {
          onEdit?.(message.id, text);
          setEditing(false);
        }}
      />
    </div>
  );
}

/** `1234567` → `123.5K`，跟 Tavo 的上下文读数一致。 */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/**
 * Bottom-sheet message editor: full-width sheet anchored to the bottom, header
 * 「改写 … 保存」, one large textarea, and a helper row (全选 / 引号 / 括号)
 * whose chips do NOT steal focus from the textarea (the soft keyboard stays up).
 */
function MessageEditSheet({
  open,
  initial,
  onCancel,
  onSave,
}: {
  open: boolean;
  initial: string;
  onCancel: () => void;
  onSave: (text: string) => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  /*
   * Focus exactly once per open.
   *
   * Previously the effect depended on `initial`, so any parent re-render that
   * passed a new string re-ran it — resetting the draft and re-focusing, which
   * is what made the sheet appear to "focus then immediately blur". The ref
   * guard makes the open→focus transition idempotent, and the second rAF lets
   * the sheet's slide-in mount finish before we steal focus.
   */
  const focusedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!open) {
      focusedFor.current = null;
      return;
    }
    if (focusedFor.current === initial) return;
    focusedFor.current = initial;
    setDraft(initial);

    /*
     * The sheet is opened from the 更多 dropdown. Radix restores focus to the
     * trigger when that menu unmounts — which happens *after* our first frame —
     * so a single focus() gets stolen right back. Retry across a short window
     * until the textarea actually holds focus; bail as soon as it does.
     */
    let cancelled = false;
    let tries = 0;
    const tick = () => {
      if (cancelled) return;
      const el = taRef.current;
      if (el && document.activeElement === el) return;
      if (el) {
        el.focus({ preventScroll: true });
        try {
          el.setSelectionRange(el.value.length, el.value.length);
        } catch {
          /* detached */
        }
      }
      if (++tries < 12) timer = window.setTimeout(tick, 50);
    };
    let timer = window.setTimeout(tick, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, initial]);

  if (!open) return null;

  /** Insert at the caret without dismissing the keyboard. */
  const insertAtCursor = (text: string, caretOffset = text.length) => {
    const el = taRef.current;
    if (!el) {
      setDraft((v) => v + text);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    setDraft(el.value.slice(0, start) + text + el.value.slice(end));
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      try {
        el.setSelectionRange(start + caretOffset, start + caretOffset);
      } catch {
        /* detached node */
      }
    });
  };

  const chip =
    'flex h-9 cursor-pointer items-center justify-center rounded-full bg-[var(--rp-bg-sunken)] px-3 text-[13px] font-semibold text-[var(--rp-fg-muted)] transition-colors hover:text-[var(--rp-fg)]';

  return createPortal(
    <div
      className="rp-anim-fade fixed inset-0 z-[70] flex flex-col justify-end"
      role="dialog"
      aria-label="编辑消息"
      // Keep focus inside the sheet: Radix's menu restores focus to its trigger
      // as it unmounts, which otherwise lands after we grabbed focus.
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        // Defer so the textarea wins over a late focus() from the menu.
        window.setTimeout(() => {
          const el = taRef.current;
          if (el && document.activeElement !== el) el.focus({ preventScroll: true });
        }, 0);
      }}
    >
      <button
        type="button"
        aria-label="关闭编辑"
        onClick={onCancel}
        className="absolute inset-0 cursor-default bg-black/50"
      />
      <div
        className={cn(
          'rp-anim-sheet relative flex max-h-[88dvh] flex-col rounded-t-2xl border-t border-[var(--rp-border)] bg-[var(--rp-bg)] pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] shadow-rp',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header: 改写 … 保存 */}
        <div className="flex items-center gap-2 border-b border-[var(--rp-border)] px-4 py-3">
          <p className="text-[15px] font-semibold">改写</p>
          <button
            type="button"
            aria-label="取消编辑"
            onClick={onCancel}
            className="ml-auto flex h-8 cursor-pointer items-center rounded-full px-3 text-[12.5px] text-[var(--rp-fg-muted)] hover:text-[var(--rp-fg)]"
          >
            取消
          </button>
          <button
            type="button"
            aria-label="保存编辑"
            onClick={() => onSave(draft)}
            className="flex h-8 cursor-pointer items-center rounded-full px-3 text-[13.5px] font-semibold text-[var(--rp-accent)] transition-colors hover:bg-[var(--rp-accent-soft)]"
          >
            保存
          </button>
        </div>

        <textarea
          ref={taRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="编辑消息内容"
          className="rp-no-scrollbar mx-3 mt-3 min-h-[38vh] flex-1 resize-none rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/60 p-3 text-[15px] leading-relaxed text-[var(--rp-fg)] outline-none caret-[var(--rp-accent)] placeholder:text-[var(--rp-fg-subtle)] focus:border-[var(--rp-accent)]"
        />

        {/* Helper row */}
        <div className="mt-2 flex items-center gap-2 px-3 pb-1">
          <button
            type="button"
            aria-label="全选"
            onClick={() => taRef.current?.select()}
            className={chip}
          >
            全选
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              aria-label="插入引号"
              onPointerDown={(e) => {
                e.preventDefault();
                insertAtCursor('“”', 1);
              }}
              className={chip}
            >
              “
            </button>
            <button
              type="button"
              aria-label="插入括号"
              onPointerDown={(e) => {
                e.preventDefault();
                insertAtCursor('()', 1);
              }}
              className={chip}
            >
              ( )
            </button>
          </div>
        </div>
      </div>
    </div>,
    // Mount at the document root: the chat page lives inside the push-aside
    // transform, and a `fixed` child of a transformed ancestor is re-anchored
    // to that ancestor (which is exactly the broken placement that was here).
    document.body,
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br />');
}
