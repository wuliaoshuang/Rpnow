/**
 * 微信记录迁移与清空的单元测试。
 *
 * 纯函数（旧开场白替换逻辑）直接测；涉及 IndexedDB 的清空逻辑用一个
 * 内存假 store 测——测试环境是 node，没有 IndexedDB，真实存取在
 * Playwright 里验。
 */
import { describe, expect, it } from 'vitest';
import type { StorageService } from '@/core/agent/types.js';
import type { RPCard } from '@/core/types/card.js';
import type { PhoneContact, WeChatChat } from './types.js';
import { clearPhoneChat, migrateStaleGreetingChat, removeContacts, removeWeChatChat } from './wechatStore.js';

/** 内存假 store：实现 StorageService 接口，行为与 idbStorage 一致。 */
function fakeStore() {
  const map = new Map<string, unknown>();
  const store: StorageService = {
    async get<T>(key: string): Promise<T | undefined> {
      return map.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T): Promise<void> {
      map.set(key, value);
    },
    async remove(key: string): Promise<void> {
      map.delete(key);
    },
    async keys(prefix?: string): Promise<string[]> {
      return [...map.keys()].filter((k) => !prefix || k.startsWith(prefix));
    },
    async clear(): Promise<void> {
      map.clear();
    },
  };
  return { store, map };
}

const CONTACTS_A: PhoneContact[] = [
  { id: 'card-a', name: '雪奈', relation: '本人', openingMessage: '主人，你可算来了', isMain: true },
  { id: 'c_xiaoyu', name: '小雨', relation: '闺蜜', openingMessage: '在吗在吗', isMain: false },
];

const CONTACTS_B: PhoneContact[] = [
  { id: 'card-b', name: '阿杰', relation: '本人', openingMessage: '今天花店忙不忙', isMain: true },
];

async function seedPhoneData(store: StorageService): Promise<void> {
  await store.set('rpnow:phone:contacts:chat-a', CONTACTS_A);
  await store.set('rpnow:phone:wechat:card-a', { cardId: 'card-a', contactId: 'card-a', messages: [] });
  await store.set('rpnow:phone:wechat:c_xiaoyu', { cardId: 'card-a', contactId: 'c_xiaoyu', messages: [] });
  await store.set('rpnow:phone:contacts:chat-b', CONTACTS_B);
  await store.set('rpnow:phone:wechat:card-b', { cardId: 'card-b', contactId: 'card-b', messages: [] });
}

describe('clearPhoneChat', () => {
  it('删掉本聊天的联系人缓存和每个联系人的微信记录', async () => {
    const { store } = fakeStore();
    await seedPhoneData(store);
    await clearPhoneChat('chat-a', CONTACTS_A, store);
    expect(await store.get('rpnow:phone:contacts:chat-a')).toBeUndefined();
    expect(await store.get('rpnow:phone:wechat:card-a')).toBeUndefined();
    expect(await store.get('rpnow:phone:wechat:c_xiaoyu')).toBeUndefined();
  });

  it('其他聊天的记录一律不动', async () => {
    const { store } = fakeStore();
    await seedPhoneData(store);
    await clearPhoneChat('chat-a', CONTACTS_A, store);
    expect(await store.get('rpnow:phone:contacts:chat-b')).toEqual(CONTACTS_B);
    expect(await store.get('rpnow:phone:wechat:card-b')).toBeDefined();
  });

  it('联系人列表为空时，只删联系人缓存', async () => {
    const { store } = fakeStore();
    await seedPhoneData(store);
    await clearPhoneChat('chat-a', [], store);
    expect(await store.get('rpnow:phone:contacts:chat-a')).toBeUndefined();
    expect(await store.get('rpnow:phone:wechat:card-a')).toBeDefined();
    expect(await store.get('rpnow:phone:wechat:c_xiaoyu')).toBeDefined();
  });

  it('本来就没有记录时，不报错', async () => {
    const { store } = fakeStore();
    await expect(clearPhoneChat('chat-none', CONTACTS_A, store)).resolves.toBeUndefined();
  });
});

describe('removeContacts / removeWeChatChat', () => {
  it('各自只删自己的那条 key', async () => {
    const { store } = fakeStore();
    await seedPhoneData(store);
    await removeContacts('chat-a', store);
    expect(await store.get('rpnow:phone:contacts:chat-a')).toBeUndefined();
    expect(await store.get('rpnow:phone:wechat:card-a')).toBeDefined();
    await removeWeChatChat('card-a', store);
    expect(await store.get('rpnow:phone:wechat:card-a')).toBeUndefined();
    expect(await store.get('rpnow:phone:wechat:c_xiaoyu')).toBeDefined();
  });
});

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
