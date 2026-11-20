/**
 * 联系人初始化 — 小手机的联系人是当前聊天卡里出现的人物，不是全部角色卡。
 *
 * 第一次打开一部聊天的小手机时，调一次模型，让它从卡的内容（介绍、性格、
 * 场景、开场白、示例对话）里找出所有人物：主角 + 卡里提到的人。结果按聊天
 * 缓存进 IndexedDB，之后直接读缓存，不再重复调模型。
 *
 * 解析失败、超时或模型没配好时，一律退回只有主角的兜底联系人，绝不空列表。
 */
import type { RPCard } from '@/core/types/card.js';
import type { LLMMessage, LLMService } from '@/core/llm/types.js';
import { uid } from '@/lib/utils.js';
import type { PhoneContact } from './types.js';

/** 联系人最多留几位：卡里人再多，微信列表也不宜太长。 */
const MAX_CONTACTS = 8;

/** 兜底：只有主角一个人，开场白就是卡的 first_mes。 */
export function fallbackContacts(card: RPCard): PhoneContact[] {
  return [
    {
      id: card.id,
      name: card.data.name || '角色',
      relation: '本人',
      openingMessage: card.data.first_mes || `你好，我是${card.data.name}。`,
      isMain: true,
    },
  ];
}

/** 从模型返回的文本里抠出 JSON 数组（允许 ```json 代码块包裹）。 */
function extractJsonArray(text: string): unknown | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * 解析模型返回的联系人 JSON。返回 null 表示根本没法解析（调用方走兜底）；
 * 数组解析出来但没别人时，返回只有主角的列表。
 *
 * 主角固定排第一位，id 用卡 id（老聊天记录按卡 id 存，不断档），
 * 开场白固定用卡的 first_mes；其他人按名字去重。
 */
export function parseContactsJson(text: string, card: RPCard): PhoneContact[] | null {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return null;
  const seen = new Set<string>([card.data.name]);
  const others: PhoneContact[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    const relation = typeof raw.relation === 'string' ? raw.relation.trim() : '';
    const opening = typeof raw.openingMessage === 'string' ? raw.openingMessage.trim() : '';
    others.push({
      id: `c_${uid()}`,
      name,
      relation: relation || '朋友',
      openingMessage: opening || `你好，我是${name}。`,
      isMain: false,
    });
    if (others.length >= MAX_CONTACTS - 1) break;
  }
  return [fallbackContacts(card)[0], ...others];
}

/** 初始化用的消息：把卡的全部内容交给模型去找人。 */
export function buildInitMessages(card: RPCard): LLMMessage[] {
  const d = card.data;
  const cardText = [
    `角色名：${d.name}`,
    d.description ? `介绍：${d.description}` : '',
    d.personality ? `性格：${d.personality}` : '',
    d.scenario ? `场景：${d.scenario}` : '',
    d.first_mes ? `开场白：${d.first_mes}` : '',
    d.mes_example ? `示例对话：${d.mes_example}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  return [
    {
      role: 'system',
      content: '你是一个角色卡解析助手。只返回 JSON，不要解释、不要加多余文字。',
    },
    {
      role: 'user',
      content: [
        '以下是角色卡内容：',
        cardText,
        '',
        '请从中找出出现的所有人物（包括主角本人），返回一个 JSON 数组。每个元素只有三个字段：',
        '{"name": "名字", "relation": "和主角的关系，如 本人/闺蜜/哥哥/同事", "openingMessage": "一句它会在微信上发来的开场白，口语化、简短，不超过 30 字"}。',
        '主角本人放在第一位，relation 写“本人”。如果卡里除了主角没有其他人，只返回主角一人。',
      ].join('\n'),
    },
  ];
}

/**
 * 调一次模型，找出卡里的人物。解析失败返回 null（调用方走兜底）。
 * 30 秒超时，避免初始化一直转圈。
 */
export async function initContacts(
  card: RPCard,
  llm: LLMService,
  connectionId: string,
  model: string,
): Promise<PhoneContact[] | null> {
  const result = await llm.complete(connectionId, {
    model,
    messages: buildInitMessages(card),
    temperature: 0.3,
    maxTokens: 800,
    signal: AbortSignal.timeout(30_000),
  });
  return parseContactsJson(result.text, card);
}
