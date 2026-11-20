/**
 * 微信群聊 — 纯函数，好测。
 *
 * 搬的是“小手机”插件 v1.8.7 里群聊那套逻辑，用 Rpnow 的办法重新写
 * 了一遍（没抄插件的代码）：
 *
 *   - 建群：从联系人里多选成员、起个群名（同名不让建）；群头像是前
 *     4 位成员名字的首字 2×2 拼起来 + 一个“群”字角标；User 不在成员
 *     列表里。
 *   - 群管理：看成员、踢人（踢掉最后一个人就解散整个群、删掉记录）、
 *     从联系人里加人。
 *   - 谁回（关键逻辑，插件同款思路）：先看用户这句是冲谁说的——
 *     点名提到的人先回；再看有没有 0–2 个人附和；一轮 1–3 个人回，
 *     不总让同一个人回、也不总让所有人都回；回的都是短句口语。
 *     Rpnow 里这一步是确定性规则（见 pickGroupRepliers），不用再调
 *     一次模型定人——每轮回的人已经各调一次模型了。
 *   - 记忆归属（插件同款规矩）：群聊里标注为某位成员亲身经历的事，
 *     只有那位成员自己记得；别人问起时，其他成员当作不知道，不要替
 *     别人编造。这句写进每个群回复的提示词（buildGroupNote）。
 *   - 群聊记录同步进世界书：条目叫“{群名}的群聊记录”，关键词是群名
 *     + 全部成员名（groupStore.ts 里写），这样成员在之后的一对一聊天
 *     里也能记得群里发生过的事（跨场景记忆）。
 *
 * 插件那套 Rpnow 故意没搬：插件是整个群一次模型调用、让模型按
 * `{groupchat:角色名:...}` 标记语言自己决定谁说话，没有工具调用、
 * 没有防自动生图守门。Rpnow 里每个回的成员各调一次已有的回复流程
 * （自己的 system prompt + send_image / send_sticker 工具 + PR #40
 * 守门 + Tag 转写 + 人数强制），不在提示词里求模型“只回一个人”。
 */
import { uid } from '@/lib/utils.js';
import type { PhoneContact, PhoneGroup, PhoneMessage } from './types.js';
import { formatMomentsTime } from './moments.js';

/** 建群时一个群最少几个人：一个人不叫群聊，那是一对一。 */
export const GROUP_MIN_MEMBERS = 2;

/** 一轮群聊最多几个人回（插件同款：1–3 人）。 */
export const GROUP_MAX_REPLIERS = 3;

/** 世界书里一条群聊记录最多留多少行（再多就只留最近的，条目不无限长）。 */
export const GROUP_CHAT_KEEP_LINES = 40;

/** 群头像里最多拼几个首字（2×2 格）。 */
export const GROUP_AVATAR_MAX_CHARS = 4;

// ---------- 建群 / 管群 ----------

/** 群名有没有被占：同一部聊天里群名不能重名（去首尾空格比，不区分大小写）。 */
export function isGroupNameTaken(groups: PhoneGroup[], name: string): boolean {
  const key = name.trim().toLowerCase();
  if (!key) return false;
  return groups.some((g) => g.name.trim().toLowerCase() === key);
}

/**
 * 建一个群：名字去首尾空格；成员去重、按传进来的顺序留着。
 * 名字是空的、或成员不到 GROUP_MIN_MEMBERS 个，返回 null（调用方
 * 在界面上把原因告诉用户）。
 */
export function createGroup(name: string, memberIds: string[]): PhoneGroup | null {
  const cleanName = name.trim();
  if (!cleanName) return null;
  const seen = new Set<string>();
  const members: string[] = [];
  for (const id of memberIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    members.push(id);
  }
  if (members.length < GROUP_MIN_MEMBERS) return null;
  return { id: `g_${uid()}`, name: cleanName, memberIds: members, createdAt: Date.now() };
}

/** 往群里加一个人：已经在群里就不动；返回新对象（原对象不动）。 */
export function addGroupMember(group: PhoneGroup, contactId: string): PhoneGroup {
  if (!contactId || group.memberIds.includes(contactId)) return group;
  return { ...group, memberIds: [...group.memberIds, contactId] };
}

/**
 * 把一个人移出群：返回新群；移掉最后一个人时返回 null——群解散了，
 * 调用方删掉群和它的聊天记录（还有世界书里的群聊记录条目）。
 */
