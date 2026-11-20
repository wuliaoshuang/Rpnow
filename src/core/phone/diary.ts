/**
 * 日记（Diary）— 纯函数，好测。
 *
 * 搬的是“小手机”插件 diary.html 那套逻辑，用 Rpnow 的办法重新写了一遍
 * （没抄插件的代码）：
 *
 *   - 手写日记：用户自己打字，没有角色归属（characterName 为 null）。
 *   - AI 日记：用户挑一个联系人，读这个联系人的 profile（PR #43 的
 *     人设）+ 主线剧情最近进展（PR #41 的 formatPlotProgress）+ 这个
 *     联系人最近的微信聊天记录，调一次模型，以这个角色的第一人称写一篇
 *     100–150 字的日记，写出性格、情绪和对最近发生的事/人的感受。
 *   - 时间戳：插件用的是世界内时间，Rpnow 没有世界时钟——这里用真实时间。
 *   - 存取在 diaryStore.ts：按聊天存，最新在前；不写世界书、不花钱、
 *     不动好感度。
 */
import { uid } from '@/lib/utils.js';
import type { LLMMessage } from '@/core/llm/types.js';
import type { DiaryEntry, PhoneContact } from './types.js';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 日记显示用的时间：`2026年11月20日 星期五 21:30`（本地真实时间）。 */
export function formatDiaryTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 建一篇日记：内容前后去空白，空内容返回 null（调用方不建、不存）。
 * characterName 为 null 是手写日记；有名字就是那个联系人第一人称的 AI 日记。
 */
export function createDiaryEntry(content: string, characterName: string | null): DiaryEntry | null {
  const text = String(content || '').trim();
  if (!text) return null;
  const now = Date.now();
  return {
    id: uid('de'),
    content: text,
    displayTime: formatDiaryTime(now),
    timestamp: now,
    characterName,
  };
}

/** 日记按时间从新到旧排。 */
export function sortDiaryNewestFirst(entries: DiaryEntry[]): DiaryEntry[] {
  return [...entries].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export interface DiaryPromptInput {
  contact: PhoneContact;
  /** User 的名字（主聊天 persona 的名字，没有就是“用户”）。 */
  userName: string;
  /** 这个联系人最近的微信聊天记录（纯文字行，如“小雨：…”）。 */
  wechatHistoryText: string;
  /** 主线聊天的最近进展（formatPlotProgress 压出来的，只做了解）。 */
  plotProgress: string;
  /** 世界书里关于这个联系人的内容（selectLorebookText 选出来的）。 */
  lorebookText: string;
}

/**
 * 代写一篇日记的提示词（一次模型调用，只在用户点了“让 TA 写日记”之后）。
 *
 * 角色设定是这个联系人自己的人设（profile），记忆来自主线剧情进度
 * （最近发生了什么）+ 这个联系人的微信聊天记录（最近和 User 聊了什么）
 * + 世界书里关于 TA 的内容；写的时候要求第一人称、100–150 字、写出
 * 性格和情绪、写对最近的事和人的感受，不要写成第三人称旁白，也不要
 * 写成给别人看的公开帖子（日记是私人的）。
 */
export function buildDiaryMessages(input: DiaryPromptInput): LLMMessage[] {
  const { contact, userName, wechatHistoryText, plotProgress, lorebookText } = input;
  const profile = (contact.profile || '').trim();
  const lines: string[] = [
    `角色设定：${contact.name}。${profile || '你是一个普通朋友，性格自然、友好。'}`,
    '',
    `你现在就是 ${contact.name}，请以第一人称写一篇日记。`,
    '',
  ];
  if (lorebookText.trim()) {
    lines.push(
      `<${contact.name} 的记忆>（TA 亲身经历过的事，写日记时可自然呼应）：`,
      lorebookText.trim(),
      '',
    );
  }
  if (plotProgress.trim()) {
    lines.push('最近发生的事：', plotProgress.trim(), '');
  }
  if (wechatHistoryText.trim()) {
    lines.push(`和 ${userName} 最近的聊天记录：`, wechatHistoryText.trim(), '');
  }
  lines.push(
    '请写一篇 100–150 字的日记：用第一人称“我”写，写出你自己的性格、今天的心情和情绪，以及你对最近发生的事、遇到的人的真实感受；',
    '不要写成第三人称旁白，不要写成发给别人看的公开帖子——日记是写给自己的私人记录，可以诚实、可以碎碎念；',
    '直接输出日记正文，不要加标题、不要加“日记：”这种前缀、不要说任何多余的话。',
  );
  return [{ role: 'user', content: lines.join('\n') }];
}

/**
 * 解析模型回的日记正文：前后去空白；模型如果包了一层引号或书名号就去掉；
 * 空的返回 ''（调用方不存空日记）。
 */
export function parseDiaryText(text: string): string {
  let body = String(text || '').trim();
  // 去掉整段包着的一层引号 / 书名号（模型偶尔会加）。
  for (const [open, close] of [
    ['“', '”'],
    ['"', '"'],
    ['『', '』'],
    ['《', '》'],
  ] as const) {
    if (body.length >= 2 && body.startsWith(open) && body.endsWith(close)) {
      body = body.slice(1, -1).trim();
    }
  }
  // 模型偶尔会在前面加“日记：”这种前缀，去掉它。
  body = body.replace(/^(日记|今天的日记)\s*[:：]\s*/, '').trim();
  return body;
}
