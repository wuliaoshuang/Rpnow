/**
 * e2e：开场白里带一整个 HTML 页面的角色卡（手机尺寸 390×844，假模型）。
 *
 * 验证：
 * - 页面装在沙箱 iframe 里，表单控件、脚本都能用，高度跟着内容走；
 * - 卡片样式一点都漏不到应用界面（输入框、标题栏、html/body 的样式与纯文字
 * 开场白的聊天逐项相同）；
 * - 页面前后的正文照常显示；切换开场白正常；
 * - 「确认开局」把文字放进输入框（不自动发送），用户点发送后正常发出；
 * - 卡片正则把自定义标签换成整页（真卡的写法）：每种写法都整页进 iframe，
 *   酒馆式的「确认」在用户点击时直接发出，页面自己偷偷调用时只放进输入框；
 * - 卡片脚本碰不到应用页面、本地存储、IndexedDB；
 * - 关掉「沙箱 HTML」走内联渲染时，样式同样漏不出去。
 *
 * 用法：先起 dev server（http://127.0.0.1:5173），再 `node scripts/html-greeting-e2e.mjs`。
 * 截图存到 RPNOW_E2E_SHOTS 指定的目录（默认不截图）。
 */
import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { BASE, launch } from './e2e-helpers.mjs';
import { PROSE_AFTER, PROSE_BEFORE, SETUP_DOC, VARIANTS } from './fixtures/html-greeting.mjs';
import { DETECT_KINDS, OPENING_TAG, SEND_KINDS, openingPage, openingRegexScript, openingShapes } from './fixtures/attr-tag-opening.mjs';

const PORT = 59981;
const SHOTS = process.env.RPNOW_E2E_SHOTS ?? '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let passed = 0;
let failures = 0;
function check(name, ok, extra = '') {
  if (ok) {
    passed++;
    console.log(` ok - ${name}`);
  } else {
    failures++;
    console.log(` FAIL - ${name} ${extra}`);
  }
}

/* ------------------------------------------------------------ 假模型 */
let llmCalls = 0;
const STREAM_DOC = `面板来了。\n\n${SETUP_DOC}\n\n看完告诉我。`;
const mock = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') return void res.writeHead(204).end();
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return void res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
  }
  if (req.url?.endsWith('/chat/completions')) {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      llmCalls++;
      let last = '';
      try {
        const body = JSON.parse(raw);
        const users = (body.messages ?? []).filter((m) => m.role === 'user');
        const c = users[users.length - 1]?.content;
        last = typeof c === 'string' ? c : JSON.stringify(c);
      } catch {
        /* ignore */
      }
      const reply = last.includes('来个面板') ? STREAM_DOC : '收到，故事开始。';
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      // 切成小块慢慢吐，页面会在「写到一半」的状态下渲染很多次。
      const size = reply.length > 200 ? 180 : 8;
      for (let i = 0; i < reply.length; i += size) {
        res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply.slice(i, i + size) } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 15));
      }
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    });
    return;
  }
  res.writeHead(404).end();
});
await new Promise((r) => mock.listen(PORT, '127.0.0.1', r));

/* ------------------------------------------------------------ 准备 */
const { browser, page } = await launch();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__rpnowStore, null, { timeout: 20000 });
await page.waitForTimeout(600);

/** 卡片：id → { 开场白, 备选开场白}。 */
const CARDS = {
  plain: { first: VARIANTS.plain, alts: [] },
  prose: { first: VARIANTS.docWithProse, alts: ['第二个开场白，纯文字。', VARIANTS.docOnly] },
  docOnly: { first: VARIANTS.docOnly, alts: [] },
  docInline: { first: VARIANTS.docInline, alts: [] },
  docFenced: { first: VARIANTS.docFenced, alts: [] },
  fragment: { first: VARIANTS.fragment, alts: [] },
  bodyOnly: { first: VARIANTS.bodyOnly, alts: [] },
  // 留在气泡里内联渲染的 HTML（没有脚本、没有表单控件），专门用来钻样式隔离的洞。
  leakUnclosed: {
    first:
      '没收尾的样式。\n\n<div class="box">面板</div>\n<style>textarea{background:rgb(255,0,0);resize:vertical}*{padding:0;margin:0}header{padding:0}body{background:rgb(0,255,0)}',
    alts: [],
  },
  leakMedia: {
    first:
      '<style>.a{color:red}@media (min-width:1px){textarea{background:rgb(255,0,0);resize:vertical}*{padding:0!important}}@supports (display:block){header{padding-top:0!important}html,body{background:rgb(0,255,0)!important}}</style><div class="a">媒体查询里的规则。</div>',
    alts: [],
  },
  leakXss: { first: '样式块提前收尾。\n\n<style>a{}</style ><img src=x onerror="window.__xss=1"><b>后面</b></style>', alts: [] },
  leakFixed: {
    first:
      '<style>.mask{position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgb(255,0,255);z-index:99999}</style><div class="mask">全屏遮罩</div><div style="position:fixed;bottom:0;left:0;width:100vw;height:80px;background:rgb(0,255,255);z-index:99999">底部条</div>正文还在。',
    alts: [],
  },
};

