/**
* 测试夹具：仿「属性标签系统」卡的开局页。
*
* 真卡的做法：开场白里只写一个自定义标签 `<AttrTagOpening/>`，卡片「高级」里的正则
* 脚本把它替换成一整页 HTML（包在 ```html 围栏里）。这里照用户贴出来的开头仿了一份
* （结构一致：<html> 后面紧跟一段注释、缩进两格的样式、空行隔开的规则、
* `html.in-tavern`、`.preview-tools`、color-mix、prefers-color-scheme），
* 页面内容和脚本是自己写的，不是那张卡的原文。
*/

export const OPENING_TAG = '<AttrTagOpening/>';
export const OPENING_FIND = '/<AttrTagOpening\\s*\\/?>/g';

const STYLE = `
:root {
--page: #e9edf6; --panel: #f8faff; --text: #1c2233; --muted: #6b7388;
--line: #cfd6e6; --accent: #3b82c4; --accent2: #6a4fd8;
color-scheme: light;
}

@media (prefers-color-scheme: dark) {
:root:not([data-theme="light"]) { --page: #05050c; --panel: #0b0d18; --text: #e6ecff; --muted: #8a93ad; --line: #1d3a52; color-scheme: dark;}
}

:root[data-theme="dark"] { --page: #05050c; --panel: #0b0d18; --text: #e6ecff; --muted: #8a93ad; --line: #1d3a52; color-scheme: dark;}

* { box-sizing: border-box; margin: 0; padding: 0; -webkit-tap-highlight-color: transparent;}

::selection { background: color-mix(in srgb, var(--accent) 35%, transparent);}

body { background: var(--page); color: var(--text); padding: 16px; font: 14px/1.6 system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;}

html.in-tavern body { background: transparent; padding: 0;}

button, textarea { font: inherit; color: inherit; background: none; border: 0;}

button { cursor: pointer; user-select: none;}

[hidden] { display: none!important;}

/* 预览专用，在酒馆里会移除 */
.preview-tools { display: flex; gap: 12px; margin-bottom: 12px; color: var(--muted);}

.opener { border-radius: 18px; background: color-mix(in srgb, var(--panel) 92%, var(--accent)); overflow: hidden;}

.opener[data-period="清晨"] { --accent: #d89a4a;}

.opener::after { content: ""; display: block; height: 1px;}

.hero { position: relative; padding: 28px 18px 14px; border: 1px solid var(--line); border-radius: 18px; background: linear-gradient(180deg, #ffffff, #eef1ff); color: #1c2233;}

.hero h1 { font-size: 26px; letter-spacing:.2em;}

.content { padding: 4px 14px 16px;}

.step { margin-top: 18px;}

.step h2 { display: flex; align-items: center; gap: 10px; font-size: 15px; border-bottom: 1px solid var(--line); padding-bottom: 6px; margin-bottom: 10px;}

.step h2 i { color: var(--accent); font-style: normal; font-size: 12px;}

.chips { display: flex; flex-wrap: wrap; gap: 8px;}

.chip { border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px;}

.chip[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: transparent;}

.scene { display: flex; align-items: center; justify-content: space-between; gap: 12px;}

.reroll { border: 1px solid var(--line); border-radius: 12px; padding: 10px 16px; color: var(--accent);}

textarea { display: block; width: 100%; min-height: 72px; background: #eef0ff; color: #223; border: 1px solid #cfd6ee; border-radius: 12px; padding: 12px; resize: vertical;}

details { margin: 14px 0; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px;}

.confirm { display: block; width: 100%; padding: 16px; border-radius: 14px; background: linear-gradient(90deg, var(--accent), var(--accent2)); color: #fff; font-size: 17px; letter-spacing:.5em;}

@media (max-width: 480px) {
textarea { font-size: 16px;}
.content { padding: 4px 10px 14px;}
}
`;

const BODY = `
<div class="preview-tools">
<button type="button" id="restart">重新开始</button>
</div>

<main class="opener" data-period="清晨">
<header class="hero">
<h1>属性标签系统</h1>
<p>选一个开场，第一幕里系统会按你的人设替你建档。</p>
</header>

<div class="content">
<section class="step">
<h2><i>01</i>开局倾向</h2>
<div class="chips" id="tend"></div>
</section>

<section class="step">
<h2><i>02</i>开场情境</h2>
<div class="scene"><span id="scene"></span><button type="button" class="reroll" id="reroll">换一张</button></div>
</section>

<section class="step">
<h2><i>03</i>首名角色年龄</h2>
<div class="chips" id="age"></div>
</section>

<section class="step">
<h2><i>04</i>运行模式</h2>
<div class="chips" id="mode"></div>
</section>

<section class="step">
<h2><i>05</i>补充</h2>
<textarea id="extra" placeholder="例：故事在成都，今天刚请了半天假"></textarea>
</section>

<details id="preview"><summary>将发出的首条消息</summary><pre id="out" style="white-space:pre-wrap"></pre></details>

<button type="button" class="confirm" id="confirm">确认开局</button>
<p id="state" hidden></p>
</div>
</main>
`;

