import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

// 用 GitHub API 拉源码树的 renderer 目录清单
const list = await page.evaluate(async () => {
  const r = await fetch('https://api.github.com/repos/N0VI028/JS-Slash-Runner/git/trees/main?recursive=1');
  if (!r.ok) return { status: r.status };
  const j = await r.json();
  return (j.tree ?? [])
    .filter((t) => t.type === 'blob' && /renderer|iframe/i.test(t.path))
    .map((t) => ({ path: t.path, size: t.size }));
});
console.log(JSON.stringify(list, null, 1).slice(0, 2500));
writeFileSync('th-tree.json', JSON.stringify(list, null, 1));
await browser.close();
