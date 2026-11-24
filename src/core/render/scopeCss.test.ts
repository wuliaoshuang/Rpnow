import { describe, expect, it } from 'vitest';
import { sanitizeInlineStyle, scopeCss, scopeSelector, stripCssComments } from './scopeCss.js';

const S = '.rp-md';
const run = (css: string, allowExternal = false) => scopeCss(css, S, allowExternal);

/** 每条规则的选择器（不含 at 规则的前导）。 */
function selectorsOf(css: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[{}])\s*([^{}@][^{}]*)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) out.push(m[1].trim());
  return out;
}

describe('scopeCss：元素选择器出不了气泡', () => {
  it('textarea / button 这类元素选择器加上 scope', () => {
    expect(run('textarea{background:#eef;resize:vertical}')).toBe('.rp-md textarea{background:#eef;resize:vertical;}');
    expect(run('button{color:red}')).toBe('.rp-md button{color:red;}');
  });

  it('样式表的第一条规则也加（旧实现把 <style> 标签的 > 当成了选择器）', () => {
    const out = run(':root{--x:1}\ntextarea{color:red}');
    expect(out).toBe('.rp-md{--x:1;}.rp-md textarea{color:red;}');
  });

  it('通配符 * 只作用在气泡里面', () => {
    expect(run('*{box-sizing:border-box;margin:0;padding:0}')).toBe('.rp-md *{box-sizing:border-box;margin:0;padding:0;}');
    expect(run('*,*::before,*::after{margin:0}')).toBe('.rp-md *, .rp-md *::before, .rp-md *::after{margin:0;}');
  });

  it('逗号分开的每一个选择器都加', () => {
    expect(run('h1, textarea ,input[type=text]{color:red}')).toBe(
      '.rp-md h1, .rp-md textarea, .rp-md input[type=text]{color:red;}',
    );
  });

  it(':is() / :not() 里的逗号不当分隔符', () => {
    expect(run(':is(textarea, input):not(.a, .b){color:red}')).toBe(
      '.rp-md :is(textarea, input):not(.custom-a, .custom-b){color:red;}',
    );
  });
});

describe('scopeCss：html / body / :root 指向气泡自己', () => {
  it('单独出现', () => {
    expect(run('html{color:red}')).toBe('.rp-md{color:red;}');
    expect(run('body{background:#050510}')).toBe('.rp-md{background:#050510;}');
    expect(run(':root{--ink:#fff}')).toBe('.rp-md{--ink:#fff;}');
  });

  it('连着写的 html body / html > body 合成一个', () => {
    expect(run('html body{margin:0}')).toBe('.rp-md{margin:0;}');
    expect(run('html > body .panel{margin:0}')).toBe('.rp-md .custom-panel{margin:0;}');
    expect(run('html,body{margin:0}')).toBe('.rp-md, .rp-md{margin:0;}');
  });

  it('body 后面跟后代', () => {
    expect(run('body textarea{color:red}')).toBe('.rp-md textarea{color:red;}');
    expect(run('body>div{color:red}')).toBe('.rp-md>div{color:red;}');
  });

  it('body.dark 这种带条件的，条件留在 scope 上（不会无条件生效）', () => {
    expect(run('body.dark .x{color:red}')).toBe('.rp-md.custom-dark .custom-x{color:red;}');
  });

  it('夹在中间的 body 不特殊处理，整体仍在 scope 里', () => {
    expect(run('.a body{color:red}')).toBe('.rp-md .custom-a body{color:red;}');
    expect(scopeSelector(':is(html, body)', S)).toBe('.rp-md :is(html, body)');
  });

  it('bodybuilder 这种以 body 开头的词不误伤', () => {
    expect(run('bodybuilder{color:red}')).toBe('.rp-md bodybuilder{color:red;}');
  });
});

