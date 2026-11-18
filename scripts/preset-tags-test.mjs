/** 验证：预设自定义标签在渲染管线中的命运（无任何插件） */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
const r = await page.evaluate(async () => {
  const mod = await import('/src/core/render/renderer.ts');
  const sample = [
    '<game>正午过后，热浪顺着教学楼侧面狭窄的绿化带蒸腾而起。</game>',
    '',
    '<think_nya>她其实在担心你</think_nya>',
    '',
    '<background>教室里风扇吱呀转着</background>',
    '',
    '普通正文段落。',
    '',
    '<options>',
    '<li>去教室</li><li>回宿舍</li>',
    '</options>',
  ].join('\n');
  const out = mod.defaultRenderer.render(sample, { sandboxHtml: true, allowExternalMedia: true, styleScope: '.rp-md' });
  return {
    // 各标签的结局
    gameKept: out.includes('<game>') || out.includes('&lt;game&gt;'),
    gameEscaped: out.includes('&lt;game&gt;'),
    gameSwallowed: !out.includes('game'),
    gameTextKept: out.includes('热浪顺着教学楼'),
    thinkNyaKept: out.includes('她其实在担心你'),
    backgroundKept: out.includes('教室里风扇'),
    optionsKept: out.includes('去教室'),
    head: out.slice(0, 420),
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
