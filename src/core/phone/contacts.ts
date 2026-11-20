/**
 * 联系人 — 小手机的联系人只从主聊天回复里的隐藏数据块里来。
 *
 * 联系人是从主聊天里产生的人物，不是卡的主角本人。数据来源只有一条：
 * 主聊天的模型每轮回复后在正文末尾追加的隐藏数据块（HTML 注释，
 * 见 `@/core/phone/phoneData.js`），手机扫到块就把里面的人合并进联系人
 * 列表、把里面的新消息贴进对应联系人的微信记录。手机自己不调模型认人。
 *
 * 旧的初始化（PR #53：第一次打开时读主聊天的最近 30 条消息、调一次模型
 * 找出出现过的人物）已经删掉：initContacts / buildInitMessages /
 * formatChatTranscript / parseContactsJson / INIT_CHAT_WINDOW 都不在了。
 * 所以第一次打开一部聊天的小手机时，联系人列表是空的——主聊天产出隐藏
 * 数据块后才慢慢填进来；主聊天里还没聊出数据块，手机里就没有联系人，
 * 这是新逻辑下正确的样子，不是 bug，不要为了凑数去读世界书或卡补人。
 * 点“重置”清掉联系人缓存和微信记录后，也是等主聊天后续产出新的数据块
 * 再填回来（已经扫过的数据块不会重扫，见 WeChat.tsx 的水位线）。
 *
 * 初始化只从主聊天之外借两样东西，都是为了把关系算对、把主角排除，
 * 不是用来找人的：
 *   - 卡的主角名（card.data.name）：只用来排除主角本人；
 *   - User 的身份（resolvePhoneUser，聊天的 persona）：只用来把每个
 *     联系人的 relation 按 User 来算。
 * 卡的介绍、性格、场景、开场白、示例对话一律不读；世界书一律不读。
 *
 * 每个联系人的 relation 是和 User（在微信里和他/她聊天的那个人）的关系，
 * 不是和主角的关系；聊天里没写这个人和 User 的关系时不要编，relation
 * 留空，和主角的关系写进 relationToMain。回复提示词里按 relation 写
 * （“是用户的闺蜜”），模型才知道该怎么对 User。
 *
 * 每个联系人除了名字、关系、开场白，还带一条自己的人设（profile：性格、
 * 长相、关键特点，一两句，按聊天里写到的来，没写的不要编），回复时写进
 * 这个联系人自己的 system prompt，模型扮演他/她才不会 OOC。开场白也是
 * 按聊天里这个人的说话口吻写的短消息，不照抄卡的 first_mes。
 *
 * 联系人列表按聊天缓存进 IndexedDB，之后直接读缓存，不再重复认人。
 * 缓存是权威的：有缓存就原样用；只有用户点“重置”才能清掉它。
 */
import type { RPCard } from '@/core/types/card.js';
import type { RPPersona } from '@/core/types/chat.js';
import type { PhoneContact } from './types.js';

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
  const m = flat.match(/^[^。！？!?]*[。！？!?][」』”’"'）】]?/);
  let first = (m ? m[0] : flat).trim();
  if (!first) return fallback;
  if (first.length > 60) first = `${first.slice(0, 60)}…`;
  return first;
}

/**
 * 兜底：没有联系人。卡的主角本人不是联系人，模型失败时不要编一个
 * 主角联系人出来；空列表就是空列表，等主聊天产出隐藏数据块再填进来。
 */
export function fallbackContacts(_card: RPCard): PhoneContact[] {
  return [];
}

/**
 * 缓存有没有可用的联系人列表：非空数组就是可用，原样用——不管它是
 * 不是旧逻辑存的（里面还留着卡的主角本人、relation 还是按主角算的
 * v1 旧关系、开场白还是卡的 first_mes 原文），都绝不因为“旧”就丢掉
 * 重算。小手机的数据一旦存下来就定下来，只有用户点“重置”才能清掉。
 *
 * 空列表、null、读出来的不是数组（缓存损坏），都算没缓存——调用方
 * 这时给空列表（不再调模型初始化：联系人只从隐藏数据块里来，
 * 等主聊天产出数据块、扫描 effect 再填进来）。
 */
export function hasUsableCache(cached: unknown): cached is PhoneContact[] {
  return Array.isArray(cached) && cached.length > 0;
}
