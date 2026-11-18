import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log(`[${m.type()}]`, m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);

const r = await page.evaluate(async () => {
  const out = {};
  const res = await fetch('/vendor/lodash.js');
  out.status = res.status;
  out.bytes = (await res.blob()).size;
  await new Promise((res2, rej) => {
    const s = document.createElement('script');
    s.src = '/vendor/lodash.js';
    s.onload = () => res2();
    s.onerror = () => rej(new Error('script error'));
    document.head.appendChild(s);
  });
  out.windowUnderscore = typeof window._;
  out.windowDash = typeof window['_'];
  out.debounce = typeof window._?.debounce;
  out.jq = typeof window.jQuery;
  out.dollar = typeof window.$;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
