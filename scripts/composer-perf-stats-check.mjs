/**
 * Round 17 fixes:
 *   1. fades + background unaffected by the keyboard
 *   2. helper-row distance to the keyboard is modest (not huge)
 *   3. composer text/caret legible in immersive mode
 *   4. composer pill centred horizontally
 *   5. side-panel animation animates transform only (no layout/paint props)
 *   6. 统计 opens a per-character token sheet
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8851;
const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '统计回复。' }, usage: { prompt_tokens: 120, completion_tokens: 80 } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(404).end();
  });
});
await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` -- ${d}` : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('dialog', (d) => void d.accept());
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 200)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.evaluate(async (port) => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'cc', avatar: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '统计角色', description: '测试。', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatc', title: '统计角色', cardId: 'cc', lorebookIds: [], useCardLorebook: true,
    messages: [
      { id: 'm1', role: 'assistant', content: '第一句。', createdAt: Date.now(), isGreeting: true },
      { id: 'm2', role: 'assistant', content: '第二句。', createdAt: Date.now(), usage: { inputTokens: 1234, outputTokens: 567 } },
    ],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  await s.saveLLMConnection({
    id: 'conn_s', name: 'Mock', provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'k', defaultModel: 'mock',
  });
  s.setSettings({ defaultConnectionId: 'conn_s' });
  s.setActiveChat('chatc');
}, PORT);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- 3. composer text/caret legible -------------------------------------
const composer = await page.evaluate(() => {
  const ta = document.querySelector('textarea[aria-label="消息输入框"]');
  const cs = getComputedStyle(ta);
  return { color: cs.color, caret: cs.caretColor, fontSize: cs.fontSize };
});
// Immersive default is on → white text on the dark plate.
const isLight = (c) => {
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return false;
  return Number(m[1]) + Number(m[2]) + Number(m[3]) > 500;
};
check('输入文字为浅色（深底上可读）', isLight(composer.color), composer.color);
check('光标颜色可见', composer.caret !== 'rgb(0, 0, 0)' && composer.caret !== 'auto', composer.caret);

// ---- 4. composer pill centred -------------------------------------------
const centred = await page.evaluate(() => {
  const pill = document.querySelector('textarea[aria-label="消息输入框"]')?.closest('div.rounded-2xl');
  if (!pill) return null;
  const r = pill.getBoundingClientRect();
  const centre = (r.left + r.right) / 2;
  return { centre: Math.round(centre), vw: window.innerWidth, left: Math.round(r.left), right: Math.round(r.right) };
});
check(
  '输入胶囊水平居中',
  centred && Math.abs(centred.centre - centred.vw / 2) <= 2,
  centred ? `centre=${centred.centre} vw/2=${centred.vw / 2}` : 'missing',
);
check('左右留白相等', centred && Math.abs(centred.left - (centred.vw - centred.right)) <= 2, centred ? `L=${centred.left} R=${centred.vw - centred.right}` : '');

// ---- 1 & 2. keyboard: fades stable, helper row close --------------------
const before = await page.evaluate(() => {
  const fades = [...document.querySelectorAll('main [aria-hidden="true"]')].filter((d) =>
    String(d.className).includes('h-28'),
  );
  const bg = document.querySelector('main img[aria-hidden="true"]');
  return {
    fadeCount: fades.length,
    fadeH: fades.map((f) => Math.round(f.getBoundingClientRect().height)),
    fadeBottoms: fades.map((f) => Math.round(f.getBoundingClientRect().bottom)),
    bgH: bg ? Math.round(bg.getBoundingClientRect().height) : 0,
  };
});
check('存在上下两条渐变遮罩', before.fadeCount === 2, JSON.stringify(before.fadeH));

await page.evaluate(() => {
  const real = window.visualViewport.height;
  Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => real - 340 });
  window.visualViewport.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(800);

const after = await page.evaluate(() => {
  const fades = [...document.querySelectorAll('main [aria-hidden="true"]')].filter((d) =>
    String(d.className).includes('h-28'),
  );
  const bg = document.querySelector('main img[aria-hidden="true"]');
  const row = document.querySelector('button[aria-label="插入引号"]')?.closest('div')?.parentElement;
  const rr = row?.getBoundingClientRect();
  return {
    fadeH: fades.map((f) => Math.round(f.getBoundingClientRect().height)),
    fadeBottoms: fades.map((f) => Math.round(f.getBoundingClientRect().bottom)),
    bgH: bg ? Math.round(bg.getBoundingClientRect().height) : 0,
    rowBottom: rr ? Math.round(rr.bottom) : -1,
    visualH: Math.round(window.visualViewport.height),
  };
});
check('键盘弹出后遮罩高度不变', JSON.stringify(after.fadeH) === JSON.stringify(before.fadeH), `${before.fadeH} → ${after.fadeH}`);
check('键盘弹出后底部遮罩仍贴屏幕底', after.fadeBottoms.some((b) => Math.abs(b - 844) <= 2), JSON.stringify(after.fadeBottoms));
check('键盘弹出后背景仍满屏', after.bgH >= 842, String(after.bgH));

const gap = after.visualH - after.rowBottom;
check('按钮距键盘间距适中（12–32px）', gap >= 12 && gap <= 32, `gap=${gap}px`);

// ---- 5. panel animation animates transform only ------------------------
await page.evaluate(() => {
  Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight });
  window.visualViewport.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(500);
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
const anim = await page.evaluate(() => {
  const pushed = [...document.querySelectorAll('div[style*="translate3d"]')].find((d) => d.querySelector('[data-route]'));
  if (!pushed) return null;
  const cs = getComputedStyle(pushed);
  return { props: cs.transitionProperty, dur: cs.transitionDuration, willChange: cs.willChange };
});
check('动画只过渡 transform', anim && /^transform$/.test(anim.props.trim()), anim?.props);
check('transform 已提升为合成层', anim && anim.willChange === 'transform', anim?.willChange);
check('动画时长 480ms', anim && /0\.48s/.test(anim.dur), anim?.dur);
await page.keyboard.press('Escape');
await page.waitForTimeout(700);

// ---- 6. 统计 sheet ------------------------------------------------------
await page.locator('button[aria-label="打开对话设置"]').first().click();
await page.waitForTimeout(700);
const hasStats = await page.locator('[role="dialog"][aria-label="对话设置"] button', { hasText: '统计' }).count();
check('右栏有「统计」按钮', hasStats > 0, '');
await page.locator('[role="dialog"][aria-label="对话设置"] button', { hasText: '统计' }).first().click();
await page.waitForTimeout(800);
const sheet = await page.locator('[role="dialog"][aria-label="角色 token 统计"]').isVisible().catch(() => false);
check('统计弹窗打开', sheet, '');
if (sheet) {
  const text = await page.locator('[role="dialog"][aria-label="角色 token 统计"]').innerText();
  check('显示角色名', text.includes('统计角色'), '');
  check('显示输入 token（1.2K）', /1\.2K/.test(text), text.replace(/\s+/g, ' ').slice(0, 80));
  check('显示输出 token（567）', /567/.test(text), '');
  check('显示按会话明细', text.includes('按会话'), '');
  await page.locator('[role="dialog"][aria-label="角色 token 统计"] button[aria-label="关闭"]').first().click();
  await page.waitForTimeout(600);
  check('统计弹窗可关闭', !(await page.locator('[role="dialog"][aria-label="角色 token 统计"]').isVisible().catch(() => false)), '');
}

await browser.close();
mock.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
