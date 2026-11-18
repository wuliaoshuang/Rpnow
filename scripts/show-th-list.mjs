import { readFileSync, writeFileSync } from 'node:fs';

const list = JSON.parse(readFileSync('th-src-list.json', 'utf8'));
const matches = list.matches ?? [];
// 版本回退：列表可能来自缓存 tag，尝试列出的版本
console.log('matches 数:', matches.length);
console.log(matches.join('\n'));

// 找 dist 版本号
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const tags = await page.evaluate(async () => {
  const r = await fetch('https://data.jsdelivr.com/v1/packages/gh/N0VI028/JS-Slash-Runner');
  if (!r.ok) return { status: r.status };
  const j = await r.json();
  return (j.versions ?? []).slice(0, 10).map((v) => v.version);
});
console.log('tags:', JSON.stringify(tags));
await browser.close();
