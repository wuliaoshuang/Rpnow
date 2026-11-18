/**
 * The plugin kernel: a dependency-aware service registry with reload cascades.
 *
 * Key invariant: a plugin may only reach services that existed when it
 * activated. When a dependency provider is replaced or removed, every dependent
 * is disposed first, then the provider swaps, then dependents are re-activated
 * in dependency order. That is what makes "install a theme → it replaces the
 * default theme with no reload" work without the app tearing itself down:
 * only the theme's dependents churn.
 */

import {
  KERNEL_API_VERSION,
  type PluginConfigStore,
  type PluginEvents,
  type PluginId,
  type PluginLogger,
  type PluginManifest,
  type PluginRecord,
  type RPPlugin,
  type RPPluginContext,
  type ServiceHandle,
} from './kernel-types.js';

interface Entry {
  record: PluginRecord;
  plugin?: RPPlugin;
  cleanup?: () => void;
  disposables: Array<() => void>;
  /** Disposables returned by `observe` so we can detach them on dispose. */
  observers: Array<() => void>;
  services: Set<string>;
}

type Listener = (payload: unknown) => void;

export class ServiceRegistry {
  /** key → provider plugin id */
  private owners = new Map<string, PluginId>();
  /** key → value */
  private values = new Map<string, unknown>();
  /** key → listeners */
  private listeners = new Map<string, Set<Listener>>();
  private entries = new Map<PluginId, Entry>();
  private eventListeners = new Map<string, Set<Listener>>();
  private log: PluginLogger;
  /**
   * Data API handed to every plugin context. Set by the host after the kernel
   * exists, so plugins (built-in or installed) can read/write app data without
   * importing the store.
   */
  dataApi?: unknown;

  constructor(logger?: PluginLogger) {
    this.log = logger ?? defaultLogger;
  }

  // ---------------------------------------------------------------- services

  get<T = unknown>(key: string): T | undefined {
    return this.values.get(key) as T | undefined;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  /** All currently provided keys. */
  keys(): string[] {
    return [...this.values.keys()];
  }

  observe<T = unknown>(key: string, handler: (value: T | undefined) => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    const fn = handler as Listener;
    set.add(fn);
    return () => {
      this.listeners.get(key)?.delete(fn);
    };
  }

  private notify(key: string): void {
    const set = this.listeners.get(key);
    if (!set) return;
    const value = this.values.get(key);
    for (const fn of [...set]) {
      try {
        fn(value);
      } catch (err) {
        this.log.error(`[kernel] observer of "${key}" threw`, err);
      }
    }
  }

  // ------------------------------------------------------------------ events

  /**
   * Flatten a manifest `config` descriptor into `{ key: default }`.
   *
   * Two shapes are accepted (both are what the guide documents):
   *   `{ "apiKey": { "type": "string", "default": "…" } }`
   *   `{ "apiKey": "…" }`
   * Entries without a usable default are skipped.
   */
  private configDefaults(manifest: PluginManifest): Record<string, unknown> {
    const raw = manifest.config;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(raw as Record<string, unknown>)) {
      if (spec && typeof spec === 'object') {
        const d = (spec as Record<string, unknown>).default;
        if (d !== undefined) out[key] = d;
      } else if (spec !== undefined) {
        out[key] = spec;
      }
    }
    return out;
  }

