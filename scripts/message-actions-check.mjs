/**
 * Round 22: last-floor-only action plates (重新生成/继续/更多), 继续 sends a
 * request with no user turn, edit = bottom sheet, Tavo-style stats line with
 * speed/context/cache.
 */
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8861;
let lastPrompt = '';
let calls = 0;
const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      calls += 1;
      lastPrompt = raw;
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `续写第${calls}次。` } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 12345, completion_tokens: 234, prompt_tokens_details: { cached_tokens: 12000 } } })}\n\n`);
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
await page.waitForTimeout(900);
await page.evaluate(async (port) => {
  const s = window.__rpnowStore.getState();
  await s.addCard({
    id: 'ma', spec: 'v2', specVersion: '2.0', createdAt: Date.now(), updatedAt: Date.now(),
    data: { name: '按钮测', description: '', personality: '', scenario: '', first_mes: '开场。', mes_example: '' },
  });
  const msgs = [
    { id: 'a1', role: 'assistant', content: '旧楼层一。', createdAt: Date.now() },
    { id: 'a2', role: 'user', content: '旧楼层二。', createdAt: Date.now() + 1 },
    { id: 'a3', role: 'assistant', content: '旧楼层三。'.repeat(30), createdAt: Date.now() + 2 },
    { id: 'a4', role: 'user', content: '旧楼层四。', createdAt: Date.now() + 3 },
    { id: 'a5', role: 'assistant', content: '最新楼层。', createdAt: Date.now() + 4 },
  ];
  await s.saveChat({
    id: 'chatma', title: '按钮测', cardId: 'ma', lorebookIds: [], useCardLorebook: true,
    messages: msgs, variables: {}, createdAt: Date.now(), updatedAt: Date.now(),
  });
  await s.saveLLMConnection({
    id: 'conn_ma', name: 'Mock', provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`, apiKey: 'k', defaultModel: 'mock',
  });
  s.setSettings({ defaultConnectionId: 'conn_ma' });
  s.setActiveChat('chatma');
}, PORT);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

// ---- 1. plates only on the last floor ----------------------------------
const plates = await page.evaluate(() => {
  const floors = [...document.querySelectorAll('main [data-role]')];
  return floors.map((f) => ({
    role: f.getAttribute('data-role'),
    hasRegen: Boolean(f.querySelector('button[aria-label="重新生成这条回复"]')),
    hasContinue: Boolean(f.querySelector('button[aria-label="继续剧情"]')),
    hasMore: Boolean(f.querySelector('button[aria-label="更多操作"]')),
  }));
});
check('历史楼层无操作按钮', plates.slice(0, -1).every((p) => !p.hasRegen && !p.hasContinue && !p.hasMore), JSON.stringify(plates.length));
check('最后楼层有三个按钮', plates.at(-1)?.hasRegen && plates.at(-1)?.hasContinue && plates.at(-1)?.hasMore, '');

// ---- 2. 继续 sends a request without a user turn -----------------------
const before = await page.evaluate(() => window.__rpnowStore.getState().chats.find((c) => c.id === 'chatma').messages.length);
await page.locator('button[aria-label="继续剧情"]').click();
await page.waitForTimeout(2600);
const after = await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  const msgs = s.chats.find((c) => c.id === 'chatma').messages;
  return { len: msgs.length, lastRole: msgs.at(-1)?.role, lastContent: msgs.at(-1)?.content?.slice(0, 14) };
});
check('继续后新增一层', after.len === before + 1, `${before} → ${after.len}`);
check('新楼层是 assistant（无用户输入）', after.lastRole === 'assistant', JSON.stringify(after));
check('请求体不含新的用户消息', !lastPrompt.includes('"你好') && lastPrompt.includes('最新楼层'), lastPrompt.slice(0, 60));

// ---- 3. stats line: speed / context / cache ----------------------------
const stats = await page.evaluate(() => {
  const el = [...document.querySelectorAll('main div')].find((d) => /tok\/s/.test(d.textContent || ''));
  return el ? el.innerText.replace(/\s+/g, ' ') : null;
});
check('统计条存在（tok/s）', Boolean(stats) && /tok\/s/.test(stats ?? ''), String(stats));
check('统计条含上下文（12.3K）', /12\.3K 上下文/.test(stats ?? ''), String(stats));
check('统计条含缓存命中（12.0K）', /已缓存 12\.0K/.test(stats ?? ''), String(stats));

// ---- 4. edit moved into 更多, opens a bottom sheet ---------------------
const editInline = await page.evaluate(() => Boolean(document.querySelector('button[aria-label="编辑消息"]')));
check('气泡行没有独立的编辑按钮', !editInline, '');
await page.locator('button[aria-label="更多操作"]').last().click();
await page.waitForTimeout(600);
const editItem = page.locator('[role="menuitem"]', { hasText: '编辑消息' });
check('更多菜单里有编辑消息', (await editItem.count()) > 0, '');
await editItem.first().click();
await page.waitForTimeout(700);
const sheet = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"][aria-label="编辑消息"]');
  if (!dlg) return null;
  return {
    hasTextarea: Boolean(dlg.querySelector('textarea[aria-label="编辑消息内容"]')),
    hasSave: Boolean(dlg.querySelector('button[aria-label="保存编辑"]')),
    title: dlg.querySelector('p')?.textContent,
    bottom: Math.round(dlg.firstElementChild?.nextElementSibling?.getBoundingClientRect().top ?? 0) > 100,
    sheetAtBottom: Boolean(dlg.querySelector('div.rounded-t-2xl')),
  };
});
check('编辑以 bottom sheet 打开', sheet?.hasTextarea && sheet?.hasSave && sheet?.sheetAtBottom, JSON.stringify(sheet));
check('sheet 标题为「改写」', sheet?.title === '改写', String(sheet?.title));

// Edit the content and save.
await page.locator('textarea[aria-label="编辑消息内容"]').fill('被改写过的最新楼层。');
await page.locator('button[aria-label="保存编辑"]').click();
await page.waitForTimeout(900);
const edited = await page.evaluate(() =>
  window.__rpnowStore.getState().chats.find((c) => c.id === 'chatma').messages.at(-1)?.content,
);
check('保存后消息内容更新', edited === '被改写过的最新楼层。', String(edited));
await page.waitForTimeout(400);

await browser.close();
mock.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
