/**
 * SillyTavern（傻酒馆）扩展兼容层开关。
 *
 * 背景：早期 RPNow 尝试兼容 SillyTavern / 酒馆助手扩展，投入很大且收益有限。
 * 现在**默认关闭**——不再识别、不再安装、不再为其改变渲染行为；相关实现保留在
 * `core/plugins/st-*`，只有显式打开本开关时才会被触达。
 *
 * 判定集中在这一处，避免各模块各自读设置导致口径不一致。
 */

import { useApp } from '@/state/store.js';

/** 兼容层是否启用（默认 false）。 */
export function isSTCompatEnabled(): boolean {
  try {
    return useApp.getState().settings.stCompat?.enabled === true;
  } catch {
    return false;
  }
}
