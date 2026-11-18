/**
 * Memory service used by the UI.
 *
 * Wraps the pure engine with the I/O it needs: which connection/model to call,
 * where to persist, and how to report progress. Keeping it here means the chat
 * view only says "summarise this round" and "recall for this input".
 */

import type { RPChat } from '../../core/types/chat.js';
import type { RPCard } from '../../core/types/card.js';
import type { LLMConnection, LLMService } from '../../core/llm/types.js';
import {
  buildRounds,
  buildSecondarySummaryMessages,
  buildRoundSummaryMessages,
  makeMemoryRecord,
  numberMemories,
  summarySources,
} from '../../core/memory/engine.ts';
import { quantizeEmbedding } from '../../core/memory/embeddings.js';
import {
  DEFAULT_MEMORY_SETTINGS,
  type MemoryRecord,
  type MemorySettings,
} from '../../core/memory/types.js';

export interface MemoryIO {
  llm: LLMService;
  connections: LLMConnection[];
  settings: MemorySettings;
  /** Persist the full record list for a chat. */
  save: (chatId: string, records: MemoryRecord[]) => Promise<void>;
  /** Read the current records for a chat. */
  load: (chatId: string) => MemoryRecord[];
}

/** Pick a connection for a job, preferring the configured one. */
function pickConnection(
  io: MemoryIO,
  connectionId: string | undefined,
  fallbackId: string | undefined,
): LLMConnection | undefined {
  if (connectionId) {
    const found = io.connections.find((c) => c.id === connectionId);
    if (found) return found;
  }
  return io.connections.find((c) => c.id === fallbackId) ?? io.connections[0];
}

export class MemoryService {
  private io: MemoryIO;

  constructor(io: MemoryIO) {
    this.io = io;
  }

  get settings(): MemorySettings {
    return this.io.settings;
  }

  /** Embed text for enhanced recall, or undefined when not configured. */
  async embed(text: string): Promise<number[] | undefined> {
    if (!this.io.settings.vectorModel || !this.io.llm.embedFrom) return undefined;
    const conn = pickConnection(this.io, this.io.settings.vectorConnectionId, undefined);
    if (!conn) return undefined;
    try {
      const vectors = await this.io.llm.embedFrom(conn, text, this.io.settings.vectorModel);
      return vectors[0];
    } catch (err) {
      console.warn('[memory] 向量化失败', err);
      return undefined;
    }
  }

  /**
   * Write the summary for the newest completed round.
   *
   * A round is only summarised once: if a record already covers its assistant
   * message id, this is a no-op. That keeps re-generation from producing
   * duplicates.
   */
  async summariseNewestRound(params: {
    chat: RPChat;
    card: RPCard;
    personaName: string;
    fallbackConnectionId?: string;
  }): Promise<MemoryRecord | null> {
    const { chat, card, personaName } = params;
    const settings = this.io.settings;
    if (settings.mode === 'off') return null;

    const records = this.io.load(chat.id);
    const rounds = buildRounds(chat.messages);
    const last = rounds[rounds.length - 1];
    if (!last?.assistant || !last.user) return null;

    const already = records.some((r) =>
      [...(r.sourceAssistantIds ?? []), ...(r.sourceMemories ?? []).flatMap((m) => m.sourceAssistantIds ?? [])].includes(
        last.assistant!.id ?? '',
      ),
    );
    if (already) return null;

    const conn = pickConnection(
      this.io,
      settings.summaryConnectionId,
      params.fallbackConnectionId,
    );
    if (!conn) {
      console.warn('[memory] 没有可用的总结模型连接');
      return null;
    }

    const historyText = chat.messages
      .filter((m) => m.role !== 'system' && m.id !== last.user?.id && m.id !== last.assistant?.id)
      .map((m) => `${m.role === 'user' ? personaName : card.data.name}：${m.content}`)
      .join('\n\n');

    const messages = buildRoundSummaryMessages({
      chat,
      card,
      personaName,
      turn: last.turn,
      userText: last.user.content,
      assistantText: last.assistant.content,
      historyText,
    });

    let summary = '';
    try {
      const res = await this.io.llm.complete(conn.id, {
        model: settings.summaryModel || conn.defaultModel || '',
        messages,
        maxTokens: 1200,
        temperature: 0.3,
      });
      summary = (res.text ?? '').trim();
    } catch (err) {
      console.warn('[memory] 总结失败', err);
      return null;
    }
    if (!summary) return null;

    // Enhanced mode embeds the same record so recall can find it immediately.
    const embedding = settings.mode === 'enhanced' ? await this.embed(
      `用户原输入：\n${last.user.content}\n\n本轮总结：\n${summary}`,
    ) : undefined;

    const next = numberMemories(records);
    const record = makeMemoryRecord(
      {
        summary,
        turn: last.turn,
        no: next,
        sourceUserIds: last.user.id ? [last.user.id] : [],
        sourceAssistantIds: last.assistant.id ? [last.assistant.id] : [],
        sourceUserText: last.user.content,
      },
      embedding ?? undefined,
    );

    const updated = [...records, record];
    await this.io.save(chat.id, updated);
    return record;
  }

