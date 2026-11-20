/**
* 小手机回复与生图提示词的单元测试：只测纯函数（提示词拼装），
* 不测真的调模型——模型调用在 Playwright 里用假接口验。
*
* 联系人都是卡里提到的其他人物（卡的主角本人不是联系人），
* 每个联系人带自己的人设（profile），回复和生图都按这个人来。
*/
import { describe, expect, it} from 'vitest';
import type { RPCard} from '@/core/types/card.js';
import type { RPChatMessage} from '@/core/types/chat.js';
import type { PhoneContact} from './types.js';
import {
  buildImagePromptMessages,
  buildImageTagContext,
  buildReplySystemPrompt,
  enforceComposition,
  enforceSoloPrompt,
  formatPlotProgress,
  inferPeopleFromRequest,
  looksLikeImageRequest,
} from './reply.js';

const SCENARIO_MARKER = 'SCENARIO_花店里的一天，主人推门进来';
const FIRST_MES_MARKER = 'FIRSTMES_她回头看过来，蓝色的眼睛里带着明显的水光';

function fakeCard(overrides: Partial<RPCard['data']> = {}): RPCard {
  return {
    id: 'card-1',
    data: {
      name: '李淑纯',
      description: '和闺蜜小雨一起开花店，哥哥阿杰常来帮忙。蓝发蓝眼，穿碎花围裙。',
      personality: '温柔细心，偶尔傲娇',
      scenario: SCENARIO_MARKER,
      first_mes: FIRST_MES_MARKER,
      mes_example: '',
      ...overrides,
    },
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
  };
}

const xiaoyuContact: PhoneContact = {
  id: 'c_xiaoyu',
  name: '小雨',
  relation: '闺蜜',
  openingMessage: '在吗在吗，出来玩呀',
  gender: 'female',
  profile: '活泼开朗，短发，爱笑，喜欢拉着人出去玩',
};

const ajieContact: PhoneContact = {
  id: 'c_ajie',
  name: '阿杰',
  relation: '哥哥',
  openingMessage: '今天花店忙不忙',
  gender: 'male',
  profile: '沉稳可靠，高个子，常穿围裙在花店帮忙',
};

