import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

// github.com 页面上下文内 fetch api.github.com（同域带凭证，通常能通）
await page.goto('https://github.com/N0VI028/JS-Slash-Runner', { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
await page.waitForTimeout(2000);

const tree = await page.evaluate(async () => {
  const r = await fetch('https://api.github.com/repos/N0VI028/JS-Slash-Runner/git/trees/main?recursive=1', {
    headers: { Accept: 'application/vnd.github+json' },
  });
  if (!r.ok) return { status: r.status };
  const j = await r.json();
  return (j.tree ?? [])
    .filter((t) => t.type === 'blob' && /(renderer|iframe|event)/i.test(t.path) && t.path.endsWith('.ts'))
    .map((t) => ({ path: t.path, size: t.size }));
});
console.log(JSON.stringify(tree, null, 1));
writeFileSync('th-tree.json', JSON.stringify(tree, null, 1));
await browser.close();
