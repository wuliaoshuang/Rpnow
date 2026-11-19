/**
 * Chat view.
 *
 * Owns the live turn: streaming text into a "draft" message, cancellation, and
 * the action set (regenerate, swipe, continue, impersonate). Prompt assembly and
 * world-book activation are delegated to `orchestrator.sendTurn`, so this file
 * contains no prompt logic — that separation is what lets the agent loop be
 * swapped without touching the UI.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  Ban,
  Bot,
  ChevronDown,
  ChevronUp,
  Maximize2,
  ImagePlus,
  Loader2,
  Menu,
  Plus,
  X,
  SlidersHorizontal,
  Wand2,
} from 'lucide-react';
import { cn, estimateTokens, uid } from '@/lib/utils';
import { useApp } from '@/state/store.js';
import type { RPChat, RPChatMessage } from '@/core/types/chat.js';
import type { RPCard } from '@/core/types/card.js';
import type { RPCompletionPreset } from '@/core/types/preset.js';
import { MessageBubble } from '@/components/chat/MessageBubble.js';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc';

import { useAgentLoop, useLLM } from '@/hooks/useKernel.js';
import { useKeyboardInset } from '@/hooks/useKeyboardInset.js';
import { sendTurn, type ChatContext } from '@/features/chat/orchestrator.js';
import { MemoryService } from '@/features/memory/service.js';
import { MAIN_BRANCH } from '@/core/types/chat.js';
import { BranchPanel } from '@/components/chat/BranchPanel.js';
import { diffVariables, parseUpdates, stripUpdateBlocks, validateVariables } from '@/core/uitemplate/engine.js';
import { analyseTemplates } from '@/core/uitemplate/analysis.js';
import {
  fetchAsDataUrl,
  artistsForStyle,
  IMAGE_SIZES,
  markerForTags,
  normalizeTags,
  parseImageMarkers,
  pollJob,
  rerollTags,
  rewriteImageMarker,
  stripImageMarkers,
  submitJob,
} from '@/core/image/nai.js';
import { fetchTokenQuota } from '@/core/llm/quota.js';
import { compressImageFile } from '@/core/image/types.js';
import { parseCot } from '@/core/prompt/cot.js';
import { stripCitations } from '@/core/memory/types.js';
import { filterBlockedStyleText } from '@/core/styleFilter.js';
import { pruneMemories } from '@/core/memory/engine.js';
import {
  formatTokens,
  recordUsage,
  useUsageHistory,
  wrapLlmForUsage,
} from '@/core/usage.js';
import { vibrate, vibrateMessage } from '@/lib/haptics.js';
import { BUILTIN_PRESETS } from '@/core/defaults/presets.js';
import { toast } from '@/components/ui/toast.js';
import { SLOT, SlotOutlet } from '@/core/plugin/slots.js';
import { PromptInspector } from '@/components/chat/PromptInspector.js';
import { ImageStudio } from '@/components/chat/ImageStudio.js';
import { ModelPicker, type ModelPickerTarget } from '@/components/chat/ModelPicker.js';
import { ChatQuickPanel } from '@/components/chat/ChatQuickPanel.js';
import { MODEL_SLOTS, chatImmersive, slotIdForModel, slotModels } from '@/core/llm/modelSlots.js';
import { isTouchDevice } from '@/lib/runtime.js';
import type { Route } from '@/components/layout/AppShell.js';

/**
 * A keyboard-row chip that inserts text WITHOUT dismissing the soft keyboard.
 *
 * A plain `onClick` fires after focus has already moved to the button, so the
 * OS closes the on-screen keyboard. Calling `preventDefault()` on `pointerdown`
 * keeps focus (and the caret) on the textarea, and we act on pointerdown rather
 * than click so the insert feels immediate and needs no focus juggling.
 */
function InsertChip({
  label,
  onInsert,
  immersive,
  children,
}: {
  label: string;
  onInsert: () => void;
  immersive: boolean;
  children: React.ReactNode;
}) {
  const acted = React.useRef(false);
  return (
    <button
      type="button"
      aria-label={label}
      // Keep focus on the textarea: this is what stops the keyboard closing.
      onPointerDown={(e) => {
        e.preventDefault();
        acted.current = true;
        onInsert();
      }}
      // Fallback for environments without pointer events, and for keyboard use.
      onClick={(e) => {
        if (acted.current) {
          acted.current = false;
          return;
        }
        e.preventDefault();
        onInsert();
      }}
      className={cn(
        'flex h-8 w-8 cursor-pointer items-center justify-center rounded-full text-[12.5px] font-semibold transition-colors',
        // 沉浸模式跟随主题：浅色主题用浅色磨砂片 + 深色字，深色主题才用黑底白字。
        immersive
          ? 'dark:bg-black/45 dark:text-white/85 bg-[var(--rp-bg-elevated)]/85 text-[var(--rp-fg)] backdrop-blur-sm'
          : 'bg-[var(--rp-bg-sunken)] text-[var(--rp-fg-muted)]',
      )}
    >
      {children}
    </button>
  );
}

export interface ChatViewProps {
  chat: RPChat;
  card: RPCard;
  onUpdate: (chat: RPChat) => void;
  onOpenCards: () => void;
  /** Jump to a route — or to a specific settings tab — from the drawer. */
  onNavigate?: (route: Route, tab?: string) => void;
}

