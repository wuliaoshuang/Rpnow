import { chromium } from 'playwright';
import { writeFileSync, existsSync } from 'node:fs';

const FILES = [
  'public/scripts/utils.js',
  'public/scripts/i18n.js',
  'public/scripts/extensions.js',
  'public/scripts/macros.js',
  'public/scripts/tokenizers.js',
  'public/scripts/world-info.js',
  'public/scripts/personas.js',
  'public/scripts/openai.js',
  'public/scripts/slash-commands.js',
  'public/script.js',
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();

const out = {};
for (const f of FILES) {
  for (const branch of ['release', 'staging']) {
    const u = `https://raw.githubusercontent.com/SillyTavern/SillyTavern/${branch}/${f}`;
    try {
      const r = await page.request.get(u, { timeout: 25000 });
      if (r.ok()) {
        const b = await r.body();
        out[f] = { branch, bytes: b.length, text: b.toString('utf8') };
        console.log(`OK  ${f} (${branch}) ${b.length}b`);
        break;
      }
    } catch (e) {
      /* try next branch */
    }
  }
  if (!out[f]) console.log(`FAIL ${f}`);
}

// 分析每个文件的 import 形态
for (const [f, info] of Object.entries(out)) {
  const src = info.text;
  const imports = [...src.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((m) => m[1]);
  const bare = imports.filter((s) => !s.startsWith('.'));
  const rel = imports.filter((s) => s.startsWith('.'));
  console.log(`\n=== ${f} (${info.bytes}b) ===`);
  console.log('  相对:', rel.slice(0, 12).join(', ') || '(无)');
  console.log('  裸模块:', bare.slice(0, 12).join(', ') || '(无)');
}
writeFileSync('st-host-files.json', JSON.stringify(out));
await browser.close();
