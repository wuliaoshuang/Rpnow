/**
 * Round 24 fixes: hub icons (lucide, no emoji), header title centred on the
 * content midline, focus morph (hide ＋, taller body, accent border), square
 * "更多" plate, and dropdown menus keep 12px off the screen edge.
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
await page.waitForTimeout(900);
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'r24', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '微调测', description: '', personality: '', scenario: '', first_mes: '开场。', mes_example: '' },
  });
  await s.saveChat({
    id: 'chatr24', title: '微调测', cardId: 'r24', lorebookIds: [], useCardLorebook: true,
    messages: [
      { id: 'g1', role: 'assistant', content: '开场。', createdAt: Date.now(), isGreeting: true },
      { id: 'u1', role: 'user', content: '用户问。', createdAt: Date.now() + 1 },
      { id: 'a1', role: 'assistant', content: '助手答。', createdAt: Date.now() + 2 },
    ],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  s.setActiveChat('chatr24');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- hub icons: lucide svg, no emoji ------------------------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '更多' }).last().click();
await page.waitForTimeout(1100);
const icons = await page.evaluate(() => {
  const row = [...document.querySelectorAll('main section button')].find((b) => b.innerText.includes('世界书'));
  if (!row) return null;
  const first = row.querySelector('span');
  return { hasSvg: Boolean(first?.querySelector('svg')), emoji: /[\u{1F300}-\u{1FAFF}]/u.test(first?.textContent ?? '') };
});
check('内容组图标为 SVG（无 emoji）', icons?.hasSvg && !icons.emoji, JSON.stringify(icons));

// ---- header title vertically centred ------------------------------------
const titlePos = await page.evaluate(() => {
  const h = document.querySelector('header');
  const hr = h.getBoundingClientRect();
  const t = h.querySelector('h1').getBoundingClientRect();
  const safe = 0; // headless has no inset
  const mid = safe + hr.height / 2; // content midline ≈ safe + 32
  return { titleMid: Math.round(t.top + t.height / 2), mid: Math.round(mid), headerH: Math.round(hr.height) };
});
check('标题居中于内容中线（±3px）', Math.abs(titlePos.titleMid - titlePos.mid) <= 3, JSON.stringify(titlePos));
check('顶栏高度 ≥ 64px', titlePos.headerH >= 64, String(titlePos.headerH));

// ---- focus morph --------------------------------------------------------
// chatr24 is already the active chat; just make sure we're on the chat page.
await page.evaluate(() => {
  window.history.replaceState({}, '', '#chat');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 20000 });
await page.waitForTimeout(900);

const ta = page.locator('textarea[aria-label="消息输入框"]');
const pill = page.locator('textarea[aria-label="消息输入框"] >> xpath=..');
const plus = page.locator('button[aria-label="打开操作面板"]').first();

const beforeFocus = await page.evaluate(() => {
  const el = document.querySelector('button[aria-label="打开操作面板"]');
  return { w: Math.round(el.getBoundingClientRect().width), opacity: getComputedStyle(el).opacity };
});
await ta.click();
await page.waitForTimeout(600);
const afterFocus = await page.evaluate(() => {
  const plus = document.querySelector('button[aria-label="打开操作面板"]');
  const pill = document.querySelector('button[aria-label="打开操作面板"]').parentElement;
  const ta = document.querySelector('textarea[aria-label="消息输入框"]');
  const cs = getComputedStyle(pill);
  return {
    plusW: Math.round(plus.getBoundingClientRect().width),
    plusOpacity: getComputedStyle(plus).opacity,
    radius: cs.borderTopLeftRadius,
    ring: (cs.getPropertyValue('--tw-ring-shadow') ?? '').trim() !== '' && (cs.getPropertyValue('--tw-ring-shadow') ?? '').trim() !== '0 0 #0000',
    taMinH: Math.round(parseFloat(getComputedStyle(ta).minHeight)),
  };
});
// Round 25: the focus morph was reverted by request — constant rectangle,
// ＋ stays, height constant, no focus ring.
check('聚焦后加号仍在', afterFocus.plusW >= 36 && Number(afterFocus.plusOpacity) > 0.9, JSON.stringify(afterFocus));
check('聚焦后无描边（ring 关闭）', !afterFocus.ring, JSON.stringify(afterFocus));
check('聚焦后高度不变（38px）', afterFocus.taMinH <= 40, `minH=${afterFocus.taMinH}`);
check('常态即圆角矩形（radius 16px）', afterFocus.radius === '16px', afterFocus.radius);
await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
await page.waitForTimeout(600);
const afterBlur = await page.evaluate(() => {
  const plus = document.querySelector('button[aria-label="打开操作面板"]');
  const ta = document.querySelector('textarea[aria-label="消息输入框"]');
  return { w: Math.round(plus.getBoundingClientRect().width), taMinH: Math.round(parseFloat(getComputedStyle(ta).minHeight)) };
});
check('失焦后恢复原状', afterBlur.w >= 36 && afterBlur.taMinH <= 40, JSON.stringify(afterBlur));

// ---- square plates + menu not glued to the edge -------------------------
const plates = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('div[data-role] button')].filter((b) =>
    /重新生成这条回复|继续剧情|更多操作/.test(b.getAttribute('aria-label') ?? ''),
  );
  return btns.map((b) => {
    const r = b.getBoundingClientRect();
    return { label: b.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height) };
  });
});
check('三块按钮都是正方形 32×32', plates.length === 3 && plates.every((p) => p.w === 32 && p.h === 32), JSON.stringify(plates));

await page.locator('button[aria-label="更多操作"]').last().click();
await page.waitForTimeout(600);
const menu = await page.evaluate(() => {
  const m = [...document.querySelectorAll('[role="menu"]')].at(-1);
  if (!m) return null;
  const r = m.getBoundingClientRect();
  return { right: Math.round(window.innerWidth - r.right) };
});
check('更多菜单距屏幕右缘 ≥ 8px', menu && menu.right >= 8, JSON.stringify(menu));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
