/**
 * 联系人初始化 — 小手机的联系人是从主聊天里产生的人物，不是卡的主角本人。
 *
 * 第一次打开一部聊天的小手机时，调一次模型，让它从主聊天的消息记录里
 * 找出在对话里出现过的人物：主聊天产生了这些信息，小手机再把它们填成
 * 联系人。初始化只读主聊天的消息，不再主动去读世界书、预设和卡的字段
 * 来找人——只在世界书里出现、还没在主聊天里露过面的人，不会进联系人
 * 列表。结果按聊天缓存进 IndexedDB，之后直接读缓存，不再重复调模型。
 *
 * 初始化只从主聊天之外借两样东西，都是为了把关系算对、把主角排除，
 * 不是用来找人的：
 *   - 卡的主角名（card.data.name）：只用来排除主角本人；
 *   - User 的身份（resolvePhoneUser，聊天的 persona）：只用来把每个
 *     联系人的 relation 按 User 来算。
 * 卡的介绍、性格、场景、开场白、示例对话一律不读；世界书一律不读。
 *
 * 每个联系人的 relation 是和 User（在微信里和他/她聊天的那个人）的关系，
 * 不是和主角的关系：初始化要先告诉模型 User 在这个故事里是谁（聊天的
 * persona），模型才能按 User 把关系算对；聊天里没写这个人和 User 的关系
 * 时不要编，relation 留空，和主角的关系写进 relationToMain。回复提示词
 * 里按 relation 写（“是用户的闺蜜”），模型才知道该怎么对 User。
 *
 * 每个联系人除了名字、关系、开场白，还带一条自己的人设（profile：性格、
 * 长相、关键特点，一两句，按聊天里写到的来，没写的不要编），回复时写进
 * 这个联系人自己的 system prompt，模型扮演他/她才不会 OOC。开场白也是
 * 按聊天里这个人的说话口吻写的短消息，不照抄卡的 first_mes。
 *
 * 主聊天里消息很少、还没出现过其他人物时，联系人列表就是空的或很短——
 * 这是正常的：联系人随着主聊天的推进长出来；想重新认一遍人，点“重置”
 * 再初始化一次。不要为了凑数去读世界书补人。
 *
 * 解析失败、超时或模型没配好时，一律退回空列表（不编联系人）；调用方
 * 下次打开会再试一次。
 */
import type { RPCard } from '@/core/types/card.js';
import type { RPChatMessage, RPPersona } from '@/core/types/chat.js';
import type { LLMMessage, LLMService } from '@/core/llm/types.js';
import { uid } from '@/lib/utils.js';
import type { PhoneContact, PhoneContactGender } from './types.js';

/**
 * 小手机初始化用的 User 身份：这个聊天的 User 在故事里是谁。
 * 就是主聊天里 {{user}} 的那个人——聊天的 persona（名字、介绍）。
 */
export interface PhoneUserIdentity {
  name: string;
  description: string;
}

/**
 * 这个聊天的 User 是谁：主聊天里 {{user}} 就是这么定的——聊天的
 * personaId 对应的人设，找不到就用第一个人设；一个人设都没有，
 * 就是没有单独定义 User 的身份，返回 undefined（调用方在提示词里
 * 明说，而不是让模型猜）。
 */
export function resolvePhoneUser(
  chat: { personaId?: string },
  personas: RPPersona[],
): PhoneUserIdentity | undefined {
  const persona = personas.find((p) => p.id === chat.personaId) ?? personas[0];
  if (!persona) return undefined;
  return { name: persona.name, description: persona.description };
}

/**
 * 联系人在列表/标题里显示的关系：优先和 User 的关系；没写和 User 的
 * 关系时显示和主角的关系（写明是主角的）；都没写时显示“朋友”（只是
 * 界面上的通用标签，不代表模型认定的关系）。
 */
export function displayRelation(contact: PhoneContact): string {
  const toUser = contact.relation.trim();
  if (toUser) return toUser;
  const toMain = contact.relationToMain?.trim() ?? '';
  if (toMain) return `主角的${toMain}`;
  return '朋友';
}

