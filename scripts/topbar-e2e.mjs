/**
 * Verifies the two UI fixes:
 *   1. the connection panel button shares the top bar with the settings gear and
 *      is not overlaid on the status-bar area,
 *   2. installing a `.rpnx` plugin takes effect immediately — no reload.
 *
 * Uses a phone viewport so the safe-area / bottom-bar conditions are real.
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('nav[aria-label="底部导航"]', { timeout: 25000 });
await page.waitForTimeout(1200);

/* ------------------------------------------------------- 1. top bar layout */
const layout = await page.evaluate(() => {
  const header = document.querySelector('header');
  const gear = header?.querySelector('button[aria-label="设置"]');
  const conn = header?.querySelector('button[aria-label="打开连接面板"]');
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { top: Math.round(b.top), left: Math.round(b.left), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;padding-top:env(safe-area-inset-top,0px);visibility:hidden';
  document.body.appendChild(probe);
  const inset = parseFloat(getComputedStyle(probe).paddingTop) || 0;
  probe.remove();
  return { header: r(header), gear: r(gear), conn: r(conn), inset };
});

console.log('layout:', JSON.stringify(layout));

check('设置按钮在顶栏内', Boolean(layout.gear), JSON.stringify(layout.gear));
check('连接面板按钮在顶栏内', Boolean(layout.conn), JSON.stringify(layout.conn));
check(
  '两个按钮同一行（垂直中心接近）',
  Boolean(layout.gear && layout.conn) &&
    Math.abs(layout.gear.top - layout.conn.top) <= 2,
  layout.gear && layout.conn ? `gear.top=${layout.gear.top} conn.top=${layout.conn.top}` : '',
);
check(
  '按钮位于状态栏之下',
  Boolean(layout.gear) && layout.gear.top >= layout.inset,
  `gear.top=${layout.gear?.top}, inset=${layout.inset}`,
);

// The panel must open below the bar, not over it.
if (layout.conn) {
  await page.locator('button[aria-label="打开连接面板"]').click();
  await page.waitForTimeout(600);
  const panel = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="连接与货单"]');
    if (!dlg) return null;
    const b = dlg.getBoundingClientRect();
    const header = document.querySelector('header').getBoundingClientRect();
    return { top: Math.round(b.top), headerBottom: Math.round(header.bottom) };
  });
  console.log('panel:', JSON.stringify(panel));
  // The panel is anchored to the button's wrapper inside the bar, so it can sit
  // a couple of px under the bar's border box; what matters is that it never
  // opens over the bar's content or the status bar.
  check(
    '连接面板在顶栏下方展开',
    Boolean(panel) && panel.top >= panel.headerBottom - 4 && panel.top < panel.headerBottom + 40,
    JSON.stringify(panel),
  );
  await page.screenshot({ path: 'screenshots/39-topbar-phone.png' });
  await page.keyboard.press('Escape');
}

/* ---------------------------------------------- 2. install takes effect now */
// Seed a chat so the TTS speaker button has a message to act on.
await page.evaluate(async () => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  if (s.cards.length === 0) for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('nav[aria-label="底部导航"]', { timeout: 25000 });
await page.waitForTimeout(1200);

// Count installed plugins before.
const before = await page.evaluate(async () => {
  const { listInstalled } = await import('/src/core/plugins/rpnx.ts');
  return (await listInstalled()).length;
});

const b64 = readFileSync('release/rpnow.tts.mimo.rpnx').toString('base64');
const after = await page.evaluate(async (b64) => {
  const rpnx = await import('/src/core/plugins/rpnx.ts');
  const { reloadInstalledPlugins } = await import('/src/boot.ts');
  const store = { useApp: window.__rpnowStore };
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const parsed = await rpnx.parseRpnx(new Blob([bytes]));
  await rpnx.install(parsed, true);
  await reloadInstalledPlugins();
  const kernel = store.useApp.getState().kernel;
  return {
    installed: (await rpnx.listInstalled()).length,
    state: kernel.record('rpnow.tts.mimo')?.state,
    hasTts: Boolean(kernel.get('tts')),
  };
}, b64);

console.log('install:', JSON.stringify({ before, after }));
check('安装后插件已激活（无需刷新）', after.state === 'active' && after.hasTts === true, JSON.stringify(after));

// The speaker button must appear without a reload.
await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 10000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start1 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start1.count()) await __start1.first().click();
await page.waitForTimeout(1500);
const speakers = await page.locator('[aria-label="朗读这条消息"]').count();
check('消息上出现朗读按钮（无需刷新）', speakers > 0, `${speakers} 个`);

check('无 JS 报错', errors.filter((e) => !/ServiceWorker|sw\.js/.test(e)).length === 0, errors.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
