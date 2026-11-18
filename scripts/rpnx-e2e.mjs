/**
 * Proves the documented `.rpnx` workflow: a real ZIP is built, parsed, validated
 * and installed, then the installed package's `plugin.js` is executed in the
 * page and its effects verified.
 *
 * This exercises rpnx.ts (zip guard, manifest validation, module loading) rather
 * than only the kernel, so it catches packaging regressions the unit tests miss.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[aria-label="\u4e3b\u5bfc\u822a"]', { timeout: 20000 });
await page.waitForTimeout(900);

const out = await page.evaluate(async () => {
  const JSZip = (await import('/node_modules/.vite/deps/jszip.js').catch(() => import('jszip'))).default
    ?? (await import('jszip')).default;
  const rpnx = await import('/src/core/plugins/rpnx.ts');
  const store = { useApp: window.__rpnowStore };

  const manifest = {
    id: 'test.demo-plugin',
    name: 'Demo Plugin',
    version: '1.0.0',
    description: 'integration test',
    author: 'test',
    apiVersion: 1,
    host: 'host',
    provides: ['demoService'],
    uses: [],
  };
  const code = `
export function apply(ctx) {
  ctx.provide('demoService', { hello: () => 'from-plugin' });
  ctx.rpnow.lorebooks.save({
    id: 'lb_demo_plugin', name: 'Plugin Book',
    entries: [], scanDepth: null, tokenBudget: null, recursiveScanning: true,
    source: 'plugin', createdAt: Date.now(), updatedAt: Date.now(),
  });
}
  `;

  // Build the ZIP exactly as a plugin author would.
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest));
  zip.file('plugin.js', code);
  zip.file('README.md', '# demo');
  const blob = await zip.generateAsync({ type: 'blob' });

  // Parse (no code execution yet) and install.
  const parsed = await rpnx.parseRpnx(blob);
  const manifestOk = parsed.manifest.id === 'test.demo-plugin';
  await rpnx.install(parsed, true);
  const installedList = await rpnx.listInstalled();
  const storedOk = installedList.some((p) => p.manifest.id === 'test.demo-plugin');

  // Now load it through the real module path and register on the kernel.
  const { toModuleUrl } = rpnx;
  const { url, revoke } = toModuleUrl(parsed.code);
  let mod;
  try {
    mod = await import(/* @vite-ignore */ url);
  } catch (e) {
    return { error: 'import failed: ' + e.message, manifestOk, storedOk };
  }

  const k = store.useApp.getState().kernel;
  let applyCalled = false;
  k.register(parsed.manifest, async () => ({
    manifest: parsed.manifest,
    apply: async (ctx) => {
      applyCalled = true;
      return mod.apply(ctx);
    },
  }), 'installed');
  await k.sync();

  const svc = k.get('demoService');
  const bookSaved = store.useApp.getState().lorebooks.some((b) => b.id === 'lb_demo_plugin');

  // Reject a hostile archive (path traversal).
  let traversalRejected = false;
  try {
    const bad = new JSZip();
    bad.file('manifest.json', JSON.stringify(manifest));
    bad.file('plugin.js', 'export function apply(){}');
    bad.file('../evil.txt', 'x');
    await rpnx.parseRpnx(await bad.generateAsync({ type: 'blob' }));
  } catch {
    traversalRejected = true;
  }

  // Reject an invalid manifest.
  let invalidRejected = false;
  try {
    const bad = new JSZip();
    bad.file('manifest.json', JSON.stringify({ name: 'no id' }));
    bad.file('plugin.js', 'export function apply(){}');
    await rpnx.parseRpnx(await bad.generateAsync({ type: 'blob' }));
  } catch {
    invalidRejected = true;
  }

  revoke();
  await rpnx.uninstall('test.demo-plugin');
  await k.unregister('test.demo-plugin');

  return {
    manifestOk,
    storedOk,
    applyCalled,
    state: 'registered-after-uninstall',
    serviceValue: svc ? svc.hello() : null,
    bookSaved,
    traversalRejected,
    invalidRejected,
  };
});

console.log(JSON.stringify(out, null, 2));
const checks = [
  ['manifest parsed', out.manifestOk],
  ['stored in db', out.storedOk],
  ['apply ran', out.applyCalled],
  ['service provided', out.serviceValue === 'from-plugin'],
  ['plugin wrote a lorebook', out.bookSaved],
  ['zip-slip rejected', out.traversalRejected],
  ['invalid manifest rejected', out.invalidRejected],
  ['no page errors', errors.length === 0],
];
for (const [name, ok] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
const failed = checks.filter((c) => !c[1]).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
await browser.close();
process.exit(failed ? 1 : 0);
