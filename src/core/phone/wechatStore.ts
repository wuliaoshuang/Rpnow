/**
 * 微信聊天记录与联系人的存取（IndexedDB，idbStorage）。
 *
 *   - 联系人：按聊天存，`rpnow:phone:contacts:<chatId>`，AI 初始化一次后缓存。
 *   - 聊天记录：按联系人存，`rpnow:phone:wechat:<contactId>`；主角的
 *     contactId 就是卡 id，所以以前存的记录不断档。
 */
import { idbStorage } from '@/core/storage/index.js';
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
