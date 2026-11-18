/**
 * Tool execution — the parts that are pure and therefore testable.
 *
 * Network work (Tavily) is injected, so this module never touches `fetch` and
 * can be unit-tested without a server.
 */

import type {
  ToolCall,
  ToolSettings,
  ToolType,
  TavilyResult,
} from './types.js';

export interface TranscriptMessage {
  id?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface KeywordHit {
  turn: number;
  role: 'user' | 'assistant';
  speaker: string;
  fragment: string;
}

export interface KeywordSearchInput {
  query: string;
  messages: TranscriptMessage[];
  /** Speaker names for the two roles. */
  userName: string;
  characterName: string;
  maxResults: number;
  /** Characters of context around the match. */
  contextChars?: number;
}

/**
 * Keyword search over the current transcript.
 *
 * Matches are case-insensitive substring hits; each hit returns the turn, the
 * speaker and a window of text around the match. Duplicates from repeated
 * phrases in one message are collapsed so a long message cannot flood the
 * result list.
 */
export function searchTranscript(input: KeywordSearchInput): KeywordHit[] {
  const needle = input.query.trim().toLowerCase();
  if (!needle) return [];
  const context = input.contextChars ?? 60;
  const hits: KeywordHit[] = [];
  let turn = 0;

  for (let i = 0; i < input.messages.length; i++) {
    const m = input.messages[i];
    if (m.role === 'system') continue;
    if (m.role === 'user') turn += 1;

    const text = m.content ?? '';
    const lower = text.toLowerCase();
    let from = 0;
    const seen = new Set<number>();
    for (;;) {
      const at = lower.indexOf(needle, from);
      if (at < 0) break;
      const start = Math.max(0, at - context);
      const end = Math.min(text.length, at + needle.length + context);
      const key = Math.floor(start / context);
      if (!seen.has(key)) {
        seen.add(key);
        hits.push({
          turn,
          role: m.role,
          speaker: m.role === 'user' ? input.userName : input.characterName,
          fragment: `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`,
        });
      }
      from = at + needle.length;
      if (hits.length >= input.maxResults) return hits;
    }
  }
  return hits.slice(0, input.maxResults);
}

/** Format keyword hits as the tool result body. */
export function formatKeywordResult(hits: KeywordHit[]): string {
  if (!hits.length) return '未在当前对话中找到匹配片段。';
  return hits
    .map((h) => `第 ${h.turn} 轮 · ${h.speaker}（${h.role === 'user' ? '用户' : 'AI'}）：\n${h.fragment}`)
    .join('\n\n');
}

// ------------------------------------------------------------------ random

/**
 * Inclusive random integer in [min,max].
 *
 * Uses rejection sampling over `crypto.getRandomValues` so the result is uniform
 * even when the range does not divide the generator's period — a modulo alone
 * would bias the low values.
 */
export function randomInt(min: number, max: number, random: () => number = Math.random): number {
  const lo = Math.ceil(Number(min));
  const hi = Math.floor(Number(max));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('随机范围必须是数字');
  if (hi < lo) throw new Error('随机范围的下限不能大于上限');
  const span = hi - lo;
  if (span > Number.MAX_SAFE_INTEGER) throw new Error('随机范围过大');
  if (span === 0) return lo;
  return lo + Math.floor(random() * (span + 1));
}

/** Uniform random integer backed by `crypto.getRandomValues` with rejection. */
export function secureRandomInt(min: number, max: number): number {
  const lo = Math.ceil(Number(min));
  const hi = Math.floor(Number(max));
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) throw new Error('随机范围必须是数字');
  if (hi < lo) throw new Error('随机范围的下限不能大于上限');
  const span = hi - lo;
  if (span > Number.MAX_SAFE_INTEGER) throw new Error('随机范围过大');
  if (span === 0) return lo;

  const range = span + 1;
  // Largest multiple of `range` that fits in 32 bits; values above it are
  // rejected so the accepted values are exactly uniform.
  const limit = Math.floor(0x100000000 / range) * range;
  const buf = new Uint32Array(1);
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (!cryptoObj?.getRandomValues) return lo + Math.floor(Math.random() * range);
  for (;;) {
    cryptoObj.getRandomValues(buf);
    const value = buf[0];
    if (value < limit) return lo + (value % range);
  }
}

/** Pick one item uniformly, deduplicating case-insensitively. */
export function pickChoice<T>(choices: T[], random: () => number = Math.random): T {
  if (!choices.length) throw new Error('候选项为空');
  return choices[Math.floor(random() * choices.length)];
}

