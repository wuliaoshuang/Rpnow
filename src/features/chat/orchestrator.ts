/**
 * Chat orchestration.
 *
 * Turns a stored chat into an LLM request and back. This is the seam where all
 * five subsystems meet, and the order matters:
 *
 *   1. resolve card + preset + persona + world books,
 *   2. run the lorebook engine over recent history (produces insertions),
 *   3. run the card's prompt-only regex scripts,
 *   4. build the prompt (preset skeleton + card content + insertions),
 *   5. stream through the active agent loop,
 *   6. persist the message and the lorebook activation snapshot.
 *
 * Because step 2's snapshot is persisted, sticky/cooldown state survives reloads
 *  鈥?without it, a sticky entry would "forget" it was active after a refresh.
 */

import type { RPChat, RPChatMessage, RPPersona, RPAppSettings } from '../../core/types/chat.js';
import type { RPCard } from '../../core/types/card.js';
import type { RPLorebook } from '../../core/types/lorebook.js';
import type { RPCompletionPreset } from '../../core/types/preset.js';
import { activate, type ActivationResult } from '../../core/lorebook/engine.js';
import { fromCardEntry } from '../../core/types/lorebook.js';
import { WI_POSITION } from '../../core/types/card.js';
import { buildPrompt, type PromptBuildResult } from '../../core/prompt/builder.js';
import { stripCot } from '../../core/prompt/cot.js';
import { substituteMacros } from '../../core/prompt/macros.js';
import type { AgentLoop, AgentResult } from '../../core/agent/types.js';
import type { LLMMessage, LLMService } from '../../core/llm/types.js';
import { estimateTokens } from '../../lib/utils.js';
import { runRegex, applyPromptRegex } from '../../core/prompt/builder.js';
import {
  applyMemory,
  recallMemoriesAsync,
  summarySources,
  type MemoryContextResult,
} from '../../core/memory/engine.js';
import { quantizeEmbedding } from '../../core/memory/embeddings.js';
import { chatReasoningEffort, chatStream } from '../../core/llm/modelSlots.js';
import type { MemoryRecord, MemorySettings } from '../../core/memory/types.js';
import { buildUserInfoPrompt, CITATION_INSTRUCTION } from '../../core/memory/prompts.js';
import type { ToolSettings } from '../../core/tools/types.js';
import { activeTools, toolSchemas } from '../../core/tools/engine.js';
import { executeTool } from '../../core/tools/provider.js';
import { ADAPTIVE_REMINDER, FORCE_REMINDER } from '../../core/tools/types.js';

export interface ChatContext {
  chat: RPChat;
  card: RPCard;
  /**
   * All known cards. Group chats resolve their cast from `chat.groupCardIds`
   * against this list; solo chats ignore it.
   */
  cards?: RPCard[];
  preset: RPCompletionPreset;
  persona?: RPPersona;
  /** Standalone books selected for this chat. */
  userBooks: RPLorebook[];
  settings: RPAppSettings;
  /** Memory state; omitted disables memory entirely. */
  memory?: {
    records: MemoryRecord[];
    settings: MemorySettings;
    /** Embedding function for enhanced-mode recall; may fail or be absent. */
    embed?: (text: string) => Promise<number[] | undefined>;
    /** Persist records after backfilling vectors. */
    persist?: (records: MemoryRecord[]) => Promise<void>;
  };
  /** Agent tools; omitted disables tool calling. */
  tools?: {
    settings: ToolSettings;
    userName: string;
    characterName: string;
  };
  /** Enabled UI templates for this character/global scope. */
  uiTemplates?: import('../../core/uitemplate/types.js').RPUITemplate[];
}

