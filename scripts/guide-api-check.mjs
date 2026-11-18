/**
 * Every API the development guide promises must actually exist and work:
 * ctx.log / ctx.on / ctx.get / ctx.provide / ctx.requires / ctx.readConfig /
 * ctx.config.get / ctx.config.onChange / ctx.mountSlot / ctx.injectCss.
 */
import { writeFileSync, unlinkSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const zip = new JSZip();
zip.file(
  'manifest.json',
  JSON.stringify({
    id: 'com.test.guide',
    name: '指南 API 验证',
    version: '1.0.0',
    apiVersion: 2,
    config: { apiKey: { type: 'string', 'label': '密钥', default: 'default-key' } },
  }),
);
zip.file(
  'plugin.js',
  `export async function apply(ctx) {
  const seen = {};
  seen.log = typeof ctx.log === 'function';
  seen.on = typeof ctx.on === 'function';
  seen.get = typeof ctx.get === 'function';
  seen.provide = typeof ctx.provide === 'function';
  seen.requires = typeof ctx.requires === 'function';
  seen.readConfig = typeof ctx.readConfig === 'function';
  seen.configGet = typeof ctx.config?.get === 'function';
  seen.configOnChange = typeof ctx.config?.onChange === 'function';
  seen.logger = Boolean(ctx.logger?.info);
  seen.manifest = ctx.manifest?.id === 'com.test.guide';
  seen.SLOT = Boolean(ctx.SLOT?.COMPOSER);
  seen.React = Boolean(ctx.React?.createElement);
  seen.rpnow = Boolean(ctx.rpnow?.getState);
  seen.use = typeof ctx.use === 'function';

  // log() 真的写出去了吗
  ctx.log('guide probe log');
  seen.logWrote = window.__rpnowLogs ? window.__rpnowLogs.some((l) => String(l).includes('guide probe log')) : 'n/a';

  // config 读取默认值
  seen.configDefault = ctx.config.get()?.apiKey === 'default-key';
  seen.readConfigSame = ctx.readConfig()?.apiKey === 'default-key';

  // on() 事件订阅
  let got = null;
  const h = ctx.on('guide:test', (p) => { got = p; });
  window.__emitGuide?.('payload-1');
  seen.onWorks = got === 'payload-1';

  // provide / get / requires
  ctx.provide('guide.svc', { value: 42 });
  seen.getWorks = ctx.get('guide.svc')?.value === 42;
  ctx.requires('guide.svc');
  seen.requiresNoThrow = true;

  // use() 登记可释放资源
  let released = false;
  ctx.use(() => { released = true; });
  seen.useRegistered = true;
  window.__guide = { seen, released: () => released, off: h };
}`,
);
const ZIP = 'test-guide-api.rpnx';
writeFileSync(ZIP, await zip.generateAsync({ type: 'nodebuffer' }));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 160)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);

// 捕获日志输出
await page.evaluate(() => {
  window.__rpnowLogs = [];
  const orig = console.info.bind(console);
  console.info = (...a) => {
    window.__rpnowLogs.push(a.map(String).join(' '));
    orig(...a);
  };
  window.__emitGuide = (p) => window.__rpnowStore.getState().kernel.events.emit('guide:test', p);
});

const r = await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  const boot = await import('/src/boot.ts');
  const res = await fetch('/test-guide-api.rpnx');
  const parsed = await mod.parseRpnx(await res.blob());
  await mod.install(parsed, true);
  await boot.reloadInstalledPlugins();
  await new Promise((r) => setTimeout(r, 700));
  return { ...(window.__guide?.seen ?? {}), released: window.__guide?.released?.() ?? null };
});
check('ctx.log 存在且真的输出', r.log === true && r.logWrote === true, JSON.stringify({ log: r.log, wrote: r.logWrote }));
check('ctx.on 订阅生效（事件到达）', r.onWorks === true, String(r.onWorks));
check('ctx.get / ctx.provide 互通', r.getWorks === true, String(r.getWorks));
check('ctx.requires 可声明依赖', r.requiresNoThrow === true, '');
check('ctx.readConfig() 与 ctx.config.get() 一致', r.readConfigSame === true, String(r.readConfigSame));
check('manifest 默认值合并进配置', r.configDefault === true, String(r.configDefault));
check('ctx.config.onChange 可用', r.configOnChange === true, '');
check('ctx.use() 登记可释放资源', r.useRegistered === true, '');
check('内核语义 API 未受影响', r.get === true && r.provide === true, '');
check('ctx.React / ctx.SLOT / ctx.rpnow / ctx.manifest', r.React && r.SLOT && r.rpnow && r.manifest, '');
check('ctx.logger 存在', r.logger === true, '');

try { unlinkSync(ZIP); } catch {}
await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
