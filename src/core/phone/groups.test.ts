/**
 * 群聊纯函数的单元测试：建群 / 管群、谁回（路由）、世界书同步内容。
 */
import { describe, expect, it } from 'vitest';
import type { PhoneContact, PhoneGroup, PhoneMessage } from './types.js';
import {
  GROUP_CHAT_KEEP_LINES,
  addGroupMember,
  buildGroupChatEntryContent,
  buildGroupNote,
  createGroup,
  groupAvatarNames,
  groupChatEntryKeys,
  groupChatEntryName,
  groupMembers,
  isGroupNameTaken,
  leastRecentlySpokenFirst,
  mentionedMembers,
  pickGroupRepliers,
  removeGroupMember,
  spokenOrder,
} from './groups.js';

const XIAOYU: PhoneContact = {
  id: 'c_xiaoyu',
  name: '小雨',
  relation: '室友',
  openingMessage: '在吗在吗',
  gender: 'female',
};
const AJIE: PhoneContact = {
  id: 'c_ajie',
  name: '阿杰',
  relation: '学长',
  openingMessage: '今天花店忙不忙',
  gender: 'male',
};
const WANGAYI: PhoneContact = {
  id: 'c_wangayi',
  name: '王阿姨',
  relation: '',
  relationToMain: '房东',
  openingMessage: '房租该交了',
  gender: 'female',
};
const CONTACTS = [XIAOYU, AJIE, WANGAYI];

function group(memberIds: string[] = ['c_xiaoyu', 'c_ajie']): PhoneGroup {
  return { id: 'g_1', name: '宿舍小分队', memberIds, createdAt: 0 };
}

function msg(
  partial: Partial<PhoneMessage> & { role: PhoneMessage['role'] },
): PhoneMessage {
  return { id: `m_${Math.random()}`, type: 'text', content: 'hi', createdAt: 0, ...partial };
}

describe('isGroupNameTaken / createGroup', () => {
  it('同名（去空格、不区分大小写）算被占，空名不算', () => {
    const groups = [group()];
    expect(isGroupNameTaken(groups, '宿舍小分队')).toBe(true);
    expect(isGroupNameTaken(groups, ' 宿舍小分队 ')).toBe(true);
    expect(isGroupNameTaken(groups, '另一个群')).toBe(false);
    expect(isGroupNameTaken(groups, '   ')).toBe(false);
  });

  it('建群：名字去空格、成员去重；名字空或不到两个人建不出来', () => {
    const g = createGroup(' 宿舍小分队 ', ['c_xiaoyu', 'c_ajie', 'c_xiaoyu']);
    expect(g?.name).toBe('宿舍小分队');
    expect(g?.memberIds).toEqual(['c_xiaoyu', 'c_ajie']);
    expect(g?.id.startsWith('g_')).toBe(true);
    expect(createGroup('   ', ['c_xiaoyu', 'c_ajie'])).toBeNull();
    expect(createGroup('一个人的群', ['c_xiaoyu'])).toBeNull();
    expect(createGroup('没人的群', [])).toBeNull();
  });
});

describe('addGroupMember / removeGroupMember', () => {
  it('加人：已经在群里就不动，没在就追加到最后', () => {
    const g = group();
    expect(addGroupMember(g, 'c_ajie')).toBe(g);
    const added = addGroupMember(g, 'c_wangayi');
    expect(added.memberIds).toEqual(['c_xiaoyu', 'c_ajie', 'c_wangayi']);
    expect(g.memberIds).toEqual(['c_xiaoyu', 'c_ajie']);
  });

  it('踢人：不在群里就不动；踢掉最后一个人返回 null（群解散）', () => {
    const g = group(['c_xiaoyu', 'c_ajie', 'c_wangayi']);
    expect(removeGroupMember(g, 'c_nobody')).toBe(g);
    const kicked = removeGroupMember(g, 'c_ajie');
    expect(kicked?.memberIds).toEqual(['c_xiaoyu', 'c_wangayi']);
    expect(removeGroupMember(group(['c_xiaoyu']), 'c_xiaoyu')).toBeNull();
  });
});

