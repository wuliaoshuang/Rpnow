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

/**
 * 第一步：围栏里的页面（```html、内容是页面的裸围栏）和独占一行开头的页面。
 *
 * 这段逐行扫描是原来 renderer 里的逻辑，原样搬过来（Meowssiah 思维链折叠之类的
 * 预设正则靠它）。区别只有一个：现在它在「转义自定义标签」之前跑，拿到的是原文，
 * 所以页面里的 <input>、<textarea> 不会再被转义成一串文字。
 */
function extractFencedCards(markdown: string, codes: string[]): string {
  const card = (code: string) => {
    codes.push(code);
    return cardPlaceholder(codes.length - 1);
  };
  const lines = markdown.split('\n');
  const outLines: string[] = [];
  let i = 0;
  const startMatch = /(^|\s)```[ \t]*([a-z]*)[ \t]*$/i; // 一行以围栏开头标记结尾
  const containsClose = /```/; // 任何围栏标记都结束卡片正文
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
      if (/<\/html>\s*$/i.test(l)) {
        // 页面写完了。这一行已经收进卡片；紧跟着的那行如果只是收尾的围栏标记，
        // 也一起吃掉——以前这里会把 </html> 再当正文处理一遍，还留下一个孤零零
        // 的 ``` ，后面的正文被它吞成代码块。
        closed = true;
        if (j + 1 < lines.length && /^\s*```\s*$/.test(lines[j + 1])) j++;
        break;
      }
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
    // 围栏开头那一行，标记前面可能还粘着正文（"……正文```html"），留下来。
    const before = line.slice(0, m.index + m[1].length);
    if (before.trim()) outLines.push(before);
    outLines.push(card(text));
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

/** 把消息里所有该进 iframe 的部分换成占位元素。 */
export function extractHtmlCards(markdown: string): HtmlCardExtraction {
  const codes: string[] = [];
  let text = extractFencedCards(markdown, codes);
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
 *   - `window.triggerSlash(text)`：RP-Hub / 酒馆卡片用它把文字交回聊天；
 *   - 点带 `data-slash="…"` 的元素，等于 `triggerSlash(那段文字)`；
 *   - 量页面高度告诉宿主，内容变了（展开折叠、图片加载、脚本改了页面）重新量；
 *     整页都是 position:fixed 的全屏面板量不出高度，这时给 480；
 *   - 沙箱里 localStorage 用不了（会抛错），给一个只活在内存里的替身，
 *     免得卡片脚本一上来就报错停掉。
 */
export const FRAME_SHIM = `(function(){
var TAG='${CARD_MESSAGE_TAG}',HOST='${HOST_MESSAGE_TAG}';
var P=window.parent;
function post(type,extra){try{var m={};m[TAG]=1;m.type=type;if(extra)for(var k in extra)m[k]=extra[k];P.postMessage(m,'*');}catch(e){}}
function mem(){var d={};return{getItem:function(k){k=String(k);return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},setItem:function(k,v){d[String(k)]=String(v);},removeItem:function(k){delete d[String(k)];},clear:function(){d={};},key:function(i){return Object.keys(d)[i]||null;},get length(){return Object.keys(d).length;}};}
['localStorage','sessionStorage'].forEach(function(n){try{void window[n].length;}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true});}catch(e2){}}});
window.triggerSlash=function(t){post('slash',{text:String(t==null?'':t)});};
var stageT=0,ta=document.createElement('textarea'),sb=document.createElement('div');
ta.id='send_textarea';sb.id='send_but';
var vd=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value');
function stage(){if(stageT)return;stageT=setTimeout(function(){stageT=0;var v=vd.get.call(ta);if(v)post('slash',{text:v});},0);}
function nop(){}
try{Object.defineProperty(ta,'value',{configurable:true,get:function(){return vd.get.call(ta);},set:function(v){vd.set.call(ta,v);stage();}});}catch(e){}
ta.addEventListener('input',stage);ta.addEventListener('change',stage);sb.addEventListener('click',stage);
function pick(q){q=String(q);return q.indexOf('send_textarea')>=0?ta:q.indexOf('send_but')>=0?sb:null;}
var fd={getElementById:pick,querySelector:pick,querySelectorAll:function(){return[];},addEventListener:nop,removeEventListener:nop,body:null,documentElement:null};
var fp={document:fd,postMessage:function(m){try{P.postMessage(m,'*');}catch(e){}},triggerSlash:window.triggerSlash,addEventListener:nop,removeEventListener:nop,location:{}};
fp.parent=fp;fp.top=fp;fp.window=fp;fp.self=fp;
try{Object.defineProperty(window,'parent',{value:fp,configurable:true,writable:true});}catch(e){try{window.parent=fp;}catch(e2){}}
var last=-1,queued=false,grown=0;
function measure(){
queued=false;
var de=document.documentElement,b=document.body;if(!de||!b)return;
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
var de=document.documentElement;
if(d.scheme==='dark'||d.scheme==='light'){if(de.getAttribute('data-rp-fragment')==='1')de.style.colorScheme=d.scheme;}
if(typeof d.fg==='string'&&/^[#(),.%\\w\\s-]{1,64}$/.test(d.fg))de.style.setProperty('--rp-fg',d.fg);
schedule();
});
document.addEventListener('click',function(ev){
var t=ev.target;var el=t&&t.closest?t.closest('[data-slash]'):null;
if(el)post('slash',{text:el.getAttribute('data-slash')||el.textContent||''});
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

function headInjection(fragment: boolean): string {
  return (
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<style>${BASE_CSS}${fragment ? FRAGMENT_CSS : ''}</style>` +
    `<script>${FRAME_SHIM}</script>`
  );
}

/**
 * 把卡片给的源码补成一个可以直接放进 iframe 的完整页面。
 *
 * 卡片自己的内容一个字不改，只在 <head> 最前面插入视口、基础样式和桥接脚本；
 * 没有 <head> 就补一个，连 <html> 都没有（片段）就整个包起来。
 */
export function buildFrameDocument(code: string): string {
  const hasDoctype = /^\s*<!doctype\b/i.test(code);
  const head = /<head\b[^>]*>/i.exec(code);
  if (head) {
    const at = head.index + head[0].length;
    const doc = code.slice(0, at) + headInjection(false) + code.slice(at);
    return hasDoctype ? doc : `<!doctype html>${doc}`;
  }
  const html = /<html\b[^>]*>/i.exec(code);
  if (html) {
    const at = html.index + html[0].length;
    const doc = `${code.slice(0, at)}<head><meta charset="utf-8">${headInjection(false)}</head>${code.slice(at)}`;
    return hasDoctype ? doc : `<!doctype html>${doc}`;
  }
  if (/<body\b/i.test(code)) {
    const body = hasDoctype ? code.replace(/^\s*<!doctype[^>]*>/i, '') : code;
    return `<!doctype html><html><head><meta charset="utf-8">${headInjection(false)}</head>${body}</html>`;
  }
  return `<!doctype html><html data-rp-fragment="1"><head><meta charset="utf-8">${headInjection(true)}</head><body>${code}</body></html>`;
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
export function htmlCardMarkup(code: string): string {
  const doc = buildFrameDocument(code);
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
  | { type: 'slash'; text: string };

/**
 * 校验 iframe 发来的消息，只认三种，其它一律当没看见。
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
    const text = normaliseSlashText(d.text);
    return text ? { type: 'slash', text } : null;
  }
  return null;
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
