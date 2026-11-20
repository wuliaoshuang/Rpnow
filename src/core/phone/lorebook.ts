/**
 * 小手机共享角色卡的世界书 — 纯函数，好测。
 *
 * 主聊天有一条可检视的提示词流水线（core/prompt/builder.ts + features/chat/
 * orchestrator.ts）：预设是骨架，卡是内容，世界书是按位置插入的补充，
 * 激活靠 lorebook/engine.ts 的 activate()——按最近消息和卡字段匹配条目
 * 的 key，常驻条目（constant）一直生效，递归、分组、粘性/冷却按回合记。
 * 小手机复用同一套选择逻辑，不自己另写一套匹配：
 *
 *   - 回复提示词里的世界书：走 activate()，按最近的微信对话 + 主线聊天
 *     最近消息 + 卡字段匹配，命中的条目才进提示词（和主聊天一样的
 *     相关性选择）。不传 snapshot——小手机不持久化激活状态（粘性/冷却
 *     是主聊天的回合状态），每次回复都重新算一遍，简单且可预测。
 *   - 联系人初始化不读世界书：联系人从主聊天的对话记录里来（contacts.ts
 *     的 buildInitMessages），只在世界书里出现、还没在主聊天里露过面的
 *     人，不进联系人列表。回复提示词里的世界书一节不受影响，还是每次
 *     回复按 activate() 现算。
 *
 * 预算：回复提示词里的世界书最多 2000 字——世界书再大也不会把提示词撑爆。
 */
import { activate } from '@/core/lorebook/engine.js';
import type { LorebookDefaults, RPLorebook } from '@/core/types/lorebook.js';
import { fromCardEntry } from '@/core/types/lorebook.js';
import type { RPCard } from '@/core/types/card.js';
import { substituteMacros } from '@/core/prompt/macros.js';
import { PHONE_PRESET_BOOK_ID_PREFIX } from './phoneData.js';

/** 回复提示词里世界书一节最多占多少字。 */
export const LOREBOOK_REPLY_BUDGET_CHARS = 2000;

/** 小手机用到的聊天字段：只读世界书选择需要的三个。 */
export interface PhoneLorebookChat {
  id: string;
  lorebookIds: string[];
  useCardLorebook: boolean;
}

/** 把卡内嵌的 character_book 转成一条角色范围的世界书（和主聊天同一做法）。 */
export function cardBookToLorebook(card: RPCard): RPLorebook | null {
  const book = card.data.character_book;
  if (!book?.entries?.length) return null;
  return {
    id: `cardbook:${card.id}`,
    name: book.name || `${card.data.name}的角色书`,
    description: book.description,
    entries: book.entries.map((e, i) => fromCardEntry(e, i)),
    scanDepth: book.scan_depth ?? null,
    tokenBudget: book.token_budget ?? null,
    recursiveScanning: book.recursive_scanning ?? true,
    source: 'character',
    cardId: card.id,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * 小手机的世界书集合：卡的角色书在先（角色范围优先，和主聊天一致），
 * 再接该聊天选中的用户世界书（按 chat.lorebookIds 的顺序）。
 *
 * 小手机预设书（`phone-preset:<chatId>`）不算进来：它是给主聊天读的
 * 指令，不是世界知识；微信气泡是纯文本渲染，指令一旦进了微信回复的
 * 提示词，模型在微信里输出的隐藏数据块就会原文显示出来。
 */
export function getPhoneBooks(
  card: RPCard,
  chat: PhoneLorebookChat,
  userBooks: RPLorebook[],
): RPLorebook[] {
  const books: RPLorebook[] = [];
  if (chat.useCardLorebook) {
    const cb = cardBookToLorebook(card);
    if (cb) books.push(cb);
  }
  for (const id of chat.lorebookIds) {
    if (id.startsWith(PHONE_PRESET_BOOK_ID_PREFIX)) continue;
    const b = userBooks.find((x) => x.id === id);
    if (b) books.push(b);
  }
  return books;
}

/** 截断到预算字数（按字符数算，中文一个字算一个），超了加“…”收尾。 */
function truncateToBudget(text: string, budgetChars: number): string {
  const chars = [...text];
  if (chars.length <= budgetChars) return text;
  return `${chars.slice(0, budgetChars).join('')}…`;
}

/**
 * 回复提示词用的世界书文本：走主聊天同一套 activate() 选择。
 *
 * messages 是拿来匹配 key 的文本（最近的微信对话 + 主线聊天最近消息，
 * 按时间顺序，越新的越靠后）；cardFields 是卡里总被扫描的字段。
 * 命中的条目按激活顺序拼成一段，超预算截断；没命中返回 ''。
 */
export function selectLorebookText(
  card: RPCard,
  chat: PhoneLorebookChat,
  userBooks: RPLorebook[],
  defaults: LorebookDefaults,
  messages: Array<{ role: string; content: string }>,
  budgetChars: number = LOREBOOK_REPLY_BUDGET_CHARS,
): string {
  const books = getPhoneBooks(card, chat, userBooks);
  if (books.length === 0) return '';
  const charName = card.data.name || '角色';
  const result = activate({
    books,
    messages,
    defaults,
    cardFields: {
      description: card.data.description,
      personality: card.data.personality,
      scenario: card.data.scenario,
      creatorNotes: card.data.creator_notes,
      depthPrompt: String(
        (card.data.extensions?.depth_prompt as { prompt?: string } | undefined)?.prompt ?? '',
      ),
    },
    seed: hashString(chat.id),
    macros: (text) =>
      substituteMacros(text, {
        char: charName,
        user: 'User',
        charIfNotGroup: charName,
      }),
  });
  const text = result.activated
    .map((e) => e.content.trim())
    .filter(Boolean)
    .join('\n');
  if (!text) return '';
  return truncateToBudget(text, budgetChars);
}

/** 和主聊天一样的确定性种子（chat.id 的 FNV-1a 哈希）。 */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
