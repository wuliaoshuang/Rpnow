import { describe, expect, it } from 'vitest';
import {
  CARD_MESSAGE_TAG,
  FRAME_MAX_HEIGHT,
  FRAME_SANDBOX,
  FRAME_SHIM,
  SLASH_MAX_LENGTH,
  buildFrameDocument,
  escapeAttribute,
  extractHtmlCards,
  htmlCardMarkup,
  isFullHtmlDocument,
  looksLikeDocument,
  maskCode,
  normaliseSlashText,
  parseCardFrameMessage,
} from './htmlDocument.js';

const DOC = `<!DOCTYPE html>
<html lang="zh-CN">
<head><style>textarea{background:#eef}</style></head>
<body><textarea id="extra"></textarea><input type="radio" name="a"><script>var x = 1;</script></body>
</html>`;

const placeholder = (n: number) => `<rp-html-card data-rp-html="${n}"></rp-html-card>`;

describe('认出消息里的 HTML 页面', () => {
  it('整条消息就是一个页面', () => {
    expect(isFullHtmlDocument(DOC)).toBe(true);
    expect(isFullHtmlDocument('  <html><body>x</body></html>')).toBe(true);
    expect(isFullHtmlDocument('正文 <html>')).toBe(false);
    const r = extractHtmlCards(DOC);
    expect(r.codes).toEqual([DOC]);
    expect(r.text.trim()).toBe(placeholder(0));
  });

  it('页面原文一个字不改（表单控件、样式、脚本都在）', () => {
    const { codes } = extractHtmlCards(`开头\n\n${DOC}\n\n结尾`);
    expect(codes).toHaveLength(1);
    expect(codes[0]).toBe(DOC);
    expect(codes[0]).toContain('<textarea id="extra">');
    expect(codes[0]).toContain('<input type="radio"');
    expect(codes[0]).toContain('<style>textarea{background:#eef}</style>');
    expect(codes[0]).toContain('<script>var x = 1;</script>');
  });

  it('前后的正文留在外面，只有页面进卡片', () => {
    const r = extractHtmlCards(`夜色压下来。\n\n${DOC}\n\n（选好之后点确认。）`);
    expect(r.text).toContain('夜色压下来。');
    expect(r.text).toContain('（选好之后点确认。）');
    expect(r.text).toContain(placeholder(0));
    expect(r.text).not.toContain('<textarea');
    expect(r.text.indexOf('夜色')).toBeLessThan(r.text.indexOf('<rp-html-card'));
    expect(r.text.indexOf('<rp-html-card')).toBeLessThan(r.text.indexOf('（选好'));
  });

  it('正文和页面粘在同一行也能切开', () => {
    const r = extractHtmlCards(`夜色压下来。${DOC}（选好之后点确认。）`);
    expect(r.codes).toHaveLength(1);
    expect(r.codes[0].startsWith('<html')).toBe(true);
    expect(r.codes[0].endsWith('</html>')).toBe(true);
    expect(r.text).toContain('夜色压下来。');
    expect(r.text).toContain('（选好之后点确认。）');
    expect(r.text).not.toMatch(/<!doctype/i);
  });

  it('一行里的页面（没有换行）', () => {
    const one = '<html><body><input><script>1</script></body></html>';
    const r = extractHtmlCards(`前面${one}后面`);
    expect(r.codes).toEqual([one]);
    expect(r.text.replace(/\s+/g, '')).toBe(`前面${placeholder(0)}后面`.replace(/\s+/g, ''));
  });

  it('```html 围栏里的页面：围栏标记不留在正文里', () => {
    const r = extractHtmlCards(`开头\n\n\`\`\`html\n${DOC}\n\`\`\`\n\n结尾`);
    expect(r.codes).toEqual([DOC]);
    expect(r.text).not.toContain('```');
    expect(r.text).not.toMatch(/<\/html>/i);
    expect(r.text).toContain('开头');
    expect(r.text).toContain('结尾');
  });

  it('裸围栏里是页面也算（预设正则常这么输出）', () => {
    const r = extractHtmlCards(`\`\`\`\n${DOC}\n\`\`\`\n后面的正文`);
    expect(r.codes).toEqual([DOC]);
    expect(r.text).toContain('后面的正文');
    expect(r.text).not.toContain('```');
  });

  it('围栏没收尾（模型少打了 ```）', () => {
    const r = extractHtmlCards(`\`\`\`html\n<div>面板</div>`);
    expect(r.codes).toEqual(['<div>面板</div>']);
  });

  it('粘在正文后面的围栏开头', () => {
    const r = extractHtmlCards(`24 分钟前 \`\`\`\n${DOC}\n\`\`\`<game>正午</game>`);
    expect(r.codes).toEqual([DOC]);
    expect(r.text).toContain('24 分钟前');
  });

  it('两个页面各自成卡', () => {
    const a = '<html><body>A</body></html>';
    const b = '<html><body>B</body></html>';
    const r = extractHtmlCards(`${a}\n中间\n${b}`);
    expect(r.codes).toEqual([a, b]);
    expect(r.text).toContain('中间');
  });

  it('页面没写完（还在流式输出）：算到末尾', () => {
    const r = extractHtmlCards('开头 <html><body><div>写到一半');
    expect(r.codes).toEqual(['<html><body><div>写到一半']);
    expect(r.text).toContain('开头');
  });

  it('别的语言的代码块不动，里面提到 <html> 也不动', () => {
    const md = '看这段：\n\n```js\nconst s = "<html><body></body></html>";\n```\n\n行内 `<input>` 也只是代码。';
    const r = extractHtmlCards(md);
    expect(r.codes).toEqual([]);
    expect(r.text).toBe(md);
  });

  it('普通正文、预设自定义标签、简单 HTML 不进卡片', () => {
    for (const md of [
      '「请停一下。」\n\n他说。',
      '<game>正午</game>\n<options><li>选项一</li></options>',
      '<div class="status"><b>体力</b> 80</div>',
      '<style>.a{color:red}</style><div class="a">状态栏</div>',
      '<details><summary>展开</summary>内容</details>',
    ]) {
      expect(extractHtmlCards(md).codes).toEqual([]);
    }
  });
});

