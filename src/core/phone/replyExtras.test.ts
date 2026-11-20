/**
 * computeReplyExtras 的单元测试：只测纯函数拼 extras 的办法，
 * 不测真的调模型——模型调用在 Playwright 里用假接口验。
 *
 * 覆盖：没主聊天时 extras 全空；主聊天有剧情进度时压出来；
 * 预设按 chat.presetId、没有时按默认预设取；没有世界书时
 * lorebookText 是空的。
 */
import { describe, expect, it } from 'vitest';
import type { RPCard } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';
import type { RPCompletionPreset, RPPromptEntry } from '@/core/types/preset.js';
import { DEFAULT_LOREBOOK_SETTINGS } from '@/core/types/lorebook.js';
import { computeReplyExtras, historyEntries } from './replyExtras.js';
import type { PhoneMessage } from './types.js';

const DEFAULTS = { ...DEFAULT_LOREBOOK_SETTINGS };

function fakeCard(): RPCard {
  return {
    id: 'card-1',
    data: {
      name: '李淑纯',
      description: '和闺蜜小雨一起开花店。',
      personality: '温柔细心',
      scenario: '花店里的一天',
      first_mes: '你来啦',
      mes_example: '',
    },
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
  };
}

function fakeChat(overrides: Partial<RPChat> = {}): RPChat {
  const now = Date.now();
  return {
    id: 'chat-1',
    title: '李淑纯',
    cardId: 'card-1',
    lorebookIds: [],
    useCardLorebook: false,
    messages: [
      { id: 'm-1', role: 'assistant', content: '刚在报到处领了学生卡，明天早上八点军训集合。', createdAt: now },
      { id: 'm-2', role: 'user', content: '我在4栋，你在哪栋？', createdAt: now },
    ],
    variables: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function entry(identifier: string, content: string): RPPromptEntry {
  return { identifier, name: identifier, system_prompt: true, role: 'system', content, enabled: true };
}

function fakePreset(id: string): RPCompletionPreset {
  return {
    id,
    name: '测试预设',
    prompts: [entry('main', 'MAIN_写短句回复')],
    prompt_order: [
      {
        character_id: 100001,
        order: [{ identifier: 'main', enabled: true }],
      },
    ],
  };
}

describe('computeReplyExtras', () => {
  it('没主聊天时 extras 全空（查看器也不崩）', () => {
    const extras = computeReplyExtras({
      card: fakeCard(),
      mainChat: undefined,
      presets: [],
      lorebooks: [],
      lorebookDefaults: DEFAULTS,
      history: [],
    });
    expect(extras).toEqual({});
  });

  it('主聊天的剧情进度压出来了（军训集合在里面）', () => {
    const extras = computeReplyExtras({
      card: fakeCard(),
      mainChat: fakeChat(),
      presets: [],
      lorebooks: [],
      lorebookDefaults: DEFAULTS,
      history: [],
    });
    expect(extras.plotProgress).toContain('军训集合');
    expect(extras.plotProgress).toContain('4栋');
    expect(extras.lorebookText).toBe('');
    expect(extras.presetText).toBe('');
  });

  it('预设按 chat.presetId 取，没有时按默认预设取', () => {
    const base = {
      card: fakeCard(),
      presets: [fakePreset('preset-a'), fakePreset('preset-b')],
      lorebooks: [],
      lorebookDefaults: DEFAULTS,
      history: [],
    };
    const byChat = computeReplyExtras({
      ...base,
      mainChat: fakeChat({ presetId: 'preset-b' }),
      defaultPresetId: 'preset-a',
    });
    expect(byChat.presetText).toContain('MAIN_写短句回复');
    const byDefault = computeReplyExtras({
      ...base,
      mainChat: fakeChat(),
      defaultPresetId: 'preset-a',
    });
    expect(byDefault.presetText).toContain('MAIN_写短句回复');
    const none = computeReplyExtras({ ...base, mainChat: fakeChat() });
    expect(none.presetText).toBe('');
  });
});

describe('historyEntries', () => {
  it('系统消息不要，图片和表情包换成占位文字，只留最近 10 条', () => {
    const messages: PhoneMessage[] = [
      { id: 's1', role: 'system', type: 'text', content: '正在生成图片…', createdAt: 0 },
      { id: 'u1', role: 'user', type: 'text', content: '你好', createdAt: 0 },
      { id: 'a1', role: 'assistant', type: 'image', content: 'prompt', createdAt: 0 },
      { id: 'a2', role: 'assistant', type: 'sticker', content: '', createdAt: 0 },
    ];
    expect(historyEntries(messages)).toEqual([
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '[对方发来一张图片]' },
      { role: 'assistant', content: '[表情]' },
    ]);
    // 群聊里 assistant 消息的说话人带上（生图提示词和回复上下文按它分清谁说的）。
    const groupMessages: PhoneMessage[] = [
      { id: 'g1', role: 'assistant', type: 'text', content: '在呢', characterName: '小雨', createdAt: 0 },
      { id: 'g2', role: 'assistant', type: 'text', content: '来了', characterName: '阿杰', createdAt: 0 },
    ];
    expect(historyEntries(groupMessages)).toEqual([
      { role: 'assistant', content: '在呢', speaker: '小雨' },
      { role: 'assistant', content: '来了', speaker: '阿杰' },
    ]);
    const many: PhoneMessage[] = Array.from({ length: 12 }, (_, i) => ({
      id: `m${i}`,
      role: 'user' as const,
      type: 'text' as const,
      content: `第${i}句`,
      createdAt: i,
    }));
    expect(historyEntries(many)).toHaveLength(10);
    expect(historyEntries(many)[0].content).toBe('第2句');
  });
});
