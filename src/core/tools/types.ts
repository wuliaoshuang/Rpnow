/**
 * Agent tools.
 *
 * Three built-in tools, all off by default, plus the `output_reply` tool used
 * for Gemini anti-truncation:
 *
 *   keyword_dialogue (关键词检索) — search the **current transcript** for the
 *     query and return matching fragments with speaker and turn. It is a local
 *     search, not a web search.
 *   web_search (联网搜索)          — Tavily. A query containing a real URL is
 *     sent to `/extract`, everything else to `/search`.
 *   random_number (随机生成)       — inclusive integer in [min,max], or an
 *     equally-likely pick from `choices` (deduplicated).
 *   output_reply                  — Gemini anti-truncation. The model submits
 *     its real body through this tool instead of the normal content channel.
 *
 * Protocol notes that matter for compatibility:
 *   - `parallel_tool_calls` is always false.
 *   - Non-random tools take `{query, reason?}`; the random tool takes
 *     `{min, max, choices, reason?}`.
 *   - Tool results are appended as `role:'tool'` messages and are **not**
 *     persisted — they exist only for the current request.
 *   - One request may run at most 5 tool calls, and the model may continue at
 *     most 4 extra rounds.
 */

export type ToolType = 'keyword_dialogue' | 'web_search' | 'random_number';

export type ToolAggressiveness = 'adaptive' | 'force';

export interface ToolSettings {
  keywordEnabled: boolean;
  webEnabled: boolean;
  randomEnabled: boolean;
  /** adaptive = call when the model judges it useful; force = must call one. */
  aggressiveness: ToolAggressiveness;
  /** Results per keyword/web query, 5–10. */
  resultCount: number;
  /** Tavily API key. */
  tavilyKey: string;
  /** Max tool calls executed in a single request. */
  maxToolCalls: number;
  /** Max extra model rounds spent on tool results. */
  maxAutoContinue: number;
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  keywordEnabled: false,
  webEnabled: false,
  randomEnabled: false,
  aggressiveness: 'adaptive',
  resultCount: 5,
  tavilyKey: '',
  maxToolCalls: 5,
  maxAutoContinue: 4,
};

export const ACTIVE_TOOL_MAX_AUTO_CONTINUE = 4;
export const ACTIVE_TOOL_MAX_CALLS = 5;
export const TOOL_RESULT_COUNT = { min: 5, default: 5, max: 10 } as const;

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  content: string;
  /** For the UI timeline. */
  status: 'done' | 'error';
  /** Human-readable summary of what was searched/generated. */
  summary?: string;
}

/** A Tavily hit. */
export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
}

export const FORCE_REMINDER = '正式回复前必须先调用至少 1 个最相关的工具，收到 tool 结果后再回答。';
export const ADAPTIVE_REMINDER =
  '积极补全不确定信息；人设、剧情、记忆、事实、前文细节或用户暗指内容不明确时先调用工具，上下文完全足够时可直接回复。';
