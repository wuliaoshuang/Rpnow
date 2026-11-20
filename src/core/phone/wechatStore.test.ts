/**
 * 微信记录清空的单元测试。
 *
 * 涉及 IndexedDB 的清空逻辑用一个内存假 store 测——测试环境是 node，
 * 没有 IndexedDB，真实存取在 Playwright 里验。
 */
import { describe, expect, it } from 'vitest';
import type { StorageService } from '@/core/agent/types.js';
import type { PhoneContact } from './types.js';
import { clearPhoneChat, removeContacts, removeWeChatChat } from './wechatStore.js';

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
  { id: 'c_xuena', name: '雪奈', relation: '闺蜜', openingMessage: '主人，你可算来了' },
  { id: 'c_xiaoyu', name: '小雨', relation: '闺蜜', openingMessage: '在吗在吗' },
];

const CONTACTS_B: PhoneContact[] = [
  { id: 'c_ajie', name: '阿杰', relation: '哥哥', openingMessage: '今天花店忙不忙' },
];

async function seedPhoneData(store: StorageService): Promise<void> {
  await store.set('rpnow:phone:contacts:chat-a', CONTACTS_A);
  await store.set('rpnow:phone:wechat:c_xuena', { cardId: 'card-a', contactId: 'c_xuena', messages: [] });
  await store.set('rpnow:phone:wechat:c_xiaoyu', { cardId: 'card-a', contactId: 'c_xiaoyu', messages: [] });
  await store.set('rpnow:phone:contacts:chat-b', CONTACTS_B);
  await store.set('rpnow:phone:wechat:c_ajie', { cardId: 'card-b', contactId: 'c_ajie', messages: [] });
}

describe('clearPhoneChat', () => {
  it('删掉本聊天的联系人缓存和每个联系人的微信记录', async () => {
    const { store } = fakeStore();
    await seedPhoneData(store);
    await clearPhoneChat('chat-a', CONTACTS_A, store);
    expect(await store.get('rpnow:phone:contacts:chat-a')).toBeUndefined();
    expect(await store.get('rpnow:phone:wechat:c_xuena')).toBeUndefined();
    expect(await store.get('rpnow:phone:wechat:c_xiaoyu')).toBeUndefined();
  });

  it('其他聊天的记录一律不动', async () => {
    const { store } = fakeStore();
    await seedPhoneData(store);
    await clearPhoneChat('chat-a', CONTACTS_A, store);
    expect(await store.get('rpnow:phone:contacts:chat-b')).toEqual(CONTACTS_B);
    expect(await store.get('rpnow:phone:wechat:c_ajie')).toBeDefined();
  });

  it('联系人列表为空时，只删联系人缓存', async () => {
    const { store } = fakeStore();
    await seedPhoneData(store);
    await clearPhoneChat('chat-a', [], store);
    expect(await store.get('rpnow:phone:contacts:chat-a')).toBeUndefined();
    expect(await store.get('rpnow:phone:wechat:c_xuena')).toBeDefined();
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
    expect(await store.get('rpnow:phone:wechat:c_xuena')).toBeDefined();
    await removeWeChatChat('c_xuena', store);
    expect(await store.get('rpnow:phone:wechat:c_xuena')).toBeUndefined();
    expect(await store.get('rpnow:phone:wechat:c_xiaoyu')).toBeDefined();
  });
});
