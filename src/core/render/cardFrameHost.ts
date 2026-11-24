/**
 * 宿主这一侧：接 HTML 卡片 iframe 发来的消息。
 *
 * 卡片跑在没有 allow-same-origin 的沙箱里，碰不到应用页面，只能 postMessage。
 * 这里只做两件事：
 *   - 高度：把对应 iframe 调到页面报上来的高度；
 *   - 文字：在那个 iframe 上派发一个 `rpnow:card-slash` 事件，聊天页听到后把
 *     文字放进输入框（不自动发送，和 RP-Hub 一样由用户自己点发送）。
 *
 * 消息必须同时满足：来源是 opaque origin（`"null"`，沙箱页面才是这个值）、
 * 来源窗口是页面上某个带 `data-rp-card` 的 iframe、内容通过
 * `parseCardFrameMessage` 的校验。应用的状态、存储、密钥都不经过这里。
 */

import { HOST_MESSAGE_TAG, parseCardFrameMessage } from './htmlDocument.js';

/** 聊天页监听的事件名。`detail.text` 是要放进输入框的文字。 */
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

function onMessage(event: MessageEvent): void {
  // 沙箱页面的来源一定是 "null"；同源页面、别的网站发来的一律不理。
  if (event.origin !== 'null') return;
  const message = parseCardFrameMessage(event.data);
  if (!message) return;
  const frame = frameOf(event.source);
  if (!frame) return;
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
  frame.dispatchEvent(new CustomEvent(CARD_SLASH_EVENT, { bubbles: true, detail: { text: message.text } }));
}

/** 装一次全局监听（重复调用没有副作用）。 */
export function installCardFrameHost(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('message', onMessage);
}
