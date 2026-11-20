/**
 * 微信聊天记录与联系人的存取（IndexedDB，idbStorage）。
 *
 *   - 联系人：按聊天存，`rpnow:phone:contacts:<chatId>`，AI 初始化一次后缓存。
 *     联系人是卡里提到的其他人物（卡的主角本人不是联系人）。
 *     缓存是权威的：一旦存下来就原样保留，打开时只读不改；只有用户点
 *     “重置”（clearPhoneChat）才会删掉它、重新初始化。
 *   - 聊天记录：按联系人存，`rpnow:phone:wechat:<contactId>`。
 *   - 朋友圈动态：按聊天存，`rpnow:phone:moments:<chatId>`（见 momentsStore）。
 *   - 群聊：群列表和群聊记录见 groupStore（`rpnow:phone:groups:<chatId>` /
 *     `rpnow:phone:groupchat:<groupId>`）。
 * “重置”（clearPhoneChat + clearPhoneGroups）会把这几样一起清掉。
 */
import { idbStorage } from '@/core/storage/index.js';
import type { StorageService } from '@/core/agent/types.js';
import { uid } from '@/lib/utils.js';
import type { RPCard } from '@/core/types/card.js';
import type { PhoneContact, PhoneMessage, WeChatChat } from './types.js';
import { removeMoments } from './momentsStore.js';

function chatKey(contactId: string): string {
  return `rpnow:phone:wechat:${contactId}`;
}

function contactsKey(chatId: string): string {
  return `rpnow:phone:contacts:${chatId}`;
}

/** 读出指定聊天的联系人列表；没初始化过返回 null。 */
export async function loadContacts(chatId: string): Promise<PhoneContact[] | null> {
  const contacts = await idbStorage.get<PhoneContact[]>(contactsKey(chatId));
  return contacts ?? null;
}

/** 保存指定聊天的联系人列表（AI 初始化的结果）。 */
export async function saveContacts(chatId: string, contacts: PhoneContact[]): Promise<void> {
  await idbStorage.set(contactsKey(chatId), contacts);
}

/** 删掉指定聊天的联系人缓存。 */
export async function removeContacts(
  chatId: string,
  store: StorageService = idbStorage,
): Promise<void> {
  await store.remove(contactsKey(chatId));
}

/** 删掉指定联系人的微信聊天记录。 */
export async function removeWeChatChat(
  contactId: string,
  store: StorageService = idbStorage,
): Promise<void> {
  await store.remove(chatKey(contactId));
}

/**
 * 清空一部聊天的全部小手机记录：联系人缓存 + 每个联系人的微信记录 +
 * 朋友圈动态。朋友圈属于这个聊天的手机，清掉之后从空开始。
 * 相册、主聊天、其他聊天的记录一律不动。
 */
export async function clearPhoneChat(
  chatId: string,
  contacts: PhoneContact[],
  store: StorageService = idbStorage,
): Promise<void> {
  await removeContacts(chatId, store);
  await Promise.all(contacts.map((c) => removeWeChatChat(c.id, store)));
  await removeMoments(chatId, store);
}

/** 读出指定联系人的微信聊天记录；没存过返回 null。 */
export async function loadWeChatChat(contactId: string): Promise<WeChatChat | null> {
  const chat = await idbStorage.get<WeChatChat>(chatKey(contactId));
  return chat ?? null;
}

/** 保存一整个微信聊天记录。 */
export async function saveWeChatChat(chat: WeChatChat): Promise<void> {
  await idbStorage.set(chatKey(chat.contactId), chat);
}

/** 某个联系人的开场消息：就是初始化时定好的那句开场白。 */
export function greetingMessage(contact: PhoneContact): PhoneMessage {
  return {
    id: uid('m'),
    role: 'assistant',
    type: 'text',
    content: contact.openingMessage,
    createdAt: Date.now(),
  };
}

/**
 * 取出指定联系人的微信聊天记录；没存过（或存的记录没有消息）时，
 * 用它的开场白新建一个会话并存下来。
 */
export async function ensureChat(card: RPCard, contact: PhoneContact): Promise<WeChatChat> {
  const stored = await loadWeChatChat(contact.id);
  if (stored && stored.messages.length > 0) {
    // 老记录没有 contactId 字段时补上（按这个联系人的 id 补）。
    return { ...stored, contactId: stored.contactId ?? contact.id };
  }
  const chat: WeChatChat = {
    cardId: card.id,
    contactId: contact.id,
    messages: [greetingMessage(contact)],
    updatedAt: Date.now(),
  };
  await saveWeChatChat(chat);
  return chat;
}
