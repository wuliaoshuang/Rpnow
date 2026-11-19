import { describe, expect, it } from 'vitest';
import {
  applyMemory,
  buildRounds,
  makeMemoryRecord,
  numberMemories,
  pruneMemories,
  summarySources,
  type MemoryContextInput,
} from './engine.js';
import { cosineSimilarity, dequantizeEmbedding, quantizeEmbedding } from './embeddings.js';
import type { RPChatMessage } from '../types/chat.js';
import type { RPCard } from '../types/card.js';
import { DEFAULT_MEMORY_SETTINGS } from './types.js';

function msg(id: string, role: 'user' | 'assistant', content: string): RPChatMessage {
  return { id, role, content, createdAt: 0 };
}

function card(name = '角色'): RPCard {
  return {
    id: 'c1',
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
    data: { name, description: '', personality: '', scenario: '', first_mes: '', mes_example: '' },
  };
}

const baseInput = (over: Partial<MemoryContextInput> = {}): MemoryContextInput => ({
  chat: { id: 'chat1', messages: [], variables: {} } as never,
  messages: [],
  card: card(),
  personaName: '用户',
  settings: { ...DEFAULT_MEMORY_SETTINGS },
  memories: [],
  ...over,
});

describe('buildRounds', () => {
  it('pairs a user message with the assistant reply after it', () => {
    const rounds = buildRounds([msg('u1', 'user', '你好'), msg('a1', 'assistant', '你好呀')]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].turn).toBe(1);
    expect(rounds[0].user?.id).toBe('u1');
    expect(rounds[0].assistant?.id).toBe('a1');
  });

  it('counts a user+reply pair as one round, not two', () => {
    const rounds = buildRounds([
      msg('u1', 'user', 'a'),
      msg('a1', 'assistant', 'b'),
      msg('u2', 'user', 'c'),
      msg('a2', 'assistant', 'd'),
    ]);
    expect(rounds.map((r) => r.turn)).toEqual([1, 2]);
  });

  it('keeps a trailing user message as an unanswered round', () => {
    const rounds = buildRounds([msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b'), msg('u2', 'user', 'c')]);
    expect(rounds).toHaveLength(2);
    expect(rounds[1].assistant).toBeNull();
  });

  it('merges consecutive user messages into one round', () => {
    const rounds = buildRounds([msg('u1', 'user', 'a'), msg('u2', 'user', 'b'), msg('a1', 'assistant', 'c')]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0].user?.content).toBe('a\n\nb');
  });

  it('ignores system messages when pairing', () => {
    const rounds = buildRounds([
      { id: 's1', role: 'system', content: 'sys', createdAt: 0 },
      msg('u1', 'user', 'a'),
      msg('a1', 'assistant', 'b'),
    ]);
    expect(rounds).toHaveLength(1);
  });
});

describe('numberMemories', () => {
  it('assigns missing ids in turn order and keeps existing ones', () => {
    const a = makeMemoryRecord({ summary: 'A', turn: 1, no: 0 });
    const b = makeMemoryRecord({ summary: 'B', turn: 2, no: 0 });
    delete (a as { no?: number }).no;
    delete (b as { no?: number }).no;
    numberMemories([b, a]);
    expect(a.no).toBe(1);
    expect(b.no).toBe(2);
  });

  it('counts children of compressed groups', () => {
    const child = makeMemoryRecord({ summary: 'child', turn: 1, no: 0 });
    delete (child as { no?: number }).no;
    const group = makeMemoryRecord(
      { summary: 'group', turn: 2, no: 0, secondaryCompressed: true, turnStart: 1, turnEnd: 2, sourceMemories: [child] },
    );
    delete (group as { no?: number }).no;
    numberMemories([group]);
    expect(child.no).toBe(1);
    expect(group.no).toBe(2);
  });
});

describe('summarySources', () => {
  it('indexes per-round children rather than group summaries', () => {
    const child = makeMemoryRecord({ summary: 'c', turn: 1, no: 1 });
    const group = makeMemoryRecord({
      summary: 'g',
      turn: 2,
      no: 2,
      secondaryCompressed: true,
      turnStart: 1,
      turnEnd: 2,
      sourceMemories: [child],
    });
    expect(summarySources([group])).toEqual([child]);
  });

  it('drops disabled memories', () => {
    const a = makeMemoryRecord({ summary: 'a', turn: 1, no: 1, enabled: false });
    expect(summarySources([a])).toEqual([]);
  });
});

