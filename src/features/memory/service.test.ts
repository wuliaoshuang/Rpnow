import { describe, expect, it, vi } from 'vitest';
import { MemoryService, type MemoryIO } from './service.js';
import { DEFAULT_MEMORY_SETTINGS, type MemoryRecord, type MemorySettings } from '../../core/memory/types.js';
import type { RPChat, RPChatMessage } from '../../core/types/chat.js';
import type { RPCard } from '../../core/types/card.js';
import type { LLMConnection, LLMService } from '../../core/llm/types.js';

function msg(id: string, role: 'user' | 'assistant', content: string): RPChatMessage {
  return { id, role, content, createdAt: 0 };
}

function chatWithRounds(n: number): RPChat {
  const messages: RPChatMessage[] = [];
  for (let i = 1; i <= n; i++) {
    messages.push(msg(`u${i}`, 'user', `用户第 ${i} 轮`));
    messages.push(msg(`a${i}`, 'assistant', `助手第 ${i} 轮`));
  }
  return {
    id: 'c1',
    title: '测试',
    cardId: 'card',
    lorebookIds: [],
    useCardLorebook: false,
    messages,
    variables: {},
    createdAt: 0,
    updatedAt: 0,
  };
}

function record(turn: number, no: number): MemoryRecord {
  return {
    classicMemory: true,
    no,
    turn,
    summary: `第 ${turn} 轮总结`,
    sourceUserIds: [`u${turn}`],
    sourceAssistantIds: [`a${turn}`],
    sourceUserText: `用户第 ${turn} 轮`,
    timestamp: 0,
    enabled: true,
  };
}

const card = { data: { name: '角色' } } as unknown as RPCard;
const conn = { id: 'conn1', name: '测试连接', provider: 'openai', baseURL: '', apiKey: '', defaultModel: 'm' } as unknown as LLMConnection;

function makeIO(settings: MemorySettings, initial: MemoryRecord[], completeImpl: (req: { temperature?: number }) => { text: string }) {
  let stored = [...initial];
  const complete = vi.fn(async (_id: string, req: { temperature?: number }) => completeImpl(req));
  const llm = { complete } as unknown as LLMService;
  const io: MemoryIO = {
    llm,
    connections: [conn],
    settings,
    save: async (_chatId, records) => {
      stored = [...records];
    },
    load: () => [...stored],
  };
  return { io, complete, stored: () => stored };
}

const secondaryOn: MemorySettings = {
  ...DEFAULT_MEMORY_SETTINGS,
  mode: 'classic',
  secondaryMode: 'on',
  secondaryKeepRounds: 1,
  secondaryGroupSize: 5,
};

describe('compressSecondary (G04)', () => {
  it('compresses one 5-round group, then a second call creates nothing', async () => {
    const chat = chatWithRounds(6);
    const initial = [1, 2, 3, 4, 5, 6].map((t) => record(t, t));
    const { io, complete, stored } = makeIO(secondaryOn, initial, () => ({ text: '合并总结' }));
    const service = new MemoryService(io);

    const created = await service.compressSecondary({ chat, card, personaName: '用户' });
    expect(created).toHaveLength(1);
    expect(created[0].secondaryCompressed).toBe(true);
    expect(created[0].turnStart).toBe(1);
    expect(created[0].turnEnd).toBe(5);
    expect(complete).toHaveBeenCalledTimes(1);
    // The group summary request uses the RP-Hub temperature (0.2).
    expect(complete.mock.calls[0][1].temperature).toBe(0.2);

    // Re-running must not mint a duplicate group for the same rounds.
    const again = await service.compressSecondary({ chat, card, personaName: '用户' });
    expect(again).toHaveLength(0);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(stored().filter((r) => r.secondaryCompressed)).toHaveLength(1);
  });

  it('skips ranges an existing group already covers', async () => {
    const chat = chatWithRounds(6);
    const group: MemoryRecord = {
      ...record(5, 100),
      secondaryCompressed: true,
      turnStart: 1,
      turnEnd: 5,
      sourceMemories: [1, 2, 3, 4, 5].map((t) => record(t, t)),
    };
    const initial = [1, 2, 3, 4, 5, 6].map((t) => record(t, t));
    initial.push(group);
    const { io, complete } = makeIO(secondaryOn, initial, () => ({ text: '合并总结' }));
    const service = new MemoryService(io);

    expect(await service.compressSecondary({ chat, card, personaName: '用户' })).toHaveLength(0);
    expect(complete).not.toHaveBeenCalled();
  });

  it('merge-save keeps a round summary written while compression was running', async () => {
    const chat = chatWithRounds(6);
    const initial = [1, 2, 3, 4, 5, 6].map((t) => record(t, t));
    const { io, stored } = makeIO(secondaryOn, initial, () => ({ text: '合并总结' }));
    const service = new MemoryService(io);

    // Simulate the round summariser saving a fresh record mid-flight: the
    // mock LLM "call" persists a new record before compressSecondary saves.
    const llm = io.llm as unknown as { complete: ReturnType<typeof vi.fn> };
    llm.complete.mockImplementationOnce(async () => {
      await io.save('c1', [...io.load('c1'), record(7, 7)]);
      return { text: '合并总结' };
    });

    const created = await service.compressSecondary({ chat, card, personaName: '用户' });
    expect(created).toHaveLength(1);
    // The concurrently saved round-7 record survives the merge-save.
    expect(stored().some((r) => r.turn === 7 && !r.secondaryCompressed)).toBe(true);
    expect(stored().filter((r) => r.secondaryCompressed)).toHaveLength(1);
  });
});

describe('summariseNewestRound temperature (G02)', () => {
  it('summarises with temperature 0.2', async () => {
    const chat = chatWithRounds(1);
    const settings: MemorySettings = { ...DEFAULT_MEMORY_SETTINGS, mode: 'classic' };
    const { io, complete } = makeIO(settings, [], () => ({ text: '本轮总结' }));
    const service = new MemoryService(io);

    const rec = await service.summariseNewestRound({ chat, card, personaName: '用户' });
    expect(rec).not.toBeNull();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0][1].temperature).toBe(0.2);
  });
});
