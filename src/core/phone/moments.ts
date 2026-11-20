/**
 * 朋友圈（Moments）— 纯函数，好测。
 *
 * 搬的是“小手机”插件 wechat.html 里朋友圈那套逻辑，用 Rpnow 的办法
 * 重新写了一遍（没抄插件的代码）：
 *
 *   - 只由角色发帖：用户不发朋友圈。发一条 = 调一次模型，模型按标签格式
 *     回一段文本，这里按标签解析成 MomentPost（见 parseMomentsPostText）。
 *   - 图片不跟着帖子一起生：帖子里只有 imageDesc（画面描述）；用户点了
 *     图片才真的走生图流程（imageGen.ts 那条线），图存进相册、也挂到帖子上。
 *   - 点赞只做展示：likers + likes 都是模型编的，显示成“X、Y 等 N 人觉得很赞”；
 *     这个版本没有点赞按钮（插件的 `liked` 字段是死的，也没搬）。
 *   - 评论：用户能评（直接评 / 回复某条评论 / @ 某个人），评完调一次模型
 *     让角色回（replier 优先级：@ 的人 > 被回复的人 > 发帖人；新评论的
 *     作者就是 replier 时换别人回；最多再让 1 个其他角色附和一句）。
 *   - 世界书同步（只同步简介，节流设计）：每个角色一条常驻条目
 *     “{名字}的朋友圈”，内容只有每条动态一行
 *     `[时间] | 简介（没有简介就取正文前 40 字）| 地点`；正文、图片、评论
 *     只留在手机里，不进世界书。角色没动态了就删掉他的条目。互动另外
 *     一条“{名字}的朋友圈互动”，用户评论和 AI 回复都追加成
 *     `[时间] 评论者：内容`，只留最近 60 条。
 *   - 头像：用联系人已有的头像；没有就用首字圆圈（PhoneAvatar），不编
 *     随机头像地址。
 */
import { uid } from '@/lib/utils.js';
import type { LLMMessage } from '@/core/llm/types.js';
import type { PhoneContact, MomentComment, MomentPost } from './types.js';

/** 朋友圈互动的世界书条目里最多留多少条（再加 2 行条目头）。 */
export const MOMENTS_INTERACTION_KEEP = 60;

/** 一条动态的简介没有时，正文取前多少字代替。 */
export const MOMENTS_SUMMARY_FALLBACK_CHARS = 40;

/** 发帖那次模型调用的标签（插件同款，顺序照它）。 */
const POST_LABELS = [
  '用户名',
  '朋友圈文案',
  '朋友圈简介',
  '附图',
  '发布时间',
  '发布地点',
  '点赞人列表',
  '点赞总数',
  '评论',
] as const;

/** 评论回复那次模型调用的标签。 */
const REPLY_LABELS = ['用户名', '朋友圈文案', '朋友圈简介', '附图', '发布时间', '发布地点', '点赞人列表', '点赞总数', '评论'] as const;

/**
 * 从模型回的一段标签文本里按标签取值。
 * 每个标签单独一行、标签后跟中文冒号；值一直取到下一个标签或文本结尾。
 */
function extractLabel(text: string, label: string, labels: readonly string[]): string {
  const others = labels.filter((l) => l !== label).join('|');
  const re = new RegExp(`${label}\\s*[:：]\\s*([\\s\\S]*?)(?=\\n(?:${others})\\s*[:：]|$)`, 'i');
  const m = text.match(re);
  return m ? m[1].trim() : '';
}

/**
 * 解析发帖模型回的“评论：”那行：评论全写在一行里，用 <br> 分隔每条，
 * 评论者名字用 ≤≥ 包着（插件的格式）。posterName 是发帖人，格式里没写
 * 作者的评论行、或“回复≤某人≥:”这种行，都算发帖人写的。
 */
