/**
 * MiniPhone — “小手机”：应用里的一部模拟手机。
 *
 * 目前只有一个应用：微信。以后加新应用时往 `apps` 数组里加一项即可，
 * 再在 `screen` 联合类型里加一个分支。
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { BatteryMedium, MessageCircle, Signal, Wifi, X } from 'lucide-react';
import { WeChat } from './WeChat.js';

type Screen = 'home' | 'wechat';

interface PhoneApp {
  id: string;
  name: string;
  /** 圆角图标的背景色。 */
  color: string;
  icon: React.ComponentType<{ className?: string }>;
}

const APPS: PhoneApp[] = [
  { id: 'wechat', name: '微信', color: '#07C160', icon: MessageCircle },
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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [screen, setScreen] = React.useState<Screen>('home');
  const clock = useClock();

  if (!open) return null;

  const openApp = (id: string) => {
    if (id === 'wechat') setScreen('wechat');
  };

  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60">
      {/* 手机框：390px 宽的手机上铺满全屏；桌面端是带圆角与边框的手机造型。 */}
      <div className="relative flex h-full w-full max-w-[390px] flex-col overflow-hidden bg-neutral-950 text-white sm:h-[min(844px,calc(100dvh-2rem))] sm:rounded-[2.5rem] sm:ring-8 sm:ring-neutral-800">
        {/* 状态栏 */}
        <div className="flex shrink-0 items-center justify-between px-5 pt-[calc(env(safe-area-inset-top,0px)+0.5rem)] pb-1 text-white">
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
                        <Icon className="size-7" />
                      </span>
                      <span className="text-xs text-white/90">{app.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <WeChat onBack={() => setScreen('home')} />
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
    </div>,
    document.body,
  );
}
