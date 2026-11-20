/**
 * 微信聊天记录的存取 — 每个角色卡一个会话，存在 IndexedDB（idbStorage）。
 */
import { idbStorage } from '@/core/storage/index.js';
import { uid } from '@/lib/utils.js';
import type { RPCard } from '@/core/types/card.js';
import type { PhoneMessage, WeChatChat } from './types.js';

function storageKey(cardId: string): string {
  return `rpnow:phone:wechat:${cardId}`;
}

/** 读出指定角色卡的微信聊天记录；没存过返回 null。 */
export async function loadWeChatChat(cardId: string): Promise<WeChatChat | null> {
  const chat = await idbStorage.get<WeChatChat>(storageKey(cardId));
  return chat ?? null;
}

/** 保存一整个微信聊天记录。 */
export async function saveWeChatChat(chat: WeChatChat): Promise<void> {
  await idbStorage.set(storageKey(chat.cardId), chat);
}

/** 开场白：优先用角色卡的第一条消息，没有就用默认问候。 */
export function greetingMessage(card: RPCard): PhoneMessage {
  return {
    id: uid('m'),
    role: 'assistant',
    type: 'text',
    content: card.data.first_mes || `你好，我是${card.data.name}。`,
    createdAt: Date.now(),
  };
}

/**
 * 取出指定角色卡的微信聊天记录；没存过（或存的记录没有消息）时，
 * 用开场白新建一个会话并存下来。
 */
export async function ensureChat(card: RPCard): Promise<WeChatChat> {
  const stored = await loadWeChatChat(card.id);
  if (stored && stored.messages.length > 0) return stored;
  const chat: WeChatChat = {
    cardId: card.id,
    messages: [greetingMessage(card)],
    updatedAt: Date.now(),
  };
  await saveWeChatChat(chat);
  return chat;
}
