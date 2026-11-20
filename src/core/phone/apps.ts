/**
 * 小手机主屏幕的应用注册表（插件 panel.html 里 `registerApp` 的 Rpnow 版）。
 *
 * 插件的思路：每个应用自己注册 `{id, label, icon, component}`，主屏幕按
 * 注册表画一排图标，点开哪个就显示哪个的容器、藏起主屏幕——应用只显示
 * /隐藏、从来不卸载，所以切来切去状态都在。Rpnow 里注册表就是下面这张
 * 静态表（五个应用：微信、朋友圈、相册、日记、运势），MiniPhone 按它画主屏幕图标，
 * 打开应用时只用 CSS 藏起别的（不卸载），状态就留住了。
 *
 * 插件还有文件夹、拖动排序、长按改名——这个 PR 不搬（太大了），主屏幕
 * 就是一张静态网格；以后要加应用，往这张表里加一行就行。
 */

export type PhoneAppId = 'wechat' | 'moments' | 'album' | 'diary' | 'fortune';

/** 主屏幕图标用的那套 lucide 图标（MiniPhone 里按这个 key 换组件）。 */
export type PhoneAppIcon = 'wechat' | 'moments' | 'album' | 'diary' | 'fortune';

export interface PhoneAppDef {
  id: PhoneAppId;
  /** 主屏幕图标下面那行字。 */
  label: string;
  /** 圆角图标的背景色。 */
  color: string;
  /** 图标本身的颜色（默认白色）。 */
  iconColor?: string;
  icon: PhoneAppIcon;
}

/** 主屏幕上的应用，按这个顺序排。 */
export const PHONE_APPS: PhoneAppDef[] = [
  { id: 'wechat', label: '微信', color: '#07C160', icon: 'wechat' },
  { id: 'moments', label: '朋友圈', color: '#576B95', icon: 'moments' },
  { id: 'album', label: '相册', color: '#f5f5f7', iconColor: '#007AFF', icon: 'album' },
  { id: 'diary', label: '日记', color: '#F59E0B', icon: 'diary' },
  { id: 'fortune', label: '运势', color: '#8B5CF6', icon: 'fortune' },
];

/** 按 id 找一个应用的定义，没有返回 undefined。 */
export function phoneAppById(id: string): PhoneAppDef | undefined {
  return PHONE_APPS.find((a) => a.id === id);
}

/** 注册表里的应用 id（去重后的顺序列表）。 */
export function phoneAppIds(): PhoneAppId[] {
  return PHONE_APPS.map((a) => a.id);
}