export function parseMomentCommentLines(raw: string, posterName: string): MomentComment[] {
  const out: MomentComment[] = [];
  const now = Date.now();
  const lines = String(raw || '').split(/<br\s*\/?>|\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    let m = line.match(/^≤([^≥]+)≥\s*回复≤([^≥]+)≥\s*[:：]\s*([\s\S]*)$/);
    if (m) {
      out.push({ id: uid('mc'), author: m[1].trim(), replyTo: m[2].trim(), text: m[3].trim(), timestamp: now });
      continue;
    }
    m = line.match(/^回复≤([^≥]+)≥\s*[:：]\s*([\s\S]*)$/);
    if (m) {
      out.push({ id: uid('mc'), author: posterName, replyTo: m[1].trim(), text: m[2].trim(), timestamp: now });
      continue;
    }
    m = line.match(/^≤([^≥]+)≥\s*[:：]\s*([\s\S]*)$/);
    if (m) {
      out.push({ id: uid('mc'), author: m[1].trim(), text: m[2].trim(), timestamp: now });
      continue;
    }
    out.push({ id: uid('mc'), author: posterName, text: line.replace(/^[:：]\s*/, ''), timestamp: now });
  }
  return out.filter((c) => c.text.trim() !== '');
}

/**
 * 解析发帖模型回的整段标签文本（parseMomentsPostText 的核心）。
 * 模型没按标签写、文案取不到时，退回：把整段当文案（去掉标签行）。
 */
export function parseMomentsPostText(text: string, contactName: string): {
  text: string;
  summary: string;
  imageDesc: string;
  time: string;
  location: string;
  likers: string;
  likes: number;
  comments: MomentComment[];
} {
  const body = String(text || '').trim();
  let postText = extractLabel(body, '朋友圈文案', POST_LABELS);
  if (!postText) {
    postText = body
      .split('\n')
      .filter((line) => line.trim() && !line.match(/用户名|朋友圈文案|朋友圈简介|附图|发布时间|发布地点|点赞人列表|点赞总数|评论/))
      .join('\n')
      .trim();
  }
  const commentsRaw = extractLabel(body, '评论', REPLY_LABELS);
  return {
    text: postText,
    summary: extractLabel(body, '朋友圈简介', POST_LABELS),
    imageDesc: extractLabel(body, '附图', POST_LABELS),
    time: extractLabel(body, '发布时间', POST_LABELS),
    location: extractLabel(body, '发布地点', POST_LABELS),
    likers: extractLabel(body, '点赞人列表', POST_LABELS),
    likes: parseInt(extractLabel(body, '点赞总数', POST_LABELS), 10) || 0,
    comments: parseMomentCommentLines(commentsRaw, contactName),
  };
}

/** 按解析结果建一条 MomentPost（id 和 timestamp 在这里定）。 */
export function buildMomentPost(parsed: ReturnType<typeof parseMomentsPostText>, contactName: string): MomentPost {
  return {
    id: uid('mp'),
    contactName,
    text: parsed.text || '今天心情不错，分享生活。',
    summary: parsed.summary,
    imageDesc: parsed.imageDesc,
    location: parsed.location,
    time: parsed.time || '刚刚',
    likers: parsed.likers,
    likes: parsed.likes,
    comments: parsed.comments,
    timestamp: Date.now(),
    imageUrl: '',
  };
}

/** 点赞行：模型编的名单 + 数量，只做展示（“X、Y 等 N 人觉得很赞”）。 */
export function formatLikesLine(post: MomentPost): string {
  const likers = (post.likers || '').trim();
  if (likers) return `${likers}等${post.likes}人觉得很赞`;
  if (post.likes > 0) return `${post.likes}人觉得很赞`;
  return '';
}

/**
 * 选评论回复的人（replier 优先级，插件同款）：
 * @ 的人 > 被回复的人 > 发帖人。
 * 新评论的作者就是 replier 时换别人：先看发帖人，再看已有评论里出现过
 * 的其他人；实在没别人（只有作者一个人）就还是发帖人。
 */
