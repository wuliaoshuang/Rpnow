/** 诊断：酒馆助手的渲染 store 状态 + 事件是否到达 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const zip = await JSZip.loadAsync(readFileSync('tavern-helper-real.zip'));
const js = await zip.file('JS-Slash-Runner-main/dist/index.js').async('text');
const css = await zip.file('JS-Slash-Runner-main/dist/index.css').async('text');
const manifest = JSON.parse(await zip.file('JS-Slash-Runner-main/manifest.json').async('text'));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1400);

await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  if (!s.cards.length) {
    await s.addCard({ spec: 'v2', specVersion: '2.0', data: { name: '渲染测', description: '', personality: '', scenario: '', first_mes: '你好', mes_example: '' } });
  }
  const card = window.__rpnowStore.getState().cards[0];
  if (!window.__rpnowStore.getState().chats.length) {
    await s.saveChat({ id: 'chat-r', title: '渲染测', cardId: card.id, lorebookIds: [], useCardLorebook: true, messages: [{ id: 'm0', role: 'assistant', content: '你好', createdAt: Date.now(), isGreeting: true }], variables: {}, createdAt: Date.now(), updatedAt: Date.now() });
    s.setActiveChat('chat-r');
  }
});
await page.waitForTimeout(1200);

const r = await page.evaluate(async ({ script, css, manifest }) => {
  const out = {};
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  const h = await bridge.activateSTExtension('st.th-diag', {
    manifest,
    entryPath: manifest.js,
    script,
    styles: css,
  });
  await new Promise((r) => setTimeout(r, 2200));

  // 检查酒馆助手期待的宿主环境
  out.chatGlobalLen = (() => { try { return window.chat?.length ?? 'undef'; } catch { return 'throw'; } })();
  out.chatIsLive = (() => {
    try { return Array.isArray(window.chat); } catch { return false; }
  })();
  out.eventTypesRendered = Boolean(window.event_types?.CHARACTER_MESSAGE_RENDERED);
  out.eventSourceOn = typeof window.eventSource?.on;
  out.chatEl = Boolean(document.getElementById('chat'));
  out.mesCount = document.querySelectorAll('#chat > .mes').length;
  out.mesid0 = document.querySelector('#chat > .mes')?.getAttribute('mesid') ?? null;
  out.welcomePanel = document.querySelectorAll('#chat > .welcomePanel').length;
  out.settingsEnabled = (() => {
    try {
      // 全局设置 store 里的 render.enabled（它从 localStorage 读）
      return window.localStorage.getItem('TavernHelper_global_settings')?.slice(0, 120) ?? null;
    } catch { return 'err'; }
  })();

  // 监听酒馆事件（激活后装，确保拿到共享 bus）
  window.__stEvents = [];
  const et = window.event_types ?? {};
  const es = window.eventSource;
  if (es?.on && et?.CHARACTER_MESSAGE_RENDERED) {
    es.on(et.CHARACTER_MESSAGE_RENDERED, (...a) => window.__stEvents.push(['CMR', ...a]));
    es.on(et.USER_MESSAGE_RENDERED, (...a) => window.__stEvents.push(['UMR', ...a]));
  }

  // 触发
  window.__rpnowStore.getState().kernel?.events.emit('chat:message-received', { chatId: 'x', message: {}, message_id: 0 });
  await new Promise((r) => setTimeout(r, 1200));
  out.stEventsFired = window.__stEvents?.length ?? 'no-listener';
  out.THRender = document.querySelectorAll('.TH-render').length;
  h.dispose();
  return out;
}, { script: js, css, manifest });

console.log(JSON.stringify(r, null, 1));
await browser.close();
