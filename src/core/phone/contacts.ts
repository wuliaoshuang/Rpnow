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

/**
 * 把卡的 first_mes 压成一句短的微信开场白：去 *动作描写*、只取第一句、
 * 最多 60 字。剩不下能用的就用默认问候。
 *
 * first_mes 原样展示会是一大段角色扮演描写，不能直接当微信第一条消息。
 */
export function cleanOpeningMessage(firstMes: string, name: string): string {
  const fallback = `你好，我是${name}。`;
  if (!firstMes) return fallback;
  // 去掉 *动作描写*（可能跨行）。
  const noActions = firstMes.replace(/\*[\s\S]*?\*/g, ' ');
  // 折叠空白。
  const flat = noActions.replace(/\s+/g, ' ').trim();
  if (!flat) return fallback;
  // 取第一句：到第一个句末标点为止，标点后紧跟的右引号也一起收进来。
  const m = flat.match(/^[^。！？!?]*[。！？!?][」』"'）】]?/);
  let first = (m ? m[0] : flat).trim();
  if (!first) return fallback;
  if (first.length > 60) first = `${first.slice(0, 60)}…`;
  return first;
}

/** 模型开场白的安全阀：本来就短的原样用；写成大段的才压短。 */
function limitOpening(opening: string, name: string): string {
  if (opening.length <= 80) return opening;
  return cleanOpeningMessage(opening, name);
}

/** 兜底：只有主角一个人，开场白是 first_mes 压短后的版本，不是原文。 */
export function fallbackContacts(card: RPCard): PhoneContact[] {
  const name = card.data.name || '角色';
  return [
    {
      id: card.id,
      name,
      relation: '本人',
      openingMessage: cleanOpeningMessage(card.data.first_mes, name),
      isMain: true,
    },
  ];
}

/**
 * 旧缓存判定：联系人列表非空，且主角的开场白就是卡的 first_mes 原文。
 *
 * 旧逻辑初始化的缓存长这样；模型新写的短开场白几乎不可能和又长又带
 * RP 描写的 first_mes 原文一字不差，所以这个检查是安全的。
 * 命中时调用方应丢掉缓存、重新初始化一次（见 WeChat 的联系人加载），
 * 并把主角存过的微信记录第一条也换掉（见 wechatStore 的迁移）。
 */
export function isStaleContacts(contacts: PhoneContact[], card: RPCard): boolean {
  if (contacts.length === 0) return false;
  const firstMes = card.data.first_mes;
  if (!firstMes) return false;
  const main = contacts.find((c) => c.isMain);
  if (!main) return false;
  return main.openingMessage === firstMes;
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
 * 主角固定排第一位，id 用卡 id（老聊天记录按卡 id 存，不断档）；
 * 主角的开场白用模型给的版本——那是按剧情写的短微信消息，不再用卡的
 * first_mes 原文；模型没给主角开场白时才用 first_mes 压短后的版本。
 * 其他人按名字去重。
 */
export function parseContactsJson(text: string, card: RPCard): PhoneContact[] | null {
  const parsed = extractJsonArray(text);
  if (!Array.isArray(parsed)) return null;
  const cardName = card.data.name;
  const seen = new Set<string>([cardName]);
  let mainOpening = '';
  const others: PhoneContact[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    const relation = typeof raw.relation === 'string' ? raw.relation.trim() : '';
    const opening = typeof raw.openingMessage === 'string' ? raw.openingMessage.trim() : '';
    // 主角的条目：只取它的开场白，不进联系人列表。
    if (name === cardName || relation === '本人') {
      if (!mainOpening) mainOpening = opening;
      seen.add(name);
      continue;
    }
    if (seen.has(name)) continue;
    seen.add(name);
    others.push({
      id: `c_${uid()}`,
      name,
      relation: relation || '朋友',
      openingMessage: opening ? limitOpening(opening, name) : `你好，我是${name}。`,
      isMain: false,
    });
    if (others.length >= MAX_CONTACTS - 1) break;
  }
  const main: PhoneContact = {
    id: card.id,
    name: cardName || '角色',
    relation: '本人',
    openingMessage: mainOpening
      ? limitOpening(mainOpening, cardName)
      : cleanOpeningMessage(card.data.first_mes, cardName),
    isMain: true,
  };
  return [main, ...others];
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
        '{"name": "名字", "relation": "和主角的关系，如 本人/闺蜜/哥哥/同事", "openingMessage": "这个人第一次在微信上发来的消息"}。',
        '写每条 openingMessage 之前，先想一想：这个人是谁、性格怎么样、和主角是什么关系、卡里的剧情是什么；想清楚了再写。',
        'openingMessage 的要求：要像真人发微信，口语化、简短（1–2 句，最多 40 字），结合卡里的剧情跟对方打招呼或找对方；写的时候要保持在角色里，绝不跳出角色（不要 OOC），绝不提自己是 AI 或模型；绝不能照抄卡的开场白原文，不能带 *动作描写*，不能写成一大段角色扮演描写。主角本人的开场白也一样，按剧情重新写一句短消息，不要照搬开场白原文。',
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
