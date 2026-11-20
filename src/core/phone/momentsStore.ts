/**
 * 朋友圈的存取（IndexedDB）与世界书同步。
 *
 * 存取：
 *   - 动态：按聊天存，`rpnow:phone:moments:<chatId>`，一个聊天一份。
 *     打开手机就读缓存、关掉重开还在；老聊天第一次打开是空的（没有
 *     重新初始化这回事——动态只在用户点“发朋友圈”时才生成，PR #46
 *     严格持久化的规矩：缓存是权威的）。
 *   - “重置”（clearPhoneChat）会连朋友圈一起清掉：朋友圈属于这个聊天
 *     的手机，清掉之后重新初始化联系人，朋友圈从空开始。
 *
 * 世界书同步（写进哪本、怎么读，在这里定）：
 *   每个聊天有一本专属的用户世界书“小手机·朋友圈”
 *   （id `phone-moments:<chatId>`），第一次同步时建出来，并挂到这个
 *   聊天的 lorebookIds 上——这样主聊天的提示词流水线和 PR #42 小手机
 *   的 selectLorebookText（都按 chat.lorebookIds 取书）都能读到它，
 *   和插件“共享世界书绑到聊天上”的做法一样。条目是常驻（constant）
 *   的，内容只有简介行和互动行（moments.ts 里拼），全文、图片、评论
 *   不进世界书。
 */
import { idbStorage } from '@/core/storage/index.js';
import type { StorageService } from '@/core/agent/types.js';
import type { RPChat } from '@/core/types/chat.js';
import type { RPLorebook } from '@/core/types/lorebook.js';
import { newEntry } from '@/core/types/lorebook.js';
import type { MomentComment, MomentPost } from './types.js';
import {
  appendMomentsInteractionLine,
  buildMomentsEntryContent,
  momentsEntryName,
  momentsInteractionEntryName,
} from './moments.js';

function momentsKey(chatId: string): string {
  return `rpnow:phone:moments:${chatId}`;
}

/** 读出指定聊天的朋友圈动态（最新在前）；没存过返回 null。 */
export async function loadMoments(chatId: string): Promise<MomentPost[] | null> {
  const posts = await idbStorage.get<MomentPost[]>(momentsKey(chatId));
  return posts ?? null;
}

/** 保存指定聊天的全部朋友圈动态（最新在前）。 */
export async function saveMoments(chatId: string, posts: MomentPost[]): Promise<void> {
  await idbStorage.set(momentsKey(chatId), posts);
}

/** 删掉指定聊天的朋友圈动态（“重置”时用）。 */
export async function removeMoments(
  chatId: string,
  store: StorageService = idbStorage,
): Promise<void> {
  await store.remove(momentsKey(chatId));
}

/** 朋友圈同步用的世界书名（每个聊天一本）。 */
export const MOMENTS_LOREBOOK_NAME = '小手机·朋友圈';

/** 指定聊天的朋友圈世界书 id。 */
export function momentsLorebookId(chatId: string): string {
  return `phone-moments:${chatId}`;
}

export interface MomentsLorebookDeps {
  lorebooks: RPLorebook[];
  saveLorebook: (book: RPLorebook) => Promise<void>;
  chat: RPChat;
  saveChat: (chat: RPChat) => Promise<void>;
}

function newMomentsBook(chatId: string): RPLorebook {
  const now = Date.now();
  return {
    id: momentsLorebookId(chatId),
    name: MOMENTS_LOREBOOK_NAME,
    description: '小手机朋友圈同步出来的简介和互动记录（只同步简介，不含全文、图片和评论）。',
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
 * 把一个聊天的全部动态同步进世界书：每个有动态的角色一条
 * “{名字}的朋友圈”条目（内容只有简介行）；没动态的角色删掉他的条目。
 * 互动条目（“{名字}的朋友圈互动”）不动——那是 syncMomentsInteraction 管的。
 * 一条动态都没有、书也不存在时什么都不做（不建空书）。
 */
export async function syncMomentsToLorebook(
  chatId: string,
  posts: MomentPost[],
  deps: MomentsLorebookDeps,
): Promise<void> {
  const bookId = momentsLorebookId(chatId);
  const book = deps.lorebooks.find((b) => b.id === bookId) ?? newMomentsBook(chatId);
  const names = [...new Set(posts.map((p) => p.contactName).filter(Boolean))];
  let changed = false;
  for (const name of names) {
    const content = buildMomentsEntryContent(name, posts);
    if (!content) continue;
    upsertEntry(book, momentsEntryName(name), content, [name]);
    changed = true;
  }
  // 没动态的角色：删掉他以前的“朋友圈”条目（互动条目不动）。
  const before = book.entries.length;
  book.entries = book.entries.filter((e) => {
    if (!e.comment.endsWith('的朋友圈') || e.comment.endsWith('的朋友圈互动')) return true;
    return names.includes(e.comment.slice(0, -'的朋友圈'.length));
  });
  if (book.entries.length !== before) changed = true;
  const isNew = !deps.lorebooks.some((b) => b.id === bookId);
  if (!changed && isNew) return;
  if (book.entries.length === 0 && isNew) return;
  await saveBookAndBind(deps, book);
}

/**
 * 把一条朋友圈互动（用户评论或 AI 回复）追加进世界书：
 * “{名字}的朋友圈互动”条目里加一行 `[时间] 评论者：内容`，只留最近 60 条。
 * 互动属于发帖的那个角色（post.contactName）。
 */
export async function syncMomentsInteraction(
  chatId: string,
  post: MomentPost,
  comment: MomentComment,
  deps: MomentsLorebookDeps,
): Promise<void> {
  const name = post.contactName;
  if (!name) return;
  const bookId = momentsLorebookId(chatId);
  const book = deps.lorebooks.find((b) => b.id === bookId) ?? newMomentsBook(chatId);
  const entryName = momentsInteractionEntryName(name);
  const existing = book.entries.find((e) => e.comment === entryName);
  const content = appendMomentsInteractionLine(
    existing?.content ?? '',
    name,
    comment.author,
    comment.text,
    comment.timestamp,
  );
  upsertEntry(book, entryName, content, [name]);
  await saveBookAndBind(deps, book);
}
