/**
 * Message renderer.
 *
 * Roleplay output is not plain Markdown — cards emit raw HTML, `<style>` blocks,
 * and custom tags (`<StatusPlaceHolderImpl/>`, `<xy-dialog>`). This module
 * reproduces the pipeline that makes those render *and* stay safe:
 *
 *   1. extract `<style>` into an inert carrier before Markdown parsing
 *      (otherwise the Markdown parser mangles CSS),
 *   2. render Markdown with GFM + single-newline breaks (roleplay prose relies
 *      on it) and raw HTML passthrough,
 *   3. sanitize with DOMPurify's default allow-list (no custom ALLOWED_TAGS —
 *      that is how XSS gets in),
 *   4. namespace CSS classes so card styles cannot hijack host UI classes,
 *   5. restore `<style>` with every selector scoped to the message container,
 *   6. force safe link targets.
 *
 * Class namespacing and selector scoping are the two mechanisms that make
 * untrusted card CSS containable without an iframe.
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import type { RendererOptions, RendererService } from '../agent/types.js';
import { installCardFrameHost } from './cardFrameHost.js';
import { buildFrameDocument, extractHtmlCards, htmlCardMarkup, isFullHtmlDocument } from './htmlDocument.js';
import { sanitizeInlineStyle, scopeCss } from './scopeCss.js';

export { isFullHtmlDocument } from './htmlDocument.js';
export { scopeCss } from './scopeCss.js';

/**
 * Configure `marked` once. `breaks: true` matches the ecosystem's
 * `simpleLineBreaks` behaviour: a newline stays a newline in prose.
 *
 * Indented code blocks are disabled on purpose: roleplay cards routinely embed
 * indented HTML panels (`<details>`, `<summary>`, nested `<div>`), and a 4-space
 * indent would otherwise swallow them into a `<pre><code>` block. Fenced code
 * still works.
 */
// NOTE: RP-Hub disables indented code blocks (`tokenizer.code() { return
// undefined }`) so indented card HTML renders as HTML. This marked version
// rejects that override (it must not lose the rest of the tokenizer), so RPNow
// keeps indented code and cards should use fenced ```html blocks instead.

/**
 * Replace `<style>…</style>` with a placeholder that survives Markdown.
 *
 * Two things the old pattern (`<style([\s\S]*?)</style>`) got wrong:
 *   - it captured the tag's own attributes and closing `>` as CSS, so the first
 *     rule of every sheet came out as `.rp-md >selector` and silently died;
 *   - a `<style>` with no closing tag (truncated card, or a reply still being
 *     streamed) was not captured at all. DOMPurify's default allow-list lets
 *     `<style>` through, so that sheet landed in the page UNSCOPED and restyled
 *     the whole app (`textarea{…}` hit the composer). An unclosed block now
 *     runs to the end of the text; `</style >` with whitespace also closes it.
 */
export function encodeStyleTags(input: string): { text: string; styles: string[] } {
  const styles: string[] = [];
  const text = input.replace(/<style\b[^>]*>([\s\S]*?)(?:<\/style\s*>|$)/gi, (_m, css: string) => {
    styles.push(css);
    return `\n\n<!--RPSTYLE:${styles.length - 1}-->\n\n`;
  });
  return { text, styles };
}

/** Reinsert styles as `<custom-style>` carriers keyed by index. */
export function restoreStyleCarriers(html: string, styles: string[]): string {
  return html.replace(/<!--RPSTYLE:(\d+)-->/g, (_m, idx: string) => {
    const css = styles[Number(idx)];
    if (css === undefined) return '';
    // encodeURIComponent keeps the CSS inert while it passes sanitization.
    return `<custom-style data-rp-style="${Number(idx)}">${encodeURIComponent(css)}</custom-style>`;
  });
}

/** Classes the renderer intentionally leaves unprefixed. */
const CLASS_ALLOW_PREFIXES = ['fa-', 'note-'];
const CLASS_ALLOW_EXACT = ['monospace'];

/**
 * Namespace every class on untrusted nodes so a card cannot write
 * `class="btn"` and inherit the app's button styling. This mirrors the
 * mitigation SillyTavern applies in its sanitizer hook.
 */
