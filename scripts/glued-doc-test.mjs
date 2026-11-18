import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
const r = await page.evaluate(async () => {
  const mod = await import('/src/core/render/renderer.ts');
  // 真机楼层形态：文档与时间戳粘连（无换行）+ 文档内含自定义标签 <cat-header>
  const sample = [
    '24 分钟前<!DOCTYPE html>',
    '<html lang="zh-CN">',
    '<head><meta charset="UTF-8"><style>.cat-header{color:red}</style></head>',
    '<body>',
    '<cat-header>面板标题</cat-header>',
    '<div class="cat-body">内容</div>',
    '</body>',
    '</html>',
    '```<game>正午过后</game>',
    '',
    '正文段落。',
    '```html',
    '<!DOCTYPE html>',
    '<html><body><h1>B</h1></body></html>',
    '```',
  ].join('\n');
  const out = mod.defaultRenderer.render(sample, { sandboxHtml: true, allowExternalMedia: true, styleScope: '.rp-md' });
  return {
    cards: (out.match(/rp-html-card/g) ?? []).length,
    iframeSrcCount: (out.match(/data:text\/html/g) ?? []).length,
    // 文档头是否被转义（不该）
    escapedDoc: out.includes('&lt;!DOCTYPE'),
    // cat-header 在 iframe 源里保留了吗
    catInFrame: decodeURIComponent(out.match(/src="data:text\/html;charset=utf-8,([^"]+)"/)?.[1] ?? '').includes('cat-header'),
    head: out.slice(0, 200),
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
