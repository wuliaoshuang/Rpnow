import { chromium } from 'playwright';
import { writeFileSync, existsSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('https://github.com', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await page.waitForTimeout(1500);

const out = await page.evaluate(async () => {
  const res = {};
  try {
    const r = await fetch('https://api.github.com/search/repositories?q=JS-Slash-Runner&per_page=10', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    res.status = r.status;
    if (r.ok) {
      const j = await r.json();
      res.items = (j.items ?? []).map((i) => ({ full_name: i.full_name, desc: (i.description ?? '').slice(0, 60), stars: i.stargazers_count }));
    }
  } catch (e) {
    res.err = String(e.message).slice(0, 120);
  }
  return res;
});
console.log('search:', JSON.stringify(out, null, 1));

if (out.items?.length) {
  const top = out.items[0].full_name;
  for (const branch of ['main', 'master']) {
    const u = `https://codeload.github.com/${top}/zip/refs/heads/${branch}`;
    const r = await page.request.get(u, { timeout: 30000 }).catch((e) => ({ err: String(e.message).slice(0, 80) }));
    if (r.ok && r.ok()) {
      const b = await r.body();
      if (b.length > 20000) {
        writeFileSync('tavern-helper-real.zip', b);
        console.log(`saved from ${top}@${branch}: ${b.length} bytes`);
        break;
      }
    } else {
      console.log(`${branch}: status=${r.status?.() ?? 'err'}`);
    }
  }
}
console.log('file?', existsSync('tavern-helper-real.zip'));
await browser.close();