  readonly events: PluginEvents = {
    on: (event, handler) => {
      let set = this.eventListeners.get(event);
      if (!set) {
        set = new Set();
        this.eventListeners.set(event, set);
      }
      const fn = handler as Listener;
      set.add(fn);
      return {
        dispose: () => {
          this.eventListeners.get(event)?.delete(fn);
        },
      };
    },
    emit: (event, payload) => {
      const set = this.eventListeners.get(event);
      if (!set) return;
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          this.log.error(`[kernel] event handler for "${event}" threw`, err);
        }
      }
    },
  };

  // ------------------------------------------------------------ registration

  /**
   * Register a plugin. Registration does not activate it; call
   * {@link activate} (or {@link sync}) after the manifest graph is complete.
   */
  register(
    manifest: PluginManifest,
    factory: () => Promise<RPPlugin>,
    origin?: PluginRecord['origin'],
    enabled = true,
    bundleId?: string,
  ): void {
    if (this.entries.has(manifest.id)) {
      throw new Error(`[kernel] duplicate plugin id "${manifest.id}"`);
    }
    if (manifest.apiVersion > KERNEL_API_VERSION) {
      this.log.warn(
        `[kernel] plugin "${manifest.id}" targets API v${manifest.apiVersion} > v${KERNEL_API_VERSION}`,
      );
    }
    // Classification order: explicit argument, then the manifest's own flag,
    // then the id convention RPNow's core uses (`rpnow.core.*`). Bootstrap
    // registrations pass neither, so the convention is what keeps them from
    // being reported as user-installed plugins.
    const effectiveOrigin: PluginRecord['origin'] =
      origin ?? (manifest.builtin || manifest.id.startsWith('rpnow.core.') ? 'builtin' : 'installed');
    this.entries.set(manifest.id, {
      record: {
        manifest,
        factory,
        state: 'registered',
        enabled,
        origin: effectiveOrigin,
        bundleId,
      },
      disposables: [],
      observers: [],
      services: new Set(),
    });
  }

  records(): PluginRecord[] {
    return [...this.entries.values()].map((e) => e.record);
  }

  record(id: PluginId): PluginRecord | undefined {
    return this.entries.get(id)?.record;
  }

  /**
   * Overwrite the in-memory `enabled` flag from storage.
   *
   * The kernel's flag is authoritative for activation, but it only changes via
   * `setEnabled`. A caller that persisted `false` without going through the
   * kernel would otherwise keep the plugin active.
   */
  setStoredEnabled(id: PluginId, enabled: boolean): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.record.enabled = enabled;
    /*
     * Leave `state` alone when disabling: `sync()` looks for
     * `!enabled && state === 'active'` to run the teardown, and clearing the
     * state here would skip it (slots and styles stayed on screen).
     */
  }

  /** Which plugin currently provides `key`. */
  providerOf(key: string): PluginId | undefined {
    return this.owners.get(key);
  }

  /** Plugins that `uses` this key (direct dependents). */
  dependentsOf(key: string): PluginId[] {
    return this.records()
      .filter((r) => r.enabled && (r.manifest.uses ?? []).includes(key))
      .map((r) => r.manifest.id);
  }

  /**
   * Every plugin that must be torn down before `id` can be: anything that
   * `uses` a service `id` currently provides, transitively.
   *
   * Cascading by provider (not by service key) is what makes "disable a theme
   * plugin" also disable the plugin that themed the composer on top of it.
   */
  dependentsOfPlugin(id: PluginId): PluginId[] {
    const result = new Set<PluginId>();
    const visit = (providerId: PluginId) => {
      const entry = this.entries.get(providerId);
      const keys = new Set<string>([
        ...(entry?.services ?? []),
        ...(entry?.record.manifest.provides ?? []),
      ]);
      for (const r of this.records()) {
        if (r.manifest.id === providerId || result.has(r.manifest.id)) continue;
        const uses = r.manifest.uses ?? [];
        if (uses.some((k) => keys.has(k))) {
          result.add(r.manifest.id);
          visit(r.manifest.id);
        }
      }
    };
    visit(id);
    return [...result];
  }

  // -------------------------------------------------------------- activation

  private missingDeps(manifest: PluginManifest): string[] {
    const uses = manifest.uses ?? [];
    return uses.filter((key) => {
      const owner = this.owners.get(key);
      return !owner || owner === manifest.id;
    });
  }

  private buildContext(entry: Entry): RPPluginContext {
    const self = entry.record.manifest.id;
    const kernel = this;
    const config: PluginConfigStore = {
      get: <T = unknown>() => {
        const settings = kernel.get('settings') as
          | { getPluginConfig?: (id: string) => unknown }
          | undefined;
        const stored = (settings?.getPluginConfig?.(self) ?? {}) as Record<string, unknown>;
        /*
         * Merge the manifest-declared defaults. Without this, a plugin author
         * writing `"default": "https://api.example.com"` in `manifest.config`
         * would still read `undefined` until the user touched the field — the
         * guide promises defaults are already applied.
         */
        return { ...kernel.configDefaults(entry.record.manifest), ...stored } as T;
      },
      set: async (value) => {
        const settings = kernel.get('settings') as
          | { setPluginConfig?: (id: string, v: unknown) => Promise<void> }
          | undefined;
        await settings?.setPluginConfig?.(self, value);
      },
      onChange: (handler) => {
        const off = kernel.observe(`settings:${self}`, handler);
        return { dispose: off };
      },
    };
    const scoped: PluginLogger = {
      debug: (...a) => this.log.debug(`[${self}]`, ...a),
      info: (...a) => this.log.info(`[${self}]`, ...a),
      warn: (...a) => this.log.warn(`[${self}]`, ...a),
      error: (...a) => this.log.error(`[${self}]`, ...a),
    };
    return {
      get: <T>(key: string) => this.get<T>(key),
      provide: <T>(key: string, value: T) => this.provideFor(entry, key, value),
      observe: <T>(key: string, handler: (v: T | undefined) => void) => {
        const off = this.observe<T>(key, handler);
        entry.observers.push(off);
        return { dispose: off };
      },
      use: (d) => {
        const fn = typeof d === 'function' ? d : () => d.dispose();
        entry.disposables.push(fn);
      },
      events: this.events,
      config,
      logger: scoped,
      manifest: entry.record.manifest,
      rpnow: this.dataApi,
      requestActivation: async (id, enabled) => {
        await this.setEnabled(id, enabled);
      },

      /*
       * Convenience aliases documented in docs/PLUGIN-DEVELOPMENT.md.
       * They are thin wrappers over the semantic API above, so the two styles
       * can be mixed without any behavioural difference.
       */
      log: (...args: unknown[]) => this.log.info(`[${self}]`, ...args),
      on: (event: string, handler: (payload: unknown) => void) => {
        const off = this.events.on(event, handler);
        entry.observers.push(() => off.dispose());
        return off;
      },
      /** Declare a runtime dependency on a service (surfaces as `pending`). */
      requires: (...keys: string[]) => {
        const manifest = entry.record.manifest;
        const next = [...new Set([...(manifest.uses ?? []), ...keys])];
        if (next.length === (manifest.uses ?? []).length) return;
        entry.record.manifest = { ...manifest, uses: next };
      },
      /** Read this plugin's config with defaults merged. */
      readConfig: <T = Record<string, unknown>>(): T => config.get<T>(),
    };
  }

  private provideFor<T>(entry: Entry, key: string, value: T): ServiceHandle<T> {
    const self = entry.record.manifest.id;
    const prev = this.owners.get(key);
    if (prev && prev !== self) {
      // Last provider wins; the displaced value stays as a stack so disposing
      // the override restores the previous implementation.
      const stack = this.overrideStacks.get(key) ?? [];
      this.overrideStacks.set(key, stack);
      stack.push({ provider: prev, value: this.values.get(key) });
    }
    this.owners.set(key, self);
    this.values.set(key, value);
    entry.services.add(key);
    this.notify(key);
    let disposed = false;
    return {
      key,
      provider: self,
      value,
      dispose: () => {
        if (disposed) return;
        disposed = true;
        this.releaseService(entry, key);
      },
    };
  }

  private overrideStacks = new Map<string, Array<{ provider: PluginId; value: unknown }>>();

  private releaseService(entry: Entry, key: string): void {
    entry.services.delete(key);
    if (this.owners.get(key) !== entry.record.manifest.id) return;
    const stack = this.overrideStacks.get(key);
    const restored = stack?.pop();
    if (restored) {
      this.owners.set(key, restored.provider);
      this.values.set(key, restored.value);
    } else {
      this.owners.delete(key);
      this.values.delete(key);
    }
    this.notify(key);
  }

  async activate(id: PluginId): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`[kernel] unknown plugin "${id}"`);
    if (entry.record.state === 'active' || entry.record.state === 'activating') return;
    if (!entry.record.enabled) return;

    const missing = this.missingDeps(entry.record.manifest);
    if (missing.length) {
      entry.record.state = 'pending';
      entry.record.error = `缺少依赖服务: ${missing.join(', ')}`;
      return;
    }

    entry.record.state = 'activating';
    try {
      const plugin = await entry.record.factory();
      // Re-check after await: dependencies may have vanished while loading.
      const missingAfter = this.missingDeps(entry.record.manifest);
      if (missingAfter.length) {
        entry.record.state = 'pending';
        entry.record.error = `依赖在加载期间失效: ${missingAfter.join(', ')}`;
        return;
      }
      entry.plugin = plugin;
      const ctx = this.buildContext(entry);
      const cleanup = await plugin.apply(ctx);
      // Accept a bare function or a Disposable as the cleanup handle; a plugin
      // whose last statement is `ctx.provide(...)` returns a ServiceHandle,
      // which the kernel already tracks, so it is ignored here.
      if (typeof cleanup === 'function') entry.cleanup = cleanup;
      else if (cleanup && typeof (cleanup as { dispose?: unknown }).dispose === 'function') {
        entry.cleanup = () => (cleanup as { dispose: () => void }).dispose();
      }
      entry.record.state = 'active';
      entry.record.error = undefined;
      entry.record.activatedAt = Date.now();
      this.log.debug(`[kernel] activated "${id}"`);
    } catch (err) {
      entry.record.state = 'failed';
      entry.record.error = err instanceof Error ? err.message : String(err);
      this.log.error(`[kernel] failed to activate "${id}"`, err);
      this.teardown(entry);
    }
  }

  private teardown(entry: Entry): void {
    try {
      entry.cleanup?.();
    } catch (err) {
      this.log.error('[kernel] cleanup threw', err);
    }
    for (const off of entry.observers.splice(0)) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    for (const fn of entry.disposables.splice(0)) {
      try {
        fn();
      } catch (err) {
        this.log.error('[kernel] disposable threw', err);
      }
    }
    for (const key of [...entry.services]) this.releaseService(entry, key);
    entry.plugin = undefined;
    entry.cleanup = undefined;
  }

  async deactivate(id: PluginId): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    // Cascade: every transitive dependent goes first, so no plugin is ever left
    // holding a service whose provider has already been torn down.
    const dependents = this.dependentsOfPlugin(id).filter((dep) => {
      const dEntry = this.entries.get(dep);
      return dEntry && (dEntry.record.state === 'active' || dEntry.record.state === 'pending');
    });
    for (const dep of dependents) await this.deactivate(dep);
    this.teardown(entry);
    entry.record.state = 'registered';
  }

  /** Enable/disable and reconcile the graph. */
  async setEnabled(id: PluginId, enabled: boolean): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.record.enabled = enabled;
    if (enabled) {
      await this.activate(id);
      await this.activatePending();
    } else {
      await this.deactivate(id);
    }
  }

  /**
   * Activate everything that can be activated, repeatedly, until a pass makes
   * no progress. Topological-ish convergence without hard-coding an order.
   */
  async sync(): Promise<void> {
    /*
     * First: tear down anything that has been switched off. Without this the
     * reconcile loop below (which only ever activates) left the disabled
     * plugin's slots and styles in place — the UI looked like the toggle did
     * nothing.
     */
    for (const entry of this.entries.values()) {
      if (!entry.record.enabled && entry.record.state === 'active') {
        await this.deactivate(entry.record.manifest.id);
      }
    }

    for (let pass = 0; pass < 50; pass++) {
      const pending = [...this.entries.values()]
        .filter((e) => e.record.enabled && e.record.state !== 'active' && e.record.state !== 'failed')
        .sort((a, b) => (a.record.manifest.priority ?? 100) - (b.record.manifest.priority ?? 100));
      if (!pending.length) return;
      let progressed = false;
      for (const entry of pending) {
        const before = entry.record.state;
        await this.activate(entry.record.manifest.id);
        if (entry.record.state === 'active' && before !== 'active') progressed = true;
      }
      if (!progressed) {
        // Anything still pending genuinely cannot resolve.
        for (const entry of pending) {
          if (entry.record.state === 'pending') {
            this.log.warn(`[kernel] "${entry.record.manifest.id}" cannot activate: ${entry.record.error}`);
          }
        }
        return;
      }
    }
  }

  private async activatePending(): Promise<void> {
    await this.sync();
  }

  /**
   * Hot swap: replace a service value and re-activate its dependents. This is
   * the primitive a theme or agent-loop plugin uses to install itself.
   */
  async swapService<T>(key: string, providerId: PluginId, value: T): Promise<void> {
    // Whoever uses the *current provider* of this key must reload around it.
    const current = this.owners.get(key);
    const reloadSet = new Set<PluginId>([
      ...this.dependentsOf(key),
      ...(current ? this.dependentsOfPlugin(current) : []),
    ]);
    reloadSet.delete(providerId);
    for (const dep of reloadSet) await this.deactivate(dep);
    if (current && current !== providerId) {
      const stack = this.overrideStacks.get(key) ?? [];
      this.overrideStacks.set(key, stack);
      stack.push({ provider: current, value: this.values.get(key) });
    }
    this.owners.set(key, providerId);
    this.values.set(key, value);
    this.notify(key);
    await this.sync();
    for (const dep of reloadSet) {
      if (this.entries.get(dep)?.record.enabled) await this.activate(dep);
    }
  }

  /** Remove a registered plugin entirely (uninstall). */
  async unregister(id: PluginId): Promise<void> {
    const entry = this.entries.get(id);
    if (!entry) return;
    await this.deactivate(id);
    this.entries.delete(id);
  }
}

export const defaultLogger: PluginLogger = {
  debug: (...a) => {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('rpnow:debug') === '1') {
      console.debug(...a);
    }
  },
  info: (...a) => console.info(...a),
  warn: (...a) => console.warn(...a),
  error: (...a) => console.error(...a),
};
