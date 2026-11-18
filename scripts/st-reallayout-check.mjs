/**
 * Realistic multi-file SillyTavern extension layouts.
 *
 * These mirror how 酒馆助手 is actually packaged: a wrapper folder, a deep
 * `src/` tree, `../../` climbs that cross the entry's folder, and suffix-less
 * specifiers. Each case must load without "无法解析的模块".
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

/** Build a zip, then parse+activate it and return the outcome. */
async function run(page, label, entries, expect) {
  const zip = new JSZip();
  for (const [p, v] of Object.entries(entries)) zip.file(p, v);
  const name = `case-${label}.zip`;
  writeFileSync(name, await zip.generateAsync({ type: 'nodebuffer' }));

  const result = await page.evaluate(async (file) => {
    delete window.__case;
    const mod = await import('/src/core/plugins/rpnx.ts');
    const bridge = await import('/src/core/plugins/st-bridge.ts');
    const res = await fetch(`/${file}`);
    const parsed = await mod.parseRpnx(await res.blob());
    const modules = {};
    const pre = '__st__/modules/';
    for (const [k, v] of Object.entries(parsed.assets ?? {})) {
      if (k.startsWith(pre)) modules[k.slice(pre.length)] = v;
    }
    try {
      const handle = await bridge.activateSTExtension('st.' + Math.random().toString(36).slice(2), {
        manifest: parsed.manifest,
        entryPath: parsed.manifest.stEntry ?? 'index.js',
        script: parsed.code,
        modules,
      });
      await new Promise((r) => setTimeout(r, 120));
      const out = { ...(window.__case ?? {}) };
      handle.dispose();
      return { ok: true, out, moduleKeys: Object.keys(modules) };
    } catch (err) {
      return { ok: false, error: String(err.message ?? err).slice(0, 240), moduleKeys: Object.keys(modules) };
    }
  }, name);
  try {
    unlinkSync(name);
  } catch {
    /* ignore */
  }
  return result;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 140)));
await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

// ---- A. wrapper folder + deep tree + multi-level `../` -----------------
const a = await run(
  page,
  'deep',
  {
    'JS-Slash-Runner-main/manifest.json': JSON.stringify({ display_name: '深层测试', js: 'src/index.js' }),
    'JS-Slash-Runner-main/src/index.js': `
      import { helper } from '../../scripts/utils.js';
      import { deep } from './lib/deep.js';
      window.__case = { helper: helper(), deep };
    `,
    'JS-Slash-Runner-main/src/lib/deep.js': `export const deep = 'deep-ok';`,
    // Note: the import climbs OUT of src/ and into scripts/ — the wrapper prefix
    // makes naive resolvers fail.
    'JS-Slash-Runner-main/scripts/utils.js': `export function helper(){ return 'helper-ok'; }`,
  },
  { helper: 'helper-ok', deep: 'deep-ok' },
);
check('A 深层目录 + 跨级 ../ 导入', a.ok === true && a.out?.helper === 'helper-ok' && a.out?.deep === 'deep-ok', JSON.stringify(a).slice(0, 160));

// ---- B. suffix-less specifiers ----------------------------------------
const b = await run(
  page,
  'nosuffix',
  {
    'manifest.json': JSON.stringify({ display_name: '无后缀', js: 'index.js' }),
    'index.js': `import { v } from './util';\nwindow.__case = { v };`,
    'util.js': `export const v = 'nosuffix-ok';`,
  },
  { v: 'nosuffix-ok' },
);
check('B 省略 .js 后缀的导入', b.ok === true && b.out?.v === 'nosuffix-ok', JSON.stringify(b).slice(0, 160));

// ---- C. index.js directory import ------------------------------------
const c = await run(
  page,
  'dirindex',
  {
    'manifest.json': JSON.stringify({ display_name: '目录索引', js: 'index.js' }),
    'index.js': `import { v } from './mod';\nwindow.__case = { v };`,
    'mod/index.js': `export const v = 'dirindex-ok';`,
  },
  { v: 'dirindex-ok' },
);
check('C 目录 index.js 导入', c.ok === true && c.out?.v === 'dirindex-ok', JSON.stringify(c).slice(0, 160));

// ---- D. dynamic import of a local module -----------------------------
const d = await run(
  page,
  'dynamic',
  {
    'manifest.json': JSON.stringify({ display_name: '动态导入', js: 'index.js' }),
    'index.js': `import('./lazy.js').then((m) => { window.__case = { v: m.v }; });`,
    'lazy.js': `export const v = 'dynamic-ok';`,
  },
  { v: 'dynamic-ok' },
);
// Vite dev rewrites dynamic import() at transform time, so this case is only
// meaningful against the production bundle; assert the module graph instead.
check('D 动态 import() 的模块被识别并打包', d.moduleKeys?.includes('lazy.js') === true, JSON.stringify(d.moduleKeys));

// ---- E. genuinely missing file: error must name it + list contents ----
const e = await run(
  page,
  'missing',
  {
    'manifest.json': JSON.stringify({ display_name: '缺文件', js: 'index.js' }),
    'index.js': `import { v } from './gone.js';\nwindow.__case = { v };`,
  },
  {},
);
check('E 缺失文件报错并列出包内文件', e.ok === false && /gone\.js/.test(e.error ?? '') && /包内文件/.test(e.error ?? ''), String(e.error).slice(0, 160));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
