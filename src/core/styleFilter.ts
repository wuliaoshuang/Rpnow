/**
 * Style filter (B11 / M07) — RP-Hub parity.
 *
 * RP-Hub filters "八股" phrasing out of assistant replies: whole sentences
 * carrying a blocked cliché, the "N 个字" word-count aside, pale-finger
 * clauses, a few blocked clause openers, and the word 极其. Quoted dialogue
 * （“…” / 『…』 / "…"） is never touched, and standalone rendered content
 * (a full HTML document / code fence) is passed through untouched.
 *
 * Differences from RP-Hub (`app.js` `filterBlockedStyleText`):
 * - RP-Hub runs the replacements through `transformUnprotectedText`, which
 *   skips code spans / protected regions. Rpnow has no such helper, so the
 *   replacements run on the non-dialogue fragments directly.
 * - RP-Hub stops filtering before a `<ui_template_updates>` block; Rpnow
 *   strips that block before rendering, so there is nothing to preserve here.
 * - Filtering happens at render time (MessageBubble), not at generation time:
 *   the stored message keeps the model's original text, the bubble shows the
 *   filtered text, and the removed fragments are shown in the "文风过滤详情"
 *   popover. That is what makes the per-message hit list visible without
 *   touching the generation path.
 */

export interface StyleFilterResult {
  text: string;
  /** Fragments removed, in order (normalised, de-duplicated by the caller). */
  hits: string[];
}

const blockedStyleSentencePattern =
  /[^。！？!?\n]*(?:不容置疑|(?:不易|难以)(?:察觉|觉察)|(?:微|几)不可察|一抹|弧度|生理性|微微泛|因为用力|像在|风箱|手术刀|上扬|带着一种|语气很平|声音很平|(?:指尖|指节|指关节)[^。！？!?\n]*(?:发白|泛白)|像(?:是)?[^。！？!?\n]*?[，,]\s*又像(?:是)?|不是[^。！？!?\n]*?(?:而是|就是|[，,]\s*(?:是|(?:更|倒|反倒)?像是)))[^。！？!?\n]*(?:[。！？!?]+[”’」』】）)]*(?:\*\*|__)?)?/g;
const standaloneWordCountSentencePattern =
  /(^|[。！？!?\n]+[”’」』】）)]*)[ \t]*(?:\*\*|__)?(?:\d+|[零〇一二两三四五六七八九十百千万]+)个字[^。！？!?\n]*(?:[。！？!?]+[”’」』】）)]*(?:\*\*|__)?)?/gm;
const paleFingerClausePattern =
  /(?:^|[，,；;])[^，,。！？!?；;\n]*(?:指尖|指节|指关节)[^，,。！？!?；;\n]*(?:发白|泛白)[^，,。！？!?；;\n]*(?=$|[，,。！？!?；;\n])/gm;
const blockedStyleClausePattern =
  /(?:^|[，,；;])[^，,。！？!?；;\n*_]*(?:微微泛|因为用力|像在|风箱|手术刀|上扬|带着一种)[^，,。！？!?；;\n*_]*(?=(?:\*\*|__)?[ \t]*(?:$|[，,。！？!?；;\n]))/gm;
const blockedStyleWordPattern = /极其/g;
const quotedDialoguePattern = /(“[\s\S]*?”|『[\s\S]*?』|"[\s\S]*?")/g;

