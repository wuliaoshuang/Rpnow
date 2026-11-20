/**
 * 小手机回复提示词的 extras：剧情进度 / 世界书 / 预设。
 *
 * requestReply 和提示词查看器共用这一份计算——查看器打开时按
 * requestReply 拿数据的同一套办法现算，所以查看器里看到的，就是
 * 下一次回复真正会发出去的提示词。不多调模型，只读现成的数据。
 */
import type { RPCard } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';
import type { LorebookDefaults, RPLorebook } from '@/core/types/lorebook.js';
import type { RPCompletionPreset } from '@/core/types/preset.js';
import { currentMessages } from '@/core/branch/engine.js';
import { selectLorebookText } from './lorebook.js';
import { extractPresetPrompts } from './preset.js';
import {
  formatPlotProgress,
  type ChatHistoryEntry,
  type ReplyPromptExtras,
} from './reply.js';
import type { PhoneMessage } from './types.js';

/**
 * 把微信聊天记录换成纯文字条目（回复和生图提示词都用它）：
 * 系统消息不要；图片和表情包换成占位文字；只留最近 10 条。
 * 生图尤其需要它——没有对话场景，模型只能画一张白底人像。
 */
export function historyEntries(messages: PhoneMessage[]): ChatHistoryEntry[] {
  return messages
    .filter((m) => m.role !== 'system')
    .slice(-10)
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content:
        m.type === 'text'
          ? m.content
          : m.type === 'image'
            ? '[对方发来一张图片]'
            : '[表情]',
    }));
}

export interface ReplyExtrasInput {
  card: RPCard;
  /** 手机外面那个主聊天；没有（不应该发生）时 extras 全空。 */
  mainChat: RPChat | undefined;
  presets: RPCompletionPreset[];
  lorebooks: RPLorebook[];
  lorebookDefaults: LorebookDefaults;
  defaultPresetId?: string;
  /** 这个联系人的微信聊天记录（用来匹配世界书，也给回复当上下文）。 */
  history: PhoneMessage[];
}

/**
 * 按 requestReply 的办法算出回复提示词的 extras：
 *   剧情进度——主聊天最近 10 条消息压出来的；
 *   预设——按主聊天同一个办法取（chat.presetId，没有就用默认预设）；
 *   世界书——走主聊天同一套 activate()，按最近的微信对话 + 主线聊天
 *     最近消息匹配，命中的条目才进提示词。
 */
export function computeReplyExtras(input: ReplyExtrasInput): ReplyPromptExtras {
  const { card, mainChat, history } = input;
  if (!mainChat) return {};
  const mainMessages = currentMessages(mainChat);
  const plotProgress = formatPlotProgress(mainMessages, card.data.name);
  const preset = input.presets.find(
    (p) => p.id === (mainChat.presetId ?? input.defaultPresetId),
  );
  const presetText = preset ? extractPresetPrompts(preset, card) : '';
  const recent = history.filter((m) => m.role !== 'system').slice(-10);
  const lorebookText = selectLorebookText(
    card,
    mainChat,
    input.lorebooks,
    input.lorebookDefaults,
    [
      ...mainMessages
        .filter((m) => m.role !== 'system' && !m.hidden && m.content.trim())
        .slice(-10)
        .map((m) => ({ role: m.role, content: m.content })),
      ...historyEntries(recent),
    ],
  );
  return { plotProgress, lorebookText, presetText };
}
