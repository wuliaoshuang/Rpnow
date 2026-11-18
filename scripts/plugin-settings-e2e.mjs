/**
 * Verifies the plugin settings UI: installing the MiMo plugin must surface an
 * editable API-key form in the Plugins page (otherwise a TTS plugin would be
 * unconfigurable from the app).
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
await page.evaluate(async (s) => {
  const rpnx = await import('/src/core/plugins/rpnx.ts');
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const parsed = await rpnx.parseRpnx(new Blob([bytes]));
  await rpnx.install(parsed, true);
}, b64);

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('nav[aria-label="主导航"]', { timeout: 25000 });
await page.waitForTimeout(1500);

// Plugins page → installed tab should list the plugin.
await page.getByRole('button', { name: '插件' }).first().click();
await page.waitForTimeout(900);
const listed = await page.locator('text=MiMo TTS').count();
check('插件出现在已安装列表', listed > 0, `${listed}`);

// Open its settings.
const settingsBtn = page.locator('[aria-label="插件设置"]').first();
check('存在插件设置按钮', (await settingsBtn.count()) > 0);
if ((await settingsBtn.count()) > 0) {
  await settingsBtn.click();
  await page.waitForTimeout(600);

  const hasKeyField = await page.locator('input#plugin-rpnow\\.tts\\.mimo-apiKey').count();
  check('渲染出 API Key 输入框', hasKeyField > 0);

  const hasVoiceSelect = await page.locator('button#plugin-rpnow\\.tts\\.mimo-voice').count();
  check('渲染出音色选择器', hasVoiceSelect > 0);

  // Fill and save, then verify it lands in settings.
  if (hasKeyField > 0) {
    await page.fill('input#plugin-rpnow\\.tts\\.mimo-apiKey', 'tp-ui-test-key');
    await page.getByRole('button', { name: /保存配置/ }).click();
    await page.waitForTimeout(800);
    const saved = await page.evaluate(async () => {
      const store = { useApp: window.__rpnowStore };
      return store.useApp.getState().settings.pluginConfig?.['rpnow.tts.mimo']?.apiKey;
    });
    check('配置可保存到设置', saved === 'tp-ui-test-key', String(saved));
  }

  await page.screenshot({ path: 'screenshots/28-plugin-settings.png' });
}

check('无 JS 报错', errors.filter((e) => !/ServiceWorker|sw\.js/.test(e)).length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
