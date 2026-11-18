/** Shared Playwright helpers for the e2e scripts (mobile viewport). */
import { chromium } from 'playwright';

export const BASE = process.env.RPNOW_E2E_BASE ?? 'http://127.0.0.1:5173/';

export async function launch() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('dialog', (d) => void d.accept());
  return { browser, page };
}

/**
 * Component confirm dialogs (ConfirmHost) replaced the native ones; tests must
 * click the real button instead of relying on the native-dialog auto-accepter.
 */
export async function acceptWebConfirm(page, text = '确定') {
  try {
    const btn = page.locator('[role="dialog"] button', { hasText: text }).first();
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(400);
    return true;
  } catch {
    return false;
  }
}

/**
 * Tap the first card and start chatting.
 *
 * Tapping a poster card now opens the detail sheet (the user reads the card
 * before committing to a chat), so starting a conversation means one extra tap
 * on the sheet's primary button.
 */
export async function openFirstCardChat(page) {
  await page.locator('article button[aria-label^="查看 "]').first().click({ timeout: 20000 });
  await page.waitForTimeout(700);
  const start = page.locator('[role="dialog"] button[aria-label^="和 "]');
  if (await start.count()) {
    await start.first().click();
  }
  await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 20000 });
  await page.waitForTimeout(600);
}

/**
 * Open a side panel and navigate to a feature page.
 *
 * Tavo-style navigation: the left panel holds the chat list plus three round
 * buttons (API连接 / 角色 / 更多). 更多 lands on the settings hub, whose rows
 * reach everything else (世界书/预设/小说/插件管理 + the settings sections).
 */
export async function drawerNavigate(page, label) {
  // A previously opened panel may still be pushed open; dismiss it first so the
  // header ☰ is reachable again.
  const scrim = page.locator('button[aria-label="关闭侧栏"]');
  if (await scrim.count()) {
    const visible = await page.evaluate(() => {
      const s = document.querySelector('button[aria-label="关闭侧栏"]');
      return s ? getComputedStyle(s).opacity === '1' : false;
    });
    if (visible) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(450);
    }
  }
  const ROUND = { 角色卡: '角色', 设置: 'API连接' };
  const HUB_ROWS = ['世界书', '预设', '小说', '插件管理', '插件', '模型连接', '模型设置', '生图 API', '生图设置', '用户身份', '主题', '模板', '记忆', '工具', '备份', '数据管理', '网络'];
  const openBtn = page.locator('button[aria-label="打开聊天列表"]');
  if (!(await openBtn.count())) {
    // Sub-pages have no ☰ anymore: climb back to the chat page first.
    const back = page.locator('header button[aria-label="返回上一级"]');
    if (await back.count()) {
      await back.first().click({ timeout: 8000 });
      await page.waitForTimeout(700);
    }
  }
  if (!(await openBtn.count())) {
    await page.locator('button[aria-label="打开对话设置"]').first().click({ timeout: 8000 });
    await page.waitForTimeout(600);
  } else {
    await openBtn.first().click({ timeout: 8000 });
    await page.waitForTimeout(600);
  }
  const leftPanel = page.locator('[role="dialog"][aria-label="聊天列表"]');
  const round = ROUND[label];
  if (round && (await leftPanel.count())) {
    await leftPanel.locator('button', { hasText: round }).first().click({ timeout: 8000 });
    await page.waitForTimeout(800);
    // API连接 deep-links into the models sub-page; climb back to the hub when
    // the caller asked for a different destination.
    if (label !== '设置' && HUB_ROWS.includes(label)) {
      const back = page.locator('header button[aria-label="返回上一级"]');
      if (await back.count()) {
        await back.click();
        await page.waitForTimeout(500);
      }
    }
    return;
  }
  // Everything else lives behind 更多 → the settings hub.
  if (await leftPanel.count()) {
    await leftPanel.locator('button:has-text("更多")').last().click({ timeout: 8000 });
    await page.waitForTimeout(900);
    const row = page.locator('main section button', { hasText: label }).first();
    if (await row.count()) {
      await row.click({ timeout: 8000 });
      await page.waitForTimeout(800);
      return;
    }
    // label === '设置' already landed on the hub; nothing more to do.
    return;
  }
  // Right panel is open: use its rows.
  await page.locator('[role="dialog"][aria-label="对话设置"] button', { hasText: label }).first().click({ timeout: 8000 });
  await page.waitForTimeout(800);
}

/** Seed the sample cards / persona / connection and reload so the UI sees them. */
export async function seed(page, { port, connName = 'Mock' } = {}) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-route]', { timeout: 25000 });
  await page.waitForTimeout(600);
  await page.evaluate(async (p) => {
    const data = await import('/src/core/defaults/sampleData.ts');
    const presets = await import('/src/core/defaults/presets.ts');
    const s = window.__rpnowStore.getState();
    if (s.cards.length === 0) {
      for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
      await s.savePersona(structuredClone(data.SAMPLE_PERSONA));
      for (const pr of presets.BUILTIN_PRESETS) await s.savePreset(structuredClone(pr));
    }
    if (p) {
      const existing = s.llmConnections.find((c) => c.name === 'Mock');
      const id = existing?.id ?? 'conn_mock';
      await s.saveLLMConnection({
        id,
        name: 'Mock',
        provider: 'custom',
        baseURL: `http://127.0.0.1:${p}/v1`,
        apiKey: 'test-key',
        defaultModel: 'mock-model',
      });
      s.setSettings({ defaultConnectionId: id });
      s.setSettings({ defaultPresetId: 'preset:roleplay-default' });
    }
  }, port ?? null);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-route]', { timeout: 25000 });
  await page.waitForTimeout(800);
}

/**
 * Start a chat with the first card (from the cards page) and wait for the
 * composer. Returns when the immersive chat is ready.
 */
export async function openFirstChat(page) {
  await drawerNavigate(page, '角色卡');
  await page.waitForSelector('article button[aria-label^="和 "]', { timeout: 20000 });
  await openFirstCardChat(page);
  return;
  await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start.count()) await __start.first().click();
  await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 20000 });
  await page.waitForTimeout(600);
}