  /**
   * Compress old rounds into group summaries (二次压缩).
   *
   * Only rounds older than `secondaryKeepRounds` are grouped, in blocks of
   * `secondaryGroupSize`; the per-round children are retained so enhanced
   * recall keeps indexing them.
   */
  async compressSecondary(params: {
    chat: RPChat;
    card: RPCard;
    personaName: string;
    fallbackConnectionId?: string;
  }): Promise<MemoryRecord[]> {
    const { chat, card, personaName } = params;
    const settings = this.io.settings;
    if (settings.mode === 'off' || settings.secondaryMode !== 'on') return [];

    const records = this.io.load(chat.id);
    const rounds = buildRounds(chat.messages);
    const compressible = rounds.filter((r) => r.turn >= settings.secondaryKeepRounds);
    const groups: MemoryRecord[][] = [];
    for (let i = 0; i < compressible.length; i += settings.secondaryGroupSize) {
      const slice = compressible.slice(i, i + settings.secondaryGroupSize);
      const children = records.filter((r) =>
        !r.secondaryCompressed && slice.some((round) => round.turn === r.turn),
      );
      if (children.length > 1) groups.push(children);
    }
    if (!groups.length) return [];

    const conn = pickConnection(this.io, settings.summaryConnectionId, params.fallbackConnectionId);
    if (!conn) return [];

    const created: MemoryRecord[] = [];
    for (const children of groups) {
      const startTurn = children[0].turn;
      const endTurn = children[children.length - 1].turn;
      try {
        const res = await this.io.llm.complete(conn.id, {
          model: settings.summaryModel || conn.defaultModel || '',
          messages: buildSecondarySummaryMessages(
            personaName,
            card.data.name,
            startTurn,
            endTurn,
            children,
          ),
          maxTokens: 1600,
          temperature: 0.3,
        });
        const summary = (res.text ?? '').trim();
        if (!summary) continue;
        const next = numberMemories([...records, ...created]);
        created.push(
          makeMemoryRecord({
            summary,
            turn: endTurn,
            no: next,
            secondaryCompressed: true,
            turnStart: startTurn,
            turnEnd: endTurn,
            sourceMemories: children,
            sourceUserIds: children.flatMap((c) => c.sourceUserIds ?? []),
            sourceAssistantIds: children.flatMap((c) => c.sourceAssistantIds ?? []),
          }),
        );
      } catch (err) {
        console.warn('[memory] 二次压缩失败', err);
      }
    }

    if (created.length) await this.io.save(chat.id, [...records, ...created]);
    return created;
  }

  /** Number of per-round summaries available for recall. */
  recallableCount(chatId: string): number {
    return summarySources(this.io.load(chatId)).length;
  }

