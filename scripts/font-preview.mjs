import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const fonts = {
  'DM Serif': 'public/fonts/cand-DM-Serif-Display-Italic.ttf',
  'Instrument': 'public/fonts/cand-Instrument-Serif-Italic.ttf',
  'Playfair': 'public/fonts/cand-Playfair-Display-Italic.ttf',
};

const html = (data) => `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'DM Serif';src:url(data:font/ttf;base64,${data['DM Serif']}) format('truetype');}
@font-face{font-family:'Instrument';src:url(data:font/ttf;base64,${data['Instrument']}) format('truetype');}
@font-face{font-family:'Playfair';src:url(data:font/ttf;base64,${data['Playfair']}) format('truetype');}
body{background:#1b1620;margin:0;padding:24px;font-family:sans-serif}
.row{display:flex;align-items:baseline;gap:16px;padding:18px 20px;border-bottom:1px solid #332b3a}
.lbl{color:#8a7f96;font-size:11px;width:110px;letter-spacing:.08em;text-transform:uppercase}
.mark{font-size:40px;font-weight:700;background:linear-gradient(90deg,#ff8fd0,#e8e0f0);-webkit-background-clip:text;background-clip:text;color:transparent}
</style></head><body>
${Object.keys(fonts).map((k) => `<div class="row"><div class="lbl">${k}</div><div class="mark" style="font-family:'${k}'">RPNow</div><div class="mark" style="font-family:'${k}';font-size:22px">Rpnow — 琥珀</div></div>`).join('')}
</body></html>`;

const data = {};
for (const [k, p] of Object.entries(fonts)) data[k] = readFileSync(p).toString('base64');

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html(data));
});
await new Promise((r) => server.listen(8899, '127.0.0.1', r));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 900, height: 340 } });
await page.goto('http://127.0.0.1:8899/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await page.screenshot({ path: 'font-compare.png' });
await browser.close();
server.close();
console.log('saved font-compare.png');
