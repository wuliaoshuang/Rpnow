/**
 * 群聊的存取（IndexedDB）与世界书同步。
 *
 * 存取：
 *   - 群列表：按聊天存，`rpnow:phone:groups:<chatId>`，一个聊天一份。
 *     打开手机就读缓存、关掉重开还在；老聊天第一次打开是空的（没有
 *     群，没有重新初始化这回事——PR #46 严格持久化的规矩）。
 *   - 群聊记录：按群存，`rpnow:phone:groupchat:<groupId>`，和一对一
 *     同一个消息形状（群里每条 assistant 消息带 characterName）。
 *   - “重置”（clearPhoneChat）会连群列表和群聊记录一起清掉
 *     （见 clearPhoneGroups），群从空开始。
 *
 * 世界书同步（写进哪本、怎么读，在这里定）：
 *   每个聊天有一本专属的用户世界书“小手机·群聊”
 *   （id `phone-groups:<chatId>`），第一次同步时建出来，并挂到这个
 *   聊天的 lorebookIds 上——这样主聊天的提示词流水线和 PR #42 小手机
 *   的 selectLorebookText（都按 chat.lorebookIds 取书）都能读到它，
 *   和插件“共享世界书绑到聊天上”的做法一样，也和朋友圈那本
 *   （momentsStore.ts）同款。条目是常驻（constant）的，名字是
 *   “{群名}的群聊记录”，关键词是群名 + 全部成员名，内容只留最近
 *   40 行（groups.ts 里拼）；群解散时删掉它的条目。
 */
import { idbStorage } from '@/core/storage/index.js';
import type { StorageService } from '@/core/agent/types.js';
import type { RPLorebook } from '@/core/types/lorebook.js';
import { newEntry } from '@/core/types/lorebook.js';
import type { PhoneGroup, PhoneGroupChat } from './types.js';
import {
  buildGroupChatEntryContent,
  groupChatEntryKeys,
  groupChatEntryName,
} from './groups.js';
import type { MomentsLorebookDeps } from './momentsStore.js';

function groupsKey(chatId: string): string {
  return `rpnow:phone:groups:${chatId}`;
}

function groupChatKey(groupId: string): string {
  return `rpnow:phone:groupchat:${groupId}`;
}

/** 读出指定聊天的群列表；没存过返回 null（老聊天第一次打开就是这样）。 */
export async function loadGroups(chatId: string): Promise<PhoneGroup[] | null> {
  const groups = await idbStorage.get<PhoneGroup[]>(groupsKey(chatId));
  return groups ?? null;
}

/** 保存指定聊天的群列表。 */
export async function saveGroups(chatId: string, groups: PhoneGroup[]): Promise<void> {
  await idbStorage.set(groupsKey(chatId), groups);
}

/** 删掉指定聊天的群列表（“重置”时用）。 */
export async function removeGroups(
  chatId: string,
  store: StorageService = idbStorage,
): Promise<void> {
  await store.remove(groupsKey(chatId));
}

/** 读出指定群的聊天记录；没存过返回 null。 */
export async function loadGroupChat(groupId: string): Promise<PhoneGroupChat | null> {
  const chat = await idbStorage.get<PhoneGroupChat>(groupChatKey(groupId));
  return chat ?? null;
}

/** 保存一个群的聊天记录。 */
export async function saveGroupChat(chat: PhoneGroupChat): Promise<void> {
  await idbStorage.set(groupChatKey(chat.groupId), chat);
}

/** 删掉指定群的聊天记录（群解散 / “重置”时用）。 */
export async function removeGroupChat(
  groupId: string,
  store: StorageService = idbStorage,
): Promise<void> {
  await store.remove(groupChatKey(groupId));
}

/**
 * 清空一部聊天的全部群聊记录：群列表 + 每个群的聊天记录。
 * 联系人缓存和一对一记录不在这里——那是 clearPhoneChat 管的，
 * 调用方（WeChat 的重置）两样一起调。
 */
export async function clearPhoneGroups(
  chatId: string,
  groups: PhoneGroup[],
  store: StorageService = idbStorage,
): Promise<void> {
  await removeGroups(chatId, store);
  await Promise.all(groups.map((g) => removeGroupChat(g.id, store)));
}

/** 群聊同步用的世界书名（每个聊天一本，和朋友圈那本分开）。 */
export const GROUP_CHAT_LOREBOOK_NAME = '小手机·群聊';

/** 指定聊天的群聊世界书 id。 */
export function groupChatLorebookId(chatId: string): string {
  return `phone-groups:${chatId}`;
}

function newGroupChatBook(chatId: string): RPLorebook {
  const now = Date.now();
  return {
    id: groupChatLorebookId(chatId),
    name: GROUP_CHAT_LOREBOOK_NAME,
    description: '小手机群聊同步出来的群聊记录（只同步最近的记录，不含图片）。',
    entries: [],
    source: 'user',
    createdAt: now,
    updatedAt: now,
  };
}

function upsertEntry(
  book: RPLorebook,
  name: string,
  content: string,
  keys: string[],
): void {
  const existing = book.entries.find((e) => e.comment === name);
  if (existing) {
    existing.content = content;
    existing.enabled = true;
    existing.constant = true;
    existing.keys = keys;
  } else {
    book.entries.push(
      newEntry({ comment: name, content, enabled: true, constant: true, keys }),
    );
  }
}

async function saveBookAndBind(deps: MomentsLorebookDeps, book: RPLorebook): Promise<void> {
  await deps.saveLorebook(book);
  if (!deps.chat.lorebookIds.includes(book.id)) {
    await deps.saveChat({
      ...deps.chat,
      lorebookIds: [...deps.chat.lorebookIds, book.id],
    });
  }
}

/**
 * 把一个群的聊天记录同步进世界书：条目叫“{群名}的群聊记录”，内容是
 * 最近 40 行（groups.ts 里拼）。群里一条消息都没有、书也不存在时
 * 什么都不做（不建空书）。每轮群聊回完调一次。
 */
export async function syncGroupChatToLorebook(
  chatId: string,
  group: PhoneGroup,
  memberNames: string[],
  messages: PhoneGroupChat['messages'],
  deps: MomentsLorebookDeps,
): Promise<void> {
  const content = buildGroupChatEntryContent(group.name, memberNames, messages);
  const bookId = groupChatLorebookId(chatId);
  const book = deps.lorebooks.find((b) => b.id === bookId) ?? newGroupChatBook(chatId);
  const isNew = !deps.lorebooks.some((b) => b.id === bookId);
  if (!content) {
    if (isNew) return;
    // 记录空了（不应该发生）：删掉旧条目，别留空条目。
    await removeGroupChatFromLorebook(chatId, group.name, deps);
    return;
  }
  upsertEntry(
    book,
    groupChatEntryName(group.name),
    content,
    groupChatEntryKeys(group.name, memberNames),
  );
  await saveBookAndBind(deps, book);
}

/**
 * 群解散时删掉世界书里它的群聊记录条目（书里没这个条目时什么都不做）。
 * 书里一条条目都不剩时，书本身留着（朋友圈那本同款做法：空书不删）。
 */
export async function removeGroupChatFromLorebook(
  chatId: string,
  groupName: string,
  deps: MomentsLorebookDeps,
): Promise<void> {
  const bookId = groupChatLorebookId(chatId);
  const book = deps.lorebooks.find((b) => b.id === bookId);
  if (!book) return;
  const entryName = groupChatEntryName(groupName);
  const before = book.entries.length;
  book.entries = book.entries.filter((e) => e.comment !== entryName);
  if (book.entries.length === before) return;
  await deps.saveLorebook(book);
}
