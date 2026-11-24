/**
 * 宿主这一侧：接 HTML 卡片 iframe 发来的消息。
 *
 * 卡片跑在没有 allow-same-origin 的沙箱里，碰不到应用页面，只能 postMessage。
 * 这里只做两件事：
 *   - 高度：把对应 iframe 调到页面报上来的高度；
 *   - 文字：在那个 iframe 上派发一个 `rpnow:card-slash` 事件，聊天页听到后把
 *     文字放进输入框；卡片明确要求「发出去」而且用户刚点过页面时，直接发出。
 *
 * 消息必须同时满足：来源是 opaque origin（`"null"`，沙箱页面才是这个值）、
 * 来源窗口是页面上某个带 `data-rp-card` 的 iframe、内容通过
 * `parseCardFrameMessage` 的校验。应用的状态、存储、密钥都不经过这里。
 */

import { HOST_MESSAGE_TAG, parseCardFrameMessage } from './htmlDocument.js';

/** 聊天页监听的事件名。`detail.text` 是文字，`detail.send` 为真表示直接发出去。 */
export const CARD_SLASH_EVENT = 'rpnow:card-slash';

let installed = false;

/** 找到发消息的那个 iframe；不是我们的卡片就返回 null。 */
function frameOf(source: MessageEventSource | null): HTMLIFrameElement | null {
  if (!source) return null;
  const frames = document.querySelectorAll<HTMLIFrameElement>('iframe[data-rp-card]');
  for (const frame of Array.from(frames)) {
    if (frame.contentWindow === source) return frame;
  }
  return null;
}

/** 当前主题是深色还是浅色，以及正文字色——片段类卡片跟着应用主题走。 */
function hostTheme(): { scheme: 'dark' | 'light'; fg: string } {
  const root = document.documentElement;
  const cs = getComputedStyle(root);
  const scheme = /dark/.test(cs.colorScheme || '') || root.classList.contains('dark') ? 'dark' : 'light';
  return { scheme, fg: getComputedStyle(document.body).color };
}

/** 收到过消息的 iframe：说明里面的桥接脚本跑起来了。 */
const alive = new WeakSet<HTMLIFrameElement>();
/** 页面加载完之后多久还没动静，就认定脚本没跑（ms）。 */
const DEAD_AFTER_MS = 2500;

/** 应用这一侧，用户是不是刚点过（iframe 里的点击也算在外层页面头上）。 */
function hostActive(): boolean {
  const ua = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation;
  // 老内核没有这个接口：只能信页面自己报的。
  return ua ? ua.isActive : true;
}

function onMessage(event: MessageEvent): void {
  // 沙箱页面的来源一定是 "null"；同源页面、别的网站发来的一律不理。
  if (event.origin !== 'null') return;
  const message = parseCardFrameMessage(event.data);
  if (!message) return;
  const frame = frameOf(event.source);
  if (!frame) return;
  alive.add(frame);
  if (message.type === 'ready') {
    const theme = hostTheme();
    frame.contentWindow?.postMessage({ [HOST_MESSAGE_TAG]: 1, scheme: theme.scheme, fg: theme.fg }, '*');
    return;
  }
  if (message.type === 'height') {
    const next = `${Math.max(24, message.height)}px`;
    if (frame.style.height !== next) frame.style.height = next;
    return;
  }
  if (message.type === 'unsupported') {
    console.warn(`[RPNow 卡片桥] 卡片调用了没有对应功能的接口：${message.name}`);
    return;
  }
  // 「直接发出去」必须两头都确认用户刚点过：页面自己说点过，应用这边也看到点过。
  // 页面一加载就自动调用发送的，只会把文字放进输入框。
  const send = message.send && hostActive();
  frame.dispatchEvent(new CustomEvent(CARD_SLASH_EVENT, { bubbles: true, detail: { text: message.text, send } }));
}

/**
 * 页面加载完了，桥接脚本却一直没动静：脚本被拦了（安装包的安全策略、内核太旧）。
 * 这时页面量不出高度、按钮和选项也出不来。不能让它悄悄坏掉：给一个能滚动的固定
 * 高度，并在下面写明白是怎么回事。
 */
function onFrameLoad(event: Event): void {
  const frame = event.target;
  if (!(frame instanceof HTMLIFrameElement) || !frame.hasAttribute('data-rp-card')) return;
  window.setTimeout(() => {
    if (alive.has(frame) || !frame.isConnected || frame.dataset.rpDead) return;
    frame.dataset.rpDead = '1';
    frame.style.height = '480px';
    frame.setAttribute('scrolling', 'auto');
    const holder = frame.parentElement;
    if (holder && !holder.querySelector('.rp-card-dead')) {
      const note = document.createElement('div');
      note.className = 'rp-card-dead';
      note.textContent = '这个页面里的脚本没有运行，选项和按钮可能用不了。请把应用更新到最新的安装包再试。';
      holder.appendChild(note);
    }
    console.warn('[RPNow 卡片桥] 页面加载完成后没有收到桥接脚本的消息：页面脚本没有运行。');
  }, DEAD_AFTER_MS);
}

/** 装一次全局监听（重复调用没有副作用）。 */
export function installCardFrameHost(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('message', onMessage);
  // iframe 的 load 事件不冒泡，但捕获阶段在 document 上能收到。
  document.addEventListener('load', onFrameLoad, true);
}