export function pickCommentReplier(post: MomentPost, newComment: MomentComment): string {
  const preferred = (newComment.atName || newComment.replyTo || post.contactName || '').trim();
  const author = (newComment.author || '').trim();
  if (preferred && preferred !== author) return preferred;
  const candidates: string[] = [];
  if (post.contactName) candidates.push(post.contactName);
  for (const c of post.comments) {
    if (c.author && !candidates.includes(c.author)) candidates.push(c.author);
  }
  const other = candidates.find((name) => name !== author);
  return other ?? preferred ?? post.contactName;
}

/** 评论去重：按 `作者:内容` 去重，模型回的重复评论不重复贴。 */
export function dedupeMomentComments(
  existing: MomentComment[],
  incoming: MomentComment[],
): MomentComment[] {
  const seen = new Set(existing.map((c) => `${c.author ?? ''}:${c.text ?? ''}`));
  const added: MomentComment[] = [];
  for (const c of incoming) {
    const key = `${c.author ?? ''}:${c.text ?? ''}`;
    if (!c.text.trim() || seen.has(key)) continue;
    seen.add(key);
    added.push(c);
  }
  return added;
}

/** 世界书里一条动态的简介行：`[时间] | 简介（或正文前 40 字）| 地点`。 */
export function formatMomentsSummaryLine(post: MomentPost): string {
  const brief = (post.summary || '').trim()
    ? (post.summary || '').trim()
    : (() => {
        const full = post.text || '';
        const chars = [...full];
        return chars.slice(0, MOMENTS_SUMMARY_FALLBACK_CHARS).join('') + (chars.length > MOMENTS_SUMMARY_FALLBACK_CHARS ? '…' : '');
      })();
  const safeBrief = brief.replace(/\|/g, '｜');
  const safeLocation = (post.location || '').replace(/\|/g, '｜');
  return `[${post.time || ''}] ${safeBrief} | ${safeLocation}`;
}

/** “{名字}的朋友圈”条目的头：告诉模型这些简介按时间从新到旧排。 */
export function momentsEntryHeader(name: string): string {
  return `以下是 ${name} 发布过的朋友圈简介，按时间从新到旧排列，最新发布在最前面。`;
}

/**
 * “{名字}的朋友圈”条目的整段内容：头 + 每条动态一行简介（最新在前）。
 * 这个角色一条动态都没有时返回 ''（调用方删掉他的条目）。
 */
export function buildMomentsEntryContent(name: string, posts: MomentPost[]): string {
  const mine = posts
    .filter((p) => p.contactName === name)
    .slice()
    .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  if (mine.length === 0) return '';
  return [momentsEntryHeader(name), ...mine.map(formatMomentsSummaryLine)].join('\n');
}

/** “{名字}的朋友圈互动”条目的头（2 行，截断时这两行一直留着）。 */
export function momentsInteractionHeader(name: string): string {
  return (
    `以下是 ${name} 朋友圈下的评论互动记录（用户评论、角色回复等），按时间先后排列。` +
    `\n${name} 本人必须记得这些互动：`
  );
}

/** 互动行的时间：`YYYY-MM-DD HH:mm`（本地时间）。 */
export function formatMomentsTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * 往“{名字}的朋友圈互动”条目内容里追加一行互动：
 * `[时间] 评论者：内容`。条目不存在时（existingContent 为 ''）先写头；
 * 超过 62 行时只留头 2 行 + 最近 60 条，条目不会无限长。
 */
export function appendMomentsInteractionLine(
  existingContent: string,
  name: string,
  actor: string,
  text: string,
  ts: number,
): string {
  const line = `[${formatMomentsTime(ts)}] ${actor}：${String(text).replace(/\|/g, '｜')}`;
  const content = (existingContent || '').trim()
    ? `${existingContent.trim()}\n${line}`
    : `${momentsInteractionHeader(name)}\n${line}`;
  const lines = content.split('\n');
  if (lines.length > MOMENTS_INTERACTION_KEEP + 2) {
    return [...lines.slice(0, 2), ...lines.slice(lines.length - MOMENTS_INTERACTION_KEEP)].join('\n');
  }
  return content;
}

