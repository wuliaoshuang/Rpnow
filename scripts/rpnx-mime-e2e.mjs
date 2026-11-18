/**
 * Verifies that a `.rpnx` package installs regardless of the MIME type the
 * platform reports for it.
 *
 * Android maps the unknown `.rpnx` extension to `application/octet-stream`, so
 * this reproduces exactly what the device hands the page: a File whose `type` is
 * octet-stream. It also checks renamed variants, because users commonly download
 * the package with a generic name.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('nav[aria-label="主导航"]', { timeout: 25000 });
await page.waitForTimeout(800);

const b64 = readFileSync('release/rpnow.tts.mimo.rpnx').toString('base64');

// Cases a real phone produces.
const cases = [
  { name: 'rpnow.tts.mimo.rpnx', type: 'application/octet-stream', label: '安卓上报的 octet-stream' },
  { name: 'rpnow.tts.mimo.rpnx', type: '', label: '类型为空' },
  { name: 'rpnow.tts.mimo.zip', type: 'application/zip', label: '改名为 .zip' },
  { name: 'mimo-tts.rpnx', type: 'application/x-zip-compressed', label: '改名 + zip MIME' },
];

for (const c of cases) {
  const r = await page.evaluate(
    async ({ b64, name, type }) => {
      const rpnx = await import('/src/core/plugins/rpnx.ts');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const file = new File([bytes], name, { type });
      try {
        const parsed = await rpnx.parseRpnx(file);
        return { ok: true, id: parsed.manifest.id, name: parsed.manifest.name };
      } catch (e) {
        return { ok: false, error: String(e.message) };
      }
    },
    { b64, name: c.name, type: c.type },
  );
  check(`可解析：${c.label} (${c.name}, ${c.type || 'no type'})`, r.ok, r.ok ? r.id : r.error);
}

// The accept attribute must not filter out octet-stream files on Android.
// The install input lives on the Plugins page, so navigate there first.
await page.getByRole('button', { name: '插件' }).first().click();
await page.waitForTimeout(900);
const accept = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input[type=file]')];
  return inputs.map((i) => i.accept).filter(Boolean);
});
console.log('accept attributes:', JSON.stringify(accept));
const hasOctet = accept.some((a) => a.includes('application/octet-stream'));
check('安装输入框接受 application/octet-stream', hasOctet, accept[0] ?? '(none)');

check('无 JS 报错', errors.filter((e) => !/ServiceWorker|sw\.js/.test(e)).length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
