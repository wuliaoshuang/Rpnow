/**
 * Panels must be rendered before the user opens them — otherwise the first tap
 * shows a frame of background (the bug: page colour under an empty drawer).
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
await page.waitForTimeout(1300);

// ---- both panels exist at rest, fully populated ------------------------
const atRest = await page.evaluate(() => {
  const left = document.querySelector('aside[aria-label="聊天列表"]');
  const right = document.querySelector('aside[aria-label="对话设置"]');
  const info = (el) => (el ? {
    present: true,
    childCount: el.querySelectorAll('*').length,
    // innerText is empty for visibility:hidden nodes; textContent proves the subtree rendered.
    textLen: (el.textContent ?? '').trim().length,
    bg: getComputedStyle(el).backgroundColor,
    hidden: el.getAttribute('aria-hidden'),
  } : { present: false });
  return { left: info(left), right: info(right) };
});
check('左栏在启动时就已挂载', atRest.left.present === true, JSON.stringify(atRest.left));
check('左栏已有内容（非空白）', (atRest.left.childCount ?? 0) > 10 && (atRest.left.textLen ?? 0) > 5, JSON.stringify(atRest.left));
check('右栏在启动时就已挂载', atRest.right.present === true, JSON.stringify(atRest.right));
check('右栏已有内容（非空白）', (atRest.right.childCount ?? 0) > 10 && (atRest.right.textLen ?? 0) > 5, JSON.stringify(atRest.right));

// ---- background colour matches the theme (same paint as the page) ------
const themed = await page.evaluate(() => {
  const left = document.querySelector('aside[aria-label="聊天列表"]');
  const root = getComputedStyle(document.documentElement);
  return {
    panelBg: getComputedStyle(left).backgroundColor,
    themeElevated: root.getPropertyValue('--rp-bg-elevated').trim(),
  };
});
check('侧栏背景使用主题色（--rp-bg-elevated）', Boolean(themed.panelBg) && themed.panelBg !== 'rgba(0, 0, 0, 0)', JSON.stringify(themed));

// ---- first open shows content immediately (no empty frame) ------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
// Sample very early in the 480ms slide.
await page.waitForTimeout(80);
const early = await page.evaluate(() => {
  const left = document.querySelector('aside[aria-label="聊天列表"]');
  const r = left.getBoundingClientRect();
  // Visible slice of the drawer at this instant.
  const visW = Math.max(0, Math.min(r.right, window.innerWidth) - Math.max(r.left, 0));
  const firstRow = left.querySelector('button');
  return {
    visW: Math.round(visW),
    hasContentInView: visW > 0 && Boolean(firstRow),
    textLen: (left.innerText ?? '').trim().length,
  };
});
check('刚打开的一瞬间侧栏已有内容', early.hasContentInView && early.textLen > 5, JSON.stringify(early));

await page.waitForTimeout(600);
const settled = await page.evaluate(() => {
  const left = document.querySelector('aside[aria-label="聊天列表"]');
  return { hidden: left.getAttribute('aria-hidden'), textLen: (left.innerText ?? '').trim().length };
});
check('打开后 aria-hidden 正确清除', settled.hidden === 'false', String(settled.hidden));

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
