/**
 * 小手机隐藏数据 — 主聊天和手机之间传“人”和“消息”的通道。
 *
 * 机制（PR #54 建起来，本 PR 改成唯一的数据来源）：
 *   1. 一本内置的、高优先级的预设（世界书 `phone-preset:<chatId>` 里的
 *      常驻条目，见 phonePresetStore.ts）被注入主聊天的提示词；
 *   2. 主聊天的模型每轮回复后，在正文末尾追加一个隐藏数据块，列出本轮
 *      回复里出现的人物（联系人）和新产生的聊天消息；
 *   3. 数据块是 HTML 注释 `<!-- [小手机数据] {...} -->`：主聊天的消息
 *      渲染走 core/render/renderer.ts（marked + DOMPurify，注释默认被
 *       stripped，渲染器自己也用 `<!--RPSTYLE:...-->` 当不可见载体），
 *      所以它不会显示在聊天消息里；小手机读到它就拿来建/更新联系人、
 *      往联系人的微信记录里追加消息。
 *
 * 这是联系人和微信消息的唯一来源：手机不再调模型初始化认人（旧的
 * PR #53 初始化——读最近 30 条主聊天消息再调一次模型——已经删掉，
 * 见 contacts.ts 的历史）。第一次打开手机时联系人列表是空的，主聊天
 * 产出隐藏数据块后才慢慢填进来；点“重置”清掉联系人和微信记录后，
 * 也是等主聊天后续产出新的数据块再填回来。
 *
 * 收到的数据写进“上下文”的办法：数据直接落进小手机的状态——联系人
 * 列表（`rpnow:phone:contacts:<chatId>`）和每个联系人的微信记录
 * （`rpnow:phone:wechat:<contactId>`）；微信记录正是手机回复提示词
 * 的上下文（runMemberReply 每次回复都把最近 10 条微信记录拼进提示词，
 * 剧情进度也读主聊天），所以主聊天的新消息进了微信记录，就进了回复
 * 的上下文，不需要再单独写一份上下文。
 *
 * 数据只有联系人/聊天消息，不经过这里传朋友圈、钱包、时间、运势。
 *
 * 这个模块是纯函数，好测：解析（extract）、合并（merge）、预设文本
 * （buildPhonePresetText）都不碰 IndexedDB、不调模型。
 */
import { uid } from '@/lib/utils.js';
import { cleanOpeningMessage } from './contacts.js';
import type { PhoneContact, PhoneContactGender, PhoneMessage } from './types.js';

/** 隐藏数据块的标记：只有小手机认得这个格式。 */
export const PHONE_DATA_MARKER = '[小手机数据]';

/** 小手机预设世界书的 id 前缀（`phone-preset:<chatId>`）。 */
export const PHONE_PRESET_BOOK_ID_PREFIX = 'phone-preset:';

/** 人设最多留多少字——和 contacts.ts 里初始化的人设上限同一个数。 */
export const PHONE_DATA_PROFILE_MAX_CHARS = 200;

/** 联系人最多留几位——和 contacts.ts 里初始化的上限同一个数。 */
export const PHONE_DATA_MAX_CONTACTS = 8;

/**
 * 合并消息时去重的窗口：只拿记录里最后这 N 条消息去比。
 * 同一个隐藏块被重复扫描（比如重开手机又扫了一遍历史）时，重复的
 * 消息会被拦住，不会贴两遍；记录已经很长、那条消息滑出窗口之后，
 * 再扫到同样的块才可能重复——窗口外的重复是可接受的代价。
 */
export const PHONE_DATA_MESSAGE_DEDUP_WINDOW = 20;

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

/**
 * 隐藏数据块里一条新聊天消息（JSON 里 `messages` 数组的元素）。
 *
 * character 是这条消息属于哪个联系人：`role` 是 `character` 时，
 * 是这个联系人发给 User 的；`role` 是 `user` 时，是 User 发给这个
 * 联系人的。content 是消息原文，一字不改。
 */
