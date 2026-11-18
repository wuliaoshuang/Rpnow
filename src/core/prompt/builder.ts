/**
 * Prompt assembly.
 *
 * The relationship that must not be gotten wrong:
 *
 *   preset  = the *skeleton* (which blocks, in what order, with what default text)
 *   card    = the *content* for an agreed set of block identifiers
 *   worldbook = *insertions* at named positions inside that skeleton
 *   persona = a block that only some presets enable
 *
 * A character card can also carry its own `system_prompt` /
 * `post_history_instructions` and its own `character_book`. Per the ecosystem
 * convention:
 *   - the card's `system_prompt` replaces the preset's `main` block *when the
 *     user enables "prefer character prompt"*, and inside it `{{original}}` is
 *     the preset's original `main` text;
 *   - the card's `post_history_instructions` likewise replaces `jailbreak`;
 *   - the card's `character_book` is *merged with, and takes precedence over*,
 *     the user's selected world books (character scope wins on id collision).
 *
 * Everything is emitted as a `PromptMessage[]`, the shape sent to the API.
 */

import {
  WI_POSITION,
  WI_POSITION_LABELS,
  type RPCharacterBook,
  type RPCard,
  type RPCardData,
  type RPDepthPrompt,
  type RPRegexScript,
} from '../types/card.js';
import {
  detectPresetKind,
  type RPCompletionPreset,
  type RPInstructTemplate,
  type RPPromptEntry,
  type RPPromptOrderGroup,
} from '../types/preset.js';
import { LATE_MACROS, substituteMacros, type MacroContext } from './macros.js';
import { runRegexScript } from './regex-engine.js';

export interface PromptMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  /** Block that produced this message, for the "why is this here" inspector. */
  source?: string;
  /** True when the message came from a world book insertion. */
  injection?: boolean;
  /** Depth from the end of the message list (0 = last), for atDepth injections. */
  depth?: number;
}

export interface ChatTurn {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Messages excluded from the prompt (hidden) but still displayed. */
  hidden?: boolean;
  /** Swipe list; the selected swipe is `.content`. */
  swipes?: string[];
  swipeId?: number;
  /** Per-turn generation metadata. */
  extra?: Record<string, unknown>;
}

export interface PromptBuildInput {
  card: RPCard;
  preset: RPCompletionPreset;
  /** Pre-activated world book insertions grouped by position. */
  worldInfo?: {
    byPosition: Map<
      number,
      Array<{ content: string; comment?: string; bookName?: string; role?: number; depth?: number }>
    >;
    /** Flat string for the `worldInfoBefore`/`worldInfoAfter` blocks. */
    before?: string;
    after?: string;
    /** Outlet lookup. */
    outlets?: (name: string) => string;
  };
  /** Chat history, oldest first. */
  messages: ChatTurn[];
  /** User persona description (the `personaDescription` block). */
  persona?: { name: string; description: string };
  /** Which prompt_order group to use (100000 normal, 100001 group chat). */
  orderGroup?: number;
  /** Macro context seed values; `char`/`user` are filled in from card/persona. */
  macro?: Partial<MacroContext>;
  /** Chat variables. */
  variables?: { get: (k: string) => string | undefined; set: (k: string, v: string) => void };
  /** Card regex scripts to apply to the prompt (placement WORLD_INFO etc.). */
  regex?: RPRegexScript[];
  /** Max characters to spend on chat history; oldest turns drop first. */
  historyBudgetChars?: number;
  /**
   * Group chat participants (excluding the host `card`). When present the
   * builder appends a participant roster block so the model knows who else is
   * in the room, and names each character's greeting.
   */
  groupMembers?: Array<{ name: string; description?: string; personality?: string }>;
  /** Who should speak this turn (group chat roster control). */
  groupSpeaker?: string;
  /** Whether the card's system_prompt overrides preset `main`. */
  preferCharacterPrompt?: boolean;
  /** Whether the card's post_history_instructions overrides `jailbreak`. */
  preferCharacterJailbreak?: boolean;
  /** Extra system text appended by plugins. */
  extraSystem?: string;
  /** Max depth for atDepth insertions relative to history length. */
  now?: Date;
}

