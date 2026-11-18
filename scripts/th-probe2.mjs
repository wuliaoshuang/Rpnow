import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const shims = JSON.parse(readFileSync('th-shims.json', 'utf8'));
const js = readFileSync('th-index.js', 'utf8');
const hostModules = {};
for (const [key, info] of Object.entries(shims)) {
  // 归一化到 hostModules 期望的键（scripts/…、lib/…、script.js）。
  const m = key.match(/((?:scripts|lib)\/[^/].*|script\.js)$/);
  const norm = m ? m[1] : key;
  hostModules[norm] = info.source;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[err]', m.text().slice(0, 400));
});
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 400)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

const r = await page.evaluate(async ({ script, hostModules }) => {
  /*
   * 空 shim 构造器：任何绑定都拿到一个"什么都能用"的代理。
   * 目的只是确认加载链路，不代表最终实现。
   */
  const make = (name) => {
    const fn = function (...args) {
      return make(`${name}()`);
    };
    return new Proxy(fn, {
      get(_t, prop) {
        if (prop === Symbol.toPrimitive) return () => `[shim ${name}]`;
        if (prop === 'then') return undefined;
        if (prop === Symbol.iterator) return undefined;
        return make(`${name}.${String(prop)}`);
      },
      apply(_t, _this, args) {
        return make(`${name}()`);
      },
      construct() {
        return make(`new ${name}()`);
      },
    });
  };
  globalThis.__rpShimMake = make;

  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const out = { activated: false };
  try {
    const h = await bridge.activateSTExtension('st.th-probe', {
      manifest: { display_name: 'probe', js: 'dist/index.js' },
      entryPath: 'dist/index.js',
      script,
      hostModules,
    });
    out.activated = true;
    out.helperDiv = Boolean(document.getElementById('tavern_helper'));
    out.settingsNode = Boolean(document.getElementById('extensions_settings'));
    out.vueMounted = Boolean(document.querySelector('#extensions_settings *'));
    h.dispose();
  } catch (e) {
    out.error = String(e && e.message ? e.message : e).slice(0, 600);
    out.stack = String(e && e.stack ? e.stack : '').slice(0, 500);
  }
  return out;
}, { script: js, hostModules });

console.log(JSON.stringify(r, null, 1));
await browser.close();
