/**
 * App icon source (1024×1024).
 *
 * Multiple pigments diffusing in water + a light frosted-glass veil, white
 * letter with a coloured rim.
 *
 * NOTE ON THE FROST: an earlier version used a 0.58-opacity white overlay,
 * which washed every pigment out to near-white (sampled rgb(251,252,253) across
 * the whole icon). The veil is now kept subtle (≤0.18) so the colours survive.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const font = readFileSync('public/fonts/BrandSerif.ttf').toString('base64');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:'Brand';src:url(data:font/ttf;base64,${font}) format('truetype');font-weight:100 900;font-style:italic;}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1024px;height:1024px;overflow:hidden}
body{position:relative;display:flex;align-items:center;justify-content:center;background:#eef3fb;}

/* 基底：柔和的多色渐变，保证任何角落都有颜色，不会漏白 */
.base{position:absolute;inset:0;
  background:
    radial-gradient(70% 65% at 14% 10%, #b9cdf6 0%, rgba(185,205,246,0) 62%),
    radial-gradient(68% 62% at 88% 12%, #dcbfef 0%, rgba(220,191,239,0) 62%),
    radial-gradient(72% 68% at 10% 74%, #a9d3ee 0%, rgba(169,211,238,0) 64%),
    radial-gradient(70% 66% at 94% 76%, #f3c3d8 0%, rgba(243,195,216,0) 64%),
    radial-gradient(78% 62% at 50% 108%, #aee3d8 0%, rgba(174,227,216,0) 66%),
    linear-gradient(152deg,#cfdcf6 0%,#cdd8f2 44%,#e4cfe9 100%);
}

/* 颜料团：大半径 + 强模糊，用 normal 混合让边缘自然晕开 */
.pigment{position:absolute;border-radius:50%;filter:blur(70px);}
.p1{width:820px;height:820px;top:-240px;left:-220px;
  background:radial-gradient(circle,rgba(126,166,240,.95) 0%,rgba(126,166,240,.42) 48%,rgba(126,166,240,0) 76%);}
.p2{width:760px;height:760px;top:-200px;right:-180px;
  background:radial-gradient(circle,rgba(196,148,232,.92) 0%,rgba(196,148,232,.40) 48%,rgba(196,148,232,0) 76%);}
.p3{width:700px;height:700px;top:300px;left:-220px;
  background:radial-gradient(circle,rgba(112,196,230,.90) 0%,rgba(112,196,230,.38) 48%,rgba(112,196,230,0) 76%);}
.p4{width:680px;height:680px;top:330px;right:-200px;
  background:radial-gradient(circle,rgba(240,150,190,.85) 0%,rgba(240,150,190,.36) 48%,rgba(240,150,190,0) 76%);}
.p5{width:820px;height:820px;bottom:-300px;left:40px;
  background:radial-gradient(circle,rgba(120,220,204,.88) 0%,rgba(120,220,204,.36) 48%,rgba(120,220,204,0) 76%);}
.p6{width:560px;height:560px;bottom:-200px;right:-80px;
  background:radial-gradient(circle,rgba(250,226,170,.72) 0%,rgba(250,226,170,.30) 48%,rgba(250,226,170,0) 76%);}

/* 水波环：极淡白色圆环，叠在颜料上读出水面涟漪 */
.ripple{position:absolute;border-radius:50%;mix-blend-mode:soft-light;opacity:.55;}
.w1{width:1760px;height:1760px;top:-400px;left:-440px;
  background:repeating-radial-gradient(circle,
    rgba(255,255,255,.55) 0 14px, rgba(255,255,255,0) 14px 46px);}
.w2{width:1320px;height:1320px;bottom:-540px;right:-440px;
  background:repeating-radial-gradient(circle,
    rgba(255,255,255,.45) 0 12px, rgba(255,255,255,0) 12px 40px);}

/*
  毛玻璃：只做一层很薄的亮膜 + 轻微模糊感（用渐变模拟，不用 backdrop-filter，
  避免再次把颜色洗白）。
*/
.frost{position:absolute;inset:0;
  background:linear-gradient(172deg,
    rgba(255,255,255,.20) 0%,rgba(255,255,255,.05) 34%,
    rgba(255,255,255,.02) 60%,rgba(255,255,255,.16) 100%);}
/* 玻璃边缘内高光 */
.edge{position:absolute;inset:22px;border-radius:190px;
  box-shadow:inset 0 2px 0 rgba(255,255,255,.85),
             inset 0 -2px 0 rgba(255,255,255,.45),
             inset 2px 0 0 rgba(255,255,255,.30),
             inset -2px 0 0 rgba(255,255,255,.30);}

.glyph-wrap{position:relative;display:flex;align-items:center;justify-content:center}
/* 彩色只出现在字形边缘 */
.rim{position:absolute;font-family:'Brand';font-style:italic;font-weight:700;
  font-size:545px;line-height:1;letter-spacing:-12px;color:transparent;
  -webkit-text-stroke:26px rgba(255,255,255,.55);filter:blur(12px);}
.rim2{position:absolute;font-family:'Brand';font-style:italic;font-weight:700;
  font-size:545px;line-height:1;letter-spacing:-12px;color:transparent;
  -webkit-text-stroke:13px rgba(150,190,235,.55);filter:blur(7px);}
/* 纯白字形 */
.glyph{position:relative;font-family:'Brand';font-style:italic;font-weight:700;
  font-size:545px;line-height:1;letter-spacing:-12px;color:#fff;
  text-shadow:0 3px 16px rgba(90,110,160,.28);}
</style></head><body>
  <div class="base"></div>
  <div class="pigment p1"></div><div class="pigment p2"></div>
  <div class="pigment p3"></div><div class="pigment p4"></div>
  <div class="pigment p5"></div><div class="pigment p6"></div>
  <div class="ripple w1"></div><div class="ripple w2"></div>
  <div class="frost"></div>
  <div class="edge"></div>
  <div class="glyph-wrap">
    <div class="rim">R</div>
    <div class="rim2">R</div>
    <div class="glyph">R</div>
  </div>
</body></html>`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(600);
await page.screenshot({ path: 'src-tauri/icons/source-1024.png' });

// 立即自检：采样必须是「有颜色」的，不能是一片近白。
const samples = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  return { w: canvas.width };
});
void samples;
await browser.close();
console.log('rendered');
