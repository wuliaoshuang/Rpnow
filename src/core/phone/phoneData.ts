/**
 * 小手机隐藏数据 — 主聊天和手机之间传“人”的通道。
 *
 * 机制（PR #54，用户定的“内置一个优先级比较高的预设就行”）：
 *   1. 一本内置的、高优先级的预设（世界书 `phone-preset:<chatId>` 里的
 *      常驻条目，见 phonePresetStore.ts）被注入主聊天的提示词；
 *   2. 主聊天的模型每轮回复后，在正文末尾追加一个隐藏数据块，列出本轮
 *      回复里出现的人物（名字、人设、和 User 的关系）；
 *   3. 数据块是 HTML 注释 `<!-- [小手机数据] {...} -->`：主聊天的消息
 *      渲染走 core/render/renderer.ts（marked + DOMPurify，注释默认被
 *       stripped，渲染器自己也用 `<!--RPSTYLE:...-->` 当不可见载体），
 *      所以它不会显示在聊天消息里；小手机读到它就拿来建/更新联系人。
 *
 * 数据只有联系人/人物信息（名字、人设、关系），不经过这里传朋友圈、
 * 钱包、时间、运势。联系人的初始名单还是 PR #53 的初始化（打开手机
 * 时从最近 30 条主聊天消息里认人）——这里只补“之后”的更新：故事往前
 * 走、新人物在主聊天里露面，手机里就多一个联系人，不用等“重置”。
 *
 * 这个模块是纯函数，好测：解析（extract）、合并（merge）、预设文本
 * （buildPhonePresetText）都不碰 IndexedDB、不调模型。
 */
import { uid } from '@/lib/utils.js';
import { cleanOpeningMessage } from './contacts.js';
import type { PhoneContact, PhoneContactGender } from './types.js';

/** 隐藏数据块的标记：只有小手机认得这个格式。 */
export const PHONE_DATA_MARKER = '[小手机数据]';

/** 小手机预设世界书的 id 前缀（`phone-preset:<chatId>`）。 */
export const PHONE_PRESET_BOOK_ID_PREFIX = 'phone-preset:';

/** 人设最多留多少字——和 contacts.ts 里初始化的人设上限同一个数。 */
export const PHONE_DATA_PROFILE_MAX_CHARS = 200;

/** 联系人最多留几位——和 contacts.ts 里初始化的上限同一个数。 */
export const PHONE_DATA_MAX_CONTACTS = 8;

/** 隐藏数据块里一个人的信息（JSON 里 `characters` 数组的元素）。 */
export interface HiddenCharacter {
  name: string;
  /** 一两句人设：性格、长相、关键特点。 */
  profile?: string;
  /** 和 User 的关系，从 User 的角度写。 */
  relation?: string;
  /** 和主角的关系。 */
  relationToMain?: string;
  /** 这个人第一次在微信上发来的短消息，1–2 句。 */
  openingMessage?: string;
  gender?: PhoneContactGender;
}

/** 模型给的 gender 只认三个值，其他一律按 unknown 算（和 contacts.ts 同款）。 */
function parseGender(raw: unknown): PhoneContactGender {
  return raw === 'female' || raw === 'male' ? raw : 'unknown';
}

/** 人设的安全阀：本来就短的原样用；写长了才压短（和 contacts.ts 同款）。 */
function limitProfile(profile: string): string {
  const chars = [...profile];
  if (chars.length <= PHONE_DATA_PROFILE_MAX_CHARS) return profile;
  return `${chars.slice(0, PHONE_DATA_PROFILE_MAX_CHARS).join('')}…`;
}

/**
 * 从一段文本里抠出第一个完整的 JSON 对象（大括号配对，字符串里的括号不算）。
 * 模型多写了半句、或注释里还带了别的字时也能抠出来；抠不出来返回 null。
 */
