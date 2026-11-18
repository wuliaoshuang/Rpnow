/** 端到端：激活酒馆助手 → 模拟楼层 DOM + 事件 → 断言 TH-render 出现。 */
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const zip = await JSZip.loadAsync(readFileSync('tavern-helper-real.zip'));
const js = await zip.file('JS-Slash-Runner-main/dist/index.js').async('text');
const css = await zip.file('JS-Slash-Runner-main/dist/index.css').async('text');
const manifest = JSON.parse(await zip.file('JS-Slash-Runner-main/manifest.json').async('text'));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));

await page.goto('http://127.0.0.1:5173/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-route]', { timeout: 25000 });
await page.waitForTimeout(1400);

// 切到聊天页：先建卡与会话
await page.evaluate(async () => {
  const s = window.__rpnowStore.getState();
  if (!s.cards.length) {
    await s.addCard({ spec: 'v2', specVersion: '2.0', data: { name: '渲染测', description: '', personality: '', scenario: '', first_mes: '你好', mes_example: '' } });
  }
  const card = window.__rpnowStore.getState().cards[0];
  if (!window.__rpnowStore.getState().chats.length) {
    await s.saveChat({ id: 'chat-r', title: '渲染测', cardId: card.id, lorebookIds: [], useCardLorebook: true, messages: [{ id: 'm0', role: 'assistant', content: '你好', createdAt: Date.now(), isGreeting: true }], variables: {}, createdAt: Date.now(), updatedAt: Date.now() });
    s.setActiveChat('chat-r');
  }
});
await page.waitForTimeout(1200);

const r = await page.evaluate(async ({ script, css, manifest }) => {
  const out = {};
  // 酒馆助手的渲染 store 在 mount 时检查 welcomePanel；提前补上
  if (!document.querySelector('#chat > .welcomePanel')) {
    const wp = document.createElement('div');
    wp.className = 'welcomePanel';
    wp.style.display = 'none';
    document.getElementById('chat')?.appendChild(wp);
  }
  // 渲染 store 在 mount 时扫描 $('#chat > .mes')，楼层必须先于激活存在
  if (!document.querySelector('#chat > .mes')) {
    const mes = document.createElement('div');
    mes.className = 'mes';
    mes.setAttribute('mesid', '0');
    mes.innerHTML = '<div class="mes_text"><pre><code>&lt;html&gt;&lt;body&gt;&lt;h1&gt;TH TEST&lt;/h1&gt;&lt;p&gt;probe&lt;/p&gt;&lt;/body&gt;&lt;/html&gt;</code></pre></div>';
    document.getElementById('chat')?.appendChild(mes);
  }
  const bridge = await import('/src/core/plugins/st-bridge.ts');
  try {
    const h = await bridge.activateSTExtension('st.th-render', {
      manifest,
      entryPath: manifest.js,
      script,
      styles: css,
    });
    out.activated = true;
    await new Promise((r) => setTimeout(r, 3600));

    const chat = document.getElementById('chat');
    out.hasChat = Boolean(chat);

    await new Promise((r) => setTimeout(r, 400));

    // 触发 CHARACTER_MESSAGE_RENDERED（载荷 = mesid 数字）
    const kernel = window.__rpnowStore.getState().kernel;
    const et = window.event_types ?? {};
    kernel?.events.emit('chat:message-received', { chatId: 'x', message: {}, message_id: 0 });

    await new Promise((r) => setTimeout(r, 1500));
    out.thRender = document.querySelectorAll('.mes .TH-render').length;
    out.iframes = document.querySelectorAll('.mes iframe').length;
    out.helperChildren = document.getElementById('tavern_helper')?.childElementCount ?? -1;
    out.rpnowPre = document.querySelectorAll('#chat .mes pre code').length;
    h.dispose();
  } catch (e) {
    out.activated = false;
    out.error = String(e?.message ?? e).slice(0, 400);
  }
  return out;
}, { script: js, css, manifest });

console.log(JSON.stringify(r, null, 1));
console.log('--- errors', errors.length, '---');
errors.slice(0, 4).forEach((e) => console.log(' •', e));
await browser.close();
