/**
 * 小手机预设的世界书同步（每个聊天一本）。
 *
 * 每个聊天有一本专属的用户世界书“小手机·预设”
 * （id `phone-preset:<chatId>`），里面只有一条常驻条目“小手机数据预设”，
 * 内容就是 buildPhonePresetText（phoneData.ts）拼出来的指令：让主聊天
 * 的模型每轮回复后在正文末尾追加隐藏数据块。第一次打开某聊天的小手机
 * 时建出来，并挂到这个聊天的 lorebookIds 上——这样主聊天的提示词流水线
 * （runActivation + buildPrompt）每次都会读到它；手机没打开过的聊天不建
 * 书、什么都不变。
 *
 * 条目位置是关键：`position: atDepth, depth: 1, role: 2`（system）——
 * 组装成一条 system 消息，紧贴在最新一条用户消息之前，也就是离生成
 * 最近的地方（buildPrompt 的 depthIndex 是这么算的，见 phoneData.test.ts
 * 里的 activate + buildPrompt 集成测试）。常驻（constant）所以不用 key
 * 匹配，每轮都生效。
 *
 * 建书/绑定的做法和朋友圈那本（momentsStore.ts）、群聊那本（groupStore.ts）
 * 同款：saveLorebook，再把书 id 追加到 chat.lorebookIds 上。打开手机时
 * 每次都调一次 ensurePhonePresetBook：书/条目已经存在就只更新条目内容
 * （主角名可能换了卡），幂等，不会重复建书、不会重复绑。
 *
 * 注意：这本书只给主聊天读。小手机自己的回复提示词不读它——
 * getPhoneBooks（lorebook.ts）会把 `phone-preset:` 开头的书排除掉，
 * 否则指令会进微信回复的提示词，而微信气泡是纯文本渲染，模型一旦真的
 * 在微信里输出隐藏数据块，就会原文显示出来。
 */
import { WI_POSITION } from '@/core/types/card.js';
import type { RPLorebook } from '@/core/types/lorebook.js';
import { newEntry } from '@/core/types/lorebook.js';
import type { MomentsLorebookDeps } from './momentsStore.js';
import {
  PHONE_PRESET_BOOK_ID_PREFIX,
  buildPhonePresetText,
} from './phoneData.js';

/** 小手机预设同步用的世界书名（每个聊天一本）。 */
export const PHONE_PRESET_LOREBOOK_NAME = '小手机·预设';

/** 指定聊天的小手机预设世界书 id。 */
export function phonePresetLorebookId(chatId: string): string {
  return `${PHONE_PRESET_BOOK_ID_PREFIX}${chatId}`;
}

/** 预设书里那条唯一条目的名字。 */
export const PHONE_PRESET_ENTRY_NAME = '小手机数据预设';

function newPhonePresetBook(chatId: string): RPLorebook {
  const now = Date.now();
  return {
    id: phonePresetLorebookId(chatId),
    name: PHONE_PRESET_LOREBOOK_NAME,
    description: '小手机的内置预设：让主聊天在每轮回复后输出隐藏数据块，小手机读它来认人。',
    entries: [],
    source: 'user',
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 把预设条目写进书里（有就更新内容和位置，没有就新建）。
 * 位置每次都重写一遍：万一以前存的是旧位置，也能纠回来。
 */
function upsertPresetEntry(book: RPLorebook, charName: string): void {
  const content = buildPhonePresetText(charName);
  const existing = book.entries.find((e) => e.comment === PHONE_PRESET_ENTRY_NAME);
  if (existing) {
    existing.content = content;
    existing.enabled = true;
    existing.constant = true;
    existing.position = WI_POSITION.atDepth;
    existing.depth = 1;
    existing.role = 2;
    existing.probability = 100;
  } else {
    book.entries.push(
      newEntry({
        comment: PHONE_PRESET_ENTRY_NAME,
        content,
        enabled: true,
        constant: true,
        keys: [],
        position: WI_POSITION.atDepth,
        depth: 1,
        role: 2,
        probability: 100,
      }),
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
 * 确保某聊天的小手机预设书存在、条目内容是最新的、书已绑到聊天上。
 * 打开小手机时调一次（WeChat 的联系人加载 effect 里）；幂等。
 */
export async function ensurePhonePresetBook(
  chatId: string,
  charName: string,
  deps: MomentsLorebookDeps,
): Promise<void> {
  const bookId = phonePresetLorebookId(chatId);
  const book = deps.lorebooks.find((b) => b.id === bookId) ?? newPhonePresetBook(chatId);
  upsertPresetEntry(book, charName);
  await saveBookAndBind(deps, book);
}