/** Convert a card's embedded book to a lorebook object (character scope). */
export function cardBookToLorebook(card: RPCard): RPLorebook | null {
  const book = card.data.character_book;
  if (!book?.entries?.length) return null;
  return {
    id: `cardbook:${card.id}`,
    name: book.name || `${card.data.name}閻ㄥ嫪绗橀悾灞煎姛`,
    description: book.description,
    entries: book.entries.map((e, i) => fromCardEntry(e, i)),
    scanDepth: book.scan_depth ?? null,
    tokenBudget: book.token_budget ?? null,
    recursiveScanning: book.recursive_scanning ?? true,
    source: 'character',
    cardId: card.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/** Messages that participate in scanning: recent visible turns. */
export function scanMessages(messages: RPChatMessage[]): Array<{ role: string; content: string }> {
  return messages
    .filter((m) => !m.hidden)
    .map((m) => ({ role: m.role, content: m.content }));
}

/** Run activation with the chat's persisted snapshot. */
export function runActivation(ctx: ChatContext): ActivationResult {
  const books: RPLorebook[] = [];
  // Character-scope first so it wins on recursion order.
  if (ctx.chat.useCardLorebook) {
    const cb = cardBookToLorebook(ctx.card);
    if (cb) books.push(cb);
  }
  for (const id of ctx.chat.lorebookIds) {
    const b = ctx.userBooks.find((x) => x.id === id);
    if (b) books.push(b);
  }

  const charName = ctx.card.data.name;
  const userName = ctx.persona?.name || 'User';

  return activate({
    books,
    messages: scanMessages(ctx.chat.messages),
    defaults: ctx.settings.lorebook,
    cardFields: {
      description: ctx.card.data.description,
      personality: ctx.card.data.personality,
      scenario: ctx.card.data.scenario,
      creatorNotes: ctx.card.data.creator_notes,
      depthPrompt: String((ctx.card.data.extensions?.depth_prompt as { prompt?: string })?.prompt ?? ''),
    },
    snapshot: ctx.chat.activation,
    seed: hashString(ctx.chat.id),
    macros: (text) =>
      substituteMacros(text, {
        char: charName,
        user: userName,
        charIfNotGroup: charName,
        description: ctx.card.data.description,
        personality: ctx.card.data.personality,
        scenario: ctx.card.data.scenario,
        persona: ctx.persona?.description,
        getvar: (k) => String(ctx.chat.variables[k] ?? ''),
        setvar: (k, v) => {
          ctx.chat.variables[k] = v;
        },
      }),
  });
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Assemble the message array sent to the model.
 *
 * Memory is applied before the preset skeleton is laid out: old assistant text
 * becomes its summary and (in enhanced mode) a recall block is appended to the
 * newest user message. The transcript itself is never modified.
 */
export async function assemblePrompt(
  ctx: ChatContext,
  activation: ActivationResult,
): Promise<PromptBuildResult & { memory: MemoryContextResult }> {
  const userName = ctx.persona?.name || 'User';

  // ---- memory -------------------------------------------------------------
  let memoryResult: MemoryContextResult = {
    messages: ctx.chat.messages,
    recallBlock: null,
    recalled: [],
    description: '记忆未启用',
  };
  if (ctx.memory && ctx.memory.settings.mode !== 'off' && ctx.memory.records.length) {
    let recall: MemoryContextResult['recalled'] = [];
    if (ctx.memory.settings.mode === 'enhanced' && ctx.memory.settings.recallEnabled && ctx.memory.embed) {
      // Backfill (补录): records written before the vector model was configured
      // have no embedding, so recall would silently see nothing. Compute them
      // now and persist, which is exactly the manual "补录" action RP-Hub offers.
      const missing = summarySources(ctx.memory.records).filter((r) => !r.embeddingQ);
      if (missing.length) {
        for (const record of missing) {
          const vector = await ctx.memory
            .embed(`用户原输入：\n${record.sourceUserText ?? ''}\n\n本轮总结：\n${record.summary}`)
            .catch(() => undefined);
          const q = vector ? quantizeEmbedding(vector) : null;
          if (q) Object.assign(record, q);
        }
        await ctx.memory.persist?.(ctx.memory.records);
      }

      const newestUser = [...ctx.chat.messages].reverse().find((m) => m.role === 'user');
      if (newestUser) {
        try {
          recall = await recallMemoriesAsync(newestUser.content, ctx.memory.records, ctx.memory.settings, ctx.memory.embed);
        } catch (err) {
          console.warn('[memory] 召回失败', err);
        }
      }
    }
    memoryResult = applyMemory({
      chat: ctx.chat,
      messages: ctx.chat.messages,
      card: ctx.card,
      personaName: userName,
      settings: ctx.memory.settings,
      memories: ctx.memory.records,
      recall,
    });
  }

  const promptMessages = memoryResult.messages.map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    hidden: m.hidden,
    // I03: user-attached pictures ride along so buildPrompt can turn the
    // newest user turn into multimodal content. Assistant `images` are
    // generated illustrations and are deliberately left out.
    ...(m.role === 'user' && m.images?.length ? { images: m.images } : {}),
  }));

  // F02: User Info is NOT part of extraSystem — it is passed as
  // `userInfoAfterChar` so the builder anchors it right after the char lead
  // (see builder.ts F02), instead of appending it after the skeleton.
  const userInfoAfterChar = ctx.persona
    ? buildUserInfoPrompt({
        name: ctx.persona.name,
        description: ctx.persona.description,
        preferences: ctx.persona.preferences ?? '',
      })
    : undefined;
  // Citation instruction + tool/UI/image reminders, derived from live state.
  const extraSystemParts: string[] = [];
  if (ctx.memory?.settings.citationEnabled && memoryResult.recalled.length) {
    extraSystemParts.push(CITATION_INSTRUCTION);
  }
  if (ctx.tools && activeTools(ctx.tools.settings).length) {
    extraSystemParts.push(ctx.tools.settings.aggressiveness === 'force' ? FORCE_REMINDER : ADAPTIVE_REMINDER);
  }
  if (ctx.uiTemplates?.length) {
    const names = ctx.uiTemplates.map((t) => `「${t.name}」(${t.id})`).join('、');
    const shape =
      ctx.uiTemplates.length === 1
        ? '可以是包含 id 和 variables 的对象，或直接是 variables 对象。'
        : '必须是数组，每项为 {"id":"模板id","variables":{…}}。';
    extraSystemParts.push(
      [
        '<ui_template_updates>',
        `你已加载 UI 模板：${names}。`,
        '需要更新模板变量时，在正文之后输出 <ui_template_updates>…</ui_template_updates>，内容为 JSON。',
        shape,
        '只更新确实变化的变量，不要输出与当前状态相同的内容；不要编造未声明的变量名。',
        '</ui_template_updates>',
      ].join('\n'),
    );
  }
  const imageGen = ctx.settings.imageGen;
  if (imageGen.enabled && imageGen.key) {
    extraSystemParts.push(
      [
        '<auto_image_gen>',
        `用户已开启自动生图。每次回复都必须将 ${imageGen.count} 张图片作为正文插图，按剧情先后分散插入各自对应段落之后，禁止连续输出多个图片或集中放在正文开头、结尾及同一位置。`,
        `格式为：image###英文Tag###，不得只输出文字正文。所有 Tag 必须使用英文并以英文逗号分隔，禁止中文 Tag；提示词必须详尽、细致且可直接绘制。`,
        '强制按“对应正文段落 → 该段图片 → 后续正文段落”的顺序穿插。第一张图片前、任意两张图片之间及最后一张图片后都必须有非空正文。',
        '如为 nsfw 场景，提示词必须带上 nsfw 标签；同人角色名放在最前面。',
        '</auto_image_gen>',
      ].join('\n'),
    );
  }
  const extraSystem = extraSystemParts.join('\n\n') || undefined;

  /**
   * Group chat cast: every participant other than the host card. The host is
   * `ctx.card`; the rest come from `chat.groupCardIds`.
   */
  const groupMembers = (ctx.chat.groupCardIds ?? [])
    .filter((id) => id !== ctx.card.id)
    .map((id) => ctx.cards?.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .map((c) => ({
      name: c.data.name,
      description: c.data.description,
      personality: c.data.personality,
    }));

  const byPosition = new Map<
    number,
    Array<{ content: string; comment?: string; bookName?: string; role?: number; depth?: number }>
  >();
  for (const [pos, list] of activation.byPosition) {
    byPosition.set(
      pos,
      list.map((e) => ({
        content: e.content,
        comment: e.entry.comment,
        bookName: e.bookName,
        role: e.entry.role,
        depth: e.entry.depth,
      })),
    );
  }

  // worldInfoBefore/After blocks take the position-0/1 content; atDepth and
  // other positions are injected by the builder at their own offsets.
  const beforeEntries = activation.byPosition.get(WI_POSITION.before) ?? [];
  const afterEntries = activation.byPosition.get(WI_POSITION.after) ?? [];
  const joinEntries = (list: typeof beforeEntries) =>
    list
      .map((e) => e.content.trim())
      .filter(Boolean)
      .join('\n');

  const lastUser = [...ctx.chat.messages].reverse().find((m) => m.role === 'user');
  const lastChar = [...ctx.chat.messages].reverse().find((m) => m.role === 'assistant');

  const cleanScripts = (ctx.card.data.extensions?.regex_scripts as
    | import('../../core/types/card.js').RPRegexScript[]
    | undefined) ?? [];

  const built = buildPrompt({
    card: ctx.card,
    preset: ctx.preset,
    messages: promptMessages,
    persona: ctx.persona ? { name: ctx.persona.name, description: ctx.persona.description } : undefined,
    // F02: User Info anchored after the char lead (builder F02).
    userInfoAfterChar,
    // F06: COT preset dynamic generation gets the live context (builder F06).
    cot: {
      model: ctx.chat.model,
      memoryEnabled: ctx.memory?.settings.mode !== 'off',
      uiTemplateEnabled: (ctx.uiTemplates?.length ?? 0) > 0,
    },
    extraSystem,
    worldInfo: {
      byPosition,
      before: applyPromptRegex(joinEntries(beforeEntries), cleanScripts, 5),
      after: applyPromptRegex(joinEntries(afterEntries), cleanScripts, 5),
      outlets: (name) => {
        const outlets = activation.activated.filter(
          (e) => e.entry.position === 7 && e.entry.outletName === name,
        );
        return outlets.map((e) => e.content).join('\n');
      },
    },
    preferCharacterPrompt: ctx.settings.chat.preferCharacterPrompt,
    preferCharacterJailbreak: ctx.settings.chat.preferCharacterJailbreak,
    historyBudgetChars:
      ctx.settings.chat.contextTokens > 0
        ? // Token budget → char budget (~3 chars/token for CJK-heavy text);
          // `0` in settings means unlimited, so pass 0 which disables trimming.
          ctx.settings.chat.contextTokens * 3
        : ctx.settings.chat.historyBudgetChars,
    regex: cleanScripts,
    // Group chat: hand the builder the full cast so it can emit a roster block
    // and pick the right `{{char}}` for this turn.
    groupMembers: groupMembers.length ? groupMembers : undefined,
    groupSpeaker: ctx.chat.groupSpeaker,
    // C11: 抗截断（Gemini output_reply 回传）开启时禁用 COT 预设，见
    // PromptBuildInput.disableCot。
    disableCot: useAntiTruncationReplyTool(ctx),
    variables: {
      get: (k) => {
        const v = ctx.chat.variables[k];
        return v === undefined ? undefined : String(v);
      },
      set: (k, v) => {
        ctx.chat.variables[k] = v;
      },
    },
    macro: {
      user: userName,
      input: lastUser?.content,
      lastMessage: ctx.chat.messages.at(-1)?.content,
      lastUserMessage: lastUser?.content,
      lastCharMessage: lastChar?.content,
      model: ctx.chat.model,
    },
    now: new Date(),
  });

  return { ...built, memory: memoryResult };
}

/** Estimated prompt size, for the context meter shown before sending. */
export function promptStats(result: PromptBuildResult): { chars: number; tokens: number } {
  return { chars: result.totalChars, tokens: estimateTokens(result.messages.map((m) => m.content).join('\n')) };
}

/** Prompt messages → LLM messages, keeping multimodal pictures (I03). */
function toLLMMessages(messages: PromptBuildResult['messages']): LLMMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.imageUrls?.length ? { imageUrls: m.imageUrls } : {}),
  }));
}