const standaloneRenderedContentPattern =
  /^(?:```|<!doctype\b|<\?xml\b|<html\b|<(?:head|body|style|script|template|svg|canvas|iframe|div|section|article|aside|header|footer|main|nav|form|table|ul|ol|pre|p|img)\b)/i;

/** A reply that is itself a rendered document / code block is not filtered. */
export function isStandaloneRenderedContent(text: string): boolean {
  let content = String(text || '').trimStart();
  while (content.startsWith('<!--')) {
    const end = content.indexOf('-->', 4);
    if (end < 0) return false;
    content = content.slice(end + 3).trimStart();
  }
  return standaloneRenderedContentPattern.test(content);
}

export function normalizeStyleFilterHit(fragment: string): string {
  return String(fragment || '')
    .trim()
    .replace(/^[，,；;]\s*/, '')
    .replace(/^(?:\*\*|__)/, '')
    .replace(/(?:\*\*|__)$/, '')
    .trim();
}

const styleFilterHighlightPattern =
  /(?:不容置疑|(?:不易|难以)(?:察觉|觉察)|(?:微|几)不可察|一抹|弧度|生理性|微微泛|因为用力|像在|风箱|手术刀|上扬|带着一种|语气很平|声音很平|(?:\d+|[零〇一二两三四五六七八九十百千万]+)个字|指尖|指节|指关节|发白|泛白|不是|而是|就是|又像(?:是)?|(?:更|倒|反倒)?像是|极其)/g;

/** Split one removed fragment into plain / matched segments for highlighting. */
export function getStyleFilterHitSegments(fragment: string): Array<{ text: string; matched: boolean }> {
  const text = String(fragment || '');
  const segments: Array<{ text: string; matched: boolean }> = [];
  let lastIndex = 0;
  for (const match of text.matchAll(styleFilterHighlightPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) segments.push({ text: text.slice(lastIndex, index), matched: false });
    segments.push({ text: match[0], matched: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex), matched: false });
  return segments.length ? segments : [{ text, matched: false }];
}

/**
 * Remove blocked style fragments from `text`.
 * `enabled === false` returns the text untouched (M07 switch off).
 *
 * HTML 注释（`<!-- ... -->`）原样保留、不过滤：注释是机器读的隐藏数据，
 * 不是给人看的正文——比如小手机的 `[小手机数据]` 块、剧情选项块，里面
 * 的引号和逗号是 JSON 语法。过滤是按引号切分“对话内 / 对话外”再清理
 * 行首标点的，注释里的 `","` 会落在“对话外”片段里被当成行首标点删掉，
 * 块的 JSON 就坏了（字段间的逗号全没了）；注释里引号个数是奇数时，还会
 * 把后面正文的对话内外判反。所以先按注释切段，只过滤注释之外的正文。
 */
export function filterBlockedStyleText(
  text: string,
  opts?: { enabled?: boolean; collect?: string[] },
): string {
  const source = String(text || '');
  if (opts?.enabled === false) return source;
  if (isStandaloneRenderedContent(source)) return source;
  const removedFragments: string[] = [];
  // 没闭合的注释匹配不上这段切分，会留在正文片段里正常过滤——解析时
  // 本来就会把它当作没有这个块，不影响。
  const filtered = source
    .split(/(<!--[\s\S]*?-->)/g)
    .map((segment) =>
      segment.startsWith('<!--') && segment.endsWith('-->')
        ? segment
        : filterProseFragment(segment, removedFragments),
    )
    .join('');
  if (opts?.collect) {
    opts.collect.push(...removedFragments.map(normalizeStyleFilterHit).filter(Boolean));
  }
  return filtered;
}

/**
 * 过滤一段正文（不含 HTML 注释）：引号里的对话原样保留，引号外的部分
 * 按文风规则删。`removedFragments` 由调用方传进来收被删的片段。
 */
function filterProseFragment(fragment: string, removedFragments: string[]): string {
  return fragment
    .split(quotedDialoguePattern)
    .map((part, index) =>
      index % 2
        ? part
        : part
            .replace(standaloneWordCountSentencePattern, (match, prefix = '') => {
              removedFragments.push(match.slice(prefix.length).trim());
              return prefix;
            })
            .replace(blockedStyleSentencePattern, (match) => {
              removedFragments.push(match.trim());
              return '';
            })
            .replace(paleFingerClausePattern, (match) => {
              removedFragments.push(match.trim());
              return '';
            })
            .replace(blockedStyleClausePattern, (match) => {
              removedFragments.push(match.trim());
              return '';
            })
            .replace(blockedStyleWordPattern, (match) => {
              removedFragments.push(match);
              return '';
            })
            .replace(/^[ \t]*[，,；;]+/gm, '')
            .replace(/[，,；;]{2,}/g, (marks) => marks.at(-1) ?? marks)
            .replace(/[，,；;]+([。！？!?])/g, '$1')
            .replace(/[ \t]+\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n'),
    )
    .join('');
}

/** Filter + collect hits in one call. */
export function filterStyleText(text: string, enabled = true): StyleFilterResult {
  const hits: string[] = [];
  const filtered = filterBlockedStyleText(text, { enabled, collect: hits });
  return { text: filtered, hits };
}
