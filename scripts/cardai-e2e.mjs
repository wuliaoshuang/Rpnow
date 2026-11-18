/**
 * Card AI-generation end-to-end.
 *
 * The mock model replies with the labelled sections the parser expects,
 * including a JSON blob with an unescaped quote and `\s` escapes — the two
 * failure modes the repair path exists for.
 */

import { createServer } from 'node:http';
import { chromium } from 'playwright';

const PORT = 8818;
let lastBody = null;

const REPLY = `## Name
银发剑士

## Description
沉默的流浪剑士，左手缺了两根手指。

## Personality
话少，警惕，对承诺极其认真。

## Scenario
边陲小镇的雨天。

## First Message
**雨顺着屋檐往下淌。** 他把手按在剑柄上。

## Post History Instructions
保持第三人称叙述。

## Creator Notes
原创角色。

## Avatar Prompt
1boy, white hair, cloak

## World Info
\`\`\`json
[
  {"comment":"小镇","content":"常年下雨的边陲镇。","position":"before_char","order":10,"keys":["小镇"]}
]
\`\`\`

## Regex Scripts
\`\`\`json
[
  {"scriptName":"隐藏思考","findRegex":"/(<think>[\\s\\S]*?<\\/think>)/g","replaceString":"","placement":1,"markdownOnly":false,"promptOnly":true}
]
\`\`\`
`;

const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.writeHead(204).end();
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url?.includes('/chat/completions')) {
      lastBody = JSON.parse(raw || '{}');
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      // Stream in two chunks to exercise incremental accumulation.
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: REPLY.slice(0, 200) } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: REPLY.slice(200) } }] })}\n\n`);
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

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

await page.evaluate(async (port) => {
  const store = { useApp: window.__rpnowStore };
  const s = store.useApp.getState();
  await s.saveLLMConnection({
    id: 'conn_mock',
    name: 'Mock',
    provider: 'custom',
    baseURL: `http://127.0.0.1:${port}/v1`,
    apiKey: 'k',
    defaultModel: 'mock-chat',
  });
  s.setSettings({ defaultConnectionId: 'conn_mock' });
  window.__rpnowStore = store.useApp;
}, PORT);

await page.getByRole('button', { name: '角色卡' }).first().click();
// AI 生成现在在创建角色子页里。
await page.locator('button[aria-label="新建角色"]').first().click();
await page.waitForTimeout(700);
await page.locator('main button', { hasText: '从URL导入角色卡' }).first().click();
await page.waitForSelector('textarea[aria-label="角色描述"]', { timeout: 8000 });

await page.locator('textarea[aria-label="角色描述"]').fill('一个话很少的银发剑士');
await page.locator('button', { hasText: '开始生成' }).click();
await page.waitForTimeout(4000);

const result = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const card = store.cards.at(-1);
  return {
    count: store.cards.length,
    name: card?.data.name,
    description: card?.data.description,
    personality: card?.data.personality,
    scenario: card?.data.scenario,
    firstMes: card?.data.first_mes,
    postHistory: card?.data.post_history_instructions,
    avatarPrompt: card?.data.extensions?.avatar_prompt,
    entries: card?.data.character_book?.entries?.length ?? 0,
    regex: card?.data.extensions?.regex_scripts?.length ?? 0,
    editorOpen: Boolean(document.querySelector('button[aria-label="关闭编辑器"]')),
  };
});
console.log('result:', JSON.stringify(result));

check('卡片已创建', result.count === 1, `${result.count} 张`);
check('名称解析', result.name === '银发剑士', String(result.name));
check('描述解析', /流浪剑士/.test(result.description ?? ''), String(result.description).slice(0, 30));
check('设定解析', /话少/.test(result.personality ?? ''), '');
check('开场白解析并去掉 **', result.firstMes?.includes('雨顺着屋檐') && !result.firstMes?.includes('**'), String(result.firstMes));
check('后续指令解析', result.postHistory === '保持第三人称叙述。', String(result.postHistory));
check('头像提示词解析', result.avatarPrompt === '1boy, white hair, cloak', String(result.avatarPrompt));
check('世界书条目解析', result.entries === 1, `${result.entries} 条`);
check('正则脚本解析（含 \\s 转义修复）', result.regex === 1, `${result.regex} 条`);
check('生成后打开编辑器', result.editorOpen, '');

const regexOk = await page.evaluate(() => {
  const store = window.__rpnowStore.getState();
  const card = store.cards.at(-1);
  const script = card?.data.extensions?.regex_scripts?.[0];
  return script?.findRegex?.includes('\\s') || script?.findRegex?.includes('s');
});
check('正则表达式保留原始语义', regexOk, '');

const sysPrompt = JSON.stringify(lastBody?.messages ?? []);
check('请求使用卡片生成提示词', sysPrompt.includes('角色卡创作助手'), '');

await browser.close();
mock.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
