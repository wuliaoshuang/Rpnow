/** 真机验证：酒馆助手 Vue 面板 + 渲染映射 DOM 是否就位。 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) {
  console.log('no page');
  process.exit(1);
}
await page.waitForTimeout(800);

// 进入插件页查看酒馆助手状态
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('main button')];
  const target = rows.find((b) => (b.textContent || '').includes('插件管理'));
  if (target) target.click();
});
await page.waitForTimeout(1200);

const r = await page.evaluate(() => {
  const text = (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ');
  return {
    hasTH: text.includes('酒馆助手'),
    thState: text.includes('酒馆助手')
      ? text.slice(text.indexOf('酒馆助手'), text.indexOf('酒馆助手') + 80)
      : null,
    // DOM 映射探针（进入聊天页后才有）
  };
});
console.log('插件状态:', JSON.stringify(r, null, 1));

// 切到聊天页检查 DOM 映射
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('button')];
  const chat = btns.find((b) => (b.getAttribute('aria-label') || '').includes('聊天') || (b.textContent || '').trim() === '聊天');
  if (chat) chat.click();
});
await page.waitForTimeout(1500);

const dom = await page.evaluate(() => ({
  chatEl: Boolean(document.getElementById('chat')),
  mesCount: document.querySelectorAll('#chat > .mes').length,
  firstMesid: document.querySelector('#chat > .mes')?.getAttribute('mesid') ?? null,
  preCode: document.querySelectorAll('#chat .mes pre code').length,
}));
console.log('DOM 映射:', JSON.stringify(dom, null, 1));
await browser.close();