describe('groupMembers / groupAvatarNames', () => {
  it('成员按群里的顺序排，缓存里找不到的跳过', () => {
    expect(groupMembers(group(['c_ajie', 'c_xiaoyu', 'c_ghost']), CONTACTS)).toEqual([
      AJIE,
      XIAOYU,
    ]);
  });

  it('群头像只取前 4 位成员的名字', () => {
    const big = group(['c_xiaoyu', 'c_ajie', 'c_wangayi']);
    expect(groupAvatarNames(big, CONTACTS)).toEqual(['小雨', '阿杰', '王阿姨']);
  });
});

describe('spokenOrder / leastRecentlySpokenFirst', () => {
  it('最近说过话的在前，从没说过话的不在里面', () => {
    const history = [
      msg({ role: 'assistant', characterName: '小雨', content: '在呢' }),
      msg({ role: 'user', content: '阿杰呢' }),
      msg({ role: 'assistant', characterName: '阿杰', content: '来了' }),
      msg({ role: 'assistant', characterName: '小雨', content: '哈哈' }),
    ];
    expect(spokenOrder(history)).toEqual(['小雨', '阿杰']);
  });

  it('最久没说话的排最前，从没说过话的比谁都靠前', () => {
    const history = [
      msg({ role: 'assistant', characterName: '小雨', content: '在呢' }),
      msg({ role: 'assistant', characterName: '阿杰', content: '来了' }),
    ];
    // 王阿姨从没说过话 → 最前；小雨比阿杰说得早 → 小雨在阿杰前面。
    expect(
      leastRecentlySpokenFirst([XIAOYU, AJIE, WANGAYI], history).map((c) => c.name),
    ).toEqual(['王阿姨', '小雨', '阿杰']);
  });
});

describe('mentionedMembers', () => {
  it('按名字在句子里出现的位置排，最先被提到的在前', () => {
    expect(mentionedMembers('阿杰你好，顺便问下小雨在吗', CONTACTS)).toEqual([
      AJIE,
      XIAOYU,
    ]);
    expect(mentionedMembers('今天天气不错', CONTACTS)).toEqual([]);
  });
});

describe('pickGroupRepliers', () => {
  it('点名提到谁，谁先回；一轮 1–3 个人', () => {
    const history = [msg({ role: 'user', content: '大家好' })];
    const repliers = pickGroupRepliers({
      group: group(),
      contacts: CONTACTS,
      history,
      userText: '小雨，你在干嘛',
    });
    expect(repliers[0]).toEqual(XIAOYU);
    expect(repliers.length).toBeGreaterThanOrEqual(1);
    expect(repliers.length).toBeLessThanOrEqual(3);
  });

  it('冲整个群说的（大家/你们），最久没说话的人先回', () => {
    const history = [
      msg({ role: 'user', content: '小雨在吗' }),
      msg({ role: 'assistant', characterName: '小雨', content: '在呢' }),
    ];
    const repliers = pickGroupRepliers({
      group: group(),
      contacts: CONTACTS,
      history,
      userText: '大家都在吗',
    });
    // 阿杰从没说过话 → 最久没说话 → 他先回。
    expect(repliers[0]).toEqual(AJIE);
  });

  it('没点名也没冲全群：轮到最久没说话的人，不总让同一个人回', () => {
    const history = [
      msg({ role: 'user', content: '在吗' }),
      msg({ role: 'assistant', characterName: '小雨', content: '在呢' }),
    ];
    const first = pickGroupRepliers({
      group: group(),
      contacts: CONTACTS,
      history,
      userText: '今天吃什么',
    });
    expect(first[0]).toEqual(AJIE);
    // 阿杰回过之后再问，轮到小雨。
    const second = pickGroupRepliers({
      group: group(),
      contacts: CONTACTS,
      history: [
        ...history,
        msg({ role: 'assistant', characterName: '阿杰', content: '吃凉皮' }),
      ],
      userText: '那明天呢',
    });
    expect(second[0]).toEqual(XIAOYU);
  });

  it('一个人的群只有他回；没有成员时没人回', () => {
    expect(
      pickGroupRepliers({
        group: group(['c_xiaoyu']),
        contacts: CONTACTS,
        history: [],
        userText: '在吗',
      }),
    ).toEqual([XIAOYU]);
    expect(
      pickGroupRepliers({ group: group([]), contacts: CONTACTS, history: [], userText: '在吗' }),
    ).toEqual([]);
  });

  it('附和人数 0–2：同一句话在不同轮数下回的人数会变（不总让所有人都回）', () => {
    const counts = new Set<number>();
    for (let round = 0; round < 6; round++) {
      const history = Array.from({ length: round }, (_, i) =>
        msg({ role: 'user', content: `第${i}句` }),
      );
      const repliers = pickGroupRepliers({
        group: group(['c_xiaoyu', 'c_ajie', 'c_wangayi']),
        contacts: CONTACTS,
        history,
        userText: '今天吃什么',
      });
      counts.add(repliers.length);
      expect(repliers.length).toBeLessThanOrEqual(3);
    }
    expect(counts.size).toBeGreaterThan(1);
  });
});

