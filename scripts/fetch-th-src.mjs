import { chromium } from 'playwright';
import { writeFileSync, existsSync } from 'node:fs';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

// 1. 先拿 dist/index.js（编译产物，看渲染器到底挂在哪）
for (const u of [
  'https://raw.githubusercontent.com/N0VI028/JS-Slash-Runner/main/dist/index.js',
  'https://cdn.jsdelivr.net/gh/N0VI028/JS-Slash-Runner@main/dist/index.js',
]) {
  try {
    const r = await page.request.get(u, { timeout: 40000 });
    if (r.ok()) {
      const b = await r.body();
      if (b.length > 100000) {
        writeFileSync('th-src-index.js', b.toString('utf8'));
        console.log(`saved index.js from ${u} (${b.length})`);
        break;
      }
    }
    console.log(`fail ${u.slice(0,60)}: ${r.status()}`);
  } catch (e) {
    console.log(`fail ${u.slice(0,60)}: ${String(e.message).slice(0,80)}`);
  }
}

// 2. 源码里的 renderer 相关文件（看它的挂载逻辑与选择器）
for (const u of [
  'https://raw.githubusercontent.com/N0VI028/JS-Slash-Runner/main/src/index.ts',
  'https://raw.githubusercontent.com/N0VI028/JS-Slash-Runner/main/manifest.json',
]) {
  try {
    const r = await page.request.get(u, { timeout: 40000 });
    if (r.ok()) {
      const name = u.endsWith('.ts') ? 'th-src-index.ts' : 'th-manifest.json';
      writeFileSync(name, (await r.body()).toString('utf8'));
      console.log(`saved ${name} (${u.slice(0,60)})`);
    } else {
      console.log(`fail ${u.slice(0,70)}: ${r.status()}`);
    }
  } catch (e) {
    console.log(`fail ${u.slice(0,70)}: ${String(e.message).slice(0,80)}`);
  }
}
await browser.close();
console.log('done');
