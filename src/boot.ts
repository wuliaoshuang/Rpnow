/**
 * Boot sequence.
 *
 * Order is deliberate:
 *   1. load persisted state (settings, cards, chats…),
 *   2. create the kernel and register RPNow's built-in plugins,
 *   3. load installed `.rpnx` plugins into the kernel,
 *   4. `sync()` — the kernel activates everything whose dependencies exist,
 *   5. apply the active theme to the document.
 *
 * Step 3 happens before step 4 so a user plugin can *precede* a builtin with the
 * same service key; the override stack then restores the builtin on uninstall.
 */

import { useApp } from '@/state/store.js';
import { ServiceRegistry } from '@/core/plugin/registry.js';
import { registerBuiltinPlugins } from '@/core/plugin/builtins.js';
import { RpnxLoader, syncInstalledPlugins, type RPNowDataApi } from '@/core/plugins/loader.js';
import { SERVICE } from '@/core/plugin/kernel-types.js';
import { BUILTIN_THEMES, THEME_MAP } from '@/core/defaults/themes.js';
import { uid } from '@/lib/utils.js';
import type { RPCard } from '@/core/types/card.js';
import type { RPLorebook } from '@/core/types/lorebook.js';
import type { RPPersona } from '@/core/types/chat.js';
import type { RPCompletionPreset } from '@/core/types/preset.js';

/** Apply the active theme's tokens and CSS to the document. */
export function applyTheme(themeId: string): void {
  const theme = THEME_MAP.get(themeId) ?? BUILTIN_THEMES[0];
  const root = document.documentElement;
  for (const [k, v] of Object.entries(theme.tokens)) root.style.setProperty(k, v);
  root.classList.toggle('dark', theme.mode === 'dark');
  let tag = document.getElementById('rpnow-theme-css') as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = 'rpnow-theme-css';
    document.head.appendChild(tag);
  }
  // Plugin themes may add CSS; the id lets us replace it wholesale on switch.
  tag.textContent = `:root{${Object.entries(theme.tokens)
    .map(([k, v]) => `${k}:${v}`)
    .join(';')}}\n${theme.css ?? ''}`;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme.tokens['--rp-bg'] ?? '#1a1520');

  // Tell the Android shell which glyph colour the status bar needs. Light
  // themes need dark glyphs, dark themes need light ones. The bridge is
  // attached by MainActivity (addJavascriptInterface); localStorage is the
  // fallback the shell re-reads on resume.
  try {
    localStorage.setItem('rpnow:statusbar-style', theme.mode === 'light' ? 'light' : 'dark');
  } catch {
    /* private mode may block storage */
  }
  const native = (window as unknown as { RPNowNative?: { setStyle: (mode: string) => void } }).RPNowNative;
  try {
    native?.setStyle(theme.mode === 'light' ? 'light' : 'dark');
  } catch {
    /* bridge not attached yet (first frames) — boot() retries below */
  }
}

/**
 * Keep the theme in step across tabs.
 *
 * RP-Hub syncs its appearance through the `storage` event; the same applies
 * here so a theme picked in one tab is not stale in another.
 */
export function installThemeSync(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== 'rpnow:settings') return;
    try {
      const parsed = JSON.parse(event.newValue ?? '') as { themeId?: string } | null;
      if (parsed?.themeId) applyTheme(parsed.themeId);
    } catch {
      /* a partial write is not a theme change */
    }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** Build the plugin data API bound to the app store. */