/** “{名字}的朋友圈”世界书条目的名字。 */
export function momentsEntryName(name: string): string {
  return `${name}的朋友圈`;
}

/** “{名字}的朋友圈互动”世界书条目的名字。 */
export function momentsInteractionEntryName(name: string): string {
  return `${name}的朋友圈互动`;
}

// ---------- 提示词 ----------

export interface MomentsPostPromptInput {
  contact: PhoneContact;
  /** User 的名字（主聊天 persona 的名字，没有就是“用户”）。 */
  userName: string;
  /** 这个角色最近的微信聊天记录（纯文字行，如“小雨：…”），给模型当记忆。 */
  wechatHistoryText: string;
  /** 主线聊天的最近进展（formatPlotProgress 压出来的，只做了解）。 */
  plotProgress: string;
  /** 世界书里关于这个角色的内容（selectLorebookText 选出来的）。 */
  lorebookText: string;
}

/**
 * 发一条朋友圈的提示词（一次模型调用）。
 *
 * 插件的写法：角色设定（联系人的人设）+ “你就是 X，绝对不要以用户的身份
 * 发布” + 共享记忆（这个角色的微信聊天 + 朋友圈互动，公开内容、注意分寸）
 * + 主线剧情（已发生的事）+ 输出格式（每行一个标签：文案、简介、附图、
 * 发布时间、地点、点赞人、点赞总数、评论）。Rpnow 里记忆的来源换成
 * 小手机现成的：微信聊天记录（调用方传 wechatHistoryText）、主线剧情进度
 * （plotProgress）、世界书（lorebookText，里面已经含之前同步进去的朋友
 * 圈简介和互动——公开内容那句分寸提醒还在）。
 */
export function buildMomentsPostMessages(input: MomentsPostPromptInput): LLMMessage[] {
  const { contact, userName, wechatHistoryText, plotProgress, lorebookText } = input;
  const profile = (contact.profile || '').trim();
  const lines: string[] = [
    `角色设定：${contact.name}。${profile || '你是一个普通朋友，性格自然、友好。'}`,
    '',
    `重要：你现在就是 ${contact.name}，你发布的所有内容都必须以 ${contact.name} 的身份和口气，绝对不要以用户的身份发布。`,
    '',
  ];
  if (lorebookText.trim()) {
    lines.push(
      `<${contact.name} 的记忆>（TA亲身经历过的事，发朋友圈时可自然呼应，但朋友圈是公开内容，注意分寸）：`,
      lorebookText.trim(),
      '',
    );
  }
  if (plotProgress.trim()) {
    lines.push('已发生的事（主要信息来源）：', plotProgress.trim(), '');
  }
  if (wechatHistoryText.trim()) {
    lines.push(`和 ${userName} 的线上聊天记录（辅助参考）：`, wechatHistoryText.trim(), '');
  }
  lines.push(
    '朋友圈是角色的生活橱窗。内容保守、公开和Safe，可以吐槽、可以分享生活（如美食、健身、娱乐），可以和亲朋好友进行互动。这是表演者展示日常生活的地方。',
    '请生成一条完整的朋友圈内容，合理运用emoji图标，按以下格式输出（每行一个标签）：',
    '用户名：角色的姓名',
    '朋友圈文案：根据公开人设，生成一段生活化的简短正文。',
    '朋友圈简介：(一句话，30字左右，概括这条朋友圈的核心内容与心情，供世界书记录)',
    '附图：一段描述图片或者短视频的文字',
    '发布时间：YYYY年MM月DD日 星期X HH:MM',
    '发布地点：如：碧桂园',
    '点赞人列表：日常社交圈的名单，同事朋友亲戚等，用顿号分隔',
    '点赞总数：合理的数值',
    '评论：根据文案生成3-8条，亲人、朋友、熟人、追求者等NPC公开评论与回复，评论者名字用≤≥包裹。示例:≤葱哥≥:哥你认真的？<br>回复≤葱哥≥:是的。<br>',
    '',
    '格式铁律（必须严格遵守）：',
    '1. 每个标签单独一行，标签后用中文冒号，紧接着写内容。',
    '2. 评论内容全部写在同一行，用 <br> 分隔每条评论，绝对不要用换行。',
    '3. 直接输出上述格式，不要说任何多余的话。',
  );
  return [{ role: 'user', content: lines.join('\n') }];
}