export function ChatView({
  chat,
  card,
  onUpdate,
  onOpenCards,
  onOpenSettings,
  onOpenList,
  onNavigate,
  branchesOpen: branchesOpenProp,
  onBranchesOpenChange,
  inspectorOpen: inspectorOpenProp,
  onInspectorOpenChange,
}: ChatViewProps & {
  /** Opens the right side panel (conversation settings). */
  onOpenSettings?: () => void;
  /** Opens the left side panel (chat list). */
  onOpenList?: () => void;
  branchesOpen?: boolean;
  onBranchesOpenChange?: (v: boolean) => void;
  inspectorOpen?: boolean;
  onInspectorOpenChange?: (v: boolean) => void;
}) {
  const llm = useLLM();
  const loop = useAgentLoop();
  const settings = useApp((s) => s.settings);
  const persons = useApp((s) => s.personas);
  const lorebooks = useApp((s) => s.lorebooks);
  const presets = useApp((s) => s.presets);
  const connections = useApp((s) => s.llmConnections);
  const memories = useApp((s) => s.memories[chat.id]) ?? [];
  const uiTemplates = useApp((s) => s.uiTemplates);
  const updateCard = useApp((s) => s.updateCard);
  const setSettings = useApp((s) => s.setSettings);

  const [input, setInput] = React.useState('');
  const [draftImages, setDraftImages] = React.useState<string[]>([]);
  const imageInput = React.useRef<HTMLInputElement>(null);
  const inputRef = React.useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<{ text: string; reasoning: string } | null>(null);
  /** 聊天建议：AI 回完后给出的 3 条接话（点一下直接发送）。 */
  const [suggestions, setSuggestions] = React.useState<string[]>([]);
  /** 建议属于哪条 AI 回复（换回复/换对话就失效）。 */
  const suggestionsForRef = React.useRef<string | null>(null);
  const suggestionsAbortRef = React.useRef<AbortController | null>(null);
  // These two are lifted to the app when the caller provides them, so the right
  // side panel can open them after it closes.
  const [inspectorOpenLocal, setInspectorOpenLocal] = React.useState(false);
  const inspectorOpen = inspectorOpenProp ?? inspectorOpenLocal;
  const setInspectorOpen = onInspectorOpenChange ?? setInspectorOpenLocal;
  const [sheetOpen, setSheetOpen] = React.useState(false);
  /** A07: character intro panel (floors / chars / compressed-size forecast). */
  const [charPanelOpen, setCharPanelOpen] = React.useState(false);
  const [branchOpenLocal, setBranchOpenLocal] = React.useState(false);
  const branchOpen = branchesOpenProp ?? branchOpenLocal;
  const setBranchOpen = onBranchesOpenChange ?? setBranchOpenLocal;
  const [quota, setQuota] = React.useState<{ used: number; total: number } | null>(null);
  const [imageOpen, setImageOpen] = React.useState(false);
  /** N02/N03/R04: 输入岛快捷面板与模型选择器。 */
  const [quickPanelOpen, setQuickPanelOpen] = React.useState(false);
  const [modelPickerOpen, setModelPickerOpen] = React.useState(false);
  const [modelPickerTarget, setModelPickerTarget] = React.useState<ModelPickerTarget>('chat');
  const abortRef = React.useRef<AbortController | null>(null);
  /** C06: 流式增量 60ms 节流——delta 先攒进 ref，每 60ms 才 setDraft 一次。 */
  const draftTextRef = React.useRef('');
  const draftReasoningRef = React.useRef('');
  const draftFlushedRef = React.useRef({ text: '', reasoning: '' });
  const draftFlushTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const flushDraft = React.useCallback(() => {
    draftFlushTimerRef.current = null;
    const text = draftTextRef.current;
    const reasoning = draftReasoningRef.current;
    const last = draftFlushedRef.current;
    if (text === last.text && reasoning === last.reasoning) return;
    draftFlushedRef.current = { text, reasoning };
    setDraft({ text, reasoning });
  }, []);
  /** C09: 等待计时——本轮生成开始的时间戳，配合下面的 interval 显示已等待秒数。 */
  const genStartRef = React.useRef(0);
  const [waitedSec, setWaitedSec] = React.useState(0);
  React.useEffect(() => {
    if (!busy) {
      setWaitedSec(0);
      return;
    }
    const start = genStartRef.current || Date.now();
    const tick = () => setWaitedSec(Math.floor((Date.now() - start) / 1000));
    tick();
    const timer = window.setInterval(tick, 500);
    return () => window.clearInterval(timer);
  }, [busy]);
  /** Guards the one-buzz-per-reply haptic. */
  const replyBuzzedRef = React.useRef(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const stickToBottom = React.useRef(true);

  const persona = persons.find((p) => p.id === chat.personaId) ?? persons[0];
  const preset: RPCompletionPreset =
    presets.find((p) => p.id === chat.presetId) ??
    presets.find((p) => p.id === settings.defaultPresetId) ??
    BUILTIN_PRESETS[0];
  const connection = connections.find((c) => c.id === chat.connectionId) ?? connections.find((c) => c.id === settings.defaultConnectionId) ?? connections[0];

  // ------------------------------------------------------------- scrolling
  /**
   * Jump button state.
   *
   * Direction-driven, which is what actually matches intent:
   *   scrolling UP   (reading back) → offer 回到顶部
   *   scrolling DOWN (heading to new) → offer 回到底部
   * and never shown when the transcript is short enough to see both ends, so a
   * two-message chat is not cluttered with a pointless button.
   */
  const JUMP_MARGIN = 160;
  const SHORT_TRANSCRIPT = 900;
  /** Windowing: floors rendered at once, and how many more each reveal adds. */
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE);
  const hiddenCount = Math.max(0, chat.messages.length - visibleCount);
  const [jumpHint, setJumpHint] = React.useState<'top' | 'bottom' | 'none'>('none');
  const lastScrollTop = React.useRef(0);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    // NOTE: initial mount fires a scroll event with scrollTop=0 while the
    // auto-pin hasn't run yet; treating that as "user scrolled up" would break
    // the sticky bottom. The pin effect sets this flag after it repositions.
    stickToBottom.current = fromBottom < 60;

    // Short conversation: everything fits (or almost), no button at all.
    if (el.scrollHeight < el.clientHeight + SHORT_TRANSCRIPT) {
      setJumpHint('none');
      lastScrollTop.current = el.scrollTop;
      return;
    }
    // At the very top → nothing above to return to.
    if (el.scrollTop <= 2) {
      setJumpHint('none');
      lastScrollTop.current = el.scrollTop;
      return;
    }
    // Already at the newest floor → nothing below to return to.
    if (fromBottom <= 2) {
      setJumpHint('none');
      lastScrollTop.current = el.scrollTop;
      return;
    }
    const delta = el.scrollTop - lastScrollTop.current;
    lastScrollTop.current = el.scrollTop;
    if (Math.abs(delta) < 1) return; // ignore jitter / programmatic no-ops
    // Scrolling up = user wants older content → show 回到顶部.
    if (delta < 0 && el.scrollTop > JUMP_MARGIN) setJumpHint('top');
    // Scrolling down = user wants the latest → show 回到底部.
    else if (delta > 0) setJumpHint('bottom');

    // Windowing: nearing the top of the mounted window pulls in older floors.
    if (el.scrollTop < 200 && visibleCount < chat.messages.length) {
      setVisibleCount((n) => Math.min(chat.messages.length, n + PAGE_SIZE));
    }
  };
  

  /** Every new floor widens the window so the newest message stays mounted. */
  React.useEffect(() => {
    setVisibleCount((n) => Math.max(n, PAGE_SIZE));
  }, [chat.id]);

  /** 换对话：旧建议失效，正在生成的建议也停掉。 */
  React.useEffect(() => {
    suggestionsAbortRef.current?.abort();
    suggestionsAbortRef.current = null;
    suggestionsForRef.current = null;
    setSuggestions([]);
  }, [chat.id]);

  /**
   * 聊天建议：AI 回完（busy 回到 false）且最后一条是 AI 回复时，用快速模型
   * 给 3 条接话。只在真的聊起来之后给（只有开场白时不给），失败不报错、
   * 不重试——建议是锦上添花，不能打断聊天。
   */
  const lastMsg = chat.messages[chat.messages.length - 1];
  React.useEffect(() => {
    if (busy) return;
    if (!(settings.chat.suggestionsEnabled ?? true)) return;
    if (!lastMsg || lastMsg.role !== 'assistant' || !lastMsg.content.trim()) return;
    if (!chat.messages.some((m) => m.role === 'user')) return;
    if (suggestionsForRef.current === lastMsg.id) return;
    if (!llm || !connection) return;
    const fastConn = connections.find((c) => c.id === settings.chat.fastConnectionId) ?? connection;
    const model = settings.chat.fastModel?.trim() || fastConn.defaultModel || chat.model || connection.defaultModel;
    if (!model) return;
    const controller = new AbortController();
    suggestionsAbortRef.current = controller;
    suggestionsForRef.current = lastMsg.id;
    const recent = chat.messages
      .slice(-8)
      .map((m) => `${m.role === 'user' ? (persona?.name || '用户') : (card?.data.name || 'AI')}：${m.content}`)
      .join('\n')
      .slice(-2000);
    const promise = llm.completeFrom?.(fastConn, {
      model,
      messages: [
        { role: 'user', content: `下面是一段角色扮演对话的最近记录：\n${recent}\n\n请给出 3 条用户接下来可能想说的话：每条一行，简短口语，不超过 20 个字，只写内容，不要编号、不要引号、不要解释。` },
      ],
      maxTokens: 150,
    });
    if (!promise) return;
    void promise
      .then((res) => {
        if (controller.signal.aborted) return;
        const lines = (res?.text ?? '')
          .split('\n')
          .map((l) =>
            l
              .trim()
              .replace(/^[0-9]+[、.．\s]+/, '')
              .replace(/^[-*•\s]+/, '')
              .replace(/^["“”‘’]+|["“”‘’]+$/g, '')
              .trim(),
          )
          .filter((l) => l.length > 0 && l.length <= 30)
          .slice(0, 3);
        if (lines.length) setSuggestions(lines);
      })
      .catch(() => {
        /* 建议生成失败就当没有，不打扰用户 */
      })
      .finally(() => {
        if (suggestionsAbortRef.current === controller) suggestionsAbortRef.current = null;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, lastMsg?.id, settings.chat.suggestionsEnabled, chat.id]);

  /**
   * ST `chatLoaded` — emitted once the transcript DOM is committed.
   *
   * 酒馆助手 subscribes to it for the **first full re-scan** of every floor
   * (`_th-renderer-contract.md` §5.4); an empty chat additionally shows
   * `#chat > .welcomePanel`. The payload mirrors ST's object shape
   * (`{ detail: { id, character } }`, `script.js:7669`) even though TH ignores it.
   */
  React.useEffect(() => {
    const kernel = useApp.getState().kernel;
    if (!kernel?.events || !chat.id) return;
    const timer = setTimeout(() => {
      kernel.events.emit('chat:loaded', {
        detail: { id: card.id, character: card.data.name },
      });
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, card.id]);

  /** Re-evaluate the jump button when the transcript or viewport resizes. */
  React.useEffect(() => {
    onScroll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.messages.length, draft?.text]);

  // ------------------------------------------------- keyboard helper row
  /**
   * Detect the on-screen keyboard. Shared hook — see useKeyboardInset.ts.
   * `keyboardInset` is how many px the keyboard covers; `layoutResized`
   * says whether the layout viewport itself shrank with the keyboard
   * (new Chrome + `interactive-widget=resizes-content` in index.html).
   */
  const { keyboardOpen, keyboardInset, layoutResized } = useKeyboardInset();

/**
   * Pin the newest floor so its action buttons stay reachable.
   *
   * `scrollTop = scrollHeight` puts the *container's* bottom at the viewport
   * bottom, but the newest bubble's action row can still be cut when the
   * keyboard shrinks the shell. Scrolling the last message's *own bottom* into
   * view guarantees its buttons are visible.
   */
  const pinLastFloor = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // The container's lastElementChild is the *list wrapper*; the newest floor
    // is the last `[data-role]` bubble inside it.
    const last = el.querySelector('[data-role]:last-of-type') as HTMLElement | null;
    if (last) {
      const target = last.offsetTop + last.offsetHeight + 16 - el.clientHeight;
      el.scrollTop = Math.max(0, target);
    } else {
      el.scrollTop = el.scrollHeight;
    }
    lastScrollTop.current = el.scrollTop;
  }, []);

  React.useEffect(() => {
    // Unconditional: this effect also establishes the initial scroll position
    // after mount (where `stickToBottom` has not been determined yet).
    pinLastFloor();
  }, [chat.messages.length, keyboardInset, pinLastFloor]);

  /**
   * Multi-line typing grows the composer, which shrinks the transcript — with
   * the keyboard already open no `keyboardInset`/`messages.length` change fires,
   * and the last floor would stay buried. A ResizeObserver on the composer
   * re-pins whenever its height changes.
   */
  const composerRef = React.useRef<HTMLDivElement>(null);
  const [composerH, setComposerH] = React.useState(0);
  React.useEffect(() => {
    const el = composerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) setComposerH(Math.round(entry.contentRect.height));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  React.useEffect(() => {
    pinLastFloor();
  }, [composerH, keyboardOpen, pinLastFloor]);

  React.useEffect(() => {
    // Streaming: follow the caret only while the user is still parked at the
    // bottom. If they scrolled up to read, do not yank them down every delta.
    if (!stickToBottom.current) return;
    requestAnimationFrame(() => pinLastFloor());
  }, [draft?.text, pinLastFloor]);

  /**
   * Insert `text` at the caret, leaving the cursor `caretOffset` inside it.
   *
   * Called from the keyboard-row chips, which `preventDefault()` on pointerdown
   * so the textarea keeps focus. `focus({preventScroll:true})` is still called
   * afterwards: it is a no-op when already focused, and it recovers the caret
   * when the insert came from a click fallback that did move focus.
   */
  const insertAtCursor = (text: string, caretOffset = text.length) => {
    const el = inputRef.current;
    if (!el) {
      setInput((v) => v + text);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setInput(next);
    // React controls `value`, so the DOM is still the old string until it
    // re-renders; place the caret after that commit. `preventScroll` keeps the
    // page from jumping when the keyboard is open.
    requestAnimationFrame(() => {
      el.focus({ preventScroll: true });
      const pos = start + caretOffset;
      try {
        el.setSelectionRange(pos, pos);
      } catch {
        /* some WebViews reject selection on detached nodes */
      }
    });
  };

  const [composerExpanded, setComposerExpanded] = React.useState(false);

  // ---------------------------------------------------------------- helpers
  const patch = (p: Partial<RPChat>) => onUpdate({ ...chat, ...p });

  const appendMessage = (msg: RPChatMessage) => {
    patch({ messages: [...chat.messages, msg] });
  };

  /**
   * Memory jobs (round summaries, secondary compression, backfill, recall
   * embeddings) run through this wrapped service, so every one of them lands
   * in the usage history. The main chat turn is recorded separately at the
   * `sendTurn` call site below.
   */
  const memoryLlm = React.useMemo(
    () => (llm ? wrapLlmForUsage(llm, { chatId: chat.id, label: card.data.name }) : null),
    [llm, chat.id, card.data.name],
  );

  /** Build the memory service bound to this chat's persisted records. */
  const memoryService = React.useMemo(
    () =>
      new MemoryService({
        llm: memoryLlm!,
        connections,
        settings: settings.memory,
        load: (chatId) => useApp.getState().memories[chatId] ?? [],
        save: (chatId, records) => useApp.getState().saveMemories(chatId, records),
      }),
    [memoryLlm, connections, settings.memory],
  );

  const buildCtx = (): ChatContext => ({
    chat,
    card,
    // Group chats resolve their cast through this list.
    cards: useApp.getState().cards,
    preset,
    persona,
    userBooks: lorebooks,
    settings,
    memory: {
      records: memories,
      settings: settings.memory,
      embed: (text) => memoryService.embed(text),
      persist: (records) => useApp.getState().saveMemories(chat.id, records),
    },
    tools: {
      settings: settings.tools,
      userName: persona?.name || '用户',
      characterName: card.data.name,
    },
    // J06/J07: in sub-model mode the main model must NOT be told to emit
    // `<ui_template_updates>` — the analysis runs after the turn instead
    // (see the generate() tail). Withholding the templates here is what
    // keeps the two modes from double-writing the same variables.
    uiTemplates:
      settings.uiTemplate.enabled && settings.uiTemplate.mainModelAnalysis
        ? uiTemplates.filter((t) => t.enabled && (t.scope === 'global' || t.scopeId === card.id))
        : [],
  });

  // ------------------------------------------------------------------ send
  async function generate(opts: {
    /** Message list to use instead of the stored one (for regeneration). */
    messages?: RPChatMessage[];
    /** Append a placeholder message with `id` that we stream into. */
    targetId?: string;
    impersonate?: boolean;
  } = {}) {
    if (!llm || !loop) {
      toast.error('内核尚未就绪');
      return;
    }
    if (!connection) {
      toast.error('还没有配置模型连接', '先到「设置 → 模型」里添加一个 API');
      return;
    }

    const base: RPChat = {
      ...chat,
      messages: opts.messages ?? chat.messages,
      // Variable writes during assembly must persist even if the request fails.
      variables: { ...chat.variables },
    };
    const ctx: ChatContext = { ...buildCtx(), chat: base };

    setBusy(true);
    setDraft({ text: '', reasoning: '' });
    // 新一轮生成开始：旧建议失效，正在生成的建议也停掉。
    suggestionsAbortRef.current?.abort();
    suggestionsAbortRef.current = null;
    suggestionsForRef.current = null;
    setSuggestions([]);
    const controller = new AbortController();
    abortRef.current = controller;
    replyBuzzedRef.current = false;
    const genStart = Date.now();
    genStartRef.current = genStart;
    // C06: 新一轮先清节流缓冲，避免上一轮的残字混进来。
    draftTextRef.current = '';
    draftReasoningRef.current = '';
    draftFlushedRef.current = { text: '', reasoning: '' };
    if (draftFlushTimerRef.current) {
      clearTimeout(draftFlushTimerRef.current);
      draftFlushTimerRef.current = null;
    }

    try {
      const { result, activation } = await sendTurn({
        ctx,
        loop,
        llm,
        connectionId: connection.id,
        model: chat.model || connection.defaultModel,
        signal: controller.signal,
        onDelta: (kind, delta) => {
          // First visible character of the reply: one light buzz.
          if (kind === 'text' && delta && !replyBuzzedRef.current) {
            replyBuzzedRef.current = true;
            vibrateMessage();
          }
          // C06: 60ms 节流——先攒进 ref，定时器到点才 setDraft，避免每个
          // delta 都触发一次全树渲染。
          if (kind === 'text') draftTextRef.current += delta;
          else draftReasoningRef.current += delta;
          if (!draftFlushTimerRef.current) {
            draftFlushTimerRef.current = setTimeout(flushDraft, 60);
          }
        },
      });

      // Usage history: one row per chat turn, with the provider-reported
      // tokens and wall-clock time. Fire-and-forget — a failed write must
      // never break the reply.
      void recordUsage({
        kind: 'chat',
        model: chat.model || connection.defaultModel,
        chatId: base.id,
        label: card.data.name,
        inputTokens: result.usage?.inputTokens,
        cachedTokens: result.usage?.cachedTokens,
        outputTokens: result.usage?.outputTokens,
        reasoningTokens: result.usage?.reasoningTokens,
        durationMs: Date.now() - genStart,
      });

      const targetIndex = opts.targetId
        ? base.messages.findIndex((m) => m.id === opts.targetId)
        : -1;
      let messages: RPChatMessage[];

      // UI templates: apply <ui_template_updates> then strip the block so the
      // stored reply is clean prose. Inline image markers are then generated.
      const afterTemplates = applyTemplateUpdates(result.text);
      const { text: replyText, images: replyImages, tags: replyTags, markers: replyMarkers } = await applyGeneratedImages(afterTemplates);
      // Inline CoT (DeepSeek/GLM/Kimi over OpenAI-compatible routes) is split
      // out so it never reaches the transcript as prose.
      const cot = parseCot(replyText);
      const reasoningText = [result.reasoning, cot.reasoning].filter(Boolean).join('\n\n').trim();
      // 文风过滤生成时生效（第 15 组只做了渲染层）：过滤后的正文才会存进
      // 消息、进记忆总结、进下一轮提示词；被删的片段记在 styleFilterHits
      // 里，渲染层弹层继续用它展示（渲染层对已过滤的文本不再重复命中，
      // 改读存量 hits）。
      const styleFilterHits: string[] = [];
      const finalText =
        (settings.chat.styleFilterEnabled ?? true)
          ? filterBlockedStyleText(cot.main, { enabled: true, collect: styleFilterHits })
          : cot.main;

      /*
       * Group chats: attribute every reply to a speaker. With `auto` we rotate
       * through the cast so the room actually feels multi-character; an explicit
       * `groupSpeaker` pins one voice.
       */
      const groupIds = chat.groupCardIds ?? [];
      const speakerForReply = (() => {
        if (!groupIds.length) return undefined;
        const all = useApp.getState().cards;
        const pin = chat.groupSpeaker;
        if (pin && pin !== 'auto') return all.find((c) => c.id === pin)?.data.name;
        const assistants = base.messages.filter((m) => m.role === 'assistant').length;
        const id = groupIds[assistants % groupIds.length];
        return all.find((c) => c.id === id)?.data.name;
      })();

      /*
       * Tool timeline (C03/D09): the loop collected `toolTrace` but nothing
       * persisted it, so the transcript could never show which tools ran.
       * Carry it on `meta` (a plain field, no type change) for the timeline
       * in MessageBubble; no tool-calling behaviour changes here.
       */
      const replyMeta: Record<string, unknown> | undefined =
        replyTags.length || result.toolTrace?.length
          ? {
              ...(replyTags.length ? { imageTags: replyTags, imageMarkers: replyMarkers } : {}),
              ...(result.toolTrace?.length ? { toolTrace: result.toolTrace } : {}),
            }
          : undefined;

      if (targetIndex >= 0) {
        // Swipe: keep prior variants so the user can flip back.
        messages = base.messages.map((m, i) => {
          if (i !== targetIndex) return m;
          const swipes = [...(m.swipes ?? [m.content]), finalText];
          return {
            ...m,
            content: finalText,
            swipes,
            swipeId: swipes.length - 1,
            reasoning: reasoningText || undefined,
            styleFilterHits: styleFilterHits.length ? styleFilterHits : undefined,
            model: connection.defaultModel,
            usage: result.usage ? { ...result.usage, durationMs: Date.now() - genStart } : undefined,
            images: replyImages.length ? replyImages : undefined,
            meta: (() => {
              const merged = { ...(m.meta ?? {}), ...(replyMeta ?? {}) };
              return Object.keys(merged).length ? merged : undefined;
            })(),
          };
        });
      } else {
        messages = [
          ...base.messages,
          {
            id: uid('m'),
            role: 'assistant',
            content: finalText,
            reasoning: reasoningText || undefined,
            styleFilterHits: styleFilterHits.length ? styleFilterHits : undefined,
            createdAt: Date.now(),
            model: chat.model || connection.defaultModel,
            usage: result.usage ? { ...result.usage, durationMs: Date.now() - genStart } : undefined,
            images: replyImages.length ? replyImages : undefined,
            meta: replyMeta,
            speaker: speakerForReply,
          },
        ];
      }

      onUpdate({ ...base, messages, activation: activation.newSnapshot });

      /*
       * Kernel events for plugins (酒馆助手-style renderers react to these).
       * Emitted AFTER the store update so handlers read the new floor. The
       * payload's `message_id` is the floor index — ST handlers do
       * `Number(message_id)` and index the `chat` global with it.
       */
      const kernel = useApp.getState().kernel;
      if (kernel) {
        const last = messages[messages.length - 1];
        const floorId = messages.length - 1;
        if (opts.targetId !== undefined) {
          kernel.events.emit('chat:message-regenerated', {
            chatId: base.id,
            message: last,
            message_id: floorId,
          });
        } else {
          kernel.events.emit('chat:message-received', {
            chatId: base.id,
            message: last,
            message_id: floorId,
          });
        }
      }

      // Auto-compress: when the prompt sits at/over the threshold share of the
      // context window, fold the oldest floors into a summary floor. Works even
      // with memory OFF (the user asked for it explicitly), and always announces
      // itself with a toast.
      maybeAutoCompress({ ...base, messages }, result.usage?.inputTokens);

      // Memory: summarise the round we just completed. Runs in the background —
      // a slow or failing summary must never block the reply the user is reading.
      if (settings.memory.mode !== 'off' && llm && base.messages.some((m) => m.role === 'assistant')) {
        void memoryService
          .summariseNewestRound({
            chat: { ...base, messages },
            card,
            personaName: persona?.name || '用户',
            fallbackConnectionId: connection?.id,
          })
          .then(() => {
            // `saveMemories` already updated the store, which re-renders this
            // component through the selector above. Appending here as well would
            // duplicate every memory.
          })
          .catch(() => {
            /* summarisation is best-effort */
          });
      }

      // Secondary compression (二次压缩) runs after the round summary so the
      // group always contains fresh per-round records.
      if (settings.memory.secondaryMode === 'on' && llm) {
        void memoryService
          .runSecondary({
            chat: { ...base, messages },
            card,
            personaName: persona?.name || '用户',
            fallbackConnectionId: connection?.id,
          })
          .catch(() => {
            /* best-effort */
          });
      }

      // J06/J07: sub-model UI template analysis runs after the turn, on the
      // newest `analysisDepth` floors. Background, best-effort — the reply
      // is already stored, so a slow analysis never blocks reading.
      if (settings.uiTemplate.enabled && !settings.uiTemplate.mainModelAnalysis) {
        void runSubModelAnalysis(messages).catch(() => {
          /* best-effort */
        });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Keep whatever streamed so far as a partial message. The text comes
        // from the throttle refs (C06), not the throttled state — the last
        // 60ms of deltas must not be lost when the user hits stop.
        // C08: loop 把中止时未跑完的工具调用挂在 err.toolTrace 上（每条
        // result 都是 {error:'生成已中止'}），一并存进这条消息的 meta，
        // 时间线会把它标成出错。
        const abortedTrace = (
          err as Error & { toolTrace?: Array<{ name: string; args: unknown; result: unknown }> }
        ).toolTrace;
        const partialText = draftTextRef.current;
        const partialReasoning = draftReasoningRef.current;
        if (partialText) {
          appendMessage({
            id: uid('m'),
            role: 'assistant',
            content: `${partialText}\n\n_(已中断)_`,
            reasoning: partialReasoning || undefined,
            createdAt: Date.now(),
            meta: abortedTrace?.length ? { toolTrace: abortedTrace } : undefined,
          });
        }
      } else {
        toast.error('生成失败', err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (draftFlushTimerRef.current) {
        clearTimeout(draftFlushTimerRef.current);
        draftFlushTimerRef.current = null;
      }
      setBusy(false);
      setDraft(null);
      abortRef.current = null;
    }
  }

  function send(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if ((!text && draftImages.length === 0) || busy) return;
    vibrate('send');
    // 点建议发送时只发建议本身：输入框里的草稿和已选图片都留着不动。
    const msg: RPChatMessage = {
      id: uid('m'),
      role: 'user',
      content: text,
      createdAt: Date.now(),
      images: overrideText ? undefined : draftImages.length ? draftImages : undefined,
    };
    const next = { ...chat, messages: [...chat.messages, msg] };
    onUpdate(next);
    if (!overrideText) {
      setInput('');
      setDraftImages([]);
    }
    stickToBottom.current = true;
    /*
     * Plugin events. ST extensions read the payload as the FLOOR INDEX
     * (`Number(message_id)` → `chat[message_id]`), so pass the array offset —
     * here the last slot of the array we just committed.
     */
    const kernel = useApp.getState().kernel;
    const floorId = next.messages.length - 1;
    kernel?.events.emit('chat:message-sent', {
      chatId: chat.id,
      message: msg,
      message_id: floorId,
    });
    void generate({ messages: next.messages });
  }

  function stop() {
    abortRef.current?.abort();
  }

  // ----------------------------------------------------------- message ops
  function swipe(messageId: string, dir: -1 | 1) {
    const messages = chat.messages.map((m) => {
      if (m.id !== messageId || !m.swipes?.length) return m;
      const count = m.swipes.length;
      const cur = m.swipeId ?? 0;
      let nextId = cur + dir;
      if (nextId < 0 && dir === -1) {
        // Swiping left past the first variant regenerates a new one.
        return m;
      }
      nextId = (nextId + count) % count;
      return { ...m, swipeId: nextId, content: m.swipes[nextId] };
    });
    patch({ messages });
  }

  // ----------------------------------------------------------- message ops
  function regenerate(messageId: string) {
    const idx = chat.messages.findIndex((m) => m.id === messageId);    if (idx === -1) return;
    const trimmed = chat.messages.slice(0, idx);
    void generate({ messages: trimmed, targetId: undefined });
    patch({ messages: trimmed });
    // Summaries for the removed round must go too, or the next prompt still
    // treats deleted history as real.
    void syncMemories(trimmed);
  }

  /**
   * 继续：不添加任何用户输入，直接带着现有上下文发请求，把剧情续写下去。
   * `generate` 不传 `messages` 时使用当前完整历史 → 新楼层追加在末尾。
   */
  function continueStory() {
    if (busy) return;
    vibrate('tap');
    void generate();
  }

  /**
   * Auto-compress the context at `settings.chat.compressThresholdPct` (default
   * 80%) of the window. The oldest floors (greeting stays) collapse into one
   * system summary floor; the user gets a toast so nothing disappears silently.
   *
   * Uses the provider's own `inputTokens` when present, else a chars÷3 estimate
   * — both are approximations, which is exactly why this is a soft threshold.
   */
  function maybeAutoCompress(target: RPChat, usedTokens?: number) {
    const chatSettings = settings.chat;
    const limit = chatSettings.contextTokens > 0 ? chatSettings.contextTokens : 1_000_000;
    const thresholdPct = chatSettings.compressThresholdPct ?? 80;
    const used =
      usedTokens ??
      Math.round(target.messages.reduce((sum, m) => sum + m.content.length, 0) / 3);
    if (used / limit < thresholdPct / 100) return;
    // Not enough history to be worth folding — a short chat never compresses.
    if (target.messages.length < 12) return;

    const KEEP_RECENT = 6;
    const compressFrom = 1; // keep the greeting (floor 0) verbatim
    const compressTo = target.messages.length - KEEP_RECENT;
    if (compressTo <= compressFrom) return;

    const folded = target.messages.slice(compressFrom, compressTo);
    const summary = folded
      .map((m) => `${m.speaker || (m.role === 'user' ? persona?.name || '用户' : card.data.name)}：${m.content.replace(/\s+/g, ' ').slice(0, 60)}`)
      .join('\n')
      .slice(0, 1200);
    const summaryFloor: RPChatMessage = {
      id: uid('m'),
      role: 'system',
      content: `【前情摘要 · 自动压缩】以下是被折叠的 ${folded.length} 条较早消息的概要：\n${summary}`,
      createdAt: Date.now(),
      hidden: false,
    };
    const next = [target.messages[0], summaryFloor, ...target.messages.slice(compressTo)];
    patch({ messages: next });
    void syncMemories(next);
    toast.info('上下文已自动压缩', '较早的对话已归纳为摘要楼层，正文可在分支/备份中找回。');
  }

  /** Drop memories that point at messages which no longer exist. */
  function syncMemories(messages: RPChatMessage[]) {
    const records = useApp.getState().memories[chat.id];
    if (!records?.length) return;
    const pruned = pruneMemories(records, messages);
    if (pruned.length === records.length && pruned === records) return;
    void useApp.getState().saveMemories(chat.id, pruned);
  }

  function toggleHidden(messageId: string) {
    patch({
      messages: chat.messages.map((m) => (m.id === messageId ? { ...m, hidden: !m.hidden } : m)),
    });
  }

  function removeMessage(messageId: string) {
    const next = chat.messages.filter((m) => m.id !== messageId);
    patch({ messages: next });
    void syncMemories(next);
  }

  function editMessage(messageId: string, content: string) {
    if (chat.messages.find((m) => m.id === messageId)?.content === content) {
      toast.info('消息未改动');
      return;
    }
    const nextMessages = chat.messages.map((m) => (m.id === messageId ? { ...m, content } : m));
    patch({ messages: nextMessages });
    // B07: 按轮重算总结——被改的消息所属那一轮的记忆总结按新正文重写，
    // 否则下次提示词里还是旧总结。没有对应记录（还没总结过）的轮次跳过；
    // 重算失败不打断编辑，旧总结继续留用。
    if (settings.memory.mode !== 'off') {
      const record = (useApp.getState().memories[chat.id] ?? []).find((r) =>
        [...(r.sourceUserIds ?? []), ...(r.sourceAssistantIds ?? [])].includes(messageId),
      );
      if (record) {
        void memoryService
          .regenerateRecord({
            chat: { ...chat, messages: nextMessages },
            card,
            personaName: persona?.name || '用户',
            record,
            fallbackConnectionId: connection?.id,
          })
          .then((records) => {
            if (records) toast.success('已重算本轮总结');
          })
          .catch(() => {
            /* best-effort */
          });
      }
    }
  }

  /**
   * Apply parsed `<ui_template_updates>` and persist the changed templates.
   * Shared by the main-model path (updates embedded in the reply) and the
   * sub-model path (updates from the post-turn analysis call) — only the
   * `source` recorded in the change log differs.
   *
   * Validation failures are skipped (and warned) rather than dropping the reply:
   * the model's prose is still worth keeping even if the state update is bogus.
   */
  function applyParsedUpdates(
    updates: Array<{ id: string; variables: Record<string, unknown> }>,
    source: 'main' | 'sub',
    model?: string,
  ): void {
    const store = useApp.getState();
    for (const update of updates) {
      const tpl = store.uiTemplates.find((t) => t.id === update.id);
      if (!tpl) continue;
      const errors = validateVariables(update.variables, tpl.initialVariableState, tpl.variableSchema);
      if (errors.length) {
        console.warn('[ui-template] 变量校验失败', errors);
        continue;
      }
      const changes = diffVariables(tpl.variableState, update.variables);
      if (!Object.keys(changes).length) continue;
      void store.saveUITemplate({
        ...tpl,
        variableState: { ...tpl.variableState, ...update.variables },
        changeLog: [
          {
            id: uid('chg'),
            time: Date.now(),
            source,
            model,
            changes,
          },
          ...tpl.changeLog,
        ].slice(0, 50),
      });
    }
  }

  /**
   * Apply `<ui_template_updates>` from a reply and return the clean body.
   */
  function applyTemplateUpdates(text: string): string {
    const updates = parseUpdates(text);
    if (!updates?.length) return text;
    applyParsedUpdates(updates, 'main', chat.model);
    return stripUpdateBlocks(text);
  }

  /**
   * J06/J07 sub-model analysis: after a turn, ask the analysis model to read
   * the most recent `analysisDepth` floors and update each enabled template.
   * Background, best-effort — a slow or failing analysis must never block the
   * reply the user is reading (same pattern as the memory summary above).
   */
  async function runSubModelAnalysis(messages: RPChatMessage[]): Promise<void> {
    const cfg = settings.uiTemplate;
    if (!cfg.enabled || cfg.mainModelAnalysis) return;
    const templates = uiTemplates.filter((t) => t.enabled && (t.scope === 'global' || t.scopeId === card.id));
    if (!templates.length) return;
    const svc = memoryLlm ?? llm;
    if (!svc || !connection) return;
    const model = cfg.model || chat.model || connection.defaultModel || '';
    try {
      const updates = await analyseTemplates({
        llm: svc,
        connectionId: connection.id,
        model,
        fallbackModel: chat.model || connection.defaultModel,
        templates,
        messages,
        depth: cfg.analysisDepth,
        injectContext: cfg.injectContext,
        personaName: persona?.name || '用户',
        characterName: card.data.name,
      });
      if (updates.length) applyParsedUpdates(updates, 'sub', model || undefined);
    } catch (err) {
      console.warn('[ui-template] 副模型分析失败', err);
    }
  }

  /**
   * Turn `image###Tag###` markers into real pictures.
   *
   * The stored reply keeps its prose (markers become a placeholder); the
   * pictures live in `message.images` so they survive reloads without bloating
   * the prompt.
   */
  async function applyGeneratedImages(text: string): Promise<{ text: string; images: string[]; tags: string[]; markers: string[] }> {
    const cfg = settings.imageGen;
    if (!cfg.enabled || !cfg.key || !cfg.autoGenerate) return { text, images: [], tags: [], markers: [] };
    const markers = parseImageMarkers(text);
    if (!markers.length) return { text, images: [], tags: [], markers: [] };

    const { width, height } = IMAGE_SIZES[cfg.size];
    const images: string[] = [];
    const tags: string[] = [];
    const usedMarkers: string[] = [];
    for (const marker of markers) {
      const normalized = normalizeTags(marker.tags);
      const base = {
        token: cfg.key,
        tags: normalized,
        model: cfg.model,
        width,
        height,
        artist: artistsForStyle(cfg.style, cfg.customArtists),
      };
      const submitted = await submitJob(base);
      if (!submitted.jobId) continue;
      const status = await pollJob(submitted.jobId, base);
      if (status.status === 'done' && status.imageUrl) {
        try {
          images.push(await fetchAsDataUrl(status.imageUrl));
          tags.push(normalized);
          // Keep the marker exactly as the model wrote it (raw spacing), so
          // a later reroll can find and rewrite it in the stored prose.
          usedMarkers.push(text.slice(marker.start, marker.end));
        } catch {
          /* a missing picture must not discard the reply */
        }
      }
    }
    return { text: stripImageMarkers(text), images, tags, markers: usedMarkers };
  }

  // Provider quota is best-effort: unsupported providers simply show nothing.
  React.useEffect(() => {
    if (!connection) {
      setQuota(null);
      return;
    }
    let cancelled = false;
    void fetchTokenQuota(connection.baseURL, connection.apiKey).then((q) => {
      if (!cancelled) setQuota(q);
    });
    return () => {
      cancelled = true;
    };
  }, [connection?.id, connection?.apiKey]);

  /** Fork a branch from an assistant message. */
  async function forkBranch(index: number) {    const target = chat.messages[index];
    if (!target || target.role !== 'assistant') {
      toast.error('只能从助手消息分支', '用户消息没有对应的回复，无法作为分叉点');
      return;
    }
    const branchId = await useApp.getState().createBranch(chat.id, index);
    if (branchId) toast.success('已创建分支', '当前正在新分支上继续');
  }

  function switchBranch(branchId: string) {
    void useApp.getState().switchBranch(chat.id, branchId);
  }

  function renameBranch(branchId: string, name: string) {
    void useApp.getState().renameBranch(chat.id, branchId, name);
  }

  function deleteBranch(branchId: string) {
    void useApp.getState().deleteBranch(chat.id, branchId);
  }

  // ------------------------------------------------------------------- view
  // ----------------------------------------------------------- message ops
  /** Token usage of the most recent reply, for the composer readout. */
  const latestUsage = React.useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const usage = chat.messages[i].usage;
      if (usage && (usage.inputTokens || usage.outputTokens)) return usage;
    }
    return null;
  }, [chat.messages]);

  /**
   * Composer usage bar (L04): the newest recorded chat turn. Prefers the
   * usage history (live-updated as turns complete); falls back to the newest
   * message's stored usage for turns made before history existed.
   */
  const usageHistory = useUsageHistory();
  const composerUsage = React.useMemo(() => {
    // Newest chat turn by time, not by array position — the history is
    // normally append-ordered, but never assume it.
    let newest: (typeof usageHistory)[number] | null = null;
    for (const r of usageHistory) {
      if (r.kind !== 'chat') continue;
      if (!newest || r.at > newest.at) newest = r;
    }
    return newest ?? latestUsage;
  }, [usageHistory, latestUsage]);

  /**
   * C09 预估等待秒数：最近 5 次主对话的平均耗时（用量历史里有 durationMs）。
   * 没有历史时不显示预估，只显示已等待秒数。
   */
  const estimatedSec = React.useMemo(() => {
    const durations = usageHistory
      .filter((r) => r.kind === 'chat' && r.durationMs)
      .slice(-5)
      .map((r) => r.durationMs as number);
    if (!durations.length) return null;
    return Math.max(1, Math.round(durations.reduce((a, b) => a + b, 0) / durations.length / 1000));
  }, [usageHistory]);


  /** Templates visible for this character, with their live state. */
  const activeTemplates = settings.uiTemplate.enabled
    ? uiTemplates
        .filter((t) => t.enabled && (t.scope === 'global' || t.scopeId === card.id))
        .sort((a, b) => b.order - a.order)
        .map((tpl) => ({ tpl, state: tpl.variableState }))
    : [];

  /**
   * Reroll one picture: swap two adjacent tags and regenerate, keeping the
   * model's composition but changing the picture.
   */
  async function rerollImage(messageId: string, imageIndex: number) {
    const cfg = settings.imageGen;
    if (!cfg.enabled || !cfg.key) return;
    const msg = chat.messages.find((m) => m.id === messageId);
    const tags = (msg?.meta?.imageTags as string[] | undefined)?.[imageIndex];
    if (!tags) return;
    const { tags: next, swapped } = rerollTags(tags);
    if (!swapped) {
      toast.error('提示词太短，无法重新生成', '至少需要两个 Tag 才能交换');
      return;
    }
    const { width, height } = IMAGE_SIZES[cfg.size];
    const base = { token: cfg.key, tags: next, model: cfg.model, width, height, nocache: true, artist: artistsForStyle(cfg.style, cfg.customArtists) };
    const submitted = await submitJob(base);
    if (!submitted.jobId) {
      toast.error('生成失败', submitted.error ?? '没有拿到任务 id');
      return;
    }
    const status = await pollJob(submitted.jobId, base);
    if (status.status !== 'done' || !status.imageUrl) {
      toast.error('生成失败', status.error ?? `任务状态：${status.status}`);
      return;
    }
    try {
      const dataUrl = await fetchAsDataUrl(status.imageUrl);
      patch({
        messages: chat.messages.map((m) => {
          if (m.id !== messageId) return m;
          const images = [...(m.images ?? [])];
          images[imageIndex] = dataUrl;
          const tagList = [...((m.meta?.imageTags as string[] | undefined) ?? [])];
          tagList[imageIndex] = next;
          // I08: rewrite the picture's marker in the stored prose (when the
          // raw marker is still there) and keep the tag↔marker mapping in
          // sync for the next reroll.
          const markerList = [...((m.meta?.imageMarkers as string[] | undefined) ?? [])];
          const oldMarker = markerList[imageIndex];
          const nextMarker = markerForTags(next);
          if (oldMarker) markerList[imageIndex] = nextMarker;
          return {
            ...m,
            ...(oldMarker ? { content: rewriteImageMarker(m.content, oldMarker, nextMarker) } : {}),
            images,
            meta: { ...(m.meta ?? {}), imageTags: tagList, ...(markerList.length ? { imageMarkers: markerList } : {}) },
          };
        }),
      });
      toast.success('已重新生成');
    } catch {
      toast.error('生成失败', '图片读取失败');
    }
  }

  /** A `data-slash` click inside a template becomes a normal user message. */
  function sendTemplateSlash(text: string) {
    const msg: RPChatMessage = { id: uid('m'), role: 'user', content: text, createdAt: Date.now() };
    const next = [...chat.messages, msg];
    patch({ messages: next });
    void generate({ messages: next });
  }

  const immersive = settings.render.useCharacterBackground && Boolean(card.avatar);
  /**
   * M02 沉浸模式：隐藏标题/消息时间、消息列收窄，专注阅读。跟上面那个
   * `immersive`（角色封面背景）是两回事：封面背景管底图，沉浸模式管版式。
   * N02: 快捷面板可按聊天覆盖沉浸模式（`chat.params.immersiveMode`），
   * 没覆盖时跟随全局 `settings.render.immersiveMode`。
   */
  const immersiveMode = chatImmersive(chat, settings);

  /**
   * R04/N03: 模型选择器选定模型 → 设为本聊天模型；若该模型属于某个槽位，
   * 记下槽位归属，否则清除槽位归属（自定义模型）。
   */
  const applyPickedModel = (modelId: string) => {
    const slot = slotIdForModel(settings, modelId);
    const params = { ...(chat.params ?? {}) };
    if (slot) params.modelSlot = slot;
    else delete params.modelSlot;
    patch({ model: modelId, params });
  };

  /**
   * R04/N03: 保存三槽位草稿（全局设置），并把当前槽位的模型设为本聊天
   * 模型（RP-Hub `selectQuickModels` 的行为）；当前槽位为空时只存槽位。
   */
  const applySlotDrafts = (drafts: [string, string, string], activeSlot: number) => {
    setSettings({
      chat: {
        ...settings.chat,
        qualityModel: drafts[0],
        balancedModel: drafts[1],
        fastModel: drafts[2],
      },
    });
    const active = drafts[activeSlot]?.trim();
    if (active) {
      patch({ model: active, params: { ...(chat.params ?? {}), modelSlot: MODEL_SLOTS[activeSlot].id } });
    }
  };

  const openModelPicker = (target: ModelPickerTarget) => {
    setModelPickerTarget(target);
    setModelPickerOpen(true);
    setQuickPanelOpen(false);
  };

  /**
   * A07: character intro stats — floors, raw characters, and (when memory is
   * on) a compressed-size forecast: the newest `keepRecentRounds` rounds stay
   * verbatim, older rounds collapse into their memory summaries (already
   * written summaries at face value, not-yet-summarised rounds at the average
   * summary length so far, 150 chars/round before any summary exists).
   */
  const charStats = React.useMemo(() => {
    const msgs = chat.messages;
    const floors = msgs.length;
    const chars = msgs.reduce((s, m) => s + (m.content ?? '').length, 0);
    const tokens = estimateTokens(msgs.map((m) => m.content ?? '').join('\n'));
    const memoryOn = settings.memory.mode !== 'off';
    let compressed: number | null = null;
    let compressedNote = '';
    if (memoryOn) {
      const keep = settings.memory.keepRecentRounds;
      let assistantSeen = 0;
      let recentChars = 0;
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (m.role === 'assistant') {
          if (assistantSeen >= keep) break;
          assistantSeen++;
        }
        recentChars += (m.content ?? '').length;
        if (m.role === 'user' && assistantSeen >= keep) break;
      }
      const rounds = msgs.filter((m) => m.role === 'assistant').length;
      const oldRounds = Math.max(0, rounds - keep);
      let coveredRounds = 0;
      let summaryChars = 0;
      for (const rec of memories) {
        const span = (rec.turnEnd ?? rec.turn) - (rec.turnStart ?? rec.turn) + 1;
        coveredRounds += Math.max(1, span);
        summaryChars += (rec.summary ?? '').length;
      }
      const pendingRounds = Math.max(0, oldRounds - coveredRounds);
      const avgSummary = coveredRounds > 0 ? summaryChars / coveredRounds : 150;
      compressed = Math.round(recentChars + summaryChars + pendingRounds * avgSummary);
      compressedNote =
        coveredRounds > 0
          ? `按已有 ${coveredRounds} 轮记忆总结（平均每轮约 ${Math.round(avgSummary)} 字）估算`
          : '暂无记忆总结，按每轮约 150 字估算';
    }
    return { floors, chars, tokens, memoryOn, compressed, compressedNote };
  }, [chat.messages, memories, settings.memory]);

  /**
   * Chat title. Group chats are named by their cast joined with `&`; solo
   * chats use the character name.
   */
  const chatTitle = React.useMemo(() => {
    const ids = chat.groupCardIds ?? [];
    if (!ids.length) return card.data.name;
    const allCards = useApp.getState().cards;
    const names = ids
      .map((id) => allCards.find((c) => c.id === id)?.data.name)
      .filter(Boolean);
    return names.length ? names.join(' & ') : card.data.name;
  }, [chat.groupCardIds, card.data.name]);

  return (
    /*
      Two layers, deliberately separated:
        outer — fills the screen and owns the BACKGROUND. It must NOT shrink
                when the keyboard opens, or the art would be squeezed into a
                letterbox above the keyboard.
        inner — the actual UI column; clamped to the visual viewport so the
                header stays pinned and only the transcript gives up space.
    */
    <div className="relative h-full min-h-0 w-full overflow-hidden">
      {/* Background layer: full-bleed character art, immune to the keyboard. */}
      {immersive && card.avatar && (
        <>
          <img
            src={card.avatar}
            alt=""
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 w-full object-cover"
            style={{
              // 键盘弹起时布局视口会缩（interactive-widget=resizes-content），
              // 但立绘不能跟着缩——否则人物会突然变小、裁切也变了，看着像
              // 背景被缩放了。所以立绘保持键盘没弹起时的满屏高度（外层高
              // 度＋键盘占的高度），多出来的部分被外层的 overflow-hidden
              // 裁掉，露出来的上半截和键盘没弹起时一模一样。
              // 只在布局视口真的缩了时才补高度（layoutResized）；旧版浏览
              // 器上布局没缩，外层本来就是满屏高，补了反而会撑大。
              height: layoutResized ? `calc(100% + ${keyboardInset}px)` : '100%',
            }}
          />
          <div
            aria-hidden="true"
            // 盖在立绘上的遮罩跟随主题：深色主题用黑色渐变（白字可读），
            // 浅色主题用主题底色（--rp-bg）的浅色渐变（深色字可读），
            // 颜色始终取自当前主题预设的 token，不写死。
            className="pointer-events-none absolute inset-x-0 top-0 w-full bg-gradient-to-b dark:from-black/55 dark:via-black/45 dark:to-black/70 from-[var(--rp-bg)]/70 via-[var(--rp-bg)]/55 to-[var(--rp-bg)]/80"
            style={{
              // 和立绘同理：遮罩也保持满屏高度，露出来的渐变和键盘没弹起
              // 时是同一段，不会因为压短而变暗。
              height: layoutResized ? `calc(100% + ${keyboardInset}px)` : '100%',
            }}
          />
        </>
      )}

      {/*
        Top/bottom fades belong to the background layer so the keyboard cannot
        resize them: they always hug the real screen edges.
      */}
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 top-0 z-[1] h-28',
          immersive
            ? 'bg-gradient-to-b dark:from-black/70 dark:via-black/25 from-[var(--rp-bg)]/85 via-[var(--rp-bg)]/40 to-transparent'
            : 'bg-gradient-to-b from-[var(--rp-bg)] via-[var(--rp-bg)]/70 to-transparent',
        )}
      />
      <div
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-28',
          immersive
            ? 'bg-gradient-to-t dark:from-black/70 dark:via-black/25 from-[var(--rp-bg)]/85 via-[var(--rp-bg)]/40 to-transparent'
            : 'bg-gradient-to-t from-[var(--rp-bg)] via-[var(--rp-bg)]/70 to-transparent',
        )}
      />

      {/* UI layer. */}
      <div
        className="relative flex h-full min-h-0 flex-col"
        style={
          keyboardInset && !layoutResized
            ? {
                // 旧版浏览器（布局视口不随键盘收缩）才需要这层手动扣减：把 UI
                // 层夹到键盘上方的可视区里，顶栏不被顶出屏幕，缩的是消息区。
                // 新版 Chrome 上 viewport meta 已经让布局视口自己缩了，这时
                // 整个页面本来就只有可视区那么高，再扣一次会把输入框也扣没。
                height: `calc(100% - ${keyboardInset}px)`,
                maxHeight: `calc(100dvh - ${keyboardInset}px)`,
              }
            : undefined
        }
      >
      {/* Chat header — minimal: menu / name / settings. `shrink-0` plus the
          shell's height clamp keeps it pinned while the keyboard is open. */}
      <header
        className={cn(
          'relative z-10 flex shrink-0 items-center gap-1.5 px-2 pt-[calc(env(safe-area-inset-top,0px)+0.4rem)] pb-1.5 sm:px-3',
          immersive ? 'dark:text-white text-[var(--rp-fg)]' : 'border-b border-[var(--rp-border)] px-3 py-2 sm:px-4',
        )}
      >
        <button
          type="button"
          aria-label="打开聊天列表"
          onClick={() => {
            vibrate('tap');
            onOpenList?.();
          }}
          className={cn(
            'flex size-10 cursor-pointer items-center justify-center rounded-lg transition-colors',
            immersive ? 'dark:hover:bg-white/10 hover:bg-[var(--rp-fg)]/10' : 'hover:bg-[var(--rp-bg-sunken)]',
          )}
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>

        {/* M02: 沉浸模式隐藏标题（名字/分支名），只留两侧按钮，进出设置不受影响。 */}
        {!immersiveMode && (
          <div className="min-w-0 flex-1 text-center">
            <button
              type="button"
              onClick={() => setCharPanelOpen((v) => !v)}
              aria-expanded={charPanelOpen}
              aria-label="查看角色简介与聊天统计"
              title="查看角色简介与聊天统计"
              className="mx-auto block max-w-full cursor-pointer rounded-lg px-2 py-0.5 transition-colors hover:bg-[var(--rp-bg-sunken)]"
            >
              <span className="block truncate text-[15px] font-semibold leading-tight">{chatTitle}</span>
              {chat.activeBranchId && chat.activeBranchId !== MAIN_BRANCH && (
                <span className="block truncate text-[10.5px] text-[var(--rp-accent)]">
                  {chat.branches?.find((b) => b.id === chat.activeBranchId)?.name ?? '分支'}
                </span>
              )}
            </button>
          </div>
        )}
        {immersiveMode && <div className="min-w-0 flex-1" aria-hidden="true" />}

        {/* A07: character intro panel — floors / chars / compressed forecast.
            Portaled to the body (same transformed-ancestor reason as the
            message editor): inside the header it would paint under the
            transcript and its buttons would be unclickable. */}
        {charPanelOpen && !immersiveMode &&
          createPortal(
            <>
              <button
                type="button"
                aria-label="关闭角色简介"
                onClick={() => setCharPanelOpen(false)}
                className="fixed inset-0 z-40 cursor-default bg-black/20"
              />
              <div
                role="dialog"
                aria-label="角色简介"
                className="fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+3.75rem)] z-50 w-[min(24rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3 shadow-rp"
              >
              <div className="flex items-start gap-2.5">
                {card.avatar ? (
                  <img src={card.avatar} alt="" className="size-11 shrink-0 rounded-full border border-[var(--rp-border)] object-cover" />
                ) : (
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--rp-accent)] text-[16px] font-bold text-[var(--rp-accent-fg)]">
                    {card.data.name.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold">{card.data.name}</p>
                  <p className="mt-0.5 text-[11.5px] tabular-nums leading-relaxed text-[var(--rp-fg-muted)]">
                    {charStats.floors} 楼 · {charStats.chars.toLocaleString()} 字 · 约{' '}
                    {charStats.tokens.toLocaleString()} tokens
                  </p>
                  {charStats.memoryOn && charStats.compressed !== null ? (
                    <p className="text-[11.5px] tabular-nums leading-relaxed text-[var(--rp-fg-muted)]">
                      记忆开启 → 压缩后约 {charStats.compressed.toLocaleString()} 字（预测）
                      <span className="block text-[10.5px] text-[var(--rp-fg-subtle)]">{charStats.compressedNote}</span>
                    </p>
                  ) : (
                    <p className="text-[11.5px] leading-relaxed text-[var(--rp-fg-subtle)]">记忆未开启</p>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="关闭"
                  onClick={() => setCharPanelOpen(false)}
                  className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--rp-fg-subtle)] hover:text-[var(--rp-fg)]"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>
              {card.data.description?.trim() && (
                <p className="rp-scroll mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-[var(--rp-bg-sunken)]/60 p-2 text-[12px] leading-relaxed text-[var(--rp-fg-muted)]">
                  {card.data.description}
                </p>
              )}
              <div className="mt-2.5 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setCharPanelOpen(false);
                    if (onOpenCards) onOpenCards();
                    else onNavigate?.('cards');
                  }}
                >
                  编辑角色
                </Button>
              </div>
              </div>
            </>,
            document.body,
          )}

        {/* Single right-side control: opens the right side panel (对话设置).
            Regenerate lives in each assistant message's action row; scene
            image / prompt inspector / branches / fullscreen / clear live in
            this panel and the ＋ sheet. */}
        <button
          type="button"
          aria-label="打开对话设置"
          onClick={() => {
            vibrate('tap');
            onOpenSettings?.();
          }}
          className={cn(
            'flex size-10 cursor-pointer items-center justify-center rounded-lg transition-colors',
            immersive ? 'dark:hover:bg-white/10 hover:bg-[var(--rp-fg)]/10' : 'hover:bg-[var(--rp-bg-sunken)]',
          )}
        >
          <SlidersHorizontal className="size-5" aria-hidden="true" />
        </button>
      </header>

      {/* Transcript */}
      {/*
        Gradient fades live on the BACKGROUND layer (see the outer wrapper), not
        here: if they were inside the keyboard-clamped UI column they would
        shrink with it and visibly move when the keyboard opens.
      */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        id="chat"
        className={cn(
          'rp-no-scrollbar relative z-10 mx-auto flex min-h-0 w-full flex-1 flex-col gap-5 overflow-y-auto px-3 py-4 sm:px-5',
          // M02: 沉浸模式消息居中窄列（桌面 50vw；手机保持满宽，不挤压）。
          immersiveMode
            ? 'max-w-xl sm:max-w-[50vw]'
            : settings.render.messageWidth === 'narrow'
              ? 'max-w-3xl'
              : 'max-w-5xl',
        )}
      >
        {chat.messages.length === 0 && !draft ? (
          /*
           * `#chat > .welcomePanel` — SillyTavern's empty-chat anchor. TH uses it
           * to decide when the first full re-scan happens (immediately when this
           * node exists, otherwise a 3s fallback). It must be a DIRECT child of
           * `#chat`, exactly like `.mes[mesid]`.
           */
          <div className="welcomePanel flex w-full flex-wrap items-start justify-center gap-2">
            <EmptyState
              icon={<Bot className="size-6" aria-hidden="true" />}
              title="这段对话还没有开始"
              description="发送第一条消息，或者让角色先来打个招呼。"
              action={
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" onClick={() => appendMessage({ id: uid('m'), role: 'assistant', content: card.data.first_mes, createdAt: Date.now(), isGreeting: true })}>
                    让 {card.data.name} 先开口
                  </Button>
                  <Button size="sm" variant="outline" onClick={onOpenCards}>
                    更换角色
                  </Button>
                </div>
              }
            />
          </div>
        ) : (
          <>
            {/*
              Windowing. A 500-floor transcript is tens of thousands of DOM
              nodes; rendering all of them makes scrolling unusable. Only the
              newest `visibleCount` floors are mounted, and reaching the top
              reveals another batch.
            */}
            {hiddenCount > 0 && (
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={() => {
                    vibrate('tap');
                    setVisibleCount((n) => n + PAGE_SIZE);
                  }}
                  className="cursor-pointer rounded-full border border-[var(--rp-border)] px-3.5 py-1.5 text-[12px] text-[var(--rp-fg-muted)] transition-colors hover:bg-[var(--rp-bg-sunken)]"
                >
                  加载更早的 {Math.min(PAGE_SIZE, hiddenCount)} 条（还有 {hiddenCount} 条）
                </button>
              </div>
            )}
            {chat.messages.slice(hiddenCount).map((m, i) => {
              const index = i + hiddenCount;
              return (
              <MessageBubble
                key={m.id}
                preset={preset}
                message={m}
                index={index}
                card={card}
                personaName={persona?.name}
                personaAvatar={persona?.avatar}
                allowExternalMedia={settings.render.allowExternalMedia}
                showReasoning={settings.chat.showReasoning}
                onRegenerate={regenerate}
                onSwipe={(id, dir) => {
                  swipe(id, dir);
                  // ST `MESSAGE_SWIPED` payload = message_id (chat 数组下标)
                  const idx =
                    useApp.getState().chats.find((c) => c.id === chat.id)?.messages.findIndex((m) => m.id === id) ?? -1;
                  useApp.getState().kernel?.events.emit('chat:swiped', { chatId: chat.id, message_id: idx });
                }}
                onDelete={(id) => {
                  const current = useApp.getState().chats.find((c) => c.id === chat.id)?.messages.length ?? 0;
                  removeMessage(id);
                  /*
                   * ST 的 `MESSAGE_DELETED` 传的是**删除后的剩余长度**
                   * （script.js:1611 `emit(MESSAGE_DELETED, chat.length)`），
                   * 不是被删的 id。此处同步读会拿到旧值，故用长度-1。
                   */
                  useApp.getState().kernel?.events.emit('chat:message-deleted', {
                    chatId: chat.id,
                    message_id: Math.max(0, current - 1),
                  });
                }}
                onEdit={(id, content) => {
                  editMessage(id, content);
                  const idx =
                    useApp.getState().chats.find((c) => c.id === chat.id)?.messages.findIndex((m) => m.id === id) ?? -1;
                  useApp.getState().kernel?.events.emit('chat:message-edited', { chatId: chat.id, message_id: idx });
                }}
                onToggleHidden={toggleHidden}
                onFork={forkBranch}
                templates={activeTemplates}
                onTemplateSlash={sendTemplateSlash}
                onRerollImage={(i) => rerollImage(m.id, i)}
                fontSize={settings.render.fontSize}
                chatId={chat.id}
                sandboxHtml={settings.render.sandboxHtml}
                immersive={immersive}
                hideMeta={immersiveMode}
                depth={Math.max(0, chat.messages.length - 1 - index)}
                isLast={index === chat.messages.length - 1}
                onContinue={continueStory}
                usage={index === chat.messages.length - 1 ? latestUsage : undefined}
                quotaText={
                  index === chat.messages.length - 1 && quota
                    ? `额度 ${quota.used.toLocaleString()}/${quota.total.toLocaleString()}`
                    : undefined
                }
                onCopy={async (t) => {
                  await navigator.clipboard.writeText(stripCitations(t));
                  toast.success('已复制');
                }}
              />
              );
            })}

            {draft && (
              <MessageBubble
                message={{
                  id: 'draft',
                  role: 'assistant',
                  content: draft.text || '…',
                  reasoning: draft.reasoning || undefined,
                  createdAt: Date.now(),
                }}
                index={chat.messages.length}
                card={card}
                preset={preset}
                allowExternalMedia={settings.render.allowExternalMedia}
                showReasoning={settings.chat.showReasoning}
                hideMeta={immersiveMode}
                streaming
              />
            )}
            {/* C09: 生成等待计时——已等待秒数 + 最近 5 次平均耗时预估。 */}
            {busy && (
              <div className="flex items-center gap-1.5 text-[11px] text-[var(--rp-fg-subtle)]" role="status">
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                <span>
                  正在生成… 已等待 {waitedSec}s{estimatedSec ? ` / 约 ${estimatedSec}s` : ''}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Jump-to-edge pill: floats over the transcript, above the composer. */}
      {jumpHint !== 'none' && (
        <button
          type="button"
          aria-label={jumpHint === 'top' ? '回到顶部' : '回到底部'}
          onClick={() => {
            const el = scrollRef.current;
            if (!el) return;
            el.scrollTo({
              top: jumpHint === 'top' ? 0 : el.scrollHeight,
              behavior: 'smooth',
            });
          }}
          className={cn(
            'absolute bottom-[7.5rem] right-3 z-20 flex size-9 cursor-pointer items-center justify-center rounded-full',
            // 浮在正文上的圆形按钮也跟随主题：浅色用浅色磨砂，深色才用黑底。
            'border backdrop-blur-md transition-colors sm:right-5',
            'border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]/90 text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-elevated)]',
            'dark:border-white/15 dark:bg-black/45 dark:text-white/85 dark:hover:bg-black/60',
          )}
        >
          {jumpHint === 'top' ? (
            <ChevronUp className="size-4" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-4" aria-hidden="true" />
          )}
        </button>
      )}

      {/* Plugins may inject above the composer. */}
      <SlotOutlet slot={SLOT.COMPOSER} componentProps={{ chat, card }} />
      {/* 聊天建议：AI 回完后给出的接话，点一下直接发送；× 是收起。 */}
      {suggestions.length > 0 && !busy && (
        <div className="relative z-10 flex shrink-0 items-center gap-2 px-3 pb-1 pt-2 sm:px-5">
          <div className="rp-no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  vibrate('tap');
                  setSuggestions([]);
                  send(s);
                }}
                className="shrink-0 cursor-pointer truncate rounded-full border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] px-3 py-1.5 text-[12.5px] text-[var(--rp-fg)] hover:bg-[var(--rp-bg-sunken)]"
              >
                {s}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSuggestions([])}
            aria-label="隐藏聊天建议"
            className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)]"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      {/* Composer — Tavo-style: [+ attachment] [pill input] [round send]. */}
      <div
        ref={composerRef}
        className={cn(
          'relative z-10 flex shrink-0 justify-center px-3 pt-2 sm:px-5',
          immersive ? '' : 'border-t border-[var(--rp-border)] bg-[var(--rp-bg)]',
        )}
        style={{
          // `.rp-safe-b` would *replace* any Tailwind pb-* (same property), so
          // the base margin is baked in here: 20px breathing room + the gesture
          // bar inset when idle; 20px above the keyboard.
          paddingBottom: keyboardOpen
            ? '1.25rem'
            : 'calc(1.25rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="relative w-full max-w-3xl">
          {/* N02/N03: 输入岛快捷面板（温度/推理强度/流式/沉浸/模型槽位）。 */}
          {quickPanelOpen && (
            <div className="absolute bottom-full right-0 z-40 mb-2">
              <ChatQuickPanel
                chat={chat}
                settings={settings}
                presetTemperature={preset.temperature}
                currentModel={chat.model || connection?.defaultModel || ''}
                onPatchChat={patch}
                onOpenModelPicker={openModelPicker}
                onClose={() => setQuickPanelOpen(false)}
              />
            </div>
          )}
          {draftImages.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {draftImages.map((src, i) => (
                <div key={i} className="relative">
                  <img
                    src={src}
                    alt={`附件 ${i + 1}`}
                    className="size-14 rounded-lg border border-white/20 object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`移除附件 ${i + 1}`}
                    onClick={() => setDraftImages((list) => list.filter((_, idx) => idx !== i))}
                    className="absolute -right-1 -top-1 flex size-5 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white hover:text-[var(--rp-danger)]"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div
            className={cn(
              // Round-cornered rectangle, always. No focus morph: the ＋ plate
              // stays put, the height is constant, and the border does not
              // change on focus (user preference).
              'flex items-center gap-1.5 rounded-2xl p-1.5 pl-1 transition-colors',
              immersive
                ? 'dark:bg-black/45 bg-[var(--rp-bg-elevated)]/85 backdrop-blur-md'
                : 'border border-[var(--rp-border-strong)] bg-[var(--rp-bg-elevated)] shadow-sm',
            )}
          >
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label="打开操作面板"
              aria-expanded={sheetOpen}
              className={cn(
                'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
                immersive
                  ? 'dark:text-white/80 dark:hover:bg-white/10 text-[var(--rp-fg-muted)] hover:bg-[var(--rp-fg)]/10'
                  : 'text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)]',
              )}
            >
              <Plus className="size-5" aria-hidden="true" />
            </button>
            {/* N02: 快捷面板开关（模型槽位/温度/推理强度/流式/沉浸）。 */}
            <button
              type="button"
              onClick={() => setQuickPanelOpen((v) => !v)}
              aria-label="快捷面板"
              aria-expanded={quickPanelOpen}
              className={cn(
                'flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full transition-colors',
                immersive
                  ? 'dark:text-white/80 dark:hover:bg-white/10 text-[var(--rp-fg-muted)] hover:bg-[var(--rp-fg)]/10'
                  : 'text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)]',
                quickPanelOpen && 'bg-[var(--rp-accent)]/15 text-[var(--rp-accent)]',
              )}
            >
              <SlidersHorizontal className="size-5" aria-hidden="true" />
            </button>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              placeholder={
                // Keyboard hints are meaningless on touch devices — they have a
                // return key, not Shift+Enter. Show a plain prompt there.
                isTouchDevice()
                  ? persona?.name
                    ? `以 ${persona.name} 的身份说点什么…`
                    : '说点什么…'
                  : persona?.name
                    ? `以 ${persona.name} 的身份说点什么…  (Enter 发送 · Shift+Enter 换行)`
                    : '说点什么…  (Enter 发送 · Shift+Enter 换行)'
              }
              aria-label="消息输入框"
              className={cn(
                'rp-no-scrollbar max-h-[40vh] min-h-[38px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[15px] leading-relaxed outline-none',
                // 沉浸模式下输入框坐在半透明底上：深色主题才强制白字白光标；
                // 浅色主题用主题前景色和主题光标色，和非沉浸模式一致。
                immersive
                  ? 'dark:text-white dark:caret-white dark:placeholder:text-white/45 text-[var(--rp-fg)] caret-[var(--rp-accent)] placeholder:text-[var(--rp-fg-subtle)]'
                  : 'text-[var(--rp-fg)] caret-[var(--rp-accent)] placeholder:text-[var(--rp-fg-subtle)]',
              )}
              style={{ height: 'auto' }}
              onInput={(e) => {
                const el = e.currentTarget;
                el.style.height = 'auto';
                // Cap at 5 lines of the current leading (line-height 1.7 at
                // 15px ≈ 25.5px per line + vertical padding).
                const cs = getComputedStyle(el);
                const line = parseFloat(cs.lineHeight) || 25.5;
                const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
                el.style.height = `${Math.min(el.scrollHeight, Math.round(line * 5 + pad))}px`;
              }}
            />
            <input
              ref={imageInput}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = Array.from(e.target.files ?? []);
                // RP-Hub caps each picture at 20MB; oversize files are skipped
                // with a warning instead of failing the whole batch.
                const tooBig = files.filter((f) => f.size > 20 * 1024 * 1024);
                if (tooBig.length) toast.error('图片超过 20MB，已跳过', `${tooBig.length} 张`);
                const kept = files.filter((f) => f.size <= 20 * 1024 * 1024);
                // Compress to 1600px / JPEG 0.86 before storing on the message
                // so a 9-picture turn does not bloat the chat or the prompt.
                const urls = await Promise.all(kept.map((f) => compressImageFile(f)));
                setDraftImages((list) => [...list, ...urls].slice(0, 9));
                e.target.value = '';
              }}
            />
            {busy ? (
              <button
                type="button"
                onClick={stop}
                aria-label="停止生成"
                className="flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--rp-danger)] text-white transition-transform active:scale-95"
              >
                <Ban className="size-5" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => send()}
                disabled={!input.trim() && draftImages.length === 0}
                aria-label="发送"
                className={cn(
                  'flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--rp-accent)] text-[var(--rp-accent-fg)]',
                  'transition-all duration-200 disabled:opacity-40 active:scale-95',
                  // A small pop the moment the composer has something to send.
                  (input.trim() || draftImages.length > 0) && 'rp-send-ready',
                )}
              >
                <ArrowUp className="size-5" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Latest usage bar (L04): tap to open the usage page. */}
          {composerUsage && (composerUsage.inputTokens || composerUsage.outputTokens) ? (
            <button
              type="button"
              onClick={() => onNavigate?.('usage')}
              aria-label="查看用量统计"
              className="mt-1.5 flex w-full cursor-pointer items-center justify-center gap-1 text-[11px] text-[var(--rp-fg-muted)] hover:text-[var(--rp-fg)]"
            >
              输入 {formatTokens(composerUsage.inputTokens)} · 缓存 {formatTokens(composerUsage.cachedTokens)} · 输出{' '}
              {formatTokens(composerUsage.outputTokens)}
            </button>
          ) : null}

          {/*
            Keyboard helper row: only while the on-screen keyboard is up, so it
            never steals space from the transcript on a phone at rest.
            Generous bottom padding: the row sits right above the keyboard and
            needs real breathing room from the keys.
          */}
          {keyboardOpen && (
            <div className="mt-2 flex items-center gap-2 pb-1">
              <button
                type="button"
                aria-label="打开长文本编辑"
                onClick={() => setComposerExpanded(true)}
                className={cn(
                  'flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12px] transition-colors',
                  immersive
                    ? 'dark:bg-black/45 dark:text-white/85 bg-[var(--rp-bg-elevated)]/85 text-[var(--rp-fg)] backdrop-blur-sm'
                    : 'bg-[var(--rp-bg-sunken)] text-[var(--rp-fg-muted)]',
                )}
              >
                <Maximize2 className="size-3.5" aria-hidden="true" /> 编辑
              </button>

              {/* Quote / bracket inserters sit on the far right. */}
              <div className="ml-auto flex items-center gap-2">
                <InsertChip label="插入引号" onInsert={() => insertAtCursor('“”', 1)} immersive={immersive}>
                  “
                </InsertChip>
                <InsertChip label="插入括号" onInsert={() => insertAtCursor('()', 1)} immersive={immersive}>
                  ( )
                </InsertChip>
              </div>
            </div>
          )}
        </div>
      </div>

      {/*
        Long-text editor. Typing a paragraph in a one-line composer is painful
        on a phone, so the ＋-row "编辑" button opens this full-height sheet.
      */}
      {composerExpanded && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-[var(--rp-bg)]" role="dialog" aria-label="编辑消息">
          <div className="flex shrink-0 items-center gap-2 border-b border-[var(--rp-border)] px-3 py-2 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)]">
            <button
              type="button"
              aria-label="完成编辑"
              onClick={() => setComposerExpanded(false)}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full text-[var(--rp-fg-muted)] hover:text-[var(--rp-fg)]"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
            <p className="flex-1 text-[13px] font-semibold">编辑要发送的内容</p>
            <button
              type="button"
              onClick={() => {
                setComposerExpanded(false);
                send();
              }}
              disabled={!input.trim() && draftImages.length === 0}
              className="flex h-9 cursor-pointer items-center gap-1.5 rounded-full bg-[var(--rp-accent)] px-4 text-[12.5px] font-medium text-[var(--rp-accent-fg)] disabled:opacity-40"
            >
              <ArrowUp className="size-4" aria-hidden="true" /> 发送
            </button>
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="长文本输入"
            className="rp-scroll min-h-0 flex-1 resize-none bg-transparent px-4 py-3 text-[15px] leading-relaxed outline-none"
            placeholder="在这里输入较长的内容…"
          />
          <p className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] text-[11px] text-[var(--rp-fg-subtle)]">
            {[...input].length} 字 · 返回聊天后内容仍在输入框里
          </p>
        </div>
      )}

      {/*
        Bottom action sheet, opened by the composer's ＋ button. Keeps the
        composer to one row while still exposing attachments and image tools.
      */}
      {sheetOpen && (
        <div className="fixed inset-0 z-50" role="dialog" aria-label="操作面板">
          <button
            type="button"
            aria-label="关闭"
            onClick={() => setSheetOpen(false)}
            className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
          />
          <div className="rp-anim-pop absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3 pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] shadow-rp">
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-[var(--rp-border-strong)]" />
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  setSheetOpen(false);
                  imageInput.current?.click();
                }}
                className="flex min-h-[76px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--rp-border)] text-[12px] transition-colors hover:bg-[var(--rp-bg-sunken)]"
              >
                <ImagePlus className="size-5 text-[var(--rp-accent)]" aria-hidden="true" />
                添加图片
              </button>
              <button
                type="button"
                onClick={() => {
                  setSheetOpen(false);
                  setImageOpen(true);
                }}
                className="flex min-h-[76px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--rp-border)] text-[12px] transition-colors hover:bg-[var(--rp-bg-sunken)]"
              >
                <Wand2 className="size-5 text-[var(--rp-accent)]" aria-hidden="true" />
                生成场景图
              </button>
              <button
                type="button"
                onClick={() => {
                  setSheetOpen(false);
                  setInspectorOpen(true);
                }}
                className="flex min-h-[76px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-[var(--rp-border)] text-[12px] transition-colors hover:bg-[var(--rp-bg-sunken)]"
              >
                <SlidersHorizontal className="size-5 text-[var(--rp-accent)]" aria-hidden="true" />
                提示词构成
              </button>
            </div>
            <p className="mt-2 text-center text-[10.5px] text-[var(--rp-fg-subtle)]">
              图片会随本条消息一起发送
            </p>
          </div>
        </div>
      )}

      <PromptInspector
        open={inspectorOpen}
        onOpenChange={setInspectorOpen}
        ctx={() => buildCtx()}
      />
      {/* R04: 模型选择器弹窗（搜索 + 分类 + 三槽位草稿）。 */}
      <ModelPicker
        open={modelPickerOpen}
        onClose={() => setModelPickerOpen(false)}
        target={modelPickerTarget}
        connection={connection}
        currentModel={chat.model || connection?.defaultModel || ''}
        slotModels={slotModels(settings)}
        llm={llm ?? null}
        onSelectModel={applyPickedModel}
        onSaveSlots={applySlotDrafts}
      />
      <BranchPanel
        open={branchOpen}
        onOpenChange={setBranchOpen}
        chat={chat}
        activeBranchId={chat.activeBranchId ?? MAIN_BRANCH}
        onSwitch={switchBranch}
        onRename={renameBranch}
        onDelete={deleteBranch}
        saveChat={async (next) => {
          await useApp.getState().saveChat(next);
        }}
      />
      <ImageStudio
        open={imageOpen}
        onOpenChange={setImageOpen}
        card={card}
        chat={chat}
        onAttach={(dataUrl) => {
          const last = [...chat.messages].reverse().find((m) => m.role === 'assistant');
          if (last) {
            patch({
              messages: chat.messages.map((m) =>
                m.id === last.id ? { ...m, images: [...(m.images ?? []), dataUrl] } : m,
              ),
            });
          } else {
            appendMessage({ id: uid('m'), role: 'assistant', content: '（场景图片）', createdAt: Date.now(), images: [dataUrl] });
          }
          toast.success('图片已附加到对话');
        }}
        onUseAsAvatar={async (dataUrl) => {
          await updateCard(card.id, (c) => ({ ...c, avatar: dataUrl }));
          toast.success('已设为角色头像');
        }}
      />
      </div>
    </div>
  );
}