/**
 * 好感度：0–100，聊天涨上去的。数字都放在这里，以后要调阈值只改这里。
 *
 *   - 用户发一条消息 +1，角色回一次 +1（一轮完整对话 +2），封顶 100，
 *     这版不扣好感度；
 *   - 50 解锁约会请求（约她/他出去），80 解锁私密照（让她/他发一张
 *     只给你看的照片）。
 *
 * 好感度存在联系人自己身上（PhoneContact.affection），跟着联系人缓存
 * 一起进 IndexedDB，关掉重开还在；点“重置”清掉联系人缓存时一起清掉。
 * 老缓存里没有这个字段，读的时候按 0 算——不触发重新初始化。
 */
export const AFFECTION_MAX = 100;
/** 用户发一条消息，好感度 +1。 */
export const AFFECTION_PER_USER_MESSAGE = 1;
/** 角色回一次，好感度 +1。 */
export const AFFECTION_PER_CHARACTER_REPLY = 1;
/** 约会请求解锁：好感度达到这个数才能约她/他出去。 */
export const AFFECTION_DATE_UNLOCK = 50;
/** 私密照解锁：好感度达到这个数才能让她/他发一张私密照。 */
export const AFFECTION_PRIVATE_PHOTO_UNLOCK = 80;

/** 读一个联系人的好感度：没写（老缓存）按 0 算，超出 0–100 的压回来。 */
export function affectionOf(contact: PhoneContact): number {
  const raw = contact.affection;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.min(AFFECTION_MAX, Math.max(0, Math.round(raw)));
}

/** 给一个联系人加好感度，返回新对象（原对象不动），封顶 100、不扣到 0 以下。 */
export function addAffection(contact: PhoneContact, amount: number): PhoneContact {
  const next = affectionOf(contact) + amount;
  return { ...contact, affection: Math.min(AFFECTION_MAX, Math.max(0, next)) };
}

/** 好感度到 50 了吗——能约她/他出去了吗。 */
export function isDateUnlocked(contact: PhoneContact): boolean {
  return affectionOf(contact) >= AFFECTION_DATE_UNLOCK;
}

/** 好感度到 80 了吗——能让她/他发一张私密照了吗。 */
export function isPrivatePhotoUnlocked(contact: PhoneContact): boolean {
  return affectionOf(contact) >= AFFECTION_PRIVATE_PHOTO_UNLOCK;
}

/** 模型给的 gender 只认三个值，其他一律按 unknown 算。 */
function parseGender(raw: unknown): PhoneContactGender {
  return raw === 'female' || raw === 'male' ? raw : 'unknown';
}

/** 联系人最多留几位：卡里人再多，微信列表也不宜太长。 */
const MAX_CONTACTS = 8;

/** 人设最多留多少字（一两句就够了，模型写长了也压短）。 */
const PROFILE_MAX_CHARS = 200;

/**
 * 把卡的 first_mes 压成一句短的微信开场白：去 *动作描写*、只取第一句、
 * 最多 60 字。剩不下能用的就用默认问候。
 *
 * first_mes 原样展示会是一大段角色扮演描写，不能直接当微信第一条消息。
 */
