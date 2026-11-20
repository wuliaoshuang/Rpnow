/**
 * 联系人的单元测试：只测还留着的纯函数（兜底、开场白、User 身份、
 * 关系显示、缓存判定、好感度），不测真的调模型。
 *
 * 旧的初始化（PR #53：读最近 30 条主聊天消息、调一次模型认人）已经
 * 删掉了：initContacts / buildInitMessages / formatChatTranscript /
 * parseContactsJson / INIT_CHAT_WINDOW 都不在了，下面的“旧初始化已删”
 * 一节就是证明——直接读源码断言这些名字在 src 里已经不存在。
 *
 * 卡的主角本人不是联系人；relation 是和 User 的关系（不是和主角的关系），
 * 和主角的关系写进 relationToMain；新认出来的联系人一律写 v: 2。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { RPCard } from '@/core/types/card.js';
import type { RPPersona } from '@/core/types/chat.js';
import {
  AFFECTION_DATE_UNLOCK,
  AFFECTION_MAX,
  AFFECTION_PRIVATE_PHOTO_UNLOCK,
  addAffection,
  affectionOf,
  cleanOpeningMessage,
  displayRelation,
  fallbackContacts,
  hasUsableCache,
  isDateUnlocked,
  isPrivatePhotoUnlocked,
  resolvePhoneUser,
} from './contacts.js';
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

describe('resolvePhoneUser', () => {
  const personas: RPPersona[] = [
    { id: 'p-1', name: '转学生小林', description: '刚转学来的新生，和李淑纯同班', createdAt: 0, updatedAt: 0 },
    { id: 'p-2', name: '老用户', description: '另一个人设', createdAt: 0, updatedAt: 0 },
  ];

  it('按聊天的 personaId 找到对应的人设', () => {
    expect(resolvePhoneUser({ personaId: 'p-2' }, personas)).toEqual({
      name: '老用户',
      description: '另一个人设',
    });
  });

  it('聊天没填 personaId 时，用第一个人设（和主聊天一个规矩）', () => {
    expect(resolvePhoneUser({}, personas)).toEqual({
      name: '转学生小林',
      description: '刚转学来的新生，和李淑纯同班',
    });
  });

  it('一个人设都没有时，返回 undefined（没有单独定义 User 的身份）', () => {
    expect(resolvePhoneUser({}, [])).toBeUndefined();
    expect(resolvePhoneUser({ personaId: 'p-9' }, [])).toBeUndefined();
  });
});

describe('displayRelation', () => {
  it('和 User 的关系写了，就显示它', () => {
    expect(
      displayRelation({ id: 'c_1', name: '小雨', relation: '室友', relationToMain: '闺蜜', openingMessage: '嗨' }),
    ).toBe('室友');
  });

  it('和 User 的关系没写、和主角的关系写了，显示“主角的闺蜜”', () => {
    expect(
      displayRelation({ id: 'c_1', name: '小雨', relation: '', relationToMain: '闺蜜', openingMessage: '嗨' }),
    ).toBe('主角的闺蜜');
  });

  it('两边都没写，显示通用标签“朋友”', () => {
    expect(displayRelation({ id: 'c_1', name: '小雨', relation: '', openingMessage: '嗨' })).toBe('朋友');
  });
});

/**
 * 缓存就是权威的：只要是非空列表就原样用，绝不因为“旧”就丢掉重算。
 * 旧缓存（里面还留着主角本人、relation 还是按主角算的 v1、开场白还是
 * first_mes 原文）也是可用缓存——打开时直接用，想清掉就点重置。
 * 只有没缓存（null、空列表、读出来的不是数组）时，调用方给空列表，
 * 等主聊天产出隐藏数据块再填进来（不再调模型初始化）。
 */
describe('hasUsableCache', () => {
  const oldList: PhoneContact[] = [
    {
      id: 'card-1',
      name: '李淑纯',
      relation: '本人',
      openingMessage: '你来啦，今天想买点什么花？',
    },
    { id: 'c_1', name: '小雨', relation: '闺蜜', openingMessage: '在吗在吗' },
  ];

  it('旧缓存（还留着主角本人、relation 按主角算、没有 v）也是可用的，原样用', () => {
    expect(hasUsableCache(oldList)).toBe(true);
  });

  it('relation 写“本人”的条目在旧缓存里也是可用的，不丢掉', () => {
    const list: PhoneContact[] = [
      { id: 'c_9', name: '淑纯', relation: '本人', openingMessage: '嗨' },
    ];
    expect(hasUsableCache(list)).toBe(true);
  });

  it('v 是 2 的新缓存是可用的', () => {
    const fresh: PhoneContact[] = [
      { id: 'c_1', name: '小雨', relation: '闺蜜', relationToMain: '闺蜜', openingMessage: '在吗在吗', v: 2 },
    ];
    expect(hasUsableCache(fresh)).toBe(true);
  });

  it('空列表算没缓存（调用方给空列表，等隐藏数据块）', () => {
    expect(hasUsableCache([])).toBe(false);
  });

  it('null 算没缓存', () => {
    expect(hasUsableCache(null)).toBe(false);
  });

  it('undefined 算没缓存', () => {
    expect(hasUsableCache(undefined)).toBe(false);
  });

  it('读出来的不是数组（缓存损坏）算没缓存', () => {
    expect(hasUsableCache('小雨')).toBe(false);
    expect(hasUsableCache({ name: '小雨' })).toBe(false);
    expect(hasUsableCache(42)).toBe(false);
  });
});

