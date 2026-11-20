/**
 * 联系人初始化的单元测试：只测纯函数（解析、兜底、提示词），
 * 不测真的调模型——模型调用在 Playwright 里用假接口验。
 */
import { describe, expect, it } from 'vitest';
import type { RPCard } from '@/core/types/card.js';
import { buildInitMessages, fallbackContacts, parseContactsJson } from './contacts.js';

function fakeCard(overrides: Partial<RPCard['data']> = {}): RPCard {
  return {
    id: 'card-1',
    data: {
      name: '李淑纯',
      description: '和闺蜜小雨一起开花店，哥哥阿杰常来帮忙。',
      personality: '温柔细心',
      scenario: '花店里的一天',
      first_mes: '你来啦，今天想买点什么花？',
      mes_example: '',
      ...overrides,
    },
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('fallbackContacts', () => {
  it('只有主角，开场白就是卡的 first_mes', () => {
    const list = fallbackContacts(fakeCard());
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: 'card-1',
      name: '李淑纯',
      relation: '本人',
      openingMessage: '你来啦，今天想买点什么花？',
      isMain: true,
    });
  });

  it('卡没有 first_mes 时用默认问候', () => {
    const list = fallbackContacts(fakeCard({ first_mes: '' }));
    expect(list[0].openingMessage).toContain('李淑纯');
  });
});

describe('parseContactsJson', () => {
  it('正常 JSON：主角排第一，id 用卡 id，开场白用 first_mes', () => {
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: '嗨，我是淑纯' },
      { name: '小雨', relation: '闺蜜', openingMessage: '在吗在吗，出来玩呀' },
      { name: '阿杰', relation: '哥哥', openingMessage: '今天花店忙不忙' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list!.map((c) => c.name)).toEqual(['李淑纯', '小雨', '阿杰']);
    expect(list![0]).toMatchObject({ id: 'card-1', isMain: true, relation: '本人' });
    // 主角开场白固定用卡的 first_mes，不用模型给的版本。
    expect(list![0].openingMessage).toBe('你来啦，今天想买点什么花？');
    expect(list![1]).toMatchObject({ name: '小雨', relation: '闺蜜', isMain: false });
    expect(list![1].id).toMatch(/^c_/);
  });

  it('```json 代码块包裹也能解析', () => {
    const text = '```json\n[{"name": "小雨", "relation": "闺蜜", "openingMessage": "嗨"}]\n```';
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list!.map((c) => c.name)).toEqual(['李淑纯', '小雨']);
  });

  it('JSON 前后有多余文字也能解析', () => {
    const text = '好的，这是人物列表：[{"name": "小雨", "relation": "闺蜜", "openingMessage": "嗨"}] 以上。';
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list).toHaveLength(2);
  });

  it('解析不出来返回 null，调用方走兜底', () => {
    expect(parseContactsJson('抱歉，我不知道', fakeCard())).toBeNull();
    expect(parseContactsJson('这不是 JSON', fakeCard())).toBeNull();
  });

  it('空数组返回只有主角的列表', () => {
    const list = parseContactsJson('[]', fakeCard());
    expect(list).not.toBeNull();
    expect(list).toHaveLength(1);
    expect(list![0].isMain).toBe(true);
  });

  it('没名字的条目丢掉；都没名字只剩主角', () => {
    const text = JSON.stringify([
      { relation: '闺蜜', openingMessage: '嗨' },
      { name: '  ', relation: '哥哥', openingMessage: '你好' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list).toHaveLength(1);
  });

  it('模型没列主角时，主角自动补到第一位', () => {
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list!.map((c) => c.name)).toEqual(['李淑纯', '小雨']);
  });

  it('重名去重，只留第一个', () => {
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
      { name: '小雨', relation: '同事', openingMessage: '你好' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).toHaveLength(2);
    expect(list![1].relation).toBe('闺蜜');
  });

  it('缺字段时补默认值，不丢人', () => {
    const text = JSON.stringify([{ name: '阿杰' }]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![1]).toMatchObject({
      name: '阿杰',
      relation: '朋友',
      openingMessage: '你好，我是阿杰。',
    });
  });
});

describe('buildInitMessages', () => {
  it('把卡的内容都交过去', () => {
    const messages = buildInitMessages(fakeCard());
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('李淑纯');
    expect(userText).toContain('闺蜜小雨');
    expect(userText).toContain('哥哥阿杰');
    expect(userText).toContain('JSON');
  });
});
