import { chromium } from 'playwright';
import { writeFileSync, existsSync, statSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

// 下载 SillyTavern 仓库，检查 public/scripts 的依赖形态
for (const branch of ['release', 'staging']) {
  const u = `https://codeload.github.com/SillyTavern/SillyTavern/zip/refs/heads/${branch}`;
  try {
    const r = await page.request.get(u, { timeout: 90000 });
    console.log(`${branch}: status=${r.status()}`);
    if (r.ok()) {
      const b = await r.body();
      console.log(`  bytes=${b.length}`);
      if (b.length > 500000) {
        writeFileSync('sillytavern.zip', b);
        console.log('  SAVED');
        break;
      }
    }
  } catch (e) {
    console.log(`${branch}: ${String(e.message).slice(0, 90)}`);
  }
}
console.log('file?', existsSync('sillytavern.zip'), existsSync('sillytavern.zip') ? statSync('sillytavern.zip').size : 0);
await browser.close();
