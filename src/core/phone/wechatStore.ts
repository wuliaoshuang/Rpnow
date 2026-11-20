/**
 * 微信聊天记录与联系人的存取（IndexedDB，idbStorage）。
 *
 *   - 联系人：按聊天存，`rpnow:phone:contacts:<chatId>`，AI 初始化一次后缓存。
 *   - 聊天记录：按联系人存，`rpnow:phone:wechat:<contactId>`；主角的
 *     contactId 就是卡 id，所以以前存的记录不断档。
 */
import { idbStorage } from '@/core/storage/index.js';
import type { StorageService } from '@/core/agent/types.js';
import { uid } from '@/lib/utils.js';
import type { RPCard } from '@/core/types/card.js';
import type { PhoneContact, PhoneMessage, WeChatChat } from './types.js';

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
 * 清空一部聊天的全部小手机记录：联系人缓存 + 每个联系人的微信记录。
 * 相册、主聊天、其他聊天的记录一律不动。
 */
export async function clearPhoneChat(
  chatId: string,
  contacts: PhoneContact[],
  store: StorageService = idbStorage,
): Promise<void> {
  await removeContacts(chatId, store);
  await Promise.all(contacts.map((c) => removeWeChatChat(c.id, store)));
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
 * 旧缓存迁移的纯逻辑：存过的微信记录第一条还是卡的 first_mes 原文时，
 * 把它换成重新初始化得到的新开场白；其他情况一律不动，返回 null。
 *
 * 只动第一条消息：用户发过的消息、已经聊开的记录都不会被碰。
 */
export function migrateStaleGreetingChat(
  chat: WeChatChat,
  card: RPCard,
  freshMain: PhoneContact,
): WeChatChat | null {
  const firstMes = card.data.first_mes;
  if (!firstMes) return null;
  if (chat.messages.length === 0) return null;
  if (chat.messages[0].content !== firstMes) return null;
  return {
    ...chat,
    messages: [greetingMessage(freshMain), ...chat.messages.slice(1)],
    updatedAt: Date.now(),
  };
}

/**
 * 旧缓存迁移：主角存过的微信记录第一条还是卡的 first_mes 原文时，
 * 换成重新初始化得到的新开场白。没有存过记录、或第一条已经不是
 * first_mes 原文时，什么都不做。
 */
export async function migrateStaleGreeting(
  card: RPCard,
  freshMain: PhoneContact,
): Promise<void> {
  const stored = await loadWeChatChat(card.id);
  if (!stored) return;
  const migrated = migrateStaleGreetingChat(stored, card, freshMain);
  if (migrated) await saveWeChatChat(migrated);
}

/**
 * 取出指定联系人的微信聊天记录；没存过（或存的记录没有消息）时，
 * 用它的开场白新建一个会话并存下来。
 */
export async function ensureChat(card: RPCard, contact: PhoneContact): Promise<WeChatChat> {
  const stored = await loadWeChatChat(contact.id);
  if (stored && stored.messages.length > 0) {
    // 老记录没有 contactId 字段时补上（以前只存了主角的）。
    return { ...stored, contactId: stored.contactId ?? card.id };
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