describe('buildReplySystemPrompt', () => {
  it('小雨：设定（scenario）和开场白都进了提示词，但都标明了身份', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), xiaoyuContact);
    // 设定：卡的 scenario 进了一节（介绍和性格已经在身份那一段，这里不重复）。
    expect(prompt).toContain('\u3010设定\u3011');
    expect(prompt).toContain(SCENARIO_MARKER);
    // 开场白：进了一节，只当说话方式的参考——写明了不要当成
    // 微信第一条消息、不要照抄；微信第一条还是模型按剧情写的短消息。
    expect(prompt).toContain('\u3010开场白\u3011');
    expect(prompt).toContain(FIRST_MES_MARKER);
    expect(prompt).toContain('不要把它当成微信的第一条消息');
    expect(prompt).toContain('不要照抄');
  });

  it('阿杰：同样有设定和开场白', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), ajieContact);
    expect(prompt).toContain('\u3010设定\u3011');
    expect(prompt).toContain(SCENARIO_MARKER);
    expect(prompt).toContain('\u3010开场白\u3011');
    expect(prompt).toContain(FIRST_MES_MARKER);
  });

  it('卡没有 scenario / first_mes 时，这两节整个不写', () => {
    const prompt = buildReplySystemPrompt(
      fakeCard({ scenario: '', first_mes: ''}),
      xiaoyuContact,
    );
    expect(prompt).not.toContain('\u3010设定\u3011');
    expect(prompt).not.toContain('\u3010开场白\u3011');
    expect(prompt).not.toContain(SCENARIO_MARKER);
    expect(prompt).not.toContain(FIRST_MES_MARKER);
  });

  it('开场白太长时只引用前 500 字', () => {
    const long = `FIRSTMES_${'很长很长的开场白'.repeat(100)}`;
    const prompt = buildReplySystemPrompt(fakeCard({ first_mes: long}), xiaoyuContact);
    expect(prompt).toContain('\u3010开场白\u3011');
    expect(prompt).toContain('…');
    expect(prompt).not.toContain(long);
  });

  it('小雨：留着自己的名字、和主角的关系、卡的介绍', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), xiaoyuContact);
    expect(prompt).toContain('小雨');
    expect(prompt).toContain('闺蜜');
    expect(prompt).toContain('和闺蜜小雨一起开花店');
    // 卡的介绍（主角开的店、蓝发蓝眼）是主角世界的背景，在身份里；
    // 主角本人的性格（温柔细心）不是小雨的，不写进小雨的提示词。
    expect(prompt).not.toContain('温柔细心');
  });

  it('阿杰：留着名字、和主角的关系、卡的介绍', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), ajieContact);
    expect(prompt).toContain('阿杰');
    expect(prompt).toContain('哥哥');
    expect(prompt).toContain('和闺蜜小雨一起开花店');
  });

  it('联系人自己的人设（profile）写进提示词，扮演他/她才不会 OOC', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), xiaoyuContact);
    expect(prompt).toContain('\u3010人设\u3011');
    expect(prompt).toContain('活泼开朗，短发，爱笑');
  });

  it('不同联系人的人设各归各的：小雨的提示词里没有阿杰的人设', () => {
    const xiaoyuPrompt = buildReplySystemPrompt(fakeCard(), xiaoyuContact);
    const ajiePrompt = buildReplySystemPrompt(fakeCard(), ajieContact);
    expect(xiaoyuPrompt).toContain('活泼开朗，短发，爱笑');
    expect(xiaoyuPrompt).not.toContain('沉稳可靠，高个子');
    expect(ajiePrompt).toContain('沉稳可靠，高个子');
    expect(ajiePrompt).not.toContain('活泼开朗，短发，爱笑');
  });

  it('联系人没有人设时，提示词里没有人设一节，不崩', () => {
    const contact: PhoneContact = {
      id: 'c_xiaoyu',
      name: '小雨',
      relation: '闺蜜',
      openingMessage: '在吗在吗',
    };
    const prompt = buildReplySystemPrompt(fakeCard(), contact);
    expect(prompt).toContain('你要扮演「小雨」');
    expect(prompt).not.toContain('\u3010人设\u3011');
  });

  it('第一句就写明这是 role play：扮演角色，在叫微信的地方和用户聊天', () => {
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('role play');
      expect(prompt).toContain('角色扮演');
      expect(prompt).toContain('你要扮演');
      expect(prompt).toContain('一个叫微信的地方');
      expect(prompt).toContain('和用户聊天');
    }
    expect(buildReplySystemPrompt(fakeCard(), xiaoyuContact)).toContain('你要扮演「小雨」');
    expect(buildReplySystemPrompt(fakeCard(), ajieContact)).toContain('你要扮演「阿杰」');
    expect(buildReplySystemPrompt(fakeCard(), xiaoyuContact)).toContain('「李淑纯」的闺蜜');
    expect(buildReplySystemPrompt(fakeCard(), ajieContact)).toContain('「李淑纯」的哥哥');
  });

  it('发图时要按场景判断图里有几个人，填 people 参数', () => {
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('people');
      expect(prompt).toContain('solo / duo / multi');
      expect(prompt).toContain('你一个人');
      expect(prompt).toContain('你和用户两个人');
    }
  });

  it('只在用户明确要图时发图：不主动发图，表情包可以主动发', () => {
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('用户没让你发图时，不要发图');
      expect(prompt).toContain('不要自己主动发图');
      expect(prompt).toContain('表情包可以主动发');
      expect(prompt).not.toContain('你自己提到拍了照片');
      expect(prompt).not.toContain('想分享一张图');
    }
  });

  it('写明这是独立的微信聊天，不是主线剧情的延续', () => {
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('独立的微信聊天');
      expect(prompt).toContain('不是主线聊天的延续');
      expect(prompt).toContain('不要继续主线剧情');
      expect(prompt).toContain('不要提及主线里正在发生的剧情');
    }
  });

  it('要求先想一想再回，全程不 OOC、不提 AI、不用动作描写', () => {
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('先想一想');
      expect(prompt).toContain('不要 OOC');
      expect(prompt).toContain('绝不提自己是 AI');
      expect(prompt).toContain('*动作描写*');
      expect(prompt).toContain('1–3 句');
    }
  });

  it('传了剧情进度：提示词里有这一节，写明只做了解、不续写主线', () => {
    const plot = formatPlotProgress(
      [
        mainMsg('assistant', '刚在报到处领了学生卡，明天早上八点军训集合。'),
        mainMsg('user', '我在4栋，你在哪栋？'),
        mainMsg('assistant', '我在3栋，隔一栋楼。'),
      ],
      '李淑纯',
    );
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact, { plotProgress: plot});
      expect(prompt).toContain('主线聊天的最近进展');
      expect(prompt).toContain('仅供你了解当前剧情到了哪一步');
      expect(prompt).toContain('军训集合');
      expect(prompt).toContain('我在4栋');
      expect(prompt).toContain('我在3栋');
      expect(prompt).toContain('不要直接续写主线剧情');
      expect(prompt).toContain('微信是你和用户单独的聊天');
      // 独立性的老话还在：不是主线聊天的延续。
      expect(prompt).toContain('不是主线聊天的延续');
      expect(prompt).toContain('不要继续主线剧情');
    }
  });

  it('没传剧情进度：提示词里没有这一节', () => {
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).not.toContain('主线聊天的最近进展');
      expect(prompt).not.toContain('不要直接续写主线剧情');
    }
  });

  it('传了世界书：提示词里有一节；没传就没有', () => {
    const lorebookText = '花店二楼住着一只叫年糕的猫，店里的人都认识它。';
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact, { lorebookText});
      expect(prompt).toContain('\u3010世界书\u3011');
      expect(prompt).toContain('花店二楼住着一只叫年糕的猫');
      expect(buildReplySystemPrompt(fakeCard(), contact)).not.toContain('\u3010世界书\u3011');
    }
  });

  it('传了预设：提示词里有一节，放在最后（最高注入深度）', () => {
    const presetText = 'PRESET_写回复前先想一想角色此刻的心情。';
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact, {
        plotProgress: '剧情进度_报到日',
        lorebookText: '世界书_花店二楼有猫',
        presetText,
      });
      expect(prompt).toContain('\u3010预设\u3011');
      expect(prompt).toContain('PRESET_写回复前先想一想角色此刻的心情');
      expect(prompt).toContain('最高优先级');
      // 顺序：预设在最后——在剧情进度、世界书、设定、开场白、工具说明
      // 之后，紧贴聊天记录（离生成最近、最显眼）。
      const idx = (s: string) => prompt.indexOf(s);
      expect(idx('\u3010预设\u3011')).toBeGreaterThan(idx('主线聊天的最近进展'));
      expect(idx('\u3010预设\u3011')).toBeGreaterThan(idx('\u3010世界书\u3011'));
      expect(idx('\u3010预设\u3011')).toBeGreaterThan(idx('\u3010设定\u3011'));
      expect(idx('\u3010预设\u3011')).toBeGreaterThan(idx('\u3010开场白\u3011'));
      // 预设是最后一段：它在工具说明之后，后面什么都没有。
      expect(prompt.indexOf('\u3010预设\u3011')).toBeGreaterThan(prompt.indexOf('发图工具'));
    }
    // 没传预设：这一节整个不写。
    expect(buildReplySystemPrompt(fakeCard(), xiaoyuContact)).not.toContain('\u3010预设\u3011');
  });

  it('预设那一段写明：回复格式仍是微信短消息，不套主聊天的正文包裹格式', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), xiaoyuContact, {
      presetText: 'PRESET_随便写点什么。',
    });
    expect(prompt).toContain('回复的格式仍是微信短消息');
    expect(prompt).toContain('不要套用预设里主聊天的正文包裹格式');
  });

  it('讲清楚发图和发表情包两个工具怎么用', () => {
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('send_image');
      expect(prompt).toContain('send_sticker');
      expect(prompt).toContain('调用发图工具发一张真的图');
      expect(prompt).toContain('只有用户明确让你发图的时候');
      expect(prompt).toContain('发表情包');
      expect(prompt).toContain('先回一句文字，再发图或表情包');
    }
  });

  it('调用不了工具时，教模型用 [发图：…] / [表情：…] 标记', () => {
    for (const contact of [xiaoyuContact, ajieContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('[发图：这张图的内容]');
      expect(prompt).toContain('[表情：开心/难过/害羞/惊讶/亲昵/生气]');
    }
  });
});

