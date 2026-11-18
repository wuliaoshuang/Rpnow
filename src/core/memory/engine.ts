/**
 * Memory engine.
 *
 * Implements the four behaviours RP-Hub exposes, over one record type:
 *
 *   classic    — replace the assistant text of old rounds with its summary
 *   enhanced   — classic + vector recall appended after the newest user message
 *   secondary  — collapse blocks of old rounds into one group summary
 *   backfill   — fill summaries/embeddings for rounds that predate the feature
 *
 * The transcript is **never** modified: replacements are computed on a copy for
 * the prompt only. That is the property that makes memory safe to turn on
 * mid-chat, and it is why the UI can show the original text while the model
 * receives the summary.
 */

import type { RPChat, RPChatMessage } from '../types/chat.js';
import type { RPCard } from '../types/card.js';
import { DEFAULT_MEMORY_SETTINGS, type MemoryRecord, type MemorySettings, type RecalledMemory } from './types.js';
import {
  cosineSimilarity,
  dequantizeEmbedding,
  quantizeEmbedding,
} from './embeddings.js';
import {
  buildRoundSummarySystemPrompt,
  buildRoundSummaryInstruction,
  buildSecondarySummarySystemPrompt,
  RECALL_DESCRIPTION,
} from './prompts.js';

export interface MemoryContextInput {
  chat: RPChat;
  messages: RPChatMessage[];
  card: RPCard;
  personaName: string;
  settings: MemorySettings;
  memories: MemoryRecord[];
  /**
   * Pre-computed enhanced recall. Recall needs an embedding request, so the
   * caller resolves it asynchronously and passes the hits in; classic/secondary
   * replacement stays synchronous.
   */
  recall?: RecalledMemory[];
}

export interface MemoryContextResult {
  /** Messages with old assistant text replaced by summaries. */
  messages: RPChatMessage[];
  /** XML block appended to the newest user message (enhanced mode). */
  recallBlock: string | null;
  /** What was recalled, for the prompt inspector. */
  recalled: RecalledMemory[];
  /** Human-readable description for diagnostics. */
  description: string;
}

/** A user input plus the assistant reply that follows it. */
interface Round {
  turn: number;
  user: RPChatMessage | null;
  assistant: RPChatMessage | null;
  /** Index of the user message in the source array. */
  userIndex: number;
  assistantIndex: number;
}

/**
 * Build the round list. A round is a user message and the assistant message
 * immediately after it; trailing user input with no reply yet is a round with a
 * null assistant. Consecutive user messages are merged into one round (the model
 * sees them as one input).
 */
export function buildRounds(messages: RPChatMessage[]): Round[] {
  const rounds: Round[] = [];
  let turn = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role === 'system') continue;
    if (m.role === 'user') {
      turn += 1;
      // Merge with the previous round if it had no assistant reply yet.
      const prev = rounds[rounds.length - 1];
      if (prev && !prev.assistant) {
        prev.userIndex = prev.userIndex;
        rounds[rounds.length - 1] = {
          ...prev,
          user: prev.user
            ? { ...prev.user, content: `${prev.user.content}\n\n${m.content}` }
            : m,
        };
        continue;
      }
      rounds.push({ turn, user: m, assistant: null, userIndex: i, assistantIndex: -1 });
    } else if (m.role === 'assistant') {
      const prev = rounds[rounds.length - 1];
      if (prev && !prev.assistant) {
        prev.assistant = m;
        prev.assistantIndex = i;
      } else {
        turn += 1;
        rounds.push({ turn, user: null, assistant: m, userIndex: -1, assistantIndex: i });
      }
    }
  }
  return rounds;
}

/**
 * Drop memories that reference deleted messages and renumber what is left.
 *
 * Without this, deleting or regenerating a message leaves its summary behind and
 * the next prompt still treats a removed round as history.
 */
