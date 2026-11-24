/**
 * 消息里的 HTML 页面：找出来、切开、装进隔离的 iframe（纯函数，不碰 DOM）。
 *
 * 角色卡的开场白可以是一整个网页（开局设置表单、状态面板……）：自带 <style>、
 * 表单控件和 <script>。这种内容不能直接塞进聊天气泡——脚本不会跑、表单控件会被
 * 清洗掉、样式会漏到应用界面上。做法和 RP-Hub 一样：把「页面」那一段单独放进
 * iframe，前后的正文照常渲染。
 *
 * 和 RP-Hub 不同的一点：RP-Hub 的 iframe 和主页面同源（卡片脚本能直接碰到主页面
 * 的一切），这里用的是不带 allow-same-origin 的沙箱——卡片脚本拿到的是一个独立的
 * 空白来源，读不到应用的页面、本地存储和 API Key；和聊天之间只靠 postMessage
 * 传两件事：页面高度、要放进输入框的文字。
 */

/** 沙箱权限：能跑脚本、能用表单、能开链接；**没有** allow-same-origin。 */
export const FRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads';

/** iframe 发给宿主的消息标记。 */
export const CARD_MESSAGE_TAG = '__rpnowCard';
/** 宿主回给 iframe 的消息标记。 */
export const HOST_MESSAGE_TAG = '__rpnowHost';
/** 还没量到高度时先占的高度（px）。 */
export const FRAME_INITIAL_HEIGHT = 120;

const DOC_START = /<!doctype\s+html\b|<html\b/i;
const DOC_END = /<\/html\s*>/i;

/** 整条消息就是一个 HTML 页面（沿用旧判断：以 doctype 或 <html 开头）。 */
export function isFullHtmlDocument(markdown: string): boolean {
  const t = markdown.trim().toLowerCase();
  return t.startsWith('<!doctype') || t.startsWith('<html');
}

/** 一段文字是不是「页面」而不是片段（决定要不要给它默认字色）。 */
export function looksLikeDocument(code: string): boolean {
  return /<!doctype\s+html\b|<html\b|<head\b|<body\b/i.test(code);
}

/**
 * 把围栏代码块和行内代码换成等长的空白，只用来「找位置」。
 * 这样正文里写着 `<input>` 的代码示例不会被当成表单。
 */
export function maskCode(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, blank)
    .replace(/`[^`\n]*`/g, blank);
}

/** 片段里出现这些，说明它得在 iframe 里才能用（内联渲染会把它们清洗掉）。 */
const INTERACTIVE = /<(?:script|input|textarea|select|form)\b/i;

/** 片段从哪种标签开始算。 */
const FRAGMENT_START =
  /<(?:style|script|link|meta|head|body|div|section|article|main|aside|header|footer|nav|form|fieldset|table|details|center|ul|ol|h[1-6]|p|label|button|input|textarea|select|canvas|svg)\b[^>]*>/i;
/** 片段到哪种标签结束算（最后一个出现的）。 */
const FRAGMENT_TAG =
  /<\/?(?:style|script|head|body|div|section|article|main|aside|header|footer|nav|form|fieldset|table|details|center|ul|ol|h[1-6]|p|label|button|input|textarea|select|canvas|svg)\b[^>]*>/gi;

export interface HtmlCardExtraction {
  /** 把页面换成占位元素之后的正文。 */
  text: string;
  /** 每个占位元素对应的页面源码。 */
  codes: string[];
}

/** 占位元素：能通过清洗，之后被换成 iframe。 */
export function cardPlaceholder(index: number): string {
  return `\n\n<rp-html-card data-rp-html="${index}"></rp-html-card>\n\n`;
}

/* ------------------------------------------------------------ 整页（硬规则） */

/** 页面标记：出现其中一个，就说明从这里开始是一个网页。 */
const DOC_MARK = /<!doctype\s+html\b[^>]*>|<html\b[^>]*>|<head\b[^>]*>|<body\b[^>]*>/gi;
/** 这些标签里面是「原样文字」，里面出现的 </html>、``` 都不算数。 */
const RAW_OPEN = /<(script|style|template|textarea|xmp)\b[^>]*>/iy;
const HTML_CLOSE = /<\/html\s*>/iy;
/** 围栏里写这些语言（或者不写）才可能是页面；写了别的语言就是代码示例。 */
const HTML_FENCE_LANGS = new Set(['', 'html', 'htm', 'xhtml']);

interface OpenFence {
  /** 围栏用的字符（` 或 ~）。 */
  ch: string;
  /** 围栏标记从哪里开始。 */
  index: number;
  /** 围栏标记（连同语言名、换行）到哪里结束，也就是内容从哪里开始。 */
  contentStart: number;
  lang: string;
}

/** 看 text[from, to) 这一段结束时，是不是正处在一个没关上的围栏里。 */
function openFenceAt(text: string, from: number, to: number): OpenFence | null {
  const re = /`{3,}|~{3,}/g;
  re.lastIndex = from;
  let open: OpenFence | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && m.index < to) {
    const ch = m[0][0];
    if (ch === '~') {
      // ~~~ 只有独占行首才算围栏（正文里的 ~~~ 多半是语气词）。
      const lineStart = text.lastIndexOf('\n', m.index - 1) + 1;
      if (text.slice(lineStart, m.index).trim()) continue;
    }
    if (open) {
      if (open.ch === ch) open = null;
      continue;
    }
    const after = m.index + m[0].length;
    const info = /^[ \t]*([a-z0-9+#-]*)[ \t]*\n?/i.exec(text.slice(after, to)) as RegExpExecArray;
    open = { ch, index: m.index, contentStart: after + info[0].length, lang: info[1].toLowerCase() };
  }
  return open;
}

/** 页面从 from 往后在哪里结束。end：源码结束处；next：连同收尾围栏一起吃到哪里。 */
function findDocumentEnd(text: string, from: number, fence: OpenFence | null): { end: number; next: number } {
  const n = text.length;
  const lower = text.toLowerCase();
  let midFence: { end: number; next: number } | null = null;
  let i = from;
  while (i < n) {
    const c = text.charCodeAt(i);
    if (c === 60 /* < */) {
      if (lower.startsWith('<!--', i)) {
        const e = lower.indexOf('-->', i + 4);
        if (e < 0) return { end: n, next: n };
        i = e + 3;
        continue;
      }
      HTML_CLOSE.lastIndex = i;
      const close = HTML_CLOSE.exec(text);
      if (close) {
        const end = i + close[0].length;
        if (fence) {
          const tail = new RegExp(`^\\s*\\${fence.ch}{3,}[ \\t]*`).exec(text.slice(end));
          if (tail) return { end, next: end + tail[0].length };
        }
        return { end, next: end };
      }
      RAW_OPEN.lastIndex = i;
      const raw = RAW_OPEN.exec(text);
      if (raw) {
        const e = lower.indexOf(`</${raw[1].toLowerCase()}`, i + raw[0].length);
        if (e < 0) return { end: n, next: n };
        const gt = text.indexOf('>', e);
        i = gt < 0 ? n : gt + 1;
        continue;
      }
      i++;
      continue;
    }
    if (fence && text[i] === fence.ch && text.startsWith(fence.ch.repeat(3), i)) {
      let j = i;
      while (j < n && text[j] === fence.ch) j++;
      while (j < n && (text[j] === ' ' || text[j] === '\t')) j++;
      // 行首的围栏标记就是收尾。夹在一行中间的（页面正文里写着 ```）先记下，
      // 后面真有 </html> 就以 </html> 为准，一直没有才拿它当收尾。
      const lineStart = text.lastIndexOf('\n', i - 1) + 1;
      if (!text.slice(lineStart, i).trim()) return { end: i, next: j };
      if (!midFence) midFence = { end: i, next: j };
      i = j;
      continue;
    }
    i++;
  }
  return midFence ?? { end: n, next: n };
}

