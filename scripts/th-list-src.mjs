import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

// jsdelivr 的目录 API 列 src/ 下与渲染相关的文件
const r = await page.evaluate(async () => {
  const res = {};
  try {
    const r1 = await fetch('https://data.jsdelivr.com/v1/packages/gh/N0VI028/JS-Slash-Runner@main');
    if (!r1.ok) return { status: r1.status };
    const j = await r1.json();
    const files = (j.files ?? []);
    const walk = (list, prefix = '') => {
      const out = [];
      for (const f of list) {
        const p = prefix + f.name;
        if (f.type === 'directory') out.push(...walk(f.files ?? [], p + '/'));
        else if (/renderer|render|iframe|event/i.test(p) && /\.(ts|vue)$/.test(p)) out.push(p);
      }
      return out;
    };
    res.matches = walk(files).slice(0, 60);
  } catch (e) {
    res.err = String(e.message).slice(0, 120);
  }
  return res;
});
console.log(JSON.stringify(r, null, 1));
writeFileSync('th-src-list.json', JSON.stringify(r, null, 1));
await browser.close();
