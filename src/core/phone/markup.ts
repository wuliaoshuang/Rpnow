/**
 * 小手机回复里的 `{...}` 标记 — 插件（小手机 V1.8.7）那套做法的 Rpnow 版。
 *
 * 回复模型不再是 Agent、不调工具：一次普通模型调用，模型直接在回复
 * 文字里写标记，调用方用正则抠出来执行，再从显示的文字里去掉——
 * 用户看不到标记。
 *
 * 三种标记：
 *   - `{chat:…}`：一句要发出去的聊天文字（一个标记就是一个气泡）；
 *   - `{image:中文描述 ||| 英文tags}`：发一张图，描述是这张图的内容，
 *     `|||` 后面的英文 Danbooru 标签是可选的生图提示词提示；
 *   - `{sticker:情绪}`：发表情包，情绪用英文名（happy/sad/shy/
 *     surprised/affectionate/angry），也认中文词（开心/难过/害羞/
 *     惊讶/亲昵/生气）。
 *
 * 标记以外的文字照样是聊天文字；什么标记都没有时，整段回复就是
 * 一句聊天。认不出的标记（比如 `{voice:…}`）直接丢掉，不显示、
 * 不报错；括号没闭合时，剩下的当普通文字处理。解析永远不抛错，
 * 永远不把原始标记显示给用户看。
 */
import type { StickerEmotion } from './types.js';

/** 回复标记解析出来的一段：按顺序发出去。 */
export type ReplyMarkupSegment =
  | { type: 'chat'; text: string }
  | { type: 'image'; description: string; tags?: string }
  | { type: 'sticker'; emotion: StickerEmotion };

/** 标记里的中文情绪词 → 贴纸情绪。 */
const MARKUP_EMOTIONS: Record<string, StickerEmotion> = {
  开心: 'happy',
  难过: 'sad',
  害羞: 'shy',
  惊讶: 'surprised',
  亲昵: 'affectionate',
  生气: 'angry',
};

const MARKUP_EMOTION_NAMES: StickerEmotion[] = [
  'happy',
  'sad',
  'shy',
  'surprised',
  'affectionate',
  'angry',
];

/** `{chat:…}` / `{image:…}` / `{sticker:…}` / 其他 `{…}`：只认闭合的。 */
const MARKUP_PATTERN = /\{([^{}]*)\}/g;

/** 解析一个标记里的情绪词：英文名和中文词都认，认不出返回 null。 */
function parseMarkupEmotion(word: string): StickerEmotion | null {
  const w = word.trim();
  if ((MARKUP_EMOTION_NAMES as string[]).includes(w)) return w as StickerEmotion;
  return MARKUP_EMOTIONS[w] ?? null;
}

/**
 * 从回复文字里抠出 `{...}` 标记，按出现顺序返回一段一段的回复。
 *
 *   - `{chat:…}` → 一段聊天文字；
 *   - `{image:中文描述 ||| 英文tags}` → 一段发图，`|||` 只按第一个
 *     切：前面是描述，后面是可选的英文标签；没有 `|||` 时整段都是描述；
 *   - `{sticker:情绪}` → 一段表情包，情绪认不出就丢掉这段；
 *   - 其他 `{…}`（比如 `{voice:…}`）→ 丢掉，不显示；
 *   - 标记以外的文字 → 聊天段（相邻的拼成一段，空白的不要）；
 *   - 括号没闭合（比如末尾一个 `{chat:没说完`）→ 剩下的当普通文字。
 */
export function parseReplyMarkup(text: string): ReplyMarkupSegment[] {
  const segments: ReplyMarkupSegment[] = [];
  /**
   * 加一段聊天文字：标记外的普通文字只和上一段普通文字拼成一段
   * （比如被丢掉的 `{voice:…}` 隔开的两截普通文字）；`{chat:…}`
   * 标记里的文字每次都单独成段——模型特意拆成几条消息，就按几条发，
   * 后面的普通文字也不并进它那一段。
   */
  let lastWasPlain = false;
  const pushChat = (raw: string, fromMarker = false) => {
    let trimmed = raw.trim();
    if (!fromMarker) {
      // 末尾没闭合的标记开头（比如 `你好{image:一半`）：把 `{image:`
      // 去掉，剩下的当普通文字——标记本身永远不显示给用户看。
      trimmed = trimmed.replace(/\{[A-Za-z]+:([^}]*)$/, '$1').trim();
    }
    if (!trimmed) return;
    const last = segments[segments.length - 1];
    if (!fromMarker && lastWasPlain && last?.type === 'chat') {
      last.text = `${last.text}\n${trimmed}`;
    } else {
      segments.push({ type: 'chat', text: trimmed });
    }
    lastWasPlain = !fromMarker;
  };
  let cursor = 0;
  MARKUP_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKUP_PATTERN.exec(text)) !== null) {
    pushChat(text.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const inner = match[1];
    const colon = inner.indexOf(':');
    if (colon < 0) continue;
    const kind = inner.slice(0, colon).trim().toLowerCase();
    const body = inner.slice(colon + 1).trim();
    if (kind === 'chat') {
      pushChat(body, true);
    } else if (kind === 'image') {
      if (!body) continue;
      const sep = body.indexOf('|||');
      if (sep < 0) {
        segments.push({ type: 'image', description: body });
      } else {
        const description = body.slice(0, sep).trim();
        const tags = body.slice(sep + 3).trim();
        if (!description) continue;
        segments.push(
          tags ? { type: 'image', description, tags } : { type: 'image', description },
        );
      }
      lastWasPlain = false;
    } else if (kind === 'sticker') {
      const emotion = parseMarkupEmotion(body);
      if (emotion) {
        segments.push({ type: 'sticker', emotion });
        lastWasPlain = false;
      }
    } else {
      // 其他标记（voice、money……）直接丢掉：它两边的普通文字还是
      // 相邻的普通文字，下一段普通文字拼进来时照样拼成一段。
    }
  }
  // 尾巴：最后一个标记之后、或者没闭合的括号剩下的文字。
  pushChat(text.slice(cursor));
  return segments;
}