function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * 判断一条隐藏数据是不是卡的主角本人：名字是卡名，或 relation 写“本人”。
 * 和 contacts.ts 的 isMainCharacter 同一条规则——模型列了主角，代码也拦得住。
 */
function isMainCharacter(
  character: { name: string; relation?: string },
  mainCharacterName: string,
): boolean {
  const cardName = mainCharacterName.trim();
  if (cardName && character.name.trim().toLowerCase() === cardName.toLowerCase()) return true;
  return (character.relation ?? '').trim() === '本人';
}

/**
 * 从一条主聊天消息的文本里抠出隐藏数据块，返回里面列的人物。
 *
 * 格式：`<!-- [小手机数据] {"characters":[{...}]} -->`。容错：
 *   - 一条消息里有多个块，全都解析、合起来返回；
 *   - 某个块的 JSON 坏了，只跳过那个块，其他块照常解析；
 *   - 注释没闭合（没有 `-->`），当作没有这个块；
 *   - 没有块、或 `characters` 是空数组，返回空数组；
 *   - 主角本人（名字是卡名、或 relation 是“本人”）直接排除；
 *   - 同名的人（忽略大小写和首尾空格）只留第一次出现的。
 * 永远不抛错、不返回原始标记——解析失败就是空列表。
 */
export function extractHiddenCharacters(
  text: string,
  mainCharacterName: string,
): HiddenCharacter[] {
  if (!text) return [];
  const found: HiddenCharacter[] = [];
  const seen = new Set<string>();
  // 注释内容按非贪婪匹配到最近的 `-->`；没闭合的注释匹配不上，自然跳过。
  const blockRe = /<!--\s*\[小手机数据\]\s*([\s\S]*?)\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const parsed = extractJsonObject(m[1]);
    if (!parsed || typeof parsed !== 'object') continue;
    const list = (parsed as Record<string, unknown>).characters;
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;
      const name = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (!name) continue;
      const relation = typeof raw.relation === 'string' ? raw.relation.trim() : '';
      if (isMainCharacter({ name, relation }, mainCharacterName)) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const profile = typeof raw.profile === 'string' ? raw.profile.trim() : '';
      const relationToMain =
        typeof raw.relationToMain === 'string' ? raw.relationToMain.trim() : '';
      const openingMessage =
        typeof raw.openingMessage === 'string' ? raw.openingMessage.trim() : '';
      found.push({
        name,
        ...(profile ? { profile: limitProfile(profile) } : {}),
        ...(relation ? { relation } : {}),
        ...(relationToMain ? { relationToMain } : {}),
        ...(openingMessage ? { openingMessage } : {}),
        gender: parseGender(raw.gender),
      });
    }
  }
  return found;
}

/**
 * 从一组主聊天消息里扫出全部隐藏数据块（按时间顺序，先出现的优先）。
 * 扫的是已经存下来的消息文本，不调模型。
 */
export function extractHiddenCharactersFromMessages(
  messages: Array<{ content: string }>,
  mainCharacterName: string,
): HiddenCharacter[] {
  const found: HiddenCharacter[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    for (const c of extractHiddenCharacters(message.content, mainCharacterName)) {
      const key = c.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(c);
    }
  }
  return found;
}

export interface MergeHiddenCharactersResult {
  /** 合并后的完整联系人列表（没变化时就是传进来的那个数组本身）。 */
  contacts: PhoneContact[];
  /** 这次新加的联系人（没有新加就是空数组）。 */
  added: PhoneContact[];
  /** 有没有新加联系人。 */
  changed: boolean;
}

