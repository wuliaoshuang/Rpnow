import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) process.exit(1);
await page.waitForTimeout(500);

const info = await page.evaluate(() => {
  const out = {};
  const bs = document.body.style;
  out.inlineStyle = bs.cssText || '(empty)';
  out.bodyStyleAttr = document.body.getAttribute('style');

  // 计算样式来源：逐个遍历 styleSheets 找匹配 body 的规则（含 padding 简写/长写）
  const matched = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) { walk(rule.cssRules); continue; }
        if (!rule.selectorText) continue;
        let isMatch = false;
        try { isMatch = document.body.matches(rule.selectorText); } catch { continue; }
        if (!isMatch) continue;
        const s = rule.style;
        const props = [];
        for (const p of ['padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left']) {
          const v = s.getPropertyValue(p);
          if (v) props.push(`${p}:${v}`);
        }
        if (props.length) matched.push({ sel: rule.selectorText, props, href: (sheet.href || 'inline').slice(-50) });
      }
    };
    walk(rules);
  }
  out.matchedBodyRules = matched.slice(0, 20);

  // 检查是否有 *: 规则影响 body
  const star = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules) { walk(rule.cssRules); continue; }
        if (!rule.selectorText) continue;
        if (!/^\*|,\s*\*/.test(rule.selectorText)) continue;
        const p = rule.style.getPropertyValue('padding');
        if (p) star.push({ sel: rule.selectorText, padding: p });
      }
    };
    walk(rules);
  }
  out.starRules = star.slice(0, 10);
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
