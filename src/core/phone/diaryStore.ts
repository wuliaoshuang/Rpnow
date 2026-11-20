/**
 * 日记的存取（IndexedDB）。
 *
 *   - 日记：按聊天存，`rpnow:phone:diary:<chatId>`，一个聊天一份，最新在前。
 *     打开手机就读缓存、关掉重开还在；老聊天第一次打开是空的（没有重新
 *     初始化这回事——日记只在用户写或让角色写时才产生，PR #46 严格持久化
 *     的规矩：缓存是权威的）。
 *   - “重置”（clearPhoneChat）会连日记一起清掉：日记属于这个聊天的手机，
 *     清掉之后从空开始。
 */
import { idbStorage } from '@/core/storage/index.js';
import type { StorageService } from '@/core/agent/types.js';
import type { DiaryEntry } from './types.js';

function diaryKey(chatId: string): string {
  return `rpnow:phone:diary:${chatId}`;
}

/** 读出指定聊天的日记（最新在前）；没存过返回 null。 */
export async function loadDiary(chatId: string): Promise<DiaryEntry[] | null> {
  const entries = await idbStorage.get<DiaryEntry[]>(diaryKey(chatId));
  return entries ?? null;
}

/** 保存指定聊天的全部日记（最新在前）。 */
export async function saveDiary(chatId: string, entries: DiaryEntry[]): Promise<void> {
  await idbStorage.set(diaryKey(chatId), entries);
}

/** 删掉指定聊天的日记（“重置”时用）。 */
export async function removeDiary(
  chatId: string,
  store: StorageService = idbStorage,
): Promise<void> {
  await store.remove(diaryKey(chatId));
}
