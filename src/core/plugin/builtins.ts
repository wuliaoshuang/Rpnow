/**
 * Kernel bootstrap.
 *
 * Registers RPNow's own functionality *as plugins*, exactly like third-party
 * code would. Nothing here is privileged: `llm`, `agentLoop`, `renderer`,
 * `theme`, `chat` are all provided through the same `provide()` call a user
 * plugin would make.
 *
 * Order matters only in that a provider's dependencies must be registered before
 * `sync()` runs; activation ordering is resolved by the kernel.
 */

import { ServiceRegistry } from './registry.js';
import { SERVICE, type PluginManifest, type RPPlugin } from './kernel-types.js';
import { BUILTIN_ADAPTERS } from '../llm/adapters.js';
import { PROVIDER_MAP } from '../llm/providers.js';
import { BUILTIN_IMAGE_ADAPTERS, blobToDataUrl } from '../image/types.js';
import type { LLMConnection, LLMProviderAdapter, LLMService } from '../llm/types.js';
import type { ImageConnection, ImageProviderAdapter, ImageService } from '../image/types.js';
import { defaultAgentLoop } from '../agent/defaultLoop.js';
import { defaultRenderer } from '../render/renderer.js';
import { BUILTIN_THEMES, THEME_MAP } from '../defaults/themes.js';
import { resolveFetch } from '../transport/native.js';
import { settingsStore } from '../storage/index.js';
import {
  DEFAULT_SETTINGS,
  type RPAppSettings,
} from '../types/chat.js';

/** Helper to declare a builtin plugin concisely. */
function builtin(
  manifest: Omit<PluginManifest, 'apiVersion' | 'builtin'>,
  apply: RPPlugin['apply'],
): RPPlugin {
  return {
    manifest: { apiVersion: 1, builtin: true, ...manifest },
    apply,
  };
}

/**
 * Register a builtin plugin, propagating the `builtin` flag into the manifest
 * the kernel records (the kernel classifies origin from that flag).
 */
export function registerBuiltin(
  kernel: ServiceRegistry,
  meta: Omit<PluginManifest, 'apiVersion' | 'builtin'>,
  apply: RPPlugin['apply'],
): void {
  const plugin = builtin(meta, apply);
  kernel.register({ ...meta, apiVersion: 1, builtin: true }, async () => plugin, 'builtin');
}

// ------------------------------------------------------------------- LLM

/** Connection store owned by the LLM service; persisted by the app store. */
function createLLMService(opts: BootstrapOptions): LLMService {
  const getConnections = opts.getConnections;
  const adaptersMap = new Map<string, LLMProviderAdapter>();
  for (const a of BUILTIN_ADAPTERS) adaptersMap.set(a.key, a);

  /** Resolve which adapter handles a connection. */
  const adapterFor = (conn: LLMConnection): LLMProviderAdapter => {
    // Explicit adapter wins.
    if (adaptersMap.has(conn.provider)) return adaptersMap.get(conn.provider)!;
    // Otherwise infer from the provider registry: Anthropic/Gemini are native,
    // everything else speaks OpenAI.
    const info = PROVIDER_MAP.get(conn.provider);
    if (info?.compat === 'native') {
      return conn.provider === 'gemini' ? adaptersMap.get('gemini')! : adaptersMap.get('anthropic')!;
    }
    return adaptersMap.get('openai-compatible')!;
  };

  /**
   * Every request goes through the runtime-appropriate transport: native HTTP
   * on desktop (no CORS), user proxy or plain fetch in the browser.
   */
  const transport = async (): Promise<typeof fetch> => {
    const network = opts.getSettings().network;
    return resolveFetch(network ? { enabled: network.proxyEnabled, url: network.proxyUrl } : undefined);
  };

  return {
    adapters: () => [...adaptersMap.values()],
    registerAdapter(adapter) {
      adaptersMap.set(adapter.key, adapter);
      return () => adaptersMap.delete(adapter.key);
    },
    connections: getConnections,
    connection: (id) => getConnections().find((c) => c.id === id),
    stream(connectionId, req) {
      const conn = getConnections().find((c) => c.id === connectionId);
      if (!conn) {
        return (async function* () {
          yield { type: 'error' as const, message: `找不到连接 ${connectionId}，请在设置中添加模型连接` };
        })();
      }
      return (async function* () {
        const f = await transport();
        yield* adapterFor(conn).stream(conn, req, f);
      })();
    },
    async complete(connectionId, req) {
      const { collectStream } = await import('../llm/types.js');
      const conn = getConnections().find((c) => c.id === connectionId);
      if (!conn) throw new Error('找不到模型连接');
      const f = await transport();
      return collectStream(adapterFor(conn).stream(conn, { ...req, stream: true }, f));
    },
    async listModels(connectionId) {
      const conn = getConnections().find((c) => c.id === connectionId);
      if (!conn) throw new Error('找不到模型连接');
      const adapter = adapterFor(conn);
      if (!adapter.listModels) {
        const info = PROVIDER_MAP.get(conn.provider);
        return info?.models ?? [];
      }
      return adapter.listModels(conn, await transport());
    },
    async completeFrom(conn, req) {
      const { collectStream } = await import('../llm/types.js');
      const f = await transport();
      return collectStream(adapterFor(conn).stream(conn, { ...req, stream: true }, f));
    },
    async listModelsFrom(conn) {
      const adapter = adapterFor(conn);
      if (!adapter.listModels) return PROVIDER_MAP.get(conn.provider)?.models ?? [];
      return adapter.listModels(conn, await transport());
    },
    async embedFrom(conn, input, model) {
      const { openAIEmbed } = await import('../llm/adapters.js');
      return openAIEmbed(conn, input, model, await transport());
    },
  };
}

