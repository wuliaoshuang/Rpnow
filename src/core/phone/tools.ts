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
import type { StickerEmotion } from './types.js';

/** 模型可调的工具名。 */
export type PhoneToolName = 'send_image' | 'send_sticker';

/** 发图和发表情包两个工具的定义（标准 JSON Schema，供 LLMRequest.tools 用）。 */
export const PHONE_TOOLS: LLMToolDef[] = [
  {
    name: 'send_image',
    description:
      '给用户发一张图片。当用户让你发图、发照片、看看你，或者你提到自己拍了照片、想分享一张图的时候调用它；调用后图片会作为消息发给用户，你不需要在文字里再描述图片内容。',
    parameters: {
      type: 'object',
      properties: {
        description: {
          type: 'string',
          description: '这张图的内容，一句话，比如“在树荫下排队的照片”“我的自拍”。',
        },
      },
      required: ['description'],
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

/** 解析 send_image 的 arguments，取到图的描述；取不到返回 null。 */
export function parseSendImageArgs(args: string): string | null {
  const parsed = parseToolArguments<{ description?: unknown }>(args);
  const description = typeof parsed?.description === 'string' ? parsed.description.trim() : '';
  return description || null;
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
