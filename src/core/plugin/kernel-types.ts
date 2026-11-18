/**
 * RPNow plugin kernel.
 *
 * Design provenance: DeepSeek Harness (Cordis) uses a *service registry* in
 * which every capability is a plugin that `provide`s a named service and
 * `inject`s the ones it needs; the bundle layer then composes plugins by id.
 * RPNow adopts the same shape in a browser runtime:
 *
 *   - Every capability is addressable by a **service key** (`llm`, `image`,
 *     `prompt`, `theme`, `agentLoop`, `renderer`, ...).
 *   - A plugin declares `uses` (wanted services) and is only activated once all
 *     of them exist; when a dependency disappears the plugin deactivates
 *     (a "reload cascade"), which is what makes hot swap safe.
 *   - Plugins are the *only* way features get added, including RPNow's own UI
 *     and its agent loop. Nothing is special-cased.
 *
 * Hosts are the two execution contexts:
 *   - `host` : kernel-side, gets the full {@link RPPluginContext}.
 *   - `ui`   : React-side, contributes surfaces through the slot registry.
 *
 * This module is deliberately dependency-free so it can run under Vitest and
 * inside a sandboxed plugin worker.
 */

export type PluginId = string;

/** Lifecycle states a plugin can be in. */
export type PluginState =
  | 'registered'
  | 'pending' // waiting for dependencies
  | 'activating'
  | 'active'
  | 'failed'
  | 'disposed';

export type PluginHost = 'host' | 'ui';

/** Semantic version constraints are intentionally simple: exact or `*`. */
export interface PluginManifest {
  /** Reverse-DNS-ish unique id, e.g. `rpnow.theme.paper-ink`. */
  id: PluginId;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  license?: string;
  /** Minimum RPNow API version the plugin needs, e.g. `1`. */
  apiVersion: number;
  /** Which contexts implement this plugin. */
  host: PluginHost;
  /**
   * Service keys this plugin `provide`s. A provider of `theme` replaces
   * whatever held `theme` before, which is how a downloaded theme "just works".
   */
  provides?: string[];
  /** Service keys that must exist before this plugin activates. */
  uses?: string[];
  /** Soft dependencies: activated after, but absence is tolerated. */
  optionalUses?: string[];
  /** Declaration order tiebreak; lower activates first. */
  priority?: number;
  /** JSON-schema-ish config descriptor rendered by the settings form engine. */
  config?: unknown;  /** Capability tags surfaced in the plugin browser. */
  tags?: string[];
  /** Set for plugins compiled with the kernel (cannot be uninstalled). */
  builtin?: boolean;
}

/** A live service instance registered under a key. */
export interface ServiceHandle<T = unknown> {
  readonly key: string;
  readonly provider: PluginId;
  readonly value: T;
  dispose(): void;
}

export interface Disposable {
  dispose: () => void;
}

/** Returned from `apply()` to request cleanup; a bare function also works. */
export type PluginCleanup = void | (() => void) | Disposable;

/**
 * Event bus contract. Plugins communicate through events rather than reaching
 * into each other, which keeps the dependency graph acyclic in practice.
 */
export interface PluginEvents {
  on(event: string, handler: (payload: unknown) => void): Disposable;
  emit(event: string, payload?: unknown): void;
}

/** Config store handed to a plugin; backed by the host's settings store. */
export interface PluginConfigStore {
  get<T = unknown>(): T;
  set<T = unknown>(value: T): Promise<void>;
  onChange(handler: (value: unknown) => void): Disposable;
}

/** Everything a kernel-side plugin may touch. */
export interface RPPluginContext {
  /** Look up a service, or `undefined` if no provider is active. */
  get<T = unknown>(key: string): T | undefined;
  /** Register a service. Disposing the handle releases the key. */
  provide<T>(key: string, value: T): ServiceHandle<T>;
  /** Subscribe to service (re)registration. Fires with `undefined` on release. */
  observe<T = unknown>(key: string, handler: (value: T | undefined) => void): Disposable;
  /** Adopt a disposable so it is released with this plugin. */
  use(disposable: Disposable | (() => void)): void;
  readonly events: PluginEvents;
  readonly config: PluginConfigStore;
  readonly logger: PluginLogger;
  readonly manifest: PluginManifest;
  /** Request another plugin be (de)activated — used by the plugin manager UI. */
  requestActivation(id: PluginId, enabled: boolean): Promise<void>;
  /**
   * Read/write access to RPNow's data (cards, chats, world books, presets).
   * Supplied by the host for every plugin, including built-ins, so a plugin
   * never needs to reach into the app store directly.
   */
  readonly rpnow?: unknown;