/** 主线聊天消息的假数据：默认 assistant、现在的时间戳。 */
let mainMsgSeq = 0;
function mainMsg(
  role: RPChatMessage['role'],
  content: string,
  extra: Partial<RPChatMessage> = {},
): RPChatMessage {
  mainMsgSeq += 1;
  return { id: `m-${mainMsgSeq}`, role, content, createdAt: 0,...extra};
}

describe('formatPlotProgress', () => {
  it('最近的消息都在，标清楚谁说的（用户 / 角色名）', () => {
    const out = formatPlotProgress(
      [
        mainMsg('assistant', '刚在报到处领了学生卡，明天早上八点军训集合。'),
        mainMsg('user', '我在4栋，你在哪栋？'),
        mainMsg('assistant', '我在3栋，隔一栋楼。'),
      ],
      '李淑纯',
    );
    expect(out).toContain('李淑纯：刚在报到处领了学生卡');
    expect(out).toContain('用户：我在4栋，你在哪栋？');
    expect(out).toContain('李淑纯：我在3栋，隔一栋楼。');
  });

  it('只取最近 10 条，更早的不要', () => {
    const messages = Array.from({ length: 12}, (_, i) =>
    mainMsg(i % 2 === 0? 'assistant': 'user', `第${i + 1}条`),
  );
    const out = formatPlotProgress(messages, '李淑纯');
    expect(out).not.toContain('第1条');
    expect(out).not.toContain('第2条');
    expect(out).toContain('第3条');
    expect(out).toContain('第12条');
    expect(out.split('\n')).toHaveLength(10);
  });

  it('超长的单条截断到 200 字，多余的用“…”代替', () => {
    const long = '字'.repeat(250);
    const out = formatPlotProgress([mainMsg('assistant', long)], '李淑纯');
    expect(out).toBe(`李淑纯：${'字'.repeat(200)}…`);
    expect(out.length).toBeLessThan(long.length);
  });

  it('系统消息、隐藏消息、开场白、空消息都不要', () => {
    const out = formatPlotProgress(
      [
        mainMsg('system', '系统：这是系统提示'),
        mainMsg('assistant', '这是开场白', { isGreeting: true}),
        mainMsg('assistant', '这是隐藏的消息', { hidden: true}),
        mainMsg('user', ' '),
        mainMsg('assistant', '这是真正的剧情'),
      ],
      '李淑纯',
    );
    expect(out).toBe('李淑纯：这是真正的剧情');
  });

  it('空列表和只有开场白时返回空字符串', () => {
    expect(formatPlotProgress([], '李淑纯')).toBe('');
    expect(
      formatPlotProgress([mainMsg('assistant', '这是开场白', { isGreeting: true})], '李淑纯'),
    ).toBe('');
  });
});