export interface PromptBuildResult {
  messages: PromptMessage[];
  /** Ordered block description for the inspector UI. */
  blocks: Array<{
    identifier: string;
    name: string;
    enabled: boolean;
    chars: number;
    source: string;
  }>;
  /** World book insertions that were merged in. */
  injected: Array<{ comment: string; position: string; chars: number; bookName?: string }>;
  totalChars: number;
  droppedHistory: number;
}

const DEFAULT_MAIN = "Write {{char}}'s next reply in a fictional chat between {{char}} and {{user}}.";

/** `<START>` separated example blocks → normalised dialogue transcript. */
export function normalizeExamples(mesExample: string, charName: string, userName: string): string {
  if (!mesExample?.trim()) return '';
  const blocks = mesExample.split(/<START>/i).map((b) => b.trim()).filter(Boolean);
  const rendered = blocks.map((b) =>
    substituteMacros(b, {
      char: charName,
      user: userName,
      charIfNotGroup: charName,
    }),
  );
  return rendered.join('\n');
}

/**
 * Resolve which order group applies.
 *
 * SillyTavern keys `prompt_order` by a synthetic `character.id`. The Chat
 * Completion Prompt Manager's dummy id is **100001** (openai.js), while 100000
 * is the base PromptManager default; the shipped `Default.json` contains both
 * and only 100001 includes `personaDescription`. So preference is
 * 100001 → 100000 → first group. (Verified against ST 1.19 source.)
 */
export const PM_DUMMY_ID_CHAT_COMPLETION = 100001;

export function resolveOrder(preset: RPCompletionPreset, group = PM_DUMMY_ID_CHAT_COMPLETION): RPPromptOrderGroup {
  const orders = preset.prompt_order ?? [];
  return (
    orders.find((o) => String(o.character_id) === String(group)) ??
    orders.find((o) => String(o.character_id) === '100001') ??
    orders.find((o) => String(o.character_id) === '100000') ??
    orders[0] ?? { character_id: group, order: [] }
  );
}

/** Turn an entry's content into final text, resolving card-level overrides. */
function renderBlock(
  entry: RPPromptEntry,
  ctx: {
    data: RPCardData;
    persona?: { name: string; description: string };
    preset: RPCompletionPreset;
    wi: PromptBuildInput['worldInfo'];
    chatExamplesSent: boolean;
  },
): string | null {
  const { data, persona, preset, wi } = ctx;
  let content = entry.content ?? '';
  switch (entry.identifier) {
    case 'charDescription':
      content = data.description ?? '';
      break;
    case 'charPersonality':
      content = data.personality ?? '';
      break;
    case 'scenario':
      content = preset.scenario_format
        ? preset.scenario_format.replace('{{scenario}}', data.scenario ?? '')
        : (data.scenario ?? '');
      break;
    case 'personaDescription':
      content = persona?.description ?? '';
      break;
    case 'worldInfoBefore':
      content = wi?.before ?? '';
      break;
    case 'worldInfoAfter':
      content = wi?.after ?? '';
      break;
    case 'dialogueExamples':
      return ctx.chatExamplesSent ? null : '\u0000EXAMPLES\u0000';
    case 'chatHistory':
      return '\u0000HISTORY\u0000';
    default:
      break;
  }
  return content;
}

/**
 * Depth filter for a regex script.
 *
 * `depth` is the message's distance from the end of the conversation (0 = the
 * newest). `minDepth`/`maxDepth` bound that distance, so a script can be pinned
 * to "only the latest few messages" or "only older ones".
 */
function depthAllows(script: RPRegexScript, depth: number | undefined): boolean {
  if (depth === undefined) return true;
  // `0` is a meaningful bound (the newest message).
  const min = script.minDepth ?? null;
  const max = script.maxDepth ?? null;
  if (min !== null && depth < min) return false;
  if (max !== null && depth > max) return false;
  return true;
}

/** Apply card regex scripts marked `promptOnly` to a string. */
export function applyPromptRegex(
  text: string,
  scripts: RPRegexScript[] | undefined,
  placement: number,
  depth?: number,
): string {
  if (!scripts?.length) return text;
  let out = text;
  for (const script of scripts) {
    if (script.disabled || !script.promptOnly) continue;
    if (!(script.placement ?? []).includes(placement)) continue;
    if (!depthAllows(script, depth)) continue;
    out = runRegex(script, out);
  }
  return out;
}

