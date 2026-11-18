/**
 * Fenced ```html blocks must become sandboxed iframes — including scripts.
 */
import { chromium } from 'playwright';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 140)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(800);

const rendered = await page.evaluate(async () => {
  const { defaultRenderer } = await import('/src/core/render/renderer.ts');
  const sample = [
    '前面一段正常文字。',
    '',
    '```html',
    '<div style="padding:12px;background:#223;color:#fff;font:14px sans-serif">',
    '  <h3 style="margin:0 0 8px">面板标题</h3>',
    '  <p id="out">等待脚本…</p>',
    '  <script>document.getElementById("out").textContent = "脚本已执行: " + (6*7);</script>',
    '</div>',
    '```',
    '',
    '后面一段文字。',
  ].join('\n');
  const html = defaultRenderer.render(sample, { sandboxHtml: true, styleScope: '.rp-md' });
  return {
    // `full` is what gets inserted into the DOM; `preview` is for logging only.
    fullHtml: html,
    html: html.slice(0, 400),
    hasIframe: /<iframe[^>]*sandbox=/.test(html) && /rp-html-card/.test(html),
    hasPlaceholder: /<rp-html-card/.test(html),
    hasRawFence: /```/.test(html),
    keepsProse: html.includes('前面一段正常文字') && html.includes('后面一段文字'),
  };
});
check('```html 代码块变成 iframe', rendered.hasIframe, rendered.html.slice(0, 120));
check('没有残留占位元素', !rendered.hasPlaceholder, String(rendered.hasPlaceholder));
check('没有残留反引号围栏', !rendered.hasRawFence, '');
check('前后正文保留', rendered.keepsProse, '');

// Actually verify the iframe: element present, src carries the original script.
// NOTE: the renderer wraps output in <p>…</p>; inserting that via innerHTML
// makes the browser auto-close the <p> around a block-level iframe, so the
// probe uses a plain container and queries structurally.
const frameInfo = await page.evaluate((html) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  // The class is namespace-prefixed by the renderer, so match structurally.
  const f = host.querySelector('iframe');
  if (!f) return { found: false, children: [...host.children].map((c) => c.tagName) };
  const src = f.getAttribute('src') ?? '';
  return {
    found: true,
    sandbox: f.getAttribute('sandbox') ?? '',
    hasDataUrl: src.startsWith('data:text/html'),
    decodedHasScript: decodeURIComponent(src).includes('脚本已执行'),
  };
}, rendered.fullHtml);

check('iframe 已挂载且为 data: 文档', frameInfo.found && frameInfo.hasDataUrl, JSON.stringify(frameInfo));
check('iframe 允许脚本执行（sandbox 含 allow-scripts）', /allow-scripts/.test(frameInfo.sandbox ?? ''), frameInfo.sandbox?.slice(0, 40));
check('iframe 文档内含原脚本', frameInfo.decodedHasScript === true, '');

// Unclosed fence (truncated model output) still renders.
const unclosed = await page.evaluate(async () => {
  const { defaultRenderer } = await import('/src/core/render/renderer.ts');
  const html = defaultRenderer.render('说话中\n\n```html\n<div>截断的卡片</div>', { sandboxHtml: true });
  return { hasIframe: /<iframe/.test(html), hasRaw: /```/.test(html) };
});
check('未闭合的 html 围栏也能渲染', unclosed.hasIframe && !unclosed.hasRaw, JSON.stringify(unclosed));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