describe('enforceSoloPrompt', () => {
  it('模型写了多人标签也照删：2girls、group、multiple girls 都去掉，开头是单人标记', () => {
    const out = enforceSoloPrompt(
      '2girls, long blue hair, blue eyes, floral apron, group, dorm building, multiple girls, masterpiece',
      'female',
    );
    expect(out.startsWith('1girl, solo')).toBe(true);
    expect(out).not.toContain('2girls');
    expect(out).not.toContain('group');
    expect(out).not.toContain('multiple girls');
  });

  it('性别决定开头的单人标记：女 1girl, solo / 男 1boy, solo / 未知 solo', () => {
    expect(enforceSoloPrompt('school uniform, dorm building', 'female')).toBe(
      '1girl, solo, school uniform, dorm building',
    );
    expect(enforceSoloPrompt('school uniform, dorm building', 'male')).toBe(
      '1boy, solo, school uniform, dorm building',
    );
    expect(enforceSoloPrompt('school uniform, dorm building', 'unknown')).toBe(
      'solo, school uniform, dorm building',
    );
  });

  it('外貌和场景标签原样保留，只动人数', () => {
    const out = enforceSoloPrompt(
      '2girls, long blue hair, blue eyes, buying liangpi under a plane tree, old street, september sunlight',
      'female',
    );
    expect(out).toBe(
      '1girl, solo, long blue hair, blue eyes, buying liangpi under a plane tree, old street, september sunlight',
    );
  });

  it('已经以 1girl 开头的，不重复加 1girl，只补 solo', () => {
    expect(enforceSoloPrompt('1girl, long blue hair, dorm building', 'female')).toBe(
      '1girl, solo, long blue hair, dorm building',
    );
    expect(enforceSoloPrompt('1boy, short black hair, dorm building', 'male')).toBe(
      '1boy, solo, short black hair, dorm building',
    );
  });

  it('已经是 1girl, solo 开头的，原样不动', () => {
    expect(enforceSoloPrompt('1girl, solo, long blue hair', 'female')).toBe(
      '1girl, solo, long blue hair',
    );
  });

  it('多人标签大小写和空格不影响删除', () => {
    const out = enforceSoloPrompt('2Girls, Crowd, school uniform', 'female');
    expect(out).not.toContain('2Girls');
    expect(out).not.toContain('Crowd');
    expect(out).toBe('1girl, solo, school uniform');
  });
});

