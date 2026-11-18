/**
 * Memory (记忆) types.
 *
 * RP-Hub's memory is a three-mode system over the same underlying record, and
 * the modes compose:
 *
 *   - **classic (基础)** — a summariser model writes one summary per *round*
 *     (user input + assistant reply). When the chat grows past the "keep recent
 *     floors" limit, older assistant text is replaced by its summary in the
 *     prompt; the transcript itself is never modified.
 *   - **enhanced (增强)** — classic summaries plus embeddings of
 *     `用户原输入 + 本轮总结`. The latest user input is embedded and the most
 *     similar memories (≥ 48%, max 10) are appended after the newest user
 *     message, in original chronological order, for that request only.
 *   - **secondary (二次压缩)** — the most recent N rounds keep per-round
 *     summaries; older history is grouped into blocks of 5 rounds and
 *     compressed into one summary that retains its children. Enhanced recall
 *     still indexes the *per-round* children, not the group summary.
 *   - **backfill (补录)** — a modal that fills in missing summaries/embeddings
 *     for rounds that predate the feature, or after switching vector models.
 *
 * A "floor" (楼层) is one message; a "round" (轮次) is one user input plus the
 * assistant reply that follows it. A normal exchange is therefore two floors
 * and one round — the two units are deliberately not conflated.
 */

/** Vector encoding actually persisted: int8, scaled by max-abs. */
export const EMBEDDING_ENCODING = 'int8:maxabs:v1';

export interface MemoryRecord {
  /** Marks a classic summary record. */
  classicMemory: true;
  /** Persistent id shown to the user as `M{no}`. */
  no: number;
  /** Round number this summary covers (end round for compressed records). */
  turn: number;
  /** First round of a secondary-compressed group. */
  turnStart?: number;
  /** Last round of a secondary-compressed group. */
  turnEnd?: number;
  secondaryCompressed?: boolean;
  /** Child summaries retained by a compressed group. */
  sourceMemories?: MemoryRecord[];
  /** The summary text. */
  summary: string;
  /** Message ids that produced this round (for citation and backfill). */
  sourceUserIds: string[];
  sourceAssistantIds: string[];
  /** Original user input, kept for embedding/recall text. */
  sourceUserText?: string;
  /** Quantised embedding (base64 int8) + scale, for enhanced recall. */
  embeddingQ?: string;
  embeddingScale?: number;
  embeddingDims?: number;
  embeddingEncoding?: string;
  /** Creation time. */
  timestamp: number;
  /** Soft-disable without deleting. */
  enabled?: boolean;
}

/** Which memory behaviour is active. */
export type MemoryMode = 'off' | 'classic' | 'enhanced';

/** Secondary compression behaviour. */
export type SecondaryMode = 'off' | 'on';

export interface MemorySettings {
  mode: MemoryMode;
  /** Model used to write summaries. */
  summaryModel: string;
  /** Connection used for summaries (falls back to the chat connection). */
  summaryConnectionId?: string;
  /** Model used for embeddings in enhanced mode. */
  vectorModel: string;
  vectorConnectionId?: string;
  /** Keep this many recent rounds as-is before summarising. */
  keepRecentRounds: number;
  /** Secondary compression: rounds kept verbatim. */
  secondaryKeepRounds: number;
  /** Secondary compression: rounds per compressed group. */
  secondaryGroupSize: number;
  secondaryMode: SecondaryMode;
  /** Similarity threshold (0-1) for enhanced recall. */
  recallThreshold: number;
  /** Max recalled memories per request. */
  recallMax: number;
  /** Ask the model to cite memory ids inline as `[M12]`. */
  citationEnabled: boolean;
  /** Inject the recall block after the newest user message. */
  recallEnabled: boolean;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  mode: 'off',
  summaryModel: '',
  vectorModel: '',
  keepRecentRounds: 10,
  secondaryKeepRounds: 25,
  secondaryGroupSize: 5,
  secondaryMode: 'off',
  recallThreshold: 0.48,
  recallMax: 10,
  citationEnabled: false,
  recallEnabled: true,
};

/** A recalled memory with its similarity score. */
export interface RecalledMemory {
  record: MemoryRecord;
  score: number;
}

/** The memory block injected into a prompt. */
export interface MemoryContext {
  /** Replacement text for old assistant messages (classic mode). */
  replacements: Array<{ assistantId: string; text: string }>;
  /** Recalled fragments (enhanced mode), already ordered by turn. */
  recalled: RecalledMemory[];
  /** Human-readable block for the prompt inspector. */
  description: string;
}

/** Progress of a backfill run, surfaced in the UI. */
export interface BackfillProgress {
  phase: 'summary' | 'embedding' | 'done' | 'error';
  total: number;
  done: number;
  etaSeconds?: number;
  message?: string;
}

/** Citation marker written by the model, e.g. `[M12]` or `[M3][M12]`. */
export const MEMORY_CITATION_RE = /\[M(\d+)\]/g;

/** Parse citation markers out of an assistant reply. */
export function parseCitations(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(MEMORY_CITATION_RE)) {
    const n = Number(m[1]);
    if (Number.isInteger(n) && !out.includes(n)) out.push(n);
  }
  return out;
}

/** Strip citation markers so they are not spoken or re-rendered as noise. */
export function stripCitations(text: string): string {
  return text.replace(MEMORY_CITATION_RE, '').replace(/[ \t]{2,}/g, ' ').trim();
}