  // ---------------------------------------------------------------- convenience
  //
  // The ergonomic surface plugins are documented against (see
  // docs/PLUGIN-DEVELOPMENT.md). Each of these is implemented by the loader;
  // they exist so a plugin author never has to import RPNow internals.

  /**
   * Register a React component into a named slot.
   *
   * ```js
   * ctx.mountSlot('chat.composer', MyBar);
   * ```
   * `order` follows the slot rule: lower wins, 0 replaces the default.
   */
  mountSlot?<T = unknown>(slot: string, component: T, options?: { order?: number; id?: string }): Disposable;

  /**
   * Inject CSS **scoped to this plugin**.
   *
   * Selectors are rewritten to hit only the plugin's own markup, and the whole
   * sheet lands in a low-priority `@layer`, so a plugin can never restyle the
   * app shell. See `core/plugins/scoped-styles.ts`.
   */
  injectCss?(css: string, options?: { scope?: string }): Disposable;

  /** React itself, so a plugin can build UI without its own copy. */
  readonly React?: unknown;

  /** Slot name constants (`ctx.SLOT.COMPOSER`, …). */
  readonly SLOT?: Record<string, string>;

  /** Current plugin config, with manifest defaults merged in. */
  config_?: never;

  // ------------------------------------------------------------- documented aliases
  //
  // Thin wrappers over the semantic API above; see docs/PLUGIN-DEVELOPMENT.md.
  /** `ctx.log('…')` — same as `ctx.logger.info`. */
  log?(...args: unknown[]): void;
  /** `ctx.on(event, handler)` — subscribes for the plugin's lifetime. */
  on?(event: string, handler: (payload: unknown) => void): Disposable;
  /** `ctx.readConfig()` — this plugin's config with defaults merged. */
  readConfig?<T = Record<string, unknown>>(): T;
  /** `ctx.requires('svc')` — declare a runtime service dependency. */
  requires?(...keys: string[]): void;
}

export interface PluginLogger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

/**
 * A plugin module. `apply` is called on activation and may return a cleanup
 * function (or any `Disposable`); all `provide`/`observe`/`use` handles are
 * released regardless.
 */
export interface RPPlugin {
  readonly manifest: PluginManifest;
  apply(ctx: RPPluginContext): PluginCleanup | Promise<PluginCleanup>;
}

/** Factory form, convenient for `.rpnx` modules. */
export type RPPluginFactory = () => RPPlugin | Promise<RPPlugin>;

export interface PluginRecord {
  manifest: PluginManifest;
  factory: () => Promise<RPPlugin>;
  state: PluginState;
  error?: string;
  enabled: boolean;
  /** Source of the plugin: builtin, installed `.rpnx`, or dev directory. */
  origin: 'builtin' | 'installed' | 'dev';
  /** Bundle-level toggle: a bundle disables all its members at once. */
  bundleId?: string;
  activatedAt?: number;
}

/** UI-side registration surface. See `plugin/slots.ts` for the registry. */
export interface UIPluginContext extends RPPluginContext {
  /** Slot name → React component. Removing the last one restores the fallback. */
  slot<T = unknown>(name: string, component: T, options?: { order?: number }): Disposable;
  /** Theme tokens contributed by a theme plugin. */
  theme(tokens: Record<string, string>): Disposable;
}

export const KERNEL_API_VERSION = 1;

/** Service keys used across the app. Centralised to avoid string drift. */
export const SERVICE = {
  LLM: 'llm',
  IMAGE: 'image',
  PROMPT: 'prompt',
  WORLDBOOK: 'worldbook',
  AGENT_LOOP: 'agentLoop',
  CHAT: 'chat',
  CARDS: 'cards',
  LOREBOOKS: 'lorebooks',
  PRESETS: 'presets',
  THEME: 'theme',
  RENDERER: 'renderer',
  STORAGE: 'storage',
  SETTINGS: 'settings',
  MACROS: 'macros',
  PERSONA: 'persona',
  REGEX: 'regex',
  /** Text-to-speech. Nothing in core provides it; plugins supply it. */
  TTS: 'tts',
} as const;

export type ServiceKey = (typeof SERVICE)[keyof typeof SERVICE];