/**
 * 把隐藏数据里的人合并进联系人列表。
 *
 *   - 按名字匹配（忽略大小写和首尾空格，和 parseContactsJson 沿用旧 id
 *     一个做法）：已经在列表里的人原样保留——id、好感度、微信记录、
 *     人设和关系都不动，不建重复项、不重置好感度；
 *   - 新人变成新联系人：人设/关系/开场白/性别按隐藏数据里写的来，
 *     好感度从 0 开始（PR #47 的规矩），id 新生成；
 *   - 开场白没给（或空）时用默认问候 `你好，我是${name}。`，写得太长
 *     时按 contacts.ts 的 cleanOpeningMessage 压短；
 *   - 列表满 8 人（和初始化同一个上限）时，多出来的人这次不加。
 * 纯函数：不读写缓存，调用方决定要不要存（没变化时不要存）。
 */
export function mergeHiddenCharacters(
  existing: PhoneContact[],
  found: HiddenCharacter[],
): MergeHiddenCharactersResult {
  const byName = new Map<string, PhoneContact>();
  for (const c of existing) {
    const key = c.name.trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, c);
  }
  const added: PhoneContact[] = [];
  for (const c of found) {
    const key = c.name.trim().toLowerCase();
    if (!key || byName.has(key)) continue;
    if (existing.length + added.length >= PHONE_DATA_MAX_CONTACTS) continue;
    const opening = c.openingMessage?.trim() ?? '';
    const contact: PhoneContact = {
      id: `c_${uid()}`,
      name: c.name.trim(),
      relation: c.relation?.trim() ?? '',
      ...(c.relationToMain?.trim() ? { relationToMain: c.relationToMain.trim() } : {}),
      openingMessage: opening
        ? opening.length <= 80
          ? opening
          : cleanOpeningMessage(opening, c.name.trim())
        : `你好，我是${c.name.trim()}。`,
      ...(c.profile ? { profile: limitProfile(c.profile) } : {}),
      gender: c.gender ?? 'unknown',
      affection: 0,
      v: 2,
    };
    added.push(contact);
    byName.set(key, contact);
  }
  if (added.length === 0) return { contacts: existing, added: [], changed: false };
  return { contacts: [...existing, ...added], added, changed: true };
}

/**
 * 小手机预设的指令文本：主角名填进去，告诉主聊天的模型每轮回复后
 * 在正文末尾追加隐藏数据块。
 *
 * 规则都写在指令里：只列本轮回复里实际出现的人物（主角除外、不编人），
 * 没人出现就整段省略；profile 不超过 200 字；relation 是和 User 的
 * 关系；数据块只给小手机读，不要在正文里解释它；只在主聊天里回复时
 * 这样做，在小手机微信里回消息时不要输出这个数据块。
 */
export function buildPhonePresetText(charName: string): string {
  const main = charName.trim() || '主角';
  return [
    '[小手机数据同步]',
    '你是小手机（手机里的微信）的数据来源。每次在主聊天里回复时，先写正常的回复正文；写完正文后，如果本轮回复里出现了人物（除了主角之外），在正文末尾再追加一个隐藏数据块，告诉小手机这些人是谁：',
    '<!-- [小手机数据] {"characters":[{"name":"名字","profile":"一两句人设：性格、长相、关键特点","relation":"和 User 的关系，从 User 的角度写，比如 闺蜜/哥哥/室友","relationToMain":"和主角的关系","openingMessage":"这个人第一次在微信上发来的短消息，1-2 句","gender":"female/male/unknown"}]} -->',
    '规则：',
    `1. 只列本轮回复里实际出现过的人物，不要把主角「${main}」列进来，不要编造对话里没出现的人。`,
    '2. 新出现的人和已经认识的人都可以列，小手机会按名字去重；本轮回复里没有出现任何人物时，整段省略，不要输出这个数据块。',
    '3. profile 不超过 200 字，按对话里写到的写，没写到的不要编，写空字符串；relation 是和 User 的关系，没写就写空字符串；openingMessage 用这个人发微信的口吻写，1-2 句。',
    '4. 这个数据块只给小手机读，不要在正文里解释它；它跟在正文后面，不属于对话内容。只在主聊天里回复时这样做，在小手机微信里回消息时不要输出这个数据块。',
  ].join('\n');
}
