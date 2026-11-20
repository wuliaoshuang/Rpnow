/**
 * 日记（diary.ts）的单元测试。
 */
import { describe, expect, it } from 'vitest';
import type { PhoneContact } from './types.js';
import {
  buildDiaryMessages,
  createDiaryEntry,
  formatDiaryTime,
  parseDiaryText,
  sortDiaryNewestFirst,
} from './diary.js';

function contact(partial: Partial<PhoneContact> = {}): PhoneContact {
  return {
    id: 'c_xiaoyu',
    name: '小雨',
    relation: '室友',
    relationToMain: '闺蜜',
    openingMessage: '在吗在吗',
    profile: '活泼开朗，黑长直，爱吃凉皮',
    gender: 'female',
    v: 2,
    ...partial,
  };
}

describe('formatDiaryTime', () => {
  it('写成“2026年11月20日 星期五 21:30”的样子', () => {
    const ts = new Date(2026, 10, 20, 21, 30).getTime();
    expect(formatDiaryTime(ts)).toBe('2026年11月20日 星期五 21:30');
  });
});

describe('createDiaryEntry', () => {
  it('手写日记：characterName 为 null，内容去空白', () => {
    const entry = createDiaryEntry('  今天去吃了凉皮。 ', null);
    expect(entry).not.toBeNull();
    expect(entry?.content).toBe('今天去吃了凉皮。');
    expect(entry?.characterName).toBeNull();
    expect(entry?.displayTime).toContain('年');
    expect(entry?.timestamp).toBeGreaterThan(0);
  });

  it('AI 日记：characterName 是代写那个联系人的名字', () => {
    const entry = createDiaryEntry('今天好开心。', '小雨');
    expect(entry?.characterName).toBe('小雨');
  });

  it('空内容不建日记', () => {
    expect(createDiaryEntry('   ', null)).toBeNull();
    expect(createDiaryEntry('', '小雨')).toBeNull();
  });
});

describe('sortDiaryNewestFirst', () => {
  it('最新在前', () => {
    const old = createDiaryEntry('旧的', null)!;
    const newer = { ...createDiaryEntry('新的', null)!, timestamp: old.timestamp + 1000 };
    expect(sortDiaryNewestFirst([old, newer]).map((e) => e.content)).toEqual(['新的', '旧的']);
  });
});

describe('parseDiaryText', () => {
  it('去掉整段包着的引号和“日记：”前缀', () => {
    expect(parseDiaryText('“今天去吃了凉皮，好满足。”')).toBe('今天去吃了凉皮，好满足。');
    expect(parseDiaryText('日记：今天下雨了。')).toBe('今天下雨了。');
    expect(parseDiaryText('  今天很开心。  ')).toBe('今天很开心。');
  });

  it('空的返回空字符串', () => {
    expect(parseDiaryText('')).toBe('');
    expect(parseDiaryText('   ')).toBe('');
  });
});

describe('buildDiaryMessages', () => {
  it('提示词里有角色名、人设、第一人称、100–150 字、剧情进度和微信记录', () => {
    const msgs = buildDiaryMessages({
      contact: contact(),
      userName: '小林',
      wechatHistoryText: '小雨：今天凉皮真好吃',
      plotProgress: '用户：今天去军训集合',
      lorebookText: '小雨爱吃凉皮',
    });
    expect(msgs).toHaveLength(1);
    const text = msgs[0].content;
    expect(text).toContain('小雨');
    expect(text).toContain('活泼开朗');
    expect(text).toContain('第一人称');
    expect(text).toContain('100–150 字');
    expect(text).toContain('今天去军训集合');
    expect(text).toContain('今天凉皮真好吃');
    expect(text).toContain('小雨爱吃凉皮');
    expect(text).toContain('不要写成第三人称旁白');
  });

  it('没有记忆时不写空的记忆节', () => {
    const msgs = buildDiaryMessages({
      contact: contact({ profile: '' }),
      userName: '小林',
      wechatHistoryText: '',
      plotProgress: '',
      lorebookText: '',
    });
    const text = msgs[0].content;
    expect(text).not.toContain('最近发生的事：');
    expect(text).not.toContain('最近的聊天记录：');
    expect(text).toContain('你是一个普通朋友');
  });
});