/**
 * Send one turn and stream the reply.
 *
 * `onDelta` receives text/reasoning increments so the UI can render as tokens
 * arrive. The returned message is NOT persisted 鈥?the caller owns chat state.
 */
/**
 * Gemini 抗截断是否启用（C10/C11）：Gemini 模型 + 防截断开关开 + 有工具位
 * （`output_reply` 要占一个工具槽）。C11 用它在组提示词时禁用 COT 预设，
 * sendTurn 用它决定是否走工具回传。
 */
export function useAntiTruncationReplyTool(ctx: ChatContext, model?: string): boolean {
  return Boolean(
    ctx.tools && /gemini/i.test(model || ctx.chat.model || '') && ctx.settings.chat.preventTruncation,
  );
}

export async function sendTurn(opts: {
  ctx: ChatContext;
  loop: AgentLoop;
  llm: LLMService;
  connectionId: string;
  model?: string;
  signal?: AbortSignal;
  onDelta?: (kind: 'text' | 'reasoning', delta: string) => void;
  onStage?: (stage: 'assembling' | 'streaming' | 'done') => void;
}): Promise<{ result: AgentResult; activation: ActivationResult; prompt: PromptBuildResult }> {
  const { ctx } = opts;
  opts.onStage?.('assembling');

  const activation = runActivation(ctx);
  const prompt = await assemblePrompt(ctx, activation);

  opts.onStage?.('streaming');
  const useReplyTool = useAntiTruncationReplyTool(ctx, opts.model);
  const toolDefs = useReplyTool
    ? [
        {
          name: 'output_reply',
          description: '提交正文回复。将完整正文放入 content，不要省略或截断。',
          parameters: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'] },
        },
      ]
    : ctx.tools
      ? toolSchemas(activeTools(ctx.tools.settings))
      : [];

  // Gemini anti-truncation: the reply arrives through the tool, so remember it
  // and use it as the message body. An empty tool reply is retried up to 3 times.
  let replyToolText = '';
  const MAX_REPLY_ATTEMPTS = 3;
  let result: AgentResult | null = null;
  for (let attempt = 0; attempt < MAX_REPLY_ATTEMPTS; attempt++) {
    replyToolText = '';
    result = await opts.loop.run(
      {
        connectionId: opts.connectionId,
        model: opts.model || ctx.chat.model || '',
        signal: opts.signal,
        context: {
          messages: toLLMMessages(prompt.messages),
          temperature: Number(ctx.chat.params?.temperature ?? ctx.preset.temperature ?? 0.9),
          // `0` in settings means unlimited: omit the cap entirely so the model
          // runs to its natural stop (prevents mid-sentence truncation).
          maxTokens: Number(
            ctx.settings.chat.maxTokens > 0
              ? ctx.settings.chat.maxTokens
              : (ctx.chat.params?.maxTokens ?? ctx.preset.max_tokens ?? 0),
          ),
          tools: toolDefs,
          stopOnToolResult: useReplyTool,
          // N02: 流式开关可按聊天覆盖（`chat.params.stream`），没覆盖时跟随全局。
          stream: chatStream(ctx.chat, ctx.settings),
        },
        executeTool: toolDefs.length
          ? async (name, args) => {
              // The reply tool's payload *is* the message body.
              if (name === 'output_reply') {
                const text = String((args as { content?: unknown })?.content ?? '');
                replyToolText = text;
                return text;
              }
              const toolResult = await executeTool({
                call: {
                  id: `tool_${Math.random().toString(36).slice(2)}`,
                  name,
                  arguments: (args ?? {}) as Record<string, unknown>,
                },
                settings: ctx.tools!.settings,
                // Tool context is transcript text only (no pictures, no tool role).
                messages: prompt.messages.map((m) => ({ role: m.role, content: m.content })),
                userName: ctx.tools!.userName,
                characterName: ctx.tools!.characterName,
              });
              return toolResult.content;
            }
          : undefined,
        params: {
          // RP-Hub disables parallel calls so the timeline stays readable.
          toolChoice: useReplyTool
            ? 'required'
            : ctx.tools?.settings.aggressiveness === 'force'
              ? 'required'
              : 'auto',
          topP: ctx.preset.top_p,
          frequencyPenalty: ctx.preset.frequency_penalty,
          presencePenalty: ctx.preset.presence_penalty,
          repetitionPenalty: ctx.preset.repetition_penalty,
          stop: buildStops(ctx.card.data.name, ctx.persona?.name),
          // N02: 推理强度可按聊天覆盖（`chat.params.reasoningEffort`），
          // 没覆盖时跟随全局 `settings.chat.reasoningEffort`。
          ...(chatReasoningEffort(ctx.chat, ctx.settings)
            ? {
                extra: { reasoning_effort: chatReasoningEffort(ctx.chat, ctx.settings) },
              }
            : {}),
        },
        onEvent: (ev) => {
          if (ev.type === 'text') opts.onDelta?.('text', ev.delta);
          else if (ev.type === 'reasoning') opts.onDelta?.('reasoning', ev.delta);
        },
      },
      opts.llm,
    );
    if (!useReplyTool || replyToolText.trim()) break;
    console.warn(`[gemini] 抗截断第 ${attempt + 1} 次为空，重试`);
  }
  if (!result) throw new Error('没有拿到模型响应');
  if (useReplyTool && replyToolText.trim()) result = { ...result, text: replyToolText };

  opts.onStage?.('done');
  return { result, activation, prompt };
}

