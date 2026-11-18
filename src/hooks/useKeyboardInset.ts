import * as React from 'react';

/**
 * 检测软键盘是否弹起，以及它占了多高。
 *
 * 没有哪个事件是可靠的，标准做法是看视口怎么变。键盘弹起有两种表现，
 * 取两者中较大的那个当作键盘高度：
 *
 * 1. 布局视口收缩 —— 新版安卓 Chrome 上，index.html 的 viewport meta 里
 *    有 `interactive-widget=resizes-content`，键盘一弹起布局视口就跟着缩
 *    （window.innerHeight 变小）。这时整个页面本来就只剩键盘上方的高度，
 *    不会再有“整页被拖走”的余地。用“键盘没弹起时见过的最大 innerHeight”
 *    当基线：地址栏显隐只会让 innerHeight 浮动几十 px，键盘会让它一下掉
 *    两三百 px，120px 的阈值把两者分开。
 * 2. 只有视觉视口缩小 —— 旧版浏览器 / 不支持上面那个 meta 的环境，布局
 *    视口不动，只有 visualViewport 变小（innerHeight - vv.height）。
 *
 * 返回的 `layoutResized` 表示布局视口是否真的缩了：缩了就说明页面已经
 * 贴合键盘上方的可视区，调用处不用再手动扣高度；没缩才需要手动把聊天
 * 框一层的高度扣掉键盘那部分。
 */
export function useKeyboardInset() {
  const [keyboardOpen, setKeyboardOpen] = React.useState(false);
  const [keyboardInset, setKeyboardInset] = React.useState(0);
  const [layoutResized, setLayoutResized] = React.useState(false);
  // 键盘没弹起时见过的最大布局高度。
  const maxH = React.useRef(0);

  React.useEffect(() => {
    const vv = window.visualViewport;
    const check = () => {
      const h = window.innerHeight;
      if (h > maxH.current) maxH.current = h;
      const vvInset = vv ? Math.max(0, Math.round(h - vv.height)) : 0;
      const resizeInset = Math.max(0, Math.round(maxH.current - h));
      const inset = Math.max(vvInset, resizeInset);
      setKeyboardOpen(inset > 120);
      setKeyboardInset(inset > 120 ? inset : 0);
      setLayoutResized(resizeInset > 120);
    };
    maxH.current = window.innerHeight;
    check();
    window.addEventListener('resize', check);
    vv?.addEventListener('resize', check);
    // Android can scroll the visual viewport without firing resize.
    vv?.addEventListener('scroll', check);
    return () => {
      window.removeEventListener('resize', check);
      vv?.removeEventListener('resize', check);
      vv?.removeEventListener('scroll', check);
    };
  }, []);

  return { keyboardOpen, keyboardInset, layoutResized };
}
