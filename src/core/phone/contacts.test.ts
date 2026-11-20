/**
 * 联系人初始化的单元测试：只测纯函数（解析、兜底、提示词），
 * 不测真的调模型——模型调用在 Playwright 里用假接口验。
 *
 * 卡的主角本人不是联系人：解析时名字是卡名、或 relation 写“本人”
 * 的条目都跳过；兜底是空列表，不编联系人。
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
  it('兜底是空列表：不编联系人，主角本人不是联系人', () => {
    expect(fallbackContacts(fakeCard())).toEqual([]);
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
  it('正常 JSON：主角条目被排除，只留其他人', () => {
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: '嗨，我是淑纯' },
      { name: '小雨', relation: '闺蜜', openingMessage: '在吗在吗，出来玩呀' },
      { name: '阿杰', relation: '哥哥', openingMessage: '今天花店忙不忙' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list!.map((c) => c.name)).toEqual(['小雨', '阿杰']);
    expect(list![0]).toMatchObject({ name: '小雨', relation: '闺蜜' });
    expect(list![0].id).toMatch(/^c_/);
    expect(list!.some((c) => c.name === '李淑纯')).toBe(false);
  });

  it('主角条目靠 relation 本人也能认出来并排除', () => {
    const text = JSON.stringify([
      { name: '淑纯', relation: '本人', openingMessage: '在吗？' },
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list!.map((c) => c.name)).toEqual(['小雨']);
  });

  it('模型只返回主角一人时，结果是空数组，不编联系人', () => {
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: '嗨，我是淑纯' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list).toEqual([]);
  });

  it('空数组返回空数组', () => {
    const list = parseContactsJson('[]', fakeCard());
    expect(list).not.toBeNull();
    expect(list).toEqual([]);
  });

  it('模型没列主角时也一样：只留其他人', () => {
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list!.map((c) => c.name)).toEqual(['小雨']);
  });

  it('```json 代码块包裹也能解析', () => {
    const text = '```json\n[{"name": "小雨", "relation": "闺蜜", "openingMessage": "嗨"}]\n```';
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list!.map((c) => c.name)).toEqual(['小雨']);
  });

  it('JSON 前后有多余文字也能解析', () => {
    const text = '好的，这是人物列表：[{"name": "小雨", "relation": "闺蜜", "openingMessage": "嗨"}] 以上。';
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list).toHaveLength(1);
  });

  it('解析不出来返回 null，调用方走兜底', () => {
    expect(parseContactsJson('抱歉，我不知道', fakeCard())).toBeNull();
    expect(parseContactsJson('这不是 JSON', fakeCard())).toBeNull();
  });

  it('没名字的条目丢掉；都没名字时返回空数组', () => {
    const text = JSON.stringify([
      { relation: '闺蜜', openingMessage: '嗨' },
      { name: '  ', relation: '哥哥', openingMessage: '你好' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).not.toBeNull();
    expect(list).toEqual([]);
  });

  it('重名去重，只留第一个', () => {
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
      { name: '小雨', relation: '同事', openingMessage: '你好' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list).toHaveLength(1);
    expect(list![0].relation).toBe('闺蜜');
  });

  it('缺字段时补默认值，不丢人', () => {
    const text = JSON.stringify([{ name: '阿杰' }]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0]).toMatchObject({
      name: '阿杰',
      relation: '朋友',
      openingMessage: '你好，我是阿杰。',
    });
  });

  it('模型开场白写成大段时压短，不展示长段落', () => {
    const long = '这句'.concat('特别'.repeat(40));
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: long },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].openingMessage.length).toBe(61);
  });

  it('性别从模型 JSON 里存下来', () => {
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨', gender: 'female' },
      { name: '阿杰', relation: '哥哥', openingMessage: '你好', gender: 'male' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].gender).toBe('female');
    expect(list![1].gender).toBe('male');
  });

  it('模型没给性别时按 unknown 存，不崩', () => {
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].gender).toBe('unknown');
  });

  it('性别写了别的值时按 unknown 存', () => {
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨', gender: 'girl' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].gender).toBe('unknown');
  });

  it('人设（profile）从模型 JSON 里存下来，每个人是自己的', () => {
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨', profile: '活泼开朗，短发，爱笑，喜欢拉着人出去玩' },
      { name: '阿杰', relation: '哥哥', openingMessage: '你好', profile: '沉稳可靠，高个子，常穿围裙在花店帮忙' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].profile).toBe('活泼开朗，短发，爱笑，喜欢拉着人出去玩');
    expect(list![1].profile).toBe('沉稳可靠，高个子，常穿围裙在花店帮忙');
    expect(list![0].profile).not.toContain('沉稳可靠');
    expect(list![1].profile).not.toContain('活泼开朗');
  });

  it('模型没给人设时，profile 字段不写', () => {
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨' },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].profile).toBeUndefined();
  });

  it('人设写得太长时压短到 200 字', () => {
    const long = '很长的人设'.repeat(60); // 300 字
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '嗨', profile: long },
    ]);
    const list = parseContactsJson(text, fakeCard());
    expect(list![0].profile!.length).toBe(201);
    expect(list![0].profile!.endsWith('…')).toBe(true);
  });

  it('重新初始化时，名字和以前缓存里的联系人对得上的，沿用以前的 id', () => {
    const previous: PhoneContact[] = [
      { id: 'c_xiaoyu', name: '小雨', relation: '闺蜜', openingMessage: '旧开场白' },
      { id: 'c_ajie', name: '阿杰', relation: '哥哥', openingMessage: '旧开场白' },
    ];
    const text = JSON.stringify([
      { name: '小雨', relation: '闺蜜', openingMessage: '新开场白' },
      { name: '阿杰', relation: '哥哥', openingMessage: '新开场白' },
      { name: '王阿姨', relation: '房东', openingMessage: '新开场白' },
    ]);
    const list = parseContactsJson(text, fakeCard(), previous);
    expect(list![0].id).toBe('c_xiaoyu');
    expect(list![1].id).toBe('c_ajie');
    // 新出现的人（王阿姨）没有旧 id，重新生成一个。
    expect(list![2].id).toMatch(/^c_/);
    expect(list![2].id).not.toBe('c_xiaoyu');
    expect(list![2].id).not.toBe('c_ajie');
  });

  it('主角的旧 id 不会被沿用（主角根本不在新列表里）', () => {
    const previous: PhoneContact[] = [
      { id: 'card-1', name: '李淑纯', relation: '本人', openingMessage: '旧开场白' },
      { id: 'c_xiaoyu', name: '小雨', relation: '闺蜜', openingMessage: '旧开场白' },
    ];
    const text = JSON.stringify([
      { name: '李淑纯', relation: '本人', openingMessage: '新开场白' },
      { name: '小雨', relation: '闺蜜', openingMessage: '新开场白' },
    ]);
    const list = parseContactsJson(text, fakeCard(), previous);
    expect(list!.map((c) => c.name)).toEqual(['小雨']);
    expect(list![0].id).toBe('c_xiaoyu');
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

  it('提示词要求只找其他人物，不把主角本人算进去；没别人时返回空数组', () => {
    const messages = buildInitMessages(fakeCard());
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('不要把卡的主角本人算进去');
    expect(userText).toContain('空数组 []');
    expect(userText).not.toContain('包括主角本人');
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

  it('提示词让模型给每个人写人设（profile），按卡里/世界书里写到的来，没写的不要编', () => {
    const messages = buildInitMessages(fakeCard());
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('profile');
    expect(userText).toContain('人设');
    expect(userText).toContain('不要编');
    expect(userText).toContain('空字符串');
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
      openingMessage: '嗨，我是淑纯',
    },
    { id: 'c_1', name: '小雨', relation: '闺蜜', openingMessage: '在吗在吗' },
  ];

  it('列表里还留着卡的主角本人时，是旧缓存', () => {
    expect(isStaleContacts(staleList, fakeCard())).toBe(true);
  });

  it('列表里只有其他人时，不是旧缓存', () => {
    expect(isStaleContacts([staleList[1]], fakeCard())).toBe(false);
  });

  it('relation 写“本人”的条目也算主角，是旧缓存', () => {
    const list: PhoneContact[] = [
      { id: 'c_9', name: '淑纯', relation: '本人', openingMessage: '嗨' },
    ];
    expect(isStaleContacts(list, fakeCard())).toBe(true);
  });

  it('空列表不是旧缓存', () => {
    expect(isStaleContacts([], fakeCard())).toBe(false);
  });
});
