/**
 * SillyTavern extension loading: ES-module extensions (酒馆助手 ≥ v4 use
 * `import`/`export`) AND classic IIFE ones must both load.
 *
 * Regression: the bridge used `new Function`, which rejects `import` with
 * "Cannot use import statement outside a module" — exactly the error the real
 * extension showed on device.
 */
import { chromium } from 'playwright';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 160)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'stm', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '模块测', description: '', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatstm', title: '模块测', cardId: 'stm', lorebookIds: [], useCardLorebook: true,
    messages: [{ id: 'm1', role: 'assistant', content: '你好。', createdAt: Date.now(), isGreeting: true }],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  s.setActiveChat('chatstm');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- 1. ES module extension (the real 酒馆助手 shape) -------------------
const esm = await page.evaluate(async () => {
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  // A genuine ES module: `export` plus a real internal import is not needed —
  // the point is that module syntax must not be rejected by `new Function`.
  const script = `
    export const meta = { name: 'helper' };
    const ctx = SillyTavern.getContext();
    window.__stEsm = {
      ran: true,
      chatLen: ctx.chat.length,
      charName: ctx.name2,
      hasEvents: typeof SillyTavern.eventSource?.on === 'function',
    };
    window.__stEsmMeta = typeof meta;
  `;
  try {
    const handle = await bridge.activateSTExtension('st.esm-test', {
      manifest: { display_name: 'ESM 测试' },
      entryPath: 'index.js',
      script,
    });
    const result = { ...(window.__stEsm ?? {}) };
    const metaType = window.__stEsmMeta;
    handle.dispose();
    return { ok: true, result, metaType };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err).slice(0, 160) };
  }
});
check('ES 模块扩展能加载（export 语法）', esm.ok === true, JSON.stringify(esm));
check('模块扩展脚本执行且读到上下文', esm.result?.ran === true && esm.result?.chatLen === 1, JSON.stringify(esm.result));
check('模块扩展能读角色名与事件系统', esm.result?.charName === '模块测' && esm.result?.hasEvents === true, JSON.stringify(esm.result));

// ---- 2. Classic IIFE extension still works -----------------------------
const classic = await page.evaluate(async () => {
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  try {
    const handle = await bridge.activateSTExtension('st.classic-test', {
      manifest: { display_name: '经典测试' },
      entryPath: 'index.js',
      script: `(function(){ window.__stClassic = { ran: true, st: typeof SillyTavern.getContext }; })();`,
    });
    const result = { ...(window.__stClassic ?? {}) };
    handle.dispose();
    return { ok: true, result };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err).slice(0, 160) };
  }
});
check('经典脚本型扩展仍能加载', classic.ok === true && classic.result?.ran === true, JSON.stringify(classic));

// ---- 3. Bare dependency gives an actionable message -------------------
const bareDep = await page.evaluate(async () => {
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  try {
    await bridge.activateSTExtension('st.bare-test', {
      manifest: { display_name: '依赖测试' },
      entryPath: 'index.js',
      script: `import lodash from 'lodash';\nwindow.__bare = !!lodash;`,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message ?? err).slice(0, 200) };
  }
});
check('外部依赖报错且提示清晰', bareDep.ok === false && /外部依赖|无法解析|包外模块/.test(bareDep.error), String(bareDep.error));

// ---- 4. Cleanup restores globals -------------------------------------
const cleanup = await page.evaluate(() => ({
  st: typeof window.SillyTavern,
}));
check('卸载后全局已还原', cleanup.st === 'undefined', String(cleanup.st));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