export function namespaceClasses(root: ParentNode): void {
  const walker = (root as Document).createTreeWalker
    ? (root as Document).createTreeWalker(root as Node, NodeFilter.SHOW_ELEMENT)
    : null;
  const elements: Element[] = [];
  if (walker) {
    let node = walker.currentNode as Element | null;
    while (node) {
      elements.push(node);
      node = walker.nextNode() as Element | null;
    }
  }
  for (const el of Array.from((root as Element).querySelectorAll?.('*') ?? []).concat(elements)) {
    const cls = el.getAttribute('class');
    if (!cls) continue;
    const next = cls
      .split(/\s+/)
      .filter(Boolean)
      .map((c) =>
        CLASS_ALLOW_EXACT.includes(c) || CLASS_ALLOW_PREFIXES.some((p) => c.startsWith(p)) || c.startsWith('rp-')
          ? c
          : `custom-${c}`,
      )
      .join(' ');
    el.setAttribute('class', next);
  }
}

/**
 * Apply the stylesheet rules to inline `style="…"` attributes as well.
 *
 * Scoping selectors does nothing for `<div style="position:fixed;inset:0">`:
 * that panel would pin itself over the app chrome. Inline declarations go
 * through the same filter as sheet declarations (fixed → absolute, viewport
 * widths → percentages, remote URLs dropped unless external media is on).
 */
export function containInlineStyles(root: ParentNode, allowExternal: boolean): void {
  const query = (root as Element).querySelectorAll?.bind(root as Element);
  if (!query) return;
  for (const el of Array.from(query('[style]'))) {
    const raw = el.getAttribute('style') ?? '';
    if (!/fixed|vw|\/\/|expression|javascript/i.test(raw)) continue;
    const next = sanitizeInlineStyle(raw, allowExternal);
    if (next) el.setAttribute('style', next);
    else el.removeAttribute('style');
  }
}

/**
 * Drop media elements that can never show anything.
 *
 * A `<video>` / `<audio>` with no `src` and no `<source>` child, or an
 * `<img>` with no usable `src`, renders as a dead box: on Android WebView a
 * sourceless `<video>` is a small black rectangle with a filmstrip icon
 * (reported 2026-11-19 on the 李淑纯 greeting — the greeting prose itself
 * contains no media at all; the tag arrives via the card / stored message).
 * Removing them here keeps the bubble clean regardless of where the tag came
 * from. A `<video>` with a `poster` is kept when the poster survives
 * sanitisation (it can still show its still); in practice DOMPurify's
 * default allow-list strips `poster`, so such a tag is dropped as well.
 */
export function dropSourcelessMedia(root: ParentNode): void {
  const query = (root as Element).querySelectorAll?.bind(root as Element);
  if (!query) return;
  for (const el of Array.from(query('video, audio, img'))) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'img') {
      const src = el.getAttribute('src');
      if (src === null || src.trim() === '') el.remove();
      continue;
    }
    const src = el.getAttribute('src');
    if (src !== null && src.trim() !== '') continue;
    if (el.querySelector('source[src]')) continue;
    if (tag === 'video' && el.getAttribute('poster')) continue;
    el.remove();
  }
}

/** Convert `<custom-style>` carriers back into scoped `<style>` elements. */
export function decodeStyleCarriers(html: string, scope: string, allowExternal: boolean): string {
  return html.replace(
    /<custom-style[^>]*>([\s\S]*?)<\/custom-style>/gi,
    (_m, encoded: string) => {
      let css: string;
      try {
        css = decodeURIComponent(encoded);
      } catch {
        return '';
      }
      return `<style>${scopeCss(css, scope, allowExternal)}</style>`;
    },
  );
}

/** Sanitizer configuration — default allow-list plus deliberate additions. */
function sanitizeConfig(): Record<string, unknown> {
  return {
    // `rp-html-card` is our own placeholder for fenced HTML blocks; it survives
    // sanitisation and is replaced by a sandboxed iframe right after.
    ADD_TAGS: ['custom-style', 'rp-html-card'],
    ADD_ATTR: ['data-rp-style', 'data-selected', 'data-rp-html'],
    // Never allow script-capable containers to pass through.
    // `style` is forbidden too: card styles travel as `custom-style` carriers
    // and come back scoped. A raw `<style>` reaching this point was missed by
    // `encodeStyleTags` and must not land in the page unscoped.
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'base', 'link', 'meta'],
    // Keep data-* attributes (our own carriers use them).
    ALLOW_DATA_ATTR: true,
  };
}