/** Stop sequences that prevent the model from writing the user's turn. */
export function buildStops(charName?: string, userName?: string): string[] {
  const stops: string[] = [];
  // Matching stops: `Name:` and the full-width `Name：` variant.
  if (userName) stops.push(
    `\n${userName}:`,
    `\n${userName}\uFF1A`,
  );
  if (charName) stops.push(`\n${charName}:`);
  return stops;
}

/** Apply display-only regex scripts to an outgoing message before rendering. */
function depthAllows(script: { minDepth?: number | null; maxDepth?: number | null }, depth: number | undefined): boolean {
  if (depth === undefined) return true;
  // `0` is a meaningful bound (the newest message), so test for null — not
  // truthiness — otherwise `maxDepth: 0` silently disables the filter.
  const min = script.minDepth ?? null;
  const max = script.maxDepth ?? null;
  if (min !== null && depth < min) return false;
  if (max !== null && depth > max) return false;
  return true;
}

export function renderMessageText(
  text: string,
  scripts: import('../../core/types/card.js').RPRegexScript[] | undefined,
  placement = 2,
  /** Distance from the end of the conversation; 0 = newest. */
  depth?: number,
): string {
  if (!scripts?.length) return stripCot(text);
  let out = stripCot(text);
  for (const s of scripts) {
    if (s.disabled || s.promptOnly) continue;
    if (!(s.placement ?? []).includes(placement)) continue;
    if (!depthAllows(s, depth)) continue;
    out = runRegex(s, out);
  }
  return out;
}

/** Build the initial greeting messages for a new chat. */
export function buildGreetings(card: RPCard, personaName?: string): RPChatMessage[] {
  const options = [card.data.first_mes, ...(card.data.alternate_greetings ?? [])].filter(
    (x) => typeof x === 'string' && x.trim(),
  );
  const first = options[0] ?? '';
  const now = Date.now();
  return [
    {
      id: `m_${now.toString(36)}_0`,
      role: 'assistant',
      content: first,
      swipes: options,
      swipeId: 0,
      isGreeting: true,
      createdAt: now,
      meta: personaName ? { greetingFor: personaName } : undefined,
    },
  ];
}
