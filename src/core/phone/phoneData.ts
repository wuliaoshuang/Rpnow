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
 * 但模型不一定听指令：实测里模型常常只写剧情、正文末尾根本不输出隐藏
 * 数据块（预设确实注入了，模型就是不写），那时联系人永远是空的。所以
 * 还有一条兜底（extractHiddenDataWithFallback）：某条主聊天消息没有
 * 隐藏数据块时，直接从它的正文（剧情）里认人、贴消息——纯解析，不调
 * 模型。名字从世界书条目的名字和已有联系人里来（只读名字，不读内容；
 * 没在表里的名字不认、不编），一句话归谁看句里有没有他的名字，
 * 归不到的句子跳过。块还在时块是权威的，同一条消息不跑兜底。
 * 兜底建的联系人只有名字和默认问候：后来隐藏块带来人设/关系/开场白时，
 * mergeHiddenCharacters 会把空着的字段补上（只补空、不覆盖已有的）。
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
 * 但后一次带来的、第一次没有的字段（人设/关系/开场白/性别）会补上——
 * 比如同一轮里先是 User 提了一句某人、后是剧情里他第一次说话，开场白
 * 不能因为“先出现的是没开场白那条”就丢掉。
 * 消息不去重（去重在合并时按微信记录做，见 mergeHiddenData）。
 */
export function extractHiddenDataFromMessages(
  messages: Array<{ content: string }>,
  mainCharacterName: string,
): HiddenData {
  const characters: HiddenCharacter[] = [];
  const messagesOut: HiddenMessage[] = [];
  const seen = new Map<string, number>();
  for (const message of messages) {
    const found = extractHiddenData(message.content, mainCharacterName);
    for (const c of found.characters) {
      const key = c.name.trim().toLowerCase();
      const idx = seen.get(key);
      if (idx === undefined) {
        seen.set(key, characters.length);
        characters.push(c);
      } else {
        characters[idx] = fillBlankHiddenCharacter(characters[idx], c);
      }
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

/**
 * 同名人物出现两次时，把后一次带来的、第一次没有的字段补上（人设/关系/
 * 开场白/性别）。只补空、不覆盖已经有的——先出现的那条是权威的顺序，
 * 后出现的只填它没写的东西。
 */
function fillBlankHiddenCharacter(
  prev: HiddenCharacter,
  next: HiddenCharacter,
): HiddenCharacter {
  const filled: HiddenCharacter = { ...prev };
  if (!filled.profile && next.profile) filled.profile = next.profile;
  if (!filled.relation && next.relation) filled.relation = next.relation;
  if (!filled.relationToMain && next.relationToMain) filled.relationToMain = next.relationToMain;
  if (!filled.openingMessage && next.openingMessage) filled.openingMessage = next.openingMessage;
  if (
    (filled.gender ?? 'unknown') === 'unknown' &&
    next.gender &&
    next.gender !== 'unknown'
  ) {
    filled.gender = next.gender;
  }
  return filled;
}

/**
 * 兜底提取时，一个名字最多算几个字：世界书条目的 comment 在这个库里
 * 就是人名，超过这个长度的一般不是人名（比如一整句描述），不拿来认人。
 */
export const FALLBACK_NAME_MAX_CHARS = 12;

/**
 * 兜底提取用的已知名字表：不用调模型，从手机已经有的东西里拼出来——
 *   (a) 该聊天绑定的世界书里各条目的名字（comment 字段；只读名字，
 *       不读条目内容——内容是世界知识，不是联系人名单）；
 *   (b) 联系人列表里已有的名字（已经认识的人，剧情里再出现也要认出来）。
 * 主角本人的名字不进表（主角不是联系人）。同名（忽略大小写和首尾空格）
 * 只留第一次出现的写法。
 */
export function buildKnownNames(
  books: Array<{ entries: Array<{ comment: string }> }>,
  existingContacts: PhoneContact[],
  mainCharacterName: string,
): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const name = raw.trim();
    if (!name) return;
    if ([...name].length > FALLBACK_NAME_MAX_CHARS) return;
    if (isMainCharacterMessage(name, mainCharacterName)) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(name);
  };
  for (const book of books) {
    for (const entry of book.entries ?? []) add(entry.comment ?? '');
  }
  for (const c of existingContacts) add(c.name ?? '');
  return names;
}

/** 去掉文本里的隐藏数据块注释（闭合的和没闭合的都去掉），免得兜底从坏掉的块里读名字。 */
function stripHiddenComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<!--[\s\S]*$/g, ' ');
}