await page.evaluate(
  async ([cards, port]) => {
    const s = window.__rpnowStore.getState();
    const data = await import('/src/core/defaults/sampleData.ts');
    const presets = await import('/src/core/defaults/presets.ts');
    const { buildGreetings } = await import('/src/features/chat/orchestrator.ts');
    await s.savePersona(structuredClone(data.SAMPLE_PERSONA));
    for (const p of presets.BUILTIN_PRESETS) await s.savePreset(structuredClone(p));
    await s.saveLLMConnection({
      id: 'conn_mock',
      name: 'Mock',
      provider: 'custom',
      baseURL: `http://127.0.0.1:${port}/v1`,
      apiKey: 'sk-e2e-secret-do-not-leak',
      defaultModel: 'mock-model',
    });
    s.setSettings({ defaultConnectionId: 'conn_mock', onboardingCompleted: true, defaultPresetId: 'preset:roleplay-default' });
    for (const [key, def] of Object.entries(cards)) {
      const card = structuredClone(data.SAMPLE_CARDS[2]);
      card.id = `card_${key}`;
      card.data.name = key === 'plain' ? '普通开场白' : '属性标签系统';
      card.data.first_mes = def.first;
      card.data.alternate_greetings = def.alts;
      card.data.extensions = {};
      await s.addCard(card);
      await s.saveChat({
        id: `chat_${key}`,
        title: card.data.name,
        cardId: card.id,
        lorebookIds: [],
        useCardLorebook: true,
        personaId: 'persona:sample',
        connectionId: 'conn_mock',
        messages: buildGreetings(card),
        variables: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  },
  [CARDS, PORT],
);

const COMPOSER = 'textarea[aria-label="消息输入框"]';

async function openChat(key) {
  await page.evaluate((id) => window.__rpnowStore.getState().setActiveChat(id), `chat_${key}`);
  await page.waitForSelector(COMPOSER, { timeout: 20000 });
  await page.waitForTimeout(1300);
}

/** 应用自己界面的样式快照：有一项和基准不同，就是卡片样式漏出来了。 */
async function hostStyles() {
  return page.evaluate((sel) => {
    const pick = (el, props) => {
      const cs = getComputedStyle(el);
      const out = {};
      for (const p of props) out[p] = cs.getPropertyValue(p);
      return out;
    };
    const box = (el) => {
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
    };
    const composer = document.querySelector(sel);
    const header = document.querySelector('header');
    const send = document.querySelector('button[aria-label="发送"]');
    const BOX = [
      'background-color',
      'color',
      'padding-top',
      'padding-right',
      'padding-bottom',
      'padding-left',
      'margin-top',
      'margin-right',
      'margin-bottom',
      'margin-left',
      'border-top-width',
      'border-radius',
      'box-sizing',
      'font-size',
      'font-family',
      'line-height',
      'position',
    ];
    return {
      composer: { ...pick(composer, [...BOX, 'resize', 'min-height', 'width']), ...box(composer) },
      header: { ...pick(header, [...BOX, 'height']), ...box(header), top: Math.round(header.getBoundingClientRect().top) },
      send: { ...pick(send, BOX), ...box(send) },
      body: pick(document.body, [...BOX, 'overflow-x', 'overflow-y']),
      html: pick(document.documentElement, [...BOX, 'overflow-x', 'overflow-y', '--ink', '--x']),
      pageScrollWidth: document.documentElement.scrollWidth,
    };
  }, COMPOSER);
}

function diffStyles(a, b) {
  const out = [];
  for (const group of Object.keys(a)) {
    if (typeof a[group] !== 'object') {
      if (a[group] !== b[group]) out.push(`${group}: ${a[group]} → ${b[group]}`);
      continue;
    }
    for (const k of Object.keys(a[group])) {
      if (a[group][k] !== b[group][k]) out.push(`${group}.${k}: ${a[group][k]} → ${b[group][k]}`);
    }
  }
  return out;
}

/** 气泡这一侧（应用页面里）能看到什么。 */
async function bubbleInfo() {
  return page.evaluate(() => {
    const md = document.querySelector('.rp-md.mes_text');
    const frames = [...md.querySelectorAll('iframe')];
    return {
      frames: frames.map((f) => ({
        h: Math.round(f.getBoundingClientRect().height),
        w: Math.round(f.getBoundingClientRect().width),
        sandbox: f.getAttribute('sandbox') ?? '',
        srcdoc: f.hasAttribute('srcdoc'),
        src: f.getAttribute('src') ?? '',
      })),
      inlineControls: md.querySelectorAll('textarea, input, select, form, script').length,
      inlineStyles: md.querySelectorAll('style').length,
      text: md.innerText,
      mdOverflow: md.scrollWidth - md.clientWidth,
      probeInHostStorage: localStorage.getItem('rp_probe'),
    };
  });
}

/** 卡片 iframe（Playwright 能直接进到沙箱 iframe 里操作）。 */
function cardFrame() {
  return page.frames().find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame());
}

async function frameInfo() {
  const f = cardFrame();
  if (!f) return null;
  return f.evaluate(() => {
    const de = document.documentElement;
    const ta = document.querySelector('textarea');
    return {
      chips: document.querySelectorAll('.chip').length,
      chipsOn: [...document.querySelectorAll('.chip.on')].map((c) => c.textContent),
      radios: document.querySelectorAll('input[type=radio]').length,
      textarea: ta ? { w: Math.round(ta.getBoundingClientRect().width), bg: getComputedStyle(ta).backgroundColor } : null,
      buttons: document.querySelectorAll('button').length,
      scene: document.getElementById('scene')?.textContent ?? '',
      out: document.getElementById('out')?.textContent ?? '',
      docHeight: Math.ceil(de.getBoundingClientRect().height),
      overflowX: de.scrollWidth - de.clientWidth,
      viewport: window.innerHeight,
      origin: self.origin,
      probe: JSON.parse(document.body.getAttribute('data-probe') ?? '{}'),
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });
}

async function shot(name) {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

/* ------------------------------------------------------------ 1. 基准 */
console.log('\n1. 基准：纯文字开场白');
await openChat('plain');
const base = await hostStyles();
check('纯文字开场白的聊天能打开', (await bubbleInfo()).text.includes('普通的开场白'));
check('基准：页面没有横向滚动', base.pageScrollWidth === 390, `scrollWidth=${base.pageScrollWidth}`);
await shot('01-plain');

/* ------------------------------------------------------------ 2. 正文 + 页面 */
console.log('\n2. 开场白 = 正文 + 完整 HTML 页面 + 正文');
await openChat('prose');
let b = await bubbleInfo();
let f = await frameInfo();
check('页面装在一个 iframe 里', b.frames.length === 1, JSON.stringify(b.frames));
check('iframe 用 srcdoc，不再是 data: 地址', b.frames[0]?.srcdoc && !b.frames[0]?.src);
check('沙箱没有 allow-same-origin', b.frames[0] && !b.frames[0].sandbox.includes('allow-same-origin'), b.frames[0]?.sandbox);
check('沙箱允许脚本和表单', /allow-scripts/.test(b.frames[0]?.sandbox) && /allow-forms/.test(b.frames[0]?.sandbox));
check('气泡里没有内联的表单控件 / 脚本', b.inlineControls === 0, `count=${b.inlineControls}`);
check('气泡里没有内联的 <style>', b.inlineStyles === 0);
check('页面前面的正文照常显示', b.text.includes(PROSE_BEFORE));
check('页面后面的正文照常显示', b.text.includes(PROSE_AFTER));
check('页面源码没有当成文字露出来', !/<textarea|<input|DOCTYPE|function\s*\(/.test(b.text), b.text.slice(0, 120));
check('脚本在 iframe 里跑起来了：选项生成出来了（5 个）', f?.chips === 5, `chips=${f?.chips}`);
check('单选框在（3 个）', f?.radios === 3);
check('补充输入框在，而且是卡片自己的样式', f?.textarea?.bg === 'rgb(238, 240, 255)', JSON.stringify(f?.textarea));
check('按钮在（换一张、确认开局）', f?.buttons === 2);
check('卡片自己的 body 背景在 iframe 里生效', f?.bodyBg === 'rgb(5, 5, 16)', f?.bodyBg);
check('iframe 高度 = 页面内容高度（不是写死的 320）', Math.abs(b.frames[0].h - f.docHeight) <= 2 && b.frames[0].h > 600, `iframe=${b.frames[0].h} doc=${f.docHeight}`);
check('iframe 里没有竖向滚动条（内容全露出来）', f.viewport >= f.docHeight - 1, `viewport=${f.viewport} doc=${f.docHeight}`);
check('iframe 里没有横向溢出', f.overflowX <= 0, `overflowX=${f.overflowX}`);
check('气泡没有被撑宽', b.mdOverflow <= 0, `overflow=${b.mdOverflow}`);
check('iframe 不超出屏幕宽度', b.frames[0].w <= 390 && b.frames[0].w > 250, `w=${b.frames[0].w}`);
let now = await hostStyles();
let diff = diffStyles(base, now);
check('应用界面样式与基准逐项相同（输入框 / 标题栏 / 发送键 / body / html）', diff.length === 0, diff.join(' | '));
check(
  '输入框没有变白、没有出现拖拽手柄',
  now.composer['background-color'] === base.composer['background-color'] && now.composer.resize === 'none',
  JSON.stringify(now.composer),
);
check('标题栏的上内边距没变（没被 * { padding:0} 清掉）', now.header['padding-top'] === base.header['padding-top'], now.header['padding-top']);
check('页面没有横向滚动', now.pageScrollWidth === 390, `scrollWidth=${now.pageScrollWidth}`);
await shot('02-doc-top');

// 安全：卡片脚本自己试着去碰宿主（探针写在夹具的脚本里）。
check('卡片的来源是独立的空白来源（origin = "null"）', f.origin === 'null', f.origin);
check('卡片脚本读不到应用页面（parent.document）', f.probe.parentDoc === 'blocked', String(f.probe.parentDoc));
check('卡片脚本读不到应用状态（parent.__rpnowStore，里面有 API Key）', f.probe.parentStore === 'blocked', String(f.probe.parentStore));
check('卡片脚本用不了 IndexedDB', f.probe.indexedDB === 'blocked', String(f.probe.indexedDB));
check('卡片脚本读不到 cookie', f.probe.cookie === 'blocked', String(f.probe.cookie));
check('卡片脚本拿不到 iframe 元素（frameElement）', f.probe.frameElement === false || f.probe.frameElement === 'blocked', String(f.probe.frameElement));
check(
  '卡片里的 localStorage 是内存替身，写不进应用的本地存储',
  f.probe.localStorage === '1' && b.probeInHostStorage === null,
  `frame=${f.probe.localStorage} host=${b.probeInHostStorage}`,
);

// 操作表单。
const frame = cardFrame();
await frame.locator('[data-chip="tend:悬疑"]').click();
await frame.locator('input[name=age][value="23-28"]').check();
await frame.locator('#reroll').click();
await frame.locator('#extra').fill('故事在成都');
await page.waitForTimeout(300);
f = await frameInfo();
check('点选项：选中状态变了', f.chipsOn.includes('悬疑') && !f.chipsOn.includes('日常'), f.chipsOn.join(','));
check('点「换一张」：情境换了', f.scene === '清晨地铁', f.scene);
check('单选、输入框的值进了预览', f.out.includes('年龄：23-28') && f.out.includes('补充：故事在成都'), f.out);

// 内容变高 / 变矮，iframe 跟着变。
const hClosed = (await bubbleInfo()).frames[0].h;
await frame.locator('summary').click();
await page.waitForTimeout(700);
const hOpen = (await bubbleInfo()).frames[0].h;
f = await frameInfo();
check('展开折叠块：iframe 变高', hOpen > hClosed + 10, `${hClosed} → ${hOpen}`);
check('展开后 iframe 高度仍等于内容高度', Math.abs(hOpen - f.docHeight) <= 2, `iframe=${hOpen} doc=${f.docHeight}`);
await frame.locator('summary').click();
await page.waitForTimeout(700);
const hBack = (await bubbleInfo()).frames[0].h;
check('收起折叠块：iframe 缩回去', Math.abs(hBack - hClosed) <= 2, `${hOpen} → ${hBack}（原来 ${hClosed}）`);
await frame.evaluate(() => {
  const img = document.createElement('img');
  img.id = 'late';
  img.src =
    'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="red"/></svg>');
  document.querySelector('.wrap').appendChild(img);
});
await page.waitForTimeout(700);
const hImg = (await bubbleInfo()).frames[0].h;
check('图片加载完：iframe 再长高', hImg >= hBack + 140, `${hBack} → ${hImg}`);
await frame.evaluate(() => document.getElementById('late').remove());
await page.waitForTimeout(500);

// 确认开局 → 文字进输入框，不自动发送。
const callsBefore = llmCalls;
await page.locator(COMPOSER).fill('');
await frame.locator('#confirm').click();
await page.waitForTimeout(600);
const staged = await page.locator(COMPOSER).inputValue();
check('点「确认开局」：文字进了聊天输入框', staged.includes('\u3010开局\u3011倾向：悬疑') && staged.includes('补充：故事在成都'), staged);
const composerFit = await page.evaluate((sel) => {
  const el = document.querySelector(sel);
  return { client: el.clientHeight, scroll: el.scrollHeight, lines: el.value.split('\n').length };
}, COMPOSER);
check('输入框跟着长高，放进去的字没有被切掉一半', composerFit.client >= Math.min(composerFit.scroll, 100) - 1 && composerFit.client > 40, JSON.stringify(composerFit));
check('输入框拿到了焦点', await page.evaluate((sel) => document.activeElement === document.querySelector(sel), COMPOSER));
let msgCount = await page.evaluate(() => window.__rpnowStore.getState().chats.find((c) => c.id === 'chat_prose').messages.length);
check('没有自动发送（消息数没变、没有请求模型）', msgCount === 1 && llmCalls === callsBefore, `messages=${msgCount} calls=${llmCalls - callsBefore}`);
await shot('03-doc-staged');

// 输入框里已经有字：接在后面，不覆盖。
await page.locator(COMPOSER).fill('我先写了一句');
await frame.locator('#confirm').click();
await page.waitForTimeout(400);
const appended = await page.locator(COMPOSER).inputValue();
check('输入框里已有的字不会被覆盖', appended.startsWith('我先写了一句\n\u3010开局\u3011'), appended.slice(0, 40));

// 酒馆卡片的老写法：直接去改上层页面的 #send_textarea 再点 #send_but。
// 沙箱里够不到真的页面，桥接脚本给了一个替身。这里是脚本自己调用的（等用户上一次
// 点击过去 5 秒以上，浏览器不再认为「用户刚点过」）：只把字放进输入框、不自动发。
await page.locator(COMPOSER).fill('');
// （测试工具的 evaluate 自带「用户手势」，所以让页面自己用定时器在 5.6 秒后调用。）
await frame.locator('body').evaluate(() => {
  setTimeout(() => {
    const doc = window.parent.document;
    const ta = doc.getElementById('send_textarea');
    ta.value = '酒馆写法：走过去';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    doc.querySelector('#send_but').click();
    window.parent.postMessage({ type: 'resizeIframe', height: 5 }, '*');
    let top = 'reachable';
    try {
      void window.top.document.body;
    } catch {
      top = 'blocked';
    }
    window.__stIdiom = { top, hasBody: Boolean(doc.body && (doc.body.isConnected || doc.body.children.length)), other: doc.getElementById('root') };
  }, 5600);
});
await page.waitForTimeout(6300);
const stIdiom = await frame.locator('body').evaluate(() => window.__stIdiom);
await page.waitForTimeout(400);
check(
  '酒馆写法（parent.document 的 #send_textarea）：字进了输入框',
  (await page.locator(COMPOSER).inputValue()) === '酒馆写法：走过去',
  await page.locator(COMPOSER).inputValue(),
);
check(
  '酒馆写法：不是用户刚点的，#send_but 不会自动发送',
  (await page.evaluate(() => window.__rpnowStore.getState().chats.find((c) => c.id === 'chat_prose').messages.length)) === 1 && llmCalls === callsBefore,
);
check('替身只认输入框和发送键，拿不到真的页面（top 仍被拦）', stIdiom.top === 'blocked' && !stIdiom.hasBody && stIdiom.other === null, JSON.stringify(stIdiom));
await page.locator(COMPOSER).fill('我先写了一句');
await frame.locator('#confirm').click();
await page.waitForTimeout(400);

// 伪造的消息：不是从卡片 iframe 来的，一律不理。
await page.locator(COMPOSER).fill('');
await page.evaluate(() => {
  window.postMessage({ __rpnowCard: 1, type: 'slash', text: '伪造的消息' }, '*');
  window.postMessage({ __rpnowCard: 1, type: 'height', height: 5 }, '*');
});
await page.waitForTimeout(300);
check('应用页面自己发的同样格式的消息不被接受', (await page.locator(COMPOSER).inputValue()) === '');
check('伪造的高度消息改不了 iframe', (await bubbleInfo()).frames[0].h > 600);
// 卡片发来不认识的消息类型：不理。
await frame.evaluate(() => {
  parent.postMessage({ __rpnowCard: 1, type: 'eval', code: 'alert(1)' }, '*');
  parent.postMessage({ __rpnowCard: 1, type: 'slash', text: { evil: true } }, '*');
  parent.postMessage({ __rpnowCard: 1, type: 'height', height: 'tall' }, '*');
});
await page.waitForTimeout(300);
check('卡片发来不认识的消息：输入框不变、高度不变', (await page.locator(COMPOSER).inputValue()) === '' && (await bubbleInfo()).frames[0].h > 600);

// 用户自己点发送。
await frame.locator('#confirm').click();
await page.waitForTimeout(400);
await page.locator('button[aria-label="发送"]').click();
let replied = false;
for (let i = 0; i < 40 && !replied; i++) {
  await page.waitForTimeout(400);
  replied = (await page.locator('text=收到，故事开始。').count()) >= 1;
}
check('用户点发送后：消息发出、模型回复出现', replied);
const msgs = await page.evaluate(() =>
  window.__rpnowStore
    .getState()
    .chats.find((c) => c.id === 'chat_prose')
    .messages.map((m) => ({ role: m.role, content: m.content.slice(0, 30) })),
);
check('发出去的是表单拼出来的那句话', msgs[1]?.role === 'user' && msgs[1].content.startsWith('\u3010开局\u3011'), JSON.stringify(msgs[1]));
check('发送之后卡片 iframe 还在、表单状态没丢', (await frameInfo())?.chipsOn.includes('悬疑') === true);
await shot('04-doc-sent');

/* ------------------------------------------------------------ 3. 切换开场白 */
console.log('\n3. 切换开场白');
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  const chat = s.chats.find((c) => c.id === 'chat_prose');
  await s.saveChat({ ...chat, messages: chat.messages.slice(0, 1) });
});
await page.waitForTimeout(600);
const next = page.locator('button[aria-label="下一个版本"]').first();
const prev = page.locator('button[aria-label="上一个版本"]').first();
check('开场白有切换按钮', (await next.count()) === 1);
await next.click();
await page.waitForTimeout(900);
b = await bubbleInfo();
check('切到第 2 个开场白（纯文字）：iframe 没了，文字出来了', b.frames.length === 0 && b.text.includes('第二个开场白'), b.text.slice(0, 40));
diff = diffStyles(base, await hostStyles());
check('切换后应用界面样式仍与基准相同', diff.length === 0, diff.join(' | '));
await next.click();
await page.waitForTimeout(1300);
b = await bubbleInfo();
f = await frameInfo();
check('切到第 3 个开场白（只有页面）：iframe 出来、选项在', b.frames.length === 1 && f?.chips === 5, `frames=${b.frames.length} chips=${f?.chips}`);
await prev.click();
await page.waitForTimeout(600);
await prev.click();
await page.waitForTimeout(1300);
b = await bubbleInfo();
f = await frameInfo();
check('切回第 1 个：页面重新装好，表单能用', b.frames.length === 1 && f?.chips === 5 && b.text.includes(PROSE_BEFORE));
check('切回来之后高度仍然贴合内容', Math.abs(b.frames[0].h - f.docHeight) <= 2, `iframe=${b.frames[0].h} doc=${f.docHeight}`);

/* ------------------------------------------------------------ 4. 其它写法 */
console.log('\n4. 其它写法的开场白');
const EXPECT_PROSE = { docOnly: false, docInline: true, docFenced: true, fragment: true, bodyOnly: false };
for (const key of Object.keys(EXPECT_PROSE)) {
  await openChat(key);
  b = await bubbleInfo();
  f = await frameInfo();
  const label = {
    docOnly: '只有页面',
    docInline: '正文和页面粘在一行',
    docFenced: '页面包在 ```html 里',
    fragment: '没有 <html> 的片段（<style> + 结构 + <script>）',
    bodyOnly: '只有 <body>',
  }[key];
  check(
    `${label}：一个 iframe，表单能用`,
    b.frames.length === 1 && f?.chips === 5 && f?.radios === 3 && Boolean(f?.textarea),
    `frames=${b.frames.length} ${JSON.stringify(f)?.slice(0, 120)}`,
  );
  check(
    `${label}：高度贴合内容，没有横向溢出`,
    f && Math.abs(b.frames[0].h - f.docHeight) <= 2 && b.frames[0].h > 600 && f.overflowX <= 0 && b.mdOverflow <= 0,
    `iframe=${b.frames[0]?.h} doc=${f?.docHeight}`,
  );
  if (EXPECT_PROSE[key]) {
    check(
      `${label}：前后正文都在，没有残留的 \`\`\` 或标签`,
      b.text.includes(PROSE_BEFORE) && b.text.includes(PROSE_AFTER) && !/```|<\/?html|DOCTYPE/i.test(b.text),
      b.text.slice(0, 100),
    );
  } else {
    check(`${label}：气泡里没有多余文字`, b.text.trim() === '', b.text.slice(0, 60));
  }
  check(`${label}：气泡里没有内联控件`, b.inlineControls === 0);
  diff = diffStyles(base, await hostStyles());
  check(`${label}：应用界面样式与基准相同`, diff.length === 0, diff.join(' | '));
  check(`${label}：卡片脚本碰不到应用`, f?.origin === 'null' && f?.probe.parentDoc === 'blocked' && f?.probe.parentStore === 'blocked');
}
await openChat('fragment');
await shot('05-fragment');

/* ------------------------------------------------------------ 5. 内联渲染钻不出去 */
console.log('\n5. 留在气泡里的 HTML 钻不出去');
await openChat('leakUnclosed');
b = await bubbleInfo();
diff = diffStyles(base, await hostStyles());
check('<style> 没写收尾：样式不漏到应用界面', diff.length === 0, diff.join(' | '));
check('<style> 没写收尾：正文照常显示，没有 iframe', b.frames.length === 0 && b.text.includes('没收尾的样式'));
const scoped = await page.evaluate(() => [...document.querySelectorAll('.rp-md.mes_text style')].map((s) => s.textContent).join('\n'));
check(
  '<style> 没写收尾：规则都挂在.rp-md 下面',
  scoped.includes('.rp-md textarea{') && scoped.includes('.rp-md *{') && !/(^|\})\s*textarea\{/.test(scoped),
  scoped.slice(0, 160),
);

await openChat('leakMedia');
diff = diffStyles(base, await hostStyles());
check('@media / @supports 里的规则（带!important）：不漏到应用界面', diff.length === 0, diff.join(' | '));

await openChat('leakXss');
await page.waitForTimeout(500);
check('</style > 提前收尾：后面的内容不会变成能执行的 HTML', (await page.evaluate(() => window.__xss)) === undefined);
diff = diffStyles(base, await hostStyles());
check('</style > 提前收尾：应用界面样式与基准相同', diff.length === 0, diff.join(' | '));

await openChat('leakFixed');
const fixed = await page.evaluate(() => {
  const md = document.querySelector('.rp-md.mes_text');
  const mdBox = md.getBoundingClientRect();
  const mask = md.querySelector('.custom-mask');
  const bar = md.querySelector('div[style]');
  const hit = (x, y) => {
    const el = document.elementFromPoint(x, y);
    return el ? { tag: el.tagName, inBubble: md.contains(el) } : null;
  };
  const r = (el) => {
    const q = el.getBoundingClientRect();
    return { l: Math.round(q.left), r: Math.round(q.right), t: Math.round(q.top), b: Math.round(q.bottom) };
  };
  return {
    maskPos: getComputedStyle(mask).position,
    barPos: getComputedStyle(bar).position,
    mask: r(mask),
    bar: r(bar),
    md: { l: Math.round(mdBox.left), r: Math.round(mdBox.right) },
    header: hit(195, 28),
    composer: hit(195, 800),
    menu: hit(30, 28),
    text: md.innerText,
  };
});
check('position:fixed（样式表里）改成了 absolute', fixed.maskPos === 'absolute', fixed.maskPos);
check('position:fixed（style 属性里）改成了 absolute', fixed.barPos === 'absolute', fixed.barPos);
check('100vw 的面板没有宽过气泡', fixed.mask.r <= fixed.md.r + 1 && fixed.bar.r <= fixed.md.r + 1, JSON.stringify(fixed));
check('全屏遮罩盖不到标题栏', fixed.header && !fixed.header.inBubble && fixed.menu && !fixed.menu.inBubble, JSON.stringify(fixed.header));
check('底部条盖不到输入框', fixed.composer && !fixed.composer.inBubble, JSON.stringify(fixed.composer));
diff = diffStyles(base, await hostStyles());
check('fixed / 100vw 面板：应用界面样式与基准相同', diff.length === 0, diff.join(' | '));
await shot('06-inline-fixed');

/* ------------------------------------------------------------ 6. 关掉沙箱 */
console.log('\n6. 设置里关掉「沙箱 HTML」：整页照样进 iframe（不再依赖这个开关）');
await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  s.setSettings({ render: { ...s.settings.render, sandboxHtml: false } });
});
await openChat('prose');
b = await bubbleInfo();
check('关掉沙箱：整页仍然装在 iframe 里', b.frames.length === 1 && b.frames[0].srcdoc && !/allow-same-origin/.test(b.frames[0].sandbox), JSON.stringify(b.frames));
check('关掉沙箱：页面里的脚本照常跑（选项出来了）', (await frameInfo())?.chips === 5, JSON.stringify(await frameInfo()));
check('关掉沙箱：气泡里没有半残的表单控件、没有内联样式块', b.inlineControls === 0 && b.inlineStyles === 0, `controls=${b.inlineControls} styles=${b.inlineStyles}`);
check('关掉沙箱：控件不再显示成一串 <input …> 文字', !/<input|<textarea/.test(b.text), b.text.slice(0, 200));
diff = diffStyles(base, await hostStyles());
check('关掉沙箱：卡片样式仍然漏不到应用界面', diff.length === 0, diff.join(' | '));
check('关掉沙箱：气泡没有被撑宽', b.mdOverflow <= 0 && (await hostStyles()).pageScrollWidth === 390, `overflow=${b.mdOverflow}`);
await shot('07-sandbox-off');
await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  s.setSettings({ render: { ...s.settings.render, sandboxHtml: true } });
});

/* ------------------------------------------------------------ 7. 流式输出 */
console.log('\n7. 模型回复里带页面（流式输出）');
await openChat('plain');
await page.locator(COMPOSER).fill('来个面板');
await page.locator(COMPOSER).press('Enter');
let streamed = false;
for (let i = 0; i < 60 && !streamed; i++) {
  await page.waitForTimeout(400);
  streamed = await page.evaluate(() => {
    const s = window.__rpnowStore.getState();
    const chat = s.chats.find((c) => c.id === 'chat_plain');
    const last = chat.messages[chat.messages.length - 1];
    return last.role === 'assistant' && last.content.includes('看完告诉我') && document.querySelectorAll('.rp-md.mes_text iframe').length === 1;
  });
}
check('流式输出结束后：回复里的页面装进了 iframe', streamed);
await page.waitForTimeout(1200);
const streamInfo = await page.evaluate(() => {
  const mds = [...document.querySelectorAll('.rp-md.mes_text')];
  const md = mds[mds.length - 1];
  const fr = md.querySelector('iframe');
  return { text: md.innerText, h: fr ? Math.round(fr.getBoundingClientRect().height) : 0, controls: md.querySelectorAll('textarea,input,script').length };
});
f = await frameInfo();
check('流式：页面前后的正文都在', streamInfo.text.includes('面板来了。') && streamInfo.text.includes('看完告诉我。'), streamInfo.text.slice(0, 80));
check('流式：表单能用、高度贴合内容', f?.chips === 5 && Math.abs(streamInfo.h - f.docHeight) <= 2, `iframe=${streamInfo.h} doc=${f?.docHeight}`);
diff = diffStyles(base, await hostStyles());
check('流式：应用界面样式与基准相同', diff.length === 0, diff.join(' | '));

/* ------------------------------------------------------------ 8. 模板卡片 */
console.log('\n8. 模板卡片（TemplateCard）共用同一套沙箱');
const tpl = await page.evaluate(async () => {
  const { buildTemplateDocument } = await import('/src/components/chat/TemplateCard.tsx');
  const { FRAME_SANDBOX } = await import('/src/core/render/htmlDocument.ts');
  const doc = buildTemplateDocument(
    {
      id: 't',
      name: 't',
      htmlTemplate:
        '<button id="go" data-slash="模板按钮">点我</button><script>var r={};try{r.parent=!!parent.document.body}catch(e){r.parent="blocked"}try{r.ls=parent.localStorage.length}catch(e){r.ls="blocked"}parent.postMessage({__tplProbe:r},"*")<\/script>',
    },
    {},
  );
  const got = [];
  window.addEventListener('message', (e) => {
    if (e.data && (e.data.__rpnowTemplate || e.data.__tplProbe)) got.push({ ...e.data, origin: e.origin });
  });
  const fr = document.createElement('iframe');
  fr.id = 'tpl-test';
  fr.setAttribute('sandbox', FRAME_SANDBOX);
  fr.srcdoc = doc;
  fr.style.cssText = 'position:fixed;left:0;bottom:0;width:200px;height:60px;z-index:99999';
  document.body.appendChild(fr);
  window.__tplGot = got;
  return FRAME_SANDBOX;
});
await page.waitForTimeout(800);
const tplFrame = page.frames().find((x) => x.name() === '' && x !== page.mainFrame() && x.url() === 'about:srcdoc' && x !== cardFrame());
await page.frameLocator('#tpl-test').locator('#go').click();
await page.waitForTimeout(400);
const tplGot = await page.evaluate(() => window.__tplGot);
const tplProbe = tplGot.find((m) => m.__tplProbe)?.__tplProbe;
check('模板卡片的沙箱也没有 allow-same-origin', !tpl.includes('allow-same-origin') && Boolean(tplFrame || true));
check('模板脚本读不到应用页面和本地存储', tplProbe?.parent === 'blocked' && tplProbe?.ls === 'blocked', JSON.stringify(tplProbe));
check(
  '模板卡片的高度消息带上了 type（以前漏了，高度永远不更新）',
  tplGot.some((m) => m.type === 'height' && typeof m.height === 'number'),
  JSON.stringify(tplGot).slice(0, 200),
);
check(
  '模板卡片的 data-slash 点击消息带上了 type',
  tplGot.some((m) => m.type === 'slash' && m.text === '模板按钮'),
  JSON.stringify(tplGot).slice(0, 200),
);
await page.evaluate(() => document.getElementById('tpl-test').remove());

/* ------------------------------------------------------------ 收尾 */
console.log('\n9. 预设正则面板（思维链折叠这类：页面开头 + <game> 正文 + ```html 面板）');
const presetShape = await page.evaluate(async () => {
  const { defaultRenderer } = await import('/src/core/render/renderer.ts');
  const page1 = '<!DOCTYPE html>\n<html><head><style>body{color:pink}</style></head><body><details><summary>思考</summary>想一想</details></body></html>';
  const panel = '```html\n<!DOCTYPE html>\n<html><body><button>走过去</button></body></html>\n```';
  const read = (md) => {
    const d = document.createElement('div');
    d.innerHTML = defaultRenderer.render(md, { styleScope: '.rp-md', sandboxHtml: true });
    const frames = d.querySelectorAll('iframe[data-rp-card]').length;
    d.querySelectorAll('iframe').forEach((f) => f.remove());
    return { frames, prose: d.textContent.replace(/\s+/g, ' ').trim() };
  };
  return {
    lead: read(`${page1}\n\n<game>\n正午的阳光。\n</game>\n\n${panel}`),
    noLead: read(`<game>\n正午的阳光。\n</game>\n\n${panel}`),
    codeMention: read('代码：\n\njs\nconst a = "<html>";\n\n结束。'),
  };
});
check('折叠栏和选项面板各装一个 iframe', presetShape.lead.frames === 2, JSON.stringify(presetShape.lead));
check('中间的正文回到气泡里，<game> 标记不露出来、也没有残留的 ```', presetShape.lead.prose === '正午的阳光。', presetShape.lead.prose);
check(
  '没有折叠栏开头时：<game> 照旧原样显示（和以前一致）',
  presetShape.noLead.frames === 1 && presetShape.noLead.prose.includes('<game>'),
  JSON.stringify(presetShape.noLead),
);
check(
  '正文里只是提到 "<html>"：不会被当成页面',
  presetShape.codeMention.frames === 0 && presetShape.codeMention.prose.includes('结束。'),
  JSON.stringify(presetShape.codeMention),
);

console.log('\n10. 测试中顺手发现的：[M12] 引用标记');
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  const base = s.chats.find((c) => c.id === 'chat_plain');
  const messages = structuredClone(base.messages);
  messages[0].content = '她记得这件事 [M3]，不会忘。';
  if (Array.isArray(messages[0].swipes)) messages[0].swipes = [messages[0].content];
  await s.saveChat({ ...structuredClone(base), id: 'chat_cite', messages });
  window.__rpnowStore.getState().setActiveChat('chat_cite');
});
await page.waitForTimeout(900);
const cite = await page.evaluate(() => ({ n: document.querySelectorAll('.rp-md .rp-cite').length, t: document.querySelector('.rp-md .rp-cite')?.textContent }));
check('正文里的 [M3] 变成可点的引用按钮（以前判断写错，永远不出现）', cite.n === 1 && cite.t === '[M3]', JSON.stringify(cite));

/* ------------------------------------------------------------ 11. 卡片正则产出整页 */
console.log('\n11. 卡片正则把 <AttrTagOpening/> 换成整页（真卡的写法）');

/** 建一张「开场白只有一个标签、正则把它换成整页」的卡并打开。 */
async function openRegexCard(key, { first = OPENING_TAG, alts = [], replace, script = {} }) {
  await page.evaluate(
    async ([key, first, alts, regexScript]) => {
      const s = window.__rpnowStore.getState();
      const data = await import('/src/core/defaults/sampleData.ts');
      const { buildGreetings } = await import('/src/features/chat/orchestrator.ts');
      const card = structuredClone(data.SAMPLE_CARDS[2]);
      card.id = `card_rx_${key}`;
      card.data.name = '属性标签系统';
      card.data.first_mes = first;
      card.data.alternate_greetings = alts;
      card.data.extensions = { regex_scripts: [regexScript] };
      await s.addCard(card);
      await s.saveChat({
        id: `chat_rx_${key}`,
        title: card.data.name,
        cardId: card.id,
        lorebookIds: [],
        useCardLorebook: true,
        personaId: 'persona:sample',
        connectionId: 'conn_mock',
        messages: buildGreetings(card),
        variables: {},
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
      s.setActiveChat(`chat_rx_${key}`);
    },
    [key, first, alts, openingRegexScript(replace, script)],
  );
  await page.waitForSelector(COMPOSER, { timeout: 20000 });
  await page.waitForTimeout(900);
}

/** 气泡里、iframe 外面还剩什么。 */
async function regexBubble() {
  return page.evaluate(() => {
    const md = document.querySelector('.rp-md.mes_text');
    const frames = [...md.querySelectorAll('iframe')];
    const clone = md.cloneNode(true);
    clone.querySelectorAll('iframe').forEach((f) => f.remove());
    return {
      frames: frames.length,
      frameH: frames[0] ? Math.round(frames[0].getBoundingClientRect().height) : 0,
      frameW: frames[0] ? Math.round(frames[0].getBoundingClientRect().width) : 0,
      isolated: frames.every((f) => f.hasAttribute('srcdoc') && !/allow-same-origin/.test(f.getAttribute('sandbox') ?? '')),
      pre: md.querySelectorAll('pre, code').length,
      controls: md.querySelectorAll('textarea, input, select, form, script, button').length,
      styles: md.querySelectorAll('style').length,
      dead: md.querySelectorAll('.rp-card-dead').length,
      outside: clone.textContent.replace(/\s+/g, ' ').trim(),
      mdOverflow: md.scrollWidth - md.clientWidth,
    };
  });
}

/** iframe 里面：脚本跑了没、选项出来没、认没认出自己在酒馆里。 */
async function openingFrame() {
  const f = cardFrame();
  if (!f) return null;
  return f.evaluate(() => {
    const de = document.documentElement;
    const vis = (el) => Boolean(el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0);
    return {
      ready: de.getAttribute('data-ready'),
      inTavern: de.classList.contains('in-tavern'),
      theme: de.getAttribute('data-theme'),
      chips: document.querySelectorAll('.chip').length,
      chipsVisible: [...document.querySelectorAll('.chip')].every(vis),
      tools: document.querySelectorAll('.preview-tools').length,
      textarea: vis(document.getElementById('extra')),
      confirm: vis(document.getElementById('confirm')),
      reroll: vis(document.getElementById('reroll')),
      scene: document.getElementById('scene')?.textContent ?? '',
      out: document.getElementById('out')?.textContent ?? '',
      state: document.getElementById('state')?.textContent ?? '',
      docHeight: Math.ceil(de.getBoundingClientRect().height),
      overflowX: de.scrollWidth - de.clientWidth,
      bodyBg: getComputedStyle(document.body).backgroundColor,
      origin: self.origin,
    };
  });
}

const rxMessages = (key) =>
  page.evaluate((id) => window.__rpnowStore.getState().chats.find((c) => c.id === id).messages.map((m) => ({ role: m.role, content: m.content })), `chat_rx_${key}`);

async function waitReply(key, count) {
  for (let i = 0; i < 50; i++) {
    const m = await rxMessages(key);
    if (m.length >= count && m[count - 1].role === 'assistant' && m[count - 1].content.includes('故事开始')) return m;
    await page.waitForTimeout(300);
  }
  return rxMessages(key);
}

const hostDark = await page.evaluate(() => document.documentElement.classList.contains('dark'));
const SHAPES = openingShapes({ detect: 'context', send: 'slash' });
const PROSE_SHAPES = new Set(['real_fence_multiline', 'real_fence_oneline', 'real_fence_oneline_newline_close', 'real_fence_first_line_glued', 'a_raw', 'i_fence_crlf', 'k_backticks_and_macros']);
let shapeNo = 0;
for (const [name, replace] of Object.entries(SHAPES)) {
  shapeNo++;
  const variants = [{ tag: '只有标签', first: OPENING_TAG, prose: '' }];
  if (PROSE_SHAPES.has(name)) variants.push({ tag: '前后有正文', first: `欢迎来到这里。\n\n${OPENING_TAG}\n\n后面还有一句正文。`, prose: '欢迎来到这里。 后面还有一句正文。' });
  for (const v of variants) {
    const key = `${name}_${v.prose ? 'p' : 'o'}`;
    await openRegexCard(key, { first: v.first, replace });
    const rb = await regexBubble();
    const fr = await openingFrame();
    const label = `[${name} · ${v.tag}]`;
    check(
      `${label} 整页在一个隔离 iframe 里，气泡里没有代码块、没有散落的页面`,
      rb.frames === 1 && rb.isolated && rb.pre === 0 && rb.controls === 0 && rb.styles === 0 && rb.outside === v.prose && rb.dead === 0,
      JSON.stringify(rb),
    );
    check(
      `${label} 脚本跑了：选项 8 个都在、认出在酒馆里、预览按钮已移除、输入框和按钮可见`,
      fr && fr.ready === '1' && fr.inTavern && fr.chips === 8 && fr.chipsVisible && fr.tools === 0 && fr.textarea && fr.confirm && fr.reroll && fr.origin === 'null',
      JSON.stringify(fr),
    );
    check(
      `${label} 高度跟着内容、不横向溢出、应用界面样式没变`,
      fr && rb.frameH >= 400 && Math.abs(rb.frameH - fr.docHeight) <= 2 && fr.overflowX <= 0 && rb.mdOverflow <= 0 && diffStyles(base, await hostStyles()).length === 0,
      JSON.stringify({ frameH: rb.frameH, doc: fr?.docHeight, ox: fr?.overflowX, diff: diffStyles(base, await hostStyles()) }),
    );
    if (name === 'real_fence_multiline' || name === 'real_fence_oneline') await shot(`11-${name}-${v.prose ? 'prose' : 'only'}`);
  }
}
check('形状覆盖：真卡三种写法 + a–m 全部跑到', shapeNo >= 26, `shapes=${shapeNo}`);

// 主题跟着应用走、底色透明（html.in-tavern body{background:transparent}）。
await openRegexCard('theme', { replace: SHAPES.real_fence_multiline });
let fr = await openingFrame();
check('页面拿到应用的主题（data-theme），底色透明', fr?.theme === (hostDark ? 'dark' : 'light') && /rgba\(0, 0, 0, 0\)|transparent/.test(fr?.bodyBg ?? ''), JSON.stringify({ theme: fr?.theme, bg: fr?.bodyBg, hostDark }));
await page.evaluate(() => document.documentElement.classList.toggle('dark'));
await openRegexCard('theme2', { replace: SHAPES.real_fence_multiline });
fr = await openingFrame();
check('应用换了深浅色，新渲染的页面跟着换', fr?.theme === (hostDark ? 'light' : 'dark'), JSON.stringify({ theme: fr?.theme }));
await shot('11-theme-flipped');
await page.evaluate(() => document.documentElement.classList.toggle('dark'));

// 正则的几种设置：placement [1,2]、markdownOnly 关。
await openRegexCard('placement', { replace: SHAPES.real_fence_multiline, script: { placement: [1, 2], markdownOnly: false } });
check('placement [1,2] + markdownOnly 关：同样整页进 iframe', (await regexBubble()).frames === 1 && (await openingFrame())?.chips === 8);

// 备选开场白里也是这个标签：切换过去照样是整页。
await openRegexCard('swipe', { first: '第一个开场白，纯文字。', alts: [OPENING_TAG], replace: SHAPES.real_fence_oneline });
await page.locator('button[aria-label="下一个版本"]').first().click();
await page.waitForTimeout(1100);
let rb = await regexBubble();
check('切到带标签的备选开场白：整页进 iframe、选项在', rb.frames === 1 && rb.pre === 0 && rb.outside === '' && (await openingFrame())?.chips === 8, JSON.stringify(rb));
await page.locator('button[aria-label="上一个版本"]').first().click();
await page.waitForTimeout(900);
rb = await regexBubble();
check('切回纯文字开场白：iframe 没了、正文在', rb.frames === 0 && rb.outside.includes('第一个开场白'), JSON.stringify(rb));

// 设置里关掉「沙箱 HTML」（老用户存下来的设置可能就是关的）：不影响整页隔离。
await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  s.setSettings({ render: { ...s.settings.render, sandboxHtml: false } });
});
for (const name of ['real_fence_multiline', 'real_fence_oneline', 'a_raw', 'h_indent_spaces', 'i_fence_crlf']) {
  await openRegexCard(`nosb_${name}`, { first: `欢迎来到这里。\n\n${OPENING_TAG}\n\n后面还有一句正文。`, replace: SHAPES[name] });
  rb = await regexBubble();
  fr = await openingFrame();
  check(
    `[${name}] 关掉「沙箱 HTML」：照样整页进 iframe、选项在、样式不外漏`,
    rb.frames === 1 && rb.isolated && rb.pre === 0 && rb.controls === 0 && rb.styles === 0 && rb.outside === '欢迎来到这里。 后面还有一句正文。' && fr?.chips === 8 && diffStyles(base, await hostStyles()).length === 0,
    JSON.stringify(rb),
  );
}
await shot('11-sandbox-off');
await page.evaluate(() => {
  const s = window.__rpnowStore.getState();
  s.setSettings({ render: { ...s.settings.render, sandboxHtml: true } });
});

// 页面里的每个控件都点得动；确认开局（用户亲手点的）直接发进聊天。
await openRegexCard('click', { replace: SHAPES.real_fence_multiline });
let oframe = cardFrame();
await oframe.locator('[data-chip="tend:悬疑"]').click();
await oframe.locator('[data-chip="mode:完整"]').click();
const sceneBefore = (await openingFrame()).scene;
await oframe.locator('#reroll').click();
await oframe.locator('#extra').fill('故事在成都');
await page.waitForTimeout(300);
fr = await openingFrame();
check('选项点得动、「换一张」换了情境、补充能输入', fr.out.includes('倾向：悬疑') && fr.out.includes('模式：完整') && fr.scene !== sceneBefore && fr.out.includes('补充：故事在成都'), fr.out);
check('页面读到了用户名（SillyTavern.getContext().name1）', /我是(?!你$).+/.test(fr.out) && !fr.out.endsWith('我是你'), fr.out);
await shot('11-before-confirm');
let callsAt = llmCalls;
await oframe.locator('#confirm').click();
let sent = await waitReply('click', 3);
check(
  '点「确认开局」：消息直接发进聊天，内容是页面拼出来的那句',
  sent.length >= 3 && sent[1].role === 'user' && sent[1].content.startsWith('倾向：悬疑；') && sent[1].content.includes('补充：故事在成都') && !sent[1].content.includes('/send') && !sent[1].content.includes('/trigger'),
  JSON.stringify(sent[1] ?? null),
);
check('模型回复出现、输入框是空的', sent[2]?.role === 'assistant' && llmCalls > callsAt && (await page.locator(COMPOSER).inputValue()) === '', `calls=${llmCalls - callsAt}`);
check('发出之后页面还在、显示「已发出」', (await openingFrame())?.state === '已发出' && (await regexBubble()).frames === 1);
await shot('11-after-confirm');

// 酒馆卡常见的每一种「发消息」写法 × 每一种「我在不在酒馆里」的判断。
let kindNo = 0;
for (const send of SEND_KINDS) {
  const detect = DETECT_KINDS[kindNo % DETECT_KINDS.length];
  kindNo++;
  const key = `send_${send}`;
  await openRegexCard(key, { replace: '```html\n' + openingPage({ detect, send }) + '\n```' });
  fr = await openingFrame();
  check(`[发送写法 ${send} · 判断写法 ${detect}] 页面脚本跑完、认出在酒馆里`, fr?.ready === '1' && fr.inTavern && fr.chips === 8 && fr.tools === 0, JSON.stringify(fr));
  callsAt = llmCalls;
  await cardFrame().locator('#confirm').click();
  if (send === 'setinput') {
    await page.waitForTimeout(700);
    const staged = await page.locator(COMPOSER).inputValue();
    check('[发送写法 setinput] /setinput 只把文字放进输入框，不发送', staged.startsWith('倾向：日常；') && (await rxMessages(key)).length === 1 && llmCalls === callsAt, staged.slice(0, 40));
    await page.locator(COMPOSER).fill('');
    continue;
  }
  sent = await waitReply(key, 3);
  check(
    `[发送写法 ${send}] 用户点确认：消息发进聊天、模型回复`,
    sent.length >= 3 && sent[1].role === 'user' && sent[1].content.startsWith('倾向：日常；') && sent[2].role === 'assistant' && (await openingFrame())?.state === '已发出',
    JSON.stringify({ n: sent.length, user: sent[1]?.content?.slice(0, 40), state: (await openingFrame())?.state }),
  );
}

// 页面一加载就自己调用发送（没有用户点击）：只放进输入框，不替用户发。
await page.locator(COMPOSER).fill('');
callsAt = llmCalls;
await openRegexCard('auto', { replace: '```html\n' + openingPage({ detect: 'context', send: 'slash', autoSend: true }) + '\n```' });
await page.waitForTimeout(900);
check(
  '页面自己偷偷调用发送：只把文字放进输入框，没有发出去、没有请求模型',
  (await page.locator(COMPOSER).inputValue()).startsWith('倾向：日常；') && (await rxMessages('auto')).length === 1 && llmCalls === callsAt,
  `composer=${(await page.locator(COMPOSER).inputValue()).slice(0, 30)} calls=${llmCalls - callsAt}`,
);
await page.locator(COMPOSER).fill('');

// 页面调用了桥里没有的接口：不报错、脚本照常跑完，控制台留一行记录。
const bridgeLogs = [];
page.on('console', (m) => {
  if (m.text().includes('[RPNow 卡片桥]')) bridgeLogs.push(m.text());
});
const unknownPage = openingPage({ detect: 'context', send: 'slash' }).replace(
  'var pools =',
  "SillyTavern.getContext().someFutureApi(1); TavernHelper.notThere(); window.parent.somethingElse; $('#tend').fadeIn(); var pools =",
);
await openRegexCard('unknown', { replace: '```html\n' + unknownPage + '\n```' });
fr = await openingFrame();
check('调用不认识的接口：页面脚本照常跑完（选项都在）', fr?.ready === '1' && fr.chips === 8, JSON.stringify(fr));
check(
  '不认识的调用在控制台留下「[RPNow 卡片桥]」记录',
  ['someFutureApi', 'notThere', 'somethingElse', 'fadeIn'].every((n) => bridgeLogs.some((l) => l.includes(n))),
  bridgeLogs.join(' | ').slice(0, 300),
);

// 页面脚本根本没跑（被安全策略拦了）时，不能悄悄坏掉：给出说明。
await openRegexCard('dead', { replace: SHAPES.real_fence_multiline });
await page.evaluate(() => {
  const holder = document.querySelector('.rp-md.mes_text .rp-html-card');
  const f = document.createElement('iframe');
  f.setAttribute('data-rp-card', '1');
  f.setAttribute('sandbox', '');
  f.setAttribute('srcdoc', '<!doctype html><html><body><p>脚本被拦的页面</p><script>parent.postMessage({__rpnowCard:1,type:"ready"},"*")</script></body></html>');
  f.id = 'dead-probe';
  const box = document.createElement('div');
  box.className = 'rp-html-card';
  box.appendChild(f);
  holder.parentElement.appendChild(box);
});
await page.waitForTimeout(3400);
const dead = await page.evaluate(() => {
  const f = document.getElementById('dead-probe');
  const live = document.querySelector('.rp-md.mes_text .rp-html-card iframe:not(#dead-probe)');
  return { dead: f.dataset.rpDead, h: f.style.height, note: f.parentElement.querySelector('.rp-card-dead')?.textContent ?? '', liveDead: live.dataset.rpDead ?? '', notes: document.querySelectorAll('.rp-card-dead').length };
});
check('脚本没跑的页面：给固定高度并写明原因；正常的页面不受影响', dead.dead === '1' && dead.h === '480px' && dead.note.includes('脚本没有运行') && dead.liveDead === '' && dead.notes === 1, JSON.stringify(dead));

console.log('\n12. 收尾');
check('整个过程应用页面没有抛出脚本错误', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
// 每次发送除了正文回复，应用还会自己发后台请求（标题、记忆摘要之类），所以不卡死次数。
check('模型请求全部进了假模型（没有真实接口可用）', llmCalls >= 2, `calls=${llmCalls}`);

await browser.close();
mock.close();
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
