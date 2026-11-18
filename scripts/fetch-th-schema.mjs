import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

// 拿 type/settings.ts 里的 GlobalSettings schema（默认值）
for (const f of ['src/type/settings.ts', 'src/type/backward.ts']) {
  const u = `https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@4.12.1/${f}`;
  const r = await page.request.get(u, { timeout: 30000 });
  const t = await r.text();
  if (r.ok() && !t.includes("Couldn't find")) {
    const name = f.split('/').slice(-2).join('_');
    writeFileSync(`th-src-${name}`, t);
    console.log(`OK ${name} ${t.length}`);
  } else {
    console.log(`bad ${f}: ${r.status()}`);
  }
}
await browser.close();
