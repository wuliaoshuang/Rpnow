/**
 * Attach to the on-device WebView via CDP and find the stray border/margin that
 * appears once a ```html card is rendered.
 */
import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const ctx = browser.contexts()[0];
const page = ctx?.pages()?.[0];
if (!page) {
  console.log('no page');
  process.exit(1);
}
await page.waitForTimeout(1500);

const info = await page.evaluate(() => {
  const out = { url: location.href, vw: innerWidth, vh: innerHeight };

  // 1. 是否有横向/纵向溢出
  out.docOverflowX = document.documentElement.scrollWidth - document.documentElement.clientWidth;
  out.docOverflowY = document.documentElement.scrollHeight - document.documentElement.clientHeight;

  // 2. 找出所有带可见边框的元素（宽度 > 0 且 border-width > 0）
  const bordered = [];
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const bw = ['Top', 'Right', 'Bottom', 'Left'].map((s) => parseFloat(cs[`border${s}Width`]) || 0);
    if (Math.max(...bw) > 0 && cs.borderStyle !== 'none') {
      const r = el.getBoundingClientRect();
      if (r.width > 100 && r.height > 100) {
        bordered.push({
          tag: el.tagName,
          cls: String(el.className).slice(0, 70),
          border: `${bw.join('/')}`,
          color: cs.borderTopColor,
          style: cs.borderTopStyle,
          rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
        });
      }
    }
  }
  out.bordered = bordered.slice(0, 20);

  // 3. 找出 outerWidth < 视口宽度 的元素（说明被挤压了）
  const squeezed = [];
  for (const el of document.querySelectorAll('body > div, #root > div, main')) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.width < innerWidth - 2) {
      squeezed.push({
        tag: el.tagName,
        cls: String(el.className).slice(0, 60),
        w: Math.round(r.width),
        left: Math.round(r.left),
        margin: getComputedStyle(el).margin,
        padding: getComputedStyle(el).padding,
      });
    }
  }
  out.squeezed = squeezed.slice(0, 10);

  // 4. body / html 的边距
  out.bodyMargin = getComputedStyle(document.body).margin;
  out.bodyPadding = getComputedStyle(document.body).padding;
  out.htmlMargin = getComputedStyle(document.documentElement).margin;

  // 5. 是否有 iframe（HTML 卡片）
  const frame = document.querySelector('iframe');
  if (frame) {
    const r = frame.getBoundingClientRect();
    const card = frame.parentElement;
    const cr = card.getBoundingClientRect();
    out.iframe = {
      frameRect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      cardCls: String(card.className),
      cardRect: [Math.round(cr.left), Math.round(cr.top), Math.round(cr.width), Math.round(cr.height)],
      cardBorder: getComputedStyle(card).border,
      cardMargin: getComputedStyle(card).margin,
      frameBorder: getComputedStyle(frame).border,
    };
  }
  return out;
});

console.log(JSON.stringify(info, null, 1));
await browser.close();
