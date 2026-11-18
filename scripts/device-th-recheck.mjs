import { chromium } from 'playwright';

const results = [];
const check = (n, ok, d = '') => {
  results.push(ok);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' -- ' + d : ''}`);
};

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
let page = browser.contexts()[0]?.pages()?.[0];
if (!page) {
  console.log('no page');
  process.exit(1);
}
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message)));

const snap = async () =>
  page.evaluate(() => {
    const vis = (el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden';
    };
    const chat = document.getElementById('chat');
    const mes = chat ? Array.from(chat.querySelectorAll(':scope > .mes')) : [];
    const frames = Array.from(document.querySelectorAll('.TH-render iframe'));
    return {
      preset: (document.querySelector('main')?.innerText ?? '').includes('Meowssiah') ? 'Meowssiah' : '-',
      mes: mes.length,
      mesText: mes.filter((m) => m.querySelector('.mes_text')).length,
      preCode: mes.filter((m) => m.querySelector('.mes_text pre > code')).length,
      thRender: frames.length,
      thIds: frames.map((f) => f.id).slice(0, 4),
      extVisible: vis(document.getElementById('extensions_settings')),
      thNodes: document.getElementById('tavern_helper')?.querySelectorAll('*').length ?? 0,
      mainHasDocText: (document.querySelector('main')?.innerText ?? '').includes('<!DOCTYPE'),
    };
  });

// reload 触发：boot 重新激活插件 → TH 初始化 → ChatView 挂载发 chatLoaded
console.log('reloading…');
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(9000);
page = browser.contexts()[0]?.pages()?.[0] ?? page;

let s = await snap();
console.log('after reload:', JSON.stringify(s));
check('reload 后仍在聊天页且有楼层', s.mes > 0, `mes=${s.mes}`);
check('.mes_text 覆盖', s.mesText >= s.mes && s.mes > 0, `${s.mesText}/${s.mes}`);
check('pre>code 楼层存在', s.preCode > 0, `preCode=${s.preCode}`);
check('TH 设置容器可见', s.extVisible, `thNodes=${s.thNodes}`);

/*
 * TH 的首次全量重扫时机：chatLoaded、welcomePanel、宏开关变化、正则增删。
 * 若 reload 后仍未接管，切换一次主题（触发 settings_updated/CHAT_CHANGED 家族）
 * 再看。
 */
if (s.thRender === 0) {
  console.log('triggering theme toggle…');
  for (const name of ['午夜玫瑰', '纸墨']) {
    await page.evaluate((t) => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(t));
      btn?.click();
    }, name);
    await page.waitForTimeout(2500);
  }
  await page.waitForTimeout(4000);
  s = await snap();
  console.log('after toggle:', JSON.stringify(s));
}

check('TH 接管：.TH-render iframe', s.thRender > 0, `count=${s.thRender} ids=${s.thIds.join(',')}`);
check('iframe id = TH-message--<mesid>--<idx>', s.thIds.some((id) => /^TH-message--\d+--\d+$/.test(id)), s.thIds.join(','));
check('无页面错误', errors.length === 0, errors.slice(0, 3).join('; '));

await page.screenshot({ path: 'screenshots/device-th-after.png' }).catch(() => {});
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
