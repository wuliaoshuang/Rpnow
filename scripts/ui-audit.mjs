/**
 * Mobile-first UI audit, layered.
 *
 * Layer 1: every route loads clean — no console errors, no horizontal overflow,
 *          no invisible/zero-sized/off-screen controls.
 * Layer 2: targeted clicks through the controls that matter on each route,
 *          checking for errors, stuck dialogs and layout breakage after each.
 *
 * The harness deliberately reloads between routes: an SPA keeps its view state,
 * so walking without a reload makes later routes inherit earlier clicks.
 */

import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:5173/';
const findings = [];
const note = (route, kind, detail) => {
  findings.push({ route, kind, detail });
  console.log(`  ⚠ [${kind}] ${detail}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/ServiceWorker|sw\.js|favicon|React DevTools|ERR_CONNECTION_REFUSED|ERR_UNSAFE_PORT|ERR_FAILED/.test(t)) return;
  consoleErrors.push(t);
});
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('dialog', (d) => void d.accept());

const NAV = [
  { route: 'cards', label: '角色卡' },
  { route: 'lore', label: '世界书' },
  { route: 'presets', label: '预设' },
  { route: 'novel', label: '小说' },
  { route: 'plugins', label: '插件' },
  { route: 'settings', label: '设置' },
];

/** Reload and switch to a route through the left panel (Tavo navigation). */
async function openRoute(label) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-route]', { timeout: 25000 });
  await page.waitForTimeout(600);
  await page.locator('button[aria-label="打开聊天列表"]').first().click({ timeout: 8000 });
  await page.waitForTimeout(600);
  const ROUND = { 角色卡: '角色', 设置: 'API连接' };
  const round = ROUND[label];
  if (round) {
    await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: round }).first().click({ timeout: 8000 });
  } else {
    // 更多 lands on the settings hub; content pages (世界书/预设/小说/插件)
    // are reached through its rows. '设置' itself is already the hub.
    await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '更多' }).first().click({ timeout: 8000 });
    await page.waitForTimeout(900);
    if (label !== '设置') {
      const row = page.locator('main section button', { hasText: label }).first();
      if (await row.count()) {
        await row.click({ timeout: 8000 });
      }
    }
  }
  await page.waitForTimeout(800);
  return 'ok';
}

/** Layer 1 checks for the current route. */
async function inspectRoute(route, label) {
  console.log(`\n=== ${route} ===`);
  consoleErrors.length = 0;

  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const inNav = (el) => Boolean(el.closest('nav'));
    const dead = [];
    const clickables = [...document.querySelectorAll('button, a, input, select, textarea, [role="tab"], [role="menuitem"], summary')]
      .filter((el) => !inNav(el));
    for (const el of clickables) {
      // Off-screen side panels stay mounted (they slide), so skip anything the
      // user cannot currently reach: inside an inert subtree or not hit-testable.
      if (el.closest('[inert]') || el.closest('[aria-hidden="true"]')) continue;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      const name = (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 40);
      if (style.display === 'none' || style.visibility === 'hidden' || style.pointerEvents === 'none') continue;
      if (!rect.width || !rect.height) {
        dead.push(`zero-size: ${el.tagName} "${name}"`);
        continue;
      }
      // Transformed-off panels report a rect outside the viewport; that is the
      // intended closed state, not a defect.
      if (rect.right <= 0 || rect.left >= doc.clientWidth) continue;
      if (rect.right > doc.clientWidth + 1 || rect.left < -1) {
        dead.push(`offscreen: ${el.tagName} "${name}" (${Math.round(rect.left)}..${Math.round(rect.right)})`);
      }
      // Icon-only controls must still expose a name.
      const labelled =
        el.getAttribute('aria-label') ||
        el.getAttribute('aria-labelledby') ||
        el.getAttribute('title') ||
        (el.textContent || '').trim();
      if (!labelled && (el.tagName === 'BUTTON' || el.tagName === 'A')) {
        dead.push(`无可访问名: <${el.tagName.toLowerCase()}> "${name || '(图标)'}"`);
      }
    }
    return {
      overflow: doc.scrollWidth - doc.clientWidth,
      dead,
      total: clickables.length,
      route: document.querySelector('[data-route]')?.getAttribute('data-route') ?? '(none)',
      bodyStart: document.body.innerText.replace(/\s+/g, ' ').slice(0, 60),
    };
  });

  if (report.route !== route) note(route, '路由未切换', `期望 ${route}，实际 ${report.route}｜${report.bodyStart}`);
  if (report.overflow > 1) note(route, '横向溢出', `${report.overflow}px`);
  for (const d of report.dead) note(route, '不可用控件', d);
  console.log(`  控件 ${report.total} · 溢出 ${report.overflow}px · 当前视图 ${report.route}`);
  if (consoleErrors.length) {
    note(route, '控制台报错', consoleErrors[0].slice(0, 160));
    consoleErrors.length = 0;
  }
  return report;
}

/** Click a control, then report any error / stuck dialog / layout break. */
async function probe(route, selector, label, { dialog = false } = {}) {
  consoleErrors.length = 0;
  try {
    const el = page.locator(selector).first();
    if (!(await el.count())) {
      note(route, '控件缺失', label);
      return false;
    }
    await el.click({ timeout: 4000 });
    await page.waitForTimeout(450);

    // Radix menus set body pointer-events:none while open; make sure every
    // overlay is really gone before the next probe.
    for (let i = 0; i < 3; i++) {
      const pe = await page.evaluate(() => getComputedStyle(document.body).pointerEvents);
      if (pe === 'auto') break;
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(250);
    }

    if (dialog) {
      // Pick the innermost visible dialog: the side panels also carry
      // role="dialog" but stay mounted (translated off-screen).
      const dlg = page
        .locator('[role="dialog"]:visible:not([aria-hidden="true"])')
        .filter({ hasNot: page.locator('[inert]') })
        .last();
      const visible = await dlg.isVisible().catch(() => false);
      if (visible) {
        const lab = (await dlg.getAttribute('aria-label')) || '(未命名)';
        // 1) labelled close control (✕ / 取消) if present;
        const closeBtn = dlg.locator('button[aria-label="关闭"], button[aria-label="取消"]').last();
        if ((await closeBtn.count()) && (await closeBtn.isVisible().catch(() => false))) {
          await closeBtn.click({ timeout: 2000 }).catch(() => {});
        } else {
          // 2) Esc — PushAside and every sheet handle it.
          await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(400);
        }
        // 3) last resort: click the visible sliver of the pushed page. The band
        //    sits on the side OPPOSITE the panel.
        if (await dlg.isVisible().catch(() => false)) {
          const band = await page.evaluate(() => {
            const s = document.querySelector('button[aria-label="关闭侧栏"]');
            if (!s) return null;
            const r = s.getBoundingClientRect();
            const panel = document.querySelector('[role="dialog"][aria-label="聊天列表"], [role="dialog"][aria-label="对话设置"]');
            const pr = panel?.getBoundingClientRect();
            if (!pr) return null;
            // Right panel → sliver is on the left; left panel → sliver on the right.
            const x = pr.left > 10 ? pr.left / 2 : (pr.right + window.innerWidth) / 2;
            return { x, y: 420 };
          });
          if (band) await page.mouse.click(band.x, band.y);
          await page.waitForTimeout(500);
        }
        if (await dlg.isVisible().catch(() => false)) note(route, '弹层无法关闭', lab);
      }
    }

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) note(route, '点击后横向溢出', `${label} → ${overflow}px`);    if (consoleErrors.length) {
      note(route, '点击后控制台报错', `${label}: ${consoleErrors[0].slice(0, 140)}`);
      consoleErrors.length = 0;
    }
    return true;
  } catch (err) {
    let cover = '';
    try {
      cover = await page.evaluate((sel) => {
        const el = document.querySelector(sel.split(',')[0].trim());
        if (!el) return 'missing';
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        const openOverlays = document.querySelectorAll('[role="menu"], [role="dialog"]').length;
        const pe = getComputedStyle(document.body).pointerEvents;
        return `hit=${hit ? hit.tagName + '/' + (hit.getAttribute('aria-label') || '').slice(0, 24) : 'none'} overlays=${openOverlays} bodyPE=${pe}`;
      }, selector);
    } catch {
      /* ignore */
    }
    note(route, '点击失败', `${label}: ${cover} | ${err.message.split('\n')[0].slice(0, 80)}`);
    return false;
  }
}

// ---------------------------------------------------------------- Layer 1
console.log('########## 第一层：路由加载检查 ##########');
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
// The chat-first empty state has no <header> yet — wait for the route marker.
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.evaluate(async () => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  if (s.cards.length === 0) for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
  if (!s.personas.length) await s.savePersona(structuredClone(data.SAMPLE_PERSONA));
  if (!s.llmConnections.length) {
    await s.saveLLMConnection({
      id: 'conn_audit',
      name: 'Audit',
      provider: 'custom',
      baseURL: 'http://127.0.0.1:8799/v1',
      apiKey: 'k',
      defaultModel: 'audit-model',
    });
  }
  s.setSettings({ defaultConnectionId: 'conn_audit' });
});

for (const r of NAV) {
  try {
    await openRoute(r.label);
    await inspectRoute(r.route, r.label);
  } catch (err) {
    note(r.route, '路由失败', err.message.split('\n')[0].slice(0, 140));
  }
}

// Settings hub rows: every section opens, renders, and never overflows.
console.log('\n=== settings 目录 → 子页 ===');
try {
  await openRoute('设置');
  // The API连接 round button deep-links into the models sub-page; climb back
  // to the hub so we can iterate the directory rows.
  const toHub = page.locator('header button[aria-label="返回上一级"]');
  if (await toHub.count()) {
    await toHub.click();
    await page.waitForTimeout(500);
  }
  for (const label of ['模型连接', '模型设置', '生图 API', '生图设置', '用户身份', '主题', '模板', '记忆', '工具', '备份', '数据管理', '网络']) {
    const row = page.locator('main section button', { hasText: label }).first();
    if (!(await row.count())) {
      note('settings', '目录行缺失', label);
      continue;
    }
    await row.click({ timeout: 3000 });
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) note('settings', '子页横向溢出', `${label} → ${overflow}px`);
    if (consoleErrors.length) {
      note('settings', '子页控制台报错', `${label}: ${consoleErrors[0].slice(0, 120)}`);
      consoleErrors.length = 0;
    }
    console.log(`  ${label} · 溢出 ${overflow}px`);
    // Back to the hub for the next row.
    const back = page.locator('header button[aria-label="返回上一级"]');
    if (await back.count()) {
      await back.click();
      await page.waitForTimeout(350);
    } else {
      await openRoute('设置');
    }
  }
} catch (err) {
  note('settings', '目录遍历失败', err.message.slice(0, 140));
}

// Novel sub-tabs. The page is an empty state until a book exists.
console.log('\n=== novel 子页签 ===');
try {
  await openRoute('小说');
  if (await page.locator('button', { hasText: '新建书籍' }).count()) {
    await page.locator('button', { hasText: '新建书籍' }).first().click({ timeout: 4000 });
    await page.waitForTimeout(700);
  }
  for (const label of ['书架', '设定', '角色', '目录', '查找']) {
    const tab = page.getByRole('button', { name: label, exact: true });
    if (!(await tab.count())) {
      note('novel', '页签缺失', label);
      continue;
    }
    await tab.first().click({ timeout: 3000 });
    await page.waitForTimeout(350);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) note('novel', '子页签横向溢出', `${label} → ${overflow}px`);
    console.log(`  ${label} · 溢出 ${overflow}px`);
  }
} catch (err) {
  note('novel', '子页签遍历失败', err.message.slice(0, 140));
}

// ---------------------------------------------------------------- Layer 2
console.log('\n########## 第二层：关键控件点击 ##########');

// Cards: library controls, then open a real chat for the ChatView probes.
await openRoute('角色卡');
// 单一入口：＋ → 创建角色子页（导入 / AI 都从那里进去）。
await probe('cards', 'button[aria-label="新建角色"]', '创建角色子页');
// The probe lands on the sub-page; climb back before touching the grid.
const backToCards = page.locator('main button[aria-label="返回角色卡"]');
if (await backToCards.count()) {
  await backToCards.first().click();
  await page.waitForTimeout(600);
}
// Poster cards are pure now: 简介 / 收藏 live in the ⋮ menu and the
// long-press sheet, so the visible-face probes are gone.
await probe('cards', 'article button[aria-label$="操作菜单"]', '卡片操作菜单', { dialog: true });
// Tapping a card opens the detail sheet; the start action lives there.
await probe('cards', 'article button[aria-label^="查看 "]', '角色详情 sheet', { dialog: true });
await page.waitForTimeout(600);

// Get into an actual chat: open the sheet again and press 开始新聊天.
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const startChatBtn = page.locator('[role="dialog"] button[aria-label^="和 "]').first();
if (await startChatBtn.count()) {
  await startChatBtn.click();
  await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 15000 });
  await page.waitForTimeout(700);
}

// Chat (now has a greeting): header controls, composer, inspector.
// Chat: immersive header + drawer + composer + message menu.
await probe('chat', 'button[aria-label="打开聊天列表"]', '抽屉菜单', { dialog: true });
await probe('chat', 'button[aria-label="打开操作面板"]', '操作面板（加号）', { dialog: true });
await probe('chat', 'textarea[aria-label="消息输入框"]', '输入框聚焦');
await probe('chat', 'button[aria-label="打开对话设置"]', '右侧设置栏', { dialog: true });
// Message actions live behind the "更多操作" menu on a phone.
await probe('chat', 'div[data-role] button[aria-label="更多操作"]', '消息更多菜单', { dialog: true });

// Lore
await openRoute('世界书');
await probe('lore', 'button:has-text("新建")', '新建世界书');

// Presets: "编辑" puts the preset into draft mode, where blocks are editable.
await openRoute('预设');
await probe('presets', 'button:has-text("编辑")', '编辑预设');
await probe('presets', 'button:has-text("添加区块")', '预设区块编辑器');

// Novel: create a book, then exercise its tabs.
await openRoute('小说');
await probe('novel', 'button:has-text("新建书籍")', '新建书籍');
await page.waitForTimeout(600);
for (const label of ['设定', '角色', '目录', '查找']) {
  await probe('novel', `button:text-is("${label}")`, `小说页签 ${label}`);
}

// Plugins
await openRoute('插件');
await probe('plugins', 'button:has-text("安装 .rpnx")', '安装 .rpnx', { dialog: false });

await browser.close();

console.log('\n========== 审计结果 ==========');
console.log(`发现 ${findings.length} 处问题`);
const byKind = new Map();
for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
for (const [k, n] of byKind) console.log(`  ${k}: ${n}`);
writeFileSync('scripts/ui-audit-findings.json', JSON.stringify(findings, null, 2));
process.exit(findings.length ? 1 : 0);