describe('applyMemory — classic replacement', () => {
  it('does nothing when disabled', () => {
    const input = baseInput({ messages: [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b')] });
    const out = applyMemory(input);
    expect(out.messages[1].content).toBe('b');
    expect(out.description).toBe('记忆未启用');
  });

  it('replaces only rounds older than the keep-recent window', () => {
    const messages = [
      msg('u1', 'user', '1'),
      msg('a1', 'assistant', 'old-1'),
      msg('u2', 'user', '2'),
      msg('a2', 'assistant', 'old-2'),
      msg('u3', 'user', '3'),
      msg('a3', 'assistant', 'recent'),
    ];
    const memories = [
      makeMemoryRecord({ summary: '总结1', turn: 1, no: 1, sourceAssistantIds: ['a1'] }),
      makeMemoryRecord({ summary: '总结2', turn: 2, no: 2, sourceAssistantIds: ['a2'] }),
    ];
    const out = applyMemory(
      baseInput({
        messages,
        memories,
        settings: { ...DEFAULT_MEMORY_SETTINGS, mode: 'classic', keepRecentRounds: 2 },
      }),
    );
    // keepRecentRounds=2 of 6 messages => only indices < 4 are eligible.
    expect(out.messages[1].content).toBe('总结1');
    expect(out.messages[3].content).toBe('总结2');
    expect(out.messages[5].content).toBe('recent');
  });

  it('does not crash when a summary matches a round with no assistant reply yet', () => {
    // Regenerate trims the reply being replaced, so the newest user message
    // forms a round with assistantIndex -1 — and a stored summary of that
    // round still matches it by turn number. The old code read out[-1].meta
    // and crashed the whole generation with "Cannot read properties of
    // undefined (reading 'meta')".
    const messages = [
      msg('u1', 'user', '1'),
      msg('a1', 'assistant', 'old-1'),
      msg('u2', 'user', '2'),
    ];
    const memories = [
      makeMemoryRecord({ summary: '总结2', turn: 2, no: 2, sourceAssistantIds: ['a2'] }),
    ];
    const out = applyMemory(
      baseInput({
        messages,
        memories,
        settings: { ...DEFAULT_MEMORY_SETTINGS, mode: 'classic', keepRecentRounds: 0 },
      }),
    );
    expect(out.messages[2].content).toBe('2');
  });

  it('never mutates the stored transcript', () => {
    const messages = [msg('u1', 'user', 'a'), msg('a1', 'assistant', '原文')];
    const memories = [makeMemoryRecord({ summary: '总结', turn: 1, no: 1, sourceAssistantIds: ['a1'] })];
    applyMemory(
      baseInput({
        messages,
        memories,
        settings: { ...DEFAULT_MEMORY_SETTINGS, mode: 'classic', keepRecentRounds: 0 },
      }),
    );
    expect(messages[1].content).toBe('原文');
  });

  it('tags the replaced message with its memory number', () => {
    const messages = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b')];
    const memories = [makeMemoryRecord({ summary: 'S', turn: 1, no: 7, sourceAssistantIds: ['a1'] })];
    const out = applyMemory(
      baseInput({
        messages,
        memories,
        settings: { ...DEFAULT_MEMORY_SETTINGS, mode: 'classic', keepRecentRounds: 0 },
      }),
    );
    expect(out.messages[1].meta?.memoryNo).toBe(7);
  });
});

describe('applyMemory — secondary compression', () => {
  const messages = [
    msg('u1', 'user', '1'),
    msg('a1', 'assistant', 'r1'),
    msg('u2', 'user', '2'),
    msg('a2', 'assistant', 'r2'),
    msg('u3', 'user', '3'),
    msg('a3', 'assistant', 'r3'),
  ];

  it('collapses a group into its last turn and drops the rest', () => {
    const child1 = makeMemoryRecord({ summary: 's1', turn: 1, no: 1 });
    const child2 = makeMemoryRecord({ summary: 's2', turn: 2, no: 2 });
    const group = makeMemoryRecord({
      summary: '合并总结',
      turn: 2,
      no: 3,
      secondaryCompressed: true,
      turnStart: 1,
      turnEnd: 2,
      sourceMemories: [child1, child2],
      sourceAssistantIds: ['a1', 'a2'],
    });
    const out = applyMemory(
      baseInput({
        messages,
        memories: [group],
        settings: {
          ...DEFAULT_MEMORY_SETTINGS,
          mode: 'classic',
          keepRecentRounds: 1,
          secondaryMode: 'on',
        },
      }),
    );
    // The group's last turn (u2/a2) survives; u1/a1 are removed.
    const ids = out.messages.map((m) => m.id);
    expect(ids).not.toContain('u1');
    expect(ids).not.toContain('a1');
    expect(out.messages.find((m) => m.id === 'u2')?.content).toContain('总结记忆 第 1-2 轮');
    expect(out.messages.find((m) => m.id === 'a2')?.content).toBe('合并总结');
  });
});

describe('applyMemory — enhanced recall', () => {
  it('appends the recall block to the newest user message', () => {
    const messages = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b'), msg('u2', 'user', '最新输入')];
    const record = makeMemoryRecord({ summary: '旧剧情', turn: 1, no: 12, sourceUserText: '旧输入' });
    const out = applyMemory(
      baseInput({
        messages,
        memories: [record],
        settings: { ...DEFAULT_MEMORY_SETTINGS, mode: 'enhanced', keepRecentRounds: 20 },
        recall: [{ record, score: 0.91 }],
      }),
    );
    const newest = out.messages.find((m) => m.id === 'u2');
    expect(newest?.content).toContain('<enhanced_memory_recall>');
    expect(newest?.content).toContain('id="M12"');
    expect(newest?.content).toContain('similarity="91.0%"');
    expect(newest?.content).toContain('旧剧情');
    expect(out.recalled).toHaveLength(1);
  });

  it('does not append recall in classic mode', () => {
    const messages = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b')];
    const record = makeMemoryRecord({ summary: 's', turn: 1, no: 1 });
    const out = applyMemory(
      baseInput({
        messages,
        memories: [record],
        settings: { ...DEFAULT_MEMORY_SETTINGS, mode: 'classic', keepRecentRounds: 20 },
        recall: [{ record, score: 0.9 }],
      }),
    );
    expect(out.recallBlock).toBeNull();
    expect(out.messages[0].content).toBe('a');
  });
});

describe('pruneMemories', () => {
  const messages = [msg('u1', 'user', 'a'), msg('a1', 'assistant', 'b'), msg('u2', 'user', 'c'), msg('a2', 'assistant', 'd')];

  it('drops memories whose messages were deleted', () => {
    const records = [
      makeMemoryRecord({ summary: 's1', turn: 1, no: 1, sourceUserIds: ['u1'], sourceAssistantIds: ['a1'] }),
      makeMemoryRecord({ summary: 's2', turn: 2, no: 2, sourceUserIds: ['u2'], sourceAssistantIds: ['a2'] }),
    ];
    const pruned = pruneMemories(records, messages.slice(0, 2));
    expect(pruned).toHaveLength(1);
    expect(pruned[0].summary).toBe('s1');
    // Renumbered so `M1` still means the first surviving memory.
    expect(pruned[0].no).toBe(1);
  });

  it('keeps everything when nothing was removed', () => {
    const records = [makeMemoryRecord({ summary: 's1', turn: 1, no: 1, sourceAssistantIds: ['a1'] })];
    expect(pruneMemories(records, messages)).toBe(records);
  });

  it('keeps a memory that still has one live source id', () => {
    const records = [makeMemoryRecord({ summary: 's1', turn: 1, no: 1, sourceUserIds: ['u1'], sourceAssistantIds: ['gone'] })];
    expect(pruneMemories(records, messages)).toHaveLength(1);
  });

  it('keeps memories with no source ids (manually written)', () => {
    const records = [makeMemoryRecord({ summary: 's1', turn: 1, no: 1 })];
    expect(pruneMemories(records, [])).toHaveLength(1);
  });
});

describe('embeddings', () => {
  it('quantises and dequantises with usable precision', () => {
    const vec = [0.5, -1.25, 3.0, 0.0, -0.75];
    const q = quantizeEmbedding(vec)!;
    const back = dequantizeEmbedding(q);
    expect(back).toHaveLength(vec.length);
    // Direction is what matters for cosine similarity.
    expect(cosineSimilarity(vec, back)).toBeGreaterThan(0.999);
  });

  it('returns null for empty or all-zero vectors', () => {
    expect(quantizeEmbedding([])).toBeNull();
    expect(quantizeEmbedding([0, 0, 0])).toBeNull();
  });

  it('cosine similarity handles mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(-1);
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});
