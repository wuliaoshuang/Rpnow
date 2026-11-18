/**
 * Chain-of-thought parsing.
 *
 * Some providers (DeepSeek, GLM, Kimi, and various OpenAI-compatible gateways)
 * return their reasoning *inside* `content`, wrapped in `<think>…</think>`,
 * `<thinking>…</thinking>` or `<cot>…</cot>`. Left alone, that text is rendered
 * to the user and copied into edits.
 *
 * `parseCot` splits it out. Code fences and HTML comments are protected, because
 * a code sample may legitimately contain the literal text `<think>`.
 */

export type CotTag = 'think' | 'thinking' | 'cot';

export interface ParsedCot {
  /** Reasoning text without the wrapping tags. */
  reasoning: string;
  /** Body with reasoning segments removed. */
  main: string;
  /** True when at least one reasoning segment was found. */
  hasReasoning: boolean;
}

/** Models that emit inline CoT through OpenAI-compatible endpoints. */
export function usesThinkingCotTag(model: string): boolean {
  return /deepseek|glm|kimi|moonshot|qwen|ernie|hunyuan|baichuan|spark|stepfun|ministral/i.test(model);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove a `<tag>…</tag>` span, ignoring occurrences inside code fences or
 * HTML comments.
 */
function stripTaggedBlocks(text: string, tag: CotTag): { text: string; found: string[] } {
  const found: string[] = [];
  const global = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');

  // Protect fenced code and HTML comments by temporarily replacing them.
  const protectedBlocks: string[] = [];
  const stash = (snippet: string) => {
    protectedBlocks.push(snippet);
    return `\u0000RP_PROTECT_${protectedBlocks.length - 1}\u0000`;
  };
  let working = text
    .replace(/```[\s\S]*?(?:```|$)/g, stash)
    .replace(/`[^`\n]*`/g, stash)
    .replace(/<!--[\s\S]*?-->/g, stash);

  working = working.replace(global, (_match, body: string) => {
    found.push(String(body).trim());
    // Keep the surrounding prose as separate paragraphs.
    return '\n\n';
  });

  // Restore protected snippets.
  working = working.replace(/\u0000RP_PROTECT_(\d+)\u0000/g, (_m, i: string) => protectedBlocks[Number(i)] ?? '');
  return { text: working, found };
}

/** Split inline reasoning from the body. */
export function parseCot(text: string): ParsedCot {
  if (!text) return { reasoning: '', main: '', hasReasoning: false };
  const reasoning: string[] = [];
  let main = text;
  for (const tag of ['thinking', 'think', 'cot'] as CotTag[]) {
    const result = stripTaggedBlocks(main, tag);
    main = result.text;
    reasoning.push(...result.found);
  }
  const joined = reasoning.filter(Boolean).join('\n\n').trim();
  return {
    reasoning: joined,
    main: main.replace(/\n{3,}/g, '\n\n').trim(),
    hasReasoning: joined.length > 0,
  };
}

/** Remove reasoning segments only (keeps whitespace normalisation light). */
export function stripCot(text: string): string {
  return parseCot(text).main;
}

/** Build the tag a prompt should ask for, per model. */
export function cotTagFor(model: string): CotTag {
  return usesThinkingCotTag(model) ? 'thinking' : 'cot';
}

/** Escape a tag name for use inside a regular expression. */
export function cotTagPattern(tag: CotTag): string {
  return escapeRegExp(tag);
}
