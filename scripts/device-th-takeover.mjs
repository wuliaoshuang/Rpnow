/**
 * 真机：验证酒馆助手真正接管显示层文档。
 *
 * 关键点：TH 只在事件驱动的重新扫描中渲染（chatLoaded / *_MESSAGE_RENDERED /
 * 宏开关变化）。因此本脚本在 TH 已激活的前提下**发送一条新的、含 ```html
 * 围栏的用户消息**，制造 USER_MESSAGE_RENDERED，然后断言该楼层被包成
 * `.TH-render > iframe#TH-message--<mesid>--<idx>`，而不是把源码当文本显示。
 */
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
    const frames = Array.from(document.querySelectorAll('.TH-render iframe'));
    return {
      hash: location.hash,
      mes: document.querySelectorAll('#chat > .mes').length,
      preCode: document.querySelectorAll('#chat .mes_text pre > code').length,
      /*
       * 区分两个渲染器：TH 的 iframe id 形如 `TH-message--<mesid>--<idx>`；
       * RPNow 兜底卡片的 iframe 无 id、外层带 `rp-frontend-render`。
       */
      thFrames: frames.filter((f) => f.id.startsWith('TH-message--')).length,
      rpCards: document.querySelectorAll('.rp-frontend-render iframe').length,
      ids: frames.map((f) => f.id).filter(Boolean).slice(0, 5),
      extPresent: !!document.getElementById('extensions_settings'),
      docTextLeak: (document.querySelector('main')?.innerText ?? '').includes('<!DOCTYPE'),
      composer: !!document.querySelector('textarea[aria-label*="消息"], textarea'),
    };
  });

// 从头开始：确保 TH 已加载并订阅事件
await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
await page.waitForTimeout(9000);

let s = await snap();
console.log('boot:', JSON.stringify(s));
check('已进入聊天页且有楼层', s.mes > 0 && !s.docTextLeak, `mes=${s.mes} leak=${s.docTextLeak}`);
check('TH 已激活（设置容器存在）', await page.evaluate(() => !!document.getElementById('extensions_settings')));

// 让导航回到聊天页（避免落在 hub）
if (s.hash !== '#chat') {
  await page.evaluate(() => {
    location.hash = '#chat';
  });
  await page.waitForTimeout(2500);
}

// 发送一条含 ```html 围栏的用户消息 → 触发 USER_MESSAGE_RENDERED
const box = page.locator('textarea[aria-label*="消息"], textarea').first();
const hasBox = (await box.count()) > 0;
check('找到输入框', hasBox);
if (hasBox) {
  const doc = '```html\n<!DOCTYPE html>\n<html lang="zh-CN"><head><meta charset="utf-8"></head>\n<body><b>TH 接管验证</b></body></html>\n```';
  await box.fill(doc);
  await page.waitForTimeout(400);
  await box.press('Enter');
  // 等流式/提交与 TH 的重扫周期
  for (let i = 0; i < 6; i++) {
    await page.waitForTimeout(1500);
    s = await snap();
    if (s.thFrames > 0) break;
  }
}

s = await snap();
console.log('after send:', JSON.stringify(s));
check('TH 让路生效：保留 pre>code（未被 RPNow 兜底吃掉）', s.preCode > 0, `preCode=${s.preCode} rpCards=${s.rpCards}`);
check('TH 接管：出现自己的 iframe', s.thFrames > 0, `count=${s.thFrames} ids=${s.ids.join(',')}`);
check(
  'iframe id 形如 TH-message--<mesid>--<idx>',
  s.ids.some((id) => /^TH-message--\d+--\d+$/.test(id)),
  s.ids.join(','),
);
check('RPNow 未重复渲染（无兜底卡片）', s.rpCards === 0, `rpCards=${s.rpCards}`);
check('文档源码不再作为可见文本泄露', !s.docTextLeak, s.docTextLeak ? '页面文本含 <!DOCTYPE' : '');
check(
  '无致命页面错误',
  errors.filter((e) => !/ServiceWorker|sw\.js/.test(e)).length === 0,
  errors.slice(0, 3).join('; '),
);

await page.screenshot({ path: 'screenshots/device-th-takeover.png' }).catch(() => {});
await browser.close();
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
