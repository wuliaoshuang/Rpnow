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
  interpretSlash,
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
    // 页面从 doctype 算起（以前会把粘在正文后面的 doctype 丢掉）。
    expect(r.codes[0]).toBe(DOC);
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
    expect(parseCardFrameMessage(msg({ type: 'slash', text: ' 开局 ' }))).toEqual({ type: 'slash', text: '开局', send: false });
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

/* ------------------------------------------------------------------
 * 卡片正则产出的页面：first_mes 里只有一个自定义标签，正则把它换成一整页。
 * 下面每一种写法都必须整页进 iframe：正文里不剩围栏、不剩 doctype、不剩页面标签。
 * ------------------------------------------------------------------ */
const PAGE = `<!doctype html>
<html lang="zh-CN">
<!-- 开局页：放在开场白里，确认后把首轮消息发进酒馆 -->
<head>
<meta charset="utf-8">
<title>开局</title>
<style>
  :root { --page: #e9edf6; color-scheme: light; }

  @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --page: #111; } }
  button, textarea { font: inherit; background: none; border: 0; }
</style>
</head>
<body>
<div class="preview-tools"><button id="reset">重新开始</button></div>

<section class="step"><h2>01 开局倾向</h2><div id="chips"></div></section>
<textarea id="extra" placeholder="例：故事在成都"></textarea>
<button id="confirm">确认开局</button>
<script>
  const md = "\`\`\`";
  document.getElementById('confirm').addEventListener('click', () => triggerSlash('/send 开局|/trigger'));
</script>
</body>
</html>`;
const ONE_LINE = PAGE.replace(/\n\s*/g, '');
const NO_CLOSERS = PAGE.replace('</body>\n</html>', '');

const SHAPES: Record<string, string> = {
  '裸页面': PAGE,
  '```html 围栏': '```html\n' + PAGE + '\n```',
  '裸围栏': '```\n' + PAGE + '\n```',
  '围栏和 doctype 粘在同一行': '```html' + PAGE + '\n```',
  '整页压成一行、紧贴围栏': '```html' + ONE_LINE + '```',
  '整页压成一行、收尾围栏另起一行': '```html' + ONE_LINE + '\n```',
  'doctype 后面空一行': PAGE.replace('<!doctype html>\n', '<!doctype html>\n\n'),
  '围栏里 doctype 后面空一行': '```html\n' + PAGE.replace('<!doctype html>\n', '<!doctype html>\n\n') + '\n```',
  '没有 <html>/<body> 标签': PAGE.replace(/<\/?(?:html|head|body)\b[^>]*>\n?/g, ''),
  '没有收尾标签': NO_CLOSERS,
  '围栏里没有收尾标签': '```html\n' + NO_CLOSERS + '\n```',
  '围栏没关': '```html\n' + PAGE,
  '裸围栏没关': '```\n' + PAGE,
  '缩进四格': PAGE.replace(/^/gm, '    '),
  '缩进 Tab': PAGE.replace(/^/gm, '\t'),
  '围栏连同页面一起缩进': ('```html\n' + PAGE + '\n```').replace(/^/gm, '  '),
  'Windows 换行': PAGE.replace(/\n/g, '\r\n'),
  '围栏 + Windows 换行': ('```html\n' + PAGE + '\n```').replace(/\n/g, '\r\n'),
  '正文里带 ``` 和宏': '```html\n' + PAGE.replace('<body>', '<body><p hidden>{{user}}：`c` $1 ```js 代码``` </p>') + '\n```',
  '<template> 里再套一个页面': '```html\n' + PAGE.replace('<body>', '<body><template><!doctype html><html><body>x</body></html></template>') + '\n```',
  '60KB 以上': '```html\n' + PAGE.replace('</body>', `<div hidden>${'填充内容 '.repeat(14000)}</div></body>`) + '\n```',
  '~~~ 围栏': '~~~html\n' + PAGE + '\n~~~',
  '四个反引号的围栏': '````html\n' + PAGE + '\n````',
  '大写 DOCTYPE': '```html\n' + PAGE.replace('<!doctype html>', '<!DOCTYPE HTML>') + '\n```',
  '围栏行尾带空格': '```html \n' + PAGE + '\n``` ',
  '大写 HTML 语言名': '```HTML\n' + PAGE + '\n```',
};

