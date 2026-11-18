/** 真机：诊断酒馆助手事件链 + 手动触发渲染 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) process.exit(1);
await page.waitForTimeout(600);

const r = await page.evaluate(async () => {
  const out = {};
  // 酒馆助手全局在吗
  out.hasTHGlobal = Boolean(document.getElementById('tavern_helper'));
  out.helperChildren = document.getElementById('tavern_helper')?.childElementCount ?? -1;

  // 事件总线状态
  const et = window.event_types ?? {};
  out.hasCMR = et.CHARACTER_MESSAGE_RENDERED ?? null;
  out.busOn = typeof window.eventSource?.on;

  // 监听并触发内核事件，看酒馆助手是否响应
  const got = [];
  if (window.eventSource?.on) {
    window.eventSource.on(et.CHARACTER_MESSAGE_RENDERED, (...a) => got.push(['CMR', a[0]]));
  }
  const kernel = window.__rpnowStore?.getState?.().kernel;
  out.hasKernel = Boolean(kernel);
  kernel?.events.emit('chat:message-received', { chatId: 'x', message: {}, message_id: 0 });
  await new Promise((r) => setTimeout(r, 800));
  out.busReceived = JSON.stringify(got);

  // 扫描是否产生了 TH-render
  await new Promise((r) => setTimeout(r, 1200));
  out.THRender = document.querySelectorAll('.TH-render').length;
  out.iframes = document.querySelectorAll('#chat .mes iframe').length;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
