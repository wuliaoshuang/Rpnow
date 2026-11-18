/** 真机：进入聊天页，抓楼层 DOM 与酒馆助手渲染结果 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) process.exit(1);
await page.waitForTimeout(800);

const r = await page.evaluate(() => {
  const out = {};
  // 当前在哪
  out.url = location.hash.slice(0, 40);
  const main = document.querySelector('main');
  out.mainHead = (main?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 200);

  // 楼层 DOM（我们的映射）
  const chat = document.getElementById('chat');
  out.chatEl = Boolean(chat);
  out.mesCount = chat ? chat.querySelectorAll(':scope > .mes').length : -1;
  out.mesids = [...(chat?.querySelectorAll('.mes') ?? [])].slice(0, 4).map((m) => m.getAttribute('mesid'));

  // 楼层里的代码块
  out.preCode = chat ? chat.querySelectorAll('.mes pre code').length : -1;
  out.preSample = chat?.querySelector('.mes pre code')?.textContent?.slice(0, 150) ?? null;

  // 酒馆助手渲染痕迹
  out.THRender = chat ? chat.querySelectorAll('.TH-render').length : -1;
  out.THIframe = chat ? chat.querySelectorAll('.mes iframe').length : -1;

  // 楼层 HTML 原文（第一条 assistant）
  const mesText = chat?.querySelector('.mes')?.querySelector('.rp-md, [class*=rp-md]');
  out.bubbleHtmlHead = mesText ? mesText.innerHTML.replace(/\s+/g, ' ').slice(0, 300) : null;
  return out;
});
console.log(JSON.stringify(r, null, 1));
await browser.close();