/** 正文里不该剩下任何页面的东西。 */
function expectNothingLeft(text: string) {
  const rest = text.replace(/<rp-html-card data-rp-html="\d+"><\/rp-html-card>/g, '');
  expect(rest).not.toMatch(/```|~~~/);
  expect(rest).not.toMatch(/<!doctype/i);
  expect(rest).not.toMatch(/<\/?(?:html|head|body|style|script|textarea|button|section|div|template)\b/i);
  expect(rest).not.toMatch(/开局倾向|重新开始|确认开局|triggerSlash|color-scheme/);
}

describe('卡片正则产出的页面：每种写法都整页进 iframe', () => {
  for (const [name, shape] of Object.entries(SHAPES)) {
    for (const all of [true, false]) {
      const label = `${name}（沙箱开关${all ? '开' : '关'}）`;
      it(`${label}：只有页面`, () => {
        const r = extractHtmlCards(shape, all);
        expect(r.codes).toHaveLength(1);
        expect(r.codes[0]).toContain('id="confirm"');
        expect(r.codes[0]).toContain('triggerSlash');
        expect(r.codes[0]).not.toMatch(/^```|```$/);
        expectNothingLeft(r.text);
        expect(r.text.trim()).toBe(placeholder(0));
      });
      it(`${label}：前后有正文`, () => {
        const r = extractHtmlCards(`欢迎来到这里。\n\n${shape}\n\n后面还有一句正文。`, all);
        expect(r.codes).toHaveLength(1);
        expect(r.codes[0]).toContain('id="confirm"');
        expectNothingLeft(r.text);
        expect(r.text).toContain('欢迎来到这里。');
        // 没有收尾标签、围栏也没关的页面，后面的字分不出来，只能一起算进页面。
        const openEnded = /没关|^没有收尾标签$|^没有 <html>/.test(name);
        if (!openEnded) expect(r.text).toContain('后面还有一句正文。');
      });
    }
  }

  it('正文紧贴着页面（同一行）也切得开', () => {
    const r = extractHtmlCards('欢迎```html' + ONE_LINE + '```正文');
    expect(r.codes).toHaveLength(1);
    expectNothingLeft(r.text);
    expect(r.text).toMatch(/^欢迎/);
    expect(r.text).toMatch(/正文$/);
  });

  it('别的语言的围栏、行内代码里提到页面标签，不算页面', () => {
    const js = '看代码：\n\n```js\nconst a = "<!doctype html><html><body></body></html>";\n```\n\n完。';
    expect(extractHtmlCards(js).codes).toHaveLength(0);
    expect(extractHtmlCards(js).text).toBe(js);
    const inline = '写 `<!doctype html>` 开头，再写 `<body>`。';
    expect(extractHtmlCards(inline).codes).toHaveLength(0);
    const bare = '```\nlet s = 1;\nconst page = "<html><body></body></html>";\n```';
    expect(extractHtmlCards(bare).codes).toHaveLength(0);
  });

  it('代码示例后面跟着真页面：示例留着，页面进 iframe', () => {
    const r = extractHtmlCards('```js\nconst a = "<html>";\n```\n\n' + PAGE);
    expect(r.codes).toEqual([PAGE]);
    expect(r.text).toContain('```js\nconst a = "<html>";\n```');
  });

  it('两个页面各进各的 iframe', () => {
    const r = extractHtmlCards('```html\n' + PAGE + '\n```\n\n中间一句。\n\n' + PAGE);
    expect(r.codes).toHaveLength(2);
    expectNothingLeft(r.text);
    expect(r.text).toContain('中间一句。');
  });

  it('沙箱开关关着：纯静态的 ```html 片段照旧当代码块，带脚本或表单控件的仍然进 iframe', () => {
    const staticFence = '```html\n<div class="a">静态</div>\n```';
    expect(extractHtmlCards(staticFence, false).codes).toHaveLength(0);
    expect(extractHtmlCards(staticFence, true).codes).toHaveLength(1);
    const withScript = '```html\n<div id="a"></div>\n<script>a.textContent = "```";</script>\n```';
    const r = extractHtmlCards(withScript, false);
    expect(r.codes).toEqual(['<div id="a"></div>\n<script>a.textContent = "```";</script>']);
    expect(extractHtmlCards('<style>.a{color:red}</style><div class="a"><input id="x"></div><script>1</script>', false).codes).toHaveLength(1);
  });
});

