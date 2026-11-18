import * as React from 'react';
const { StrictMode, useEffect, useState } = React;
import { createRoot } from 'react-dom/client';
import './index.css';
import { boot, applyTheme } from './boot.js';
import { useApp } from './state/store.js';
import { runtime } from './lib/runtime.js';
import { AppShell, type Route } from './components/layout/AppShell.js';
import { MarketplacePage } from './pages/MarketplacePage.js';
import { Store } from 'lucide-react';
import { TooltipProvider } from './components/ui/misc.js';
import { Toaster, toast } from './components/ui/toast.js';
import { ConfirmHost } from './components/ui/confirm.js';
import { ChatPage } from './pages/ChatPage.js';
import { PushAside, type PanelSide } from './components/layout/PushAside.js';
import { ChatListPanel } from './components/layout/ChatListPanel.js';
import { SettingsPanel } from './components/layout/SettingsPanel.js';
import { GroupChatSheet } from './components/chat/GroupChatSheet.js';
import { TokenStatsSheet } from './components/chat/TokenStatsSheet.js';
import { CardsPage } from './pages/CardsPage.js';
import { LorePage } from './pages/LorePage.js';
import { PresetsPage } from './pages/PresetsPage.js';
import { NovelPage } from './pages/NovelPage.js';
import { PluginsPage } from './pages/PluginsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { SETTINGS_SECTIONS } from './pages/SettingsHub.js';
import { ConnectionPanel } from './components/layout/ConnectionPanel.js';
import { Button } from './components/ui/button.js';
import { BookOpen, Loader2 } from 'lucide-react';
import { confirmAction } from '@/components/ui/confirm.js';

/**
 * The service worker only exists in a production web build.
 *
 * - Inside a Tauri webview (desktop or Android) the app is served from
 *   `tauri.localhost`, where SW registration always fails.
 * - In `vite dev` there is no `/sw.js` (vite-plugin-pwa emits it at build time),
 *   so registering asks for a file that returns the HTML fallback and logs an
 *   unsupported-MIME-type error.
 *
 * Both cases are skipped; only a production web deployment registers it.
 */
if (runtime.target === 'web' && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell is best-effort; never break the app over it */
    });
  });
}