/**
* 页面脚本。`detect` 决定它怎么判断「我在酒馆里」，`send` 决定确认时怎么把消息交出去。
* 都是酒馆前端卡里常见的写法；任何一种没被支持，脚本顶上就会抛错，01–04 就是空的。
*/
const DETECT = {
// 最常见：能拿到 SillyTavern 上下文就算在酒馆里。
context: `typeof SillyTavern!== 'undefined' && typeof SillyTavern.getContext === 'function'`,
// 通过 parent 判断。
parent: `window.parent!== window &&!!(window.parent.SillyTavern || window.parent.TavernHelper || window.parent.triggerSlash)`,
// 酒馆助手。
helper: `typeof TavernHelper!== 'undefined' || typeof triggerSlash === 'function'`,
// 找上层页面的输入框。
dom: `!!(window.parent && window.parent.document && window.parent.document.querySelector('#send_textarea'))`,
};

const SEND = {
slash: `await triggerSlash('/send ' + text + ' | /trigger');`,
slashParent: `await window.parent.triggerSlash('/send ' + text + ' | /trigger');`,
helper: `await TavernHelper.triggerSlash('/send ' + text + ' | /trigger');`,
setinput: `await triggerSlash('/setinput ' + text);`,
context: `var c = SillyTavern.getContext(); await c.executeSlashCommandsWithOptions('/send ' + text + ' | /trigger');`,
contextSend: `var c = SillyTavern.getContext(); await c.sendMessageAsUser(text); await c.Generate();`,
jquery: `window.parent.$('#send_textarea').val(text).trigger('input'); window.parent.$('#send_but').trigger('click');`,
dom: `var ta = window.parent.document.querySelector('#send_textarea'); ta.value = text; ta.dispatchEvent(new Event('input', { bubbles: true})); window.parent.document.querySelector('#send_but').click();`,
createChat: `await TavernHelper.createChatMessages([{ role: 'user', message: text}]); await TavernHelper.triggerSlash('/trigger');`,
};

export const DETECT_KINDS = Object.keys(DETECT);
export const SEND_KINDS = Object.keys(SEND);

export function openingScript({ detect = 'context', send = 'slash', autoSend = false} = {}) {
return `
(async function () {
var root = document.documentElement;
var inTavern = false;
try { inTavern = ${DETECT[detect]};} catch (e) { inTavern = false;}
if (inTavern) {
root.classList.add('in-tavern');
var tools = document.querySelector('.preview-tools');
if (tools) tools.remove();
}
// 酒馆卡常见：读名字、读写变量、用 lodash / toastr。少一个就整段停掉。
var userName = '你', charName = '';
try { var ctx = SillyTavern.getContext(); userName = ctx.name1 || userName; charName = ctx.name2 || charName;} catch (e) {}
try { if (typeof getvar === 'function') { await setvar('opening_seen', '1');}} catch (e) {}
var pools = { tend: ['日常', '暧昧', '悬疑'], age: ['18-22', '23-28', '29+'], mode: ['轻量', '完整'], scene: ['雨夜便利店', '清晨地铁', '深夜办公室']};
var st = { tend: pools.tend[0], age: pools.age[0], mode: pools.mode[0], scene: 0};
function chips(id, key) {
var box = document.getElementById(id); box.innerHTML = '';
pools[key].forEach(function (t) {
var b = document.createElement('button'); b.type = 'button'; b.className = 'chip'; b.textContent = t;
b.setAttribute('aria-pressed', String(st[key] === t)); b.setAttribute('data-chip', key + ':' + t);
b.onclick = function () { st[key] = t; render();}; box.appendChild(b);
});
}
function message() {
var extra = document.getElementById('extra').value.trim();
return '倾向：' + st.tend + '；情境：' + pools.scene[st.scene] + '；年龄：' + st.age + '；模式：' + st.mode + (extra? '；补充：' + extra: '') + '；我是' + userName;
}
function render() {
chips('tend', 'tend'); chips('age', 'age'); chips('mode', 'mode');
document.getElementById('scene').textContent = pools.scene[st.scene];
document.getElementById('out').textContent = message();
}
document.getElementById('reroll').onclick = function () { st.scene = (st.scene + 1) % pools.scene.length; render();};
document.getElementById('extra').addEventListener('input', render);
async function confirm() {
var text = message();
var state = document.getElementById('state');
try { ${SEND[send]} state.textContent = '已发出';} catch (e) { state.textContent = '发送失败：' + e;}
state.hidden = false;
}
document.getElementById('confirm').onclick = confirm;
var re = document.getElementById('restart'); if (re) re.onclick = function () { st.scene = 0; render();};
render();
root.setAttribute('data-ready', '1');
${autoSend? 'confirm();': ''}
})();
`;
}

