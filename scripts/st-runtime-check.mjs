/**
 * End-to-end SillyTavern extension install: parse → register → activate, then
 * confirm the extension's script actually ran against the shim.
 */
import { chromium } from 'playwright';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));
const errs = [];
page.on('console', (m) => {
  if (m.type() === 'error') errs.push(m.text().slice(0, 200));
});

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'cx', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '测试角色', description: '用于 ST 扩展测试。', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatx', title: '测试角色', cardId: 'cx', lorebookIds: [], useCardLorebook: true,
    messages: [{ id: 'm1', role: 'assistant', content: '第一句。', createdAt: Date.now(), isGreeting: true }],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1000);

const result = await page.evaluate(async () => {
  const mod = await import('/src/core/plugins/rpnx.ts');
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const res = await fetch('/test-st-ext.zip');
  const parsed = await mod.parseRpnx(await res.blob());

  // Activate directly through the bridge (same call the loader makes).
  const handle = await bridge.activateSTExtension(parsed.manifest.id, {
    manifest: { display_name: '测试酒馆扩展', js: 'index.js' },
    entryPath: 'index.js',
    script: parsed.code,
    styles: parsed.assets['__st__/styles.css'],
  });

  const w = window;
  const out = {
    ran: Boolean(w.__stRan),
    hasContext: Boolean(w.__stHasContext),
    chatLen: w.__stChatLen,
    name2: w.__stName2,
    // Styles are now scope-isolated: they carry `rpnow-st-style`, and the
    // scope attribute is set on <html> so the plugin's selectors resolve.
    styleInjected:
      Boolean(document.querySelector('style[rpnow-st-style]')) &&
      document.documentElement.getAttribute('data-rp-scope') !== null,
    globalSet: typeof w.SillyTavern === 'object' && w.SillyTavern !== null,
    hasGetContext: typeof w.SillyTavern?.getContext === 'function',
    hasEventSource: typeof w.SillyTavern?.eventSource?.on === 'function',
    hasSaveSettings: typeof w.SillyTavern?.saveSettingsDebounced === 'function',
  };

  // Event bridge: emit a kernel event, expect the extension's listener to fire.
  const kernel = window.__rpnowStore.getState().kernel;
  try {
    kernel.events.emit('chat:message-sent', { text: 'hi' });
  } catch (e) {
    out.emitError = String(e).slice(0, 80);
  }
  out.eventFired = Boolean(w.__stEventFired);

  // Dispose should clean up style + global.
  handle.dispose();
  out.styleRemoved = !document.getElementById(`rpnow-st-${parsed.manifest.id}`);
  out.globalRestored = w.SillyTavern === undefined;
  return out;
});

check('扩展脚本已执行', result.ran, '');
check('SillyTavern 全局已注入', result.globalSet, '');
check('getContext 可用', result.hasGetContext, '');
check('eventSource 可用', result.hasEventSource, '');
check('saveSettingsDebounced 可用', result.hasSaveSettings, '');
check('getContext().chat 返回真实消息', result.chatLen === 1, `len=${result.chatLen}`);
check('getContext().name2 为角色名', result.name2 === '测试角色', result.name2);
check('扩展 CSS 已注入（作用域隔离）', result.styleInjected, '');
check('内核事件转发到 ST 事件', result.eventFired, result.emitError ?? '');
check('卸载后清理样式', result.styleRemoved, '');
check('卸载后还原全局', result.globalRestored, '');

const fatal = errs.filter((e) => !/favicon|ServiceWorker/i.test(e));
check('无致命控制台错误', fatal.length === 0, fatal.slice(0, 2).join(' | '));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