describe('scopeCss：at 规则', () => {
  it('@media 里的每一条规则都加（旧实现漏掉第一条）', () => {
    const out = run('@media (max-width:480px){textarea{font-size:16px}.wrap{padding:12px}}');
    expect(out).toBe('@media (max-width:480px){.rp-md textarea{font-size:16px;}.rp-md .custom-wrap{padding:12px;}}');
  });

  it('@supports / @container / @layer 递归处理，多层嵌套也一样', () => {
    const out = run('@supports (display:grid){@media screen{button{color:red}}}@layer base{input{color:blue}}@container (min-width:1px){a{color:red}}');
    for (const sel of selectorsOf(out)) expect(sel.startsWith('.rp-md')).toBe(true);
    expect(out).toContain('@supports (display:grid){@media screen{.rp-md button{color:red;}}}');
    expect(out).toContain('@layer base{.rp-md input{color:blue;}}');
    expect(out).toContain('@container (min-width:1px){.rp-md a{color:red;}}');
  });

  it('@import 丢掉，不管有没有分号结尾', () => {
    expect(run('@import url("https://evil.example/x.css");a{color:red}', true)).toBe('.rp-md a{color:red;}');
    expect(run('@import "x.css"', true)).toBe('');
    expect(run('@charset "utf-8";a{color:red}')).toBe('.rp-md a{color:red;}');
  });

  it('@property / @page / 不认识的 at 规则丢掉', () => {
    expect(run('@property --x{syntax:"<color>";inherits:true;initial-value:red}a{color:red}')).toBe('.rp-md a{color:red;}');
    expect(run('@page{margin:0}@whatever x{a{color:red}}b{color:red}')).toBe('.rp-md b{color:red;}');
  });

  it('@keyframes 改名，animation 跟着改，帧选择器不加前缀', () => {
    const out = run('@keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}.x{animation:spin 1s linear infinite}.y{animation-name:spin}');
    expect(out).toContain('@keyframes rpc-spin{from{transform:rotate(0);}to{transform:rotate(360deg);}}');
    expect(out).toContain('.rp-md .custom-x{animation:rpc-spin 1s linear infinite;}');
    expect(out).toContain('.rp-md .custom-y{animation-name:rpc-spin;}');
    expect(out).not.toMatch(/@keyframes spin\b/);
  });

  it('@font-face：外部地址被拦掉后整块不留', () => {
    expect(run('@font-face{font-family:X;src:url(https://a.example/x.woff2)}a{color:red}')).toBe('.rp-md a{color:red;}');
    expect(run('@font-face{font-family:X;src:url(https://a.example/x.woff2)}', true)).toContain('@font-face{');
  });
});

describe('scopeCss：声明', () => {
  it('position:fixed 改成 absolute（只能盖在气泡里）', () => {
    expect(run('.mask{position:fixed;inset:0}')).toBe('.rp-md .custom-mask{position:absolute;inset:0;}');
    expect(run('.mask{position: FIXED !important}')).toBe('.rp-md .custom-mask{position:absolute !important;}');
    expect(run('.ok{position:sticky}')).toBe('.rp-md .custom-ok{position:sticky;}');
  });

  it('宽度上的 vw 换成百分比，字号上的不动', () => {
    expect(run('.bar{width:100vw;max-width:90vw;margin-left:-5vw}')).toBe('.rp-md .custom-bar{width:100%;max-width:90%;margin-left:-5%;}');
    expect(run('.t{font-size:4vw;height:50vh}')).toBe('.rp-md .custom-t{font-size:4vw;height:50vh;}');
    expect(run('.c{width:calc(100vw - 20px)}')).toBe('.rp-md .custom-c{width:calc(100% - 20px);}');
  });

  it('没开外部媒体时，带远程地址的声明丢掉；data: 留着', () => {
    expect(run('a{background:url(https://x.example/a.png);color:red}')).toBe('.rp-md a{color:red;}');
    expect(run('a{background:url(//x.example/a.png)}')).toBe('.rp-md a{}');
    expect(run('a{background:url(https://x.example/a.png)}', true)).toBe('.rp-md a{background:url(https://x.example/a.png);}');
    expect(run('a{background:url(data:image/png;base64,AAAA//BB)}')).toBe('.rp-md a{background:url(data:image/png;base64,AAAA//BB);}');
  });

  it('expression() / javascript: / behavior 丢掉', () => {
    expect(run('a{width:expression(alert(1));color:red}')).toBe('.rp-md a{color:red;}');
    expect(run('a{background:url("javascript:alert(1)")}', true)).toBe('.rp-md a{}');
    expect(run('a{behavior:url(x.htc)}', true)).toBe('.rp-md a{}');
  });

  it('值里的分号（data: 地址、字符串）不把声明切断', () => {
    expect(run('a{content:"a;b";color:red}')).toBe('.rp-md a{content:"a;b";color:red;}');
  });
});

