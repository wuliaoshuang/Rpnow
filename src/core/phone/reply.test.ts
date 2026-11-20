/**
 * 小手机回复与生图提示词的单元测试：只测纯函数（提示词拼装），
 * 不测真的调模型——模型调用在 Playwright 里用假接口验。
 */
import { describe, expect, it } from 'vitest';
import type { RPCard } from '@/core/types/card.js';
import type { PhoneContact } from './types.js';
import {
  buildImagePromptMessages,
  buildImageTagContext,
  buildReplySystemPrompt,
  enforceComposition,
  enforceSoloPrompt,
  inferPeopleFromRequest,
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

const mainContact: PhoneContact = {
  id: 'card-1',
  name: '李淑纯',
  relation: '本人',
  openingMessage: '嗨，我是淑纯',
  isMain: true,
};

const otherContact: PhoneContact = {
  id: 'c_xiaoyu',
  name: '小雨',
  relation: '闺蜜',
  openingMessage: '在吗在吗，出来玩呀',
  isMain: false,
};

describe('buildReplySystemPrompt', () => {
  it('主角：不含场景和开场白原文', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), mainContact);
    expect(prompt).not.toContain(SCENARIO_MARKER);
    expect(prompt).not.toContain(FIRST_MES_MARKER);
    expect(prompt).not.toContain('场景：');
    expect(prompt).not.toContain('开场白：');
  });

  it('非主角：同样不含场景和开场白原文', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), otherContact);
    expect(prompt).not.toContain(SCENARIO_MARKER);
    expect(prompt).not.toContain(FIRST_MES_MARKER);
    expect(prompt).not.toContain('场景：');
    expect(prompt).not.toContain('开场白：');
  });

  it('主角：留着名字、介绍和性格', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), mainContact);
    expect(prompt).toContain('李淑纯');
    expect(prompt).toContain('和闺蜜小雨一起开花店');
    expect(prompt).toContain('温柔细心');
  });

  it('非主角：留着名字、和主角的关系、卡的介绍', () => {
    const prompt = buildReplySystemPrompt(fakeCard(), otherContact);
    expect(prompt).toContain('小雨');
    expect(prompt).toContain('闺蜜');
    expect(prompt).toContain('和闺蜜小雨一起开花店');
  });

  it('第一句就写明这是 role play：扮演角色，在叫微信的地方和用户聊天', () => {
    for (const contact of [mainContact, otherContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('role play');
      expect(prompt).toContain('角色扮演');
      expect(prompt).toContain('你要扮演');
      expect(prompt).toContain('一个叫微信的地方');
      expect(prompt).toContain('和用户聊天');
    }
    expect(buildReplySystemPrompt(fakeCard(), mainContact)).toContain('你要扮演「李淑纯」');
    expect(buildReplySystemPrompt(fakeCard(), otherContact)).toContain('你要扮演「小雨」');
    expect(buildReplySystemPrompt(fakeCard(), otherContact)).toContain('「李淑纯」的闺蜜');
  });

  it('发图时要按场景判断图里有几个人，填 people 参数', () => {
    for (const contact of [mainContact, otherContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('people');
      expect(prompt).toContain('solo / duo / multi');
      expect(prompt).toContain('你一个人');
      expect(prompt).toContain('你和用户两个人');
    }
  });

  it('写明这是独立的微信聊天，不是主线剧情的延续', () => {
    for (const contact of [mainContact, otherContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('独立的微信聊天');
      expect(prompt).toContain('不是主线聊天的延续');
      expect(prompt).toContain('不要继续主线剧情');
      expect(prompt).toContain('不要提及主线里正在发生的剧情');
    }
  });

  it('要求先想一想再回，全程不 OOC、不提 AI、不用动作描写', () => {
    for (const contact of [mainContact, otherContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('先想一想');
      expect(prompt).toContain('不要 OOC');
      expect(prompt).toContain('绝不提自己是 AI');
      expect(prompt).toContain('*动作描写*');
      expect(prompt).toContain('1–3 句');
    }
  });

  it('讲清楚发图和发表情包两个工具怎么用', () => {
    for (const contact of [mainContact, otherContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('send_image');
      expect(prompt).toContain('send_sticker');
      expect(prompt).toContain('调用发图工具发一张真的图');
      expect(prompt).toContain('不要只在文字里说“我拍了照片”却不发图');
      expect(prompt).toContain('发表情包');
      expect(prompt).toContain('先回一句文字，再发图或表情包');
    }
  });

  it('调用不了工具时，教模型用 [发图：…] / [表情：…] 标记', () => {
    for (const contact of [mainContact, otherContact]) {
      const prompt = buildReplySystemPrompt(fakeCard(), contact);
      expect(prompt).toContain('[发图：这张图的内容]');
      expect(prompt).toContain('[表情：开心/难过/害羞/惊讶/亲昵/生气]');
    }
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

describe('buildImagePromptMessages', () => {
  it('带着角色的介绍和性格，让模型提炼外貌特征', () => {
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '李淑纯在花店里包花', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('和闺蜜小雨一起开花店');
    expect(userText).toContain('蓝发蓝眼');
    expect(userText).toContain('温柔细心');
    expect(userText).toContain('外貌特征');
    expect(userText).toContain('头发');
    expect(userText).toContain('眼睛');
    expect(userText).toContain('穿着');
  });

  it('带着用户想画的内容', () => {
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '李淑纯在花店里包花', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('李淑纯在花店里包花');
  });

  it('要求只输出提示词本身，不要解释、不要 JSON', () => {
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '李淑纯在花店里包花', []);
    const systemText = messages.find((m) => m.role === 'system')?.content ?? '';
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(systemText).toContain('只返回提示词本身');
    expect(systemText).toContain('不要用 JSON');
    expect(userText).toContain('只输出这条提示词本身');
    expect(userText).toContain('一条详细的英文生图提示词');
  });

  it('非主角：带着名字和与主角的关系', () => {
    const messages = buildImagePromptMessages(fakeCard(), otherContact, '小雨在花店门口招手', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('小雨');
    expect(userText).toContain('闺蜜');
    expect(userText).toContain('小雨在花店门口招手');
  });

  it('带着最近的聊天记录，让模型按对话里的场景画图', () => {
    const history = [
      {
        role: 'assistant' as const,
        content: '九月的阳光从法桐树冠的缝隙间漏下来，在柏油路面上铺展出一片碎金般的光斑。',
      },
      { role: 'user' as const, content: '今天天气真好，你在哪呢？' },
      {
        role: 'assistant' as const,
        content: '我在老街这边买凉皮呢，就在那家法桐树底下等位置。',
      },
      { role: 'user' as const, content: '在哪呢？你给我发张图片，我去找你' },
    ];
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '在老街法桐树下买凉皮', history);
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
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '李淑纯在花店里包花', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('蓝发蓝眼');
    expect(userText).toContain('李淑纯在花店里包花');
    // 没有对话段：既没有对话段的标题，也没有“用户：/角色名：”这种对话行
    // （要求里那句“先读最近的微信聊天记录”是写提示词的指令，不算对话段）。
    expect(userText).not.toContain('最近的微信聊天记录（按时间顺序');
    expect(userText).not.toContain('用户：');
  });

  it('不给人数默认 solo：只有角色一个人，不画其他人', () => {
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '李淑纯在花店里包花', []);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('人数：solo');
    expect(userText).toContain('只有这个角色一个人');
    expect(userText).toContain('不要画用户');
  });

  it('duo：写清楚是角色和用户两个人，用户长相不要凭空编；其他联系人不在画面里不列', () => {
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '咱俩在宿舍楼下合影', [], {
      people: 'duo',
      others: [otherContact],
    });
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('人数：duo');
    expect(userText).toContain('这个角色和用户两个人');
    expect(userText).toContain('不要凭空编一个精致长相');
    expect(userText).toContain('和角色在一起的那个人');
    expect(userText).not.toContain('图里可能出现的其他人');
  });

  it('multi：写清楚是三人以上，列出其他人，只画聊天记录里提到的', () => {
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '我们几个在花店门口合影', [], {
      people: 'multi',
      others: [otherContact],
    });
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain('人数：multi');
    expect(userText).toContain('三人以上');
    expect(userText).toContain('小雨（闺蜜）');
    expect(userText).toContain('不要编场景里没有的人');
  });

  it('solo 时不列其他人', () => {
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '李淑纯在花店里包花', [], {
      people: 'solo',
      others: [otherContact],
    });
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).not.toContain('图里可能出现的其他人');
  });
});

describe('buildImageTagContext', () => {
  it('上下文里有场景、外貌、人数和用户想画的内容，是给转写用的自然语言描述', () => {
    const history = [
      { role: 'assistant' as const, content: '我在老街这边买凉皮呢，就在那家法桐树底下等位置。' },
      { role: 'user' as const, content: '在哪呢？你给我发张图片，我去找你' },
    ];
    const context = buildImageTagContext(fakeCard(), mainContact, '在老街法桐树下买凉皮', history);
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

  it('不带“写一条生图提示词”的开头和“要求”那段指令——它就是正文，不是给模型写提示词的指令', () => {
    const context = buildImageTagContext(fakeCard(), mainContact, '李淑纯在花店里包花', []);
    expect(context).not.toContain('请为下面这个角色写一条生图提示词');
    expect(context).not.toContain('要求：先读最近的微信聊天记录');
    expect(context).not.toContain('只输出这条提示词本身');
  });

  it('和 buildImagePromptMessages 共用同一份上下文：去掉开头和要求，剩下的就是它', () => {
    const history = [
      { role: 'assistant' as const, content: '我在老街这边买凉皮呢' },
      { role: 'user' as const, content: '发张图片我看看' },
    ];
    const context = buildImageTagContext(fakeCard(), mainContact, '在老街法桐树下买凉皮', history);
    const messages = buildImagePromptMessages(fakeCard(), mainContact, '在老街法桐树下买凉皮', history);
    const userText = messages.find((m) => m.role === 'user')?.content ?? '';
    expect(userText).toContain(context);
  });

  it('duo/multi 时人数和写法跟 buildImagePromptMessages 一致', () => {
    const duo = buildImageTagContext(fakeCard(), mainContact, '咱俩在宿舍楼下合影', [], {
      people: 'duo',
      others: [otherContact],
    });
    expect(duo).toContain('人数：duo');
    expect(duo).toContain('这个角色和用户两个人');
    expect(duo).toContain('不要凭空编一个精致长相');
    expect(duo).not.toContain('图里可能出现的其他人');

    const multi = buildImageTagContext(fakeCard(), mainContact, '我们几个在花店门口合影', [], {
      people: 'multi',
      others: [otherContact],
    });
    expect(multi).toContain('人数：multi');
    expect(multi).toContain('小雨（闺蜜）');
    expect(multi).toContain('不要编场景里没有的人');
  });

  it('没有聊天记录时也能用：只有外貌、人数和想画的内容', () => {
    const context = buildImageTagContext(fakeCard(), mainContact, '李淑纯在花店里包花', []);
    expect(context).toContain('蓝发蓝眼');
    expect(context).toContain('李淑纯在花店里包花');
    expect(context).not.toContain('最近的微信聊天记录（按时间顺序');
  });
});
