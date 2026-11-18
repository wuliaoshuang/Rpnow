/**
 * End-to-end proof of the plugin promise.
 *
 * Installs a real `.rpnx`-shaped plugin into the running app and checks that:
 *   1. it registers on the kernel and activates,
 *   2. it can read app data (cards) through the data API,
 *   3. providing `theme` replaces the active theme,
 *   4. disposing the service restores the previous theme.
 *
 * This runs the same code path `install()` + `import()` take for a user plugin,
 * minus the ZIP container, so a failure here is a real regression.
 */
import { chromium } from 'playwright';

const BASE = 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[aria-label="主导航"]', { timeout: 20000 });
await page.waitForTimeout(800);

// A fresh profile has no cards; seed the sample cast so the data API has
// something observable to return.
await page.evaluate(async () => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  if (s.cards.length === 0) {
    for (const card of data.SAMPLE_CARDS) await s.addCard(structuredClone(card));
  }
});
await page.waitForTimeout(300);

const result = await page.evaluate(async () => {
  const store = { useApp: window.__rpnowStore };
  const { ServiceRegistry } = await import('/src/core/plugin/registry.ts');
  const k = store.useApp.getState().kernel;
  if (!k) return { error: 'no kernel' };

  const before = k.get('theme');
  const themeBefore = before ? before.id : null;

  // Remove any leftover test plugin so re-runs are idempotent.
  await k.unregister('test.hotswap').catch(() => {});

  let sawCards = -1;
  let cleanupRan = false;
  k.register(
    {
      id: 'test.hotswap',
      name: 'hotswap test',
      version: '1.0.0',
      apiVersion: 1,
      host: 'host',
      provides: ['theme'],
    },
    async () => ({
      manifest: {
        id: 'test.hotswap',
        name: 'hotswap test',
        version: '1.0.0',
        apiVersion: 1,
        host: 'host',
        provides: ['theme'],
      },
      apply: (ctx) => {
        sawCards = ctx.rpnow.cards.list().length;
        ctx.provide('theme', {
          id: 'test-theme',
          tokens: () => ({ '--rp-bg': 'rgb(1, 2, 3)' }),
          css: () => '',
          activate: () => {},
          list: () => [],
        });
        return () => {
          cleanupRan = true;
        };
      },
    }),
  );

  await k.sync();
  const rec = k.record('test.hotswap');
  const state = rec?.state;
  const err = rec?.error;
  const after = k.get('theme');
  const themeAfter = after ? after.id : null;

  // Dispose the plugin and confirm the original theme is restored.
  await k.unregister('test.hotswap');
  const restored = k.get('theme');
  const themeRestored = restored ? restored.id : null;

  return {
    state,
    err,
    sawCards,
    themeBefore,
    themeAfter,
    themeRestored,
    cleanupRan,
    hasRegistry: typeof ServiceRegistry === 'function',
  };
});

console.log(JSON.stringify(result, null, 2));
const ok =
  result.state === 'active' &&
  result.sawCards >= 3 &&
  result.themeAfter === 'test-theme' &&
  result.themeRestored === result.themeBefore &&
  result.cleanupRan === true;
console.log(ok ? 'PASS plugin hot-swap end to end' : 'FAIL plugin hot-swap');
await browser.close();
process.exit(ok ? 0 : 1);
