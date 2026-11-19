/**
 * Streaming HTML truncation detection (B04).
 *
 * While a reply is still streaming, the model may stop mid-fence or mid-tag;
 * the sanitizer then silently drops the dangling fragment and the user sees a
 * half-rendered panel with no explanation. This helper answers one question —
 * "is the text below plausibly unfinished HTML?" — so the bubble can say so
 * instead of rendering a broken panel as if it were final.
 *
 * Pure string logic (no DOM), so it is unit-testable in node.
 */

/** Block tags whose balance we track; inline tags are noise for this check. */
const TRACKED_TAGS = new Set([
  'html',
  'body',
  'div',
  'details',
  'summary',
  'script',
  'style',
  'table',
  'svg',
  'pre',
  'section',
  'article',
  'blockquote',
]);

/**
 * True when `text` looks like unfinished HTML: an odd number of ``` fences
 * (one fence opened, never closed), or a tracked tag opened but not closed.
 * Fenced code blocks are excluded from the tag scan — a ``` block may
 * legitimately contain raw tags.
 */
export function hasUnclosedHtml(text: string): boolean {
  const source = String(text ?? '');
  // Unclosed code fence: an odd count of ``` markers.
  const fences = (source.match(/```/g) ?? []).length;
  if (fences % 2 === 1) return true;

  // Strip fenced blocks (complete or not) before scanning tags.
  const stripped = source.replace(/```[\s\S]*?(```|$)/g, '');
  const stack: string[] = [];
  const re = /<\/?([a-zA-Z][\w-]*)(?:\s[^>]*)?\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const full = m[0];
    const name = m[1].toLowerCase();
    if (!TRACKED_TAGS.has(name)) continue;
    if (full.startsWith('</')) {
      const idx = stack.lastIndexOf(name);
      if (idx !== -1) stack.splice(idx);
    } else if (!full.endsWith('/>')) {
      stack.push(name);
    }
  }
  return stack.length > 0;
}
