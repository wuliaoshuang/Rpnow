/**
 * Multi-file SillyTavern extensions: relative imports between packaged modules
 * must resolve.
 *
 * Regression: the bridge evaluated the entry file as a single blob module, so
 * `import … from '../../scripts/utils.js'` failed with
 * "Failed to resolve module specifier" (酒馆助手 v4 behaviour on device).
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

// Build a realistic multi-file extension: entry imports a nested helper.
const zip = new JSZip();
zip.file('manifest.json', JSON.stringify({ display_name: '多文件测试', name: 'multifile-test', js: 'index.js' }));
zip.file(
  'index.js',
  [
    `import { greet } from './scripts/utils.js';`,
    `import { DEEP } from './scripts/lib/deep.js';`,
    `const ctx = SillyTavern.getContext();`,
    `window.__mf = { greet: greet('世界'), deep: DEEP, chatLen: ctx.chat.length, char: ctx.name2 };`,
  ].join('\n'),
);
zip.file('scripts/utils.js', `import { DEEP } from './lib/deep.js';\nexport function greet(n) { return 'hi ' + n + ' ' + DEEP; }`);
zip.file('scripts/lib/deep.js', `export const DEEP = 'deep-value';`);
const ZIP = 'test-multifile-ext.zip';
writeFileSync(ZIP, await zip.generateAsync({ type: 'nodebuffer' }));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 160)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'mf', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '多文件角色', description: '', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatmf', title: '多文件角色', cardId: 'mf', lorebookIds: [], useCardLorebook: true,
    messages: [{ id: 'm1', role: 'assistant', content: '你好。', createdAt: Date.now(), isGreeting: true }],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  s.setActiveChat('chatmf');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- parse keeps the module graph -------------------------------------
const parsed = await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  const res = await fetch('/test-multifile-ext.zip');
  const p = await mod.parseRpnx(await res.blob());
  const keys = Object.keys(p.assets ?? {});
  return { entry: p.manifest.stEntry, moduleKeys: keys.filter((k) => k.startsWith('__st__/modules/')) };
});
check('入口路径被记录', parsed.entry === 'index.js', String(parsed.entry));
check('模块树被解析出来', parsed.moduleKeys.length >= 3, JSON.stringify(parsed.moduleKeys));

// ---- activating it resolves the relative imports ----------------------
const activated = await page.evaluate(async () => {
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const mod = await import('/src/core/plugins/rpnx.ts');
  const res = await fetch('/test-multifile-ext.zip');
  const p = await mod.parseRpnx(await res.blob());
  const modules = {};
  for (const [k, v] of Object.entries(p.assets ?? {})) {
    const pre = '__st__/modules/';
    if (k.startsWith(pre)) modules[k.slice(pre.length)] = v;
  }
  try {
    const handle = await bridge.activateSTExtension('st.mf-test', {
      manifest: p.manifest,
      entryPath: p.manifest.stEntry ?? 'index.js',
      script: p.code,
      modules,
    });
    const out = { ...(window.__mf ?? {}) };
    handle.dispose();
    return { ok: true, out };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err).slice(0, 200) };
  }
});
check('多文件扩展激活成功', activated.ok === true, JSON.stringify(activated));
check('同级相对导入解析成功', typeof activated.out?.greet === 'string' && activated.out.greet.includes('deep-value'), JSON.stringify(activated.out));
check('嵌套目录导入解析成功', activated.out?.deep === 'deep-value', String(activated.out?.deep));
check('模块内可读到 ST 上下文', activated.out?.chatLen === 1 && activated.out?.char === '多文件角色', JSON.stringify(activated.out));

// ---- a genuinely missing sibling still reports clearly ----------------
const missing = await page.evaluate(async () => {
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  try {
    await bridge.activateSTExtension('st.missing-test', {
      manifest: { display_name: '缺文件' },
      entryPath: 'index.js',
      script: `import { x } from './scripts/nope.js';\nwindow.__no = x;`,
      modules: { 'index.js': '' },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err).slice(0, 200) };
  }
});
check('缺失模块报错且提示可读', missing.ok === false && /无法解析的模块|包外模块/.test(missing.error), String(missing.error));

try {
  unlinkSync(ZIP);
} catch {
  /* ignore */
}
await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
