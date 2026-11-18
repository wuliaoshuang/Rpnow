/**
 * Plugin runtime.
 *
 * Bridges installed `.rpnx` packages to the kernel: reads the ZIP, validates the
 * manifest, `import()`s the module, and registers it. Because activation is
 * driven by the kernel, a failed `apply()` cannot leave the app half-broken —
 * the kernel tears the plugin's services back down.
 *
 * The loader is also the place where the *data API* handed to plugins is built:
 * plugins get a read/write view of cards, chats, world books and presets, which
 * is how a plugin can insert a preset or a lorebook that then affects chats.
 */

import { ServiceRegistry } from '../plugin/registry.js';
import type { PluginManifest, RPPlugin, RPPluginContext, Disposable } from '../plugin/kernel-types.js';
import { listInstalled, saveInstalled, toModuleUrl, type InstalledPlugin } from './rpnx.js';
import { activateSTExtension } from './st-bridge.js';
import { isSTCompatEnabled } from '../st-compat.js';
import { removeSlotsByOwner, registerSlot, SLOT } from '../plugin/slots.js';
import { SCOPE_ATTR, injectScopedStyles } from './scoped-styles.js';
import * as ReactRuntime from 'react';
import type { RPCard } from '../types/card.js';
import type { RPLorebook } from '../types/lorebook.js';
import type { RPChat, RPPersona } from '../types/chat.js';
import type { RPCompletionPreset } from '../types/preset.js';

/** Stylesheets injected by each plugin, so deactivation can drop them. */
const scopedStyleDisposers = new Map<string, Set<() => void>>();

/** Drops every scoped stylesheet the plugin injected. */
function removeScopedStylesByOwner(owner: string): void {
  const set = scopedStyleDisposers.get(owner);
  if (!set) return;
  for (const dispose of set) {
    try {
      dispose();
    } catch {
      /* already gone */
    }
  }
  scopedStyleDisposers.delete(owner);
}

/**
 * Attach the ergonomic API documented in `docs/PLUGIN-DEVELOPMENT.md`.
 *
 * Everything here is *additive*: the kernel's own `get/provide/observe/use`
 * surface is untouched. These helpers exist so plugin authors never import
 * RPNow internals — `ctx.mountSlot` / `ctx.injectCss` are the documented path,
 * and the scoping in `injectCss` is what stops a plugin stylesheet from
 * repainting the whole application.
 */
function attachConvenienceApi(pluginId: string, ctx: RPPluginContext): void {
  const c = ctx as RPPluginContext & {
    mountSlot?: (slot: string, component: unknown, options?: { order?: number; id?: string }) => Disposable;
    injectCss?: (css: string, options?: { scope?: string }) => Disposable;
    React?: unknown;
    SLOT?: Record<string, string>;
  };

  c.React = ReactRuntime;
  c.SLOT = SLOT;

  c.mountSlot = (slot: string, component: unknown, options: { order?: number; id?: string } = {}) => {
    const off = registerSlot(slot, component as never, {
      order: options.order,
      owner: pluginId,
      id: options.id,
    });
    return { dispose: off } as Disposable;
  };

  c.injectCss = (css: string, options: { scope?: string } = {}) => {
    const hostSelector = options.scope ?? `[${SCOPE_ATTR}="${pluginId}"]`;
    const sheet = injectScopedStyles({
      pluginId,
      hostSelector,
      css,
      attrs: { 'rpnow-plugin-style': pluginId },
    });
    // Remember it so deactivation removes it even if the plugin forgets.
    let set = scopedStyleDisposers.get(pluginId);
    if (!set) {
      set = new Set();
      scopedStyleDisposers.set(pluginId, set);
    }
    const dispose = () => {
      sheet.dispose();
      set!.delete(dispose);
    };
    set.add(dispose);
    return { dispose } as Disposable;
  };
}

