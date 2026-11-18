/**
 * 真实 SillyTavern（本地 1.19.0）活体参照探针。
 *
 * 目的：确认「预设 + 正则 + 酒馆助手」在真 ST 里的关系与行为，作为 RPNow
 * 兼容层的对照。只做观察，不改动 ST 数据。
 */
import { chromium } from 'playwright';

const BASE = process.env.ST_URL ?? 'http://127.0.0.1:8000/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().slice(0, 180));
});
page.on('pageerror', (e) => errors.push('pageerror: ' + String(e.message).slice(0, 180)));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// ST 需要 webpack 编译 + APP_READY
await page.waitForTimeout(12000);

const info = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  hasChat: !!document.getElementById('chat'),
  hasExtensionsSettings: !!document.getElementById('extensions_settings'),
  tavernHelperNode: !!document.getElementById('tavern_helper'),
  bodyHead: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 240),
  // 扩展相关按钮
  buttons: Array.from(document.querySelectorAll('button, .menu_button'))
    .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30),
}));
console.log(JSON.stringify(info, null, 1));
console.log('errors:', JSON.stringify(errors.slice(0, 8)));
await page.screenshot({ path: 'screenshots/st-live.png' }).catch(() => {});
await browser.close();
