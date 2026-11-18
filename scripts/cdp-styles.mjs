import { chromium } from 'playwright';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
const page = browser.contexts()[0]?.pages()?.[0];
if (!page) process.exit(1);

const cdp = await page.context().newCDPSession(page);
await cdp.send('DOM.enable');
await cdp.send('CSS.enable');

const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: 'body' });

const matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });

const reported = [];
for (const m of matched.matchedCSSRules ?? []) {
  const r = m.rule;
  const props = (r.style?.cssProperties ?? []).filter((p) => /padding|margin/.test(p.name));
  if (!props.length) continue;
  reported.push({
    origin: r.origin,
    selector: r.selectorList?.text,
    props: props.map((p) => `${p.name}:${p.value}`),
    source: r.styleSheetId ? 'sheet' : 'inline/ua',
  });
}
console.log('matched rules with padding/margin:', JSON.stringify(reported, null, 1));

const inline = matched.inlineStyle;
console.log('inline:', inline?.cssProperties?.filter((p) => /padding/.test(p.name)).map((p) => `${p.name}:${p.value}`));
await browser.close();
