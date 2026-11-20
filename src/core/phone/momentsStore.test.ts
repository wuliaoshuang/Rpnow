/**
 * 朋友圈存取与世界书同步的单元测试。
 *
 * IndexedDB 的读写在 Playwright 里验（测试环境是 node，没有 IndexedDB）；
 * 这里测能用内存假 store 的 removeMoments，和不碰 IndexedDB 的世界书同步。
 */
import { describe, expect, it } from 'vitest';
import type { StorageService } from '@/core/agent/types.js';
import type { RPChat } from '@/core/types/chat.js';
import type { RPLorebook } from '@/core/types/lorebook.js';
import type { MomentPost } from './types.js';
import {
  MOMENTS_LOREBOOK_NAME,
  momentsLorebookId,
  removeMoments,
  syncMomentsInteraction,
  syncMomentsToLorebook,
  type MomentsLorebookDeps,
} from './momentsStore.js';

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

function post(partial: Partial<MomentPost> = {}): MomentPost {
  return {
    id: 'mp_1',
    contactName: '小雨',
    text: '今天花店的玫瑰开得特别好。',
    summary: '花店玫瑰开了，心情很好',
    imageDesc: '花店里一束红玫瑰',
    location: '花店',
    time: '2026年11月20日 星期五 18:30',
    likers: '阿杰',
    likes: 5,
    comments: [],
    timestamp: 1700000000000,
    imageUrl: '',
    ...partial,
  };
}

function fakeChat(): RPChat {
  const now = Date.now();
  return {
    id: 'chat-1',
    title: '李淑纯',
    cardId: 'card-1',
    personaId: 'p-1',
    lorebookIds: ['book-wang'],
    useCardLorebook: true,
    messages: [],
    variables: {},
    createdAt: now,
    updatedAt: now,
  };
}

/** 世界书同步的假依赖：saveLorebook / saveChat 只记调用，不碰 store。 */
function fakeDeps(chat: RPChat, lorebooks: RPLorebook[] = []) {
  const savedBooks: RPLorebook[] = [];
  const savedChats: RPChat[] = [];
  const deps: MomentsLorebookDeps = {
    lorebooks,
    saveLorebook: async (book) => {
      savedBooks.push(structuredClone(book));
    },
    chat,
    saveChat: async (c) => {
      savedChats.push(structuredClone(c));
    },
  };
  return { deps, savedBooks, savedChats };
}

describe('removeMoments', () => {
  it('删掉指定聊天的朋友圈动态，别的不动', async () => {
    const { store, map } = fakeStore();
    map.set('rpnow:phone:moments:chat-1', [post()]);
    map.set('rpnow:phone:moments:chat-2', [post({ id: 'mp_2' })]);
    await removeMoments('chat-1', store);
    expect(map.has('rpnow:phone:moments:chat-1')).toBe(false);
    expect(map.has('rpnow:phone:moments:chat-2')).toBe(true);
  });
});

describe('syncMomentsToLorebook', () => {
  it('第一次同步建书、写“小雨的朋友圈”条目、把书挂到聊天上', async () => {
    const chat = fakeChat();
    const { deps, savedBooks, savedChats } = fakeDeps(chat);
    await syncMomentsToLorebook('chat-1', [post()], deps);
    expect(savedBooks).toHaveLength(1);
    const book = savedBooks[0];
    expect(book.id).toBe(momentsLorebookId('chat-1'));
    expect(book.name).toBe(MOMENTS_LOREBOOK_NAME);
    expect(book.entries).toHaveLength(1);
    expect(book.entries[0].comment).toBe('小雨的朋友圈');
    expect(book.entries[0].constant).toBe(true);
    expect(book.entries[0].content).toContain('花店玫瑰开了，心情很好');
    expect(book.entries[0].content).not.toContain('今天花店的玫瑰开得特别好');
    expect(savedChats).toHaveLength(1);
    expect(savedChats[0].lorebookIds).toContain(momentsLorebookId('chat-1'));
    expect(savedChats[0].lorebookIds).toContain('book-wang');
  });

  it('一条动态都没有、书也不存在时什么都不做', async () => {
    const chat = fakeChat();
    const { deps, savedBooks, savedChats } = fakeDeps(chat);
    await syncMomentsToLorebook('chat-1', [], deps);
    expect(savedBooks).toHaveLength(0);
    expect(savedChats).toHaveLength(0);
  });

  it('动态删光了，条目也删掉（互动条目不动）', async () => {
    const chat = fakeChat();
    const book: RPLorebook = {
      id: momentsLorebookId('chat-1'),
      name: MOMENTS_LOREBOOK_NAME,
      entries: [
        {
          id: 'e1',
          comment: '小雨的朋友圈',
          keys: ['小雨'],
          secondaryKeys: [],
          content: '旧简介',
          enabled: true,
          constant: true,
          selective: false,
          selectiveLogic: 0,
          position: 0,
          depth: 4,
          role: 0,
          order: 100,
          probability: 100,
          useProbability: false,
          caseSensitive: false,
          matchWholeWords: false,
          useRegex: false,
          group: '',
          groupWeight: 100,
          groupOverride: false,
          excludeRecursion: false,
          preventRecursion: false,
          delayUntilRecursion: false,
          scanDepth: null,
          sticky: 0,
          cooldown: 0,
          delay: 0,
          outletName: '',
          ignoreBudget: false,
          displayIndex: 0,
        },
      ],
      createdAt: 0,
      updatedAt: 0,
    };
    const { deps, savedBooks } = fakeDeps(chat, [book]);
    await syncMomentsToLorebook('chat-1', [], deps);
    expect(savedBooks).toHaveLength(1);
    expect(savedBooks[0].entries).toHaveLength(0);
  });

  it('书已经挂到聊天上时不再重复挂', async () => {
    const chat = fakeChat();
    chat.lorebookIds = ['book-wang', momentsLorebookId('chat-1')];
    const { deps, savedChats } = fakeDeps(chat);
    await syncMomentsToLorebook('chat-1', [post()], deps);
    expect(savedChats).toHaveLength(0);
  });
});

describe('syncMomentsInteraction', () => {
  it('追加互动行到“小雨的朋友圈互动”，多次追加拼在一起', async () => {
    const chat = fakeChat();
    const books: RPLorebook[] = [];
    const { deps, savedBooks } = fakeDeps(chat, books);
    const p = post();
    await syncMomentsInteraction('chat-1', p, { id: 'mc1', author: '小林', text: '好美！', timestamp: 1700000000000 }, deps);
    // 第二次同步要读到第一次存下来的书：把存下来的书放回依赖里。
    books.push(savedBooks[0]);
    await syncMomentsInteraction('chat-1', p, { id: 'mc2', author: '小雨', text: '谢谢！', timestamp: 1700000001000 }, deps);
    const entry = savedBooks[1].entries.find((e) => e.comment === '小雨的朋友圈互动');
    expect(entry).toBeDefined();
    expect(entry?.content).toContain('小林：好美！');
    expect(entry?.content).toContain('小雨：谢谢！');
    expect(entry?.constant).toBe(true);
  });
});