export function pruneMemories(memories: MemoryRecord[], messages: RPChatMessage[]): MemoryRecord[] {
  const live = new Set(messages.map((m) => m.id));
  const survives = (record: MemoryRecord): boolean => {
    const ids = [...(record.sourceUserIds ?? []), ...(record.sourceAssistantIds ?? [])];
    if (!ids.length) return true;
    return ids.some((id) => live.has(id));
  };
  const kept = memories.filter(survives);
  const dropped = memories.length - kept.length;
  if (!dropped) return memories;
  numberMemories(kept);
  return kept;
}

/** Assign `no` values in turn order; returns the next free number. */
export function numberMemories(memories: MemoryRecord[]): number {  const flatten = (list: MemoryRecord[]): MemoryRecord[] =>
    list.flatMap((m) => [...(m.sourceMemories ?? []), m]);
  const all = flatten(memories);
  const max = all.reduce((acc, m) => Math.max(acc, Number.isInteger(m.no) ? m.no : 0), 0);
  let next = max + 1;
  all
    .filter((m) => !Number.isInteger(m.no))
    .sort(
      (a, b) =>
        (a.secondaryCompressed === true ? 1 : 0) - (b.secondaryCompressed === true ? 1 : 0) ||
        (a.turnStart ?? a.turn) - (b.turnStart ?? b.turn) ||
        a.timestamp - b.timestamp,
    )
    .forEach((m) => {
      m.no = next++;
    });
  return next;
}

/** Memories that enhanced recall indexes: per-round children, never group summaries. */
export function summarySources(memories: MemoryRecord[]): MemoryRecord[] {
  return memories.flatMap((m) => {
    if (m.enabled === false) return [];
    return m.secondaryCompressed ? summarySources(m.sourceMemories ?? []) : m.classicMemory && m.summary ? [m] : [];
  });
}

/** Find the memory covering a round (group summary wins over its children). */
export function findMemoryForTurn(
  turn: number,
  byTurn: Map<number, MemoryRecord>,
  byAssistantId: Map<string, MemoryRecord>,
  assistantId?: string,
): MemoryRecord | undefined {
  if (assistantId) {
    const byId = byAssistantId.get(assistantId);
    if (byId) return byId;
  }
  return byTurn.get(turn);
}

/** Index memories for lookup. */
export function buildMemoryLookup(memories: MemoryRecord[]) {
  const byTurn = new Map<number, MemoryRecord>();
  const byAssistantId = new Map<string, MemoryRecord>();
  const walk = (list: MemoryRecord[]) => {
    for (const m of list) {
      if (m.sourceMemories?.length) walk(m.sourceMemories);
      if (m.secondaryCompressed) {
        for (let t = m.turnStart ?? m.turn; t <= (m.turnEnd ?? m.turn); t++) {
          if (!byTurn.has(t)) byTurn.set(t, m);
        }
      } else if (m.turn) {
        byTurn.set(m.turn, m);
      }
      for (const id of m.sourceAssistantIds ?? []) {
        if (!byAssistantId.has(id)) byAssistantId.set(id, m);
      }
    }
  };
  walk(memories);
  return { byTurn, byAssistantId };
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/'/g, '&apos;');
}

/**
 * Apply memory to a prompt.
 *
 * Order matters and matches RP-Hub:
 *   1. secondary groups collapse their rounds (keeping the group's last turn),
 *   2. remaining old rounds have their assistant text replaced by the summary,
 *   3. enhanced recall is appended to the newest user message.
 */