export function cleanOpeningMessage(firstMes: string, name: string): string {
  const fallback = `你好，我是${name}。`;
  if (!firstMes) return fallback;
  // 去掉 *动作描写*（可能跨行）。
  const noActions = firstMes.replace(/\*[\s\S]*?\*/g, ' ');
  // 折叠空白。
  const flat = noActions.replace(/\s+/g, ' ').trim();
  if (!flat) return fallback;
  // 取第一句：到第一个句末标点为止，标点后紧跟的右引号也一起收进来。
  const m = flat.match(/^[^。！？!?]*[。！？!?][」』"'）】]?/);
  let first = (m ? m[0] : flat).trim();
  if (!first) return fallback;
  if (first.length > 60) first = `${first.slice(0, 60)}…`;
  return first;
}

/** 模型开场白的安全阀：本来就短的原样用；写成大段的才压短。 */
function limitOpening(opening: string, name: string): string {
  if (opening.length <= 80) return opening;
  return cleanOpeningMessage(opening, name);
}

/** 人设的安全阀：本来就短的原样用；写长了才压短。 */
function limitProfile(profile: string): string {
  const chars = [...profile];
  if (chars.length <= PROFILE_MAX_CHARS) return profile;
  return `${chars.slice(0, PROFILE_MAX_CHARS).join('')}…`;
}

/**
 * 兜底：没有联系人。卡的主角本人不是联系人，模型失败时不要编一个
 * 主角联系人出来；空列表就是空列表，调用方下次打开会再试一次。
 */
export function fallbackContacts(_card: RPCard): PhoneContact[] {
  return [];
}

/**
 * 判断一条联系人是不是卡的主角本人：名字是卡名，或 relation 写“本人”。
 * 主角不是联系人，这样的条目不该出现在联系人列表里。
 */
function isMainCharacter(contact: { name: string; relation: string }, card: RPCard): boolean {
  const cardName = card.data.name.trim();
  if (cardName && contact.name.trim().toLowerCase() === cardName.toLowerCase()) return true;
  return contact.relation.trim() === '本人';
}

/**
 * 缓存有没有可用的联系人列表：非空数组就是可用，原样用——不管它是
 * 不是旧逻辑存的（里面还留着卡的主角本人、relation 还是按主角算的
 * v1 旧关系、开场白还是卡的 first_mes 原文），都绝不因为“旧”就丢掉
 * 重算。小手机的数据一旦初始化就定下来，只有用户点“重置”才能重新
 * 初始化；想用新规则的旧聊天，点重置走一遍新的初始化。
 *
 * 空列表、null、读出来的不是数组（缓存损坏），都算没缓存——调用方
 * 这时才调一次模型初始化（首次打开的重试，不是重算已有数据）。
 */
export function hasUsableCache(cached: unknown): cached is PhoneContact[] {
  return Array.isArray(cached) && cached.length > 0;
}

/** 从模型返回的文本里抠出 JSON 数组（允许 ```json 代码块包裹）。 */
function extractJsonArray(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 解析模型返回的联系人 JSON。返回 null 表示根本没法解析（调用方走兜底）；
 * 数组解析出来但没有别人时，返回空数组（不编联系人）。
 *
 * 卡的主角本人不是联系人：模型返回里名字是卡名、或 relation 写“本人”
 * 的条目都跳过（代码在这里拦，模型给不给都拦得住）。其他人按名字去重。
 * 每个人的人设（profile）也存下来：性格、长相、关键特点，一两句；
 * 模型没给人设时这个字段不写，回复提示词里就不写这一节。
 *
 * relation 是和 User 的关系（从 User 的角度，比如 闺蜜/哥哥）；和主角的
 * 关系写进 relationToMain，各存各的，不要混在一起。卡里没写这个人和
 * User 的关系时 relation 是空字符串——不要编一个出来补默认值。
 * 新解析的联系人一律写 v: 2（relation 是和 User 的关系）。
 *
 * 重新初始化时，名字和以前缓存里的联系人对得上的，沿用以前的 id——
 * 微信记录是按联系人 id 存的，id 不变，聊过的记录才不会丢（主角的
 * 旧 id 不会被沿用，因为主角根本不在新列表里）。
 */
export function parseContactsJson(
  text: string,
  card: RPCard,
  previous?: PhoneContact[],
): PhoneContact[] | null {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return null;
  const seen = new Set<string>();
  const contacts: PhoneContact[] = [];
  // 以前缓存里的联系人（按名字找）：重新初始化时沿用 id，微信记录不断档。
  const previousByName = new Map<string, PhoneContact>();
  for (const p of previous ?? []) {
    const key = p.name.trim().toLowerCase();
    if (key && !previousByName.has(key)) previousByName.set(key, p);
  }
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    const relation = typeof raw.relation === 'string' ? raw.relation.trim() : '';
    // 卡的主角本人不是联系人：名字是卡名、或 relation 是“本人”，都跳过。
    if (isMainCharacter({ name, relation }, card)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const opening = typeof raw.openingMessage === 'string' ? raw.openingMessage.trim() : '';
    const profile = typeof raw.profile === 'string' ? raw.profile.trim() : '';
    // relation 是和 User 的关系；relationToMain 是和主角的关系，各存各的。
    // 和 User 的关系没写时 relation 留空字符串，不要编一个“朋友”出来。
    const relationToMain =
      typeof raw.relationToMain === 'string' ? raw.relationToMain.trim() : '';
    contacts.push({
      id: previousByName.get(key)?.id ?? `c_${uid()}`,
      name,
      relation,
      ...(relationToMain ? { relationToMain } : {}),
      openingMessage: opening ? limitOpening(opening, name) : `你好，我是${name}。`,
      ...(profile ? { profile: limitProfile(profile) } : {}),
      gender: parseGender(raw.gender),
      // 新联系人好感度从 0 开始（重新初始化也是从头认识，从 0 算）。
      affection: 0,
      v: 2,
    });
    if (contacts.length >= MAX_CONTACTS) break;
  }
  return contacts;
}

/** 初始化读主聊天的多少条消息：最近 30 条，够认出对话里出现过的人。 */
export const INIT_CHAT_WINDOW = 30;
/** 聊天记录里单条消息最多留多少字（和剧情进度一个压法，免得提示词被撑爆）。 */
const INIT_CHAT_MESSAGE_MAX_CHARS = 200;

/**
 * 把主聊天的消息压成一段对话记录，交给初始化的模型认人。
 *
 * 只留最近 INIT_CHAT_WINDOW 条：系统消息、隐藏消息、开场白（问候）和
 * 空消息都不要；每条超过 200 字就截断；谁说的写清楚：用户还是主角。
 * 主线还没聊起来（空的、或者只有开场白）就返回空字符串，调用方在
 * 提示词里明说没有对话、不要编人。
 */
export function formatChatTranscript(messages: RPChatMessage[], characterName: string): string {
  const usable = messages.filter(
    (m) => m.role !== 'system' && !m.hidden && !m.isGreeting && m.content.trim().length > 0,
  );
  const recent = usable.slice(-INIT_CHAT_WINDOW);
  if (recent.length === 0) return '';
  return recent
    .map((m) => {
      const who = m.role === 'assistant' ? characterName : '用户';
      const chars = [...m.content.trim()];
      const content =
        chars.length > INIT_CHAT_MESSAGE_MAX_CHARS
          ? `${chars.slice(0, INIT_CHAT_MESSAGE_MAX_CHARS).join('')}…`
          : chars.join('');
      return `${who}：${content}`;
    })
    .join('\n');
}

/**
 * 初始化用的消息：把主聊天的对话记录交给模型去找人。
 *
 * 联系人从主聊天里来：模型只看下面这段对话记录，找出在对话里出现过的
 * 其他人物——人设、关系、开场白都按聊天里写到的来，聊天里没写到的不要
 * 编。卡的介绍、性格、场景、开场白、示例对话一律不交给模型；世界书也
 * 一律不读（只在世界书里出现、还没在主聊天里露过面的人，不进联系人）。
 *
 * 卡只借一个名字：主角名（card.data.name），只用来排除主角本人——
 * 提示词里写明不要把主角算进去，解析时（parseContactsJson）也拦一道。
 *
 * User 的身份（user 参数）就是主聊天里 {{user}} 的那个人——聊天的
 * persona。模型得先知道 User 是谁，才能把每个联系人的关系按 User
 * 算对；不然它只能按主角算，关系就搞不清了。没有单独定义 User 身份
 * 时（user 没传），提示词里明说，而不是让模型猜。
 */
export function buildInitMessages(
  card: RPCard,
  chatMessages: RPChatMessage[] = [],
  user?: PhoneUserIdentity,
): LLMMessage[] {
  const transcript = formatChatTranscript(chatMessages, card.data.name);
  const userText = [
    '以下是主聊天的对话记录（按时间顺序，最近 30 条）：',
    transcript.trim() ? transcript.trim() : '（主聊天里还没有对话，除了开场白之外没有可以找的人。）',
    '',
    `主角的名字是「${card.data.name}」——主角本人不是联系人，不要把主角算进去。`,
    // User 是谁：关系要按 User 来算，模型得先知道 User 在这个故事里是谁。
    user
      ? `User（在微信里和联系人聊天的那个人）在这个故事里的身份：名字是「${user.name}」${user.description.trim() ? `，介绍：${user.description.trim()}` : ''}。`
      : '本聊天没有单独定义 User 的身份（User 就是和主角聊天的人，没有另外的名字/人设）。',
    '',
    '请从上面的对话记录里找出在对话中出现过的其他人物（不要把卡的主角本人算进去），返回一个 JSON 数组。每个元素有六个字段：',
    '{"name": "名字", "relation": "和 User 的关系，从 User 的角度写，比如 闺蜜/哥哥/室友/同事", "relationToMain": "和主角的关系，比如 闺蜜/哥哥", "openingMessage": "这个人第一次在微信上发来的消息", "gender": "这个人的性别，按对话里的表现判断：female 女 / male 男 / unknown 不知道", "profile": "这个人的人设（一两句）：性格、长相、关键特点，按对话里写到的来，没写到的不要编，没提到的写空字符串"}。',
    'relation 是和 User 的关系，不是和主角的关系——不要把和主角的关系写进 relation 里；和主角的关系写进 relationToMain。',
    '对话里写了这个人和 User 是什么关系，relation 就写什么；没写不要编，relation 写空字符串，relationToMain 写他/她和主角的关系。',
    '找人的时候，只看上面的对话记录：对话里提到的人才算，只在别处（比如世界书、角色卡）出现、对话里没露过面的人不要放进来；',
    '主角本人不是联系人，不要把主角的名字、不要把 relation 写成“本人”的条目放进来；如果对话里除了主角没有出现过其他人，只返回空数组 []。',
    '写每条 openingMessage 之前，先想一想：这个人是谁、性格怎么样、和 User 是什么关系、和主角是什么关系、对话里发生了什么；想清楚了再写。',
    'openingMessage 的要求：要像真人发微信，口语化、简短（1–2 句，最多 40 字），结合对话里的剧情跟对方打招呼或找对方；写的时候要保持在角色里，绝不跳出角色（不要 OOC），绝不提自己是 AI 或模型；绝不能照抄卡的开场白原文，不能带 *动作描写*，不能写成一大段角色扮演描写。',
    '每个人的 profile 也要写：性格、长相、关键特点，一两句就够，按对话里写到的来，没写到的不要编、不要脑补；对话里对这个人只字没提的，profile 写空字符串。',
  ].join('\n');
  return [
    {
      role: 'system',
      content: '你是一个角色卡解析助手。只返回 JSON，不要解释、不要加多余文字。',
    },
    {
      role: 'user',
      content: userText,
    },
  ];
}

/**
 * 调一次模型，从主聊天的对话记录里找出出现过的人物。解析失败返回
 * null（调用方走兜底）。30 秒超时，避免初始化一直转圈。
 *
 * chatMessages 是主聊天的消息（调用方用 currentMessages 从 store 现取，
 * 最近 30 条）：初始化只读这些消息，不读世界书、不读卡的字段——只在
 * 世界书里出现、还没在主聊天里露过面的人，不会进联系人列表。
 *
 * user 是这个聊天的 User 身份（resolvePhoneUser 从聊天的 persona
 * 算出来）：初始化要告诉模型 User 是谁，联系人的 relation 才能按
 * User 来算；没传时提示词里明说没有单独定义 User 的身份。
 */
export async function initContacts(
  card: RPCard,
  llm: LLMService,
  connectionId: string,
  model: string,
  chatMessages: RPChatMessage[] = [],
  user?: PhoneUserIdentity,
): Promise<PhoneContact[] | null> {
  const result = await llm.complete(connectionId, {
    model,
    messages: buildInitMessages(card, chatMessages, user),
    temperature: 0.3,
    maxTokens: 800,
    signal: AbortSignal.timeout(30_000),
  });
  return parseContactsJson(result.text, card);
}
