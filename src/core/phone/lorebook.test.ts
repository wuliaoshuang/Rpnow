/**
 * 小手机共享世界书的单元测试：只测纯函数（世界书选择与截断），
 * 不测真的调模型——模型调用在 Playwright 里用假接口验。
 */
import { describe, expect, it } from 'vitest';
import type { RPCard } from '@/core/types/card.js';
import {
  DEFAULT_LOREBOOK_SETTINGS,
  newEntry,
  type RPLorebook,
} from '@/core/types/lorebook.js';
import {
  cardBookToLorebook,
  getPhoneBooks,
  selectLorebookText,
  type PhoneLorebookChat,
} from './lorebook.js';

const DEFAULTS = { ...DEFAULT_LOREBOOK_SETTINGS };

function fakeCard(): RPCard {
  return {
    id: 'card-1',
    data: {
      name: '李淑纯',
      description: '和闺蜜小雨一起开花店，哥哥阿杰常来帮忙。蓝发蓝眼，穿碎花围裙。',
      personality: '温柔细心，偶尔傲娇',
      scenario: '大学开学第一天，新生报到',
      first_mes: '她站在宿舍楼门口。',
      mes_example: '',
      character_book: {
        name: '花店角色书',
        entries: [
          {
            keys: ['花店'],
            comment: '花店房东',
            content: '花店的房东叫王阿姨，每周三来收租，喜欢喝茉莉花茶。',
            enabled: true,
          },
          {
            keys: ['年糕'],
            comment: '店猫',
            content: '花店二楼住着一只叫年糕的猫，店里的人都认识它。',
            enabled: true,
            constant: true,
          },
          {
            keys: ['不存在的词'],
            comment: '禁用的条目',
            content: '这条不应该出现。',
            enabled: false,
          },
        ],
      },
    },
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
  };
}

const chat: PhoneLorebookChat = {
  id: 'chat-1',
  lorebookIds: ['book-user'],
  useCardLorebook: true,
};

function userBook(): RPLorebook {
  return {
    id: 'book-user',
    name: '用户世界书',
    entries: [
      newEntry({
        id: 'u1',
        comment: '凉皮摊',
        keys: ['凉皮'],
        content: '老街口有一家凉皮摊，老板姓陈，九月的阳光从法桐树叶缝隙漏下来。',
      }),
      newEntry({
        id: 'u2',
        comment: '空内容',
        keys: ['空'],
        content: '',
      }),
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('cardBookToLorebook', () => {
  it('卡没有 character_book 时返回 null', () => {
    const card = fakeCard();
    delete card.data.character_book;
    expect(cardBookToLorebook(card)).toBeNull();
  });

  it('把卡的角色书转成世界书，条目都在', () => {
    const book = cardBookToLorebook(fakeCard());
    expect(book).not.toBeNull();
    expect(book!.id).toBe('cardbook:card-1');
    expect(book!.source).toBe('character');
    expect(book!.entries.length).toBe(3);
  });
});

describe('getPhoneBooks', () => {
  it('卡的角色书在先，再接聊天选中的用户世界书', () => {
    const books = getPhoneBooks(fakeCard(), chat, [userBook()]);
    expect(books.map((b) => b.id)).toEqual(['cardbook:card-1', 'book-user']);
  });

  it('useCardLorebook 关掉时不带卡的角色书', () => {
    const books = getPhoneBooks(fakeCard(), { ...chat, useCardLorebook: false }, [userBook()]);
    expect(books.map((b) => b.id)).toEqual(['book-user']);
  });

  it('没选中的用户世界书不带进来', () => {
    const books = getPhoneBooks(fakeCard(), { ...chat, lorebookIds: [] }, [userBook()]);
    expect(books.map((b) => b.id)).toEqual(['cardbook:card-1']);
  });

  it('什么都没有时返回空数组', () => {
    const card = fakeCard();
    delete card.data.character_book;
    expect(getPhoneBooks(card, { ...chat, lorebookIds: [], useCardLorebook: false }, [])).toEqual(
      [],
    );
  });

  it('小手机预设书（phone-preset:）不算进来：它是给主聊天读的指令，不是世界知识', () => {
    const presetBook: RPLorebook = {
      id: 'phone-preset:chat-1',
      name: '小手机·预设',
      entries: [],
      createdAt: 0,
      updatedAt: 0,
    };
    const books = getPhoneBooks(
      fakeCard(),
      { ...chat, lorebookIds: ['phone-preset:chat-1', 'book-user'] },
      [userBook(), presetBook],
    );
    expect(books.map((b) => b.id)).toEqual(['cardbook:card-1', 'book-user']);
  });
});

describe('selectLorebookText', () => {
  it('常驻条目（constant）一直生效，不用 key 匹配', () => {
    const text = selectLorebookText(fakeCard(), chat, [userBook()], DEFAULTS, [
      { role: 'user', content: '今天天气真好' },
    ]);
    expect(text).toContain('花店二楼住着一只叫年糕的猫');
  });

  it('key 在最近消息里出现时，条目被选中', () => {
    const text = selectLorebookText(fakeCard(), chat, [userBook()], DEFAULTS, [
      { role: 'user', content: '今天天气真好' },
      { role: 'assistant', content: '要不要去老街吃凉皮？' },
    ]);
    expect(text).toContain('老街口有一家凉皮摊');
  });

  it('key 没出现时，条目不被选中（常驻条目除外）', () => {
    const text = selectLorebookText(fakeCard(), chat, [userBook()], DEFAULTS, [
      { role: 'user', content: '今天天气真好' },
    ]);
    // 凉皮的 key 在消息和卡字段里都没出现，所以不被选中。
    expect(text).not.toContain('老街口有一家凉皮摊');
    // 常驻条目（年糕）一直生效。
    expect(text).toContain('花店二楼住着一只叫年糕的猫');
    // 房东条目也被选中——不是消息匹配的，是卡字段一直在参与匹配：
    // 卡的介绍里就有“开花店”，所以“花店”这个 key 命中了。
    expect(text).toContain('花店的房东叫王阿姨');
  });

  it('禁用的条目永远不被选中', () => {
    const text = selectLorebookText(fakeCard(), chat, [userBook()], DEFAULTS, [
      { role: 'user', content: '不存在的词' },
    ]);
    expect(text).not.toContain('这条不应该出现');
  });

  it('没有世界书时返回空字符串', () => {
    const card = fakeCard();
    delete card.data.character_book;
    expect(
      selectLorebookText(card, { ...chat, lorebookIds: [] }, [], DEFAULTS, [
        { role: 'user', content: '花店' },
      ]),
    ).toBe('');
  });

  it('超预算截断，加“…”收尾', () => {
    const text = selectLorebookText(fakeCard(), chat, [userBook()], DEFAULTS, [
      { role: 'user', content: '今天天气真好' },
    ], 10);
    expect(text.endsWith('…')).toBe(true);
    expect([...text].length).toBeLessThanOrEqual(11);
  });
});