export function applyMemory(input: MemoryContextInput): MemoryContextResult {
  const { messages, settings, memories } = input;
  if (settings.mode === 'off' || !memories.length) {
    return { messages, recallBlock: null, recalled: [], description: '记忆未启用' };
  }

  const rounds = buildRounds(messages);
  const candidateCount = Math.max(0, messages.length - settings.keepRecentRounds);
  const lookup = buildMemoryLookup(memories);

  // Copy so the stored transcript is untouched.
  const out = messages.map((m) => ({ ...m }));
  const removable = new Set<number>();
  const inSecondary = new Set<number>();

  // ---- 1. secondary compression -------------------------------------------
  if (settings.secondaryMode === 'on') {
    const groups = new Map<string, { memory: MemoryRecord; rounds: Round[] }>();
    for (const round of rounds) {
      if (round.assistantIndex < 0 || round.assistantIndex >= candidateCount) continue;
      const memory = findMemoryForTurn(
        round.turn,
        lookup.byTurn,
        lookup.byAssistantId,
        round.assistant?.id,
      );
      if (!memory?.secondaryCompressed) continue;
      const key = String(memory.no ?? memory.turn);
      const group = groups.get(key) ?? { memory, rounds: [] };
      group.rounds.push(round);
      groups.set(key, group);
    }

    for (const { memory, rounds: groupRounds } of groups.values()) {
      const ordered = [...groupRounds].sort((a, b) => a.turn - b.turn);
      const retained = ordered[ordered.length - 1];
      if (!retained || !Number.isFinite(retained.userIndex) || !Number.isFinite(retained.assistantIndex)) {
        continue;
      }
      const rangeStart = memory.turnStart ?? memory.turn;
      const rangeEnd = memory.turnEnd ?? memory.turn;
      for (const round of ordered) {
        inSecondary.add(round.turn);
        for (const idx of [round.userIndex, round.assistantIndex]) {
          if (Number.isFinite(idx) && idx !== retained.userIndex && idx !== retained.assistantIndex) {
            removable.add(idx);
          }
        }
      }
      // The retained user message becomes the group marker; the assistant message
      // carries the merged summary.
      out[retained.userIndex] = {
        ...out[retained.userIndex],
        content: `总结记忆 第 ${rangeStart}-${rangeEnd} 轮`,
      };
      out[retained.assistantIndex] = {
        ...out[retained.assistantIndex],
        content: memory.summary,
        meta: { ...(out[retained.assistantIndex].meta ?? {}), memoryNo: memory.no },
      };
    }
  }

  // ---- 2. classic replacement ---------------------------------------------
  let replaced = 0;
  for (const round of rounds) {
    if (inSecondary.has(round.turn)) continue;
    if (!Number.isFinite(round.assistantIndex) || round.assistantIndex >= candidateCount) continue;
    const memory = findMemoryForTurn(
      round.turn,
      lookup.byTurn,
      lookup.byAssistantId,
      round.assistant?.id,
    );
    if (!memory?.summary) continue;
    out[round.assistantIndex] = {
      ...out[round.assistantIndex],
      content: memory.summary,
      meta: { ...(out[round.assistantIndex].meta ?? {}), memoryNo: memory.no },
    };
    replaced++;
  }

  const filtered = out.filter((_, index) => !removable.has(index));

  // ---- 3. enhanced recall --------------------------------------------------
  const recall = settings.mode === 'enhanced' ? input.recall ?? [] : [];
  let recallBlock: string | null = null;
  const recalled: RecalledMemory[] = recall;
  if (settings.mode === 'enhanced' && settings.recallEnabled && recall.length) {
    const newestUserIndex = findNewestUserIndex(filtered);
    if (newestUserIndex >= 0) {
      recallBlock = [
        '<enhanced_memory_recall>',
        ...RECALL_DESCRIPTION,
        ...recall.map(
          (hit) =>
            [
              `  <memory_fragment id="M${escapeXmlAttribute(String(hit.record.no))}" turn="${escapeXmlAttribute(String(hit.record.turn))}" similarity="${(hit.score * 100).toFixed(1)}%">`,
              `    <user_input>${escapeXmlText(hit.record.sourceUserText ?? '')}</user_input>`,
              `    <summary>${escapeXmlText(hit.record.summary)}</summary>`,
              '  </memory_fragment>',
            ].join('\n'),
        ),
        '</enhanced_memory_recall>',
      ].join('\n');
      filtered[newestUserIndex] = {
        ...filtered[newestUserIndex],
        content: `${filtered[newestUserIndex].content}\n\n${recallBlock}`,
      };
    }
  }

  const description = [
    `模式：${settings.mode === 'classic' ? '基础' : '增强'}`,
    `保留最近 ${settings.keepRecentRounds} 楼`,
    replaced ? `替换正文 ${replaced} 条` : '无需替换',
    recalled.length ? `召回 ${recalled.length} 条` : '',
  ].join(' · ');

  return { messages: filtered, recallBlock, recalled, description };
}

