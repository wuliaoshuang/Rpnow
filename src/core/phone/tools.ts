/**
 * 小手机的 Agent 工具 — 微信里的角色是一个 Agent，能主动调工具。
 *
 * 两个工具：
 *   - `send_image`：给用户发一张图片（调生图工具真的生成一张图发出去）。
 *   - `send_sticker`：给用户发表情包（挑一张现成的贴纸发出去）。
 *
 * 模型优先走原生工具调用（`LLMRequest.tools`）。有的提供商/模型不支持
 * 工具调用时，提示词会教模型改用文字里的标记（`[发图：…]` /
 * `[表情：…]`），调用方用 `parseReplyMarkers` 把标记抠出来执行，
 * 再从显示的文字里去掉——用户看不到标记。
 */
import type { LLMToolDef } from '@/core/llm/types.js';
import type { ImagePeople, StickerEmotion } from './types.js';

/** 模型可调的工具名。 */
export type PhoneToolName = 'send_image' | 'send_sticker';

/** 生图的人数取值：solo 角色一个人 / duo 角色和用户两个人 / multi 三人以上。 */
export const IMAGE_PEOPLE_VALUES: ImagePeople[] = ['solo', 'duo', 'multi'];

/** 发图和发表情包两个工具的定义（标准 JSON Schema，供 LLMRequest.tools 用）。 */
export const PHONE_TOOLS: LLMToolDef[] = [
  {
    name: 'send_image',
    description:
      '给用户发一张图片。只有当用户明确让你发图的时候才调用它（比如用户说“发张图”“发个图”“发照片”“发张照片”“看看你”“发个图给我看看”“拍一张”“自拍”“合影”）；用户没让你发图，就不要调用它，不要自己主动发图。调用后图片会作为消息发给用户，你不需要在文字里再描述图片内容。description 里要写清楚现在的场景：角色现在在哪里、在做什么、周围有什么（比如“在老街法桐树下买凉皮，九月的阳光从树叶缝隙漏下来”），不要只写“我的照片”“自拍”这种没场景的话——这张图的画面就按 description 来画。另外要判断这张图里有几个人（people）：角色一个人就是 solo；角色和用户两个人一起就是 duo；三人以上（角色、用户和其他人）就是 multi——按现在的场景和对话来定，不要默认只画一个人。',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: '这张图的内容：写清楚角色现在在哪里、在做什么、周围的环境，比如“在老街法桐树下买凉皮”。不要只写“我的照片”“自拍”。',
        },
        people: {
          type: 'string',
          description:
            '这张图里有几个人：solo 是角色一个人；duo 是角色和用户两个人；multi 是三人以上（角色、用户和其他人）。根据现在的场景和对话判断——角色一个人在宿舍就是 solo，和用户一起自拍就是 duo，一群人在一起就是 multi。',
          enum: IMAGE_PEOPLE_VALUES,
        },
      },
      required: ['description', 'people'],
    },
  },
  {
    name: 'send_sticker',
    description:
      '给用户发表情包。当你想用表情包表达情绪的时候调用它；挑一张对应情绪的表情包发出去。',
    parameters: {
      type: 'object',
      properties: {
        emotion: {
          type: 'string',
          description: '要表达的情绪，只能是 happy、sad、shy、surprised、affectionate、angry 其中之一。',
          enum: ['happy', 'sad', 'shy', 'surprised', 'affectionate', 'angry'],
        },
      },
      required: ['emotion'],
    },
  },
];

/** 安全解析一条工具调用的 arguments（JSON 字符串）：解析失败返回 null。 */
export function parseToolArguments<T>(args: string): T | null {
  try {
    return JSON.parse(args) as T;
  } catch {
    return null;
  }
}

/** send_image 的 arguments：图的描述 + 图里有几个人。 */
export interface SendImageArgs {
  description: string;
  people: ImagePeople;
}

/**
 * 解析 send_image 的 arguments，取到图的描述和人数；描述取不到返回 null。
 * 人数不在 solo / duo / multi 里、或者模型没给时按 solo 算（老行为安全）。
 */
export function parseSendImageArgs(args: string): SendImageArgs | null {
  const parsed = parseToolArguments<{ description?: unknown; people?: unknown }>(args);
  const description = typeof parsed?.description === 'string' ? parsed.description.trim() : '';
  if (!description) return null;
  const people =
    typeof parsed?.people === 'string' && (IMAGE_PEOPLE_VALUES as string[]).includes(parsed.people)
      ? (parsed.people as ImagePeople)
      : 'solo';
  return { description, people };
}

const TOOL_EMOTIONS: StickerEmotion[] = [
  'happy',
  'sad',
  'shy',
  'surprised',
  'affectionate',
  'angry',
];

/** 解析 send_sticker 的 arguments，取到情绪；情绪不在六种里返回 null。 */
export function parseSendStickerArgs(args: string): StickerEmotion | null {
  const parsed = parseToolArguments<{ emotion?: unknown }>(args);
  const emotion = typeof parsed?.emotion === 'string' ? parsed.emotion.trim() : '';
  return (TOOL_EMOTIONS as string[]).includes(emotion) ? (emotion as StickerEmotion) : null;
}

/** 标记里的中文情绪词 → 贴纸情绪。 */
const MARKER_EMOTIONS: Record<string, StickerEmotion> = {
  开心: 'happy',
  难过: 'sad',
  害羞: 'shy',
  惊讶: 'surprised',
  亲昵: 'affectionate',
  生气: 'angry',
};

const IMAGE_MARKER = /\[发图[：:]([^\]]+)\]/g;
const STICKER_MARKER = /\[表情[：:]([^\]]+)\]/g;

export interface ReplyMarkers {
  /** 去掉所有标记后的文字（显示给用户看）。 */
  cleanText: string;
  /** 标记里要发的图（按出现顺序）。 */
  imageDescriptions: string[];
  /** 标记里要发的表情包情绪（按出现顺序）。 */
  stickerEmotions: StickerEmotion[];
}

/**
 * 从回复文字里抠出 `[发图：…]` / `[表情：…]` 标记。
 *
 * 情绪词用中文（开心/难过/害羞/惊讶/亲昵/生气），也认英文情绪名。
 * 认不出的情绪词当作没有这条标记——标记照样从文字里去掉，不显示出来。
 * 没有标记时，原样返回。
 */
export function parseReplyMarkers(text: string): ReplyMarkers {
  const imageDescriptions: string[] = [];
  const stickerEmotions: StickerEmotion[] = [];
  let cleanText = text.replace(IMAGE_MARKER, (_, desc: string) => {
    const description = desc.trim();
    if (description) imageDescriptions.push(description);
    return '';
  });
  cleanText = cleanText.replace(STICKER_MARKER, (_, word: string) => {
    const emotion =
      MARKER_EMOTIONS[word.trim()] ??
      ((TOOL_EMOTIONS as string[]).includes(word.trim())
        ? (word.trim() as StickerEmotion)
        : undefined);
    if (emotion) stickerEmotions.push(emotion);
    return '';
  });
  return { cleanText: cleanText.trim(), imageDescriptions, stickerEmotions };
}