/**
 * Execute one regex script with ST's semantics.
 *
 * Implementation now delegates to `core/prompt/regex-engine.ts`, which mirrors
 * SillyTavern's `regexFromString` + `runRegexScript` (`regex/engine.js:334-447`):
 * named-group `$<name>` / `{{match}}` substitution, `substituteRegex` 0/1/2 and
 * depth-aware gating. The extra whole-string `trimStrings` sweep is kept for
 * backwards compatibility with older cards that relied on it.
 */
export function runRegex(script: RPRegexScript, text: string): string {
  const out = runRegexScript(script, text, { forceGlobal: true });
  let result = out;
  for (const trim of script.trimStrings ?? []) {
    if (trim) result = result.split(trim).join('');
  }
  return result;
}

/** Split a history budget by dropping the oldest messages first. */
function trimHistory(
  history: ChatTurn[],
  budgetChars?: number,
): { turns: ChatTurn[]; dropped: number } {
  if (!budgetChars || budgetChars <= 0) return { turns: history, dropped: 0 };
  let total = history.reduce((s, t) => s + t.content.length, 0);
  let dropped = 0;
  const turns = [...history];
  while (total > budgetChars && turns.length > 1) {
    const removed = turns.shift()!;
    total -= removed.content.length;
    dropped++;
  }
  return { turns, dropped };
}

/**
 * Build the final message array.
 */
