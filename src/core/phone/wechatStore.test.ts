/**
 * 微信记录迁移的单元测试：只测纯函数（旧开场白替换逻辑），
 * 不测 IndexedDB——测试环境里没有 IndexedDB，存取在 Playwright 里验。
 */
import { describe, expect, it } from 'vitest';
import type { RPCard } from '@/core/types/card.js';
import type { PhoneContact, WeChatChat } from './types.js';
import { migrateStaleGreetingChat } from './wechatStore.js';

const LONG_FIRST_MES =
  '她回头看过来，蓝色的眼睛里带着明显的水光，脸颊红透，嘴角却还残留着平时那种不服的弧度。*她把手背到身后*「主人，你可算来了。」';

function fakeCard(firstMes: string): RPCard {
  return {
    id: 'card-1',
    data: {
      name: '雪奈',
      description: '',
      personality: '',
      scenario: '',
      first_mes: firstMes,
      mes_example: '',
    },
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
  };
}

const freshMain: PhoneContact = {
  id: 'card-1',
  name: '雪奈',
  relation: '本人',
  openingMessage: '主人，你可算来了，今天过得怎么样？',
  isMain: true,
};

function fakeChat(messages: WeChatChat['messages']): WeChatChat {
  return { cardId: 'card-1', contactId: 'card-1', messages, updatedAt: 1000 };
}

const msg = (content: string, role: 'user' | 'assistant' = 'assistant') => ({
  id: `m_${content.length}`,
  role,
  type: 'text' as const,
  content,
  createdAt: 1000,
});

describe('migrateStaleGreetingChat', () => {
  it('第一条就是 first_mes 原文时，换成新开场白，后面的消息不动', () => {
    const chat = fakeChat([
      msg(LONG_FIRST_MES),
      msg('在呀', 'user'),
      msg('哈哈，今天花店来了好多客人呢'),
    ]);
    const out = migrateStaleGreetingChat(chat, fakeCard(LONG_FIRST_MES), freshMain);
    expect(out).not.toBeNull();
    expect(out!.messages).toHaveLength(3);
    expect(out!.messages[0].content).toBe('主人，你可算来了，今天过得怎么样？');
    expect(out!.messages[0].role).toBe('assistant');
    expect(out!.messages[1].content).toBe('在呀');
    expect(out!.messages[2].content).toBe('哈哈，今天花店来了好多客人呢');
    expect(out!.updatedAt).toBeGreaterThanOrEqual(1000);
  });

  it('第一条已经是模型写的短开场白时，不动', () => {
    const chat = fakeChat([msg('主人，你可算来了，今天过得怎么样？')]);
    expect(migrateStaleGreetingChat(chat, fakeCard(LONG_FIRST_MES), freshMain)).toBeNull();
  });

  it('第一条是用户发过的消息时，不动', () => {
    const chat = fakeChat([msg('在吗', 'user')]);
    expect(migrateStaleGreetingChat(chat, fakeCard(LONG_FIRST_MES), freshMain)).toBeNull();
  });

  it('没有消息时，不动', () => {
    expect(migrateStaleGreetingChat(fakeChat([]), fakeCard(LONG_FIRST_MES), freshMain)).toBeNull();
  });

  it('卡没有 first_mes 时，不动', () => {
    const chat = fakeChat([msg('你好呀')]);
    expect(migrateStaleGreetingChat(chat, fakeCard(''), freshMain)).toBeNull();
  });
});