/** Data surface a plugin may use. Every method is a thin app-store adapter. */
export interface RPNowDataApi {
  /**
   * Raw store snapshot, as documented (`ctx.rpnow.getState()`).
   *
   * Prefer the typed collections below for reads; this exists for anything the
   * typed surface does not cover (settings, personas, memories, connections).
   * Kept loosely typed on purpose: it is an escape hatch, not the primary API.
   */
  getState(): unknown;
  cards: {
    list(): RPCard[];
    get(id: string): RPCard | undefined;
    add(card: Partial<RPCard> & { data: RPCard['data'] }): Promise<RPCard>;
    update(id: string, patch: Partial<RPCard>): Promise<void>;
    remove(id: string): Promise<void>;
  };
  chats: {
    list(): RPChat[];
    get(id: string): RPChat | undefined;
    save(chat: RPChat): Promise<void>;
    appendMessage(chatId: string, role: RPChat['messages'][number]['role'], content: string): Promise<void>;
    /** Rewrite the last assistant message (used by post-processing plugins). */
    replaceLastAssistant(chatId: string, content: string): Promise<void>;
  };
  lorebooks: {
    list(): RPLorebook[];
    get(id: string): RPLorebook | undefined;
    save(book: RPLorebook): Promise<void>;
    remove(id: string): Promise<void>;
    /** Enable a book for a chat so it affects prompts. */
    enableForChat(chatId: string, bookId: string): Promise<void>;
  };
  presets: {
    list(): RPCompletionPreset[];
    get(id: string): RPCompletionPreset | undefined;
    save(preset: RPCompletionPreset): Promise<void>;
    remove(id: string): Promise<void>;
  };
  personas: {
    list(): RPPersona[];
    save(p: RPPersona): Promise<void>;
  };
  settings: {
    get<T>(key: string, fallback?: T): T;
    set(key: string, value: unknown): void;
  };
  events: {
    on(event: string, handler: (payload: unknown) => void): Disposable;
    emit(event: string, payload?: unknown): void;
  };
}

/** Extended context handed to `.rpnx` plugins. */
export interface RpnxPluginContext extends RPPluginContext {
  rpnow: RPNowDataApi;
}

export interface RpnxModule {
  manifest?: PluginManifest;
  apply(ctx: RpnxPluginContext): void | (() => void) | Promise<void | (() => void)>;
  default?: unknown;
}

export interface LoaderDeps {
  kernel: ServiceRegistry;
  data: RPNowDataApi;
  getEnabled(id: string): boolean;
}

/** Inject the data API into the plugin context the kernel creates. */
export class RpnxLoader {
  private modules = new Map<string, { revoke: () => void }>();
  private contexts = new Map<string, RPPluginContext>();
  private deps: LoaderDeps;

  constructor(deps: LoaderDeps) {
    this.deps = deps;
  }

  /**
   * Register one installed plugin with the kernel.
   *
   * The factory resolves `plugin.js` to a module URL at activation time (not at
   * install time), so a plugin that fails to import fails *in the kernel* with
   * a visible error state instead of crashing the boot.
   */
  register(record: InstalledPlugin): void {
    const { manifest } = record;
    const self = this;

    /*
     * SillyTavern extensions are plain scripts, not ES modules with `apply()`.
     * They run through the ST bridge instead: CSS is injected and the script is
     * evaluated with a `SillyTavern` shim over our own services.
     */
    const isST = (manifest as { kind?: string }).kind === 'st-extension';

    this.deps.kernel.register(
      manifest,
      async () => {
        /*
         * ST (SillyTavern) extensions are hidden by default. Any previously
         * installed one now fails loudly instead of half-working through the
         * compatibility shim; enable `settings.stCompat.enabled` to restore.
         */
        if (isST && !isSTCompatEnabled()) {
          throw new Error(
            '该插件是 SillyTavern 扩展，RPNow 当前暂不支持（兼容层已停用）。请更换为 .rpnx 插件。',
          );
        }
        if (isST) {
          const styles = record.assets?.['__st__/styles.css'];
          // Multi-file extensions ship their module graph as assets.
          const modules: Record<string, string> = {};
          for (const [path, src] of Object.entries(record.assets ?? {})) {
            const prefix = '__st__/modules/';
            if (path.startsWith(prefix)) modules[path.slice(prefix.length)] = src;
          }
          /*
           * Rebuild the manifest for the bridge, merging in the ORIGINAL ST
           * manifest text saved at install time. `hooks` (and friends) must
           * survive; `display_name`/`version` are RPNow-side conveniences.
           */
          let stRaw: Record<string, unknown> = {};
          try {
            const rawText = record.assets?.['__st__/manifest.json'];
            if (typeof rawText === 'string' && rawText.trim()) {
              stRaw = JSON.parse(rawText) as Record<string, unknown>;
            }
          } catch {
            /* malformed embedded manifest — fall back to the summary below */
          }
          const handle = await activateSTExtension(manifest.id, {
            manifest: {
              ...stRaw,
              display_name: manifest.name,
              version: manifest.version,
              description: manifest.description,
              // Entry file inside the package, needed to resolve siblings.
              js: (record as { stEntry?: string }).stEntry ?? 'index.js',
            },
            entryPath: (record as { stEntry?: string }).stEntry ?? 'index.js',
            script: record.code,
            styles,
            modules: Object.keys(modules).length ? modules : undefined,
          });
          return {
            manifest,
            apply: async () => {
              // ST extensions do their own setup at evaluation time; the kernel
              // keeps this slot so enable/disable and uninstall stay uniform.
            },
            dispose: handle.dispose,
          } as unknown as RPPlugin;
        }

        const { url, revoke } = toModuleUrl(record.code);
        self.modules.set(manifest.id, { revoke });
        let mod: RpnxModule;
        try {
          mod = (await import(/* @vite-ignore */ url)) as RpnxModule;
        } catch (err) {
          revoke();
          self.modules.delete(manifest.id);
          throw new Error(`无法加载 plugin.js：${err instanceof Error ? err.message : String(err)}`);
        }
        const apply = mod.apply ?? (mod.default as RpnxModule | undefined)?.apply;
        if (typeof apply !== 'function') {
          throw new Error('plugin.js 没有导出 apply(ctx) 函数');
        }

        const plugin: RPPlugin = {
          manifest,
          apply: async (ctx: RPPluginContext) => {
            self.contexts.set(manifest.id, ctx);
            // The kernel already exposes the data API; a package may not
            // override it with its own object.
            const extended = ctx as RpnxPluginContext;
            if (!extended.rpnow) extended.rpnow = self.deps.data;
            attachConvenienceApi(manifest.id, extended);
            /*
             * IMPORTANT: cleanup must run when the plugin is *disposed*, not
             * when `apply` returns. Running it in a `finally` here deleted every
             * slot and stylesheet the plugin had just registered — activation
             * looked successful while nothing reached the screen.
             *
             * So: on success we hand the cleanup back to the kernel; only on
             * failure do we tear down immediately.
             */
            let userCleanup: unknown;
            try {
              userCleanup = await apply.call(mod, extended);
            } catch (err) {
              removeSlotsByOwner(manifest.id);
              removeScopedStylesByOwner(manifest.id);
              self.contexts.delete(manifest.id);
              throw err;
            }
            return () => {
              try {
                if (typeof userCleanup === 'function') (userCleanup as () => void)();
                else if (userCleanup && typeof (userCleanup as Disposable).dispose === 'function') {
                  (userCleanup as Disposable).dispose();
                }
              } finally {
                removeSlotsByOwner(manifest.id);
                removeScopedStylesByOwner(manifest.id);
                self.contexts.delete(manifest.id);
              }
            };
          },
        };
        return plugin;
      },
      'installed',
      this.deps.getEnabled(manifest.id) && record.enabled,
    );
  }

