import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

const r = await page.evaluate(async () => {
  const r = await fetch('https://data.jsdelivr.com/v1/packages/gh/N0VI028/JS-Slash-Runner@4.12.1');
  if (!r.ok) return { status: r.status };
  const j = await r.json();
  // 迭代遍历（避免深递归爆栈），只收集 src/ 与根下的 ts/js/vue 文件
  const out = [];
  const stack = [{ files: j.files ?? [], prefix: '' }];
  while (stack.length) {
    const { files, prefix } = stack.pop();
    for (const f of files) {
      const p = prefix + f.name;
      if (f.type === 'directory') {
        stack.push({ files: f.files ?? [], prefix: p + '/' });
      } else {
        if (!p.startsWith('src/') || /\.(ts|vue)$/.test(p)) out.push(p);
      }
    }
  }
  return { total: out.length, srcFiles: out.filter((p) => /iframe|renderer|event/i.test(p)) };
});
console.log(JSON.stringify(r, null, 1));
writeFileSync('th-412-tree.json', JSON.stringify(r, null, 1));
await browser.close();
