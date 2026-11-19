import { describe, expect, it } from 'vitest';
import { buildTagInjection } from './tagContext.js';
import { DEFAULT_LOREBOOK_SETTINGS, emptyLorebook, newEntry } from '../types/lorebook.js';
import type { RPCard } from '../types/card.js';
import type { RPAppSettings, RPChat } from '../types/chat.js';
import type { RPCompletionPreset } from '../types/preset.js';

const card = {
  id: 'card1',
  data: {
    name: '咕嘎',
    description: '穿黑色企鹅皮套的小女孩。',
    personality: '活泼。',
    scenario: '雪山。',
    creator_notes: '',
    character_book: undefined,
  },
} as unknown as RPCard;

const chat = {
  id: 'chat1',
  messages: [],
  lorebookIds: ['lb1'],
  useCardLorebook: false,
  variables: {},
} as unknown as RPChat;

const settings = { lorebook: DEFAULT_LOREBOOK_SETTINGS } as unknown as RPAppSettings;

const preset = {
  name: '测试预设',
  prompts: [
    { identifier: 'main', name: '主提示词', system_prompt: true, role: 'system', content: '这里是雪山世界，画风是柔软的毛绒感。', enabled: true },
    { identifier: 'jailbreak', name: '越狱', system_prompt: true, role: 'system', content: '不要提及你是 AI。', enabled: true },
    { identifier: 'example', name: '示例', system_prompt: false, role: 'user', content: '用户示例', enabled: true },
  ],
  prompt_order: [],
} as unknown as RPCompletionPreset;

function worldBook() {
  const b = emptyLorebook('雪山设定');
  b.id = 'lb1';
  b.entries = [
    newEntry({ keys: ['doro'], content: 'doro 是粉色毛绒生物，紫眼睛，头戴玫瑰。' }),
    newEntry({ keys: ['咕嘎'], content: '咕嘎是穿黑色企鹅皮套的小女孩，最爱吃曲奇。' }),
    newEntry({ keys: ['温泉'], content: '雪山有露天温泉。' }),
  ];
  return b;
}

describe('buildTagInjection', () => {
  it('injects the preset and the world-book entries the description mentions', () => {
    const out = buildTagInjection({
      card,
      chat,
      preset,
      lorebooks: [worldBook()],
      settings,
      description: '夜里 doro 把曲奇分给咕嘎。',
    });
    expect(out).toContain('[预设]');
    expect(out).toContain('这里是雪山世界');
    expect(out).toContain('[世界书]');
    expect(out).toContain('doro 是粉色毛绒生物');
    expect(out).toContain('咕嘎是穿黑色企鹅皮套的小女孩');
    // 温泉没有在描述里出现，不应被注入。
    expect(out).not.toContain('露天温泉');
  });

  it('does not inject the description itself (正文由用户指定)', () => {
    const out = buildTagInjection({
      card,
      chat,
      preset,
      lorebooks: [worldBook()],
      settings,
      description: '夜里 doro 把曲奇分给咕嘎。',
    });
    expect(out).not.toContain('夜里 doro 把曲奇分给咕嘎');
  });

  it('returns empty when nothing matches and there is no preset', () => {
    const out = buildTagInjection({
      card,
      chat,
      preset: undefined,
      lorebooks: [worldBook()],
      settings,
      description: '今天天气很好。',
    });
    expect(out).toBe('');
  });
});