function findNewestUserIndex(messages: RPChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return i;
  }
  return -1;
}

/** Async recall used by the prompt builder. */
export async function recallMemoriesAsync(
  queryText: string,
  memories: MemoryRecord[],
  settings: MemorySettings,
  embed: (text: string) => Promise<number[] | undefined>,
): Promise<RecalledMemory[]> {
  const query = await embed(queryText);
  if (!query?.length) return [];
  const sources = summarySources(memories);
  const scored: RecalledMemory[] = [];
  for (const record of sources) {
    const vec = dequantizeEmbedding(record);
    if (!vec.length) continue;
    const score = cosineSimilarity(query, vec);
    if (score >= settings.recallThreshold) scored.push({ record, score });
  }
  scored.sort((a, b) => b.score - a.score || b.record.turn - a.record.turn);
  const top = scored.slice(0, settings.recallMax);
  // Present chronologically: the model should read them as a timeline.
  top.sort((a, b) => a.record.turn - b.record.turn);
  return top;
}

// ---------------------------------------------------------------- writing

export interface RoundSummaryInput {
  chat: RPChat;
  card: RPCard;
  personaName: string;
  turn: number;
  userText: string;
  assistantText: string;
  historyText: string;
}

/** Build the messages for one per-round summary request. */
export function buildRoundSummaryMessages(input: RoundSummaryInput) {
  return [
    {
      role: 'system' as const,
      content: buildRoundSummarySystemPrompt(input.personaName, input.card.data.name),
    },
    {
      role: 'user' as const,
      content: [
        '<历史背景>',
        input.historyText || '（无）',
        '</历史背景>',
        '',
        `<最新对话：唯一总结目标｜第 ${input.turn} 轮>`,
        `${input.personaName}：${input.userText}`,
        `${input.card.data.name}：${input.assistantText}`,
        '</最新对话>',
        '',
        buildRoundSummaryInstruction(input.turn),
      ].join('\n'),
    },
  ];
}

/** Build the messages for a secondary (group) compression request. */
export function buildSecondarySummaryMessages(
  userName: string,
  characterName: string,
  startTurn: number,
  endTurn: number,
  children: MemoryRecord[],
) {
  return [
    {
      role: 'system' as const,
      content: buildSecondarySummarySystemPrompt(userName, characterName, startTurn, endTurn),
    },
    {
      role: 'user' as const,
      content: children
        .map((child) => `第 ${child.turn} 轮：\n${child.summary}`)
        .join('\n\n'),
    },
  ];
}

/** Create a fresh memory record with a quantised embedding if provided. */
export function makeMemoryRecord(
  partial: Partial<MemoryRecord> & { summary: string; turn: number; no: number },
  embedding?: number[],
): MemoryRecord {
  const record: MemoryRecord = {
    classicMemory: true,
    no: partial.no,
    turn: partial.turn,
    summary: partial.summary,
    sourceUserIds: partial.sourceUserIds ?? [],
    sourceAssistantIds: partial.sourceAssistantIds ?? [],
    sourceUserText: partial.sourceUserText,
    timestamp: partial.timestamp ?? Date.now(),
    enabled: partial.enabled ?? true,
  };
  if (partial.secondaryCompressed) {
    record.secondaryCompressed = true;
    record.turnStart = partial.turnStart ?? partial.turn;
    record.turnEnd = partial.turnEnd ?? partial.turn;
    record.sourceMemories = partial.sourceMemories ?? [];
  }
  const q = embedding ? quantizeEmbedding(embedding) : null;
  if (q) {
    record.embeddingQ = q.embeddingQ;
    record.embeddingScale = q.embeddingScale;
    record.embeddingDims = q.embeddingDims;
    record.embeddingEncoding = q.embeddingEncoding;
  }
  return record;
}

export { DEFAULT_MEMORY_SETTINGS };