/** 把一段正文切成句子：按句末标点（。！？!?）和换行切，标点和标点后紧跟的右引号/右括号留在句尾。 */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^。！？!?\n]+[。！？!?]?[」』”’"'）】]*/g) ?? [];
  return parts.map((p) => p.trim()).filter(Boolean);
}

/**
 * 一段文本里出现了哪些已知名字：子串匹配。
 * 其中一个名字是另一个名字的子串时，只留长的那个（比如同一句里同时
 * 出现“阿杰”和“杰”，只算阿杰，不把一句话同时贴给两个人）。
 */
function namesInText(text: string, knownNames: string[]): string[] {
  const found = knownNames.filter((n) => n && text.includes(n));
  return found.filter((n) => !found.some((other) => other !== n && other.includes(n)));
}

/**
 * 兜底提取：从一条主聊天消息的正常正文（剧情）里认人、贴消息。
 *
 * 模型只写剧情、不输出隐藏数据块时用的——纯解析，不调模型：
 *   - User 发的消息：整条贴给每个被提到的人（user 角色）；没提到
 *     任何已知名字就跳过，不群发；
 *   - 主角（assistant）讲的剧情：按句子切，一句属于哪个联系人，看
 *     句里有没有他的名字（比如 `小雨说："..."` 归小雨）；归不到任何
 *     人的句子跳过，不编归属；
 *   - 每个被提到的人都建一个联系人：人设/关系留空（不编），开场白取
 *     这个人在剧情里第一次说话/行动的那句短句、按 cleanOpeningMessage
 *     压短，没有可用的句子就留空、合并时用默认问候；
 *   - 主角本人不建联系人、不贴消息；一句里同时提到主角和某个联系人
 *     时，那句归那个联系人。
 * 名字表是空的（既没有世界书条目、也没有已有的联系人）就什么都找不到，
 * 这是正确的——那时只能等隐藏数据块，或等用户在世界书里定义人物。
 * 永远不抛错：空文本、空名字表都返回空列表。
 */
export function extractFallbackDataFromMessage(
  message: { content: string; role: string },
  knownNames: string[],
  mainCharacterName: string,
): HiddenData {
  const characters: HiddenCharacter[] = [];
  const messages: HiddenMessage[] = [];
  if (!message.content || knownNames.length === 0) return { characters, messages };
  const text = stripHiddenComments(message.content).trim();
  if (!text) return { characters, messages };
  const seenChars = new Map<string, HiddenCharacter>();
  const firstSentence = new Map<string, string>();
  const addCharacter = (name: string) => {
    const key = name.trim().toLowerCase();
    if (!key || seenChars.has(key)) return;
    seenChars.set(key, { name: name.trim(), gender: 'unknown' });
  };
  if (message.role === 'user') {
    for (const name of namesInText(text, knownNames)) {
      if (isMainCharacterMessage(name, mainCharacterName)) continue;
      addCharacter(name);
      messages.push({ character: name, role: 'user', content: text });
    }
  } else if (message.role === 'assistant') {
    for (const sentence of splitSentences(text)) {
      for (const name of namesInText(sentence, knownNames)) {
        if (isMainCharacterMessage(name, mainCharacterName)) continue;
        addCharacter(name);
        const key = name.trim().toLowerCase();
        if (!firstSentence.has(key)) firstSentence.set(key, sentence);
        messages.push({ character: name, role: 'character', content: sentence });
      }
    }
  }
  for (const [key, c] of seenChars) {
    const first = firstSentence.get(key);
    if (first) {
      const opening = cleanOpeningMessage(first, c.name);
      if (opening !== `你好，我是${c.name}。`) c.openingMessage = opening;
    }
    characters.push(c);
  }
  return { characters, messages };
}