function App() {
  const [ready, setReady] = useState(false);
  // The chat list is the home screen, like a messaging app; opening a chat
  // switches to the immersive conversation view.
  // 聊天即主页（Tavo 结构）：启动直接进入最近一次会话；聊天列表在左侧抽屉里。
  const [route, setRoute] = useState<Route>('chat');
  const [bootError, setBootError] = useState<string | null>(null);
  // Side panels: which one is pushed open (Tavo's left list / right settings).
  const [panel, setPanel] = useState<PanelSide>(null);
  /** Latest panel state for the popstate handler (which is registered once). */
  const panelRef = React.useRef<PanelSide>(null);
  panelRef.current = panel;
  // Branch panel / prompt inspector live at the app level so the right side
  // panel can open them after it closes. ChatView receives the flags.
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  /** Group-chat builder sheet (opened from the right panel's ＋). */
  const [groupSheetOpen, setGroupSheetOpen] = useState(false);
  /** Per-character token usage sheet (right panel's 统计). */
  const [statsOpen, setStatsOpen] = useState(false);
  /** Settings deep-link section (chat drawer → a specific settings page). */
  const [deepSection, setDeepSection] = useState<string | undefined>(undefined);
  const chats = useApp((s) => s.chats);
  const cards = useApp((s) => s.cards);
  const activeChatId = useApp((s) => s.activeChatId);
  const activeChat =
    chats.find((c) => c.id === activeChatId) ?? [...chats].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const activeCard = cards.find((c) => c.id === activeChat?.cardId);

  /** Sub-page header title (flat route level — one header, no nesting). */
  const routeTitle = React.useMemo(() => {
    if (route === 'settings') {
      return deepSection ? (SETTINGS_SECTIONS.find((s) => s.id === deepSection)?.label ?? '设置') : '设置';
    }
    const labels: Partial<Record<Route, string>> = {
      chats: '聊天',
      cards: '角色卡',
      lore: '世界书',
      presets: '预设',
      novel: '小说',
      plugins: '插件',
      market: '商店',
    };
    return labels[route] ?? 'RPNow';
  }, [route, deepSection]);

  /**
   * Navigation history, so the Android hardware back button (and browser back
   * gesture) walks *up* the app instead of closing it.
   *
   * Android's WebView only routes the back key into page history while the page
   * has entries — otherwise it finishes the Activity. So every navigation pushes
   * an entry, and `popstate` pops our stack. An open dialog/menu wins over
   * navigation: we undo the history step and close the overlay instead.
   */
  const historyRef = React.useRef<Route[]>([]);
  /**
   * `history.forward()` (used to undo a back press that only closed an overlay)
   * fires its own `popstate`. Without this flag that second event would be
   * treated as another back press and navigate again.
   */
  const syntheticPopRef = React.useRef(false);
  /**
   * Flat sub-routes: `#/settings/models` is just the route state + a section
   * string — one level, one header. NO nested router anywhere.
   */
  const navigate = React.useCallback(
    (next: Route, tab?: string) => {
      // Navigating to the page we are already on still fully closes any open
      // side panel — otherwise the tap looks like it did nothing.
      setPanel(null);
      // Settings keeps its section as part of the same flat route level:
      // `#/settings` (hub) ↔ `#/settings/<section>` (sub-page). Switching
      // section while already on settings must still work.
      if (next === 'settings') {
        setDeepSection(tab ?? undefined);
        try {
          window.history.pushState({ rpRoute: 'settings' }, '', tab ? `#/settings/${tab}` : '#/settings');
        } catch {
          /* non-fatal */
        }
        setRoute('settings');
        return;
      }
      if (next === route) {
        return;
      }
      setDeepSection(undefined);
      historyRef.current.push(route);
      // Keep the address bar in sync; the app is still a single HTML document.
      try {
        window.history.pushState({ rpRoute: next }, '', `#${next}`);
      } catch {
        /* non-fatal */
      }
      setRoute(next);
    },
    [route],
  );

  React.useEffect(() => {
    // Parse the flat sub-route from the hash: `#/settings/models` → settings +
    // models section. Single level — the hash is the whole truth.
    const fromHash = (): { r: Route; s?: string } => {
      const h = window.location.hash.replace(/^#\/?/, '');
      if (h.startsWith('settings')) return { r: 'settings', s: h.split('/')[1] };
      return { r: (h as Route) || 'chat' };
    };
    const initial = fromHash();
    try {
      window.history.replaceState(
        { rpRoute: initial.r },
        '',
        initial.r === 'settings' ? (initial.s ? `#/settings/${initial.s}` : '#/settings') : `#${initial.r}`,
      );
    } catch {
      /* ignore */
    }
    setRoute(initial.r);
    setDeepSection(initial.s);
    historyRef.current = [initial.r];
    const onPop = () => {
      if (syntheticPopRef.current) {
        syntheticPopRef.current = false;
        return;
      }
      // An open side panel is the innermost "level" — close it, not the page.
      // Read the state (not the DOM): the panel element is removed once closed,
      // so a DOM probe would miss the very step we are unwinding.
      if (panelRef.current !== null) {
        syntheticPopRef.current = true;
        try {
          window.history.forward();
        } catch {
          /* ignore */
        }
        setPanel(null);
        return;
      }
      // Dialogs/menus rendered by other components still get the Escape path.
      const overlay = document.querySelector('[role="dialog"]:not([aria-hidden="true"]), [role="menu"]');
      if (overlay) {
        syntheticPopRef.current = true;
        try {
          window.history.forward();
        } catch {
          /* ignore */
        }
        overlay.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return;
      }
      // Back = whatever the hash now says (handles settings ↔ settings/models).
      const cur = fromHash();
      setRoute(cur.r);
      setDeepSection(cur.s);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const themeId = useApp((s) => s.settings.themeId);
  const kernel = useApp((s) => s.kernel);

  // One-time boot: kernel, plugins, theme.
  useEffect(() => {
    let cancelled = false;
    boot()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((err) => {
        if (!cancelled) setBootError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-apply the theme whenever the user switches it.
  useEffect(() => {
    if (ready) applyTheme(themeId);
  }, [themeId, ready]);

  if (bootError) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <div className="max-w-md rounded-xl border border-[var(--rp-danger)]/40 bg-[var(--rp-bg-elevated)] p-5 text-center">
          <p className="text-sm font-semibold text-[var(--rp-danger)]">启动失败</p>
          <p className="mt-1.5 text-[12px] text-[var(--rp-fg-muted)]">{bootError}</p>
          <Button className="mt-4" size="sm" onClick={() => location.reload()}>
            重试
          </Button>
        </div>
      </div>
    );
  }

  if (!ready || !kernel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-xl bg-[var(--rp-accent)] text-[var(--rp-accent-fg)]">
          <BookOpen className="size-6" aria-hidden="true" />
        </div>
        <div className="flex items-center gap-2 text-[13px] text-[var(--rp-fg-muted)]">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          正在加载 RPNow…
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      {/* Per-character token usage (right panel → 统计). */}
      <TokenStatsSheet
        open={statsOpen}
        onClose={() => setStatsOpen(false)}
        card={activeCard}
        chats={chats}
      />
      {/* Group-chat builder sheet (opened from the right panel's ＋). */}
      <GroupChatSheet
        open={groupSheetOpen}
        onClose={() => setGroupSheetOpen(false)}
        onCreated={(id) => {
          setGroupSheetOpen(false);
          useApp.getState().setActiveChat(id);
          navigate('chat');
        }}
      />
      {/*
        Push-aside shell: opening a side panel shrinks and slides the page rather
        than covering it. Left = chat list, right = this conversation's settings.
      */}
      <PushAside
        side={panel}
        onDismiss={() => {
          setPanel(null);
        }}
        left={
          <ChatListPanel
            onOpenChat={(id) => {
              useApp.getState().setActiveChat(id);
              setPanel(null);
              navigate('chat');
            }}
            onOpenCards={() => {
              setPanel(null);
              navigate('cards');
            }}
            onNavigate={(target, tab) => {
              setPanel(null);
              navigate(target, tab);
            }}
            onClose={() => setPanel(null)}
          />
        }
        right={
          <SettingsPanel
            chat={activeChat}
            card={activeCard}
            onNavigate={(target, tab) => {
              setPanel(null);
              navigate(target, tab);
            }}
            onOpenGroupChat={() => {
              setPanel(null);
              setGroupSheetOpen(true);
            }}
            onOpenBranches={() => {
              setPanel(null);
              setBranchesOpen(true);
            }}
            onOpenInspector={() => {
              setPanel(null);
              setInspectorOpen(true);
            }}
            onOpenStats={() => {
              setPanel(null);
              setStatsOpen(true);
            }}
            onRestart={async () => {
              if (!activeChat) return;
              const ok = await confirmAction({
                title: '重启对话',
                description: '将清空本次对话，只保留开场白。此操作不可恢复，确定继续吗？',
                confirmText: '重启',
                destructive: true,
              });
              if (!ok) return;
              const greeting = activeChat.messages[0]?.isGreeting ? [activeChat.messages[0]] : activeChat.messages.slice(0, 1);
              void useApp.getState().saveChat({
                ...activeChat,
                messages: greeting.map((m) => ({ ...m })),
                branches: undefined,
                activeBranchId: undefined,
                activation: undefined,
                variables: {},
              });
              setPanel(null);
              navigate('chat');
              toast.success('已重启对话');
            }}
            onToggleFullscreen={() => {
              if (document.fullscreenElement) void document.exitFullscreen();
              else void document.documentElement.requestFullscreen?.();
            }}
            onClearChat={async () => {
              if (!activeChat) return;
              if (!(await confirmAction({ title: '确认操作', description: '清空当前对话？角色卡与设定不会受影响。' }))) return;
              void useApp.getState().saveChat({
                ...activeChat,
                messages: [],
                activation: undefined,
                variables: {},
              });
              setPanel(null);
            }}
          />
        }
      >
        <AppShell
          route={route}
          onNavigate={navigate}
          title={routeTitle}
          topbarActions={
            <>
              {route !== 'market' && route !== 'chat' ? (
                <button
                  type="button"
                  onClick={() => navigate('market')}
                  aria-label="商店"
                  title="商店"
                  className="flex size-9 items-center justify-center rounded-lg text-[var(--rp-fg-muted)] transition-colors hover:bg-[var(--rp-bg-elevated)] hover:text-[var(--rp-fg)]"
                >
                  <Store className="size-4" aria-hidden="true" />
                </button>
              ) : null}
              <ConnectionPanel />
            </>
          }
          isSubPage={route !== 'chat'}
          onBack={() => {
            // Settings sub-page climbs to the hub first; anything else → home.
            if (route === 'settings' && deepSection) navigate('settings');
            else navigate('chat');
          }}
          onOpenDrawer={() => setPanel((p) => (p === 'left' ? null : 'left'))}
        >
          {/* 聊天即主页：聊天视图直接渲染；列表在左侧栏（Tavo 结构）。 */}
          {route === 'chat' && (
            <ChatPage
              onOpenCards={() => navigate('cards')}
              onOpenDrawer={() => setPanel((p) => (p === 'left' ? null : 'left'))}
              onOpenSettings={() => setPanel((p) => (p === 'right' ? null : 'right'))}
              branchesOpen={branchesOpen}
              onBranchesOpenChange={setBranchesOpen}
              inspectorOpen={inspectorOpen}
              onInspectorOpenChange={setInspectorOpen}
              onNavigate={(target, tab) => {
                navigate(target, tab);
              }}
            />
          )}
          {route === 'cards' && <CardsPage onStartChat={() => navigate('chat')} />}
          {route === 'lore' && <LorePage />}
          {route === 'presets' && <PresetsPage />}
          {route === 'novel' && <NovelPage />}
          {route === 'plugins' && <PluginsPage />}
          {route === 'market' && <MarketplacePage />}
          {route === 'settings' && (
            <SettingsPage
              section={deepSection}
              onOpenSection={(id) => navigate('settings', id)}
              onOpenPlugins={() => navigate('plugins')}
              onOpenRoute={(r) => navigate(r)}
            />
          )}
        </AppShell>
      </PushAside>
      <Toaster />
      <ConfirmHost />
    </TooltipProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
