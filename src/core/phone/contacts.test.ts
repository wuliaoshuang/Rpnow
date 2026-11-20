/**
 * 联系人初始化的单元测试：只测纯函数（解析、兜底、提示词），
 * 不测真的调模型——模型调用在 Playwright 里用假接口验。
 */
import { describe, expect, it } from 'vitest';
import type { RPCard } from '@/core/types/card.js';
import { buildInitMessages, cleanOpeningMessage, fallbackContacts, isStaleContacts, parseContactsJson } from './contacts.js';
import type { PhoneContact } from './types.js';

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
  it('只有主角，开场白是 first_mes 压短后的版本（短的原样留）', () => {
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

  it('first_mes 是一大段 RP 描写时，只留第一句', () => {
    const list = fallbackContacts(
      fakeCard({
        first_mes:
          '她回头看过来，蓝色的眼睛里带着明显的水光，脸颊红透，嘴角却还残留着平时那种不服的弧度。*她把手背到身后*「主人，你可算来了。」',
      }),
    );
    expect(list[0].openingMessage).toBe(
      '她回头看过来，蓝色的眼睛里带着明显的水光，脸颊红透，嘴角却还残留着平时那种不服的弧度。',
    );
    expect(list[0].openingMessage).not.toContain('*');
  });

  it('卡没有 first_mes 时用默认问候', () => {
    const list = fallbackContacts(fakeCard({ first_mes: '' }));
    expect(list[0].openingMessage).toContain('李淑纯');
  });

  it('兜底的性别是 unknown（生图时只加 solo，不加 1girl / 1boy）', () => {
    const list = fallbackContacts(fakeCard());
    expect(list[0].gender).toBe('unknown');
  });
});

describe('cleanOpeningMessage', () => {
  it('去掉 *动作描写*，只取第一句', () => {
    const out = cleanOpeningMessage(
      '*她抬起头*「主人，你可算来了。」*她把手背到身后*她等了你一整天。',
      '雪奈',
    );
    expect(out).toBe('「主人，你可算来了。」');
  });

  it('第一句超过 60 字截断并加省略号', () => {
    const long = '这句'.concat('特别'.repeat(40)); // 82 字，没有句末标点
    const out = cleanOpeningMessage(long, '雪奈');
    expect(out.length).toBe(61);
    expect(out.endsWith('…')).toBe(true);
    expect(out.startsWith('这句特别特别')).toBe(true);
  });

  it('只剩动作描写或空的，退回默认问候', () => {
    expect(cleanOpeningMessage('*她笑了笑*', '雪奈')).toBe('你好，我是雪奈。');
    expect(cleanOpeningMessage('', '雪奈')).toBe('你好，我是雪奈。');
  });
});