/**
 * 从一组主聊天消息里扫出联系人和新消息：每条消息先试隐藏数据块，
 * 有块就只用块（块是权威的，不再对同一条消息跑兜底，免得消息重复）；
 * 没块（或块是空的）才对这条消息的正文跑兜底提取。
 * 扫的是已经存下来的消息文本，不调模型。人物同名只留第一次出现的；
 * 消息不去重（去重在合并时按微信记录做，见 mergeHiddenData）。
 */
export function extractHiddenDataWithFallback(
  messages: Array<{ content: string; role: string }>,
  knownNames: string[],
  mainCharacterName: string,
): HiddenData {
  const characters: HiddenCharacter[] = [];
  const messagesOut: HiddenMessage[] = [];
  const seen = new Map<string, number>();
  for (const message of messages) {
    const hidden = extractHiddenData(message.content, mainCharacterName);
    const found =
      hidden.characters.length > 0 || hidden.messages.length > 0
        ? hidden
        : extractFallbackDataFromMessage(message, knownNames, mainCharacterName);
    for (const c of found.characters) {
      const key = c.name.trim().toLowerCase();
      const idx = seen.get(key);
      if (idx === undefined) {
        seen.set(key, characters.length);
        characters.push(c);
      } else {
        characters[idx] = fillBlankHiddenCharacter(characters[idx], c);
      }
    }
    messagesOut.push(...found.messages);
  }
  return { characters, messages: messagesOut };
}

export interface MergeHiddenCharactersResult {
  /** 合并后的完整联系人列表（没变化时就是传进来的那个数组本身）。 */
  contacts: PhoneContact[];
  /** 这次新加的联系人（没有新加就是空数组）。 */
  added: PhoneContact[];
  /** 联系人列表有没有变化（新加了人，或给已有的人补了空字段）。 */
  changed: boolean;
}

/**
 * 隐藏数据里的人物信息，补进一个已有联系人空着的字段里。
 * 只补空、不覆盖已经有的：人设、关系、和主角的关系、性别（unknown 才补）、
 * 开场白（只有当前是默认问候时才补）。id、好感度都不动。
 * 没补上任何东西时返回原对象本身（调用方靠这个判断有没有变化）。
 */
