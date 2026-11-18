import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) process.exit(1);
await page.waitForTimeout(500);

const info = await page.evaluate(() => {
  const out = {};
  out.bodyPadding = getComputedStyle(document.body).padding;
  out.bodyClass = document.body.className;
  out.bodyAttrs = [...document.body.attributes].map((a) => `${a.name}=${a.value}`);

  // 遍历所有样式表，找设置 body padding 的规则
  const hits = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const walk = (list, media = '') => {
      for (const rule of list) {
        if (rule.cssRules) {
          walk(rule.cssRules, (rule.conditionText ? `@${rule.conditionText} ` : '') + media);
          continue;
        }
        if (!rule.selectorText) continue;
        const t = rule.style?.padding;
        const tb = rule.style?.paddingBottom;
        if (t || tb) {
          if (/(^|,)\s*(body|html)\s*($|,|:)/.test(rule.selectorText) || rule.selectorText.includes('safe-area')) {
            hits.push({ sel: rule.selectorText, padding: t || `pb=${tb}`, media, href: (sheet.href || 'inline').slice(-40) });
          }
        }
      }
    };
    walk(rules);
  }
  out.paddingRules = hits.slice(0, 20);

  // 检查 html 上是否有 env(safe-area-inset) 相关
  out.docElPadding = getComputedStyle(document.documentElement).padding;
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
