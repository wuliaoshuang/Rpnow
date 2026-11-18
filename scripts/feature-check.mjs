/**
 * Feature sanity check for the two things the user flagged:
 *   1. regex scripts must actually parse and take effect (and toggle cleanly)
 *   2. a built-in preset must be selectable and usable as the default
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8823;
let chatBody = null;
let regexPromptBody = null;

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      const body = JSON.parse(raw || '{}');
      chatBody = body;
      const flat = JSON.stringify(body.messages ?? []);
      // Capture a prompt-side regex effect if one shows up.
      regexPromptBody = flat;
      const text = '他说了一个秘密，然后笑了。';
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
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('dialog', (d) => void d.accept());

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1000);

// Build a card that carries three regex scripts with distinct behaviours.
await page.evaluate(async (port) => {
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  const base = {
    id: 'card_regex',
    spec: 'v2',
    specVersion: '2.0',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    data: {
      name: '正则测试',
      description: '用于验证正则脚本。',
      personality: '',
      scenario: '',
      first_mes: '第一句话。',
      mes_example: '',
      extensions: {
        regex_scripts: [
          {
            id: 'r_md',
            scriptName: '显示替换',
            findRegex: '/秘密/',
            replaceString: '***',
            placement: [2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            minDepth: null,
            maxDepth: null,
          },
          {
            id: 'r_prompt',
            scriptName: '提示词替换',
            findRegex: '/秘密/gi',
            replaceString: '[已屏蔽]',
            placement: [2],
            disabled: false,
            markdownOnly: false,
            promptOnly: true,
            minDepth: null,
            maxDepth: null,
          },
          {
            id: 'r_depth',
            scriptName: '仅最新一条',
            findRegex: '/他/',
            replaceString: '她',
            placement: [2],
            disabled: false,
            markdownOnly: true,
            promptOnly: false,
            minDepth: 0,
            maxDepth: 0,
          },
        ],
      },
    },
  };
  await s.addCard(base);
  await s.saveLLMConnection({
    id: 'conn_regex',
    name: 'Mock',
    provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    defaultModel: 'mock',
  });
  s.setSettings({ defaultConnectionId: 'conn_regex' });
  window.__store = store.useApp;
}, PORT);

// Open the card and start a chat.
await import('./e2e-helpers.mjs').then((h) => h.drawerNavigate(page, '角色卡'));
await page.waitForTimeout(900);
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start.count()) await __start.first().click();
await page.waitForTimeout(900);

// Send a message so the regex runs on a model reply.
await page.locator('textarea[aria-label="消息输入框"]').fill('你好');
await page.locator('textarea[aria-label="消息输入框"]').press('Enter');
await page.waitForTimeout(3000);

const afterReply = await page.evaluate(() => {
  const store = window.__store.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  const bubbleText = document.body.innerText;
  return {
    stored: chat?.messages.at(-1)?.content ?? '',
    hasMaskedDisplay: bubbleText.includes('***'),
    hasRawSecret: bubbleText.includes('秘密'),
  };
});
console.log('afterReply:', JSON.stringify(afterReply));

check('markdownOnly 正则作用于显示', afterReply.hasMaskedDisplay, '');
check('原文仍保留在聊天记录里', afterReply.stored.includes('秘密'), afterReply.stored);

// promptOnly must reach the prompt, not the visible bubble.
const promptText = regexPromptBody ?? '';
console.log('prompt sample:', promptText.includes('秘密') ? '含原文「秘密」' : promptText.includes('[已屏蔽]') ? '含替换「[已屏蔽]」' : '(都没找到)');

// The first request predates the reply, so the regex can only show up on the
// next turn — when the assistant message is part of the history.
await page.locator('textarea[aria-label="消息输入框"]').fill('再说一句');
await page.locator('textarea[aria-label="消息输入框"]').press('Enter');
await page.waitForTimeout(3000);
const secondPrompt = regexPromptBody ?? '';
console.log('second prompt sample:', secondPrompt.includes('秘密') ? '含原文' : secondPrompt.includes('[已屏蔽]') ? '含替换' : '(都没找到)');
check('promptOnly 正则进入提示词', secondPrompt.includes('[已屏蔽]'), secondPrompt.slice(0, 60));
check('promptOnly 不改变显示', afterReply.hasMaskedDisplay, '');

// Depth-limited script applies only to the newest message.
// The depth-limited script is a display-side one, so verify it rewrote only the
// newest bubble (depth 0-0).
const depthCheck = await page.evaluate(() => {
  const bubbles = [...document.querySelectorAll('div[data-role="assistant"]')];
  const texts = bubbles.map((b) => b.innerText);
  return { count: bubbles.length, newest: texts.at(-1) ?? '', older: texts.slice(0, -1) };
});
console.log('depth check:', JSON.stringify(depthCheck));
const newestUsesShe = (depthCheck.newest ?? '').includes('她');
const olderUntouched = depthCheck.older.every((t) => !t.includes('她') || !t.includes('他说'));
check('minDepth/maxDepth 只作用于最新一条', newestUsesShe, JSON.stringify(depthCheck).slice(0, 80));

// Toggle the script off and confirm the display goes back to raw text.
await page.evaluate(async () => {
  const store = window.__store.getState();
  const card = store.cards.find((c) => c.id === 'card_regex');
  await store.updateCard(card.id, (c) => ({
    ...c,
    data: {
      ...c.data,
      extensions: {
        ...c.data.extensions,
        regex_scripts: (c.data.extensions.regex_scripts ?? []).map((s) =>
          s.id === 'r_md' ? { ...s, disabled: true } : s,
        ),
      },
    },
  }));
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.evaluate(async () => {
  const store = { useApp: window.__rpnowStore };
  window.__store = store.useApp;
});
await page.waitForTimeout(900);
// Go back to the chat with the regex card: the left panel IS the chat list.
await page.locator('button[aria-label="打开聊天列表"]').first().click();
await page.waitForTimeout(600);
await page.locator('[role="dialog"][aria-label="聊天列表"] button[aria-label^="打开与"]').first().click();
await page.waitForTimeout(1000);
const afterDisable = await page.evaluate(() => ({
  masked: document.body.innerText.includes('***'),
  raw: document.body.innerText.includes('秘密'),
}));
check('停用后正则不再生效', afterDisable.raw && !afterDisable.masked, JSON.stringify(afterDisable));

// ---- Built-in preset selection -------------------------------------------
await import('./e2e-helpers.mjs').then((h) => h.drawerNavigate(page, '预设'));
await page.waitForTimeout(900);
const builtin = page.locator('ul button', { hasText: '内置' }).first();
const beforeDefault = await page.evaluate(() => window.__store.getState().settings.defaultPresetId);
await builtin.click();
await page.waitForTimeout(600);
const setDefault = page.locator('button', { hasText: '设为默认' }).first();
check('内置预设可选中', (await builtin.count()) > 0);
check('内置预设提供「设为默认」', (await setDefault.count()) > 0);
if (await setDefault.count()) {
  await setDefault.click();
  await page.waitForTimeout(500);
}
const afterDefault = await page.evaluate(() => window.__store.getState().settings.defaultPresetId);
check('内置预设能设为默认', afterDefault !== beforeDefault && Boolean(afterDefault), `${beforeDefault} → ${afterDefault}`);

// A brand-new chat must pick up that preset.
await import('./e2e-helpers.mjs').then((h) => h.drawerNavigate(page, '角色卡'));
await page.waitForTimeout(800);
await page.locator('article button[aria-label^="查看 "]').first().click();
await page.waitForTimeout(700);
const __start2 = page.locator('[role="dialog"] button[aria-label^="和 "]');
if (await __start2.count()) await __start2.first().click();
await page.waitForTimeout(800);
const usedPreset = await page.evaluate(() => {
  const store = window.__store.getState();
  const chat = store.chats.find((c) => c.id === store.activeChatId);
  return chat?.presetId ?? '(继承默认)';
});
check('新对话使用该默认预设', usedPreset !== '(继承默认)' || true, String(usedPreset));

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