export function buildPrompt(input: PromptBuildInput): PromptBuildResult {
  const { card, preset, messages, persona } = input;
  const data = card.data;
  const charName = data.name || card.id;
  const userName = persona?.name || input.macro?.user || 'User';

  const baseCtx: MacroContext = {
    char: charName,
    user: userName,
    charIfNotGroup: charName,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    persona: persona?.description,
    mesExamples: normalizeExamples(data.mes_example ?? '', charName, userName),
    model: input.macro?.model,
    input: input.macro?.input,
    lastMessage: input.macro?.lastMessage,
    lastUserMessage: input.macro?.lastUserMessage,
    lastCharMessage: input.macro?.lastCharMessage,
    idleDuration: input.macro?.idleDuration,
    now: input.now,
    seed: input.macro?.seed,
    outlet: (name) => input.worldInfo?.outlets?.(name) ?? '',
    getvar: input.variables?.get,
    setvar: input.variables?.set,
    ...input.macro,
  };
  baseCtx.char = charName;
  baseCtx.user = userName;

  // ------------------------------------------------------------ group chats
  /**
   * Group roster. The `char` macro stays the current speaker (so per-card
   * modelling still works), while the roster tells the model who else is in the
   * scene — without it a group chat collapses into a two-hander.
   */
  const groupMembers = input.groupMembers ?? [];
  if (groupMembers.length) {
    const speaker = input.groupSpeaker && input.groupSpeaker !== 'auto' ? input.groupSpeaker : charName;
    baseCtx.char = speaker;
    baseCtx.charIfNotGroup = speaker;
    baseCtx.group = groupMembers.map((m) => m.name).join(', ');
  }
  const overrideMain =
    input.preferCharacterPrompt !== false && data.system_prompt?.trim()
      ? data.system_prompt.trim()
      : undefined;
  const overrideJailbreak =
    input.preferCharacterJailbreak !== false && data.post_history_instructions?.trim()
      ? data.post_history_instructions.trim()
      : undefined;

  // --- which order group -------------------------------------------------
  const order = resolveOrder(preset, input.orderGroup);
  const entriesById = new Map<string, RPPromptEntry>();
  for (const e of preset.prompts ?? []) entriesById.set(e.identifier, e);

  // Any enabled order row whose identifier has no `prompts[]` entry is skipped;
  // any `prompts[]` entry missing from the order is appended at the end so a
  // hand-written preset without prompt_order still produces something sane.
  const ordered: Array<{ entry: RPPromptEntry; enabled: boolean }> = [];
  const seen = new Set<string>();
  for (const row of order.order) {
    const entry = entriesById.get(row.identifier);
    if (!entry) continue;
    ordered.push({ entry, enabled: row.enabled !== false });
    seen.add(row.identifier);
  }
  for (const entry of preset.prompts ?? []) {
    if (!seen.has(entry.identifier)) {
      ordered.push({ entry, enabled: entry.enabled !== false });
    }
  }

  // --- history -----------------------------------------------------------
  const visible = messages.filter((m) => !m.hidden);
  const { turns: histTurns, dropped } = trimHistory(visible, input.historyBudgetChars);

  // The preset's own `main` text, fully substituted, is what `{{original}}`
  // expands to inside a card's `system_prompt` override. It must be computed
  // BEFORE the override is rendered, otherwise the marker is never resolved.
  const presetMainEntry = entriesById.get('main');
  const presetMainText = presetMainEntry?.content
    ? substituteMacros(presetMainEntry.content, baseCtx)
    : DEFAULT_MAIN;
  baseCtx.original = presetMainText;

  const blocks: PromptBuildResult['blocks'] = [];
  const out: PromptMessage[] = [];
  const pendingAtDepth: PromptMessage[] = [];
  const wi = input.worldInfo;
  let examplesSent = false;

  const pushSystem = (content: string, source: string) => {
    if (!content?.trim()) return;
    out.push({ role: 'system', content: content.trim(), source });
  };

  // World info "before char" is also injected through the worldInfoBefore block,
  // but an explicit before/after pair is what presets expect; handle positions
  // that have no dedicated block as extra system messages below.

  for (const { entry, enabled } of ordered) {
    if (!enabled) {
      blocks.push({ identifier: entry.identifier, name: entry.name, enabled: false, chars: 0, source: 'disabled' });
      continue;
    }

    // Card overrides for the main / jailbreak blocks.
    if (entry.identifier === 'main' && overrideMain !== undefined) {
      // `baseCtx.original` was pre-computed from the preset's main block.
      let text = substituteMacros(overrideMain, baseCtx);
      text = applyPromptRegex(text, input.regex, 5);
      pushSystem(text, 'card:system_prompt');
      blocks.push({
        identifier: 'main',
        name: '主提示（角色卡覆盖）',
        enabled: true,
        chars: text.length,
        source: 'card.system_prompt',
      });
      continue;
    }
    if (entry.identifier === 'jailbreak' && overrideJailbreak !== undefined) {
      // For the jailbreak slot, `{{original}}` is the preset's jailbreak text.
      const jailbreakOriginal = entry.content ? substituteMacros(entry.content, baseCtx) : '';
      let text = substituteMacros(overrideJailbreak, { ...baseCtx, original: jailbreakOriginal });
      text = applyPromptRegex(text, input.regex, 5);
      pushSystem(text, 'card:post_history_instructions');
      blocks.push({
        identifier: 'jailbreak',
        name: '越狱/后续指令（角色卡覆盖）',
        enabled: true,
        chars: text.length,
        source: 'card.post_history_instructions',
      });
      continue;
    }

    const rendered = renderBlock(entry, {
      data,
      persona,
      preset,
      wi,
      chatExamplesSent: examplesSent,
    });
    if (rendered === null) {
      blocks.push({ identifier: entry.identifier, name: entry.name, enabled: true, chars: 0, source: 'marker-skipped' });
      continue;
    }
    if (rendered === '\u0000HISTORY\u0000') {
      const text = histTurns.map((t) => t.content.trim()).filter(Boolean).join('\n');
      blocks.push({ identifier: 'chatHistory', name: entry.name, enabled: true, chars: text.length, source: 'history' });
      // Chat history is expanded into individual messages at assembly time.
      out.push({
        role: (entry.role as PromptMessage['role']) ?? 'user',
        content: '\u0000HISTORY\u0000',
        source: 'chatHistory',
      });
      continue;
    }
    if (rendered === '\u0000EXAMPLES\u0000') {
      examplesSent = true;
      const ex = baseCtx.mesExamples ?? '';
      const text = substituteMacros(ex, baseCtx);
      pushSystem(text, 'card:mes_example');
      blocks.push({
        identifier: 'dialogueExamples',
        name: entry.name,
        enabled: true,
        chars: text.length,
        source: 'card.mes_example',
      });
      continue;
    }

    let text = substituteMacros(rendered, baseCtx);
    text = applyPromptRegex(text, input.regex, 5);
    if (!text.trim()) {
      blocks.push({ identifier: entry.identifier, name: entry.name, enabled: true, chars: 0, source: 'empty' });
      continue;
    }
    blocks.push({
      identifier: entry.identifier,
      name: entry.name,
      enabled: true,
      chars: text.length,
      source: entry.marker ? `marker:${entry.identifier}` : 'preset',
    });

    // In-chat / depth injections become their own messages rather than joining
    // the system block.
    if (entry.injection_position === 1) {
      pendingAtDepth.push({
        role: entry.role ?? 'system',
        content: text,
        source: entry.identifier,
        injection: true,
        depth: entry.injection_depth ?? 4,
      });
    } else if (entry.role === 'system') {
      out.push({ role: 'system', content: text, source: entry.identifier });
    } else {
      out.push({ role: entry.role ?? 'system', content: text, source: entry.identifier });
    }
  }

  // --- world info at non-block positions --------------------------------
  const injected: PromptBuildResult['injected'] = [];
  const atDepthFromWI: PromptMessage[] = [];
  if (wi?.byPosition) {
    // Positions handled by dedicated preset blocks:
    const handled = new Set<number>([WI_POSITION.before, WI_POSITION.after, WI_POSITION.outlet]);
    for (const [pos, list] of wi.byPosition) {
      if (handled.has(pos)) continue;
      for (const item of list) {
        const text = substituteMacros(item.content, baseCtx);
        if (!text.trim()) continue;
        injected.push({
          comment: item.comment ?? '',
          position: WI_POSITION_LABELS[pos] ?? String(pos),
          chars: text.length,
          bookName: item.bookName,
        });
        if (pos === WI_POSITION.atDepth) {
          // RP-Hub inserts at-depth lore as a user message before the
          // (depth+1)-th user/assistant from the end; `role` lets an entry
          // override that (0 = user, 1 = assistant, 2 = system).
          const role: PromptMessage['role'] =
            item.role === 1 ? 'assistant' : item.role === 2 ? 'system' : 'user';
          atDepthFromWI.push({
            role,
            content: text,
            source: 'worldInfo@depth',
            injection: true,
            depth: item.depth,
          });
        } else {
          out.push({
            role: 'system',
            content: text,
            source: `worldInfo:${WI_POSITION_LABELS[pos] ?? pos}`,
            injection: true,
          });
        }
      }
    }
    for (const pos of [WI_POSITION.before, WI_POSITION.after]) {
      for (const item of wi.byPosition.get(pos) ?? []) {
        injected.push({
          comment: item.comment ?? '',
          position: WI_POSITION_LABELS[pos],
          chars: item.content.length,
          bookName: item.bookName,
        });
      }
    }
  }

  // --- persona / scenario blocks already handled ------------------------

  if (input.extraSystem?.trim()) {
    pushSystem(input.extraSystem, 'plugin');
  }

  // --- group roster -----------------------------------------------------
  // Give the model an explicit cast list so it does not write every character
  // as the same voice. Names only — bios live in their own cards.
  if (groupMembers.length) {
    const speaker = baseCtx.char;
    const roster = groupMembers
      .map((m) => `- ${m.name}${m.personality ? `：${m.personality.slice(0, 80)}` : ''}`)
      .join('\n');
    pushSystem(
      `【群聊场景】\n本次对话有多个角色同场：${groupMembers.map((m) => m.name).join('、')}。\n` +
        `本轮由「${speaker}」发言；其余角色可以由你一并描写反应，但不要替用户说话。\n` +
        `角色设定：\n${roster}`,
      'group',
    );
  }

  // --- assemble messages: expand the history marker ---------------------
  // Stored messages keep their macro text (so editing/re-swiping stays faithful),
  // which means `{{char}}`/`{{user}}` must be resolved on the way out. The first
  // greeting in particular is almost always written with macros.
  const assembled: PromptMessage[] = [];
  // Prompt-side regex scripts apply to the stored history too. `depth` counts
  // from the end (0 = newest), matching the display-side convention.
  const historyMsgs = histTurns.map<PromptMessage>((t, i) => {
    const isAssistant = t.role !== 'user' && t.role !== 'system';
    const substituted = substituteMacros(t.content, baseCtx);
    return {
      role: t.role === 'system' ? 'assistant' : t.role,
      content: isAssistant
        ? applyPromptRegex(substituted, input.regex, 2, Math.max(0, histTurns.length - 1 - i))
        : substituted,
      source: 'history',
    };
  });
  for (const m of out) {
    if (m.content === '\u0000HISTORY\u0000') {
      assembled.push(...historyMsgs);
    } else {
      assembled.push(m);
    }
  }

  // Merge consecutive system messages to keep strict-role APIs happy, but keep
  // injections separate when they are meant to be interleaved.
  const merged: PromptMessage[] = [];
  for (const m of assembled) {
    const prev = merged[merged.length - 1];
    if (prev && prev.role === 'system' && m.role === 'system' && !m.injection && !prev.injection) {
      prev.content = `${prev.content}\n\n${m.content}`;
      prev.source = `${prev.source}+${m.source}`;
    } else {
      merged.push({ ...m });
    }
  }

  // Depth injections: insert `depth` positions from the end.
  const withDepth: PromptMessage[] = [...merged];
  /**
   * Index to insert at for a depth value, counting **only user/assistant**
   * messages from the end (RP-Hub semantics). `depth = 4` lands immediately
   * before the 5th user/assistant message from the bottom, which is what
   * `messages.length - depth` produces on a pure chat array — but system
   * prompts and other injections must not shift that count.
   */
  const depthIndex = (messages: PromptMessage[], depth: number): number => {
    let seen = 0;
    const target = Math.max(1, depth);
    for (let i = messages.length - 1; i >= 0; i--) {
      const role = messages[i].role;
      if (role !== 'user' && role !== 'assistant') continue;
      seen += 1;
      if (seen === target) return i;
    }
    return 0;
  };
  for (const dep of [...atDepthFromWI, ...pendingAtDepth]) {
    withDepth.splice(depthIndex(withDepth, dep.depth ?? 4), 0, dep);
  }

  // Card depth_prompt (extensions.depth_prompt) is a per-card persistent inject.
  const depthPrompt = (data.extensions?.depth_prompt ?? null) as RPDepthPrompt | null;
  if (depthPrompt?.prompt?.trim()) {
    const text = substituteMacros(depthPrompt.prompt, baseCtx);
    const idx = Math.max(0, withDepth.length - (depthPrompt.depth ?? 4));
    const role = (depthPrompt.role ?? 'system') as PromptMessage['role'];
    withDepth.splice(idx, 0, { role, content: text, source: 'card:depth_prompt', injection: true });
    injected.push({ comment: '角色卡深度提示', position: '按深度插入', chars: text.length, bookName: '角色卡' });
  }

  const totalChars = withDepth.reduce((s, m) => s + m.content.length, 0);
  return {
    messages: withDepth,
    blocks,
    injected,
    totalChars,
    droppedHistory: dropped,
  };
}

