/** Meowssiah 真实预设 → 显示层正则提取 → HTML 渲染链验证 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const presetJson = readFileSync('C:/Users/shuang/Downloads/Meowssiah-2.1.6.json', 'utf8');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message.slice(0, 220)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1200);

const r = await page.evaluate(async (presetDoc) => {
  const out = {};
  const { normalizePreset } = await import('/src/features/import/cardImport.ts');
  const presetDoc2 = presetDoc;
  const { preset } = normalizePreset(presetDoc2, 'Meowssiah');
  out.parsed = Boolean(preset);
  out.rawKept = Boolean(preset?.raw);

  const mod = await import('/src/components/chat/MessageBubble.tsx');
  const regexes = mod.extractPresetDisplayRegexes(preset);
  out.regexCount = regexes.length;
  out.regexNames = regexes.map((s) => s.scriptName);

  // 模拟 AI 输出 <think_nya> 标签，跑第一条（思维链折叠→HTML 围栏）
  const sample = '<think_nya>她其实在担心你</think_nya>\n\n好的，我明白了。';
  const { renderMessageText } = await import('/src/features/chat/orchestrator.ts');
  const processed = renderMessageText(sample, regexes, 2, 0);
  out.hasFence = processed.includes('```');
  out.hasHtmlDoc = /<!DOCTYPE html>|<html/i.test(processed);
  out.fenceHead = processed.slice(0, 120);
  return out;
}, JSON.parse(presetJson));

console.log(JSON.stringify(r, null, 1));
await browser.close();