export interface HiddenMessage {
  character: string;
  role: 'user' | 'character';
  content: string;
}

/** 一个隐藏数据块解析出来的全部内容：联系人 + 聊天消息。 */
export interface HiddenData {
  characters: HiddenCharacter[];
  messages: HiddenMessage[];
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

/** 一条消息是不是主角本人的：character 写的是主角名，就不是联系人的消息。 */
function isMainCharacterMessage(character: string, mainCharacterName: string): boolean {
  const cardName = mainCharacterName.trim();
  return Boolean(cardName) && character.trim().toLowerCase() === cardName.toLowerCase();
}

/**
 * 从一段文本里抠出隐藏数据块，返回里面列的人物和消息。
 *
 * 格式：`<!-- [小手机数据] {"characters":[{...}],"messages":[{...}]} -->`。容错：
 *   - 一条消息里有多个块，全都解析、合起来返回；
 *   - 某个块的 JSON 坏了，只跳过那个块，其他块照常解析；
 *   - 注释没闭合（没有 `-->`），当作没有这个块；
 *   - 没有块、或两个数组都是空的，返回两个空数组；
 *   - 主角本人（名字是卡名、或 relation 是“本人”）直接排除；
 *     messages 里 character 写主角名的那条也排除；
 *   - 同名的人（忽略大小写和首尾空格）只留第一次出现的；
 *   - messages 里缺 character、role 不是 user/character、content 是空的，
 *     那条直接跳过（不影响同一块里的其他条目）。
 * 永远不抛错、不返回原始标记——解析失败就是空列表。
 */
export function extractHiddenData(text: string, mainCharacterName: string): HiddenData {
  const characters: HiddenCharacter[] = [];
  const messages: HiddenMessage[] = [];
  if (!text) return { characters, messages };
  const seen = new Set<string>();
  // 注释内容按非贪婪匹配到最近的 `-->`；没闭合的注释匹配不上，自然跳过。
  const blockRe = /<!--\s*\[小手机数据\]\s*([\s\S]*?)\s*-->/g;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(text)) !== null) {
    const parsed = extractJsonObject(m[1]);
    if (!parsed || typeof parsed !== 'object') continue;
    const raw = parsed as Record<string, unknown>;
    const list = raw.characters;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const c = item as Record<string, unknown>;
        const name = typeof c.name === 'string' ? c.name.trim() : '';
        if (!name) continue;
        const relation = typeof c.relation === 'string' ? c.relation.trim() : '';
        if (isMainCharacter({ name, relation }, mainCharacterName)) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        const profile = typeof c.profile === 'string' ? c.profile.trim() : '';
        const relationToMain =
          typeof c.relationToMain === 'string' ? c.relationToMain.trim() : '';
        const openingMessage =
          typeof c.openingMessage === 'string' ? c.openingMessage.trim() : '';
        characters.push({
          name,
          ...(profile ? { profile: limitProfile(profile) } : {}),
          ...(relation ? { relation } : {}),
          ...(relationToMain ? { relationToMain } : {}),
          ...(openingMessage ? { openingMessage } : {}),
          gender: parseGender(c.gender),
        });
      }
    }
    const msgList = raw.messages;
    if (Array.isArray(msgList)) {
      for (const item of msgList) {
        if (!item || typeof item !== 'object') continue;
        const msg = item as Record<string, unknown>;
        const character = typeof msg.character === 'string' ? msg.character.trim() : '';
        if (!character) continue;
        if (isMainCharacterMessage(character, mainCharacterName)) continue;
        const role = msg.role === 'user' || msg.role === 'character' ? msg.role : null;
        if (!role) continue;
        const content = typeof msg.content === 'string' ? msg.content.trim() : '';
        if (!content) continue;
        messages.push({ character, role, content });
      }
    }
  }
  return { characters, messages };
}

/**
 * 从一段文本里抠出隐藏数据块，返回里面列的人物。
 * 只是 extractHiddenData 的 characters 那一半（老调用方和测试用）。
 */