let hooksInstalled = false;

/** Install global DOMPurify hooks once: link targets + external media policy. */
function installHooks(): void {
  if (hooksInstalled) return;
  hooksInstalled = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
      const href = node.getAttribute('href') ?? '';
      if (/^\s*(javascript|vbscript|data):/i.test(href)) node.removeAttribute('href');
    }
    if (node.tagName === 'IMG' || node.tagName === 'VIDEO' || node.tagName === 'AUDIO' || node.tagName === 'SOURCE') {
      const src = node.getAttribute('src') ?? node.getAttribute('data-src') ?? '';
      const isRemote = /^(https?:)?\/\//i.test(src);
      const isSafeData = /^data:image\/(png|jpe?g|webp|gif|avif);base64,/i.test(src);
      if (isRemote && !(node as HTMLElement).dataset.rpAllowRemote) {
        // Reinforced by the caller when external media is enabled.
        node.setAttribute('data-rp-remote', '1');
      }
      if (!isRemote && !isSafeData && src) {
        node.removeAttribute('src');
      }
    }
  });
}

/**
 * Tags with real rendering semantics that the layout itself consumes. Anything
 * else that looks like a tag is preset scripting (game markers, thinking
 * blocks, option lists injected by the AI) and gets ESCAPED.
 */
const HTML_SEMANTIC_TAGS = new Set([
  'html', 'head', 'body', 'style', 'script', 'link', 'meta', 'title', 'base',
  'div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'a', 'img', 'b', 'strong', 'i', 'em', 'u', 's', 'small', 'sub', 'sup',
  'blockquote', 'pre', 'code', 'details', 'summary', 'section', 'article', 'aside',
  'header', 'footer', 'nav', 'main', 'figure', 'figcaption', 'button', 'label',
  'svg', 'path', 'g', 'circle', 'rect', 'defs', 'lineargradient', 'stop', 'use',
  'iframe', 'video', 'audio', 'source', 'canvas',
  'font', 'center', 'marquee', 'ruby', 'rt', 'rp', 'wbr', 'q', 'cite', 'abbr',
  // Form controls are real HTML, not preset markers. They used to be escaped
  // into visible `<input type="radio" …>` text; now the sanitizer decides
  // (inline rendering drops them, framed cards keep them working).
  'form', 'input', 'textarea', 'select', 'option', 'optgroup', 'fieldset', 'legend', 'datalist',
  // Our own placeholder for a framed card (see htmlDocument.ts).
  'rp-html-card',
]);

/**
 * Escape preset-invented tags so marked/DOMPurify cannot eat or reinterpret
 * them. `<game>…</game>` keeps its angle brackets as visible text; `<li>`
 * inside `<options>` is preset syntax, but a plain `<li>` in real prose still
 * renders (the tag name check is against the HTML semantic set).
 */