describe('scopeCss：钻不出去的写法', () => {
  it('输出里没有 <，拼不出 </style>', () => {
    const out = run('a{}</style ><img src=x onerror=alert(1)>b{color:red}');
    expect(out).not.toContain('<');
    expect(out).not.toMatch(/<\/style/i);
  });

  it('content 里的 < 写成 CSS 转义', () => {
    expect(run('a::before{content:"<b>"}')).toBe('.rp-md a::before{content:"\\3c b>";}');
  });

  it('注释里的花括号不影响解析', () => {
    expect(run('/* } textarea{ */ textarea{color:red} /* { */ button{color:blue}')).toBe(
      '.rp-md textarea{color:red;}.rp-md button{color:blue;}',
    );
    expect(stripCssComments('a{content:"/* not a comment */"}')).toBe('a{content:"/* not a comment */"}');
  });

  it('字符串里的花括号不影响解析', () => {
    expect(run('a::after{content:"}"}textarea{color:red}')).toBe('.rp-md a::after{content:"}";}.rp-md textarea{color:red;}');
  });

  it('多出来的 } 不会让后面的规则漏掉前缀', () => {
    const out = run('a{color:red}} textarea{color:blue} } button{color:green}');
    expect(out).toBe('.rp-md a{color:red;}.rp-md textarea{color:blue;}.rp-md button{color:green;}');
  });

  it('没写完的样式（被截断）不抛错，已有的规则照样在 scope 里', () => {
    const out = run('textarea{background:#eef;resi');
    expect(out).toBe('.rp-md textarea{background:#eef;}');
    expect(run('@media (max-width:1px){textarea{color:red')).toBe('@media (max-width:1px){.rp-md textarea{color:red;}}');
  });

  it('CSS 嵌套：里层规则跟着外层走', () => {
    expect(run('.card{color:red; textarea{color:blue} &:hover{color:green}}')).toBe(
      '.rp-md .custom-card{color:red;textarea{color:blue;}&:hover{color:green;}}',
    );
  });

  it('类名加 custom- 前缀，属性选择器里的点不动', () => {
    expect(run('.btn.primary{color:red}')).toBe('.rp-md .custom-btn.custom-primary{color:red;}');
    expect(run('img[src$=".png"]{color:red}')).toBe('.rp-md img[src$=".png"]{color:red;}');
    expect(run('.rp-x .custom-y .fa-icon{color:red}')).toBe('.rp-md .rp-x .custom-y .fa-icon{color:red;}');
  });

  it('一张完整的卡片样式表：所有规则都在 scope 里', () => {
    const css = `
      :root{--ink:#e6ecff}
      *{box-sizing:border-box;margin:0;padding:0}
      html,body{background:#050510;color:var(--ink)}
      header{position:fixed;top:0;left:0;width:100vw}
      button{font:inherit}
      textarea{width:100%;background:#eef0ff;resize:vertical}
      input[type=radio]{accent-color:red}
      @media (max-width:480px){ textarea{font-size:16px} .wrap{padding:12px} }
    `;
    const out = run(css);
    const sels = selectorsOf(out);
    expect(sels.length).toBeGreaterThanOrEqual(9);
    for (const sel of sels) {
      for (const part of sel.split(',')) expect(part.trim().startsWith('.rp-md')).toBe(true);
    }
    expect(out).not.toContain('position:fixed');
    expect(out).not.toContain('100vw');
  });
});

describe('sanitizeInlineStyle：元素上的 style 属性', () => {
  it('fixed → absolute，vw → %', () => {
    expect(sanitizeInlineStyle('position:fixed; top:0; width:100vw', false)).toBe('position:absolute;top:0;width:100%;');
  });
  it('远程地址按外部媒体开关处理', () => {
    expect(sanitizeInlineStyle('background:url(https://x.example/a.png);color:red', false)).toBe('color:red;');
    expect(sanitizeInlineStyle('background:url(https://x.example/a.png)', true)).toBe('background:url(https://x.example/a.png);');
  });
  it('花括号进不来', () => {
    expect(sanitizeInlineStyle('color:red} body{display:none', false)).not.toMatch(/[{}]/);
  });
});