export function extractHiddenCharacters(
  text: string,
  mainCharacterName: string,
): HiddenCharacter[] {
  return extractHiddenData(text, mainCharacterName).characters;
}

/**
 * 从一段文本里抠出隐藏数据块，返回里面的新聊天消息。
 * 只是 extractHiddenData 的 messages 那一半。
 */
export function extractHiddenMessages(
  text: string,
  mainCharacterName: string,
): HiddenMessage[] {
  return extractHiddenData(text, mainCharacterName).messages;
}

/**
 * 从一组主聊天消息里扫出全部隐藏数据块（按时间顺序，先出现的优先）。
 * 扫的是已经存下来的消息文本，不调模型。人物同名只留第一次出现的；
 * 消息不去重（去重在合并时按微信记录做，见 mergeHiddenData）。
 */
export function extractHiddenDataFromMessages(
  messages: Array<{ content: string }>,
  mainCharacterName: string,
): HiddenData {
  const characters: HiddenCharacter[] = [];
  const messagesOut: HiddenMessage[] = [];
  const seen = new Set<string>();
  for (const message of messages) {
    const found = extractHiddenData(message.content, mainCharacterName);
    for (const c of found.characters) {
      const key = c.name.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      characters.push(c);
    }
    messagesOut.push(...found.messages);
  }
  return { characters, messages: messagesOut };
}

/**
 * 从一组主聊天消息里扫出全部隐藏数据块里的人物（按时间顺序，先出现的优先）。
 * 只是 extractHiddenDataFromMessages 的 characters 那一半。
 */
