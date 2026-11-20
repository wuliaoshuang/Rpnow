/**
 * 小手机隐藏数据的单元测试：只测纯函数（解析、合并、预设文本、
 * activate + buildPrompt 集成），不调模型、不碰 IndexedDB。
 */
import { describe, expect, it } from 'vitest';
import { activate } from '@/core/lorebook/engine.js';
import { buildPrompt } from '@/core/prompt/builder.js';
import { BUILTIN_PRESETS } from '@/core/defaults/presets.js';
import { WI_POSITION } from '@/core/types/card.js';
import type { RPCard } from '@/core/types/card.js';
import type { RPCompletionPreset } from '@/core/types/preset.js';
import {
  DEFAULT_LOREBOOK_SETTINGS,
  newEntry,
} from '@/core/types/lorebook.js';
import type { PhoneContact } from './types.js';
import {
  PHONE_PRESET_ENTRY_NAME,
  phonePresetLorebookId,
} from './phonePresetStore.js';
import {
  buildPhonePresetText,
  extractHiddenCharacters,
  extractHiddenCharactersFromMessages,
  mergeHiddenCharacters,
} from './phoneData.js';

const MAIN = '阿尔德里克';

function block(chars: string): string {
  return `<!-- [小手机数据] {"characters":[${chars}]} -->`;
}

function person(json: string): string {
  return json;
}

describe('extractHiddenCharacters', () => {
  it('解析一个有效的块，字段都读出来', () => {
    const text = `阿杰今天也来了。${block(
      person(
        '{"name":"阿杰","profile":"常来酒馆，总爱带东西","relation":"朋友","relationToMain":"","openingMessage":"下周带一批新茶叶过来","gender":"male"}',
      ),
    )}`;
    const out = extractHiddenCharacters(text, MAIN);
    expect(out).toEqual([
      {
        name: '阿杰',
        profile: '常来酒馆，总爱带东西',
        relation: '朋友',
        openingMessage: '下周带一批新茶叶过来',
        gender: 'male',
      },
    ]);
  });

  it('一条消息里的多个块都解析、合起来返回', () => {
    const text = [
      `小雨来了。${block(person('{"name":"小雨","relation":"朋友","gender":"female"}'))}`,
      `阿杰也来了。${block(person('{"name":"阿杰","relation":"朋友","gender":"male"}'))}`,
    ].join('\n');
    const out = extractHiddenCharacters(text, MAIN);
    expect(out.map((c) => c.name)).toEqual(['小雨', '阿杰']);
  });

  it('某个块的 JSON 坏了，只跳过那个块，其他块照常解析', () => {
    const text = [
      `<!-- [小手机数据] {"characters":[{"name":"坏人",} -->`,
      `小雨来了。${block(person('{"name":"小雨","relation":"朋友"}'))}`,
    ].join('\n');
    const out = extractHiddenCharacters(text, MAIN);
    expect(out.map((c) => c.name)).toEqual(['小雨']);
  });

  it('注释没闭合，当作没有这个块', () => {
    const text = '今天聊得很开心。<!-- [小手机数据] {"characters":[{"name":"坏人"';
    expect(extractHiddenCharacters(text, MAIN)).toEqual([]);
  });

  it('没有块，返回空数组', () => {
    expect(extractHiddenCharacters('今天天气很好，小雨来帮忙了。', MAIN)).toEqual([]);
    expect(extractHiddenCharacters('', MAIN)).toEqual([]);
  });

  it('characters 是空数组，返回空数组', () => {
    expect(extractHiddenCharacters(block('').replace('[', '').replace(']', ''), MAIN)).toEqual([]);
    const text = '<!-- [小手机数据] {"characters":[]} -->';
    expect(extractHiddenCharacters(text, MAIN)).toEqual([]);
  });

  it('主角本人被代码拦住：名字是卡名、或 relation 是“本人”', () => {
    const text = block(
      [
        person(`{"name":"${MAIN}","relation":"朋友"}`),
        person('{"name":"小雨","relation":"本人"}'),
        person('{"name":"阿杰","relation":"朋友"}'),
      ].join(','),
    );
    const out = extractHiddenCharacters(text, MAIN);
    expect(out.map((c) => c.name)).toEqual(['阿杰']);
  });

  it('同名的人只留第一次出现的（忽略大小写和首尾空格）', () => {
    const text = block(
      [
        person('{"name":"阿杰","profile":"第一个"}'),
        person('{"name":" 阿杰 ","profile":"第二个"}'),
      ].join(','),
    );
    const out = extractHiddenCharacters(text, MAIN);
    expect(out).toHaveLength(1);
    expect(out[0].profile).toBe('第一个');
  });

  it('人设超过 200 字会被压短', () => {
    const longProfile = '人'.repeat(300);
    const text = block(person(`{"name":"阿杰","profile":"${longProfile}"}`));
    const out = extractHiddenCharacters(text, MAIN);
    expect(out).toHaveLength(1);
    expect([...(out[0].profile ?? '')].length).toBe(201);
    expect(out[0].profile?.endsWith('…')).toBe(true);
  });

  it('gender 只认 female/male，其他按 unknown 算', () => {
    const text = block(
      [
        person('{"name":"阿杰","gender":"male"}'),
        person('{"name":"小雨","gender":"female"}'),
        person('{"name":"老王","gender":"weird"}'),
        person('{"name":"小明"}'),
      ].join(','),
    );
    const out = extractHiddenCharacters(text, MAIN);
    expect(out.map((c) => c.gender)).toEqual(['male', 'female', 'unknown', 'unknown']);
  });

  it('JSON 里字符串中有大括号也能抠出来', () => {
    const text = block(
      person('{"name":"阿杰","profile":"爱说{加油}这种话","relation":"朋友"}'),
    );
    const out = extractHiddenCharacters(text, MAIN);
    expect(out).toHaveLength(1);
    expect(out[0].profile).toBe('爱说{加油}这种话');
  });
});