describe('enforceComposition', () => {
  it('solo：和以前一样，删多人标签、开头是单人标记', () => {
    expect(
      enforceComposition(
        '2girls, long blue hair, group, dorm building, multiple girls',
        'solo',
        'female',
      ),
    ).toBe('1girl, solo, long blue hair, dorm building');
  });

  it('duo：删掉 solo 和多人标签，换成双人标记，没有 solo', () => {
    const out = enforceComposition(
      '1girl, solo, long blue hair, school uniform, group, dorm building, multiple girls, masterpiece',
      'duo',
      'female',
    );
    expect(out.startsWith('2girls')).toBe(true);
    expect(out).not.toContain('solo');
    expect(out).not.toContain('1girl');
    expect(out).not.toContain('group');
    expect(out).not.toContain('multiple girls');
    expect(out).toContain('long blue hair');
    expect(out).toContain('dorm building');
  });

  it('duo：男角色用 2boys，未知性别按 2girls', () => {
    expect(enforceComposition('school uniform, dorm building', 'duo', 'male')).toBe(
      '2boys, school uniform, dorm building',
    );
    expect(enforceComposition('school uniform, dorm building', 'duo', 'unknown')).toBe(
      '2girls, school uniform, dorm building',
    );
  });

  it('multi：删掉 solo 和双人标签，换成多人标记', () => {
    const out = enforceComposition(
      '1girl, solo, 2girls, long blue hair, flower shop, group, masterpiece',
      'multi',
      'female',
    );
    expect(out.startsWith('multiple girls')).toBe(true);
    expect(out).not.toContain('solo');
    expect(out).not.toContain('1girl');
    expect(out).not.toContain('2girls');
    expect(out).not.toContain('group');
    expect(out).toContain('long blue hair');
    expect(out).toContain('flower shop');
  });

  it('multi：男角色用 multiple boys，未知性别用 group', () => {
    expect(enforceComposition('school uniform, dorm building', 'multi', 'male')).toBe(
      'multiple boys, school uniform, dorm building',
    );
    expect(enforceComposition('school uniform, dorm building', 'multi', 'unknown')).toBe(
      'group, school uniform, dorm building',
    );
  });
});

describe('inferPeopleFromRequest', () => {
  it('默认单人', () => {
    expect(inferPeopleFromRequest('在宿舍楼下拍一张')).toBe('solo');
    expect(inferPeopleFromRequest('花店门口的照片')).toBe('solo');
  });

  it('提到用户在画面里就是双人', () => {
    expect(inferPeopleFromRequest('咱俩合张影')).toBe('duo');
    expect(inferPeopleFromRequest('和我一起在宿舍楼下自拍')).toBe('duo');
    expect(inferPeopleFromRequest('咱俩的合照')).toBe('duo');
  });

  it('提到一群人就是多人', () => {
    expect(inferPeopleFromRequest('我们仨在花店门口合影')).toBe('multi');
    expect(inferPeopleFromRequest('我们几个在宿舍楼下')).toBe('multi');
  });
});

describe('looksLikeImageRequest', () => {
  it('明确要图的说法都认', () => {
    expect(looksLikeImageRequest('发张图')).toBe(true);
    expect(looksLikeImageRequest('发个照片')).toBe(true);
    expect(looksLikeImageRequest('看看你')).toBe(true);
    expect(looksLikeImageRequest('咱俩合张影')).toBe(true);
    expect(looksLikeImageRequest('拍一张')).toBe(true);
    expect(looksLikeImageRequest('发个自拍')).toBe(true);
    expect(looksLikeImageRequest('你在哪发张照片')).toBe(true);
    expect(looksLikeImageRequest('给我发张图看看')).toBe(true);
    expect(looksLikeImageRequest('在宿舍楼下拍一张')).toBe(true);
    expect(looksLikeImageRequest('在花店门口发张照片')).toBe(true);
  });

  it('普通聊天不算要图', () => {
    expect(looksLikeImageRequest('今天好累')).toBe(false);
    expect(looksLikeImageRequest('你在哪个宿舍楼？')).toBe(false);
    expect(looksLikeImageRequest('哈哈')).toBe(false);
    expect(looksLikeImageRequest('报到总算弄完了')).toBe(false);
    expect(looksLikeImageRequest('')).toBe(false);
    expect(looksLikeImageRequest(' ')).toBe(false);
  });

  it('只是提到“图”字不算要图', () => {
    expect(looksLikeImageRequest('这张图真好看')).toBe(false);
    expect(looksLikeImageRequest('花店门口的照片')).toBe(false);
    expect(looksLikeImageRequest('我把图发你微信了')).toBe(false);
  });
});