export function extractHiddenCharactersFromMessages(
  messages: Array<{ content: string }>,
  mainCharacterName: string,
): HiddenCharacter[] {
  return extractHiddenDataFromMessages(messages, mainCharacterName).characters;
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
 *   - 按名字匹配（忽略大小写和首尾空格）：已经在列表里的人原样保留——id、好感度、微信记录、
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

/** 一个联系人的微信记录里，一条消息去重用的 key：说话人 + 角色 + 内容。 */
function messageDedupKey(contactName: string, msg: PhoneMessage): string {
  return `${contactName.trim().toLowerCase()}|${msg.role}|${msg.content}`;
}

export interface MergeHiddenDataResult {
  /** 合并后的完整联系人列表（联系人没变化时就是传进来的那个数组本身）。 */
  contacts: PhoneContact[];
  /** 这次新加的联系人（没有新加就是空数组）。 */
  added: PhoneContact[];
  /** 联系人列表有没有变化。 */
  contactsChanged: boolean;
  /**
   * 这次有消息追加的联系人：contactId -> 追加后的完整微信记录。
   * 调用方把这里的记录存回 `rpnow:phone:wechat:<contactId>` 即可。
   * 还没有记录的联系人，记录以开场白开头（和 ensureChat 一个做法），
   * 再接追加的消息。
   */
  chats: Map<string, PhoneMessage[]>;
  /** 这次追加的消息本身：contactId -> 追加的消息（按顺序）。 */
  appended: Map<string, PhoneMessage[]>;
  /** 有没有消息被追加。 */
  messagesChanged: boolean;
}

/**
 * 把一个隐藏数据块（联系人 + 聊天消息）合并进小手机的状态。
 *
 *   - 联系人：走 mergeHiddenCharacters（已有的原样保留，新人好感度从 0 开始）；
 *   - 消息：按顺序贴进对应联系人的微信记录。`role` 是 `character` 的是
 *     这个联系人发来的（assistant），`role` 是 `user` 的是 User 发给
 *     这个联系人的；贴之前先按名字找联系人——
 *       - 块里只带了消息、没带这个人的人物信息时，先给他建一个最小的
 *         联系人（名字、默认问候、gender unknown、好感度 0），再贴消息；
 *       - 列表满 8 人时，建不出新联系人，这条消息就跳过；
 *   - 去重：每条消息贴之前，先和这个联系人记录里最后
 *     PHONE_DATA_MESSAGE_DEDUP_WINDOW（20）条比——说话人 + 角色 +
 *     内容完全一样的就不贴。同一个块被重复扫描（重开手机又扫了一遍
 *     历史）不会把消息贴两遍；
 *   - 主角本人的消息（character 是主角名）不贴——主角不是联系人。
 *
 * 纯函数：不读写缓存。existingChats 是调用方读出来的已有微信记录
 * （contactId -> 消息数组），没读出来/没记录的联系人按空记录算。
 * 调用方按返回的 chats 存记录、按 contacts 存联系人（没变化时不要存）。
 */
export function mergeHiddenData(
  existing: PhoneContact[],
  found: HiddenData,
  existingChats: Map<string, PhoneMessage[]>,
  mainCharacterName: string,
): MergeHiddenDataResult {
  const charMerge = mergeHiddenCharacters(existing, found.characters);
  // 复制一份再改：mergeHiddenCharacters 没变化时返回的是调用方传进来的
  // 那个数组本身，直接 push 会改掉调用方的列表。
  const contacts = [...charMerge.contacts];
  const added = [...charMerge.added];
  const byName = new Map<string, PhoneContact>();
  for (const c of contacts) {
    const key = c.name.trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, c);
  }
  // 每个联系人这次的记录：先从调用方给的已有记录拷一份（不动原数组）。
  const chats = new Map<string, PhoneMessage[]>();
  const appended = new Map<string, PhoneMessage[]>();
  const chatFor = (contact: PhoneContact): PhoneMessage[] => {
    let chat = chats.get(contact.id);
    if (!chat) {
      const stored = existingChats.get(contact.id);
      chat =
        stored && stored.length > 0
          ? [...stored]
          : [
              {
                id: uid('m'),
                role: 'assistant' as const,
                type: 'text' as const,
                content: contact.openingMessage,
                createdAt: Date.now(),
              },
            ];
      chats.set(contact.id, chat);
    }
    return chat;
  };
  let messagesChanged = false;
  for (const msg of found.messages) {
    const key = msg.character.trim().toLowerCase();
    if (!key || isMainCharacterMessage(msg.character, mainCharacterName)) continue;
    let contact = byName.get(key);
    if (!contact) {
      // 块里只带了消息、没带这个人：先建最小联系人（满 8 人就建不出，跳过这条）。
      if (contacts.length + added.length >= PHONE_DATA_MAX_CONTACTS) continue;
      contact = {
        id: `c_${uid()}`,
        name: msg.character.trim(),
        relation: '',
        openingMessage: `你好，我是${msg.character.trim()}。`,
        gender: 'unknown',
        affection: 0,
        v: 2,
      };
      contacts.push(contact);
      added.push(contact);
      byName.set(key, contact);
    }
    const chat = chatFor(contact);
    const phoneMsg: PhoneMessage = {
      id: uid('m'),
      role: msg.role === 'character' ? 'assistant' : 'user',
      type: 'text',
      content: msg.content,
      createdAt: Date.now(),
    };
    const dedupKey = messageDedupKey(contact.name, phoneMsg);
    const window = chat.slice(-PHONE_DATA_MESSAGE_DEDUP_WINDOW);
    if (window.some((m) => messageDedupKey(contact.name, m) === dedupKey)) continue;
    chat.push(phoneMsg);
    const list = appended.get(contact.id) ?? [];
    list.push(phoneMsg);
    appended.set(contact.id, list);
    messagesChanged = true;
  }
  const contactsChanged = charMerge.changed || added.length > charMerge.added.length;
  return {
    contacts: contactsChanged ? contacts : existing,
    added,
    contactsChanged,
    chats: messagesChanged ? chats : new Map(),
    appended,
    messagesChanged,
  };
}