describe('buildGroupNote', () => {
  it('写明在哪个群、和谁一起聊、记忆归属', () => {
    const note = buildGroupNote('宿舍小分队', ['小雨', '阿杰'], '小雨');
    expect(note).toContain('群聊「宿舍小分队」');
    expect(note).toContain('阿杰');
    expect(note).not.toContain('和小雨一起');
    expect(note).toContain('只有那位成员自己记得');
  });
});

describe('群聊记录的世界书条目', () => {
  it('条目名和关键词：群名 + 全部成员名', () => {
    expect(groupChatEntryName('宿舍小分队')).toBe('宿舍小分队的群聊记录');
    expect(groupChatEntryKeys('宿舍小分队', ['小雨', '阿杰'])).toEqual([
      '宿舍小分队',
      '小雨',
      '阿杰',
    ]);
  });

  it('内容：头两行 + 最近的消息行，图片和表情包换成占位文字，系统消息不要', () => {
    const messages = [
      msg({ role: 'system', content: '正在生成图片…', createdAt: 1000 }),
      msg({ role: 'user', content: '小雨在吗', createdAt: 2000 }),
      msg({ role: 'assistant', characterName: '小雨', content: '在呢', createdAt: 3000 }),
      msg({ role: 'assistant', characterName: '阿杰', type: 'image', content: 'prompt', createdAt: 4000 }),
      msg({ role: 'assistant', characterName: '小雨', type: 'sticker', content: '', createdAt: 5000 }),
    ];
    const content = buildGroupChatEntryContent('宿舍小分队', ['小雨', '阿杰'], messages);
    expect(content).toContain('群聊「宿舍小分队」的群聊记录');
    expect(content).toContain('只有那位成员自己记得');
    expect(content).toContain('用户：小雨在吗');
    expect(content).toContain('小雨：在呢');
    expect(content).toContain('阿杰：[图片]');
    expect(content).toContain('小雨：[表情]');
    expect(content).not.toContain('正在生成图片');
  });

  it('没有消息时返回空字符串（调用方不建条目）', () => {
    expect(buildGroupChatEntryContent('宿舍小分队', ['小雨'], [])).toBe('');
  });

  it('聊得再长也只留最近 GROUP_CHAT_KEEP_LINES 行', () => {
    const messages = Array.from({ length: GROUP_CHAT_KEEP_LINES + 10 }, (_, i) =>
      msg({ role: 'user', content: `第${i}句`, createdAt: i }),
    );
    const content = buildGroupChatEntryContent('宿舍小分队', ['小雨'], messages);
    expect(content).toContain('第10句');
    expect(content).not.toContain('第9句');
    expect(content).toContain(`第${GROUP_CHAT_KEEP_LINES + 9}句`);
  });
});
