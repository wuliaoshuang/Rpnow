/**
 * 小手机的回复与生图提示词 — 纯函数，好测。
 *
 * 小手机是一套独立系统：微信里的聊天和主线角色扮演是两回事。
 * 回复只认角色本身是谁（名字、性格、介绍）和微信自己的聊天记录，
 * 不跟主线剧情走——场景、开场白、主线消息一律不进提示词。
 */
import type { RPCard } from '@/core/types/card.js';
import type { LLMMessage } from '@/core/llm/types.js';
import type { PhoneContact } from './types.js';

/**
 * 独立系统的声明：微信聊天不是主线剧情的延续。
 * 回复提示词和生图提示词都用同一句话定调，免得模型把主线剧情接进来。
 */
const INDEPENDENCE =
  '这是一次独立的微信聊天，和主线角色扮演聊天没有关系，不是主线聊天的延续。' +
  '不要继续主线剧情，不要提及主线里正在发生的剧情、场景、事件或对话内容；' +
  '就当作平时在微信上和对方闲聊。';

/** 先想一想再回：想清楚自己是谁、和对方的关系、之前聊了什么。 */
const THINK_FIRST =
  '先想一想：你是谁，你的性格怎么样，你和对方是什么关系，这次微信聊天之前聊了什么；想清楚了再回复。';

/** 不 OOC：全程在角色里，不提 AI，不写 RP 式动作描写。 */
const NO_OOC =
  '全程保持角色身份，绝不跳出角色（不要 OOC），绝不提自己是 AI、模型或程序；' +
  '不用 *动作描写*，不要写长段角色扮演。';

/** 微信口吻：短句，1–3 句。 */
const SHORT_STYLE = '像在微信上发消息：1–3 句短句，口语化、亲切。';

/**
 * 工具：发图和发表情包——Agent 不是光会打字。
 *
 * 像真人一样自然地用：用户让你发图、发照片、看看你，或者你自己提到
 * 拍了照片、想分享一张图的时候，就调用发图工具发一张真的图，不要只在
 * 文字里说“我拍了照片”却不发图；想表达情绪的时候就发表情包，不要光
 * 靠文字。文字和工具可以一起用：先回一句文字，再发图或表情包。
 * 调用不了工具时，改在文字里写标记（`[发图：…]` / `[表情：…]`），
 * 我会帮你发出去，标记不会显示给用户看。
 */
const TOOLS =
  '你有两个工具可以用：发图（send_image）和发表情包（send_sticker）。' +
  '像真人一样自然地用它们：用户让你发图、发照片、看看你，或者你自己提到拍了照片、想分享一张图的时候，就调用发图工具发一张真的图，不要只在文字里说“我拍了照片”却不发图；' +
  '想表达情绪的时候就发表情包，不要光靠文字。文字和工具可以一起用：先回一句文字，再发图或表情包。' +
  '如果你调用不了工具，就在文字里用标记写出来：[发图：这张图的内容]、[表情：开心/难过/害羞/惊讶/亲昵/生气]，我会帮你发出去，标记不会显示给用户看。';

/**
 * 回复用的 system prompt。
 *
 * 只留角色本身的身份（名字、性格、介绍）和联系人的关系；
 * 场景、开场白一律不进——那是主线剧情的东西，微信里不认。
 * 联系人的第一条消息也不写进这里：它本来就在微信聊天记录里。
 */
export function buildReplySystemPrompt(card: RPCard, contact: PhoneContact): string {
  const d = card.data;
  const identity = contact.isMain
    ? [
        `你是「${d.name}」，正在微信上和用户聊天。`,
        d.description ? `角色介绍：${d.description}` : '',
        d.personality ? `性格：${d.personality}` : '',
      ]
    : [
        `你是「${contact.name}」，是「${d.name}」的${contact.relation}，正在微信上和用户聊天。`,
        d.description ? `角色卡介绍：${d.description}` : '',
      ];
  return [...identity, INDEPENDENCE, THINK_FIRST, NO_OOC, SHORT_STYLE, TOOLS]
    .filter(Boolean)
    .join('\n');
}

/**
 * 生图提示词用的消息：让模型先从卡里提炼角色的外貌特征，
 * 再结合用户想画的内容，写一条详细的生图提示词。
 *
 * 只输出提示词本身（不要 JSON、不要解释），调用方直接拿去调生图工具。
 */
export function buildImagePromptMessages(
  card: RPCard,
  contact: PhoneContact,
  userRequest: string,
): LLMMessage[] {
  const d = card.data;
  const appearance = [
    `角色名：${contact.name}`,
    contact.isMain ? '' : `和主角「${d.name}」的关系：${contact.relation}`,
    d.description ? `角色介绍：${d.description}` : '',
    d.personality ? `性格：${d.personality}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [
    {
      role: 'system',
      content:
        '你是一个生图提示词助手。只返回提示词本身，不要解释、不要加多余文字、不要用 JSON、不要加代码块。',
    },
    {
      role: 'user',
      content: [
        '请为下面这个角色写一条生图提示词：',
        appearance,
        '',
        `用户想画的内容：${userRequest}`,
        '',
        '要求：先从角色介绍和性格里提炼出这个角色的外貌特征（头发、眼睛、穿着、标志性特点），让画出来的人一眼就能认出是这个角色；再结合用户想画的内容，写成一条详细的英文生图提示词（Danbooru 风格标签，逗号分隔，写在一行里）；只输出这条提示词本身，不要解释。',
      ].join('\n'),
    },
  ];
}
