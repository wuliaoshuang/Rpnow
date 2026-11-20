/**
 * MiniPhone — “小手机”：悬浮在聊天上的一部模拟手机。
 *
 * 不是全屏页，是带手机壳的悬浮窗：深色外壳边框、灵动岛、底部 home 条，
 * 屏幕嵌在壳里。桌面上有两个应用：微信、相册。以后加新应用时往 `apps`
 * 数组里加一项，再在 `screen` 联合类型里加一个分支。
 *
 * 联系人来自当前聊天的卡（见 WeChat），所以要把 chatId 和 card 传进来。
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { BatteryMedium, Images, MessageCircle, Signal, Wifi, X } from 'lucide-react';
import type { RPCard } from '@/core/types/card.js';
import { WeChat } from './WeChat.js';
import { Album } from './Album.js';

type Screen = 'home' | 'wechat' | 'album';

interface PhoneApp {
  id: string;
  name: string;
  /** 圆角图标的背景色。 */
  color: string;
  /** 图标本身的颜色（默认白色）。 */
  iconColor?: string;
  icon: React.ComponentType<{ className?: string; color?: string }>;
}

const APPS: PhoneApp[] = [
  { id: 'wechat', name: '微信', color: '#07C160', icon: MessageCircle },
  { id: 'album', name: '相册', color: '#f5f5f7', iconColor: '#007AFF', icon: Images },
];

function useClock(): string {
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function MiniPhone({
  open,
  onOpenChange,
  chatId,
  card,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chatId: string;
  card: RPCard;
}) {
  const [screen, setScreen] = React.useState<Screen>('home');
  const clock = useClock();

  // 每次打开都先回主屏幕。
  React.useEffect(() => {
    if (open) setScreen('home');
  }, [open ]);

  if (!open) return null;

  const openApp = (id: string) => {
    if (id === 'wechat') setScreen('wechat');
    else if (id === 'album') setScreen('album');
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-3">
      {/* 手机壳：深色渐变外框，四边都留得出，四角大圆角，带阴影。 */}
      <div className="relative h-[min(740px,calc(100dvh-48px))] w-[min(380px,calc(100vw-24px))] rounded-[3rem] bg-gradient-to-b from-neutral-500 via-neutral-800 to-neutral-600 p-2.5 shadow-[0_32px_80px_rgba(0,0,0,0.65)]">
        {/* 侧边按键装饰：音量、静音、电源 */}
        <div aria-hidden className="absolute -left-[2px] top-32 h-10 w-[3px] rounded-full bg-neutral-500" />
        <div aria-hidden className="absolute -left-[2px] top-48 h-16 w-[3px] rounded-full bg-neutral-500" />
        <div aria-hidden className="absolute -right-[2px] top-36 h-16 w-[3px] rounded-full bg-neutral-500" />
        {/* 屏幕嵌在壳里 */}
        <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[2.35rem] bg-neutral-950 text-white">
          {/* 灵动岛 */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-2.5 z-30 h-[22px] w-24 -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10"
          />
          {/* 状态栏 */}
          <div className="flex shrink-0 items-center justify-between px-5 pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] pb-1 text-white">
            <span className="text-sm font-semibold tabular-nums">{clock}</span>
            <div className="flex items-center gap-1.5">
              <Signal className="size-4" aria-label="信号" />
              <Wifi className="size-4" aria-label="无线网络" />
              <BatteryMedium className="size-5" aria-label="电量" />
              <button
                type="button"
                aria-label="关闭小手机"
                onClick={() => onOpenChange(false)}
                className="ml-1 flex size-7 cursor-pointer items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* 屏幕内容 */}
          <div className="flex min-h-0 flex-1 flex-col">
            {screen === 'home' ? (
              <div className="flex-1 px-6 pt-8">
                <div className="grid grid-cols-4 gap-x-4 gap-y-6">
                  {APPS.map((app) => {
                    const Icon = app.icon;
                    return (
                      <button
                        key={app.id}
                        type="button"
                        onClick={() => openApp(app.id)}
                        className="flex cursor-pointer flex-col items-center gap-1.5"
                      >
                        <span
                          className="flex size-14 items-center justify-center rounded-[1rem] text-white shadow-lg"
                          style={{ backgroundColor: app.color }}
                        >
                          <Icon
                            className="size-7"
                            {...(app.iconColor ? { color: app.iconColor } : {})}
                          />
                        </span>
                        <span className="text-xs text-white/90">{app.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : screen === 'wechat' ? (
              <WeChat chatId={chatId} card={card} onBack={() => setScreen('home')} />
            ) : (
              <Album onBack={() => setScreen('home')} />
            )}
          </div>

          {/* 底部小横条：点一下回主屏幕 */}
          <div className="flex shrink-0 justify-center pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)] pt-1">
            <button
              type="button"
              aria-label="回到主屏幕"
              onClick={() => setScreen('home')}
              className="h-1.5 w-32 cursor-pointer rounded-full bg-white/70 transition-colors hover:bg-white"
            />
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