describe('extractHiddenCharactersFromMessages', () => {
  it('按时间顺序扫多条消息，同名只留第一次', () => {
    const out = extractHiddenCharactersFromMessages(
      [
        { content: `小雨来了。${block(person('{"name":"小雨","relation":"朋友"}'))}` },
        { content: '今天天气很好。' },
        { content: `阿杰也来了。${block(person('{"name":"阿杰","relation":"朋友"}'))}` },
        { content: `小雨又来了。${block(person('{"name":"小雨","profile":"新的"}'))}` },
      ],
      MAIN,
    );
    expect(out.map((c) => c.name)).toEqual(['小雨', '阿杰']);
    expect(out[0].profile).toBeUndefined();
  });
});

function existingContact(over: Partial<PhoneContact> = {}): PhoneContact {
  return {
    id: 'c_xiaoyu',
    name: '小雨',
    relation: '朋友',
    openingMessage: '在吗在吗，明天一早我就去开门',
    profile: '在酒馆帮忙，手很稳',
    gender: 'female',
    affection: 12,
    v: 2,
    ...over,
  };
}

describe('mergeHiddenCharacters', () => {
  it('新人加进来：id 新生成，好感度从 0 开始，开场白按隐藏数据来', () => {
    const res = mergeHiddenCharacters([], [
      {
        name: '阿杰',
        profile: '常来酒馆',
        relation: '朋友',
        relationToMain: '同事',
        openingMessage: '下周带一批新茶叶过来',
        gender: 'male',
      },
    ]);
    expect(res.changed).toBe(true);
    expect(res.added).toHaveLength(1);
    expect(res.contacts).toHaveLength(1);
    const added = res.contacts[0];
    expect(added.id.startsWith('c_')).toBe(true);
    expect(added.name).toBe('阿杰');
    expect(added.profile).toBe('常来酒馆');
    expect(added.relation).toBe('朋友');
    expect(added.relationToMain).toBe('同事');
    expect(added.openingMessage).toBe('下周带一批新茶叶过来');
    expect(added.gender).toBe('male');
    expect(added.affection).toBe(0);
    expect(added.v).toBe(2);
  });

  it('开场白没给时用默认问候', () => {
    const res = mergeHiddenCharacters([], [{ name: '阿杰', relation: '朋友' }]);
    expect(res.contacts[0].openingMessage).toBe('你好，我是阿杰。');
  });

  it('已经在列表里的人按名字匹配，原样保留：id、好感度、人设都不动，不建重复项', () => {
    const existing = [existingContact()];
    const res = mergeHiddenCharacters(existing, [
      { name: ' 小雨 ', profile: '全新的人设', relation: '闺蜜', gender: 'female' },
      { name: '阿杰', relation: '朋友', gender: 'male' },
    ]);
    expect(res.changed).toBe(true);
    expect(res.added).toHaveLength(1);
    expect(res.added[0].name).toBe('阿杰');
    expect(res.contacts).toHaveLength(2);
    const kept = res.contacts[0];
    expect(kept.id).toBe('c_xiaoyu');
    expect(kept.affection).toBe(12);
    expect(kept.profile).toBe('在酒馆帮忙，手很稳');
    expect(kept.relation).toBe('朋友');
    expect(res.contacts.filter((c) => c.name === '小雨')).toHaveLength(1);
  });

  it('解析出来没新东西时不改列表、不标 changed', () => {
    const existing = [existingContact()];
    const res = mergeHiddenCharacters(existing, [
      { name: '小雨', relation: '朋友' },
    ]);
    expect(res.changed).toBe(false);
    expect(res.added).toEqual([]);
    expect(res.contacts).toBe(existing);
  });

  it('空解析不碰缓存：返回原数组、changed 为 false', () => {
    const existing = [existingContact()];
    const res = mergeHiddenCharacters(existing, []);
    expect(res.changed).toBe(false);
    expect(res.contacts).toBe(existing);
  });

  it('列表满 8 人时，多出来的人这次不加', () => {
    const existing = Array.from({ length: 8 }, (_, i) =>
      existingContact({ id: `c_${i}`, name: `路人${i}` }),
    );
    const res = mergeHiddenCharacters(existing, [{ name: '阿杰', relation: '朋友' }]);
    expect(res.changed).toBe(false);
    expect(res.contacts).toHaveLength(8);
  });
});