describe('buildImagePromptMessages', () => {
  it('带着角色的介绍和性格，让模型提炼外貌特征', () => {
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('和闺蜜小雨一起开花店');
    expect(userText).toContain('蓝发蓝眼');
    expect(userText).toContain('温柔细心');
    expect(userText).toContain('外貌特征');
    expect(userText).toContain('头发');
    expect(userText).toContain('眼睛');
    expect(userText).toContain('穿着');
  });

  it('带着联系人自己的人设，让模型按这个人的样子画', () => {
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('活泼开朗，短发，爱笑');
    expect(userText).toContain('人设');
  });

  it('带着用户想画的内容', () => {
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('小雨在花店门口招手');
  });

  it('要求只输出提示词本身，不要解释、不要 JSON', () => {
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    const systemText = messages.find((m) => m.role === 'system')?.content ?? '';
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(systemText).toContain('只返回提示词本身');
    expect(systemText).toContain('不要用 JSON');
    expect(userText).toContain('只输出这条提示词本身');
    expect(userText).toContain('一条详细的英文生图提示词');
  });

  it('阿杰：带着名字和与主角的关系', () => {
    const messages = buildImagePromptMessages(fakeCard(), ajieContact, '阿杰在花店门口招手', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('阿杰');
    expect(userText).toContain('哥哥');
    expect(userText).toContain('阿杰在花店门口招手');
  });

  it('带着最近的聊天记录，让模型按对话里的场景画图', () => {
    const history = [
      {
        role: 'assistant' as const,
        content: '九月的阳光从法桐树冠的缝隙间漏下来，在柏油路面上铺展出一片碎金般的光斑。',
      },
      { role: 'user' as const, content: '今天天气真好，你在哪呢？'},
      {
        role: 'assistant' as const,
        content: '我在老街这边买凉皮呢，就在那家法桐树底下等位置。',
      },
      { role: 'user' as const, content: '在哪呢？你给我发张图片，我去找你'},
    ];
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '在老街法桐树下买凉皮', history);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    // 场景从聊天记录里来：地点、动作、光线都在提示词的消息里。
    expect(userText).toContain('老街');
    expect(userText).toContain('法桐树');
    expect(userText).toContain('凉皮');
    expect(userText).toContain('阳光');
    expect(userText).toContain('最近的微信聊天记录');
    // 要的是有场景的图，不是白底人像。
    expect(userText).toContain('现在的场景');
    expect(userText).toContain('不是白底人像');
    expect(userText).toContain('场景从聊天记录里来');
  });

  it('没有聊天记录时也能用：只有外貌和想画的内容，不带对话段', () => {
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('蓝发蓝眼');
    expect(userText).toContain('小雨在花店门口招手');
    // 没有对话段：既没有对话段的标题，也没有“用户：/角色名：”这种对话行
    // （要求里那句“先读最近的微信聊天记录”是写提示词的指令，不算对话段）。
    expect(userText).not.toContain('最近的微信聊天记录（按时间顺序');
    expect(userText).not.toContain('用户：');
  });

  it('不给人数默认 solo：只有角色一个人，不画其他人', () => {
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('人数：solo');
    expect(userText).toContain('只有这个角色一个人');
    expect(userText).toContain('不要画用户');
  });

  it('duo：写清楚是角色和用户两个人，用户长相不要凭空编；其他联系人不在画面里不列', () => {
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '咱俩在宿舍楼下合影', [], {
      people: 'duo',
      others: [ajieContact],
    });
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('人数：duo');
    expect(userText).toContain('这个角色和用户两个人');
    expect(userText).toContain('不要凭空编一个精致长相');
    expect(userText).toContain('和角色在一起的那个人');
    expect(userText).not.toContain('图里可能出现的其他人');
  });

  it('multi：写清楚是三人以上，列出其他人，只画聊天记录里提到的', () => {
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '我们几个在花店门口合影', [], {
      people: 'multi',
      others: [ajieContact],
    });
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('人数：multi');
    expect(userText).toContain('三人以上');
    expect(userText).toContain('阿杰（哥哥）');
    expect(userText).toContain('不要编场景里没有的人');
  });

  it('solo 时不列其他人', () => {
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '小雨在花店门口招手', [], {
      people: 'solo',
      others: [ajieContact],
    });
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).not.toContain('图里可能出现的其他人');
  });
});

