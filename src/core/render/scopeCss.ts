/**
 * 把角色卡自带的 CSS 关进消息气泡里（纯函数，不碰 DOM）。
 *
 * 旧实现是一条正则 `(^|\})([^{}]+)\{`，它有几个洞，卡片样式会漏到整个应用：
 *   - `@media / @supports / @layer / @container` 块里的第一条规则跟在 `{` 后面，
 *     不是 `}` 后面，所以完全没被加前缀（`@media(...){textarea{…}}` 直接全局生效）；
 *   - `html body .x`、`html > body` 只换了开头那个词；
 *   - `@keyframes` 名字是全局的，卡片写一个 `spin` 就把应用自己的 `spin` 盖掉；
 *   - `@property`、`@font-face`、`@import`（没有分号结尾时）原样放行；
 *   - `position:fixed`、`100vw` 没处理，面板会盖到应用界面上或把气泡撑破；
 *   - 输出里还留着 `<`，`</style >` 能提前结束样式块，后面的内容变成真的 HTML。
 *
 * 这里改成真正按结构走一遍：规则逐条解析、at 规则递归进去，选择器全部挂到
 * scope 下面，声明里的危险写法改掉。
 */

/** 递归进去、里面的规则继续加前缀的 at 规则。 */
const NESTED_AT_RULES = new Set(['media', 'supports', 'container', 'layer', 'scope', 'starting-style', 'document']);
/** 直接整块丢掉的 at 规则（全局生效或能拉外部资源）。 */
const DROPPED_AT_RULES = new Set([
  'import', 'charset', 'namespace', 'property', 'page', 'counter-style', 'font-feature-values',
  'font-palette-values', 'view-transition', 'position-try',
]);

/** 允许不加 `custom-` 前缀的类名（和 renderer.namespaceClasses 保持一致）。 */
const CLASS_ALLOW_PREFIXES = ['fa-', 'note-', 'rp-', 'custom-'];
const CLASS_ALLOW_EXACT = ['monospace'];

