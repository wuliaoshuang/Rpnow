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
import type { PhoneContact, PhoneMessage } from './types.js';
import {
  PHONE_PRESET_ENTRY_NAME,
  phonePresetLorebookId,
} from './phonePresetStore.js';
import {
  PHONE_DATA_MESSAGE_DEDUP_WINDOW,
  buildKnownNames,
  buildPhonePresetText,
  extractFallbackDataFromMessage,
  extractHiddenCharacters,
  extractHiddenCharactersFromMessages,
  extractHiddenData,
  extractHiddenDataFromMessages,
  extractHiddenDataWithFallback,
  extractHiddenMessages,
  mergeHiddenCharacters,
  mergeHiddenData,
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
  it('按时间顺序扫多条消息，同名只留第一次出现的人；后一次带来的人设补上空字段', () => {
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
    expect(out[0].relation).toBe('朋友');
    expect(out[0].profile).toBe('新的');
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

  it('写明没新人物、没新消息时整段省略', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain('既没有新人物、也没有新消息时，整段省略');
  });

  it('写明 profile 不超过 200 字、relation 是和 User 的关系', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain('200 字');
    expect(text).toContain('和 User 的关系');
  });

  it('写明 messages 的结构：character / role / content', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain('"messages"');
    expect(text).toContain('"character"');
    expect(text).toContain('"role"');
    expect(text).toContain('"content"');
    expect(text).toContain('user 是 User 发给这个联系人的');
    expect(text).toContain('character 是这个联系人发给 User 的');
  });

  it('写明只写实际出现过的人物和实际发生过的消息，不要编', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain('不要编造对话里没出现的人');
    expect(text).toContain('不要编造没说过的话');
  });

  it('写明 messages 里 character 也不要写主角的名字', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain('messages 里 character 也不要写主角的名字');
  });

  it('把要求和后果顶在最前面：不输出这个块，小手机就认不出联系人', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text).toContain('不输出这个块，小手机就认不出任何联系人');
    // 要求在前、解释在后：第一句就是“必须做”，而不是先讲半天背景。
    expect(text.indexOf('必须在正文末尾再追加一个隐藏数据块')).toBeLessThan(
      text.indexOf('格式（HTML 注释'),
    );
  });

  it('比上一版短：上一版 1539 字，这一版不到 1200 字', () => {
    const text = buildPhonePresetText(MAIN);
    expect(text.length).toBeLessThan(1200);
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

function dataBlock(json: string): string {
  return `<!-- [小手机数据] ${json} -->`;
}

describe('extractHiddenData', () => {
  it('一个块里同时有联系人和消息，两边都读出来', () => {
    const text = `阿杰今天也来了。${dataBlock(
      '{"characters":[{"name":"阿杰","profile":"常来酒馆","relation":"朋友","gender":"male"}],"messages":[{"character":"阿杰","role":"character","content":"下周带一批新茶叶过来"},{"character":"阿杰","role":"user","content":"好呀，留一包给我"}]}',
    )}`;
    const out = extractHiddenData(text, MAIN);
    expect(out.characters).toHaveLength(1);
    expect(out.characters[0].name).toBe('阿杰');
    expect(out.messages).toEqual([
      { character: '阿杰', role: 'character', content: '下周带一批新茶叶过来' },
      { character: '阿杰', role: 'user', content: '好呀，留一包给我' },
    ]);
  });

  it('只有消息、没有联系人：messages 照常读出来，characters 是空的', () => {
    const text = dataBlock(
      '{"characters":[],"messages":[{"character":"小雨","role":"character","content":"在吗在吗，明天一早我就去开门"}]}',
    );
    const out = extractHiddenData(text, MAIN);
    expect(out.characters).toEqual([]);
    expect(out.messages).toEqual([
      { character: '小雨', role: 'character', content: '在吗在吗，明天一早我就去开门' },
    ]);
  });

  it('只有联系人、没有 messages 字段：messages 是空的', () => {
    const text = dataBlock('{"characters":[{"name":"阿杰","relation":"朋友"}]}');
    const out = extractHiddenData(text, MAIN);
    expect(out.characters.map((c) => c.name)).toEqual(['阿杰']);
    expect(out.messages).toEqual([]);
  });

  it('messages 里缺 character、role 写错、content 是空的，那条直接跳过，其他条照常', () => {
    const text = dataBlock(
      '{"characters":[],"messages":[' +
        '{"role":"character","content":"没写是谁"},' +
        '{"character":"阿杰","role":"weird","content":"角色写错了"},' +
        '{"character":"阿杰","role":"character","content":"   "},' +
        '{"character":"阿杰","role":"character","content":"这条是对的"}' +
        ']}',
    );
    const out = extractHiddenData(text, MAIN);
    expect(out.messages).toEqual([
      { character: '阿杰', role: 'character', content: '这条是对的' },
    ]);
  });

  it('messages 里 character 是主角名，那条排除；characters 里主角也排除', () => {
    const text = dataBlock(
      `{"characters":[{"name":"${MAIN}","relation":"朋友"},{"name":"阿杰","relation":"朋友"}],` +
        `"messages":[{"character":"${MAIN}","role":"character","content":"主角说的话"},` +
        '{"character":"阿杰","role":"character","content":"阿杰说的话"}]}',
    );
    const out = extractHiddenData(text, MAIN);
    expect(out.characters.map((c) => c.name)).toEqual(['阿杰']);
    expect(out.messages).toEqual([
      { character: '阿杰', role: 'character', content: '阿杰说的话' },
    ]);
  });

  it('JSON 坏了、注释没闭合、没有块：两边都是空数组，不抛错', () => {
    expect(extractHiddenData('<!-- [小手机数据] {"characters":[{"name":"坏人",} -->', MAIN)).toEqual({
      characters: [],
      messages: [],
    });
    expect(extractHiddenData('今天聊得很开心。<!-- [小手机数据] {"characters":[{"name":"坏人"', MAIN)).toEqual({
      characters: [],
      messages: [],
    });
    expect(extractHiddenData('今天天气很好。', MAIN)).toEqual({ characters: [], messages: [] });
    expect(extractHiddenData('', MAIN)).toEqual({ characters: [], messages: [] });
    expect(extractHiddenData('<!-- [小手机数据] {"characters":[],"messages":[]} -->', MAIN)).toEqual({
      characters: [],
      messages: [],
    });
  });

  it('一条消息里的多个块：人物和消息都合起来', () => {
    const text = [
      dataBlock('{"characters":[{"name":"小雨","relation":"朋友"}],"messages":[{"character":"小雨","role":"character","content":"在吗"}]}'),
      dataBlock('{"characters":[{"name":"阿杰","relation":"朋友"}],"messages":[{"character":"阿杰","role":"user","content":"好呀"}]}'),
    ].join('\n');
    const out = extractHiddenData(text, MAIN);
    expect(out.characters.map((c) => c.name)).toEqual(['小雨', '阿杰']);
    expect(out.messages).toEqual([
      { character: '小雨', role: 'character', content: '在吗' },
      { character: '阿杰', role: 'user', content: '好呀' },
    ]);
  });
});

describe('extractHiddenMessages', () => {
  it('只返回 messages 那一半', () => {
    const text = dataBlock(
      '{"characters":[{"name":"阿杰","relation":"朋友"}],"messages":[{"character":"阿杰","role":"user","content":"好呀"}]}',
    );
    expect(extractHiddenMessages(text, MAIN)).toEqual([
      { character: '阿杰', role: 'user', content: '好呀' },
    ]);
  });
});

describe('extractHiddenDataFromMessages', () => {
  it('按时间顺序扫多条消息：人物去重，消息按顺序全留着', () => {
    const out = extractHiddenDataFromMessages(
      [
        { content: dataBlock('{"characters":[{"name":"小雨","relation":"朋友"}],"messages":[{"character":"小雨","role":"character","content":"在吗"}]}') },
        { content: '今天天气很好。' },
        { content: dataBlock('{"characters":[{"name":"小雨","profile":"新的"}],"messages":[{"character":"小雨","role":"user","content":"好呀"}]}') },
      ],
      MAIN,
    );
    expect(out.characters.map((c) => c.name)).toEqual(['小雨']);
    // 后一个块带来的、第一个块没有的人设补上；第一个块已有的关系不被覆盖。
    expect(out.characters[0].profile).toBe('新的');
    expect(out.characters[0].relation).toBe('朋友');
    expect(out.messages).toEqual([
      { character: '小雨', role: 'character', content: '在吗' },
      { character: '小雨', role: 'user', content: '好呀' },
    ]);
  });
});

function storedChat(contents: Array<{ role: 'user' | 'assistant'; content: string }>): PhoneMessage[] {
  return contents.map((m, i) => ({
    id: `m_${i}`,
    role: m.role,
    type: 'text' as const,
    content: m.content,
    createdAt: i,
  }));
}

describe('mergeHiddenData', () => {
  it('新人 + 他的两条消息：联系人加上，消息按顺序贴进他的微信记录，说话人对得上', () => {
    const res = mergeHiddenData(
      [],
      {
        characters: [
          { name: '阿杰', profile: '常来酒馆', relation: '朋友', openingMessage: '下周带一批新茶叶过来', gender: 'male' },
        ],
        messages: [
          { character: '阿杰', role: 'user', content: '好呀，留一包给我' },
          { character: '阿杰', role: 'character', content: '没问题，明天带过去' },
        ],
      },
      new Map(),
      MAIN,
    );
    expect(res.contactsChanged).toBe(true);
    expect(res.messagesChanged).toBe(true);
    expect(res.contacts).toHaveLength(1);
    const contact = res.contacts[0];
    expect(contact.name).toBe('阿杰');
    expect(contact.affection).toBe(0);
    const chat = res.chats.get(contact.id);
    expect(chat).toBeDefined();
    // 记录以开场白起头，再接两条新消息。
    expect(chat!.map((m) => m.content)).toEqual([
      '下周带一批新茶叶过来',
      '好呀，留一包给我',
      '没问题，明天带过去',
    ]);
    expect(chat![0].role).toBe('assistant');
    expect(chat![1].role).toBe('user');
    expect(chat![2].role).toBe('assistant');
    expect(res.appended.get(contact.id)?.map((m) => m.content)).toEqual([
      '好呀，留一包给我',
      '没问题，明天带过去',
    ]);
  });

  it('已经在列表里的人：id、好感度、人设、旧记录都不动，只追加新消息', () => {
    const existing = [existingContact()];
    const oldChat = storedChat([
      { role: 'assistant', content: '在吗在吗，明天一早我就去开门' },
      { role: 'user', content: '好呀' },
    ]);
    const res = mergeHiddenData(
      existing,
      {
        characters: [{ name: ' 小雨 ', profile: '全新的人设', relation: '闺蜜', gender: 'female' }],
        messages: [{ character: '小雨', role: 'character', content: '我带早餐过去' }],
      },
      new Map([['c_xiaoyu', oldChat]]),
      MAIN,
    );
    expect(res.contactsChanged).toBe(false);
    expect(res.contacts).toBe(existing);
    expect(res.contacts[0].id).toBe('c_xiaoyu');
    expect(res.contacts[0].affection).toBe(12);
    expect(res.contacts[0].profile).toBe('在酒馆帮忙，手很稳');
    expect(res.messagesChanged).toBe(true);
    const chat = res.chats.get('c_xiaoyu');
    expect(chat!.map((m) => m.content)).toEqual([
      '在吗在吗，明天一早我就去开门',
      '好呀',
      '我带早餐过去',
    ]);
    // 传入的旧记录数组本身不动。
    expect(oldChat).toHaveLength(2);
  });

  it('同一个块扫两遍不重复：第二次合并时消息一条也不追加', () => {
    const found = {
      characters: [{ name: '阿杰', relation: '朋友', openingMessage: '下周带一批新茶叶过来', gender: 'male' as const }],
      messages: [
        { character: '阿杰', role: 'user' as const, content: '好呀，留一包给我' },
        { character: '阿杰', role: 'character' as const, content: '没问题，明天带过去' },
      ],
    };
    const first = mergeHiddenData([], found, new Map(), MAIN);
    const contact = first.contacts[0];
    const chatAfterFirst = first.chats.get(contact.id)!;
    // 第二次扫到同样的块：拿第一次合并后的记录当已有记录。
    const second = mergeHiddenData(
      first.contacts,
      found,
      new Map([[contact.id, chatAfterFirst]]),
      MAIN,
    );
    expect(second.contactsChanged).toBe(false);
    expect(second.messagesChanged).toBe(false);
    expect(second.appended.size).toBe(0);
    expect(second.chats.size).toBe(0);
  });

  it('user 角色和 character 角色的说话人分得清：user 是 User 发的，character 是联系人发的', () => {
    const res = mergeHiddenData(
      [],
      {
        characters: [{ name: '小雨', relation: '朋友', openingMessage: '在吗' }],
        messages: [
          { character: '小雨', role: 'user', content: '明天一早就去开门' },
          { character: '小雨', role: 'character', content: '好呀，我带早餐过去' },
        ],
      },
      new Map(),
      MAIN,
    );
    const contact = res.contacts[0];
    const chat = res.chats.get(contact.id)!;
    const userMsg = chat.find((m) => m.content === '明天一早就去开门');
    const charMsg = chat.find((m) => m.content === '好呀，我带早餐过去');
    expect(userMsg?.role).toBe('user');
    expect(charMsg?.role).toBe('assistant');
  });

  it('块里只带了消息、没带人：先建一个最小联系人（默认问候、好感度 0），再贴消息', () => {
    const res = mergeHiddenData(
      [],
      {
        characters: [],
        messages: [{ character: '阿杰', role: 'character', content: '下周带一批新茶叶过来' }],
      },
      new Map(),
      MAIN,
    );
    expect(res.contactsChanged).toBe(true);
    expect(res.contacts).toHaveLength(1);
    const contact = res.contacts[0];
    expect(contact.name).toBe('阿杰');
    expect(contact.relation).toBe('');
    expect(contact.openingMessage).toBe('你好，我是阿杰。');
    expect(contact.gender).toBe('unknown');
    expect(contact.affection).toBe(0);
    const chat = res.chats.get(contact.id)!;
    expect(chat.map((m) => m.content)).toEqual(['你好，我是阿杰。', '下周带一批新茶叶过来']);
  });

  it('消息里 character 是主角名：不建联系人、不贴消息', () => {
    const res = mergeHiddenData(
      [],
      {
        characters: [],
        messages: [{ character: MAIN, role: 'character', content: '主角说的话' }],
      },
      new Map(),
      MAIN,
    );
    expect(res.contactsChanged).toBe(false);
    expect(res.messagesChanged).toBe(false);
    expect(res.contacts).toEqual([]);
  });

  it('什么都没有：两边都不变，不返回新数组、不返回新记录', () => {
    const existing = [existingContact()];
    const res = mergeHiddenData(existing, { characters: [], messages: [] }, new Map(), MAIN);
    expect(res.contactsChanged).toBe(false);
    expect(res.messagesChanged).toBe(false);
    expect(res.contacts).toBe(existing);
    expect(res.chats.size).toBe(0);
  });

  it('列表满 8 人时，只带消息的新人建不出来，消息也贴不进去', () => {
    const existing = Array.from({ length: 8 }, (_, i) =>
      existingContact({ id: `c_${i}`, name: `路人${i}` }),
    );
    const res = mergeHiddenData(
      existing,
      {
        characters: [],
        messages: [{ character: '阿杰', role: 'character', content: '新来的' }],
      },
      new Map(),
      MAIN,
    );
    expect(res.contactsChanged).toBe(false);
    expect(res.messagesChanged).toBe(false);
    expect(res.contacts).toHaveLength(8);
  });

  it('去重窗口是 20 条', () => {
    expect(PHONE_DATA_MESSAGE_DEDUP_WINDOW).toBe(20);
  });

  it('调用方传进来的联系人数组不动：只带消息的新人不会 push 进原数组', () => {
    const existing: PhoneContact[] = [];
    const res = mergeHiddenData(
      existing,
      {
        characters: [],
        messages: [{ character: '阿杰', role: 'character', content: '新来的' }],
      },
      new Map(),
      MAIN,
    );
    expect(existing).toEqual([]);
    expect(res.contacts).toHaveLength(1);
  });
});

describe('buildKnownNames', () => {
  const books = [
    {
      entries: [
        { comment: '小雨' },
        { comment: '阿杰' },
        { comment: '' },
        { comment: '这是一句很长的条目名字肯定不是人名' },
      ],
    },
    { entries: [{ comment: '阿豪' }, { comment: '小雨' }] },
  ];

  it('世界书条目的名字 + 已有联系人的名字，主角排除、同名去重', () => {
    const names = buildKnownNames(books, [existingContact({ name: '阿强' })], MAIN);
    expect(names).toEqual(['小雨', '阿杰', '阿豪', '阿强']);
  });

  it('主角的名字不进表', () => {
    const names = buildKnownNames([{ entries: [{ comment: MAIN }] }], [], MAIN);
    expect(names).toEqual([]);
  });

  it('空条目和超长的 comment 不进表', () => {
    const names = buildKnownNames(books, [], MAIN);
    expect(names).not.toContain('');
    expect(names).not.toContain('这是一句很长的条目名字肯定不是人名');
  });

  it('什么都没有时返回空表', () => {
    expect(buildKnownNames([], [], MAIN)).toEqual([]);
  });
});

describe('extractFallbackDataFromMessage', () => {
  const names = ['小雨', '阿杰'];

  it('assistant 剧情里提到小雨：建联系人，带名字的句子贴进小雨的记录', () => {
    const out = extractFallbackDataFromMessage(
      {
        role: 'assistant',
        content: '酒馆里很安静。小雨说：“我学会了一杯新的特调，明天带来给你尝尝。”阿杰放下一包茶叶，说下周再来。',
      },
      names,
      MAIN,
    );
    expect(out.characters.map((c) => c.name)).toEqual(['小雨', '阿杰']);
    expect(out.messages).toEqual([
      { character: '小雨', role: 'character', content: '小雨说：“我学会了一杯新的特调，明天带来给你尝尝。”' },
      { character: '阿杰', role: 'character', content: '阿杰放下一包茶叶，说下周再来。' },
    ]);
    // 开场白是这个人在剧情里第一次说话的那句短句，不是卡的 first_mes。
    expect(out.characters[0].openingMessage).toBe('小雨说：“我学会了一杯新的特调，明天带来给你尝尝。”');
    // 人设和关系不编：留空。
    expect(out.characters[0].profile).toBeUndefined();
    expect(out.characters[0].relation).toBeUndefined();
  });

  it('没提到的名字不建联系人，归不到任何人的句子跳过、不编归属', () => {
    const out = extractFallbackDataFromMessage(
      { role: 'assistant', content: '酒馆里很安静。小雨擦着杯子。窗外的雪下得很大。' },
      names,
      MAIN,
    );
    expect(out.characters.map((c) => c.name)).toEqual(['小雨']);
    expect(out.messages).toEqual([
      { character: '小雨', role: 'character', content: '小雨擦着杯子。' },
    ]);
  });

  it('名字不在表里：不认、不编', () => {
    const out = extractFallbackDataFromMessage(
      { role: 'assistant', content: '阿强今天也来了，带了一篮橘子。' },
      names,
      MAIN,
    );
    expect(out).toEqual({ characters: [], messages: [] });
  });

  it('主角本人不建联系人；一句里同时提到主角和联系人时，那句归联系人', () => {
    const out = extractFallbackDataFromMessage(
      {
        role: 'assistant',
        content: `${MAIN}坐在吧台边。${MAIN}和小雨一起进了酒馆，小雨点了杯热茶。`,
      },
      [...names, MAIN],
      MAIN,
    );
    expect(out.characters.map((c) => c.name)).toEqual(['小雨']);
    expect(out.messages).toEqual([
      { character: '小雨', role: 'character', content: `${MAIN}和小雨一起进了酒馆，小雨点了杯热茶。` },
    ]);
  });

  it('user 的消息：整条贴给每个被提到的人；没提到任何人就跳过，不群发', () => {
    const out = extractFallbackDataFromMessage(
      { role: 'user', content: '小雨，阿杰，明天一早你们都来开门。' },
      names,
      MAIN,
    );
    expect(out.characters.map((c) => c.name)).toEqual(['小雨', '阿杰']);
    expect(out.messages).toEqual([
      { character: '小雨', role: 'user', content: '小雨，阿杰，明天一早你们都来开门。' },
      { character: '阿杰', role: 'user', content: '小雨，阿杰，明天一早你们都来开门。' },
    ]);
    const none = extractFallbackDataFromMessage(
      { role: 'user', content: '今天酒馆打烊早。' },
      names,
      MAIN,
    );
    expect(none).toEqual({ characters: [], messages: [] });
  });

  it('名字是另一个名字的子串时，只算长的那个', () => {
    const out = extractFallbackDataFromMessage(
      { role: 'assistant', content: '阿杰今天也来了。' },
      ['阿杰', '杰'],
      MAIN,
    );
    expect(out.characters.map((c) => c.name)).toEqual(['阿杰']);
    expect(out.messages).toEqual([
      { character: '阿杰', role: 'character', content: '阿杰今天也来了。' },
    ]);
  });

  it('坏掉的隐藏块（没闭合）不影响兜底：块里的名字不读，正文照常认', () => {
    const out = extractFallbackDataFromMessage(
      {
        role: 'assistant',
        content: `今天聊得很开心，下次再聊。<!-- [小手机数据] {"characters":[{"name":"坏人"`,
      },
      names,
      MAIN,
    );
    expect(out).toEqual({ characters: [], messages: [] });
  });

  it('空文本、空名字表都不崩，返回空列表', () => {
    expect(extractFallbackDataFromMessage({ role: 'assistant', content: '' }, names, MAIN)).toEqual({
      characters: [],
      messages: [],
    });
    expect(
      extractFallbackDataFromMessage({ role: 'assistant', content: '小雨来了。' }, [], MAIN),
    ).toEqual({ characters: [], messages: [] });
    expect(
      extractFallbackDataFromMessage({ role: 'assistant', content: '   ' }, names, MAIN),
    ).toEqual({ characters: [], messages: [] });
  });
});

describe('extractHiddenDataWithFallback', () => {
  const names = ['小雨', '阿杰'];

  it('有隐藏块的消息只用块：块里的人和消息都按块里的来，兜底不重复贴', () => {
    const text = `阿杰今天也来了，还带了一批新茶叶。${block(
      person(
        '{"name":"阿杰","profile":"常来酒馆","relation":"朋友","openingMessage":"下周带一批新茶叶过来","gender":"male"}',
      ),
    )}`;
    const out = extractHiddenDataWithFallback(
      [{ role: 'assistant', content: text }],
      names,
      MAIN,
    );
    expect(out.characters).toEqual([
      {
        name: '阿杰',
        profile: '常来酒馆',
        relation: '朋友',
        openingMessage: '下周带一批新茶叶过来',
        gender: 'male',
      },
    ]);
    // 正文里“阿杰今天也来了”那句不另外贴一遍：块是权威的。
    expect(out.messages).toEqual([]);
  });

  it('没隐藏块的消息跑兜底：只写剧情也认得出人', () => {
    const out = extractHiddenDataWithFallback(
      [{ role: 'assistant', content: '小雨说：“我明天一早就去开门。”' }],
      names,
      MAIN,
    );
    expect(out.characters.map((c) => c.name)).toEqual(['小雨']);
    expect(out.messages).toEqual([
      { character: '小雨', role: 'character', content: '小雨说：“我明天一早就去开门。”' },
    ]);
  });

  it('先是 User 提了一句某人、后是剧情里他第一次说话：开场白补上，不丢', () => {
    const out = extractHiddenDataWithFallback(
      [
        { role: 'user', content: '小雨，阿杰，明天一早你们都来开门。' },
        { role: 'assistant', content: '小雨说：“我学会了一杯新的特调，明天带来给你尝尝。”阿杰放下一包茶叶，说下周再来。' },
      ],
      names,
      MAIN,
    );
    expect(out.characters.map((c) => c.name)).toEqual(['小雨', '阿杰']);
    expect(out.characters[0].openingMessage).toBe('小雨说：“我学会了一杯新的特调，明天带来给你尝尝。”');
    expect(out.characters[1].openingMessage).toBe('阿杰放下一包茶叶，说下周再来。');
  });

  it('同一条消息扫两遍不重复：兜底的结果也进合并那一步的去重窗口', () => {
    // 第一条被提到小雨的句子会变成开场白（和那条消息内容一样，合并时去重
    // 会拦住它，不会贴两遍），所以用两句来测：第二句是真正追加的消息。
    const messages = [
      { role: 'assistant', content: '小雨说：“我明天一早就去开门。”小雨又补充了一句：“记得带早餐。”' },
    ];
    const first = extractHiddenDataWithFallback(messages, names, MAIN);
    const res = mergeHiddenData([], first, new Map(), MAIN);
    expect(res.messagesChanged).toBe(true);
    const again = extractHiddenDataWithFallback(messages, names, MAIN);
    const res2 = mergeHiddenData(res.contacts, again, res.chats, MAIN);
    expect(res2.messagesChanged).toBe(false);
    const xiaoyu = res2.contacts.find((c) => c.name === '小雨');
    // 第一次合并的记录里只有开场白 + 第二句，第二遍没再贴一遍。
    expect(res.chats.get(xiaoyu!.id)).toHaveLength(2);
  });
});

describe('mergeHiddenCharacters 补空', () => {
  it('兜底建的联系人（只有名字和默认问候）收到隐藏块后，人设/关系/开场白补上', () => {
    const minimal = existingContact({
      id: 'c_ajie',
      name: '阿杰',
      relation: '',
      relationToMain: undefined,
      openingMessage: '你好，我是阿杰。',
      profile: undefined,
      gender: 'unknown',
      affection: 0,
    });
    const res = mergeHiddenCharacters([minimal], [
      {
        name: '阿杰',
        profile: '常来酒馆，总爱带东西',
        relation: '朋友',
        relationToMain: '同事',
        openingMessage: '下周带一批新茶叶过来',
        gender: 'male',
      },
    ]);
    expect(res.changed).toBe(true);
    expect(res.added).toEqual([]);
    const ajie = res.contacts[0];
    expect(ajie.id).toBe('c_ajie');
    expect(ajie.affection).toBe(0);
    expect(ajie.profile).toBe('常来酒馆，总爱带东西');
    expect(ajie.relation).toBe('朋友');
    expect(ajie.relationToMain).toBe('同事');
    expect(ajie.openingMessage).toBe('下周带一批新茶叶过来');
    expect(ajie.gender).toBe('male');
  });

  it('已经有的人设/关系/开场白不被后来的块覆盖', () => {
    const existing = [existingContact()];
    const res = mergeHiddenCharacters(existing, [
      {
        name: '小雨',
        profile: '另一个人设',
        relation: '同事',
        openingMessage: '另一个开场白',
        gender: 'male',
      },
    ]);
    expect(res.changed).toBe(false);
    expect(res.contacts[0].profile).toBe('在酒馆帮忙，手很稳');
    expect(res.contacts[0].relation).toBe('朋友');
    expect(res.contacts[0].openingMessage).toBe('在吗在吗，明天一早我就去开门');
    expect(res.contacts[0].gender).toBe('female');
  });
});