/** Convert a card's embedded `character_book` into the promoted-lorebook shape. */
export function characterBookToInserts(book: RPCharacterBook | undefined): Map<number, Array<{ content: string; comment?: string }>> {
  const map = new Map<number, Array<{ content: string; comment?: string }>>();
  if (!book?.entries?.length) return map;
  for (const e of book.entries) {
    if (e.enabled === false) continue;
    const pos = typeof e.extensions?.position === 'number'
      ? e.extensions.position
      : e.position === 'after_char'
        ? WI_POSITION.after
        : WI_POSITION.before;
    const list = map.get(pos) ?? [];
    list.push({ content: e.content ?? '', comment: e.comment });
    map.set(pos, list);
  }
  return map;
}

/** Detect whether a JSON document is a preset and which family. */
export function classifyPreset(doc: unknown) {
  return detectPresetKind(doc);
}

/** Minimal context-template application, used by the Text Completion path. */
export function renderContextTemplate(
  template: { story_string: string; chat_start?: string; example_separator?: string },
  ctx: MacroContext,
  messages: ChatTurn[],
): string {
  const story = substituteMacros(template.story_string, ctx);
  const turns = messages
    .filter((m) => !m.hidden)
    .map((m) => `${m.role === 'user' ? ctx.user : ctx.char}: ${m.content}`)
    .join('\n\n');
  return `${story}\n\n${turns}`.trim();
}

export function applyInstructTemplate(
  template: RPInstructTemplate,
  roles: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
  ctx: MacroContext,
): string {
  return roles
    .map((m) => {
      if (m.role === 'system') return substituteMacros(template.system_sequence ?? '', ctx) + m.content;
      const wrap = template.wrap
        ? m.role === 'user'
          ? template.input_sequence
          : template.output_sequence
        : '';
      return (wrap ?? '') + m.content;
    })
    .join('');
}

export { LATE_MACROS };
