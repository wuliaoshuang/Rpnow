import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

// jsdelivr CDN 之前可达 —— 拉渲染器的源码片段（未压缩的文档/源片段）
const targets = [
  'https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@main/src/component/iframe/IframeDomain.ts',
  'https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@main/src/component/iframe/iframe_events.ts',
  'https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@main/src/function/function_render.ts',
  'https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@main/src/core/context/proxy.ts',
];
for (const u of targets) {
  try {
    const r = await page.request.get(u, { timeout: 30000 });
    if (r.ok()) {
      const t = await r.text();
      const name = u.split('/').pop();
      writeFileSync(`th-src-${name}`, t);
      console.log(`OK ${name} ${t.length}`);
    } else {
      console.log(`404 ${u.split('/').pop()}`);
    }
  } catch (e) {
    console.log(`ERR ${u.split('/').pop()}: ${String(e.message).slice(0, 80)}`);
  }
}
await browser.close();