  /** Release module URLs for plugins no longer registered. */
  dispose(id: string): void {
    this.modules.get(id)?.revoke();
    this.modules.delete(id);
  }

  /** True when this plugin id is already registered on the kernel. */
  isKnown(id: string): boolean {
    return Boolean(this.deps.kernel.record(id));
  }

  /**
   * Pull the stored enable flag into the kernel record.
   *
   * `setEnabled()` persists but leaves the in-memory record untouched, so a
   * stored `false` would otherwise be ignored by the next `sync()`.
   */
  setStoredEnabled(id: string, enabled: boolean): void {
    this.deps.kernel.setStoredEnabled(id, enabled);
  }

  /** Register stored plugins and reconcile the kernel graph. */
  async sync(): Promise<void> {
    await this.deps.kernel.sync();
  }
}

/** Load every stored plugin into the kernel. Returns the records. */
export async function loadInstalledPlugins(loader: RpnxLoader): Promise<InstalledPlugin[]> {
  const records = await listInstalled();
  for (const r of records) loader.register(r);
  return records;
}

/**
 * Activate every installed plugin **without reloading the page**.
 *
 * Registration happened once at boot, so a plugin installed afterwards has to
 * be picked up here: anything the kernel already knows is left alone, the rest
 * is registered and then the graph is reconciled. This is what makes
 * "install → it just works" true instead of requiring a reload.
 */
export async function syncInstalledPlugins(loader: RpnxLoader): Promise<InstalledPlugin[]> {
  const records = await listInstalled();
  for (const r of records) {
    // The kernel holds an in-memory `enabled` flag that only changes through
    // `kernel.setEnabled`. A disable that went through `setEnabled()` (which
    // persists but does not touch the kernel) therefore never reached the
    // record — so reconcile it here, otherwise the plugin stays active.
    loader.setStoredEnabled(r.manifest.id, r.enabled);
    if (!loader.isKnown(r.manifest.id)) loader.register(r);
  }
  await loader.sync();
  return records;
}

export async function persistEnabled(id: string, enabled: boolean): Promise<void> {
  const list = await listInstalled();
  await saveInstalled(list.map((p) => (p.manifest.id === id ? { ...p, enabled } : p)));
}
