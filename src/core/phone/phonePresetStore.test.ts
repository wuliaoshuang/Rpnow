/**
 * 小手机预设书的单元测试：只测建书/绑定/更新的逻辑，用假依赖，
 * 不碰真的 store 和 IndexedDB。
 */
import { describe, expect, it } from 'vitest';
import { WI_POSITION } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';
import type { RPLorebook } from '@/core/types/lorebook.js';
import type { MomentsLorebookDeps } from './momentsStore.js';
import {
  PHONE_PRESET_ENTRY_NAME,
  PHONE_PRESET_LOREBOOK_NAME,
  ensurePhonePresetBook,
  phonePresetLorebookId,
} from './phonePresetStore.js';

function fakeDeps(): { deps: MomentsLorebookDeps; books: RPLorebook[]; chat: RPChat } {
  const books: RPLorebook[] = [];
  const chat = {
    id: 'chat-1',
    cardId: 'card-1',
    title: '测试聊天',
    messages: [],
    lorebookIds: [],
    useCardLorebook: true,
    variables: {},
    createdAt: 0,
    updatedAt: 0,
  } as RPChat;
  const deps: MomentsLorebookDeps = {
    lorebooks: books,
    saveLorebook: async (book) => {
      const i = books.findIndex((b) => b.id === book.id);
      if (i >= 0) books[i] = book;
      else books.push(book);
    },
    chat,
    saveChat: async (next) => {
      Object.assign(chat, next);
    },
  };
  return { deps, books, chat };
}

describe('ensurePhonePresetBook', () => {
  it('第一次调：建出预设书，里面一条常驻条目，位置是 atDepth/depth 1/role 2，书绑到聊天上', async () => {
    const { deps, books, chat } = fakeDeps();
    await ensurePhonePresetBook('chat-1', '阿尔德里克', deps);
    expect(books).toHaveLength(1);
    const book = books[0];
    expect(book.id).toBe(phonePresetLorebookId('chat-1'));
    expect(book.id).toBe('phone-preset:chat-1');
    expect(book.name).toBe(PHONE_PRESET_LOREBOOK_NAME);
    expect(book.entries).toHaveLength(1);
    const entry = book.entries[0];
    expect(entry.comment).toBe(PHONE_PRESET_ENTRY_NAME);
    expect(entry.enabled).toBe(true);
    expect(entry.constant).toBe(true);
    expect(entry.position).toBe(WI_POSITION.atDepth);
    expect(entry.depth).toBe(1);
    expect(entry.role).toBe(2);
    expect(entry.probability).toBe(100);
    expect(entry.content).toContain('[小手机数据]');
    expect(entry.content).toContain('阿尔德里克');
    expect(chat.lorebookIds).toEqual(['phone-preset:chat-1']);
  });

  it('第二次调：不重复建书、不重复绑，只更新条目内容（主角名换了也跟得上）', async () => {
    const { deps, books, chat } = fakeDeps();
    await ensurePhonePresetBook('chat-1', '阿尔德里克', deps);
    await ensurePhonePresetBook('chat-1', '李淑纯', deps);
    expect(books).toHaveLength(1);
    expect(books[0].entries).toHaveLength(1);
    expect(books[0].entries[0].content).toContain('李淑纯');
    expect(books[0].entries[0].content).not.toContain('阿尔德里克');
    expect(chat.lorebookIds).toEqual(['phone-preset:chat-1']);
  });

  it('旧条目位置不对时，更新会纠回 atDepth/depth 1/role 2', async () => {
    const { deps, books } = fakeDeps();
    await ensurePhonePresetBook('chat-1', '阿尔德里克', deps);
    books[0].entries[0].position = WI_POSITION.before;
    books[0].entries[0].depth = 4;
    books[0].entries[0].role = 0;
    await ensurePhonePresetBook('chat-1', '阿尔德里克', deps);
    expect(books[0].entries[0].position).toBe(WI_POSITION.atDepth);
    expect(books[0].entries[0].depth).toBe(1);
    expect(books[0].entries[0].role).toBe(2);
  });

  it('聊天上已经绑了别的书时，原来的绑定不动，只追加预设书', async () => {
    const { deps, chat } = fakeDeps();
    chat.lorebookIds = ['book-user'];
    await ensurePhonePresetBook('chat-1', '阿尔德里克', deps);
    expect(chat.lorebookIds).toEqual(['book-user', 'phone-preset:chat-1']);
  });
});
