/**
 * 文风 `<next_response>` / `<writing_style>` 协议（F03）。
 *
 * RP-Hub 约定：
 * - 文风预设的内容包在 `<writing_style>…</writing_style>` 里，注入时先剥掉
 *   这层包裹，再拼进 `<next_response>` 的写作风格位置；
 * - `<next_response>` 是放在聊天记录之后、生成之前的最后一段系统指令，
 *   告诉模型“承接最新输入、按当前文风与格式直接续写正文”。
 *
 * 本模块只做协议解析与组装，不决定文风文本本身（文本在
 * `managed.ts` 的托管预设库里）。
 */

/** 从可能包着 `<writing_style>` 的文本里取出纯文风内容。 */
export function parseWritingStyle(content: string): string {
  if (!content) return '';
  // 完整的 `<writing_style>…</writing_style>` 包裹：取中间。
  const wrapped = content.match(/<writing_style\b[^>]*>([\s\S]*?)<\/writing_style\s*>/i);
  if (wrapped) return wrapped[1].trim();
  // 只有开标签（生成截断的常见形态）：去掉开标签，取剩余部分。
  let out = content.replace(/^\s*<writing_style\b[^>]*>\s*/i, '');
  // 只有闭标签残留：去掉它。
  out = out.replace(/\s*<\/writing_style\s*>\s*$/i, '');
  return out.trim();
}

/** 文本是否携带 `<writing_style>` 包裹。 */
export function hasWritingStyleTag(content: string): boolean {
  return /<writing_style\b/i.test(content);
}

/** 取出 `<next_response>…</next_response>` 的内文；没有该标签时返回 ''。 */
export function parseNextResponse(content: string): string {
  if (!content) return '';
  const m = content.match(/<next_response\b[^>]*>([\s\S]*?)<\/next_response\s*>/i);
  if (m) return m[1].trim();
  return '';
}

/** 去掉文本里的 `<next_response>…</next_response>` 整段（用于防重复嵌套）。 */
export function stripNextResponse(content: string): string {
  return content
    .replace(/<next_response\b[^>]*>[\s\S]*?<\/next_response\s*>/gi, '')
    .replace(/<next_response\b[^>]*>[\s\S]*$/gi, '')
    .trim();
}

export interface NextResponseOptions {
  /** 已剥掉标签的文风正文（parseWritingStyle 的结果）。 */
  writingStyle?: string;
  /** 是否启用 COT（思考标签）指令。 */
  cotEnabled?: boolean;
  /** COT 用的标签名：'thinking' 或 'cot'。 */
  cotTag?: 'thinking' | 'cot';
  /** 是否启用 UI 模板变量更新提示。 */
  uiTemplateEnabled?: boolean;
  /** 是否启用自动生图提示。 */
  autoImageGenEnabled?: boolean;
  /** 自动生图张数（默认 2，钳制在 2–8）。 */
  imageGenCount?: number;
  /** 是否启用剧情面板提示。 */
  storyPanelsEnabled?: boolean;
}

/**
 * 组装一段 `<next_response>` 指令：承接最新用户输入、按文风续写正文。
 * 文风文本放在风格位；没有文风时该位留空，不输出占位符。
 */
export function buildNextResponsePrompt(opts: NextResponseOptions = {}): string {
  const lines: string[] = ['<next_response>'];
  lines.push('完整承接最新用户输入中已经发生的言行，结合当前场景继续剧情。');
  if (opts.cotEnabled) {
    const tag = opts.cotTag ?? 'cot';
    lines.push(
      `先在<${tag}>标签中完成本轮分析（现场、意图、设定、信息边界、剧情规划、最终检查），` +
        `按规则输出<${tag}></${tag}>后再直接输出本轮正文；不要复述规则。`,
    );
  }
  const style = (opts.writingStyle ?? '').trim();
  if (style) lines.push(style);
  lines.push('按系统中当前启用的人称、时间戳、NSFW 及输出格式执行。');
  if (opts.autoImageGenEnabled) {
    const n = Math.min(8, Math.max(2, Number(opts.imageGenCount) || 2));
    lines.push(`当前已开启自动生图，请按系统中的自动生图规则生成并插入 ${n} 张图片。`);
  }
  if (opts.uiTemplateEnabled) {
    lines.push('正文结束后，按系统提供的当前变量 JSON 检查并输出本轮需要更新的变量。');
  }
  if (opts.storyPanelsEnabled) {
    lines.push('在有展示价值时按要求积极生成贴合剧情发展的 HTML/div 面板。');
  }
  lines.push('</next_response>');
  return lines.join('\n');
}

/**
 * 把文风文本注入一段 `<next_response>` 模板：
 * - 模板里有 `{{writing_style}}` 占位时替换它；
 * - 模板本身是 `<next_response>…</next_response>` 时，把文风插到闭标签之前；
 * - 否则把文风追加进模板，再包一层 `<next_response>`。
 * 文风为空时原样返回模板。
 */
export function injectWritingStyleIntoNextResponse(template: string, writingStyle: string): string {
  const style = (writingStyle ?? '').trim();
  if (!style) return template;
  if (template.includes('{{writing_style}}')) {
    return template.replace(/\{\{\s*writing_style\s*\}\}/gi, style);
  }
  if (/<\/next_response\s*>/i.test(template)) {
    return template.replace(/<\/next_response\s*>/i, `${style}\n</next_response>`);
  }
  const inner = stripNextResponse(template);
  return buildNextResponsePrompt({ writingStyle: [inner, style].filter(Boolean).join('\n') });
}