/**
 * 第零步（硬规则）：正文里只要出现页面标记（doctype / <html / <head / <body），
 * 从标记到页面结束（</html>、收尾围栏，都没有就到消息末尾）整段装进 iframe，
 * 包着它的围栏一起吃掉，一个字都不留给 Markdown。
 *
 * 为什么单独写一遍而不是靠下面的逐行扫描：卡片正则产出的页面什么形状都有——
 * 围栏和 doctype 粘在同一行、整页压成一行、Windows 换行、~~~ 或四个反引号的
 * 围栏、缩进四格、脚本里自己带 ```、<template> 里再套一个页面、没有收尾标签……
 * 逐行扫描每碰到一种就漏一种，漏了就是「代码块 + 半截页面铺在气泡里」。
 */
function extractDocumentRuns(text: string, codes: string[]): string {
  let out = '';
  let pos = 0;
  const mark = new RegExp(DOC_MARK.source, 'gi');
  for (;;) {
    mark.lastIndex = pos;
    const m = mark.exec(text);
    if (!m) break;
    const s = m.index;
    let fence = openFenceAt(text, pos, s);
    if (fence) {
      const isHtmlFence = HTML_FENCE_LANGS.has(fence.lang);
      // 裸围栏：页面必须是围栏里的第一样东西，否则是「代码里提到了 <html>」。
      const leads = fence.lang !== '' || !text.slice(fence.contentStart, s).trim();
      if (!isHtmlFence || !leads) {
        const closeAt = text.indexOf(fence.ch.repeat(3), Math.max(s, fence.contentStart));
        if (closeAt < 0) break;
        let j = closeAt;
        while (j < text.length && text[j] === fence.ch) j++;
        out += text.slice(pos, j);
        pos = j;
        continue;
      }
    } else {
      // 行内代码（`<html>`）里的不算。
      const lineStart = text.lastIndexOf('\n', s - 1) + 1;
      const ticks = (text.slice(Math.max(lineStart, pos), s).replace(/`{3,}/g, '').match(/`/g) ?? []).length;
      const rest = text.slice(s + m[0].length);
      const isDoctype = /^<!doctype/i.test(m[0]);
      // 正文里只是提到一下 "<html>"、"<body>" 不算：后面得真有页面的样子。
      const tag = m[0].slice(1, 5).toLowerCase();
      const evidence =
        isDoctype ||
        (tag === 'html'
          ? /<\/html\s*>|<(?:head|body)\b/i.test(rest)
          : tag === 'head'
            ? /<\/head\s*>|<body\b/i.test(rest)
            : /<\/body\s*>|<script\b/i.test(rest));
      if (ticks % 2 === 1 || !evidence) {
        out += text.slice(pos, s + m[0].length);
        pos = s + m[0].length;
        continue;
      }
    }
    const { end, next } = findDocumentEnd(text, s + m[0].length, fence);
    let cut = fence ? fence.index : s;
    // 标记前面只有缩进（缩进四格会被 Markdown 当成代码块）：缩进一起拿走。
    const lineStart = text.lastIndexOf('\n', cut - 1) + 1;
    if (lineStart >= pos && !text.slice(lineStart, cut).trim()) cut = lineStart;
    const code = text.slice(fence ? fence.contentStart : s, end).trim();
    codes.push(code);
    out += text.slice(pos, cut) + cardPlaceholder(codes.length - 1);
    pos = next;
    if (!fence) {
      // 页面后面紧跟一个孤零零的收尾围栏（开头那个被别的正则吃掉了）：一起吃掉，
      // 不然它会把后面的正文吞成代码块。
      const stray = /^\s*(`{3,}|~{3,})[ \t]*(?=\n|$)/.exec(text.slice(pos));
      if (stray && ((out.match(/`{3,}|~{3,}/g) ?? []).length % 2 === 0)) pos += stray[0].length;
    }
    fence = null;
  }
  return out + text.slice(pos);
}

/* ------------------------------------------------------------ 围栏与片段 */

/**
 * 第一步：围栏里的页面（```html、内容是页面的裸围栏）和独占一行开头的页面。
 *
 * 这段逐行扫描是原来 renderer 里的逻辑，原样搬过来（Meowssiah 思维链折叠之类的
 * 预设正则靠它）。区别只有一个：现在它在「转义自定义标签」之前跑，拿到的是原文，
 * 所以页面里的 <input>、<textarea> 不会再被转义成一串文字。
 */