describe('没有 <html> 的片段', () => {
  it('带脚本的片段整段进卡片，前后正文留着', () => {
    const frag = '<style>button{color:red}</style>\n<div id="app"></div>\n<script>document.getElementById("app").textContent="hi"</script>';
    const r = extractHtmlCards(`开头\n\n${frag}\n\n结尾`);
    expect(r.codes).toEqual([frag]);
    expect(r.text).toContain('开头');
    expect(r.text).toContain('结尾');
  });

  it('带表单控件的片段也进卡片', () => {
    const frag = '<div><textarea placeholder="x"></textarea><button>确认</button></div>';
    expect(extractHtmlCards(frag).codes).toEqual([frag]);
    expect(extractHtmlCards('<label><input type="checkbox"> 同意</label>').codes).toHaveLength(1);
    expect(extractHtmlCards('<select><option>a</option></select>').codes).toHaveLength(0 + 1);
  });

  it('脚本没写完：算到末尾，半截代码不露出来', () => {
    const r = extractHtmlCards('开头\n<div>面板</div>\n<script>var a = 1;');
    expect(r.codes).toEqual(['<div>面板</div>\n<script>var a = 1;']);
    expect(r.text).not.toContain('var a');
  });

  it('只有 <body> 的页面', () => {
    const code = '<body><input><script>1</script></body>';
    expect(extractHtmlCards(code).codes).toEqual([code]);
    expect(looksLikeDocument(code)).toBe(true);
    expect(looksLikeDocument('<div>x</div>')).toBe(false);
  });

  it('maskCode 只把代码换成空白，长度不变', () => {
    const md = 'a `<input>` b\n```\n<script>\n```\nc';
    const masked = maskCode(md);
    expect(masked).toHaveLength(md.length);
    expect(masked).not.toContain('<input>');
    expect(masked).not.toContain('<script>');
    expect(masked.startsWith('a ')).toBe(true);
    expect(masked.endsWith('c')).toBe(true);
  });
});