/**
 * 小手机预设的指令文本：主角名填进去，告诉主聊天的模型每轮回复后
 * 在正文末尾追加隐藏数据块。
 *
 * 指令是自洽的：只读这一份指令，模型就能知道要输出什么——
 *   - 精确格式：HTML 注释 `<!-- [小手机数据] {...} -->`，聊天界面不显示它；
 *   - 精确 JSON 结构：`characters`（联系人列表）+ `messages`（新聊天消息），
 *     每个字段是什么、怎么填、填多长，都写在里面；
 *   - 规则：只写本轮回复和当前故事里实际出现的人物和实际发生过的消息，
 *     不编人、不编话；主角不列；什么都没有时整段省略；只在主聊天里做。
 */
export function buildPhonePresetText(charName: string): string {
  const main = charName.trim() || '主角';
  return [
    '[小手机数据同步]',
    '你是小手机（手机里的微信）的数据来源。每轮在主聊天里回复时，先写正常的回复正文；写完正文后，再看本轮回复里有没有出现新的人物、有没有新产生聊天消息，有就按下面的格式在正文末尾追加一个隐藏数据块，告诉小手机联系人是谁、以及新产生了哪些聊天消息：',
    '<!-- [小手机数据] {"characters":[{"name":"名字","profile":"一两句人设：性格、长相、关键特点","relation":"和 User 的关系，从 User 的角度写，比如 闺蜜/哥哥/室友","relationToMain":"和主角的关系","openingMessage":"这个人第一次在微信上发来的短消息，1-2 句","gender":"female/male/unknown"}],"messages":[{"character":"说这句话的联系人名字","role":"user 或 character","content":"这条消息的原文"}]} -->',
    '这是一个 HTML 注释：聊天界面不会显示它，只有小手机会读它。不要在正文里解释它，不要把它写进对话内容里。',
    '',
    '数据结构说明（JSON，只有一个对象，里面两个数组）：',
    '1. characters：本轮回复里实际出现的人物，每个人一个对象：',
    '   - name（必填）：人物的名字。',
    '   - profile：一两句人设，性格、长相、关键特点，不超过 200 字；按本轮回复和之前的对话里写到的写，没写到的不要编，写空字符串。',
    '   - relation：这个人和 User 的关系，从 User 的角度写，比如 闺蜜/哥哥/室友；对话里没写就写空字符串，不要编。',
    '   - relationToMain：这个人和主角的关系，比如 闺蜜/哥哥；没写就写空字符串。',
    '   - openingMessage：这个人第一次在微信上发来的短消息，用这个人发微信的口吻写，1-2 句，最多 40 字。',
    '   - gender：这个人的性别，按对话里的表现判断：female 女 / male 男 / unknown 不知道。',
    '2. messages：本轮回复里新产生的聊天消息（以及之前还没报过、现在补报的最近消息），每条一个对象：',
    '   - character：这条消息是哪个联系人说的、或是说给哪个联系人的——写那个联系人的名字。',
    '   - role：这条消息是谁发的：user 是 User 发给这个联系人的，character 是这个联系人发给 User 的。',
    '   - content：这条消息的原文，一字不改。',
    '   例子：User 在主聊天里对小雨说“明天一早就去开门”，就写 {"character":"小雨","role":"user","content":"明天一早就去开门"}；小雨回了一句“好呀，我带早餐过去”，就写 {"character":"小雨","role":"character","content":"好呀，我带早餐过去"}。',
    '',
    '规则：',
    `1. 只写本轮回复和当前故事里实际出现过的人物和实际发生过的消息，不要编造对话里没出现的人、不要编造没说过的话。`,
    `2. 不要把主角「${main}」列进来：主角不是联系人，characters 里不要有主角，messages 里 character 也不要写主角的名字。`,
    '3. 新出现的人和已经认识的人都可以列，小手机会按名字去重；已经报过的消息不要重复报。',
    '4. 本轮回复里既没有新人物、也没有新消息时，整段省略，不要输出这个数据块。',
    '5. 这个数据块只给小手机读；只在主聊天里回复时这样做，在小手机微信里回消息时不要输出这个数据块。',
  ].join('\n');
}
