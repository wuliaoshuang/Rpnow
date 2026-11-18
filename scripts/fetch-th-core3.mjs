import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

const files = [
  'src/component/message_iframe/index.ts',
  'src/iframe_client/event.ts',
  'src/component/script_repository/events.ts',
];

for (const f of files) {
  const u = `https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@4.12.1/${f}`;
  try {
    const r = await page.request.get(u, { timeout: 30000 });
    const t = await r.text();
    if (r.ok() && t.length > 300 && !t.includes("Couldn't find")) {
      const name = f.split('/').slice(-2).join('_');
      writeFileSync(`th-src-${name}`, t);
      console.log(`OK ${name} ${t.length}`);
    } else {
      console.log(`bad ${f}: status=${r.status()} len=${t.length} head=${t.slice(0, 60)}`);
    }
  } catch (e) {
    console.log(`ERR ${f}: ${String(e.message).slice(0, 80)}`);
  }
}
await browser.close();
