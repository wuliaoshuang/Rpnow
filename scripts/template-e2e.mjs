/**
 * UI template end-to-end: create a template, let the model update its state via
 * <ui_template_updates>, and confirm the iframe renders the new value while the
 * stored reply stays clean prose.
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8816;
let lastBody = null;

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    if (req.url.includes('/chat/completions')) {
      lastBody = body;
      const text =
        '她推开门。<ui_template_updates>{"id":"tpl_hp","variables":{"hp":42,"name":"阿尔"}}</ui_template_updates>';
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
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
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 200)));
page.on('dialog', (d) => void d.accept());

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

const seeded = await page.evaluate(async (port) => {
  const data = await import('/src/core/defaults/sampleData.ts');
  const store = { useApp: window.__rpnowStore };
  const { createTemplate } = await import('/src/core/uitemplate/types.ts');
  const s = store.useApp.getState();
  if (s.cards.length === 0) for (const c of data.SAMPLE_CARDS) await s.addCard(structuredClone(c));
  const card = store.useApp.getState().cards[0];
  await s.saveLLMConnection({
    id: 'conn_mock',
    name: 'Mock',
    provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    defaultModel: 'mock-chat',
  });
  s.setSettings({ defaultConnectionId: 'conn_mock' });
  await s.saveUITemplate(
    createTemplate({
      id: 'tpl_hp',
      name: '状态栏',
      scope: 'character',
      scopeId: card.id,
      placement: 'top',
      htmlTemplate: '<div class="hp">HP: {{hp}} · {{name}}</div>',
      initialVariableState: { hp: 100, name: '—' },
      variableSchema: { hp: 'number', name: 'string' },
    }),
  );
  s.setSettings({
    uiTemplate: { ...store.useApp.getState().settings.uiTemplate, enabled: true },
  });
  window.__rpnowStore = store.useApp;
  return { cardId: card.id, templates: store.useApp.getState().uiTemplates.length };
}, PORT);
check('模板已创建', seeded.templates === 1, JSON.stringify(seeded));

await page.getByRole('button', { name: '角色卡' }).first().click();
await page.waitForSelector('article', { timeout: 20000 });
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start1 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start1.count()) await __start1.first().click();
await page.waitForSelector('textarea[aria-label="消息输入框"]', { timeout: 15000 });
await page.waitForTimeout(800);

const box = page.locator('textarea[aria-label="消息输入框"]').first();
await box.fill('开门');
await box.press('Enter');
await page.waitForTimeout(3500);

// The request should have asked the model to emit template updates.
const sysText = JSON.stringify(lastBody?.messages ?? []);
check('请求包含模板提示', sysText.includes('ui_template_updates') && sysText.includes('状态栏'), '');

const after = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const tpl = store.uiTemplates.find((t) => t.id === 'tpl_hp');
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  return {
    hp: tpl?.variableState?.hp,
    name: tpl?.variableState?.name,
    changes: tpl?.changeLog?.[0]?.changes ?? {},
    stored: chat?.messages.at(-1)?.content ?? '',
    iframes: document.querySelectorAll('iframe[title="状态栏"]').length,
  };
});
console.log('state:', JSON.stringify(after));

check('模型更新了 hp', after.hp === 42, `hp=${after.hp}`);
check('模型更新了 name', after.name === '阿尔', `name=${after.name}`);
check('记录了变更日志', after.changes?.hp?.from === 100 && after.changes?.hp?.to === 42, JSON.stringify(after.changes));
check('正文里的更新块被剥掉', !after.stored.includes('<ui_template_updates>'), after.stored.slice(0, 40));
check('模板渲染进沙箱 iframe', after.iframes > 0, `${after.iframes} 个`);

// The iframe body must show the updated value.
const frameText = await page.evaluate(() => {
  const iframe = document.querySelector('iframe[title="状态栏"]');
  if (!iframe) return '';
  try {
    return iframe.contentDocument?.body?.innerText ?? '';
  } catch {
    return '';
  }
});
check('iframe 内渲染新值', frameText.includes('42') && frameText.includes('阿尔'), frameText.trim().slice(0, 60));

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