/** Deduplicate choices, keeping first occurrence and original order. */
export function dedupeChoices<T>(choices: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const c of choices) {
    const key = typeof c === 'string' ? c.trim().toLowerCase() : String(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Execute the `random_number` tool. */
export function runRandomNumber(args: Record<string, unknown>, secure = true): string {
  const rawChoices = Array.isArray(args.choices) ? (args.choices as unknown[]) : null;
  if (rawChoices && rawChoices.length) {
    const choices = dedupeChoices(rawChoices);
    const picked = secure
      ? choices[secureRandomInt(0, choices.length - 1)]
      : pickChoice(choices);
    return `随机结果：${String(picked)}`;
  }
  const min = Number(args.min);
  const max = Number(args.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new Error('需要提供 min 和 max，或 choices 数组');
  }
  const value = secure ? secureRandomInt(min, max) : randomInt(min, max);
  return `随机结果：${value}（范围 ${min}–${max}，含两端）`;
}

// ------------------------------------------------------------ tool schemas

export function activeTools(settings: ToolSettings): ToolType[] {
  const out: ToolType[] = [];
  if (settings.keywordEnabled) out.push('keyword_dialogue');
  if (settings.webEnabled) out.push('web_search');
  if (settings.randomEnabled) out.push('random_number');
  return out;
}

/** OpenAI-style function schemas sent to the model. */
export function toolSchemas(tools: ToolType[]): Array<{ name: string; description: string; parameters: Record<string, unknown> }> {
  const all: Record<ToolType, Record<string, unknown>> = {
    keyword_dialogue: {
      name: 'keyword_dialogue',
      description: '检索当前对话历史中的原文片段，返回命中轮次、说话方和片段。用于查证前文细节，不是联网搜索。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要检索的关键词或短语' },
          reason: { type: 'string', description: '为什么需要检索' },
        },
        required: ['query'],
      },
    },
    web_search: {
      name: 'web_search',
      description:
        '联网搜索或读取网页。query 为搜索词时执行搜索；query 中包含真实 http(s):// 或 www 网址时读取该网页内容。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索词，或要读取的网页地址' },
          reason: { type: 'string', description: '为什么需要联网' },
        },
        required: ['query'],
      },
    },
    random_number: {
      name: 'random_number',
      description:
        '生成随机结果。提供 min/max 时生成含两端的随机整数；提供 choices 时等概率抽取一项（重复项只计一次）。',
      parameters: {
        type: 'object',
        properties: {
          min: { type: 'number', description: '下限（含）' },
          max: { type: 'number', description: '上限（含）' },
          choices: { type: 'array', items: { type: 'string' }, description: '候选名称，等概率抽取' },
          reason: { type: 'string', description: '为什么需要随机' },
        },
      },
    },
  };
  return tools.map((t) => {
    const schema = all[t];
    return { name: String(schema.name), description: String(schema.description), parameters: schema.parameters as Record<string, unknown> };
  });
}

/** Gemini anti-truncation: the body is submitted through a tool. */
export const OUTPUT_REPLY_SCHEMA = {
  type: 'function',
  function: {
    name: 'output_reply',
    description: '提交正文回复。将完整正文放入 content，不要省略或截断。',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: '完整回复正文' },
      },
      required: ['content'],
    },
  },
} as const;

export const REPLY_TOOL_INSTRUCTION =
  '本次回复必须通过 output_reply 工具提交正文，不要直接输出正文；正文必须完整，不得截断或省略。';

/** Parse a `tool_calls` array from a chat-completions chunk into ToolCalls. */
export function parseToolCalls(raw: unknown[]): ToolCall[] {
  const out: ToolCall[] = [];
  for (const item of raw as Array<Record<string, unknown>>) {
    const fn = (item.function ?? {}) as Record<string, unknown>;
    const name = String(fn.name ?? '');
    if (!name) continue;
    let args: Record<string, unknown> = {};
    const rawArgs = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {});
    try {
      args = rawArgs ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      args = {};
    }
    out.push({ id: String(item.id ?? Math.random().toString(36).slice(2)), name, arguments: args });
  }
  return out;
}

/** Is this query a real URL (as opposed to a search phrase)? */
export function looksLikeUrl(query: string): boolean {
  return /^(https?:\/\/|www\.)\S+/i.test(query.trim());
}

export { type TavilyResult };
export type { ToolCall as AgentToolCall };
