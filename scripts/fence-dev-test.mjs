/** dev 复现真机楼层：无标记围栏 + ```html 围栏混合，断言两者都渲染为卡片 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

const r = await page.evaluate(async () => {
  const { renderSandboxedMessage } = await import('/src/core/render/renderer.ts');
  const sample = [
    '<think_nya>开场独白内容',
    '这里有很多行',
    '</think_nya>',
    '正文第一段。正午过后，热浪顺着林荫道铺开。',
    '<game>正午过后</game>',
    '正文第二段。',
    '`',
    '<!DOCTYPE html>',
    '<html lang="zh-CN"><head><meta charset="UTF-8"></head>',
    '<body><h1>面板A</h1></body></html>',
    '`',
    '<game>正午过后，热浪顺着教学楼侧面狭窄的林荫道。</game>',
    '`html',
    '<!DOCTYPE html>',
    '<html><head><meta charset="UTF-8"></head>',
    '<body><h1>面板B</h1></body></html>',
    '`',
    '结尾正文。',
  ].join('\n');
  const mod = await import('/src/core/render/renderer.ts');
  const out = mod.defaultRenderer.render(sample, { sandboxHtml: true, allowExternalMedia: true, styleScope: '.rp-md' });
  return {
    htmlCards: (out.match(/rp-html-card/g) ?? []).length,
    escapedDoctype: out.includes('&lt;!DOCTYPE'),
    heads: out.slice(0, 160),
  };
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
