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

const STYLE_OPEN = '<style';
const STYLE_CLOSE = '</style>';

/** Replace `<style>…</style>` with a placeholder that survives Markdown. */
export function encodeStyleTags(input: string): { text: string; styles: string[] } {
  const styles: string[] = [];
  const text = input.replace(new RegExp(`${STYLE_OPEN}([\\s\\S]*?)${STYLE_CLOSE}`, 'gi'), (_m, css: string) => {
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

/** Remove rules that can escape the message container or phone home. */
export function scopeCss(css: string, scope: string, allowExternal: boolean): string {
  // Drop @import entirely — it is remote code execution by URL.
  let out = css.replace(/@import[^;]*;/gi, '');
  if (!allowExternal) {
    // Remove declarations that reference remote resources.
    out = out.replace(/[a-z-]+\s*:\s*[^;}]*:\/\/[^;}]*;?/gi, '');
  }
  // Rewrite selectors: `body`, `html`, `:root` become the scope itself, and
  // every other selector is prefixed with the scope.
  out = out.replace(/(^|\})([^{}]+)\{/g, (_m, brace: string, selectors: string) => {
    const rewritten = selectors
      .split(',')
      .map((selRaw) => {
        const sel = selRaw.trim();
        if (!sel) return sel;
        if (/^(body|html|:root)\b/i.test(sel)) {
          return sel.replace(/^(body|html|:root)/i, scope);
        }
        // Already namespaced classes get their prefix applied too.
        const withCustom = sel.replace(/\.([A-Za-z_][\w-]*)/g, (_x, name: string) =>
          CLASS_ALLOW_EXACT.includes(name) || CLASS_ALLOW_PREFIXES.some((p) => name.startsWith(p)) || name.startsWith('rp-') || name.startsWith('custom-')
            ? `.${name}`
            : `.custom-${name}`,
        );
        if (withCustom.startsWith(scope)) return withCustom;
        if (/^(from|to|\d+%|@)/.test(withCustom)) return selRaw;
        return `${scope} ${withCustom}`;
      })
      .join(', ');
    return `${brace}${rewritten}{`;
  });
  return out;
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
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'base', 'link', 'meta'],
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

/** True when the message is a complete HTML document (RP-Hub's card panels). */
export function isFullHtmlDocument(markdown: string): boolean {
  const t = markdown.trim().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html');
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

/** Sandbox flags: scripts and forms are allowed, but the document is isolated. */
const FRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-same-origin allow-downloads';

/** Wrap an HTML fragment in an isolated, self-contained frame document. */
export function htmlCardFrame(innerHtml: string, css = ''): string {
  const doc = renderSandboxedFrame(innerHtml, css);
  const src = `data:text/html;charset=utf-8,${encodeURIComponent(doc)}`;
  /*
   * RPNow 自己的容器类名。过去这里叫 `TH-render` 以兼容酒馆助手，兼容层停用后
   * 不再需要那个名字（见 core/st-compat.ts）。
   */
  return (
    `<div class="rp-frontend-render">` +
    `<div class="rp-html-card"><iframe title="HTML 卡片" sandbox="${FRAME_SANDBOX}" src="${src}" style="width:100%;height:320px;border:0;border-radius:var(--radius-md);overflow:hidden"></iframe></div>` +
    `</div>`
  );
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

/**
 * Replace ```` ```html ```` fences with placeholders.
 *
 * History / why this is not an HTML comment: the previous version left
 * `<!--RPHTMLCARD:n-->` markers for `restoreHtmlCards`, but DOMPurify strips
 * comments, so every fenced block silently rendered as nothing. The placeholder
 * is now a real element (`<rp-html-card data-rp-html="n">`) which survives
 * sanitisation (it is whitelisted) and is swapped for the iframe afterwards.
 *
 * The fence regex also accepts ```` ```HTML ````, an optional trailing newline
 * and EOF-without-closing-fence (models often truncate the last backticks).
 */
function sandboxHtmlFences(markdown: string): { text: string; codes: string[] } {
  const codes: string[] = [];
  const card = (code: string) => {
    codes.push(code);
    return `\n\n<rp-html-card data-rp-html="${codes.length - 1}"></rp-html-card>\n\n`;
  };
  /*
   * Fence shapes that produce an HTML card:
   *  1. ```html / ```htm — the explicit language tag;
   *  2. a BARE fence whose content starts with an HTML document — preset
   *     regexes like Meowssiah's 思维链折叠 emit exactly this (``` \n <!DOCTYPE
   *     html> …) and ST's renderer picks them up by CONTENT, not language tag.
   *
   * Real transcripts interleave BOTH shapes and preset regexes routinely emit
   * an odd number of ``` markers (a closing fence with no opener), which breaks
   * pairwise matching: marked then swallows prose + the next fence into ONE
   * giant code block. So instead of matching `fence…fence` pairs, we scan line
   * by line and let CONTENT decide — a fence line followed by an HTML document
   * starts a card that ends at `</html>`, the next fence marker, or EOF.
   */
  const lines = markdown.split('\n');
  const outLines: string[] = [];
  let i = 0;
  /*
   * Fence lines in the wild are NOT always clean. Preset regexes glue the
   * closing fence to the next prose tag: "```<game>正午…". A line-anchored
   * regex misses it, so the scanner never sees the boundary and merges two
   * documents into one card. We therefore detect a fence START anywhere in a
   * line (``` or ```html …) and a fence CLOSE as a line that CONTAINS ```
   * after the body has begun.
   */
  const startMatch = /(^|\s)```[ \t]*([a-z]*)[ \t]*$/i; // line ENDS with a fence opener
  const containsClose = /```/; // any fence marker ends the card body
  const docStart = /^\s*(?:<!DOCTYPE html|<html\b)/i; // bare document start
  while (i < lines.length) {
    const line = lines[i];
    const m = startMatch.exec(line);
    if (!m) {
      /*
       * Bare document, no fence at all: Meowssiah's 思维链折叠 replacement text
       * can lose its opening fence (an earlier regex eats it, or the model
       * emits the document straight after prose — on device the transcript
       * literally starts "24 分钟前<!DOCTYPE html>"). ST renders the document
       * by CONTENT, so we must too: a line that starts a full document opens a
       * card ending at </html>.
       */
      if (docStart.test(line)) {
        const body: string[] = [];
        let j = i;
        while (j < lines.length) {
          body.push(lines[j]);
          if (/<\/html>\s*$/i.test(lines[j])) break;
          j++;
        }
        const text = body.join('\n');
        if (isFullHtmlDocument(text)) {
          outLines.push(card(text));
          i = j + 1;
          continue;
        }
      }
      outLines.push(line);
      i++;
      continue;
    }
    const lang = m[2].toLowerCase();
    if (lang && lang !== 'html' && lang !== 'htm') {
      outLines.push(line);
      i++;
      continue;
    }
    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      const l = lines[j];
      if (containsClose.test(l)) {
        closed = true;
        break;
      }
      body.push(l);
      if (/<\/html>\s*$/i.test(l)) break; // document complete
      j++;
    }
    const text = body.join('\n');
    const isCard =
      lang === 'html' || lang === 'htm' || isFullHtmlDocument(text) || /^\s*<(?:html|body|div|section|style)\b/i.test(text);
    if (!isCard) {
      outLines.push(line);
      i++;
      continue;
    }
    outLines.push(card(text));
    i = closed ? j + 1 : j;
  }
  return { text: outLines.join('\n'), codes };
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

    // Whole-document HTML (a card shipping a full panel) goes straight to a
    // frame; prose around it is not expected.
    if (sandbox && isFullHtmlDocument(markdown)) {
      const inner = DOMPurify.sanitize(markdown, {
        ADD_TAGS: ['html', 'head', 'body', 'style', 'details', 'summary', 'iframe', 'svg', 'path', 'g', 'circle', 'rect', 'defs', 'linearGradient', 'stop'],
        FORBID_ATTR: ['onmouseover', 'onload'],
      }) as unknown as string;
      const framed = htmlCardFrame(inner);
      renderCache.set(key, framed);
      trimCache();
      return framed;
    }

    const { text, styles } = encodeStyleTags(markdown);

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
     *
     * Fenced/bare HTML documents are exempt — they are extracted AFTER this
     * escape, so their tags stay live inside the iframe.
     */
    const escapedCustom = escapeCustomTags(text);

    const fenceResult = sandbox ? sandboxHtmlFences(escapedCustom) : { text: escapedCustom, codes: [] };
    const fenceCodes = fenceResult.codes;
    const textWithoutFences = fenceResult.text;

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
    dropSourcelessMedia(container);
    let out = container.innerHTML;
    out = decodeStyleCarriers(out, scope, allowExternal);
    if (sandbox) out = restoreHtmlCards(out, fenceCodes);
    /*
     * 内容级兜底：命中判定的 `pre > code` 一律渲染成 RPNow 的 HTML 卡片。
     *
     * 早期这里有一个「让路给酒馆助手」的分支（检测到 ST 扩展在跑就保留 pre）。
     * 兼容层已停用（core/st-compat.ts），现在**总是**由 RPNow 自己渲染，
     * 保证 preset 产出的文档不会退化成源码文本。
     */
    out = sandboxDetectedFrontendCode(out);

    // Strip remote media if the user has not enabled it.
    if (!allowExternal) {
      out = out.replace(/<img\b[^>]*data-rp-remote="1"[^>]*>/gi, '');
      out = out.replace(/(<img\b[^>]*\bsrc=")(https?:)?\/\/[^"]*("[^>]*>)/gi, '$1$3');
    } else {
      out = out.replace(/\sdata-rp-remote="1"/g, '');
    }

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
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}\nhtml,body{margin:0;padding:8px;font:14px/1.6 system-ui,sans-serif;color:#e8e3f0;background:transparent}</style></head><body>${html}</body></html>`;
}

/** Extract ```html fences so the UI can offer an "open preview" action. */
export function extractHtmlFences(markdown: string): string[] {
  const out: string[] = [];
  const re = /```html\s*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown))) out.push(m[1]);
  return out;
}
