/**
 * 禁止视口缩放端到端测试（PR #57），390×844。
 *
 * 背景：viewport meta（PR #4）一直都在 index.html 里，但 iOS Safari 忽略
 * user-scalable=no，光靠 meta 拦不住缩放。本 PR 补了两道：
 *   (a) CSS touch-action: manipulation（禁双击缩放，保留滚动）；
 *   (b) gesturestart 拦截（禁 iOS 捏合缩放）。
 *
 * 覆盖：
 *   (a) 页面 viewport meta 含 maximum-scale=1.0 与 user-scalable=no；
 *   (b) html / body 的计算 touch-action 是 manipulation；
 *   (c) 合成的 gesturestart 事件被拦截（defaultPrevented）；
 *   (d) 双击后 visualViewport.scale 仍为 1；
 *   (e) 回归：聊天记录能滚动、按钮能点开、小手机能打开。
 *
 * 注意：Playwright（Chromium）无法真实模拟 iOS 的双指捏合，(d) 只能验
 * 双击场景；真机捏合需在她手机上部署后手动验证。
 */
import { launch, seed } from './e2e-helpers.mjs';

let failures = 0;
let passes = 0;
function check(name, cond, extra = '') {
  if (cond) {
    passes++;
    console.log(`  ok - ${name}`);
  } else {
    failures++;
    console.log(`  FAIL - ${name} ${extra}`);
  }
}

const { browser, page } = await launch();
try {
  await seed(page);
  // 关掉首次启动向导，否则它会挡住后面的点按（向导由 store 驱动，
  // 改设置后会自动消失，不用刷新）。
  await page.evaluate(() => {
    window.__rpnowStore.getState().setSettings({ onboardingCompleted: true });
  });
  await page.waitForTimeout(500);
  // 首页（聊天即主页）无对话时列出角色卡，点第一张卡开聊。
  await page.locator('button:has-text("阿尔德里克")').first().click();
  await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 20000 });
  await page.waitForTimeout(600);

  // ---- (a) viewport meta ----
  const meta = await page.evaluate(() => {
    const el = document.querySelector('meta[name="viewport"]');
    return el ? el.getAttribute('content') ?? '' : '';
  });
  check('viewport meta 存在', meta.length > 0);
  check('viewport meta 含 maximum-scale=1.0', meta.includes('maximum-scale=1.0'), meta);
  check('viewport meta 含 user-scalable=no', meta.includes('user-scalable=no'), meta);

  // ---- (b) 计算 touch-action ----
  const touchAction = await page.evaluate(() => {
    const cs = (el) => getComputedStyle(el).touchAction;
    return { html: cs(document.documentElement), body: cs(document.body) };
  });
  check('html 的 touch-action 是 manipulation', touchAction.html === 'manipulation', touchAction.html);
  check('body 的 touch-action 是 manipulation', touchAction.body === 'manipulation', touchAction.body);

  // ---- (c) gesturestart 拦截 ----
  const gesturePrevented = await page.evaluate(() => {
    const ev = new Event('gesturestart', { bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  check('gesturestart 事件被 preventDefault', gesturePrevented);

  // ---- (d) 双击后 visualViewport.scale 仍为 1 ----
  const scaleBefore = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  await page.touchscreen.tap(195, 400);
  await page.waitForTimeout(90);
  await page.touchscreen.tap(195, 400);
  await page.waitForTimeout(500);
  const scaleAfter = await page.evaluate(() => window.visualViewport?.scale ?? 1);
  check('双击后 visualViewport.scale 仍为 1', scaleAfter === 1, `双击前 ${scaleBefore}，双击后 ${scaleAfter}`);

  // ---- (e) 回归：滚动 / 点按 / 小手机 ----
  // 先往当前聊天里种 30 条长消息，让记录区出现滚动条。
  const chatId = await page.evaluate(() => {
    const s = window.__rpnowStore.getState();
    return s.activeChatId ?? '';
  });
  check('拿到当前聊天 id', Boolean(chatId));
  if (chatId) {
    await page.evaluate(async (id) => {
      const s = window.__rpnowStore.getState();
      const chat = s.chats.find((c) => c.id === id);
      const now = Date.now();
      const seeded = Array.from({ length: 30 }, (_, i) => ({
        id: `m-zoom-${i}`,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `滚动测试第 ${i + 1} 条：` + '这是一段很长的测试文字，用来把聊天记录撑出滚动条。'.repeat(6),
        createdAt: now + i,
      }));
      await s.saveChat({ ...chat, messages: [...(chat.messages ?? []), ...seeded] });
    }, chatId);
    await page.waitForTimeout(500);
    const scrolled = await page.evaluate(() => {
      const els = [...document.querySelectorAll('*')].filter(
        (el) => el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 100,
      );
      if (els.length === 0) return { found: false, moved: false };
      const el = els[0];
      const before = el.scrollTop;
      el.scrollTop = el.scrollHeight;
      return { found: true, moved: el.scrollTop > before };
    });
    check('找到可滚动的聊天记录区', scrolled.found);
    check('聊天记录能滚动到底', scrolled.moved);
  }

  // 点按：打开操作面板，再点小手机。
  await page.getByRole('button', { name: '打开操作面板' }).click();
  await page.waitForTimeout(400);
  check(
    '点按能打开操作面板',
    (await page.getByRole('dialog', { name: '操作面板' }).count()) >= 1,
  );
  await page.getByRole('button', { name: '小手机' }).click();
  await page.waitForTimeout(600);
  const phone = page.locator('.fixed.inset-0.z-\\[80\\]');
  check('小手机能打开', (await phone.count()) >= 1 && (await phone.first().isVisible()));
} finally {
  await browser.close();
}

console.log(`\nno-zoom e2e: ${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