describe('buildImageTagContext', () => {
  it('上下文里有场景、外貌、人数和用户想画的内容，是给转写用的自然语言描述', () => {
    const history = [
      { role: 'assistant' as const, content: '我在老街这边买凉皮呢，就在那家法桐树底下等位置。'},
      { role: 'user' as const, content: '在哪呢？你给我发张图片，我去找你'},
    ];
    const context = buildImageTagContext(fakeCard(), xiaoyuContact, '在老街法桐树下买凉皮', history);
    // 场景从聊天记录里来。
    expect(context).toContain('老街');
    expect(context).toContain('法桐树');
    expect(context).toContain('凉皮');
    // 角色外貌从卡里来。
    expect(context).toContain('蓝发蓝眼');
    expect(context).toContain('碎花围裙');
    // 人数默认 solo。
    expect(context).toContain('人数：solo');
    // 用户想画的内容。
    expect(context).toContain('在老街法桐树下买凉皮');
  });

  it('上下文里有联系人自己的人设（profile），转写按这个人的样子写', () => {
    const context = buildImageTagContext(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    expect(context).toContain('人设');
    expect(context).toContain('活泼开朗，短发，爱笑');
  });

  it('不同联系人的人设各归各的：小雨的上下文里没有阿杰的人设', () => {
    const xiaoyu = buildImageTagContext(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    const ajie = buildImageTagContext(fakeCard(), ajieContact, '阿杰在花店门口招手', []);
    expect(xiaoyu).toContain('活泼开朗，短发，爱笑');
    expect(xiaoyu).not.toContain('沉稳可靠');
    expect(ajie).toContain('沉稳可靠，高个子');
    expect(ajie).not.toContain('活泼开朗');
  });

  it('不带“写一条生图提示词”的开头和“要求”那段指令——它就是正文，不是给模型写提示词的指令', () => {
    const context = buildImageTagContext(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    expect(context).not.toContain('请为下面这个角色写一条生图提示词');
    expect(context).not.toContain('要求：先读最近的微信聊天记录');
    expect(context).not.toContain('只输出这条提示词本身');
  });

  it('和 buildImagePromptMessages 共用同一份上下文：去掉开头和要求，剩下的就是它', () => {
    const history = [
      { role: 'assistant' as const, content: '我在老街这边买凉皮呢'},
      { role: 'user' as const, content: '发张图片我看看'},
    ];
    const context = buildImageTagContext(fakeCard(), xiaoyuContact, '在老街法桐树下买凉皮', history);
    const messages = buildImagePromptMessages(fakeCard(), xiaoyuContact, '在老街法桐树下买凉皮', history);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain(context);
  });

  it('duo/multi 时人数和写法跟 buildImagePromptMessages 一致', () => {
    const duo = buildImageTagContext(fakeCard(), xiaoyuContact, '咱俩在宿舍楼下合影', [], {
      people: 'duo',
      others: [ajieContact],
    });
    expect(duo).toContain('人数：duo');
    expect(duo).toContain('这个角色和用户两个人');
    expect(duo).toContain('不要凭空编一个精致长相');
    expect(duo).not.toContain('图里可能出现的其他人');

    const multi = buildImageTagContext(fakeCard(), xiaoyuContact, '我们几个在花店门口合影', [], {
      people: 'multi',
      others: [ajieContact],
    });
    expect(multi).toContain('人数：multi');
    expect(multi).toContain('阿杰（哥哥）');
    expect(multi).toContain('不要编场景里没有的人');
  });

  it('没有聊天记录时也能用：只有外貌、人数和想画的内容', () => {
    const context = buildImageTagContext(fakeCard(), xiaoyuContact, '小雨在花店门口招手', []);
    expect(context).toContain('蓝发蓝眼');
    expect(context).toContain('小雨在花店门口招手');
    expect(context).not.toContain('最近的微信聊天记录（按时间顺序');
  });
});
