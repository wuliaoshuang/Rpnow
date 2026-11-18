/**
 * 真机端到端：安装酒馆助手 → 校验设置容器可见 → 校验前端文档被 TH 接管渲染。
 *
 * 背景（docs/research/rpnow-st-compat-contract.md）：
 *  - 楼层契约 M1-M4：`#chat > .mes[mesid]` / `.mes_text` / `pre>code`；
 *  - 设置契约 M7：`#extensions_settings` 必须可见（此前被 append 进 overflow:hidden
 *    的 main，用户看不到）；
 *  - TH 契约：扫描 `pre>code` 文本命中 `Ck`（html>/<head>/<body）→ 包 `div.TH-render`
 *    + `iframe#TH-message--<mesid>--<idx>`。
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE = 'http://127.0.0.1:9222';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' -- ' + detail : ''}`);
};

const browser = await chromium.connectOverCDP(BASE);
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) {
  console.log('no page');
  process.exit(1);
}
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));

await page.waitForTimeout(800);

/** 通过文本点击页面上的按钮（release 构建无法 import 源码）。 */
async function clickByText(text, timeout = 8000) {
  const ok = await page.evaluate((t) => {
    const btn = [...document.querySelectorAll('button,a,[role="button"]')].find(
      (b) => (b.textContent || '').includes(t) && !b.disabled,
    );
    if (!btn) return false;
    btn.click();
    return true;
  }, text);
  await page.waitForTimeout(timeout > 1000 ? 900 : timeout);
  return ok;
}

const state = () =>
  page.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    const ext = document.getElementById('extensions_settings');
    const th = document.getElementById('tavern_helper');
    const chat = document.getElementById('chat');
    const mes = chat ? Array.from(chat.querySelectorAll(':scope > .mes')) : [];
    return {
      mainText: (document.querySelector('main')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 300),
      hasExtensionsSurface: !!ext,
      extVisible: vis(ext),
      extChildren: ext ? ext.children.length : 0,
      thMounted: !!th,
      thChildren: th ? th.querySelectorAll('*').length : 0,
      directMes: mes.length,
      mesText: mes.filter((m) => m.querySelector('.mes_text')).length,
      preCode: mes.filter((m) => m.querySelector('.mes_text pre > code')).length,
      thRender: document.querySelectorAll('.TH-render iframe').length,
      thIds: Array.from(document.querySelectorAll('.TH-render iframe')).map((f) => f.id).slice(0, 3),
    };
  });

// ---------------------------------------------------------------- 1. 装 TH
let s0 = await state();
check('起始进入应用', s0.mainText.length > 0, s0.mainText.slice(0, 40));

const clickedPlugins = await clickByText('插件');
await page.waitForTimeout(1200);
s0 = await state();
check('到达插件页', s0.mainText.includes('安装 .rpnx'), s0.mainText.slice(0, 60));

if (s0.mainText.includes('酒馆助手')) {
  check('已安装过酒馆助手（复用现有数据）', true);
} else {
  const zipB64 = readFileSync('tavern-helper-real.zip').toString('base64');
  const injected = await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const file = new File([arr], 'tavern-helper.zip', { type: 'application/zip' });
    const dt = new DataTransfer();
    dt.items.add(file);
    const input = document.querySelector('input[type="file"][accept*="rpnx"], input[type="file"][accept*="zip"]');
    if (!input) return { foundInput: false };
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { foundInput: true, size: file.size };
  }, zipB64);
  check('注入酒馆助手压缩包', injected.foundInput === true, JSON.stringify(injected));
  await page.waitForTimeout(9000);
  s0 = await state();
}

check('插件列表出现「酒馆助手」', s0.mainText.includes('酒馆助手'), s0.mainText.slice(0, 120));

// ------------------------------------------------- 2. 设置容器必须可见且有内容
check('#extensions_settings 存在', s0.hasExtensionsSurface);
check('#extensions_settings 可见（未被裁剪）', s0.extVisible, `children=${s0.extChildren}`);
check('TH 设置界面已挂载 #tavern_helper', s0.thMounted && s0.thChildren > 0, `nodes=${s0.thChildren}`);

// ------------------------------------------------- 3. 回聊天页，让 TH 接管 pre>code
await clickByText('聊天');
await page.waitForTimeout(2500);
// 可能落在别的聊天/空态：若没有 pre>code 楼层，切换到最近有内容的聊天
for (let i = 0; i < 3; i++) {
  const st = await state();
  if (st.preCode > 0) break;
  await clickByText('聊天');
  await page.waitForTimeout(1500);
}
let s1 = await state();
check('楼层契约：#chat > .mes[mesid]', s1.directMes > 0, `mes=${s1.directMes}`);
check('.mes_text 覆盖所有楼层', s1.mesText >= s1.directMes && s1.directMes > 0, `${s1.mesText}/${s1.directMes}`);
check('存在 pre>code 楼层（TH 的判定输入）', s1.preCode > 0, `preCode=${s1.preCode}`);

// TH 在 chatLoaded / 宏开关路径下重扫；给它时间
await page.waitForTimeout(4000);
s1 = await state();
check('TH 接管：出现 .TH-render iframe', s1.thRender > 0, `count=${s1.thRender} ids=${s1.thIds.join(',')}`);
check('iframe id 形如 TH-message--<mesid>--<idx>', s1.thIds.some((id) => /^TH-message--\d+--\d+$/.test(id)), s1.thIds.join(','));

check('无页面错误', errors.length === 0, errors.slice(0, 3).join('; '));

await page.screenshot({ path: 'screenshots/device-th-surface.png' }).catch(() => {});
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