export function removeGroupMember(group: PhoneGroup, contactId: string): PhoneGroup | null {
  const rest = group.memberIds.filter((id) => id !== contactId);
  if (rest.length === group.memberIds.length) return group;
  if (rest.length === 0) return null;
  return { ...group, memberIds: rest };
}

/** 群里的成员（按群里的顺序排，联系人缓存里找不到的跳过）。 */
export function groupMembers(group: PhoneGroup, contacts: PhoneContact[]): PhoneContact[] {
  const byId = new Map(contacts.map((c) => [c.id, c]));
  return group.memberIds
    .map((id) => byId.get(id))
    .filter((c): c is PhoneContact => Boolean(c));
}

/** 群头像要拼的名字：前 4 位成员的名字（插件同款 2×2 格，取首字拼）。 */
export function groupAvatarNames(group: PhoneGroup, contacts: PhoneContact[]): string[] {
  return groupMembers(group, contacts)
    .slice(0, GROUP_AVATAR_MAX_CHARS)
    .map((c) => c.name);
}

// ---------- 谁回 ----------

/** 群里@所有人的说法：用户这句冲着整个群说的，不是冲某个人。 */
const GROUP_WIDE_WORDS = ['大家', '你们', '各位', '所有人', '都在吗', '都来', '都说说'];

/** 用户这句是不是冲着整个群说的（而不是冲某个人）。 */
export function isGroupWideAddress(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  return GROUP_WIDE_WORDS.some((w) => t.includes(w));
}

/**
 * 这句话里点名提到了谁：按名字在句子里出现的位置排，最先被提到的
 * 在最前面。名字是别人的名字一部分时也会命中（比如“小雨”在“小雨姐”
 * 里）——群聊里点名本来就是口语化的，不要求词边界。
 */
export function mentionedMembers(text: string, members: PhoneContact[]): PhoneContact[] {
  const hits: Array<{ at: number; member: PhoneContact }> = [];
  for (const m of members) {
    const name = m.name.trim();
    if (!name) continue;
    const at = text.indexOf(name);
    if (at >= 0) hits.push({ at, member: m });
  }
  return hits.sort((a, b) => a.at - b.at).map((h) => h.member);
}

/**
 * 谁最近说过话：按群聊记录从新到旧扫，assistant 消息的
 * characterName 就是说话人。返回“最近说过话在前”的名字列表；
 * 从没说过话的人不在里面（调用方按“最久没说话”算）。
 */
export function spokenOrder(history: PhoneMessage[]): string[] {
  const order: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'assistant' || !m.characterName) continue;
    if (!order.includes(m.characterName)) order.push(m.characterName);
  }
  return order;
}

/**
 * 成员按“最久没说话在前”排：从没说过话的排最前（轮到他们了），
 * 刚说过话的排最后。同一档里按群里的顺序。
 */
export function leastRecentlySpokenFirst(
  members: PhoneContact[],
  history: PhoneMessage[],
): PhoneContact[] {
  const order = spokenOrder(history);
  const rank = (name: string): number => {
    const i = order.indexOf(name);
    // 从没说过话：比所有说过话的都“久”，排最前。
    return i < 0 ? -1 : order.length - i;
  };
  return [...members].sort((a, b) => {
    const d = rank(a.name) - rank(b.name);
    if (d !== 0) return d;
    return members.indexOf(a) - members.indexOf(b);
  });
}