describe('buildPhonePresetText', () => {
  it('包含隐藏块格式和 JSON 结构', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain('<!-- [小手机数据]');
    expect(text).toContain('"characters"');
    expect(text).toContain('"name"');
    expect(text).toContain('"profile"');
    expect(text).toContain('"relation"');
    expect(text).toContain('"relationToMain"');
    expect(text).toContain('"openingMessage"');
    expect(text).toContain('"gender"');
  });

  it('写明要排除主角的名字', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain(MAIN);
    expect(text).toContain('不要把主角');
  });

  it('写明没人出现时整段省略', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain('没有出现任何人物时，整段省略');
  });

  it('写明 profile 不超过 200 字、relation 是和 User 的关系', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain('200 字');
    expect(text).toContain('和 User 的关系');
  });
});

function makeCard(over: Partial<RPCard['data']> = {}): RPCard {
  return {
    id: 'c1',
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
    data: {
      name: 'Aria',
      description: 'A bard.',
      personality: 'Cheerful',
      scenario: 'A tavern.',
      first_mes: 'Hello.',
      mes_example: '',
      ...over,
    },
  };
}

const basePreset = (): RPCompletionPreset => structuredClone(BUILTIN_PRESETS[0]);

describe('phone preset — activate + buildPrompt', () => {
  it('常驻预设条目每轮都激活，组装成 system 消息、紧贴在最新用户消息之前', () => {
    const chatId = 'chat-1';
    const book = {
      id: phonePresetLorebookId(chatId),
      name: '小手机·预设',
      description: '',
      entries: [
        newEntry({
          comment: PHONE_PRESET_ENTRY_NAME,
          content: buildPhonePresetText('Aria'),
          enabled: true,
          constant: true,
          keys: [],
          position: WI_POSITION.atDepth,
          depth: 1,
          role: 2,
          probability: 100,
        }),
      ],
      source: 'user' as const,
      createdAt: 0,
      updatedAt: 0,
    };
    const activation = activate({
      books: [book],
      messages: [
        { role: 'user', content: 'Hi there' },
        { role: 'assistant', content: 'Welcome!' },
      ],
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS },
    });
    expect(activation.activated).toHaveLength(1);
    expect(activation.activated[0].content).toContain('[小手机数据]');

    const history = [
      { role: 'user' as const, content: 'Hi there' },
      { role: 'assistant' as const, content: 'Welcome!' },
      { role: 'user' as const, content: '今天阿杰也来了' },
    ];
    const byPosition = new Map<
      number,
      Array<{ content: string; comment?: string; bookName?: string; role?: number; depth?: number }>
    >();
    for (const [pos, list] of activation.byPosition) {
      byPosition.set(
        pos,
        list.map((e) => ({
          content: e.content,
          comment: e.entry.comment,
          bookName: e.bookName,
          role: e.entry.role,
          depth: e.entry.depth,
        })),
      );
    }
    const res = buildPrompt({
      card: makeCard(),
      preset: basePreset(),
      messages: history,
      worldInfo: { byPosition },
    });
    const idx = res.messages.findIndex((m) => m.content.includes('[小手机数据]'));
    expect(idx).toBeGreaterThan(-1);
    // 是一条 system 消息（role 2 在 builder 里就是 system）。
    expect(res.messages[idx].role).toBe('system');
    // 紧贴在最新一条用户消息之前（depth 1，离生成最近）。
    const newestUserIdx = res.messages.findIndex((m) => m.content === '今天阿杰也来了');
    expect(newestUserIdx).toBeGreaterThan(-1);
    expect(idx).toBe(newestUserIdx - 1);
  });
});