describe('affectionOf', () => {
  const base: PhoneContact = { id: 'c_1', name: '小雨', relation: '闺蜜', openingMessage: '嗨' };

  it('没写好感度的老缓存按 0 算', () => {
    expect(affectionOf(base)).toBe(0);
  });

  it('写了多少就是多少', () => {
    expect(affectionOf({ ...base, affection: 75 })).toBe(75);
  });

  it('超出 0–100 的压回来', () => {
    expect(affectionOf({ ...base, affection: 150 })).toBe(100);
    expect(affectionOf({ ...base, affection: -5 })).toBe(0);
  });

  it('不是数字的按 0 算', () => {
    expect(affectionOf({ ...base, affection: NaN })).toBe(0);
  });
});

describe('addAffection', () => {
  const base: PhoneContact = { id: 'c_1', name: '小雨', relation: '闺蜜', openingMessage: '嗨' };

  it('用户发消息 +1、角色回一次 +1', () => {
    expect(addAffection(base, 1).affection).toBe(1);
    expect(addAffection({ ...base, affection: 48 }, 1).affection).toBe(49);
    expect(addAffection({ ...base, affection: 49 }, 1).affection).toBe(50);
  });

  it('封顶 100，再加也不超', () => {
    expect(addAffection({ ...base, affection: 99 }, 1).affection).toBe(100);
    expect(addAffection({ ...base, affection: 100 }, 1).affection).toBe(100);
  });

  it('原对象不动，返回新对象', () => {
    const out = addAffection({ ...base, affection: 10 }, 1);
    expect(base.affection).toBeUndefined();
    expect(out.affection).toBe(11);
  });
});

describe('解锁阈值', () => {
  const at = (n: number): PhoneContact => ({
    id: 'c_1',
    name: '小雨',
    relation: '闺蜜',
    openingMessage: '嗨',
    affection: n,
  });

  it('约会 50 解锁：49 不行，50 可以', () => {
    expect(AFFECTION_DATE_UNLOCK).toBe(50);
    expect(isDateUnlocked(at(49))).toBe(false);
    expect(isDateUnlocked(at(50))).toBe(true);
  });

  it('私密照 80 解锁：79 不行，80 可以', () => {
    expect(AFFECTION_PRIVATE_PHOTO_UNLOCK).toBe(80);
    expect(isPrivatePhotoUnlocked(at(79))).toBe(false);
    expect(isPrivatePhotoUnlocked(at(80))).toBe(true);
  });

  it('好感度上限是 100', () => {
    expect(AFFECTION_MAX).toBe(100);
  });

  it('没写好感度的老缓存两个都锁着', () => {
    const old: PhoneContact = { id: 'c_1', name: '小雨', relation: '闺蜜', openingMessage: '嗨' };
    expect(isDateUnlocked(old)).toBe(false);
    expect(isPrivatePhotoUnlocked(old)).toBe(false);
  });
});

/**
 * 旧初始化已删的证明：直接读源码，断言 PR #53 的初始化路径在 src 里
 * 已经不存在——删掉的函数名、常量名一个都不能剩。
 * 注意：contacts.ts 顶部的注释里会提到这些名字（写明“已经删掉”），
 * 所以只查“代码”里的出现：去掉注释行再查，提到删掉的那几行注释本身
 * 不算。WeChat.tsx 也一样：注释里可以提，import 和调用里不能有。
 */
describe('旧初始化已删', () => {
  function codeWithoutComments(path: string): string {
    const src = readFileSync(new URL(path, import.meta.url), 'utf8');
    return src
      .split('\n')
      .filter((line) => {
        const t = line.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
  }

  const REMOVED = [
    'initContacts',
    'buildInitMessages',
    'formatChatTranscript',
    'parseContactsJson',
    'INIT_CHAT_WINDOW',
  ];

  it('contacts.ts 里没有旧初始化的函数和常量', () => {
    const code = codeWithoutComments('./contacts.ts');
    for (const name of REMOVED) {
      expect(code, `contacts.ts 里还留着 ${name}`).not.toContain(name);
    }
    // 调模型初始化用的类型也不该再被 contacts.ts 引进来。
    expect(code).not.toContain('LLMService');
    expect(code).not.toContain('RPChatMessage');
  });

  it('WeChat.tsx 里没有旧初始化的 import 和调用', () => {
    const code = codeWithoutComments('../../components/phone/WeChat.tsx');
    for (const name of REMOVED) {
      expect(code, `WeChat.tsx 里还留着 ${name}`).not.toContain(name);
    }
    // 初始化不再读主聊天的消息记录：currentMessages 只剩隐藏数据扫描
    // 和回复提示词在用，初始化那条路已经没了——上面不断言 currentMessages
    // 本身，只断言它不再和 init 一起出现。
    expect(code).not.toContain('chatForInit');
    expect(code).not.toContain('initMessages');
    expect(code).not.toContain('initUser');
  });

  it('phoneData.ts 里没有旧初始化的引用', () => {
    const code = codeWithoutComments('./phoneData.ts');
    for (const name of REMOVED) {
      expect(code, `phoneData.ts 里还留着 ${name}`).not.toContain(name);
    }
  });
});