// ---------------------------------------------------------------- plugin set

export interface BootstrapOptions {
  /** Live getters so the kernel always sees current app state. */
  getConnections: () => LLMConnection[];
  getImageConnections: () => ImageConnection[];
  getSettings: () => RPAppSettings;
}

export function registerBuiltinPlugins(kernel: ServiceRegistry, opts: BootstrapOptions): void {
  // ---------------------------------------------------------------- settings
  kernel.register(
    { id: 'rpnow.core.settings', name: '设置存储', version: '1.0.0', apiVersion: 1, host: 'host', provides: [SERVICE.SETTINGS], priority: 1 },
    async () =>
      builtin(
        { id: 'rpnow.core.settings', name: '设置存储', version: '1.0.0', host: 'host', provides: [SERVICE.SETTINGS] },
        (ctx) => {
          const service = {
            get<T>(key: string, fallback: T): T {
              const settings = opts.getSettings();
              return (settings as unknown as Record<string, unknown>)[key] as T ?? fallback;
            },
            set<T>(key: string, value: T): void {
              const merged = { ...settingsStore.get('settings', DEFAULT_SETTINGS), [key]: value };
              settingsStore.set('settings', merged);
            },
            subscribe: (key: string, handler: (v: unknown) => void) => settingsStore.subscribe(key, handler),
            getPluginConfig: (id: string) => opts.getSettings().pluginConfig?.[id] ?? {},
            setPluginConfig: async (id: string, value: Record<string, unknown>) => {
              const cur = opts.getSettings();
              const next = { ...cur, pluginConfig: { ...cur.pluginConfig, [id]: value } };
              settingsStore.set('settings', next);
            },
          };
          ctx.provide(SERVICE.SETTINGS, service);
        },
      ),
  );

  // -------------------------------------------------------------------- LLM
  kernel.register(
    { id: 'rpnow.core.llm', name: 'LLM 服务', version: '1.0.0', apiVersion: 1, host: 'host', provides: [SERVICE.LLM], uses: [SERVICE.SETTINGS], priority: 2 },
    async () =>
      builtin(
        { id: 'rpnow.core.llm', name: 'LLM 服务', version: '1.0.0', host: 'host', provides: [SERVICE.LLM], uses: [SERVICE.SETTINGS] },
        (ctx) => {
          ctx.provide(SERVICE.LLM, createLLMService(opts));
        },
      ),
  );

  // ------------------------------------------------------------------ image
  kernel.register(
    { id: 'rpnow.core.image', name: '图像生成服务', version: '1.0.0', apiVersion: 1, host: 'host', provides: [SERVICE.IMAGE], uses: [SERVICE.SETTINGS], priority: 2 },
    async () =>
      builtin(
        { id: 'rpnow.core.image', name: '图像生成服务', version: '1.0.0', host: 'host', provides: [SERVICE.IMAGE], uses: [SERVICE.SETTINGS] },
        (ctx) => {
          const map = new Map<string, ImageProviderAdapter>();
          for (const a of BUILTIN_IMAGE_ADAPTERS) map.set(a.key, a);
          const service: ImageService = {
            adapters: () => [...map.values()],
            registerAdapter(a) {
              map.set(a.key, a);
              return () => map.delete(a.key);
            },
            connections: opts.getImageConnections,
            async generate(id, req) {
              const conn = opts.getImageConnections().find((c) => c.id === id);
              if (!conn) throw new Error(`找不到图像连接 ${id}`);
              const adapter = map.get(conn.provider);
              if (!adapter) throw new Error(`未注册的图像提供商 ${conn.provider}`);
              const network = opts.getSettings().network;
              const f = await resolveFetch(
                network ? { enabled: network.proxyEnabled, url: network.proxyUrl } : undefined,
              );
              const results = await adapter.generate(conn, req, f);
              // Providers that only return a remote URL need inlining here so
              // callers always receive usable data URLs. (Ark's URLs expire in
              // 24h, so this is also a correctness requirement.)
              for (const r of results) {
                if (!r.dataUrl && r.sourceUrl) {
                  const res = await f(r.sourceUrl);
                  const blob = await res.blob();
                  r.dataUrl = await blobToDataUrl(blob);
                }
              }
              return results.filter((r) => r.dataUrl);
            },
          };
          ctx.provide(SERVICE.IMAGE, service);
        },
      ),
  );

  // ------------------------------------------------------------- agent loop
  kernel.register(
    { id: 'rpnow.core.agent-loop', name: '默认 Agent 循环', version: '1.0.0', apiVersion: 1, host: 'host', provides: [SERVICE.AGENT_LOOP], uses: [SERVICE.LLM], priority: 10 },
    async () =>
      builtin(
        { id: 'rpnow.core.agent-loop', name: '默认 Agent 循环', version: '1.0.0', host: 'host', provides: [SERVICE.AGENT_LOOP], uses: [SERVICE.LLM] },
        (ctx) => {
          ctx.provide(SERVICE.AGENT_LOOP, defaultAgentLoop);
        },
      ),
  );

  // -------------------------------------------------------------- renderer
  kernel.register(
    { id: 'rpnow.core.renderer', name: 'Markdown/HTML 渲染器', version: '1.0.0', apiVersion: 1, host: 'host', provides: [SERVICE.RENDERER], priority: 2 },
    async () =>
      builtin(
        { id: 'rpnow.core.renderer', name: 'Markdown/HTML 渲染器', version: '1.0.0', host: 'host', provides: [SERVICE.RENDERER] },
        (ctx) => {
          ctx.provide(SERVICE.RENDERER, defaultRenderer);
        },
      ),
  );

  // ----------------------------------------------------------------- theme
  kernel.register(
    {
      id: 'rpnow.core.theme',
      name: '主题服务',
      version: '1.0.0',
      apiVersion: 1,
      host: 'ui',
      provides: [SERVICE.THEME],
      priority: 2,
      tags: ['theme'],
    },
    async () =>
      builtin(
        { id: 'rpnow.core.theme', name: '主题服务', version: '1.0.0', host: 'ui', provides: [SERVICE.THEME], tags: ['theme'] },
        (ctx) => {
          const current = () => opts.getSettings().themeId || BUILTIN_THEMES[0].id;
          const service = {
            get id() {
              return current();
            },
            tokens: () => THEME_MAP.get(current())?.tokens ?? BUILTIN_THEMES[0].tokens,
            css: () => {
              const t = THEME_MAP.get(current());
              return t?.css ?? '';
            },
            activate(id: string) {
              const cur = opts.getSettings();
              settingsStore.set('settings', { ...cur, themeId: id });
            },
            list: () =>
              BUILTIN_THEMES.map((t) => ({ id: t.id, label: t.label, description: t.description })),
          };
          ctx.provide(SERVICE.THEME, service);
        },
      ),
  );
}
