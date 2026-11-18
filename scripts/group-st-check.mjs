/**
 * Group chat + SillyTavern extension import.
 */
import { createServer } from 'node:http';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const PORT = 8831;
let lastPrompt = '';
const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      lastPrompt = raw;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: '群聊回复。' } }] })}\n\n`);
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

// Build a fake SillyTavern extension ZIP.
const zip = new JSZip();
zip.file(
  'manifest.json',
  JSON.stringify({ display_name: '测试酒馆扩展', name: 'test-st-ext', version: '1.0.0', js: 'index.js', css: 'style.css' }),
);
zip.file(
  'index.js',
  `(function(){
    window.__stRan = true;
    window.__stHasContext = typeof SillyTavern.getContext === 'function';
    var ctx = SillyTavern.getContext();
    window.__stChatLen = ctx.chat.length;
    window.__stName2 = ctx.name2;
    SillyTavern.eventSource.on(ctx.eventTypes.MESSAGE_SENT, function(){ window.__stEventFired = true; });
    document.body.setAttribute('data-st-ext', 'loaded');
  })();`,
);
zip.file('style.css', 'body[data-st-ext="loaded"] .rp-md { letter-spacing: 0.01em; }');
const buf = await zip.generateAsync({ type: 'nodebuffer' });
writeFileSync('test-st-ext.zip', buf);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('dialog', (d) => void d.accept());
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 160)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(800);
await page.evaluate(async (port) => {
  const s = window.__rpnowStore.getState();
  for (const [id, name, desc, pers] of [
    ['c1', '艾琳', '银发剑士。', '寡言'],
    ['c2', '卡尔', '话多的法师。', '健谈'],
    ['c3', '露娜', '安静的牧师。', '温柔'],
  ]) {
    await s.addCard({
      id, spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
      data: { name, description: desc, personality: pers, scenario: '', first_mes: `${name}点头。`, mes_example: '' },
    });
  }
  await s.saveLLMConnection({
    id: 'conn_g', name: 'Mock', provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'k', defaultModel: 'mock',
  });
  s.setSettings({ defaultConnectionId: 'conn_g' });
}, PORT);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(900);

// ---- group chat ----------------------------------------------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '角色' }).last().click();
await page.waitForTimeout(1000);
await page.locator('article button[aria-label^="查看 "]').first().click({ timeout: 15000 });
await page.waitForTimeout(700);
const __start = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start.count()) await __start.first().click();
await page.waitForTimeout(1000);

await page.locator('button[aria-label="打开对话设置"]').first().click({ timeout: 8000 });
await page.waitForTimeout(700);
const hasPlus = await page.locator('[role="dialog"][aria-label="对话设置"] button[aria-label="组建群聊"]').count();
check('右栏加号为「组建群聊」', hasPlus > 0, '');
await page.locator('[role="dialog"][aria-label="对话设置"] button[aria-label="组建群聊"]').first().click();
await page.waitForTimeout(800);
check('群聊面板打开', await page.locator('[role="dialog"][aria-label="组建群聊"]').isVisible().catch(() => false), '');

const rows = page.locator('[role="dialog"][aria-label="组建群聊"] button[aria-pressed]');
const n = await rows.count();
check('列出全部角色卡', n >= 3, `count=${n}`);
await rows.nth(0).click();
await rows.nth(1).click();
await rows.nth(2).click();
await page.waitForTimeout(400);
await page.locator('[role="dialog"][aria-label="组建群聊"] input[aria-label="群聊名称"]').fill('三人小队');
await page.locator('[role="dialog"][aria-label="组建群聊"] button', { hasText: '创建' }).first().click();
await page.waitForTimeout(1500);

const created = await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === s.activeChatId);
  return { title: chat?.title, members: chat?.groupCardIds?.length, speaker: chat?.groupSpeaker, host: chat?.cardId };
});
check('群聊已创建并包含 3 位成员', created.members === 3 && created.title === '三人小队', JSON.stringify(created));

// Send a turn and inspect the prompt for the roster block.
await page.locator('textarea[aria-label="消息输入框"]').fill('大家好');
await page.locator('textarea[aria-label="消息输入框"]').press('Enter');
await page.waitForTimeout(2500);
check('群聊提示词含角色名单', lastPrompt.includes('群聊场景') && lastPrompt.includes('卡尔'), lastPrompt.slice(0, 60));

// ---- SillyTavern extension import ---------------------------------------
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(700);
await page.locator('[role="dialog"][aria-label="聊天列表"] button', { hasText: '更多' }).last().click();
await page.waitForTimeout(900);
await page.locator('main section button', { hasText: '插件管理' }).first().click();
await page.waitForTimeout(1000);

const installed = await page.evaluate(async () => {
  // Drive the same code path the file picker uses.
  const mod = await import('/src/core/plugins/rpnx.ts');
  const res = await fetch('/test-st-ext.zip');
  const blob = await res.blob();
  const parsed = await mod.parseRpnx(blob);
  window.__parsed = { id: parsed.manifest.id, name: parsed.manifest.name, kind: parsed.manifest.kind, codeLen: parsed.code.length, hasStyles: Boolean(parsed.assets?.['__st__/styles.css']) };
  return window.__parsed;
});
check('ST 扩展被识别（非 .rpnx 校验）', installed.kind === 'st-extension', JSON.stringify(installed));
check('解析出脚本与样式', installed.codeLen > 0 && installed.hasStyles, JSON.stringify(installed));
check('显示了酒馆扩展名称', installed.name === '测试酒馆扩展', installed.name);

await browser.close();
mock.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
