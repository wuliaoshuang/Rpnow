/**
 * Responsive app shell.
 *
 * Layout rules encoded here:
 *   - < 768px  : single column, bottom navigation with 5 items max (design rule:
 *                bottom nav ≤ 5), safe-area padding for notched phones.
 *   - >= 768px : persistent left rail + content, content max-width for prose.
 *   - >= 1280px: a third column appears for the chat's context panel.
 *
 * The shell itself is a slot target (`app.shell`), so a plugin can replace the
 * entire chrome.
 */

import * as React from 'react';
import {
  BookMarked,
  Bot,
  ChevronLeft,
  IdCard,
  MessageSquare,
  Puzzle,
  Settings as SettingsIcon,
  Sparkles,
  BookOpenText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { vibrate } from '@/lib/haptics';
// (runtime banner removed with the old sub-page header)
import { SLOT, SlotOutlet, useSlot } from '@/core/plugin/slots.js';

export type Route =
  | 'chats'
  | 'chat'
  | 'cards'
  | 'lore'
  | 'presets'
  | 'novel'
  | 'plugins'
  | 'market'
  | 'settings';

export interface NavItem {
  route: Route;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const NAV_ITEMS: NavItem[] = [
  { route: 'chats', label: '聊天', icon: MessageSquare },
  { route: 'cards', label: '角色卡', icon: IdCard },
  { route: 'lore', label: '世界书', icon: BookMarked },
  { route: 'presets', label: '预设', icon: Sparkles },
  { route: 'novel', label: '小说', icon: BookOpenText },
  { route: 'plugins', label: '插件', icon: Puzzle },
  { route: 'settings', label: '设置', icon: SettingsIcon },
];

export interface AppShellProps {
  route: Route;
  onNavigate: (r: Route) => void;
  children: React.ReactNode;
  /** Optional top-bar title. */
  title?: string;
  topbarActions?: React.ReactNode;
  /** Rendered only on wide screens. */
  aside?: React.ReactNode;
  /** Opens the left drawer (chat list / app grid). Shown on every page. */
  onOpenDrawer?: () => void;
  /** This page is a sub-page: show a back chevron instead of the drawer handle. */
  isSubPage?: boolean;
  onBack?: () => void;
}

export function AppShell({ route, onNavigate, children, title, topbarActions, aside, isSubPage, onBack }: AppShellProps) {
  const Topbar = useSlot(SLOT.TOPBAR);
  return (
    <div
      className="flex h-full min-h-0 w-full bg-[var(--rp-bg)] text-[var(--rp-fg)]"
      data-route={route}
    >
      {/* Desktop rail. `SLOT.NAV` appends plugin entries below the core nav. */}
      <nav
        aria-label="主导航"
        className="hidden w-[76px] shrink-0 flex-col items-center gap-1 border-r border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] py-3 md:flex"
      >
        <div className="mb-2 flex size-10 items-center justify-center rounded-xl bg-[var(--rp-accent)] text-[var(--rp-accent-fg)] shadow-sm">
          <Bot className="size-5" aria-hidden="true" />
        </div>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = route === item.route;
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => {
                vibrate('tap');
                onNavigate(item.route);
              }}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex w-full cursor-pointer flex-col items-center gap-1 rounded-lg py-2 text-[10px] font-medium transition-colors',
                active
                  ? 'bg-[var(--rp-accent-soft)] text-[var(--rp-accent)]'
                  : 'text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-elevated)] hover:text-[var(--rp-fg)]',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              {item.label}
            </button>
          );
        })}
        {/* Plugins may append navigation entries here. */}
        <SlotOutlet slot={SLOT.NAV} componentProps={{ route, onNavigate }} />
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* ------------------------------------------------------------- topbar */}
        {route !== 'chat' && (
          <>
            {/*
              Top bar. `min-h-14` rather than a fixed `h-14` so the safe-area padding
              grows the bar instead of squeezing its contents — on a notched phone or
              inside the Android WebView the status bar sits above it, and a fixed
              height would put the title under the clock. `relative` anchors the
              connection panel's dropdown to the bar itself. The immersive chat
              renders its own header over the character art instead.
            */}
            <header className="flex min-h-16 shrink-0 items-center gap-1.5 border-b border-[var(--rp-border)] bg-[var(--rp-bg)]/85 px-3 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md sm:px-4">
          {/*
            Sub-page header (Tavo-style): back chevron + centred title.
            Three-column flex with EQUAL side widths (w-24) — the title stays
            dead-centre by construction, not by absolute positioning. No robot
            icon, no brand block, no gear; chat is one back-tap away.
          */}
          {/* Left slot: back chevron (fixed width, same as the right slot). */}
          <div className="flex w-24 shrink-0 items-center">
            {isSubPage && onBack && (
              <button
                type="button"
                onClick={() => {
                  vibrate('tap');
                  onBack();
                }}
                aria-label="返回上一级"
                title="返回"
                className="flex size-10 cursor-pointer items-center justify-center rounded-lg transition-colors text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)] hover:text-[var(--rp-fg)]"
              >
                <ChevronLeft className="size-6" aria-hidden="true" />
              </button>
            )}
          </div>
          {/* Centre slot: the title, flex-centred vertically by items-center. */}
          <h1 className="min-w-0 flex-1 truncate text-center text-[15.5px] font-semibold leading-tight">
            {title ?? 'RPNow'}
          </h1>
          {/* Right slot: same fixed width as the left, so the centre holds. */}
          <div className="flex w-24 shrink-0 items-center justify-end gap-1.5">
            {topbarActions}
            {Topbar ? <Topbar route={route} onNavigate={onNavigate} /> : null}
          </div>
        </header>
          </>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          <main key={route} className="rp-anim-page min-w-0 flex-1 overflow-hidden">
            {/* Full-shell overlay slot (toasts, floating widgets). */}
            <SlotOutlet slot={SLOT.OVERLAY} componentProps={{ route }} />
            {children}
          </main>
          {/* Gesture-bar inset for every sub-page: the scroll containers give
              up this strip so content never sits under the nav bar. */}
          {route !== 'chat' && (
            <div aria-hidden="true" className="h-[env(safe-area-inset-bottom,0px)] shrink-0" />
          )}
          {aside && (
            <aside
              aria-label="上下文面板"
              className="hidden w-[300px] shrink-0 overflow-y-auto border-l border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/60 xl:block rp-scroll"
            >
              {aside}
            </aside>
          )}
        </div>

      </div>
    </div>
  );
}