export interface MomentsCommentReplyPromptInput {
  post: MomentPost;
  /** 选出来回这条评论的人（pickCommentReplier 定的）。 */
  replierName: string;
  /** 回复者的人设（联系人 profile，没有就是一句通用描述）。 */
  replierProfile: string;
  /** 回复者的共享记忆（他的微信聊天 + 世界书里关于他的内容）。 */
  replierMemory: string;
  newComment: MomentComment;
  /** 已有评论拼成的文字（每行一条“作者：内容”）。 */
  commentsText: string;
}

/** 已有评论拼成提示词里用的文字（每行一条，带“回复某人”的说明）。 */
export function formatMomentsCommentsText(post: MomentPost): string {
  if (post.comments.length === 0) return '（暂无评论）';
  return post.comments
    .map((c) => {
      const reply = c.replyTo ? `（回复 ${c.replyTo}）` : '';
      return `${c.author}：${c.text}${reply}`;
    })
    .join('\n');
}

/**
 * 评论回复的提示词（一次模型调用，插件同款）。
 *
 * 优先让 replier 回这条评论；新评论的作者就是 replier 时换一个其他角色
 * 回；如合适，最多再让 1 个其他角色附和一句。输出格式每行一条：
 * `≤角色名≥:回复内容`，回复某人时 `≤角色名≥ 回复≤某人≥:回复内容`。
 */
export function buildCommentReplyMessages(input: MomentsCommentReplyPromptInput): LLMMessage[] {
  const { post, replierName, replierProfile, replierMemory, newComment, commentsText } = input;
  const lines: string[] = [
    '你正在模拟微信朋友圈的评论互动。',
    `发帖人：${post.contactName}`,
    `朋友圈内容：${post.text}`,
  ];
  if (replierMemory.trim()) {
    lines.push(
      `参考记忆（${replierName} 亲身经历的事，被问起或相关时必须记得，回复时可自然呼应）：`,
      replierMemory.trim(),
      '',
    );
  }
  lines.push(`已有评论：\n${commentsText}`);
  let newLine = `刚刚新增一条评论：${newComment.author}：${newComment.text}`;
  if (newComment.replyTo) newLine += `（这条是对 ${newComment.replyTo} 的回复）`;
  if (newComment.atName) newLine += `（这条评论 @了 ${newComment.atName}，${newComment.atName} 需要回复）`;
  lines.push(newLine, '');
  lines.push('请以最合适的角色生成1-2条回复评论。');
  let priority = `优先让 ${replierName} 回复这条评论`;
  if (newComment.atName) priority += `；${newComment.atName} 请结合朋友圈贴文内容和被@到的那条评论内容来回复，语气自然`;
  if (newComment.author === replierName) priority += `；如果新评论作者就是 ${replierName}，则换一个其他角色回复`;
  priority += '；如合适，最多再让1个其他角色附和一句。';
  lines.push(priority);
  lines.push(`角色设定：${replierName}。${replierProfile || '你是一个普通朋友，性格自然、友好。'}`);
  lines.push(
    '输出格式（每行一条，严格按格式，不要输出其他内容）：',
    '≤角色名≥:回复内容',
    '如果是回复某人：≤角色名≥ 回复≤某人≥:回复内容',
  );
  return [{ role: 'user', content: lines.join('\n') }];
}
