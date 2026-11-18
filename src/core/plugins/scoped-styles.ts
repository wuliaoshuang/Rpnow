/**
 * Scoped stylesheet injection for plugins.
 *
 * The problem: a plugin ships a stylesheet; we drop it into `document.head` and
 * its selectors are global. `body { padding: 3px }` in a plugin then pushes the
 * *entire app* inward — that is one of the real bugs this module exists to stop.
 *
 * The fix is the same idea as Vue's scoped CSS, applied without a compiler:
 *
 *   1. Every selector in the sheet gets a **scope attribute** appended:
 *      `.foo` → `.foo[data-rp-scope="pluginId"]`, `html` / `:root` / `body`
 *      is rewritten to the scope *host* element itself so a plugin can still
 *      style "the page" without touching the real <body>.
 *   2. Every rule is wrapped in `@layer rp-plugin-<id>` so plugin declarations
 *      always lose to the app's own styles regardless of specificity.
 *   3. `@media` / `@supports` / `@container` blocks are descended into; `@keyframes`
 *      and `@font-face` are renamed/namespaced instead of scoped.
 *
 * This is deliberately a *text* transform (no CSSOM round-trip), so it works on
 * minified one-line sheets and keeps selector comments intact.
 */

/** Attribute every scoped rule is keyed on. */
export const SCOPE_ATTR = 'data-rp-scope';

export interface ScopedStylesheet {
  /** Transformed CSS ready to inject. */
  css: string;
  /** `@layer` name the rules live in. */
  layer: string;
  /** Removes the injected <style> element. */
  dispose: () => void;
}