function escapeCustomTags(text: string): string {
  return text.replace(/<\/?([a-zA-Z][a-zA-Z0-9_-]*)([^>]*)>/g, (match, name: string) => {
    if (HTML_SEMANTIC_TAGS.has(name.toLowerCase())) return match;
    return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
}

/**
 * 去掉预设自定义标签的尖括号标记，只留里面的字。
 *
 * 只用在「消息以一个 HTML 页面开头」的情况（典型：Meowssiah 的思维链折叠栏
 * 后面跟着 `<game>正文</game>`）。以前这种消息整条塞进一个 iframe，里面的
 * `<game>` 被清洗掉、只剩正文；现在页面单独装框、正文回到气泡里，如果照常
 * 转义，用户会突然看到一对 `<game>` `</game>` 字样。这里保持原来的观感。
 */
function stripCustomTags(text: string): string {
  return text.replace(/<\/?([a-zA-Z][a-zA-Z0-9_-]*)([^>]*)>/g, (match, name: string) =>
    HTML_SEMANTIC_TAGS.has(name.toLowerCase()) ? match : '',
  );
}

/**
 * Wrap card HTML in an isolated, self-sizing frame.
 *
 * The markup, sandbox flags and bridge live in `htmlDocument.ts`. This wrapper
 * also makes sure the host-side message listener is installed, so the frame
 * can report its height.
 */
export function htmlCardFrame(innerHtml: string, css = ''): string {
  installCardFrameHost();
  return htmlCardMarkup(css ? `<style>${css}</style>${innerHtml}` : innerHtml);
}

/**
 * 判断 `pre > code` 的文本是否是「前端文档」（完整 HTML 页面）。
 *
 * 判据复刻自酒馆助手的 `Ck`（`['html>','<head>','body'].some(...)`，大小写敏感、
 * 作用于 pre 文本）——同口径判定让任何形状的模型输出都能被接管；但渲染完全由
 * RPNow 自己做，与酒馆助手无关（兼容层已停用）。
 */
export function isFrontendDocumentText(text: string): boolean {
  return ['html>', '<head>', '<body'].some((s) => text.includes(s));
}

/**
 * DOM 级兜底：把 `.mes_text` 内命中判定的 `pre > code` 换成 RPNow 的 HTML 卡片。
 *
 * 为什么不只依赖围栏预处理：preset 正则产出的文档可能没有围栏（模型少打一个
 * ```、或被其它正则吃掉），此时 marked 只会渲染成普通代码块，页面就把
 * `<!DOCTYPE html>` 当源码文本显示出来——用户看到的正是「完全不能用」。
 */
export function sandboxDetectedFrontendCode(html: string): string {
  const host = document.createElement('div');
  host.innerHTML = html;
  let changed = false;
  for (const pre of Array.from(host.querySelectorAll('pre'))) {
    const code = pre.querySelector(':scope > code');
    if (!code) continue;
    const text = code.textContent ?? '';
    if (!isFrontendDocumentText(text)) continue;
    // 已是卡片的跳过（避免二次包装）
    if (pre.closest('.rp-frontend-render')) continue;
    const card = document.createElement('div');
    card.innerHTML = htmlCardFrame(text);
    pre.replaceWith(card.firstElementChild!);
    changed = true;
  }
  return changed ? host.innerHTML : html;
}

/** Restore placeholder elements into real iframe markup. */
function restoreHtmlCards(html: string, codes: string[]): string {
  return html.replace(
    /<rp-html-card[^>]*\bdata-rp-html="(\d+)"[^>]*>(?:\s*<\/rp-html-card>)?/gi,
    (_m, i: string) => htmlCardFrame(codes[Number(i)] ?? ''),
  );
}

/**
 * Render cache (LRU, 2000 entries). Rendering runs DOMPurify + DOM work, so a
 * long chat re-rendering on every keystroke is the hottest path in the app.
 */
const renderCache = new Map<string, string>();
const RENDER_CACHE_LIMIT = 2000;

function cacheKey(markdown: string, opts: RendererOptions): string {
  return `${opts.allowExternalMedia ? 1 : 0}|${opts.styleScope ?? ''}|${opts.sandboxHtml ? 1 : 0}|${markdown.length}|${markdown}`;
}

/** Default renderer implementation. */
export const defaultRenderer: RendererService = {
  render(markdown: string, opts: RendererOptions = {}): string {
    installHooks();
    const allowExternal = opts.allowExternalMedia ?? false;
    const scope = opts.styleScope ?? '.rp-md';
    if (!markdown) return '';

    const key = cacheKey(markdown, opts);
    const cached = renderCache.get(key);
    if (cached !== undefined) {
      renderCache.delete(key);
      renderCache.set(key, cached);
      return cached;
    }

    const sandbox = opts.sandboxHtml ?? false;

    /*
     * Pull every part that must run in a frame out of the text FIRST, while it
     * is still the card's original source: fenced HTML, a full HTML document
     * anywhere in the message (prose before/after stays prose), and fragments
     * that carry a script or form controls.
     *
     * This used to happen after `encodeStyleTags` + `escapeCustomTags`, which
     * damaged the framed source: its `<style>` blocks were swapped for
     * placeholders (the frame lost its styling) and `<input>` / `<textarea>`
     * were escaped into literal text (the card script then crashed looking
     * for them). A message that was nothing but a document took a third path
     * that ran it through DOMPurify — scripts removed, `<head>` styles lost —
     * so an interactive greeting showed up as an empty shell.
     */
    const cards = sandbox ? extractHtmlCards(markdown) : { text: markdown, codes: [] };
    const fenceCodes = cards.codes;

    const { text, styles } = encodeStyleTags(cards.text);

    /*
     * Escape preset-custom tags BEFORE marked sees them.
     *
     * Roleplay presets invent XML-ish markers (`<game>`, `<background>`,
     * `<options>`, `<think_nya>`, …). marked treats any leading-alphabetic tag
     * as raw HTML and passes it through, so `<options><li>…` became a live
     * list and DOMPurify stripped the wrappers of the others — the preset's
     * structure markers vanished or turned into unintended markup ("标记被渲
     * 成整个 HTML"). The fix mirrors ST: only REAL html semantics survive into
     * the renderer; everything else is shown to the user as literal text.
     */
    const leadingDocument = cards.codes.length > 0 && isFullHtmlDocument(markdown);
    const textWithoutFences = escapeCustomTags(leadingDocument ? stripCustomTags(text) : text);

    // Preserve fenced code blocks verbatim while still rendering raw HTML
    // elsewhere; `marked` passes HTML through when it looks like a block tag.
    let html = marked.parse(textWithoutFences, { async: false }) as string;

    // Custom (unknown) tags: real HTML tags we do not wrap, but we insert <br>
    // for newlines inside them, which is how status bars survive.
    html = restoreStyleCarriers(html, styles);

    const clean = DOMPurify.sanitize(html, sanitizeConfig()) as unknown as string;

    // Namespace + scope in the DOM so we can use real selectors.
    const container = document.createElement('div');
    container.innerHTML = clean;
    namespaceClasses(container);
    containInlineStyles(container, allowExternal);
    dropSourcelessMedia(container);
    let out = container.innerHTML;
    out = decodeStyleCarriers(out, scope, allowExternal);
    // Strip remote media if the user has not enabled it. This runs BEFORE the
    // framed cards are put back, so it only ever touches inline content.
    if (!allowExternal) {
      out = out.replace(/<img\b[^>]*data-rp-remote="1"[^>]*>/gi, '');
      out = out.replace(/(<img\b[^>]*\bsrc=")(https?:)?\/\/[^"]*("[^>]*>)/gi, '$1$3');
    } else {
      out = out.replace(/\sdata-rp-remote="1"/g, '');
    }

    if (sandbox) out = restoreHtmlCards(out, fenceCodes);
    /*
     * 内容级兜底：命中判定的 `pre > code` 一律渲染成 RPNow 的 HTML 卡片。
     *
     * 早期这里有一个「让路给酒馆助手」的分支（检测到 ST 扩展在跑就保留 pre）。
     * 兼容层已停用（core/st-compat.ts），现在**总是**由 RPNow 自己渲染，
     * 保证 preset 产出的文档不会退化成源码文本。
     */
    out = sandboxDetectedFrontendCode(out);

    renderCache.set(key, out);
    trimCache();
    return out;
  },
};

function trimCache(): void {
  while (renderCache.size > RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next().value;
    if (oldest === undefined) break;
    renderCache.delete(oldest);
  }
}

/** Drop cached renders (settings or scripts changed). */
export function clearRenderCache(): void {
  renderCache.clear();
}

/**
 * Render an HTML-fence as an isolated document for the optional sandboxed
 * preview. Used for card-provided HTML the user explicitly opens.
 */
export function renderSandboxedFrame(html: string, css = ''): string {
  return buildFrameDocument(css ? `<style>${css}</style>${html}` : html);
}

/** Extract ```html fences so the UI can offer an "open preview" action. */
export function extractHtmlFences(markdown: string): string[] {
  const out: string[] = [];
  const re = /```html\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) out.push(m[1]);
  return out;
}