function fillBlankContactFields(prev: PhoneContact, found: HiddenCharacter): PhoneContact {
  let next = prev;
  const set = (patch: Partial<PhoneContact>) => {
    next = { ...next, ...patch };
  };
  if (!prev.profile?.trim() && found.profile?.trim()) {
    set({ profile: limitProfile(found.profile.trim()) });
  }
  if (!prev.relation?.trim() && found.relation?.trim()) {
    set({ relation: found.relation.trim() });
  }
  if (!prev.relationToMain?.trim() && found.relationToMain?.trim()) {
    set({ relationToMain: found.relationToMain.trim() });
  }
  if (
    (prev.gender ?? 'unknown') === 'unknown' &&
    (found.gender === 'female' || found.gender === 'male')
  ) {
    set({ gender: found.gender });
  }
  const opening = found.openingMessage?.trim() ?? '';
  if (opening && prev.openingMessage === `你好，我是${prev.name.trim()}。`) {
    set({
      openingMessage:
        opening.length <= 80 ? opening : cleanOpeningMessage(opening, prev.name.trim()),
    });
  }
  return next;
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
 *   - 列表满 8 人（和初始化同一个上限）时，多出来的人这次不加；
 *   - 兜底提取建的联系人只有名字和默认问候：后来隐藏数据块带来人设/
 *     关系/开场白时，把空着的字段补上（只补空，见 fillBlankContactFields），
 *     这样块里写明的 profile/relation 还是会落到联系人身上。
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
  const all = [...existing, ...added];
  const byKey = new Map<string, number>();
  all.forEach((c, i) => {
    const key = c.name.trim().toLowerCase();
    if (key && !byKey.has(key)) byKey.set(key, i);
  });
  let enriched = false;
  for (const c of found) {
    const key = c.name.trim().toLowerCase();
    if (!key) continue;
    const idx = byKey.get(key);
    if (idx === undefined) continue;
    const next = fillBlankContactFields(all[idx], c);
    if (next !== all[idx]) {
      all[idx] = next;
      enriched = true;
    }
  }
  if (added.length === 0 && !enriched) {
    return { contacts: existing, added: [], changed: false };
  }
  // 新加的人也可能在同一批里被后一条补了空字段：added 按 all 里最新的那份返回。
  return { contacts: all, added: all.slice(existing.length), changed: true };
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
 *   - 要求写在最前面：先写正常正文，写完必须追加隐藏数据块；
 *   - 精确格式：HTML 注释 `<!-- [小手机数据] {...} -->`，聊天界面不显示它；
 *   - 精确 JSON 结构：`characters`（联系人列表）+ `messages`（新聊天消息），
 *     每个字段是什么、怎么填、填多长，都写在格式行和例子里；
 *   - 后果写明了：不输出这个块，小手机就认不出任何联系人；
 *   - 规则：只写本轮回复和当前故事里实际出现的人物和实际发生过的消息，
 *     不编人、不编话；主角不列；什么都没有时整段省略；只在主聊天里做。
 *
 * 故意写得很短：上一版把每个字段逐条讲、规则列了 5 条，模型照样只写
 * 剧情、不输出这个块（用户实测）。这一版把要求和后果顶到最前面、只留
 * 一个例子；模型还是不输出时，兜底提取（extractFallbackDataFromMessage）
 * 会直接从剧情正文里认人，不再全靠这一份指令。
 */
export function buildPhonePresetText(charName: string): string {
  const main = charName.trim() || '主角';
  return [
    '[小手机数据同步——每轮回复都必须做]',
    '每轮在主聊天里回复时，先写正常的回复正文；写完正文后，必须在正文末尾再追加一个隐藏数据块，告诉小手机本轮回复里出现了哪些人物、产生了哪些聊天消息。',
    '不输出这个块，小手机就认不出任何联系人、微信里永远是空的——所以只要本轮回复里出现了一个人，就必须输出它，不要跳过。',
    '格式（HTML 注释，聊天界面不显示它，只有小手机会读）：',
    '<!-- [小手机数据] {"characters":[{"name":"名字","profile":"一两句人设，不超过 200 字","relation":"和 User 的关系，比如 闺蜜/哥哥，没写就写空字符串","relationToMain":"和主角的关系，没写就写空字符串","openingMessage":"这个人第一次在微信上发来的短消息，1-2 句，最多 40 字","gender":"female/male/unknown"}],"messages":[{"character":"联系人名字","role":"user 或 character","content":"这条消息的原文"}]} -->',
    '例子：User 在主聊天里对小雨说“明天一早就去开门”，小雨回了一句“好呀，我带早餐过去”，就写 {"characters":[{"name":"小雨","profile":"在酒馆帮忙，想学调酒","relation":"朋友","relationToMain":"同事","openingMessage":"在吗在吗，明天一早我就去开门","gender":"female"}],"messages":[{"character":"小雨","role":"user","content":"明天一早就去开门"},{"character":"小雨","role":"character","content":"好呀，我带早餐过去"}]}。',
    '',
    '规则：',
    '1. 只写本轮回复里实际出现过的人物和实际发生过的消息：user 是 User 发给这个联系人的，character 是这个联系人发给 User 的；不要编造对话里没出现的人、不要编造没说过的话。',
    `2. 不要把主角「${main}」列进来：characters 里不要有主角，messages 里 character 也不要写主角的名字。`,
    '3. 本轮回复里既没有新人物、也没有新消息时，整段省略，不要输出这个数据块。',
    '4. 这个数据块只给小手机读；只在主聊天里回复时这样做，在小手机微信里回消息时不要输出这个数据块。',
  ].join('\n');
}