/** Split a selector list on commas that are not inside `()` or `[]`. */
function splitSelectors(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** Selectors that mean "the document root" and must target the scope host. */
const ROOT_SELECTORS = new Set(['html', 'body', ':root', '*', 'html, body']);

/**
 * Cross-boundary protocol classes (SillyTavern / 酒馆助手契约).
 *
 * TH renders `<div class="TH-render">` **inside `#chat`**, i.e. outside the
 * extension's own subtree. Scoping its rules would strip them of effect: the
 * injected `pre` would never get `hidden!`, iframes would lose `w-full`, and
 * `.TH-render:has(...)` styling would silently stop applying.
 */
const PROTOCOL_CLASSES = new Set([
  'TH-render',
  'TH-streaming',
  'TH-collapse-code-block-button',
  'hidden',
]);

/** True when a selector is built only from protocol classes/ids (keep global). */
function isProtocolSelector(sel: string): boolean {
  const classes = [...sel.matchAll(/\.((?:\\.|[A-Za-z_])[\w-]*)/g)].map((m) =>
    m[1].replace(/\\/g, ''),
  );
  if (!classes.length) return false;
  const anchor = /^(#chat|\.mes_text|\.mes)\b/.test(sel) || sel.includes('.TH-');
  if (!anchor) return false;
  return classes.every((c) => c.startsWith('TH-') || PROTOCOL_CLASSES.has(c));
}

/**
 * Scope one selector.
 *
 * `html`, `body`, `:root` (and `*`) become the host element so a plugin's
 * "global" reset is confined to its own subtree.
 */
function scopeSelector(selector: string, hostSelector: string): string {
  const trimmed = selector.trim();
  if (!trimmed) return trimmed;

  // Keyframe steps (`0%`, `from`) are not selectors.
  if (/^(from|to|\d+(\.\d+)?%)$/i.test(trimmed)) return trimmed;

  // Protocol selectors live outside the plugin subtree — never scope them.
  if (isProtocolSelector(trimmed)) return trimmed;

  if (ROOT_SELECTORS.has(trimmed.toLowerCase())) return hostSelector;

  // `html body .x` → host .x   (leading root refs are dropped, the rest scoped)
  let s = trimmed;
  const leadingRoot = /^(html|body|:root)(\s+|>)/i;
  while (leadingRoot.test(s)) s = s.replace(leadingRoot, '');

  // A bare descendant combinator at the start after stripping.
  if (!s.trim()) return hostSelector;

  return `${s}[${SCOPE_ATTR}]`;
}

/** Namespace a keyframes name so two plugins cannot collide. */
function namespaceKeyframes(css: string, prefix: string): string {
  const names = new Set<string>();
  css.replace(/@(?:-webkit-)?keyframes\s+([\w-]+)/g, (_m, n: string) => {
    names.add(n);
    return _m;
  });
  let out = css;
  for (const n of names) {
    const ns = `${prefix}-${n}`;
    out = out.replace(new RegExp(`@(-webkit-)?keyframes\\s+${n}\\b`, 'g'), `@$1keyframes ${ns}`);
    out = out.replace(new RegExp(`animation-name\\s*:\\s*${n}\\b`, 'g'), `animation-name: ${ns}`);
    // `animation: 1s ease name` shorthand — only the bare token.
    out = out.replace(new RegExp(`(animation\\s*:[^;{}]*?)\\b${n}\\b`, 'g'), `$1${ns}`);
  }
  return out;
}

/**
 * Transform a stylesheet into a scoped one.
 *
 * Exported for tests: the transform is pure (CSS in → CSS out).
 */
export function scopeCss(
  css: string,
  opts: { pluginId: string; hostSelector: string },
): string {
  const hostSelector = opts.hostSelector;
  const prefix = `rp-${opts.pluginId.replace(/[^\w-]/g, '-')}`;

  // Strip comments that could contain braces, then walk the block structure.
  let src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  src = namespaceKeyframes(src, prefix);

  const walk = (text: string): string => {
    let out = '';
    let i = 0;
    while (i < text.length) {
      const brace = text.indexOf('{', i);
      if (brace === -1) {
        out += text.slice(i);
        break;
      }
      const prelude = text.slice(i, brace).trim();
      // Find the matching closing brace.
      let depth = 1;
      let j = brace + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(brace + 1, j - 1);

      if (/^@(media|supports|container|layer|scope)\b/i.test(prelude)) {
        // At-rules with nested rules: recurse, keep the prelude.
        out += `${prelude}{${walk(body)}}`;
      } else if (/^@(keyframes|-webkit-keyframes|font-face|property|counter-style)\b/i.test(prelude)) {
        // Already namespaced / not selector-based: copy verbatim.
        out += `${prelude}{${body}}`;
      } else if (prelude.startsWith('@')) {
        // `@import`, `@charset`, … — drop @import (it would load unscoped CSS).
        if (!/^@import\b/i.test(prelude)) out += `${prelude}{${body}}`;
      } else {
        const scoped = splitSelectors(prelude)
          .map((s) => scopeSelector(s, hostSelector))
          .join(', ');
        out += `${scoped}{${body}}`;
      }
      i = j;
    }
    return out;
  };

  return walk(src);
}

/**
 * Inject a plugin stylesheet, scoped to `hostSelector`.
 *
 * Rules go into `@layer rp-plugin-<id>`, which the app declares *before* its own
 * layers, so plugin CSS can never beat the shell even with high specificity.
 */
export function injectScopedStyles(opts: {
  pluginId: string;
  hostSelector: string;
  css: string;
  /** Extra attributes (e.g. the ST bridge marker). */
  attrs?: Record<string, string>;
}): ScopedStylesheet {
  const layer = `rp-plugin-${opts.pluginId.replace(/[^\w-]/g, '-')}`;
  const scoped = scopeCss(opts.css, { pluginId: opts.pluginId, hostSelector: opts.hostSelector });
  const styleId = `rpnow-scoped-${opts.pluginId.replace(/[^\w-]/g, '-')}`;

  document.getElementById(styleId)?.remove();
  const tag = document.createElement('style');
  tag.id = styleId;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) tag.setAttribute(k, v);
  tag.textContent = `@layer ${layer} {\n${scoped}\n}`;
  document.head.appendChild(tag);

  return {
    css: scoped,
    layer,
    dispose: () => tag.remove(),
  };
}