  /**
   * Backfill (补录): write summaries for rounds that predate the feature, and
   * embeddings for records that predate the vector model.
   *
   * Runs sequentially — a long chat must not fire dozens of concurrent requests.
   * `onProgress` lets the UI show phase + counts.
   */
  async backfill(
    params: {
      chat: RPChat;
      card: RPCard;
      personaName: string;
      fallbackConnectionId?: string;
    },
    onProgress?: (phase: 'summary' | 'embedding', done: number, total: number) => void,
  ): Promise<{ summaries: number; embeddings: number }> {
    const { chat, card, personaName } = params;
    const settings = this.io.settings;
    if (settings.mode === 'off') return { summaries: 0, embeddings: 0 };

    let records = this.io.load(chat.id);
    const rounds = buildRounds(chat.messages).filter((r) => r.user && r.assistant);

    const missingRounds = rounds.filter((round) => {
      const id = round.assistant?.id ?? '';
      return !records.some((r) =>
        [...(r.sourceAssistantIds ?? []), ...(r.sourceMemories ?? []).flatMap((m) => m.sourceAssistantIds ?? [])].includes(id),
      );
    });

    let summaries = 0;
    if (missingRounds.length) {
      const conn = pickConnection(this.io, settings.summaryConnectionId, params.fallbackConnectionId);
      if (conn) {
        for (let i = 0; i < missingRounds.length; i++) {
          const round = missingRounds[i];
          onProgress?.('summary', i, missingRounds.length);
          const historyText = chat.messages
            .filter((m) => m.role !== 'system' && m.id !== round.user?.id && m.id !== round.assistant?.id)
            .map((m) => `${m.role === 'user' ? personaName : card.data.name}：${m.content}`)
            .join('\n\n');
          try {
            const res = await this.io.llm.complete(conn.id, {
              model: settings.summaryModel || conn.defaultModel || '',
              messages: buildRoundSummaryMessages({
                chat,
                card,
                personaName,
                turn: round.turn,
                userText: round.user!.content,
                assistantText: round.assistant!.content,
                historyText,
              }),
              maxTokens: 1200,
              temperature: 0.3,
            });
            const summary = (res.text ?? '').trim();
            if (summary) {
              const embedding =
                settings.mode === 'enhanced'
                  ? await this.embed(`用户原输入：\n${round.user!.content}\n\n本轮总结：\n${summary}`)
                  : undefined;
              records = [...records, makeMemoryRecord({
                summary,
                turn: round.turn,
                no: numberMemories(records),
                sourceUserIds: round.user?.id ? [round.user.id] : [],
                sourceAssistantIds: round.assistant?.id ? [round.assistant.id] : [],
                sourceUserText: round.user?.content,
              }, embedding ?? undefined)];
              summaries++;
            }
          } catch (err) {
            console.warn('[memory] 补录总结失败', err);
          }
        }
        await this.io.save(chat.id, records);
      }
    }

    // Embeddings for records written before the vector model was configured.
    let embeddings = 0;
    if (settings.mode === 'enhanced') {
      const sources = summarySources(records);
      const missing = sources.filter((r) => !r.embeddingQ);
      for (let i = 0; i < missing.length; i++) {
        onProgress?.('embedding', i, missing.length);
        const record = missing[i];
        const vector = await this.embed(
          `用户原输入：\n${record.sourceUserText ?? ''}\n\n本轮总结：\n${record.summary}`,
        );
        if (vector?.length) {
          const q = quantizeEmbedding(vector);
          if (q) Object.assign(record, q);
          embeddings++;
        }
      }
      if (embeddings) await this.io.save(chat.id, records);
    }

    return { summaries, embeddings };
  }

  /** Run secondary compression once, if enabled. */
  async runSecondary(params: {
    chat: RPChat;
    card: RPCard;
    personaName: string;
    fallbackConnectionId?: string;
  }): Promise<number> {
    const created = await this.compressSecondary(params);
    return created.length;
  }

  /**
   * Rewrite one record's summary (and re-embed it in enhanced mode).
   *
   * Used by the memory browser's per-row "重新生成". Returns the updated list,
   * or `null` when the source round can no longer be found.
   */
  async regenerateRecord(params: {
    chat: RPChat;
    card: RPCard;
    personaName: string;
    record: MemoryRecord;
    fallbackConnectionId?: string;
  }): Promise<MemoryRecord[] | null> {
    const { chat, card, record } = params;
    const settings = this.io.settings;
    const assistant = chat.messages.find((m) => (record.sourceAssistantIds ?? []).includes(m.id));
    const user = chat.messages.find((m) => (record.sourceUserIds ?? []).includes(m.id));
    if (!assistant) return null;

    const conn = pickConnection(this.io, settings.summaryConnectionId, params.fallbackConnectionId);
    if (!conn) throw new Error('没有可用的总结模型连接');

    const historyText = chat.messages
      .filter((m) => m.role !== 'system' && m.id !== user?.id && m.id !== assistant.id)
      .map((m) => `${m.role === 'user' ? params.personaName : card.data.name}：${m.content}`)
      .join('\n\n');

    const res = await this.io.llm.complete(conn.id, {
      model: settings.summaryModel || conn.defaultModel || '',
      messages: buildRoundSummaryMessages({
        chat,
        card,
        personaName: params.personaName,
        turn: record.turn,
        userText: user?.content ?? record.sourceUserText ?? '',
        assistantText: assistant.content,
        historyText,
      }),
      maxTokens: 1200,
      temperature: 0.2,
    });
    const summary = (res.text ?? '').trim();
    if (!summary) throw new Error('模型没有返回总结');

    const embedding =
      settings.mode === 'enhanced'
        ? await this.embed(`用户原输入：\n${user?.content ?? record.sourceUserText ?? ''}\n\n本轮总结：\n${summary}`)
        : undefined;
    const q = embedding ? quantizeEmbedding(embedding) : null;

    const records = this.io.load(chat.id).map((r) => {
      if (r.no !== record.no) return r;
      const next = { ...r, summary, timestamp: Date.now() };
      if (q) Object.assign(next, q);
      else {
        delete next.embeddingQ;
        delete next.embeddingScale;
        delete next.embeddingDims;
        delete next.embeddingEncoding;
      }
      return next;
    });
    await this.io.save(chat.id, records);
    return records;
  }
}

export const DEFAULTS = DEFAULT_MEMORY_SETTINGS;