describe('装进 iframe 的页面', () => {
  it('沙箱没有 allow-same-origin，也没有顶层跳转', () => {
    expect(FRAME_SANDBOX).toContain('allow-scripts');
    expect(FRAME_SANDBOX).toContain('allow-forms');
    expect(FRAME_SANDBOX).not.toContain('allow-same-origin');
    expect(FRAME_SANDBOX).not.toContain('allow-top-navigation');
  });

  it('桥接脚本插在 <head> 最前面，在卡片自己的样式和脚本之前', () => {
    const doc = buildFrameDocument(DOC);
    expect(doc.startsWith('<!DOCTYPE html>')).toBe(true);
    const shim = doc.indexOf('window.triggerSlash');
    expect(shim).toBeGreaterThan(doc.indexOf('<head>'));
    expect(shim).toBeLessThan(doc.indexOf('textarea{background:#eef}'));
    expect(shim).toBeLessThan(doc.indexOf('var x = 1;'));
    // 卡片内容原样保留
    expect(doc).toContain('<textarea id="extra"></textarea>');
    expect(doc).toContain('<script>var x = 1;</script>');
    expect(doc).not.toContain('<html data-rp-fragment');
  });

  it('没有 doctype 的补上；没有 <head> 的补一个', () => {
    const doc = buildFrameDocument('<html><body>x</body></html>');
    expect(doc.startsWith('<!doctype html><html><head>')).toBe(true);
    expect(doc).toContain('</head><body>x</body></html>');
    const bodyOnly = buildFrameDocument('<body>x</body>');
    expect(bodyOnly.startsWith('<!doctype html><html><head>')).toBe(true);
    expect(bodyOnly).toContain('</head><body>x</body></html>');
  });

  it('片段整个包起来，带片段标记（跟随应用主题）', () => {
    const doc = buildFrameDocument('<div>x</div>');
    expect(doc.startsWith('<!doctype html><html data-rp-fragment="1"><head>')).toBe(true);
    expect(doc).toContain('<body><div>x</div></body></html>');
    expect(doc).toContain('background:transparent');
  });

  it('桥接脚本自己不会提前结束 <script>', () => {
    expect(FRAME_SHIM).not.toMatch(/<\/script/i);
    expect(FRAME_SHIM).toContain("post('height'");
    expect(FRAME_SHIM).toContain('data-slash');
    expect(FRAME_SHIM).toContain('ResizeObserver');
    expect(FRAME_SHIM).toContain('MutationObserver');
    // 只往父窗口发消息，不读父窗口的任何东西
    expect(FRAME_SHIM).not.toMatch(/parent\.(document|localStorage|indexedDB|__rpnowStore)/);
    expect(FRAME_SHIM).not.toContain('frameElement');
  });

  it('桥接脚本是合法的 JavaScript', () => {
    expect(() => new Function(FRAME_SHIM)).not.toThrow();
  });

  it('iframe 标记：srcdoc 转义干净，没有写死的 320px', () => {
    const html = htmlCardMarkup('<div title="a&b">[M12] "引号" <b>x</b></div>');
    expect(html).toContain(`sandbox="${FRAME_SANDBOX}"`);
    expect(html).toContain('data-rp-card="1"');
    expect(html).toContain('scrolling="no"');
    expect(html).not.toContain('320px');
    expect(html).not.toContain('data:text/html');
    const srcdoc = /srcdoc="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(srcdoc).not.toMatch(/[<>\[\]]/);
    expect(srcdoc).toContain('&#91;M12&#93;');
    expect(srcdoc).toContain('&quot;引号&quot;');
    expect(srcdoc).toContain('a&amp;b');
    // 整个标记里只有一个 iframe 元素，srcdoc 里的标签没有漏出来
    expect(html.match(/<iframe\b/g)).toHaveLength(1);
    expect(html.match(/<script\b/g)).toBeNull();
  });

  it('escapeAttribute', () => {
    expect(escapeAttribute('<a href="x">&[1]</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#91;1&#93;&lt;/a&gt;');
  });
});

describe('iframe 发来的消息', () => {
  const msg = (extra: Record<string, unknown>) => ({ [CARD_MESSAGE_TAG]: 1, ...extra });

  it('只认 ready / height / slash 三种', () => {
    expect(parseCardFrameMessage(msg({ type: 'ready' }))).toEqual({ type: 'ready' });
    expect(parseCardFrameMessage(msg({ type: 'height', height: 512.2 }))).toEqual({ type: 'height', height: 513 });
    expect(parseCardFrameMessage(msg({ type: 'slash', text: ' 开局 ' }))).toEqual({ type: 'slash', text: '开局' });
    expect(parseCardFrameMessage(msg({ type: 'eval', code: 'alert(1)' }))).toBeNull();
    expect(parseCardFrameMessage(msg({ type: 'getState' }))).toBeNull();
    expect(parseCardFrameMessage(msg({ type: 'send', text: 'x' }))).toBeNull();
    expect(parseCardFrameMessage(msg({}))).toBeNull();
  });

  it('没有标记、标记不对、不是对象的都不理', () => {
    expect(parseCardFrameMessage({ type: 'height', height: 10 })).toBeNull();
    expect(parseCardFrameMessage({ [CARD_MESSAGE_TAG]: true, type: 'height', height: 10 })).toBeNull();
    expect(parseCardFrameMessage({ __rpnowTemplate: true, type: 'slash', text: 'x' })).toBeNull();
    expect(parseCardFrameMessage(null)).toBeNull();
    expect(parseCardFrameMessage('height')).toBeNull();
    expect(parseCardFrameMessage(42)).toBeNull();
  });

  it('高度必须是正常的数，超大的封顶', () => {
    expect(parseCardFrameMessage(msg({ type: 'height', height: '500' }))).toBeNull();
    expect(parseCardFrameMessage(msg({ type: 'height', height: NaN }))).toBeNull();
    expect(parseCardFrameMessage(msg({ type: 'height', height: Infinity }))).toBeNull();
    expect(parseCardFrameMessage(msg({ type: 'height', height: -5 }))).toBeNull();
    expect(parseCardFrameMessage(msg({ type: 'height', height: 9e9 }))).toEqual({ type: 'height', height: FRAME_MAX_HEIGHT });
  });

  it('文字必须是非空字符串，超长的截断', () => {
    expect(parseCardFrameMessage(msg({ type: 'slash', text: '' }))).toBeNull();
    expect(parseCardFrameMessage(msg({ type: 'slash', text: '   ' }))).toBeNull();
    expect(parseCardFrameMessage(msg({ type: 'slash', text: { a: 1 } }))).toBeNull();
    expect(parseCardFrameMessage(msg({ type: 'slash' }))).toBeNull();
    const long = parseCardFrameMessage(msg({ type: 'slash', text: 'x'.repeat(SLASH_MAX_LENGTH + 500) }));
    expect(long && long.type === 'slash' && long.text.length).toBe(SLASH_MAX_LENGTH);
  });

  it('酒馆式斜杠命令只取文字，不执行命令', () => {
    expect(normaliseSlashText('/send 我选日常 | /trigger')).toBe('我选日常');
    expect(normaliseSlashText('/setinput 我选日常')).toBe('我选日常');
    expect(normaliseSlashText('/send "带 引号"')).toBe('带 引号');
    expect(normaliseSlashText('【开局】倾向：日常')).toBe('【开局】倾向：日常');
    expect(normaliseSlashText('a | b')).toBe('a | b');
    expect(normaliseSlashText('/sendas name=x 冒充')).toBe('/sendas name=x 冒充');
    expect(normaliseSlashText('  ')).toBe('');
    expect(normaliseSlashText('a\u0000b')).toBe('ab');
  });

  it('正文里只是提到 <html> 不会被当成页面', () => {
    const text = '代码：\n\njs\nconst a = "<html>";\n\n结束。';
    const r = extractHtmlCards(text);
    expect(r.codes).toHaveLength(0);
    expect(r.text).toBe(text);
  });

  it('只有 <html> 开头、后面跟着 <body> 的仍然算页面', () => {
    const r = extractHtmlCards('前文 <html><body><p>hi</p> 还在写');
    expect(r.codes).toHaveLength(1);
    expect(r.text.startsWith('前文 ')).toBe(true);
  });
});