function extractFencedCards(markdown: string, codes: string[], all: boolean): string {
  const card = (code: string) => {
    codes.push(code);
    return cardPlaceholder(codes.length - 1);
  };
  const lines = markdown.split('\n');
  const outLines: string[] = [];
  let i = 0;
  const startMatch = /(^|\s)(`{3,}|~{3,})[ \t]*([a-z]*)[ \t]*$/i; // 一行以围栏开头标记结尾
  const docStart = /^\s*(?:<!DOCTYPE html|<html\b)/i; // 没有围栏的页面开头
  while (i < lines.length) {
    const line = lines[i];
    const m = startMatch.exec(line);
    if (!m) {
      if (docStart.test(line)) {
        const body: string[] = [];
        let j = i;
        let rest = '';
        while (j < lines.length) {
          // 页面可以在一行中间结束（"</html>后面接着正文"）：后半行留给正文。
          const end = DOC_END.exec(lines[j]);
          if (end) {
            const cut = end.index + end[0].length;
            body.push(lines[j].slice(0, cut));
            rest = lines[j].slice(cut);
            break;
          }
          body.push(lines[j]);
          j++;
        }
        const text = body.join('\n');
        if (isFullHtmlDocument(text)) {
          // "正文<!DOCTYPE html>" 换行再 "<html>"：上一行末尾那个 doctype 属于这个页面。
          const prev = outLines.length - 1;
          if (prev >= 0) outLines[prev] = outLines[prev].replace(/<!doctype\s+html[^>]*>\s*$/i, '');
          outLines.push(card(text));
          if (rest.trim()) outLines.push(rest);
          i = j + 1;
          continue;
        }
      }
      outLines.push(line);
      i++;
      continue;
    }
    const lang = m[3].toLowerCase();
    if (lang && lang !== 'html' && lang !== 'htm') {
      outLines.push(line);
      i++;
      continue;
    }
    const fenceMark = m[2][0].repeat(3);
    const body: string[] = [];
    let j = i + 1;
    let closed = false;
    let rest = '';
    let scripts = 0; // 还没关上的 <script> 个数：脚本里的 ``` 不是围栏
    while (j < lines.length) {
      const l = lines[j];
      // 找这一行里第一个「不在 <script> 里面」的围栏标记。
      let at = -1;
      for (let k = l.indexOf(fenceMark); k >= 0; k = l.indexOf(fenceMark, k + 3)) {
        const head = l.slice(0, k);
        const depth = scripts + (head.match(/<script\b/gi)?.length ?? 0) - (head.match(/<\/script\s*>/gi)?.length ?? 0);
        if (depth <= 0) {
          at = k;
          break;
        }
      }
      if (at >= 0) {
        // 任何围栏标记都结束卡片正文；标记前后粘着的字各归各位。
        closed = true;
        if (l.slice(0, at).trim()) body.push(l.slice(0, at));
        rest = l.slice(at).replace(/^[`~]+[ \t]*/, '');
        break;
      }
      body.push(l);
      scripts += (l.match(/<script\b/gi)?.length ?? 0) - (l.match(/<\/script\s*>/gi)?.length ?? 0);
      if (scripts < 0) scripts = 0;
      if (/<\/html>\s*$/i.test(l)) {
        // 页面写完了。这一行已经收进卡片；紧跟着的那行如果只是收尾的围栏标记，
        // 也一起吃掉——以前这里会把 </html> 再当正文处理一遍，还留下一个孤零零
        // 的 ``` ，后面的正文被它吞成代码块。
        closed = true;
        if (j + 1 < lines.length && /^\s*(?:```+|~~~+)\s*$/.test(lines[j + 1])) j++;
        break;
      }
      j++;
    }
    const text = body.join('\n');
    const framed = looksLikeDocument(text) || INTERACTIVE.test(text);
    const isCard = all
      ? lang === 'html' || lang === 'htm' || isFullHtmlDocument(text) || /^\s*<(?:html|body|div|section|style)\b/i.test(text)
      : framed;
    if (!isCard) {
      outLines.push(line);
      i++;
      continue;
    }
    // 围栏开头那一行，标记前面可能还粘着正文（"……正文```html"），留下来。
    const before = line.slice(0, m.index + m[1].length);
    if (before.trim()) outLines.push(before);
    outLines.push(card(text));
    if (rest.trim()) outLines.push(rest);
    i = closed ? j + 1 : j;
  }
  return outLines.join('\n');
}

/**
 * 第二步：夹在正文中间的页面（"……正文<!DOCTYPE html>…</html>正文……"）。
 * RP-Hub 也是这么切的：页面前后的文字各自当正文。
 */
function extractInlineDocuments(text: string, codes: string[]): string {
  let out = '';
  let rest = text;
  for (;;) {
    const masked = maskCode(rest);
    const start = DOC_START.exec(masked);
    if (!start) break;
    const after = masked.slice(start.index);
    const end = DOC_END.exec(after);
    // 正文里只是提到了一下 "<html>"（比如一句代码 const a = "<html>"）不算页面：
    // 光有 <html 开头的，后面得真有 <head / <body / </html> 才当页面切出来。
    if (!/^<!doctype/i.test(start[0]) && !end && !/<(?:head|body)\b/i.test(after)) {
      const skip = start.index + start[0].length;
      out += rest.slice(0, skip);
      rest = rest.slice(skip);
      continue;
    }
    // 没有 </html>（模型还在写，或者卡片漏了）：一直算到末尾。
    const stop = end ? start.index + end.index + end[0].length : rest.length;
    codes.push(rest.slice(start.index, stop));
    out += rest.slice(0, start.index) + cardPlaceholder(codes.length - 1);
    rest = rest.slice(stop);
  }
  return out + rest;
}

/**
 * 第三步：没有 <html> 的片段，但里面有脚本或表单控件（<style> + 一堆 div +
 * <script> 这种写法很常见）。从第一个块级标签到最后一个标签整段装进 iframe。
 */
function extractInteractiveFragment(text: string, codes: string[]): string {
  const masked = maskCode(text);
  if (!INTERACTIVE.test(masked)) return text;
  const start = FRAGMENT_START.exec(masked);
  if (!start) return text;
  let stop = -1;
  FRAGMENT_TAG.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FRAGMENT_TAG.exec(masked))) stop = m.index + m[0].length;
  // <script> 或 <style> 没写完（流式输出到一半）：算到末尾，别把半截代码当正文露出来。
  const tail = masked.slice(start.index);
  const unclosed = (tag: string) =>
    (tail.match(new RegExp(`<${tag}\\b`, 'gi'))?.length ?? 0) > (tail.match(new RegExp(`</${tag}\\s*>`, 'gi'))?.length ?? 0);
  if (unclosed('script') || unclosed('style')) stop = text.length;
  if (stop <= start.index) return text;
  codes.push(text.slice(start.index, stop));
  return text.slice(0, start.index) + cardPlaceholder(codes.length - 1) + text.slice(stop);
}

/**
 * 把消息里所有该进 iframe 的部分换成占位元素。
 *
 * 整页、带脚本或表单控件的片段**一律**进 iframe，不看设置里的「沙箱 HTML」开关
 * ——这类内容内联渲染必坏（脚本不跑、控件被清洗、样式外漏）。开关（`all`）只决定
 * 剩下那种：```html 围栏里纯静态的片段，开着进 iframe，关着照旧当代码块。
 */
export function extractHtmlCards(markdown: string, all = true): HtmlCardExtraction {
  const codes: string[] = [];
  // Windows 换行（\r\n）会让围栏那一行多一个 \r，逐行扫描就认不出来了。
  let text = markdown.replace(/\r\n?/g, '\n');
  text = extractDocumentRuns(text, codes);
  text = extractFencedCards(text, codes, all);
  text = extractInlineDocuments(text, codes);
  text = extractInteractiveFragment(text, codes);
  return { text, codes };
}

/* ------------------------------------------------------------------ 页面 */

/**
 * 注入到每个页面最前面的样式。写在卡片自己的样式之前，所以卡片可以覆盖；
 * 带 !important 的几条是自动高度必须的（body 写了 height:100vh 的话，
 * 量出来的高度永远等于 iframe 自己的高度，就再也缩不回去了）。
 */
const BASE_CSS =
  'html,body{height:auto!important;min-height:0!important;max-width:100%;overflow-x:hidden}' +
  'html{overflow-y:hidden;-webkit-text-size-adjust:100%;text-size-adjust:100%}' +
  'img,video,canvas,svg{max-width:100%}';

/** 片段（不是完整页面）的默认样子：透明底、跟着应用主题的字色。 */
const FRAGMENT_CSS =
  'html,body{margin:0;padding:0;background:transparent}' +
  'body{font:14px/1.6 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;color:var(--rp-fg,#e8e3f0);overflow-wrap:anywhere}';

/**
 * 注入到每个页面最前面的脚本（在卡片自己的脚本之前执行）。
 *
 * 卡片跑在没有 allow-same-origin 的沙箱里，碰不到应用。这段脚本在沙箱里面摆出
 * 「酒馆」的样子，让酒馆卡片的脚本能照常跑完；所有调用最后只落到两件事上：
 * 把文字放进输入框、发出一条消息（后者只在用户刚点过页面时才算数）。
 *
 *   - `triggerSlash('/send 文字|/trigger')`、`/setinput 文字`；`/setvar`、`/getvar`
 *     只存在页面自己的内存里；
 *   - `SillyTavern.getContext()`（name1 / name2 / sendMessageAsUser / generate /
 *     executeSlashCommands…）、`TavernHelper` 以及酒馆助手那批全局函数；
 *   - `window.parent.*` 上同样的一套，外加 `parent.document` 里的
 *     `#send_textarea`、`#send_but` 替身；
 *   - 一个很小的 `$` / `jQuery` 替身（页面自己带了 jQuery 就用它自己的）；
 *   - 点带 `data-slash="…"` 的元素，等于 `triggerSlash(那段文字)`；
 *   - 不认识的调用不报错（否则卡片脚本一上来就停，选项一个都出不来），只在
 *     控制台用「[RPNow 卡片桥]」开头记一笔；
 *   - 量页面高度告诉宿主；整页都是 position:fixed 的全屏面板量不出高度，给 480；
 *   - 沙箱里 localStorage 用不了（会抛错），给一个只活在内存里的替身。
 */
export const FRAME_SHIM = `(function(){
var TAG='${CARD_MESSAGE_TAG}',HOST='${HOST_MESSAGE_TAG}',LOG='[RPNow 卡片桥]';
var P=window.parent;
var CTX=window.__rpnowCtx||{};try{delete window.__rpnowCtx;}catch(e){}
var USER=String(CTX.user||'User'),CHAR=String(CTX.char||'');
function post(type,extra){try{var m={};m[TAG]=1;m.type=type;if(extra)for(var k in extra)m[k]=extra[k];P.postMessage(m,'*');}catch(e){}}
var seen={};
function warn(what){what=String(what).slice(0,120);if(seen[what])return;seen[what]=1;try{console.warn(LOG+' 这个调用没有对应的功能，已忽略：'+what);}catch(e){}post('unsupported',{name:what});}
function nop(){}
function pnop(){return Promise.resolve();}
function mem(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},setItem:function(k,v){d[String(k)]=String(v);},removeItem:function(k){delete d[String(k)];},clear:function(){d={};},key:function(i){return Object.keys(d)[i]||null;},get length(){return Object.keys(d).length;}};}
['localStorage','sessionStorage'].forEach(function(n){try{void window[n].length;}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true});}catch(e2){}}});
var de=document.documentElement,ownTheme='';
function theme(t){if(t!=='dark'&&t!=='light')return;try{if(!de.hasAttribute('data-theme')||de.getAttribute('data-theme')===ownTheme){de.setAttribute('data-theme',t);ownTheme=t;}}catch(e){}try{fr.setAttribute('data-theme',t);fr.className=t;}catch(e){}}
var fr=document.createElement('div'),fb=document.createElement('div');
theme(CTX.theme);
var lastTap=0;
['pointerdown','pointerup','mousedown','touchend','click','keydown'].forEach(function(n){document.addEventListener(n,function(ev){if(ev&&ev.isTrusted)lastTap=Date.now();},true);});
function active(){try{if(navigator.userActivation&&navigator.userActivation.isActive)return 1;}catch(e){}return Date.now()-lastTap<3000?1:0;}
function fill(t){t=String(t==null?'':t);if(t.trim())post('slash',{text:t});}
function send(t){t=String(t==null?'':t);if(t.trim())post('slash',{text:t,send:1,active:active()});}
var vars={};
function varKey(a){a=a.trim();if(a.indexOf('key=')===0)a=a.slice(4);var sp=a.indexOf(' ');return sp<0?[a,'']:[a.slice(0,sp),a.slice(sp+1)];}
function slash(raw){
raw=String(raw==null?'':raw);var parts=raw.split('|'),rest=[],res='';
for(var i=0;i<parts.length;i++){var p=parts[i].trim(),lp=p.toLowerCase(),sp=p.indexOf(' ');
if(lp.indexOf('/setvar')===0||lp.indexOf('/setglobalvar')===0){var kv=varKey(sp<0?'':p.slice(sp+1));vars[kv[0]]=kv[1];res=kv[1];continue;}
if(lp.indexOf('/getvar')===0||lp.indexOf('/getglobalvar')===0){var k=varKey(sp<0?'':p.slice(sp+1))[0];res=vars[k]==null?'':String(vars[k]);continue;}
if(lp.indexOf('/echo')===0||lp.indexOf('/popup')===0)continue;
rest.push(parts[i]);}
var left=rest.join('|');
if(left.trim())post('slash',{text:left,cmd:1,active:active()});
return Promise.resolve(res);}
var stageT=0,ta=document.createElement('textarea'),sb=document.createElement('div');
ta.id='send_textarea';sb.id='send_but';
var vd=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
function stage(){if(stageT)return;stageT=setTimeout(function(){stageT=0;fill(vd.get.call(ta));},0);}
function flush(){if(stageT){clearTimeout(stageT);stageT=0;}var v=vd.get.call(ta);if(v&&v.trim()){vd.set.call(ta,'');send(v);}}
function gen(){flush();return Promise.resolve();}
try{Object.defineProperty(ta,'value',{configurable:true,get:function(){return vd.get.call(ta);},set:function(v){vd.set.call(ta,v);stage();}});}catch(e){}
ta.addEventListener('input',stage);ta.addEventListener('change',stage);sb.addEventListener('click',flush);
function pick(q){q=String(q);return q.indexOf('send_textarea')>=0?ta:q.indexOf('send_but')>=0?sb:null;}
function loose(path,known){if(typeof Proxy!=='function')return known;return new Proxy(known,{get:function(t,k){if(k in t)return t[k];if(typeof k!=='string'||k==='then'||k==='toJSON'||k==='constructor'||k==='prototype')return undefined;warn(path+'.'+k);return nop;}});}
var names=typeof Proxy==='function'?new Proxy({},{get:function(t,k){return typeof k==='string'?k:undefined;}}):{};
var es={on:nop,once:nop,makeFirst:nop,makeLast:nop,removeListener:nop,emit:pnop,emitAndWait:pnop};
function sub(x){return String(x==null?'':x).split('{{user}}').join(USER).split('{{char}}').join(CHAR);}
function store(){return{get:function(k){return vars[k];},set:function(k,v){vars[k]=v;},del:function(k){delete vars[k];},has:function(k){return k in vars;}};}
function firstUserText(list){list=[].concat(list||[]);for(var i=0;i<list.length;i++){var m=list[i];if(typeof m==='string')return m;var t=m&&(m.message||m.content||m.mes);if(t&&(!m.role||m.role==='user'||m.is_user))return t;}return '';}
var base={name1:USER,name2:CHAR,chat:[],characters:[{name:CHAR}],characterId:0,this_chid:0,chatId:'rpnow',groupId:null,chatMetadata:{},extensionSettings:{},variables:{local:store(),global:store()},eventSource:es,eventTypes:names,event_types:names,
getCurrentChatId:function(){return 'rpnow';},substituteParams:sub,substituteParamsExtended:sub,
sendMessageAsUser:function(t){send(t);return Promise.resolve();},sendMessage:function(t){send(t);return Promise.resolve();},
generate:gen,Generate:gen,executeSlashCommands:slash,executeSlashCommandsWithOptions:slash,
setExtensionPrompt:nop,saveChat:pnop,saveChatConditional:pnop,saveSettingsDebounced:nop,saveMetadata:pnop,saveMetadataDebounced:nop,reloadCurrentChat:pnop,getRequestHeaders:function(){return{};},registerSlashCommand:nop,registerMacro:nop,addOneMessage:nop,getTokenCount:function(){return 0;},getTokenCountAsync:function(){return Promise.resolve(0);}};
var ctx=loose('SillyTavern.getContext()',base);
var stBase={getContext:function(){return ctx;}};for(var bk in base)stBase[bk]=base[bk];
var ST=loose('SillyTavern',stBase);
var thBase={triggerSlash:slash,triggerSlashWithResult:slash,
getVariables:function(){return vars;},replaceVariables:function(v){vars=v||{};return Promise.resolve();},insertOrAssignVariables:function(v){for(var k in v)vars[k]=v[k];return Promise.resolve(vars);},insertVariables:function(v){for(var k in v)if(!(k in vars))vars[k]=v[k];return Promise.resolve(vars);},updateVariablesWith:function(f){var r=f(vars);if(r&&typeof r==='object')vars=r;return Promise.resolve(vars);},deleteVariable:function(k){delete vars[k];return Promise.resolve();},
getChatMessages:function(){return[];},setChatMessages:pnop,setChatMessage:pnop,deleteChatMessages:pnop,
createChatMessages:function(list){var t=firstUserText(list);if(t)send(t);return Promise.resolve();},
getCurrentMessageId:function(){return 0;},getLastMessageId:function(){return 0;},getIframeName:function(){return 'rpnow-card';},
substitudeMacros:sub,substituteMacros:sub,eventOn:nop,eventOnce:nop,eventMakeFirst:nop,eventMakeLast:nop,eventEmit:pnop,eventRemoveListener:nop,eventClearAll:nop,eventClearEvent:nop,eventClearListener:nop,
tavern_events:names,iframe_events:names,errorCatched:function(f){return f;},generate:gen,getCharData:function(){return{name:CHAR};},getPersonaName:function(){return USER;}};
var TH=loose('TavernHelper',thBase);
function JQ(els){this.length=els.length;for(var i=0;i<els.length;i++)this[i]=els[i];}
function each(o,f){for(var i=0;i<o.length;i++)f(o[i],i);return o;}
function evName(n){return String(n&&n.type||n).split('.')[0];}
JQ.prototype={
val:function(v){if(v===undefined)return this.length?this[0].value:undefined;return each(this,function(e){e.value=v;});},
text:function(v){if(v===undefined)return this.length?this[0].textContent:'';return each(this,function(e){e.textContent=v;});},
html:function(v){if(v===undefined)return this.length?this[0].innerHTML:'';return each(this,function(e){e.innerHTML=v;});},
on:function(n,a,b){var f=typeof a==='function'?a:b;if(typeof f!=='function')return this;var ns=String(n).split(' ');return each(this,function(e){ns.forEach(function(x){x=evName(x);if(x&&e.addEventListener)e.addEventListener(x,f);});});},
one:function(n,a,b){return this.on(n,a,b);},
off:function(){return this;},
trigger:function(n){n=evName(n);return each(this,function(e){if(n==='click'&&e.click)e.click();else if(e.dispatchEvent)e.dispatchEvent(new Event(n,{bubbles:true}));});},
click:function(f){return typeof f==='function'?this.on('click',f):this.trigger('click');},
change:function(f){return typeof f==='function'?this.on('change',f):this.trigger('change');},
focus:function(){return each(this,function(e){if(e.focus)e.focus();});},
each:function(f){for(var i=0;i<this.length;i++)if(f.call(this[i],i,this[i])===false)break;return this;},
find:function(q){var r=[];each(this,function(e){if(e.querySelectorAll)try{[].push.apply(r,e.querySelectorAll(q));}catch(x){}});return new JQ(r);},
closest:function(q){var r=[];each(this,function(e){var c=e.closest?e.closest(q):null;if(c)r.push(c);});return new JQ(r);},
parent:function(){var r=[];each(this,function(e){if(e.parentElement)r.push(e.parentElement);});return new JQ(r);},
children:function(){var r=[];each(this,function(e){if(e.children)[].push.apply(r,e.children);});return new JQ(r);},
eq:function(i){return new JQ(this[i]?[this[i]]:[]);},first:function(){return this.eq(0);},get:function(i){return i===undefined?[].slice.call(this):this[i];},
attr:function(k,v){if(v===undefined)return this.length&&this[0].getAttribute?this[0].getAttribute(k):undefined;return each(this,function(e){e.setAttribute(k,v);});},
removeAttr:function(k){return each(this,function(e){e.removeAttribute(k);});},
prop:function(k,v){if(v===undefined)return this.length?this[0][k]:undefined;return each(this,function(e){e[k]=v;});},
data:function(k,v){if(v===undefined)return this.length&&this[0].dataset?this[0].dataset[k]:undefined;return each(this,function(e){e.dataset[k]=v;});},
css:function(k,v){if(typeof k==='string'&&v===undefined)return this.length?getComputedStyle(this[0])[k]:undefined;return each(this,function(e){if(typeof k==='object'){for(var x in k)e.style[x]=k[x];}else e.style[k]=v;});},
addClass:function(c){return each(this,function(e){String(c).split(' ').forEach(function(x){if(x)e.classList.add(x);});});},
removeClass:function(c){return each(this,function(e){String(c).split(' ').forEach(function(x){if(x)e.classList.remove(x);});});},
toggleClass:function(c,on){return each(this,function(e){e.classList.toggle(c,on);});},
hasClass:function(c){return this.length>0&&this[0].classList.contains(c);},
is:function(){return this.length>0;},
show:function(){return each(this,function(e){e.style.display='';e.hidden=false;});},
hide:function(){return each(this,function(e){e.style.display='none';});},
toggle:function(on){return each(this,function(e){var h=on===undefined?e.style.display!=='none':!on;e.style.display=h?'none':'';});},
empty:function(){return each(this,function(e){e.textContent='';});},
remove:function(){return each(this,function(e){if(e.remove)e.remove();});},
append:function(x){return each(this,function(e){if(typeof x==='string')e.insertAdjacentHTML('beforeend',x);else if(x&&x.nodeType)e.appendChild(x);else if(x&&x.length)each(x,function(c){e.appendChild(c);});});},
prepend:function(x){return each(this,function(e){if(typeof x==='string')e.insertAdjacentHTML('afterbegin',x);else if(x&&x.nodeType)e.insertBefore(x,e.firstChild);});}
};
['fadeIn','fadeOut','slideDown','slideUp','slideToggle','animate','stop','scrollTop','before','after','detach','siblings','next','prev','not','filter','unbind','bind','delegate','keydown','keyup','submit','select','blur','width','height','offset','position','wrap','replaceWith','appendTo','prependTo'].forEach(function(n){JQ.prototype[n]=function(){warn('$().'+n);return this;};});
function jq(q){
if(typeof q==='function'){if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){q(jq);});else setTimeout(function(){q(jq);},0);return new JQ([]);}
if(q instanceof JQ)return q;
if(q===window||q===fp)return new JQ([window]);
if(q===fd)return new JQ([document]);
if(q&&(q.nodeType||q===document))return new JQ([q]);
if(typeof q==='string'){var h=pick(q);if(h)return new JQ([h]);var s=q.trim();
if(s.charAt(0)==='<'){var d=document.createElement('div');d.innerHTML=s;return new JQ([].slice.call(d.children));}
try{return new JQ([].slice.call(document.querySelectorAll(q)));}catch(e){return new JQ([]);}}
if(q&&typeof q.length==='number')return new JQ([].slice.call(q));
return new JQ([]);}
jq.fn=JQ.prototype;jq.extend=function(){var a=arguments,t=a[0]===true?a[1]:a[0];for(var i=1;i<a.length;i++)if(a[i]&&typeof a[i]==='object')for(var k in a[i])t[k]=a[i][k];return t;};
jq.each=function(o,f){if(o&&typeof o.length==='number'){for(var i=0;i<o.length;i++)if(f.call(o[i],i,o[i])===false)break;}else for(var k in o)if(f.call(o[k],k,o[k])===false)break;return o;};
jq.isFunction=function(f){return typeof f==='function';};jq.isArray=Array.isArray;jq.trim=function(x){return String(x==null?'':x).trim();};jq.noop=nop;
['ajax','get','post','getJSON','getScript'].forEach(function(n){jq[n]=function(){warn('$.'+n);return{done:function(){return this;},fail:function(){return this;},always:function(){return this;},then:function(){return this;}};};});
var toast={info:nop,success:nop,warning:nop,error:nop,clear:nop};
var fd={getElementById:pick,querySelector:pick,querySelectorAll:function(q){var h=pick(q);return h?[h]:[];},addEventListener:nop,removeEventListener:nop,dispatchEvent:nop,createElement:function(n){return document.createElement(n);},body:fb,documentElement:fr,head:fb,title:''};
var fpBase={document:fd,postMessage:function(m){try{P.postMessage(m,'*');}catch(e){}},triggerSlash:slash,SillyTavern:ST,TavernHelper:TH,getContext:stBase.getContext,Generate:gen,$:jq,jQuery:jq,toastr:toast,eventSource:es,event_types:names,name1:USER,name2:CHAR,
addEventListener:nop,removeEventListener:nop,dispatchEvent:nop,location:{href:'',origin:'',pathname:'/',search:'',hash:'',reload:nop},navigator:window.navigator,localStorage:window.localStorage,sessionStorage:window.sessionStorage,
getComputedStyle:function(e){return window.getComputedStyle(e&&e.nodeType?e:de);},matchMedia:function(q){return window.matchMedia(q);},
setTimeout:function(f,t){return setTimeout(f,t);},clearTimeout:function(i){clearTimeout(i);},requestAnimationFrame:function(f){return requestAnimationFrame(f);},
get innerWidth(){return window.innerWidth;},get innerHeight(){return window.innerHeight;}};
for(var tk in thBase)if(!(tk in fpBase))fpBase[tk]=thBase[tk];
var fp=loose('window.parent',fpBase);
fpBase.parent=fp;fpBase.top=fp;fpBase.window=fp;fpBase.self=fp;
try{Object.defineProperty(window,'parent',{value:fp,configurable:true,writable:true});}catch(e){try{window.parent=fp;}catch(e2){}}
function expose(n,v){try{if(window[n]===undefined)window[n]=v;}catch(e){}}
expose('SillyTavern',ST);expose('TavernHelper',TH);expose('getContext',stBase.getContext);expose('Generate',gen);expose('toastr',toast);expose('$',jq);expose('jQuery',jq);
window.triggerSlash=slash;
for(var gk in thBase)expose(gk,thBase[gk]);
expose('getvar',function(k){return vars[k];});expose('setvar',function(k,v){vars[k]=v;return v;});
var last=-1,queued=false,grown=0;
function measure(){
queued=false;
var b=document.body;if(!de||!b)return;
var h=de.getBoundingClientRect().height;
var kids=b.children,pinned=false;
for(var i=0;i<kids.length;i++){var el=kids[i];var pos='';try{pos=getComputedStyle(el).position;}catch(e){}var r=el.getBoundingClientRect();if(pos==='fixed'){if(r.width>40&&r.height>40)pinned=true;continue;}if(r.width||r.height){var bottom=r.bottom+(window.pageYOffset||0);if(bottom>h)h=bottom;}}
h=Math.ceil(h);
if(h<8&&pinned)h=480;
if(h===last)return;
if(h>last){grown++;if(grown>40)return;}
last=h;post('height',{height:h});
}
function schedule(){if(queued)return;queued=true;(window.requestAnimationFrame||function(f){return setTimeout(f,16);})(measure);}
function settle(){grown=0;schedule();setTimeout(schedule,120);setTimeout(schedule,400);}
window.addEventListener('message',function(ev){
if(ev.source!==P)return;var d=ev.data;if(!d||d[HOST]!==1)return;
if(d.scheme==='dark'||d.scheme==='light'){theme(d.scheme);if(de.getAttribute('data-rp-fragment')==='1')de.style.colorScheme=d.scheme;}
if(typeof d.fg==='string'&&/^[#(),.%\\w\\s-]{1,64}$/.test(d.fg))de.style.setProperty('--rp-fg',d.fg);
schedule();
});
document.addEventListener('click',function(ev){
var t=ev.target;var el=t&&t.closest?t.closest('[data-slash]'):null;
if(el)slash(el.getAttribute('data-slash')||el.textContent||'');
settle();
},true);
['input','change','toggle','load','error','transitionend','animationend'].forEach(function(n){document.addEventListener(n,n==='toggle'?settle:schedule,true);});
window.addEventListener('load',settle);
window.addEventListener('resize',schedule);
document.addEventListener('DOMContentLoaded',function(){
settle();
try{var ro=new ResizeObserver(schedule);ro.observe(document.documentElement);if(document.body)ro.observe(document.body);}catch(e){}
try{new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,attributes:true,characterData:true});}catch(e){}
try{if(document.fonts&&document.fonts.ready)document.fonts.ready.then(schedule);}catch(e){}
});
setTimeout(schedule,200);setTimeout(schedule,1000);
post('ready');
})();`;

/** 渲染时就知道、要同步交给页面的东西：名字和当前主题。 */
export interface CardFrameContext {
  /** 用户（人设）的名字。 */
  user?: string;
  /** 角色的名字。 */
  char?: string;
  /** 应用当前是深色还是浅色。 */
  theme?: 'dark' | 'light';
}

/** 把上下文写成一段可以放进 <script> 的赋值语句（`<` 转掉，防止提前收尾）。 */
function contextScript(ctx: CardFrameContext | undefined): string {
  if (!ctx || (!ctx.user && !ctx.char && !ctx.theme)) return '';
  const safe = {
    user: typeof ctx.user === 'string' ? ctx.user.slice(0, 200) : undefined,
    char: typeof ctx.char === 'string' ? ctx.char.slice(0, 200) : undefined,
    theme: ctx.theme === 'dark' || ctx.theme === 'light' ? ctx.theme : undefined,
  };
  const json = JSON.stringify(safe).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return `<script>window.__rpnowCtx=${json};</script>`;
}

function headInjection(fragment: boolean, ctx?: CardFrameContext): string {
  return (
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>${BASE_CSS}${fragment ? FRAGMENT_CSS : ''}</style>` +
    contextScript(ctx) +
    `<script>${FRAME_SHIM}</script>`
  );
}

/**
 * 把卡片给的源码补成一个可以直接放进 iframe 的完整页面。
 *
 * 卡片自己的内容一个字不改，只在 <head> 最前面插入视口、基础样式和桥接脚本；
 * 没有 <head> 就补一个，连 <html> 都没有（片段）就整个包起来。
 */
export function buildFrameDocument(code: string, ctx?: CardFrameContext): string {
  const hasDoctype = /^\s*<!doctype\b/i.test(code);
  const head = /<head\b[^>]*>/i.exec(code);
  if (head) {
    const at = head.index + head[0].length;
    const doc = code.slice(0, at) + headInjection(false, ctx) + code.slice(at);
    return hasDoctype ? doc : `<!doctype html>${doc}`;
  }
  const html = /<html\b[^>]*>/i.exec(code);
  if (html) {
    const at = html.index + html[0].length;
    const doc = `${code.slice(0, at)}<head><meta charset="utf-8">${headInjection(false, ctx)}</head>${code.slice(at)}`;
    return hasDoctype ? doc : `<!doctype html>${doc}`;
  }
  if (/<body\b/i.test(code)) {
    const body = hasDoctype ? code.replace(/^\s*<!doctype[^>]*>/i, '') : code;
    return `<!doctype html><html><head><meta charset="utf-8">${headInjection(false, ctx)}</head>${body}</html>`;
  }
  return `<!doctype html><html data-rp-fragment="1"><head><meta charset="utf-8">${headInjection(true, ctx)}</head><body>${code}</body></html>`;
}

/** 写进 HTML 属性里要转义的字符。方括号也转掉：气泡后面会把 `[M12]` 换成引用按钮。 */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\[/g, '&#91;')
    .replace(/\]/g, '&#93;');
}

/** 生成 iframe 的 HTML。高度先占位，页面加载后由桥接脚本报上来再调整。 */
export function htmlCardMarkup(code: string, ctx?: CardFrameContext): string {
  const doc = buildFrameDocument(code, ctx);
  return (
    `<div class="rp-frontend-render">` +
    `<div class="rp-html-card"><iframe data-rp-card="1" title="HTML 卡片" sandbox="${FRAME_SANDBOX}" scrolling="no" srcdoc="${escapeAttribute(doc)}" style="height:${FRAME_INITIAL_HEIGHT}px"></iframe></div>` +
    `</div>`
  );
}

/* ------------------------------------------------------------------ 桥接 */

/** iframe 最多能报多高（px）。再高就当它出错了。 */
export const FRAME_MAX_HEIGHT = 20000;
/** 交回聊天的文字最长多少字。 */
export const SLASH_MAX_LENGTH = 8000;

export type CardFrameMessage =
  | { type: 'ready' }
  | { type: 'height'; height: number }
  /** `send`：页面要求直接发出去，而且页面那边确认用户刚点过它。 */
  | { type: 'slash'; text: string; send: boolean }
  | { type: 'unsupported'; name: string };

/**
 * 校验 iframe 发来的消息，只认这四种，其它一律当没看见。
 * （来源窗口是不是我们自己的 iframe，由调用方另外核对。）
 */
export function parseCardFrameMessage(data: unknown): CardFrameMessage | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (d[CARD_MESSAGE_TAG] !== 1) return null;
  if (d.type === 'ready') return { type: 'ready' };
  if (d.type === 'height') {
    const h = d.height;
    if (typeof h !== 'number' || !Number.isFinite(h) || h < 0) return null;
    return { type: 'height', height: Math.min(Math.ceil(h), FRAME_MAX_HEIGHT) };
  }
  if (d.type === 'slash') {
    if (typeof d.text !== 'string') return null;
    const active = d.active === 1;
    if (d.cmd === 1) {
      const action = interpretSlash(d.text);
      return action ? { type: 'slash', text: action.text, send: action.send && active } : null;
    }
    const text = normaliseSlashText(d.text);
    return text ? { type: 'slash', text, send: d.send === 1 && active } : null;
  }
  if (d.type === 'unsupported') {
    if (typeof d.name !== 'string' || !d.name) return null;
    return { type: 'unsupported', name: d.name.replace(/[^\w.$()[\] \u4e00-\u9fff-]/g, '').slice(0, 120) };
  }
  return null;
}

/**
 * 读懂一串酒馆斜杠命令，落到两件事之一：发出一条消息 / 把文字放进输入框。
 *
 *   - 不是斜杠开头：当成普通文字，放进输入框（RP-Hub 卡片就是这么用的）；
 *   - `/send 文字`（后面带不带 `| /trigger` 都一样）：发出去；
 *   - `/setinput 文字`、`/input 文字`：放进输入框；后面跟了 `| /trigger` 就发出去；
 *   - 其它命令（/sys、/sendas、/gen、/echo…）不执行，返回 null。
 */
export function interpretSlash(raw: string): { text: string; send: boolean } | null {
  const source = raw.replace(/\u0000/g, '').trim();
  if (!source) return null;
  if (!source.startsWith('/')) {
    const text = normaliseSlashText(source);
    return text ? { text, send: false } : null;
  }
  // 只在「| 后面紧跟另一条命令」的地方切开，消息正文里的 | 不动。
  const parts = source.split(/\s*\|\s*(?=\/[a-z])/i);
  let text = '';
  let send = false;
  let fill = false;
  let trigger = false;
  for (const part of parts) {
    const m = /^\/([a-z-]+)\b\s*([\s\S]*)$/i.exec(part.trim());
    if (!m) continue;
    const name = m[1].toLowerCase();
    if (name === 'send' && !text) {
      text = stripQuotes(m[2].trim());
      send = true;
    } else if ((name === 'setinput' || name === 'input') && !text) {
      text = stripQuotes(m[2].trim());
      fill = true;
    } else if (name === 'trigger') {
      trigger = true;
    }
  }
  if (!text || (!send && !fill)) return null;
  if (text.length > SLASH_MAX_LENGTH) text = text.slice(0, SLASH_MAX_LENGTH);
  return { text, send: send || trigger };
}

function stripQuotes(text: string): string {
  if (text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    return text.slice(1, -1);
  }
  return text;
}

/**
 * 把卡片交回来的文字整理成「要放进输入框的话」。
 *
 * 酒馆卡片常写成斜杠命令：`/send 文字 | /trigger`、`/setinput 文字`。这里只取
 * 其中的文字，命令本身不执行——宿主只做一件事：把文字放进输入框。
 */
export function normaliseSlashText(raw: string): string {
  let text = raw.replace(/\u0000/g, '').trim();
  if (!text) return '';
  // 管道后面的 /trigger、/continue 之类是「发出去并让模型回复」，这里不自动发。
  text = text.replace(/\s*\|\s*\/(?:trigger|continue|gen|sendas|sys)\b[^|]*$/i, '').trim();
  const cmd = /^\/(send|setinput|input)\b\s*/i.exec(text);
  if (cmd) text = text.slice(cmd[0].length).trim();
  // 命令的参数可以带引号。
  if (cmd && text.length >= 2 && ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))) {
    text = text.slice(1, -1);
  }
  if (text.length > SLASH_MAX_LENGTH) text = text.slice(0, SLASH_MAX_LENGTH);
  return text;
}
