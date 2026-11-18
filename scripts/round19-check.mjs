/**
 * Round 19: group chat title (&-joined), pure poster cards with scrim + ⋮ +
 * long-press menu, no scrollbar on the transcript, keyboard-visible last floor.
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
  const av = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  for (const [id, name] of [['g1', '阿离'], ['g2', '白露'], ['g3', '长风']]) {
    await s.addCard({
      id, avatar: av, spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
      data: { name, description: '', personality: '', scenario: '', first_mes: `${name}开场。`, mes_example: '' },
    });
  }
  await s.saveChat({
    id: 'gp', title: '阿离 & 白露', cardId: 'g1', groupCardIds: ['g1', 'g2'], groupSpeaker: 'g1',
    lorebookIds: [], useCardLorebook: true,
    messages: [
      { id: 'gm', role: 'assistant', content: '群聊开场。', createdAt: Date.now(), isGreeting: true, speaker: '白露' },
      // Enough floors to make the transcript actually scroll, so the scrollbar
      // probe has a real overflow container to inspect.
      ...Array.from({ length: 14 }, (_, i) => ({
        id: `f${i}`,
        role: i % 2 ? 'user' : 'assistant',
        content: `第 ${i + 1} 层。`.repeat(20),
        createdAt: Date.now() + i,
        speaker: i % 2 ? undefined : '阿离',
      })),
    ],
    variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  s.setActiveChat('gp');
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1100);

// ---- 1. group title in the chat header ----------------------------------
const title = await page.evaluate(() => document.querySelector('header p')?.textContent?.trim());
check('聊天顶栏标题为 A & B', title === '阿离 & 白露', String(title));

// ---- 2. no scrollbar on the transcript ----------------------------------
const sb = await page.evaluate(() => {
  const el = [...document.querySelectorAll('main div')].find((d) => {
    const cs = getComputedStyle(d);
    return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && d.scrollHeight > d.clientHeight;
  });
  if (!el) return null;
  return { width: getComputedStyle(el).scrollbarWidth, webkit: el.className.includes('rp-no-scrollbar') };
});
check('聊天区不显示滚动条', sb && (sb.webkit || sb.width === 'none'), JSON.stringify(sb));

// ---- 3. keyboard: last floor's action buttons stay visible --------------
// Seed a few floors so there is an action row to check.
await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === 'gp');
  const extra = [1, 2, 3].map((i) => ({
    id: `x${i}`, role: i % 2 ? 'user' : 'assistant',
    content: `第 ${i} 条。`, createdAt: Date.now() + i,
  }));
  void s.saveChat({ ...chat, messages: [...chat.messages, ...extra] });
});
await page.waitForTimeout(1000);

await page.evaluate(() => {
  const real = window.visualViewport.height;
  Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => real - 340 });
  window.visualViewport.dispatchEvent(new Event('resize'));
});
await page.waitForTimeout(900);

const pinned = await page.evaluate(() => {
  const el = [...document.querySelectorAll('main div')].find((d) => {
    const cs = getComputedStyle(d);
    return (cs.overflowY === 'auto' || cs.overflowY === 'scroll') && d.scrollHeight > d.clientHeight;
  });
  if (!el) return null;
  const regen = [...el.querySelectorAll('button[aria-label="重新生成这条回复"]')].at(-1);
  if (!regen) return { found: false };
  const r = regen.getBoundingClientRect();
  const shell = document.querySelector('header')?.parentElement.getBoundingClientRect();
  return {
    found: true,
    btnTop: Math.round(r.top),
    btnBottom: Math.round(r.bottom),
    shellBottom: Math.round(shell.bottom),
    visible: r.bottom <= shell.bottom + 2 && r.top >= -2,
  };
});
check('键盘顶起时最后一条消息的操作按钮可见', pinned && pinned.found && pinned.visible, JSON.stringify(pinned));

// ---- 4. pure poster cards ----------------------------------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1200);

const card = await page.evaluate(() => {
  const art = document.querySelector('main article');
  if (!art) return null;
  const scrims = art.querySelectorAll('div[aria-hidden="true"]');
  const grad = [...scrims].some((d) => String(d.className).includes('from-black/75'));
  const nameEl = [...art.querySelectorAll('span')].find(
    (s) => ['阿离', '白露', '长风'].includes(s.textContent ?? '') && String(s.className).includes('font-semibold'),
  );
  const menu = art.querySelector('button[aria-label$="操作菜单"]');
  // Purity: no text buttons like 简介 / 导出 on the card face.
  const hasInlineButtons = [...art.querySelectorAll('button')].some((b) =>
    /简介|导出|开始新对话/.test(b.textContent || ''),
  );
  return { grad, hasName: Boolean(nameEl), hasMenu: Boolean(menu), hasInlineButtons, rounded: getComputedStyle(art).borderRadius };
});
check('卡片有底部渐变遮罩', card?.grad, '');
check('名字显示在遮罩上', card?.hasName, JSON.stringify(card));
check('卡片右上角有 ⋮ 菜单', card?.hasMenu, '');
check('卡片是纯净的（没有内联操作按钮）', card && !card.hasInlineButtons, String(card?.hasInlineButtons));
check('卡片为大圆角', card && parseFloat(card.rounded) >= 14, card?.rounded);

// Long-press (contextmenu) opens the action menu.
await page.locator('main article').first().dispatchEvent('contextmenu', { bubbles: true, cancelable: true });
await page.waitForTimeout(600);
const menuOpen = await page.evaluate(() =>
  [...document.querySelectorAll('[role="menu"]')].some((m) => m.innerText.includes('置顶')),
);
check('长按（contextmenu）弹出操作菜单', menuOpen, '');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// ---- 5. list view still works ------------------------------------------
await page.locator('button[aria-label="切换为列表视图"]').click();
await page.waitForTimeout(500);
check('列表视图仍可用', (await page.locator('main ul li').count()) > 0, '');
await page.locator('button[aria-label="切换为网格视图"]').click();
await page.waitForTimeout(500);

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
