/**
 * 群聊存取与世界书同步的单元测试。
 *
 * 涉及 IndexedDB 的部分用一个内存假 store 测——测试环境是 node，
 * 没有 IndexedDB，真实存取在 Playwright 里验（wechatStore.test.ts 同款）。
 * 世界书同步用内存里的 lorebooks + 假的 saveLorebook / saveChat 测。
 */
import { describe, expect, it } from 'vitest';
import type { StorageService } from '@/core/agent/types.js';
import type { RPChat } from '@/core/types/chat.js';
import type { RPLorebook } from '@/core/types/lorebook.js';
import type { PhoneGroup, PhoneMessage } from './types.js';
import {
  clearPhoneGroups,
  groupChatLorebookId,
  removeGroupChat,
  removeGroupChatFromLorebook,
  removeGroups,
  syncGroupChatToLorebook,
} from './groupStore.js';
import type { MomentsLorebookDeps } from './momentsStore.js';

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

const GROUP: PhoneGroup = {
  id: 'g_1',
  name: '宿舍小分队',
  memberIds: ['c_xiaoyu', 'c_ajie'],
  createdAt: 1000,
};

function msg(partial: Partial<PhoneMessage> & { role: PhoneMessage['role'] }): PhoneMessage {
  return { id: `m_${Math.random()}`, type: 'text', content: 'hi', createdAt: 2000, ...partial };
}

function fakeChat(): RPChat {
  return {
    id: 'chat-a',
    cardId: 'card-a',
    title: 'test',
    messages: [],
    branches: {},
    currentBranchId: 'main',
    lorebookIds: [],
    createdAt: 0,
    updatedAt: 0,
  } as unknown as RPChat;
}

function fakeDeps(lorebooks: RPLorebook[] = [], chat: RPChat = fakeChat()): {
  deps: MomentsLorebookDeps;
  savedBooks: RPLorebook[];
  savedChats: RPChat[];
} {
  const savedBooks: RPLorebook[] = [];
  const savedChats: RPChat[] = [];
  const deps: MomentsLorebookDeps = {
    lorebooks,
    saveLorebook: async (book) => {
      savedBooks.push(book);
      const i = lorebooks.findIndex((b) => b.id === book.id);
      if (i >= 0) lorebooks[i] = book;
      else lorebooks.push(book);
    },
    chat,
    saveChat: async (c) => {
      savedChats.push(c);
    },
  };
  return { deps, savedBooks, savedChats };
}

describe('群列表与群聊记录的存取', () => {
  it('clearPhoneGroups：删掉本聊天的群列表和每个群的记录，其他聊天不动', async () => {
    const { store } = fakeStore();
    await store.set('rpnow:phone:groups:chat-a', [GROUP]);
    await store.set('rpnow:phone:groupchat:g_1', {
      cardId: 'card-a',
      groupId: 'g_1',
      messages: [],
      updatedAt: 0,
    });
    await store.set('rpnow:phone:groups:chat-b', [{ ...GROUP, id: 'g_2' }]);
    await clearPhoneGroups('chat-a', [GROUP], store);
    expect(await store.get('rpnow:phone:groups:chat-a')).toBeUndefined();
    expect(await store.get('rpnow:phone:groupchat:g_1')).toBeUndefined();
    expect(await store.get('rpnow:phone:groups:chat-b')).toBeDefined();
  });

  it('removeGroups / removeGroupChat 各删各的', async () => {
    const { store } = fakeStore();
    await store.set('rpnow:phone:groups:chat-a', [GROUP]);
    await store.set('rpnow:phone:groupchat:g_1', {
      cardId: 'card-a',
      groupId: 'g_1',
      messages: [],
      updatedAt: 0,
    });
    await removeGroups('chat-a', store);
    expect(await store.get('rpnow:phone:groups:chat-a')).toBeUndefined();
    expect(await store.get('rpnow:phone:groupchat:g_1')).toBeDefined();
    await removeGroupChat('g_1', store);
    expect(await store.get('rpnow:phone:groupchat:g_1')).toBeUndefined();
  });
});

describe('群聊记录同步进世界书', () => {
  it('同步后有一本“小手机·群聊”，条目叫“{群名}的群聊记录”，关键词是群名+成员名', async () => {
    const { deps, savedBooks, savedChats } = fakeDeps();
    const messages = [
      msg({ role: 'user', content: '小雨在吗', createdAt: 2000 }),
      msg({ role: 'assistant', characterName: '小雨', content: '在呢', createdAt: 3000 }),
    ];
    await syncGroupChatToLorebook('chat-a', GROUP, ['小雨', '阿杰'], messages, deps);
    expect(savedBooks).toHaveLength(1);
    expect(savedBooks[0].id).toBe(groupChatLorebookId('chat-a'));
    expect(savedBooks[0].name).toBe('小手机·群聊');
    const entry = savedBooks[0].entries[0];
    expect(entry.comment).toBe('宿舍小分队的群聊记录');
    expect(entry.keys).toEqual(['宿舍小分队', '小雨', '阿杰']);
    expect(entry.constant).toBe(true);
    expect(entry.content).toContain('小雨：在呢');
    // 书挂到聊天上。
    expect(savedChats).toHaveLength(1);
    expect(savedChats[0].lorebookIds).toContain(groupChatLorebookId('chat-a'));
  });

  it('群里没消息时不建书、不建条目', async () => {
    const { deps, savedBooks } = fakeDeps();
    await syncGroupChatToLorebook('chat-a', GROUP, ['小雨', '阿杰'], [], deps);
    expect(savedBooks).toHaveLength(0);
  });

  it('再同步一次是更新同一条目，不是多建一条', async () => {
    const lorebooks: RPLorebook[] = [];
    const { deps, savedBooks } = fakeDeps(lorebooks);
    const first = [msg({ role: 'user', content: '第一句', createdAt: 2000 })];
    await syncGroupChatToLorebook('chat-a', GROUP, ['小雨', '阿杰'], first, deps);
    const second = [
      ...first,
      msg({ role: 'assistant', characterName: '小雨', content: '在呢', createdAt: 3000 }),
    ];
    await syncGroupChatToLorebook('chat-a', GROUP, ['小雨', '阿杰'], second, deps);
    expect(lorebooks[0].entries).toHaveLength(1);
    expect(lorebooks[0].entries[0].content).toContain('在呢');
    expect(savedBooks).toHaveLength(2);
  });

  it('群解散时删掉它的条目；书不存在时什么都不做', async () => {
    const lorebooks: RPLorebook[] = [];
    const { deps } = fakeDeps(lorebooks);
    await syncGroupChatToLorebook(
      'chat-a',
      GROUP,
      ['小雨', '阿杰'],
      [msg({ role: 'user', content: 'hi', createdAt: 2000 })],
      deps,
    );
    expect(lorebooks[0].entries).toHaveLength(1);
    await removeGroupChatFromLorebook('chat-a', '宿舍小分队', deps);
    expect(lorebooks[0].entries).toHaveLength(0);
    // 再删一次也不报错。
    await removeGroupChatFromLorebook('chat-a', '宿舍小分队', deps);
    await removeGroupChatFromLorebook('chat-nope', '宿舍小分队', deps);
  });
});