function createDataApi(): RPNowDataApi {
  const s = () => useApp.getState();
  return {
    // Documented escape hatch for state the typed surface does not cover.
    getState: () => useApp.getState(),
    cards: {
      list: () => s().cards,
      get: (id) => s().cards.find((c) => c.id === id),
      async add(card) {
        const now = Date.now();
        const full: RPCard = {
          id: card.id ?? uid('c'),
          spec: card.spec ?? 'v2',
          specVersion: card.specVersion ?? '2.0',
          data: card.data,
          avatar: card.avatar,
          createdAt: card.createdAt ?? now,
          updatedAt: now,
          sourceFormat: 'json-v2',
        };
        await s().addCard(full);
        return full;
      },
      update: (id, patch) => s().updateCard(id, patch),
      remove: (id) => s().removeCard(id),
    },
    chats: {
      list: () => s().chats,
      get: (id) => s().chats.find((c) => c.id === id),
      save: (chat) => s().saveChat(chat),
      async appendMessage(chatId, role, content) {
        const chat = s().chats.find((c) => c.id === chatId);
        if (!chat) return;
        await s().saveChat({
          ...chat,
          messages: [
            ...chat.messages,
            { id: uid('m'), role, content, createdAt: Date.now(), meta: { plugin: true } },
          ],
        });
      },
      async replaceLastAssistant(chatId, content) {
        const chat = s().chats.find((c) => c.id === chatId);
        if (!chat) return;
        const idx = [...chat.messages].reverse().findIndex((m) => m.role === 'assistant');
        if (idx === -1) return;
        const real = chat.messages.length - 1 - idx;
        const messages = chat.messages.map((m, i) => (i === real ? { ...m, content } : m));
        await s().saveChat({ ...chat, messages });
      },
    },
    lorebooks: {
      list: () => s().lorebooks,
      get: (id) => s().lorebooks.find((b) => b.id === id),
      save: (book) => s().saveLorebook(book as RPLorebook),
      remove: (id) => s().removeLorebook(id),
      async enableForChat(chatId, bookId) {
        const chat = s().chats.find((c) => c.id === chatId);
        if (!chat) return;
        if (chat.lorebookIds.includes(bookId)) return;
        await s().saveChat({ ...chat, lorebookIds: [...chat.lorebookIds, bookId] });
      },
    },
    presets: {
      list: () => s().presets,
      get: (id) => s().presets.find((p) => p.id === id),
      save: (p: RPCompletionPreset) => s().savePreset(p),
      remove: (id) => s().removePreset(id),
    },
    personas: {
      list: () => s().personas,
      save: (p: RPPersona) => s().savePersona(p),
    },
    settings: {
      get: <T,>(key: string, fallback?: T): T => {
        const v = (s().settings as unknown as Record<string, unknown>)[key];
        return (v ?? fallback) as T;
      },
      set: (key, value) => s().setSettings({ [key]: value } as never),
    },
    events: {
      on: (event, handler) => {
        // Reuse the kernel's bus so plugins and core share one channel.
        const kernel = s().kernel;
        return kernel ? kernel.events.on(event, handler) : { dispose: () => {} };
      },
      emit: (event, payload) => s().kernel?.events.emit(event, payload),
    },
  };
}

let booted = false;

/**
 * Bring installed plugins into the running kernel without a page reload.
 *
 * Exposed so the plugin manager can call it right after installing or
 * uninstalling: previously the user had to reload the app for a plugin to take
 * effect, which is wrong for a plug-and-play model.
 *
 * The loader is read from the store (not a module variable) because Vite HMR
 * replaces this module and would otherwise reset a module-level reference to
 * `null` while the kernel keeps running.
 */
export async function reloadInstalledPlugins(): Promise<void> {
  const loader = useApp.getState().pluginLoader;
  if (!loader) return;
  try {
    await syncInstalledPlugins(loader);
  } catch (err) {
    console.error('[boot] 插件重新加载失败', err);
  }
}

/** Start the app. Safe to call once; subsequent calls are no-ops. */
export async function boot(): Promise<ServiceRegistry> {
  const store = useApp.getState();
  if (booted && store.kernel) return store.kernel;
  booted = true;

  await store.boot();

  const kernel = new ServiceRegistry();
  // Give every plugin (builtin or installed) the same data surface.
  const data = createDataApi();
  kernel.dataApi = data;
  useApp.setState({ kernel });

  registerBuiltinPlugins(kernel, {
    getConnections: () => useApp.getState().llmConnections,
    getImageConnections: () => useApp.getState().imageConnections,
    getSettings: () => useApp.getState().settings,
  });

  // Installed user plugins, registered before sync so they can win service keys.
  const loader = new RpnxLoader({
    kernel,
    data,
    getEnabled: (id) => useApp.getState().settings.plugins?.[id] !== false,
  });
  useApp.setState({ pluginLoader: loader });
  try {
    await syncInstalledPlugins(loader);
  } catch (err) {
    console.error('[boot] 插件加载失败', err);
  }

  await kernel.sync();

  applyTheme(useApp.getState().settings.themeId);

  // The Android bridge attaches on the first focus pass, which can be after the
  // initial theme was applied — re-notify once the page has settled.
  window.setTimeout(() => {
    const t = THEME_MAP.get(useApp.getState().settings.themeId) ?? BUILTIN_THEMES[0];
    try {
      (window as unknown as { RPNowNative?: { setStyle: (m: string) => void } }).RPNowNative
        ?.setStyle(t.mode === 'light' ? 'light' : 'dark');
    } catch {
      /* still not attached; the shell reads localStorage as fallback */
    }
  }, 1200);

  // Keep the document theme in step with settings and theme-service swaps.
  kernel.observe(SERVICE.THEME, () => {
    applyTheme(useApp.getState().settings.themeId);
  });
  // And with the same setting changed in another tab.
  installThemeSync();

  return kernel;
}