describe('parseContactsJson', () => {
  it('正常 JSON：主角排第一，id 用卡 id，开场白用模型给的版本', () => {
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: '嗨，我是淑纯' },
      { name: '小雨', relation: '闺蜜', openingMessage: '在吗在吗，出来玩呀' },
      { name: '阿杰', relation: '哥哥', openingMessage: '今天花店忙不忙' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list!.map((c) => c.name)).toEqual(['李淑纯', '小雨', '阿杰']);
    expect(list![0]).toMatchObject({ id: 'card-1', isMain: true, relation: '本人' });
    // 主角开场白用模型给的短消息，不再用卡的 first_mes 原文。
    expect(list![0].openingMessage).toBe('嗨，我是淑纯');
    expect(list![1]).toMatchObject({ name: '小雨', relation: '闺蜜', isMain: false });
    expect(list![1].id).toMatch(/^c_/);
  });

  it('模型没给主角开场白时，主角用 first_mes 压短后的版本', () => {
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: '' },
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].openingMessage).toBe('你来啦，今天想买点什么花？');
  });

  it('主角条目靠 relation 本人也能认出来', () => {
    const text = JSON.stringify([
      { name: '淑纯', relation: '本人', openingMessage: '在吗？' },
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list!.map((c) => c.name)).toEqual(['李淑纯', '小雨']);
    expect(list![0].openingMessage).toBe('在吗？');
  });

  it('模型开场白写成大段时压短，不展示长段落', () => {
    const long = '这句'.concat('特别'.repeat(40));
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: long },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].openingMessage.length).toBe(61);
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

  it('性别从模型 JSON 里存下来：主角和别人都存', () => {
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: '嗨', gender: 'female' },
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨', gender: 'female' },
      { name: '阿杰', relation: '哥哥', openingMessage: '你好', gender: 'male' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].gender).toBe('female');
    expect(list![1].gender).toBe('female');
    expect(list![2].gender).toBe('male');
  });

  it('模型没给性别时按 unknown 存，不崩', () => {
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: '嗨' },
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].gender).toBe('unknown');
    expect(list![1].gender).toBe('unknown');
  });

  it('性别写了别的值时按 unknown 存', () => {
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: '嗨', gender: 'girl' },
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨', gender: '' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].gender).toBe('unknown');
    expect(list![1].gender).toBe('unknown');
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

  it('提示词要求开场白短、按剧情写，不照抄 first_mes、不带动作描写', () => {
    const messages = buildInitMessages(fakeCard());
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('40 字');
    expect(userText).toContain('照抄');
    expect(userText).toContain('*动作描写*');
    expect(userText).toContain('一大段角色扮演描写');
  });

  it('提示词要求写之前先想一想，写的时候保持在角色里、不 OOC、不提 AI', () => {
    const messages = buildInitMessages(fakeCard());
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('先想一想');
    expect(userText).toContain('这个人是谁');
    expect(userText).toContain('不要 OOC');
    expect(userText).toContain('绝不提自己是 AI');
  });

  it('提示词让模型给每个人返回性别（female / male / unknown）', () => {
    const messages = buildInitMessages(fakeCard());
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('gender');
    expect(userText).toContain('female');
    expect(userText).toContain('male');
    expect(userText).toContain('unknown');
  });

  it('传了世界书内容：初始化输入里有世界书一节，模型找人时连世界书里的人也找', () => {
    const lorebookText = '花店的房东叫王阿姨，每周三来收租。';
    const messages = buildInitMessages(fakeCard(), lorebookText);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('世界书内容');
    expect(userText).toContain('花店的房东叫王阿姨');
    expect(userText).toContain('只在世界书里出现的人物也要找出来');
  });

  it('没传世界书：初始化输入里没有世界书一节', () => {
    const messages = buildInitMessages(fakeCard());
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).not.toContain('世界书内容');
  });
});

describe('isStaleContacts', () => {
  const staleList: PhoneContact[] = [
    {
      id: 'card-1',
      name: '李淑纯',
      relation: '本人',
      // 旧逻辑存的缓存：主角开场白就是卡的 first_mes 原文。
      openingMessage: '你来啦，今天想买点什么花？',
      isMain: true,
    },
    { id: 'c_1', name: '小雨', relation: '闺蜜', openingMessage: '在吗在吗', isMain: false },
  ];

  it('主角开场白就是 first_mes 原文时，是旧缓存', () => {
    expect(isStaleContacts(staleList, fakeCard())).toBe(true);
  });

  it('主角开场白是模型写的短消息时，不是旧缓存', () => {
    const fresh: PhoneContact[] = [
      { ...staleList[0], openingMessage: '嗨，我是淑纯，今天花店好热闹' },
      staleList[1],
    ];
    expect(isStaleContacts(fresh, fakeCard())).toBe(false);
  });

  it('卡没有 first_mes 时，不是旧缓存', () => {
    expect(isStaleContacts(staleList, fakeCard({ first_mes: '' }))).toBe(false);
  });

  it('空列表不是旧缓存', () => {
    expect(isStaleContacts([], fakeCard())).toBe(false);
  });

  it('列表里没有主角时，不是旧缓存', () => {
    expect(isStaleContacts([staleList[1]], fakeCard())).toBe(false);
  });
});
