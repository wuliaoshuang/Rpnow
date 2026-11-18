import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

const files = [
  'src/component/message_iframe/index.ts',
  'src/iframe_client/event.ts',
  'src/iframe_client/exported.ts',
  'src/component/script_repository/events.ts',
];

for (const f of files) {
  const u = `https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@main/${f}`;
  try {
    const r = await page.request.get(u, { timeout: 30000 });
    if (r.ok()) {
      const t = await r.text();
      const name = f.split('/').slice(-2).join('_');
      writeFileSync(`th-src-${name}`, t);
      console.log(`OK ${name} ${t.length}`);
    } else {
      console.log(`404 ${f}`);
    }
  } catch (e) {
    console.log(`ERR ${f}: ${String(e.message).slice(0, 80)}`);
  }
}
await browser.close();