describe('酒馆斜杠命令落到两件事：发出去 / 放进输入框', () => {
  it('/send 是发出去，/setinput 是放进输入框', () => {
    expect(interpretSlash('/send 我选日常|/trigger')).toEqual({ text: '我选日常', send: true });
    expect(interpretSlash('/send 我选日常 | /trigger')).toEqual({ text: '我选日常', send: true });
    expect(interpretSlash('/send 我选日常')).toEqual({ text: '我选日常', send: true });
    expect(interpretSlash('/send "带 引号"')).toEqual({ text: '带 引号', send: true });
    expect(interpretSlash('/setinput 我选日常')).toEqual({ text: '我选日常', send: false });
    expect(interpretSlash('/setinput 我选日常 | /trigger')).toEqual({ text: '我选日常', send: true });
    expect(interpretSlash('/input 我选日常')).toEqual({ text: '我选日常', send: false });
  });

  it('正文里的竖线、换行原样保留', () => {
    expect(interpretSlash('/send 倾向：日常 | 模式：慢\n年龄：成年|/trigger')).toEqual({ text: '倾向：日常 | 模式：慢\n年龄：成年', send: true });
  });

  it('不是斜杠开头的当普通文字放进输入框；别的命令不执行', () => {
    expect(interpretSlash('【开局】倾向：日常')).toEqual({ text: '【开局】倾向：日常', send: false });
    expect(interpretSlash('/sys 系统消息')).toBeNull();
    expect(interpretSlash('/sendas name=x 冒充')).toBeNull();
    expect(interpretSlash('/trigger')).toBeNull();
    expect(interpretSlash('/gen 写点什么')).toBeNull();
    expect(interpretSlash('   ')).toBeNull();
  });

  it('「发出去」要页面确认用户刚点过，否则只放进输入框', () => {
    const msg = (extra: Record<string, unknown>) => ({ [CARD_MESSAGE_TAG]: 1, type: 'slash', ...extra });
    expect(parseCardFrameMessage(msg({ text: '/send 开局|/trigger', cmd: 1, active: 1 }))).toEqual({ type: 'slash', text: '开局', send: true });
    expect(parseCardFrameMessage(msg({ text: '/send 开局|/trigger', cmd: 1, active: 0 }))).toEqual({ type: 'slash', text: '开局', send: false });
    expect(parseCardFrameMessage(msg({ text: '/send 开局|/trigger', cmd: 1 }))).toEqual({ type: 'slash', text: '开局', send: false });
    expect(parseCardFrameMessage(msg({ text: '开局', send: 1, active: 1 }))).toEqual({ type: 'slash', text: '开局', send: true });
    expect(parseCardFrameMessage(msg({ text: '开局', send: 1 }))).toEqual({ type: 'slash', text: '开局', send: false });
    expect(parseCardFrameMessage(msg({ text: '开局', send: true, active: true }))).toEqual({ type: 'slash', text: '开局', send: false });
    expect(parseCardFrameMessage(msg({ text: '/sys x', cmd: 1, active: 1 }))).toBeNull();
  });

  it('不支持的调用只留一个干净的名字', () => {
    expect(parseCardFrameMessage({ [CARD_MESSAGE_TAG]: 1, type: 'unsupported', name: 'TavernHelper.foo<script>' })).toEqual({
      type: 'unsupported',
      name: 'TavernHelper.fooscript',
    });
    expect(parseCardFrameMessage({ [CARD_MESSAGE_TAG]: 1, type: 'unsupported', name: 5 })).toBeNull();
  });
});

describe('页面里的酒馆替身', () => {
  it('桥接脚本提供这些入口', () => {
    for (const name of ['SillyTavern', 'TavernHelper', 'getContext', 'triggerSlash', 'sendMessageAsUser', 'createChatMessages', 'executeSlashCommands', 'send_textarea', 'send_but', 'jQuery', 'name1', 'name2', 'getVariables', 'userActivation']) {
      expect(FRAME_SHIM).toContain(name);
    }
    expect(() => new Function(FRAME_SHIM)).not.toThrow();
  });

  it('名字和主题同步写进页面，尖括号转掉', () => {
    const doc = buildFrameDocument(PAGE, { user: '林离</script><b>', char: '属性标签系统', theme: 'dark' });
    const ctx = doc.indexOf('window.__rpnowCtx=');
    expect(ctx).toBeGreaterThan(0);
    expect(ctx).toBeLessThan(doc.indexOf('window.triggerSlash'));
    expect(doc).toContain('"theme":"dark"');
    expect(doc).toContain('\\u003c/script>\\u003cb>');
    expect(doc).not.toContain('林离</script>');
    expect(buildFrameDocument(PAGE)).not.toContain('__rpnowCtx=');
    expect(buildFrameDocument(PAGE, { theme: 'purple' as never })).not.toContain('purple');
  });
});
