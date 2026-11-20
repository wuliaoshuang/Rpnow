/**
 * 运势的存取（IndexedDB）。
 *
 *   - 运势：按聊天存，`rpnow:phone:fortune:<chatId>`，一个聊天一份，只留
 *     最新一次运势结果和最新一次塔罗抽牌（新的来了就覆盖旧的）。
 *     打开手机就读缓存、关掉重开还在；老聊天第一次打开是空的（没有重新
 *     初始化这回事——运势只在用户点“占卜”/“抽牌”时才产生，PR #46
 *     严格持久化的规矩：缓存是权威的）。
 *   - “重置”（clearPhoneChat）会连运势一起清掉：运势属于这个聊天的手机，
 *     清掉之后从空开始。
 */
import { idbStorage } from '@/core/storage/index.js';
import type { StorageService } from '@/core/agent/types.js';
import type { FortuneState } from './types.js';

function fortuneKey(chatId: string): string {
  return `rpnow:phone:fortune:${chatId}`;
}

/** 空的运势数据（运势和塔罗都还没有）。 */
export function emptyFortuneState(): FortuneState {
  return { horoscope: null, tarot: null };
}

/** 读出指定聊天的运势数据；没存过返回 null。 */
export async function loadFortune(chatId: string): Promise<FortuneState | null> {
  const state = await idbStorage.get<FortuneState>(fortuneKey(chatId));
  return state ?? null;
}

/** 保存指定聊天的运势数据。 */
export async function saveFortune(chatId: string, state: FortuneState): Promise<void> {
  await idbStorage.set(fortuneKey(chatId), state);
}

/** 删掉指定聊天的运势数据（“重置”时用）。 */
export async function removeFortune(
  chatId: string,
  store: StorageService = idbStorage,
): Promise<void> {
  await store.remove(fortuneKey(chatId));
}