/** 小哈希：按文本内容 + 已有的用户消息数定附和人数，不调模型。 */
function hashText(text: string): number {
  let h = 0;
  for (const ch of text) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

export interface GroupRoutingInput {
  group: PhoneGroup;
  contacts: PhoneContact[];
  /** 这个群的聊天记录（用来看谁最久没说话）。 */
  history: PhoneMessage[];
  /** 用户刚发的这句。 */
  userText: string;
}

/**
 * 决定这轮群聊谁回（插件“谁回”逻辑的确定性版本，不调模型）。
 *
 *   1. 主回的人：用户这句点名提到的人（提到多个时取句子里最先提到
 *      的那个）；没点名时，冲整个群说的（大家/你们……）和没明确对象
 *      的，都轮到最久没说话的那个成员先回；
 *   2. 附和的人：主回的人之外，再按“最久没说话在前”取 0–2 个——
 *      个数由这句话的内容 + 这一轮是第几轮（群里已有几句用户消息）
 *      的小哈希定，每轮都不一样，所以不总让同一个人回、也不总让所有
 *      人都回；
 *   3. 一轮最多 GROUP_MAX_REPLIERS（3）个人。
 *
 * 好感度只跟回的人走（见 WeChat.tsx）：用户这句 +1 只给主回的人，
 * 每个回的人回一次 +1；没回的人这轮不涨。
 */
export function pickGroupRepliers(input: GroupRoutingInput): PhoneContact[] {
  const members = groupMembers(input.group, input.contacts);
  if (members.length === 0) return [];
  const rotation = leastRecentlySpokenFirst(members, input.history);
  const mentioned = mentionedMembers(input.userText, members);
  const primary = mentioned[0] ?? rotation[0];
  const rest = rotation.filter((m) => m.id !== primary.id);
  const userRounds = input.history.filter((m) => m.role === 'user').length;
  const chimerCount = Math.min(
    (hashText(input.userText) + userRounds) % GROUP_MAX_REPLIERS,
    rest.length,
    GROUP_MAX_REPLIERS - 1,
  );
  return [primary, ...rest.slice(0, chimerCount)];
}

// ---------- 群回复的提示词注脚 ----------

/**
 * 群回复 system prompt 里加的一小段（拼进“独立系统”那一节，不另起
 * 一节——提示词查看器还是 14 节）：
 * 你在哪个群里、和谁一起聊；群里说的话大家都看得到，轮到你时再回；
 * 记忆归属——群聊里标注为某位成员亲身经历的事，只有那位成员自己
 * 记得，别人问起时当作不知道、不要替别人编造（插件同款规矩）。
 */
export function buildGroupNote(
  groupName: string,
  memberNames: string[],
  selfName: string,
): string {
  const others = memberNames.filter((n) => n !== selfName);
  return [
    `你在群聊「${groupName}」里${others.length > 0 ? `，和${others.join('、')}一起` : ''}和用户聊天。群里说的话大家都看得到；轮到你回的时候再回，没轮到你的时候不要抢话。`,
    '记忆归属：群聊里标注为某位成员亲身经历的事，只有那位成员自己记得；别人问起你时，如果那是别的成员的经历，你就当作不知道，不要替别人编造。',
  ].join('\n');
}

// ---------- 世界书同步 ----------

/** 世界书里群聊记录条目的名字（插件同款命名）。 */
export function groupChatEntryName(groupName: string): string {
  return `${groupName}的群聊记录`;
}

/** 世界书里群聊记录条目的关键词：群名 + 全部成员名。 */
export function groupChatEntryKeys(groupName: string, memberNames: string[]): string[] {
  return [groupName, ...memberNames.filter(Boolean)];
}

/** 群聊记录里一行：`[时间] 说话人：内容`；图片/表情包换成占位文字。 */
export function formatGroupChatLine(m: PhoneMessage): string {
  const who = m.role === 'user' ? '用户' : (m.characterName ?? '成员');
  const content =
    m.type === 'text' ? m.content : m.type === 'image' ? '[图片]' : '[表情]';
  return `[${formatMomentsTime(m.createdAt)}] ${who}：${content}`;
}

/**
 * “{群名}的群聊记录”条目的整段内容：头 + 最近 GROUP_CHAT_KEEP_LINES 行。
 * 只留最近的——群聊聊得再长，条目也不会无限长（朋友圈同步同款节流）。
 * 群里一条消息都没有时返回 ''（调用方不建这个条目）。
 */
export function buildGroupChatEntryContent(
  groupName: string,
  memberNames: string[],
  messages: PhoneMessage[],
): string {
  const lines = messages
    // 空文字不要；图片和表情包本身没有文字内容，但要留一行占位。
    .filter((m) => m.role !== 'system' && (m.type !== 'text' || m.content.trim() !== ''))
    .slice(-GROUP_CHAT_KEEP_LINES)
    .map(formatGroupChatLine);
  if (lines.length === 0) return '';
  return [
    `以下是群聊「${groupName}」的群聊记录（成员：${memberNames.join('、')}），按时间先后排列。`,
    '标注为某位成员亲身经历的事，只有那位成员自己记得；其他成员不知道，不要替别人编造。',
    ...lines,
  ].join('\n');
}
