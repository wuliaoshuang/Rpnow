/**
 * 小手机回复与生图提示词的单元测试：只测纯函数（提示词拼装），
 * 不测真的调模型——模型调用在 Playwright 里用假接口验。
 */
import { describe, expect, it } from 'vitest';
import type { RPCard } from '@/core/types/card.js';
import type { PhoneContact } from './types.js';
import { buildImagePromptMessages, buildReplySystemPrompt } from './reply.js';

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
});