/** 去掉注释（字符串里的 `/*` 不算）。 */
export function stripCssComments(css: string): string {
  let out = '';
  let i = 0;
  let quote = '';
  while (i < css.length) {
    const ch = css[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < css.length) {
        out += css[i + 1];
        i += 2;
        continue;
      }
      if (ch === quote) quote = '';
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      out += ' ';
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** 从 `{` 的位置找到与之配对的 `}`；找不到（样式被截断）返回文本末尾。 */
function matchBrace(css: string, open: number): number {
  let depth = 0;
  let quote = '';
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return css.length;
}

/** 在最外层（不在括号、方括号、字符串里）按逗号切开。 */
export function splitTopLevel(list: string, sep = ','): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < list.length; i++) {
    const ch = list[i];
    if (quote) {
      cur += ch;
      if (ch === '\\' && i + 1 < list.length) cur += list[++i];
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
    if (ch === sep && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

/** 类名加 `custom-` 前缀（方括号和字符串里的点不动，比如 `[src$=".png"]`）。 */
function namespaceSelectorClasses(sel: string): string {
  let out = '';
  let bracket = 0;
  let quote = '';
  for (let i = 0; i < sel.length; i++) {
    const ch = sel[i];
    if (quote) {
      out += ch;
      if (ch === '\\' && i + 1 < sel.length) out += sel[++i];
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '[') bracket++;
    else if (ch === ']') bracket = Math.max(0, bracket - 1);
    if (ch === '.' && bracket === 0) {
      const m = /^[A-Za-z_][\w-]*/.exec(sel.slice(i + 1));
      if (m) {
        const name = m[0];
        const keep = CLASS_ALLOW_EXACT.includes(name) || CLASS_ALLOW_PREFIXES.some((p) => name.startsWith(p));
        out += keep ? `.${name}` : `.custom-${name}`;
        i += name.length;
        continue;
      }
    }
    out += ch;
  }
  return out;
}

const ROOT_WORD = /^(?:html|body|:root|:host)(?![\w-])/i;

/**
 * 把一条选择器挂到 scope 下面。
 *
 * `html`、`body`、`:root` 指的是「整页」，在气泡里就是 scope 自己；连着写的
 * `html body`、`html > body` 合成一个 scope。其它选择器一律变成 scope 的后代，
 * 所以不管里面写什么（`*`、`textarea`、`:is(html, body)`），都出不了气泡。
 */
export function scopeSelector(selRaw: string, scope: string): string {
  let sel = selRaw.trim();
  if (!sel) return '';
  // 嵌套写法里的 `&` 指父规则，父规则已经在 scope 里了。
  if (sel.startsWith('&')) return namespaceSelectorClasses(sel);
  let rooted = false;
  let attached = '';
  for (;;) {
    const m = ROOT_WORD.exec(sel);
    if (!m) break;
    rooted = true;
    sel = sel.slice(m[0].length);
    // 紧跟在后面的部分（`body.dark`、`html[data-x]`）留给 scope。
    const tail = /^[^\s>+~,]*/.exec(sel)?.[0] ?? '';
    attached += tail;
    sel = sel.slice(tail.length);
    // 后面如果又是一个根词（`html body`、`html > body`），继续吞掉。
    const next = /^\s*>?\s*/.exec(sel)?.[0] ?? '';
    if (ROOT_WORD.test(sel.slice(next.length))) {
      sel = sel.slice(next.length);
      continue;
    }
    break;
  }
  const rest = namespaceSelectorClasses(sel);
  if (rooted) return `${scope}${namespaceSelectorClasses(attached)}${rest}`;
  return `${scope} ${rest}`;
}

/** 宽度类属性里的 vw 换成百分比：100vw 在气泡里应该是气泡宽度，不是屏幕宽度。 */
const WIDTH_PROPS = /^(?:width|min-width|max-width|inline-size|min-inline-size|max-inline-size|left|right|inset-inline(?:-start|-end)?|margin(?:-left|-right|-inline(?:-start|-end)?)?|padding(?:-left|-right|-inline(?:-start|-end)?)?|flex-basis)$/i;

/** 处理一条声明（`prop: value`），返回空串表示丢掉。 */
function sanitizeDeclaration(decl: string, allowExternal: boolean, keyframes: Map<string, string>): string {
  const colon = decl.indexOf(':');
  if (colon === -1) return '';
  const prop = decl.slice(0, colon).trim();
  let value = decl.slice(colon + 1).trim();
  if (!prop || !value) return '';
  const lower = prop.toLowerCase();
  // 老式的脚本入口。
  if (/expression\s*\(|javascript\s*:|vbscript\s*:/i.test(value)) return '';
  if (lower === 'behavior' || lower === '-moz-binding') return '';
  // 没开「外部媒体」时，带远程地址的声明整条丢掉。
  if (!allowExternal && /(?:https?:)?\/\//i.test(value.replace(/data:[^)\s"']*/gi, ''))) return '';
  if (lower === 'position' && /^fixed\b/i.test(value)) {
    // fixed 会钉在屏幕上盖住应用界面；改成 absolute 之后只能盖在气泡里
    // （气泡是 position:relative + overflow 裁剪，见 index.css 的 .rp-md）。
    value = value.replace(/^fixed/i, 'absolute');
  }
  if (WIDTH_PROPS.test(lower)) {
    value = value.replace(/(-?\d*\.?\d+)(?:d|s|l)?vw\b/gi, '$1%');
  }
  if ((lower === 'animation' || lower === 'animation-name') && keyframes.size) {
    value = value.replace(/[A-Za-z_][\w-]*/g, (word) => keyframes.get(word) ?? word);
  }
  return `${prop}:${value}`;
}

/** 处理一个规则体里的声明；体里嵌着的规则（CSS 嵌套）递归处理。 */
function sanitizeBody(body: string, scope: string, allowExternal: boolean, keyframes: Map<string, string>): string {
  const out: string[] = [];
  let i = 0;
  while (i < body.length) {
    // 找这一段的结尾：`;`（声明）或 `{`（嵌套规则）。
    let j = i;
    let depth = 0;
    let quote = '';
    let kind: ';' | '{' | '' = '';
    for (; j < body.length; j++) {
      const ch = body[j];
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (ch === ';' || ch === '{')) {
        kind = ch;
        break;
      }
    }
    const chunk = body.slice(i, j).trim();
    if (kind === '{') {
      const close = matchBrace(body, j);
      const inner = body.slice(j + 1, close);
      if (chunk.startsWith('@')) {
        const name = /^@([\w-]+)/.exec(chunk)?.[1]?.toLowerCase() ?? '';
        if (NESTED_AT_RULES.has(name)) {
          out.push(`${chunk.replace(/</g, '')}{${sanitizeBody(inner, scope, allowExternal, keyframes)}}`);
        }
      } else if (chunk) {
        // 嵌套规则相对父规则生效，父规则已经在 scope 里；选择器只做类名前缀。
        const sels = splitTopLevel(chunk).map((s) => namespaceSelectorClasses(s)).join(', ');
        out.push(`${sels}{${sanitizeBody(inner, scope, allowExternal, keyframes)}}`);
      }
      i = close + 1;
      continue;
    }
    if (chunk) {
      const decl = sanitizeDeclaration(chunk, allowExternal, keyframes);
      if (decl) out.push(`${decl};`);
    }
    i = j + 1;
  }
  return out.join('');
}

/** 先扫一遍，把所有 @keyframes 的名字记下来并改名，免得盖掉应用自己的动画。 */
function collectKeyframes(css: string): Map<string, string> {
  const names = new Map<string, string>();
  const re = /@(?:-webkit-|-moz-|-o-)?keyframes\s+([A-Za-z_][\w-]*|"[^"]*"|'[^']*')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const raw = m[1].replace(/^["']|["']$/g, '');
    if (/^[A-Za-z_][\w-]*$/.test(raw) && !raw.startsWith('rpc-')) names.set(raw, `rpc-${raw}`);
  }
  return names;
}

function scopeRules(css: string, scope: string, allowExternal: boolean, keyframes: Map<string, string>): string {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    // 读到这条规则的 `{`，或者一条没有块的语句的 `;`。
    let j = i;
    let depth = 0;
    let quote = '';
    let kind: ';' | '{' | '' = '';
    for (; j < css.length; j++) {
      const ch = css[j];
      if (quote) {
        if (ch === '\\') j++;
        else if (ch === quote) quote = '';
        continue;
      }
      if (ch === '"' || ch === "'") quote = ch;
      else if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth = Math.max(0, depth - 1);
      else if (depth === 0 && (ch === ';' || ch === '{')) {
        kind = ch;
        break;
      }
      else if (depth === 0 && ch === '}') {
        // 多出来的 `}`：跳过去，不让它把后面的规则带歪。
        kind = ';';
        break;
      }
    }
    const prelude = css.slice(i, j).trim();
    if (kind !== '{') {
      // `@import …;`、`@charset …;`、游离的声明：全部丢掉。
      i = j + 1;
      continue;
    }
    const close = matchBrace(css, j);
    const body = css.slice(j + 1, close);
    i = close + 1;
    if (!prelude) continue;

    if (prelude.startsWith('@')) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase() ?? '';
      const bare = name.replace(/^-(?:webkit|moz|o|ms)-/, '');
      if (DROPPED_AT_RULES.has(bare)) continue;
      if (NESTED_AT_RULES.has(bare)) {
        out.push(`${prelude}{${scopeRules(body, scope, allowExternal, keyframes)}}`);
        continue;
      }
      if (bare === 'keyframes') {
        const kfName = /^@[\w-]+\s+([A-Za-z_][\w-]*|"[^"]*"|'[^']*')/.exec(prelude)?.[1]?.replace(/^["']|["']$/g, '') ?? '';
        const renamed = keyframes.get(kfName) ?? kfName;
        if (!/^[A-Za-z_][\w-]*$/.test(renamed)) continue;
        // 帧选择器（from / to / 50%）不加前缀，帧里的声明照样过滤。
        const frames: string[] = [];
        let k = 0;
        while (k < body.length) {
          const open = body.indexOf('{', k);
          if (open === -1) break;
          const end = matchBrace(body, open);
          const sel = body.slice(k, open).trim();
          if (/^(?:from|to|\d+(?:\.\d+)?%)(?:\s*,\s*(?:from|to|\d+(?:\.\d+)?%))*$/i.test(sel)) {
            frames.push(`${sel}{${sanitizeBody(body.slice(open + 1, end), scope, allowExternal, new Map())}}`);
          }
          k = end + 1;
        }
        out.push(`@keyframes ${renamed}{${frames.join('')}}`);
        continue;
      }
      if (bare === 'font-face') {
        const decls = sanitizeBody(body, scope, allowExternal, new Map());
        // 字体文件被外部媒体开关拦掉之后，剩一个空壳没有意义。
        if (/(^|;)\s*src\s*:/i.test(decls)) out.push(`@font-face{${decls}}`);
        continue;
      }
      // 不认识的 at 规则：丢掉。
      continue;
    }

    const selectors = splitTopLevel(prelude)
      .map((s) => scopeSelector(s, scope))
      .filter(Boolean);
    if (!selectors.length) continue;
    out.push(`${selectors.join(', ')}{${sanitizeBody(body, scope, allowExternal, keyframes)}}`);
  }
  return out.join('');
}

/**
 * 把一段卡片 CSS 关进 `scope`。
 *
 * @param css          卡片 `<style>` 里的原文
 * @param scope        气泡的选择器，默认 `.rp-md`
 * @param allowExternal 用户是否打开了「外部媒体」
 */
export function scopeCss(css: string, scope: string, allowExternal: boolean): string {
  const clean = stripCssComments(css)
    // `<!--` `-->` 是老浏览器里包样式用的，没有意义。
    .replace(/<!--|-->/g, ' ');
  const keyframes = collectKeyframes(clean);
  const out = scopeRules(clean, scope, allowExternal, keyframes);
  // 输出要放回 <style> 里：任何 `<` 都可能拼出 `</style>` 提前把样式块关掉，
  // 后面的文字就成了真的 HTML。写成 CSS 转义，样式含义不变。
  return out.replace(/</g, '\\3c ');
}

/** 处理元素上的 `style="…"`：和样式块里的声明走同一套规则。 */
export function sanitizeInlineStyle(style: string, allowExternal: boolean): string {
  // style 属性里只能有声明；花括号一律当分隔符，写不出规则块。
  return sanitizeBody(stripCssComments(style).replace(/[{}]/g, ';'), '', allowExternal, new Map());
}
