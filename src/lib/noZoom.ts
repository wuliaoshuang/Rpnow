/**
 * 禁止页面缩放的 iOS 补强（viewport meta 的搭档）。
 *
 * 背景：index.html 的 viewport meta（PR #4）里已经有
 * `maximum-scale=1.0, user-scalable=no`，但 iOS Safari 从 iOS 10 起出于
 * 无障碍考虑忽略 `user-scalable=no`，`maximum-scale=1.0` 也拦不住所有
 * 手势（尤其双指捏合），部分 WebView 对 meta 的处理也不一样。所以光
 * 靠 meta 不够，需要再加两道：
 *
 * 1. CSS `touch-action: manipulation`（见 src/index.css）：禁掉双击缩放，
 *    但保留平移和滚动。
 * 2. 这里的 `gesturestart` 拦截：iOS Safari 在双指捏合时会触发
 *    `gesturestart` 事件，非被动监听里 `preventDefault()` 能拦住捏合
 *    缩放——这正是 meta 被忽略的那个缺口。
 *
 * 只拦 `gesturestart`，不碰 `touchstart` / `touchmove` / `touchend`，
 * 所以滚动、点按、长按菜单都不受影响。也不动 viewport meta，
 * `src/hooks/useKeyboardInset.ts` 依赖的
 * `interactive-widget=resizes-content` 与 visualViewport 检测照常工作。
 */
let installed = false;

export function installNoZoom(): void {
  if (installed) return;
  installed = true;
  document.addEventListener(
    'gesturestart',
    (e) => {
      // 捏合手势开始即拦下；必须是 { passive: false } 否则
      // preventDefault() 会被浏览器忽略。
      e.preventDefault();
    },
    { passive: false },
  );
}