/** 多行写法的整页（和真卡一样：<html> 后面紧跟一段注释）。 */
export function openingPage(opts = {}) {
return (
'<!doctype html>\n' +
'<html lang="zh-CN">\n' +
'<!-- 属性标签系统卡开局页：放在开场白里，选倾向、模式、年龄段，本地摇开场情境，确认后把首轮消息发进酒馆。直接用浏览器打开时是预览 -->\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
'<title>开局</title>\n' +
`<style>${STYLE}</style>\n` +
'</head>\n' +
`<body>${BODY}\n<script>${openingScript(opts)}</script>\n` +
'</body>\n' +
'</html>'
);
}

/** 把整页压成一行（聊天里贴出来的样子；有些导出工具也会这么存）。 */
export function oneLine(page) {
return page
.replace(/\/\*[\s\S]*?\*\//g, '')
.replace(/^\s*\/\/.*$/gm, '')
.replace(/\s*\n\s*/g, ' ');
}

const indent = (s, pad) => s.split('\n').map((l) => (l? pad + l: l)).join('\n');

/**
* 正则 replaceString 的各种形状。每一种渲染出来都必须是：整页在隔离框里，
* 气泡里不剩代码块、不剩页面零件，选项由脚本生成，样式不外漏。
*/
export function openingShapes(opts = {}) {
const page = openingPage(opts);
const flat = oneLine(page);
const noHtml = page
.replace(/<html[^>]*>\n/, '')
.replace('<head>\n', '')
.replace('</head>\n', '')
.replace(/<body>/, '')
.replace('</body>\n</html>', '');
return {
// 真卡的写法：```html 围栏 + 多行。
real_fence_multiline: '```html\n' + page + '\n```',
// 贴出来的样子：围栏标记后面不换行，整页一行。
real_fence_oneline: '```html' + flat + '```',
real_fence_oneline_newline_close: '```html' + flat + '\n```',
real_fence_first_line_glued: '```html' + page + '\n```',
a_raw: page,
a_raw_oneline: flat,
c_fence_bare: '```\n' + page + '\n```',
d_doctype_blank_line: page.replace('<!doctype html>\n', '<!doctype html>\n\n'),
d_fence_doctype_blank_line: '```html\n' + page.replace('<!doctype html>\n', '<!doctype html>\n\n') + '\n```',
e_no_html_tags: noHtml,
e_fence_no_html_tags: '```html\n' + noHtml + '\n```',
f_no_closers: page.replace('</body>\n</html>', ''),
f_fence_no_closers: '```html\n' + page.replace('</body>\n</html>', '') + '\n```',
g_fence_unclosed: '```html\n' + page,
g_fence_bare_unclosed: '```\n' + page,
h_indent_spaces: indent(page, ' '),
h_indent_tabs: indent(page, '\t'),
h_fence_indented: indent('```html\n' + page + '\n```', ' '),
i_crlf: page.replace(/\n/g, '\r\n'),
i_fence_crlf: ('```html\n' + page + '\n```').replace(/\n/g, '\r\n'),
k_backticks_and_macros: '```html\n' + page.replace('<body>', '<body><p hidden>{{user}} 与 {{char}}：`code` $1 ```js 代码``` </p>') + '\n```',
l_nested_template: '```html\n' + page.replace('<body>', '<body><template><!doctype html><html><body>x</body></html></template>') + '\n```',
m_large: '```html\n' + page.replace('</body>', `<div hidden>${'填充内容 '.repeat(14000)}</div></body>`) + '\n```',
n_tilde_fence: '~~~html\n' + page + '\n~~~',
o_four_backticks: '````html\n' + page + '\n````',
p_upper_doctype: '```html\n' + page.replace('<!doctype html>', '<!DOCTYPE HTML>') + '\n```',
q_fence_trailing_space: '```html \n' + page + '\n``` ',
r_fence_lang_upper: '```HTML\n' + page + '\n```',
};
}

/** 一条酒馆格式的显示层正则脚本。 */
export function openingRegexScript(replaceString, over = {}) {
return {
id: 'attr-tag-opening',
scriptName: '开局页',
findRegex: OPENING_FIND,
replaceString,
trimStrings: [],
placement: [2],
disabled: false,
markdownOnly: true,
promptOnly: false,
runOnEdit: true,
substituteRegex: 0,
minDepth: null,
maxDepth: null,
...over,
};
}
