/**
 * 小手机共享主聊天的预设提示词 — 纯函数，好测。
 *
 * 主聊天的提示词流水线（core/prompt/builder.ts）里，预设是骨架：
 * `prompt_order` 决定区块顺序，`prompts[]` 是每个区块的默认文本；
 * `main` / `jailbreak` / 自定义条目是字面文本，`charDescription` /
 * `scenario` / `worldInfoBefore` / `chatHistory` 这些是标记位（marker），
 * 由 builder 在渲染时填卡的内容、世界书、聊天记录。
 *
 * 小手机只发一条 system prompt（buildReplySystemPrompt），没有 builder
 * 那种多消息骨架，所以把预设里“能直接当文本用的”条目抽出来，
 * 按预设自己的 prompt_order 拼成一段，放到 system prompt 里。
 *
 * 注入深度：这份代码里 `injection_depth` 是“离消息列表末尾有几条消息”
 * （builder.ts 的 depthIndex 只数 user/assistant 消息；depth 0 = 紧贴
 * 最新一条消息，也就是离生成最近、最显眼；数字越大越靠后），而
 * `nextResponse` 是追加在聊天记录之后、生成之前的那一块——整条流水线
 * 里最显眼的位置。小手机的 system prompt 只有一条，所谓“最高注入深度”
 * 就是放到最后、紧贴微信聊天记录：预设那一段是 system prompt 里最后
 * 的内容，模型读完它立刻就读对话、回消息——预设的规则是它下笔前最后
 * 看到的东西。不是 depth 数字最大的那个（数字越大反而离生成越远）。
 *
 * 只抽字面文本的条目，标记位和小手机自己已经填的东西不重复抽：
 *   - 不抽：chatHistory / dialogueExamples / worldInfoBefore / worldInfoAfter /
 *     charDescription / charPersonality / scenario / personaDescription
 *     （这些是槽位，小手机已经用卡的内容、世界书、微信记录自己填了）；
 *   - 不抽：nextResponse / writingStyle / cotPreset / userInfo / jailbreakFirst
 *     （builder 特殊处理的标识符，翻译不成一条纯 system 文本）；
 *   - 不抽：SPresetSettings（预设的设置数据包，不是提示词，164KB 那个）；
 *   - 不抽：未启用的（enabled === false）和内容为空的；
 *   - 抽：main / jailbreak / nsfw / enhanceDefinitions 和其他自定义条目。
 *
 * 宏按主聊天的做法替换（{{char}} → 角色名，{{user}} → 用户名）。
 * 整段上限 6000 字——预设条目再多也不会把提示词撑爆；顺序在前的
 * 条目优先保留（prompt_order 里排在前面的先写）。
 */
import { resolveOrder } from '@/core/prompt/builder.js';
import { substituteMacros } from '@/core/prompt/macros.js';
import type { RPCard } from '@/core/types/card.js';
import type { RPCompletionPreset, RPPromptEntry } from '@/core/types/preset.js';

/** 预设那一段在小手机 system prompt 里最多占多少字。 */
export const PRESET_PROMPT_BUDGET_CHARS = 6000;

/** 标记位 / 槽位：builder 渲染时填内容，小手机自己已经填了，不重复抽。 */
const MARKER_IDENTIFIERS = new Set([
  'chatHistory',
  'dialogueExamples',
  'worldInfoBefore',
  'worldInfoAfter',
  'charDescription',
  'charPersonality',
  'scenario',
  'personaDescription',
]);

/** builder 特殊处理的标识符：翻译不成一条纯 system 文本。 */
const BUILDER_SPECIAL_IDENTIFIERS = new Set([
  'nextResponse',
  'writingStyle',
  'cotPreset',
  'userInfo',
  'jailbreakFirst',
]);

/** 预设的设置数据包：不是提示词，再大也不抽。 */
const SETTINGS_BLOB_IDENTIFIERS = new Set(['SPresetSettings']);

/** 单条内容超过这个字数就当设置数据包跳过（防着没见过的巨型条目）。 */
const MAX_ENTRY_CHARS = 10000;

/** 这条预设条目能不能直接当文本抽进小手机的 system prompt。 */
export function isInjectablePresetEntry(entry: RPPromptEntry): boolean {
  if (entry.enabled === false) return false;
  if (!entry.content?.trim()) return false;
  if (MARKER_IDENTIFIERS.has(entry.identifier)) return false;
  if (BUILDER_SPECIAL_IDENTIFIERS.has(entry.identifier)) return false;
  if (SETTINGS_BLOB_IDENTIFIERS.has(entry.identifier)) return false;
  if (entry.content.length > MAX_ENTRY_CHARS) return false;
  return true;
}

/**
 * 从预设里抽出能注入的提示词文本（按预设自己的 prompt_order 排）。
 *
 * 没有预设、或预设里没有能抽的条目时返回 ''，调用方不写这一节。
 * 顺序：先走 prompt_order（100001 → 100000 → 第一个组，和主聊天
 * 同一个 resolveOrder），再把没进 order 的条目按 prompts[] 原顺序补在后面。
 */
export function extractPresetPrompts(
  preset: RPCompletionPreset | null | undefined,
  card: RPCard,
  userName = 'User',
  budgetChars: number = PRESET_PROMPT_BUDGET_CHARS,
): string {
  if (!preset) return '';
  const charName = card.data.name || '角色';
  const entriesById = new Map<string, RPPromptEntry>();
  for (const e of preset.prompts ?? []) entriesById.set(e.identifier, e);

  const ordered: RPPromptEntry[] = [];
  const seen = new Set<string>();
  const order = resolveOrder(preset);
  for (const row of order.order) {
    const entry = entriesById.get(row.identifier);
    if (!entry || row.enabled === false) continue;
    ordered.push(entry);
    seen.add(row.identifier);
  }
  for (const entry of preset.prompts ?? []) {
    if (!seen.has(entry.identifier)) ordered.push(entry);
  }

  const chunks: string[] = [];
  let total = 0;
  for (const entry of ordered) {
    if (!isInjectablePresetEntry(entry)) continue;
    const text = substituteMacros(entry.content ?? '', {
      char: charName,
      user: userName,
      charIfNotGroup: charName,
      description: card.data.description,
      personality: card.data.personality,
      scenario: card.data.scenario,
    }).trim();
    if (!text) continue;
    if (total + text.length > budgetChars) {
      const remain = budgetChars - total;
      if (remain > 0) chunks.push(text.slice(0, remain));
      break;
    }
    chunks.push(text);
    total += text.length;
  }
  return chunks.join('\n\n');
}
