import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

const files = readdirSync('public/fonts').filter((f) => f.startsWith('c-') || f === 'DMSerifDisplay-Italic.ttf');
const faces = files.map((f, i) => ({
  name: `F${i}`,
  label: f.replace(/^c-/, '').replace(/\.ttf$/, '').replace(/-/g, ' '),
  b64: readFileSync(`public/fonts/${f}`).toString('base64'),
}));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${faces.map((f) => `@font-face{font-family:'${f.name}';src:url(data:font/ttf;base64,${f.b64}) format('truetype');font-weight:400 900;font-display:block;}`).join('\n')}
body{background:#17131d;margin:0;padding:18px;font-family:system-ui,sans-serif}
.row{display:flex;align-items:center;gap:18px;padding:14px 16px;border-bottom:1px solid #2c2436}
.lbl{color:#7d7289;font-size:10.5px;width:150px;letter-spacing:.06em;text-transform:uppercase;flex-shrink:0}
.mark{font-size:38px;font-weight:700;font-style:italic;background:linear-gradient(90deg,#ff8fd0,#efe6ff);-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}
.sm{font-size:18px;font-weight:700;font-style:italic;color:#cfc3dc;white-space:nowrap}
</style></head><body>
${faces.map((f) => `<div class="row"><div class="lbl">${f.label}</div><div class="mark" style="font-family:'${f.name}'">RPNow</div><div class="sm" style="font-family:'${f.name}'">Roleplay</div></div>`).join('')}
</body></html>`;

const server = createServer((_q, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((r) => server.listen(8898, '127.0.0.1', r));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 760, height: 60 + faces.length * 68 } });
await page.goto('http://127.0.0.1:8898/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'font-compare-2.png' });
await browser.close();
server.close();
console.log('saved font-compare-2.png with', faces.map((f) => f.label).join(' | '));
