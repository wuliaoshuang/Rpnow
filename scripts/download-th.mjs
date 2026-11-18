import { chromium } from 'playwright';
import { writeFileSync, existsSync } from 'node:fs';

const REPO = 'N0VI028/JS-Slash-Runner';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

for (const branch of ['main', 'master']) {
  const u = `https://codeload.github.com/${REPO}/zip/refs/heads/${branch}`;
  try {
    const r = await page.request.get(u, { timeout: 60000 });
    console.log(`${branch}: status=${r.status()}`);
    if (r.ok()) {
      const b = await r.body();
      console.log(`  bytes=${b.length}`);
      if (b.length > 50000) {
        writeFileSync('tavern-helper-real.zip', b);
        console.log('  SAVED');
        break;
      }
    }
  } catch (e) {
    console.log(`${branch}: ${String(e.message).slice(0, 100)}`);
  }
}
console.log('file?', existsSync('tavern-helper-real.zip'), existsSync('tavern-helper-real.zip') ? (await import('node:fs')).statSync('tavern-helper-real.zip').size : 0);
await browser.close();
