/**
 * Keyboard helper row: the quote/bracket chips must sit on the right, and
 * pressing them must insert text WITHOUT moving focus off the textarea (which is
 * what would dismiss the on-screen keyboard).
 */
import { chromium } from 'playwright';

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
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'ck', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '键测试', description: '', personality: '', scenario: '', first_mes: '你好。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatk', title: '键测试', cardId: 'ck', lorebookIds: [], useCardLorebook: true,
    messages: [{ id: 'm1', role: 'assistant', content: '你好。', createdAt: Date.now(), isGreeting: true }],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1000);

// The helper row only renders while the keyboard is up. Simulate that by
// shrinking the visual viewport, which is exactly what ChatView measures.
await page.evaluate(() => {
  const box = page => page;
  Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => 480 });
  window.dispatchEvent(new Event('resize'));
  window.visualViewport.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(600);
const rowVisible = await page.locator('button[aria-label="插入引号"]').isVisible().catch(() => false);
check('键盘弹出时显示辅助行', rowVisible, '');
if (!rowVisible) {
  // Fall back: force the state via a resize of the real viewport value.
  await page.setViewportSize({ width: 390, height: 500 });
  await page.waitForTimeout(600);
}
const chipVisible = await page.locator('button[aria-label="插入引号"]').isVisible().catch(() => false);
check('引号按钮可见', chipVisible, '');

// ---- position: quote + bracket on the RIGHT -----------------------------
const pos = await page.evaluate(() => {
  const q = document.querySelector('button[aria-label="插入引号"]');
  const b = document.querySelector('button[aria-label="插入括号"]');
  const edit = document.querySelector('button[aria-label="打开长文本编辑"]');
  if (!q || !b) return null;
  const box = (el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, cy: r.top + r.height / 2 }; };
  return { q: box(q), b: box(b), edit: edit ? box(edit) : null, vw: window.innerWidth };
});
check('引号按钮在右侧', pos && pos.q.l > pos.vw / 2, pos ? `left=${Math.round(pos.q.l)} vw=${pos.vw}` : 'missing');
check('括号按钮在右侧', pos && pos.b.l > pos.vw / 2, pos ? `left=${Math.round(pos.b.l)}` : 'missing');
check('括号在引号右侧', pos && pos.b.l > pos.q.l, pos ? `${Math.round(pos.q.l)} < ${Math.round(pos.b.l)}` : '');
check('两按钮同一行（垂直对齐）', pos && Math.abs(pos.q.cy - pos.b.cy) < 2, pos ? `${Math.round(pos.q.cy)} vs ${Math.round(pos.b.cy)}` : '');
check('编辑按钮仍在左侧', pos && pos.edit && pos.edit.l < pos.vw / 2, pos?.edit ? `left=${Math.round(pos.edit.l)}` : '');

// ---- behavior: insert without stealing focus ---------------------------
const ta = page.locator('textarea[aria-label="消息输入框"]');
await ta.click();
await ta.fill('你好');
await page.waitForTimeout(200);

// Put the caret between 你 and 好 so we can prove it inserts at the caret.
await page.evaluate(() => {
  const el = document.querySelector('textarea[aria-label="消息输入框"]');
  el.focus();
  el.setSelectionRange(1, 1);
});
await page.waitForTimeout(150);

const focusedBefore = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));

// Press the quote chip with a real pointer sequence.
const quoteBtn = page.locator('button[aria-label="插入引号"]');
await quoteBtn.dispatchEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' });
await page.waitForTimeout(400);

const afterQuote = await page.evaluate(() => {
  const el = document.querySelector('textarea[aria-label="消息输入框"]');
  return {
    value: el?.value,
    focused: document.activeElement === el,
    activeLabel: document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName,
    caret: el?.selectionStart,
  };
});
check('引号插入到光标位置', afterQuote.value === '你“”好', JSON.stringify(afterQuote.value));
check('引号插入后焦点仍在输入框', afterQuote.focused, `${focusedBefore} → ${afterQuote.activeLabel}`);
check('光标停在引号中间', afterQuote.caret === 2, `caret=${afterQuote.caret}`);

// Same for brackets.
const bracketBtn = page.locator('button[aria-label="插入括号"]');
await bracketBtn.dispatchEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' });
await page.waitForTimeout(400);
const afterBracket = await page.evaluate(() => {
  const el = document.querySelector('textarea[aria-label="消息输入框"]');
  return { value: el?.value, focused: document.activeElement === el, caret: el?.selectionStart };
});
check('括号插入到光标位置', afterBracket.value === '你“()”好', JSON.stringify(afterBracket.value));
check('括号插入后焦点仍在输入框', afterBracket.focused, String(afterBracket.focused));
check('光标停在括号中间', afterBracket.caret === 3, `caret=${afterBracket.caret}`);

// The default action of pointerdown must be prevented (that is what keeps focus).
const prevented = await page.evaluate(() => {
  const el = document.querySelector('textarea[aria-label="消息输入框"]');
  el.focus();
  const btn = document.querySelector('button[aria-label="插入引号"]');
  const ev = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' });
  btn.dispatchEvent(ev);
  return ev.defaultPrevented;
});
check('pointerdown 被 preventDefault（保住键盘）', prevented, String(prevented));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
