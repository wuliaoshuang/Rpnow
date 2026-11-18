import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const text = readFileSync('real-floor.txt', 'utf8');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
const r = await page.evaluate(async (realText) => {
  // 逐行模拟 sandboxHtmlFences 的扫描，打印每个 fence 行的位置与判定
  const lines = realText.split('\n');
  const fenceOpen = /^```[ \t]*([a-z]*)[ \t]*\r?$/i;
  const marks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('```')) {
      marks.push({ i, matched: fenceOpen.test(lines[i]), line: JSON.stringify(lines[i].slice(0, 30)) });
    }
  }
  // </html> 行的位置
  const htmlEnds = [];
  for (let i = 0; i < lines.length; i++) {
    if (/\/html>/i.test(lines[i])) htmlEnds.push({ i, line: JSON.stringify(lines[i].slice(0, 40)) });
  }
  return { totalLines: lines.length, marks, htmlEnds: htmlEnds.slice(0, 6) };
}, text);
console.log(JSON.stringify(r, null, 1));
await browser.close();
