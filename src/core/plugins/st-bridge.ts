/**
 * SillyTavern extension bridge.
 *
 * "酒馆助手 / Tavern Helper" and the rest of the ST ecosystem ship as a
 * **SillyTavern extension**: a folder (or ZIP) with a `manifest.json` plus a
 * script, written against `SillyTavern.getContext()`. They are not `.rpnx`
 * packages, so installing one used to fail at manifest validation.
 *
 * This module detects that layout and adapts it:
 *
 *   1. read the ST manifest (`display_name` / `js` / `css` …),
 *   2. build a `SillyTavern` shim over the same services the kernel exposes —
 *      chat, characters, events, `generate`, `getContext()` and the macro/event
 *      bus Tavern Helper relies on,
 *   3. splice the extension's CSS into the document and evaluate its JS with the
 *      shim in scope,
 *   4. record it in the same plugin store as `.rpnx`, so enable/disable and
 *      removal work identically.
 *
 * The shim is deliberately generous: unknown members resolve to no-ops instead
 * of throwing, because extensions feature-detect by calling and catching.
 */

import type { RPCard } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';
import { parse as lexerParse, init as lexerInit } from 'es-module-lexer';
import { useApp } from '@/state/store.js';
import { SCOPE_ATTR, injectScopedStyles } from './scoped-styles.js';
import {
  installHostGlobals,
  setSharedEventBus,
  hostShimSources,
  publishHostState,
  setFrontendRendererActive,
} from './st-host-runtime.js';

import {
  looksLikeSTExtension,
  resolveEntryPath,
  resolveStylePath,
  stDisplayName,
  stPluginId,
  type STManifest,
} from './st-manifest.js';
import {
  readPresetExtensionField,
  writePresetExtensionField,
} from '../prompt/preset-extensions.js';

export {
  looksLikeSTExtension,
  resolveEntryPath,
  resolveStylePath,
  stDisplayName,
  stPluginId,
  type STManifest,
};

/**
 * Does this extension provide the front-end (iframe) renderer?
 *
 * 酒馆助手 is the only known one. Recognised by its display name / package
 * name so RPNow can yield `pre > code` to it instead of pre-rendering an HTML
 * card itself. Kept deliberately narrow: a false positive would leave the user
 * with raw source text when the extension turns out not to render.
 */
export function isFrontendRendererManifest(manifest: {
  display_name?: string;
  name?: string;
}): boolean {
  const label = `${manifest.display_name ?? ''} ${manifest.name ?? ''}`;
  return /tavern[ _-]?helper|js-slash-runner|酒馆助手/i.test(label);
}

export interface STExtensionFiles {
  manifest: STManifest;
  /** Resolved entry script path → source. */
  entryPath: string;
  script: string;
  /** Optional stylesheet. */
  styles?: string;
  /**
   * Other modules of a multi-file extension, keyed by path relative to the
   * extension root (`scripts/utils.js`). Relative imports in the entry (and in
   * these) are rewritten to blob URLs so the graph loads.
   */
  modules?: Record<string, string>;
  /**
   * **Host runtime** — modules that live outside the extension package.
   *
   * Real extensions are not self-contained. 酒馆助手's `dist/index.js` imports
   * `../../../../../scripts/utils.js`, i.e. files from the *SillyTavern install*
   * (`public/scripts/…`), which are not in the ZIP. SillyTavern resolves those
   * because the extension is unpacked at
   * `public/scripts/extensions/third-party/<name>/`, so the relative path lands
   * on the host tree.
   *
   * We have no host tree, so the caller supplies the modules it can provide,
   * keyed by their host-relative path (`scripts/utils.js`, `lib/jsoneditor.js`,
   * `script.js`). Imports that miss the package fall back to this map.
   */
  hostModules?: Record<string, string>;
}

/**
 * Reduce a host-relative specifier to the key used in `hostModules`.
 *
 * `../../../../../scripts/utils.js` → `scripts/utils.js`
 * `../lib/jsoneditor.js`           → `lib/jsoneditor.js`
 * `../../../../../script.js`       → `script.js`
 */
function hostModuleKey(spec: string): string | null {
  const m = spec.match(/((?:scripts|lib)\/[^/].*|script\.js)$/);
  return m ? m[1] : null;
}

/**
 * Resolve a relative specifier against the importing module's path.
 *
 * `scripts/a/b.js` + `../../utils.js` → `utils.js`.
 *
 * Returns ALL plausible keys (the extension may omit the `.js` suffix, and the
 * bundled path may be wrapped in a folder); the caller picks the first that
 * exists in the module map. Returns an empty array for bare specifiers.
 */
function resolveRelative(fromPath: string, spec: string): string[] {
  if (!spec.startsWith('.')) return [];
  const base = fromPath.split('/').slice(0, -1);
  const out = [...base];
  for (const p of spec.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') {
      // Climbing above the package root is legitimate — extensions are often
      // packaged inside a wrapper folder, so keep popping into a prefix.
      if (out.length) out.pop();
      continue;
    }
    out.push(p);
  }
  const joined = out.join('/');
  const variants = [joined];
  if (!/\.[cm]?js$/i.test(joined)) variants.push(`${joined}.js`, `${joined}.mjs`, `${joined}/index.js`);
  // Trailing-slash and redundant-prefix forms seen in real packages.
  variants.push(joined.replace(/^\/+/, ''));
  return [...new Set(variants.filter(Boolean))];
}
// ---------------------------------------------------------------------------
// Runtime shim
// ---------------------------------------------------------------------------

/** Message shapes ST scripts expect from `getContext().chat`. */
type STMessage = { name?: string; is_user?: boolean; is_system?: boolean; mes?: string; [k: string]: unknown };

interface STContext {
  chat: STMessage[];
  characters: unknown[];
  name1: string;
  name2: string;
  chatId?: string;
  characterId?: number;
  charactersList?: unknown[];
  eventSource: unknown;
  eventTypes: Record<string, string>;
  extensionSettings: Record<string, unknown>;
  power_user: Record<string, unknown>;
  saveSettingsDebounced: () => void;
  saveMetadata: () => unknown;
  getRequestHeaders: () => Record<string, string>;
  generate: (...args: unknown[]) => Promise<string>;
  [k: string]: unknown;
}

/** Build the `SillyTavern` global an extension expects. */
function buildShim(pluginId: string): { api: Record<string, unknown>; dispose: () => void } {
  const store = () => useApp.getState();

  /** Listeners registered through `eventSource.on`. */
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  /** Event names most extensions subscribe to. */
  const eventTypes: Record<string, string> = {
    APP_READY: 'app_ready',
    MESSAGE_SENT: 'message_sent',
    MESSAGE_RECEIVED: 'message_received',
    MESSAGE_EDITED: 'message_edited',
    MESSAGE_SWIPED: 'message_swiped',
    MESSAGE_DELETED: 'message_deleted',
    CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
    USER_MESSAGE_RENDERED: 'user_message_rendered',
    GENERATION_STARTED: 'generation_started',
    GENERATION_ENDED: 'generation_ended',
    CHAT_CHANGED: 'chat_changed',
    CHAT_LOADED: 'chat_loaded',
    SETTINGS_LOADED: 'settings_loaded',
    EXTRAS_CONNECTED: 'extras_connected',
  };

  const eventSource = {
    on(name: string, cb: (...args: unknown[]) => void) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(cb);
    },
    once(name: string, cb: (...args: unknown[]) => void) {
      const wrap = (...args: unknown[]) => {
        listeners.get(name)?.delete(wrap);
        cb(...args);
      };
      eventSource.on(name, wrap);
    },
    off(name: string, cb: (...args: unknown[]) => void) {
      listeners.get(name)?.delete(cb);
    },
    removeListener(name: string, cb: (...args: unknown[]) => void) {
      listeners.get(name)?.delete(cb);
    },
    /*
     * ST's EventEmitter exposes priority registration; 酒馆助手 uses
     * `makeFirst` to run before other handlers. A Set preserves insertion
     * order, so re-insert at the head/tail.
     */
    makeFirst(name: string, cb: (...args: unknown[]) => void) {
      const set = listeners.get(name);
      if (!set || !set.has(cb)) return;
      set.delete(cb);
      listeners.set(name, new Set([cb, ...set]));
    },
    makeLast(name: string, cb: (...args: unknown[]) => void) {
      const set = listeners.get(name);
      if (!set || !set.has(cb)) return;
      set.delete(cb);
      listeners.set(name, new Set([...set, cb]));
    },
    emit(name: string, ...args: unknown[]) {
      for (const cb of listeners.get(name) ?? []) {
        try {
          cb(...args);
        } catch (err) {
          console.error(`[st-bridge] ${name} listener failed`, err);
        }
      }
    },
  };

  /** Settings bucket namespaced per extension, like ST does. */
  const settingsKey = `rpnow:st:${pluginId}`;
  let extensionSettings: Record<string, unknown> = {};
  try {
    extensionSettings = JSON.parse(localStorage.getItem(settingsKey) ?? '{}') as Record<string, unknown>;
  } catch {
    extensionSettings = {};
  }
  const persistSettings = () => {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(extensionSettings));
    } catch {
      /* quota — settings survive in memory at least */
    }
  };

  /** Convert our stored chat into the ST message shape. */
  const toSTMessages = (chat: RPChat | undefined, card: RPCard | undefined, userName: string): STMessage[] =>
    (chat?.messages ?? []).map((m: RPChat['messages'][number]) => ({
      name: m.role === 'user' ? userName : (card?.data.name ?? 'Assistant'),
      is_user: m.role === 'user',
      is_system: m.role === 'system',
      mes: m.content,
      send_date: String(m.createdAt),
      extra: {},
    }));

  const getContext = (): STContext => {
    const s = store();
    const chat = s.chats.find((c) => c.id === s.activeChatId) ?? s.chats[0];
    const card = s.cards.find((c) => c.id === chat?.cardId);
    const persona = s.personas.find((p) => p.id === chat?.personaId) ?? s.personas[0];
    const userName = persona?.name || 'User';
    /*
     * Active preset. `chatCompletionSettings` is a HARD dependency of preset
     * embedded runtimes — Meowssiah's CatGodOracle reads
     * `chatCompletionSettings.prompts` directly to decide whether its UI is
     * enabled (`_preset-embedded-runtime.md` §2.7), and ST's own regex engine
     * reads `preset.extensions.regex_scripts`.
     */
    const preset =
      s.presets.find((p) => p.id === chat?.presetId) ??
      s.presets.find((p) => p.id === (s.settings as { defaultPresetId?: string }).defaultPresetId) ??
      s.presets[0];
    return {
      chat: toSTMessages(chat, card, userName),
      characters: s.cards.map((c) => ({
        name: c.data.name,
        description: c.data.description,
        personality: c.data.personality,
        scenario: c.data.scenario,
        first_mes: c.data.first_mes,
        mes_example: c.data.mes_example,
        avatar: 'none',
        chat: c.data.name,
      })),
      name1: userName,
      name2: card?.data.name ?? '',
      chatId: chat?.id,
      characterId: 0,
      charactersList: s.cards.map((c) => c.data.name),
      eventSource,
      eventTypes,
      extensionSettings,
      power_user: {
        active_character: 0,
        persona_description: persona?.description ?? '',
        persona_description_position: 1,
        mesSendFormatted: true,
      },
      /*
       * ST `oai_settings` equivalent. Preset runtimes read `prompts` /
       * `prompt_order` straight off this object (they do NOT go through
       * getSelectedPreset / readPresetExtensionField).
       */
      chatCompletionSettings: preset
        ? {
            prompts: preset.prompts ?? [],
            prompt_order: preset.prompt_order ?? [],
            openai_max_context: preset.max_context ?? 0,
            openai_max_tokens: preset.max_tokens ?? 0,
            preset_settings_openai: {
              temperature: preset.temperature,
              top_p: preset.top_p,
              repetition_penalty: preset.repetition_penalty,
              max_tokens: preset.max_tokens,
            },
          }
        : null,
      /** ST camelCase alias for `power_user`. */
      powerUserSettings: {
        persona_description: persona?.description ?? '',
        persona_description_position: 1,
      },
      /*
       * Official preset-extension channel (`preset-manager.js:853-908`).
       * `path` supports arbitrary dot/bracket paths; empty path = whole object;
       * missing path returns null. Writes update the preset record.
       */
      presetManager: {
        getSelectedPresetName: () => preset?.name ?? null,
        /** ST returns the raw preset object (or null). */
        getSelectedPreset: () => preset ?? null,
        getPresetList: () => ({
          settings: { extensions: preset?.extensions ?? {} },
          presets: s.presets,
        }),
        readPresetExtensionField: ({ path }: { name?: string; path?: string }) =>
          readPresetExtensionField(preset, path),
        writePresetExtensionField: ({ path }: { name?: string; path?: string }, value: unknown) => {
          if (!preset || !path) return false;
          void useApp.getState().savePreset({
            ...preset,
            extensions: writePresetExtensionField(preset.extensions ?? {}, path, value),
          });
          return true;
        },
      },
      /* Template rendering needs the ST host tree; degrade gracefully. */
      renderExtensionTemplateAsync: async () => '',
      renderExtensionTemplate: () => '',
      writeExtensionField: () => {},
      writeExtensionFieldBulk: () => {},
      getExtensionManifest: () => null,
      saveSettingsDebounced: persistSettings,
      saveMetadata: () => persistSettings(),
      getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
      /**
       * Minimal `generate()`. Routes through the kernel's LLM service so an
       * extension that asks for a completion actually gets one.
       */
      generate: async (...args: unknown[]) => {
        const kernel = store().kernel as unknown as {
          use?: <T>(key: string) => T | undefined;
          get?: <T>(key: string) => T | undefined;
        } | null;
        const llm =
          (kernel && (typeof kernel.get === 'function' ? kernel.get('llm') : undefined)) ??
          (kernel && (typeof kernel.use === 'function' ? kernel.use('llm') : undefined));
        const first = args[0];
        const prompt = typeof first === 'string' ? first : String((first as { prompt?: string })?.prompt ?? '');
        if (!llm || typeof (llm as { complete?: unknown }).complete !== 'function') return '';
        const conn = s.llmConnections.find((c) => c.id === s.settings.defaultConnectionId) ?? s.llmConnections[0];
        if (!conn) return '';
        const res = await (llm as { complete: (r: unknown) => Promise<{ text?: string }> }).complete({
          connectionId: conn.id,
          model: conn.defaultModel ?? '',
          messages: [{ role: 'user', content: prompt }],
        });
        return res?.text ?? '';
      },
    };
  };

  const api: Record<string, unknown> = {
    getContext,
    libs: {},
    extensionSettings,
    /**
     * ST exposes these on the global too (not only via `getContext()`), and
     * extensions commonly do `SillyTavern.eventSource.on(SillyTavern.eventTypes.X)`.
     */
    eventSource,
    eventTypes,
    extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 },
    extension_prompt_types: { NONE: -1, IN_CHAT: 0, BEFORE_PROMPT: 1, AFTER_PROMPT: 2 },
    saveSettingsDebounced: persistSettings,
    saveMetadata: () => persistSettings(),
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    /* Tavern Helper's own namespace, present on newer builds. */
    tavern_helper: { getContext },
  };

  /** Anything not implemented resolves to a harmless function/undefined. */
  const proxy = new Proxy(api, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      return undefined;
    },
  });

  const spy = () => {
    // Re-emit kernel events as ST events so listeners fire.
    const kernel = useApp.getState().kernel;
    if (!kernel) return;
    /*
     * Publish the live bus so host-runtime consumers (VALUE_BINDINGS.eventSource
     * and the snapshot) hand extensions THIS object — a separate no-op would
     * leave the renderer deaf to every event.
     */
    setSharedEventBus(eventSource);
    /*
     * Kernel → ST event names. The RENDERED events matter most: 酒馆助手's
     * message renderer subscribes to exactly these four to know a floor's DOM
     * is ready (src/store/iframe_runtimes/message.ts L121-127) — without them
     * it never re-renders.
     */
    const pairs: Array<[string, string[]]> = [
      // user floor committed → USER_MESSAGE_RENDERED (payload: message_id)
      ['chat:message-sent', [eventTypes.MESSAGE_SENT, eventTypes.USER_MESSAGE_RENDERED]],
      // assistant floor committed → CHARACTER_MESSAGE_RENDERED
      ['chat:message-received', [eventTypes.MESSAGE_RECEIVED, eventTypes.CHARACTER_MESSAGE_RENDERED]],
      ['chat:message-regenerated', [eventTypes.MESSAGE_UPDATED, eventTypes.CHARACTER_MESSAGE_RENDERED]],
      ['chat:message-edited', [eventTypes.MESSAGE_UPDATED]],
      ['chat:message-deleted', [eventTypes.MESSAGE_DELETED]],
      ['chat:swiped', [eventTypes.MESSAGE_SWIPED]],
      ['chat:changed', [eventTypes.CHAT_CHANGED, eventTypes.CHAT_LOADED]],
      // 聊天数据载入且楼层 DOM 就绪 —— TH 用它做**首次全量重扫**
      // （dist/index.js `chatLoaded` 订阅）。必须在 .mes 已挂载后发出。
      ['chat:loaded', [eventTypes.CHAT_LOADED]],
      ['generation:start', [eventTypes.GENERATION_STARTED]],
      ['generation:end', [eventTypes.GENERATION_ENDED, eventTypes.GENERATION_STOPPED]],
    ];
    for (const [from, targets] of pairs) {
      try {
        kernel.events.on(from, (payload: unknown) => {
          /*
           * ST's event bus passes `message_id` as the FIRST argument
           * (`emit(CHARACTER_MESSAGE_RENDERED, messageId, type)`), and TH does
           * `Number(message_id)` / indexes `chat[message_id]` with it. RPNow's
           * kernel emits `{ chatId, message, message_id }`, so the payload must
           * be unwrapped here — otherwise handlers receive an object and get
           * `NaN`. `MESSAGE_DELETED` carries the remaining length, which we
           * pass through verbatim (also a number).
           */
          const first =
            payload && typeof payload === 'object' && 'message_id' in payload
              ? (payload as { message_id?: unknown }).message_id
              : payload;
          for (const to of targets) eventSource.emit(to, first);
        });
      } catch {
        /* unknown event name on this kernel — fine */
      }
    }
  };
  spy();

  return {
    api: proxy as Record<string, unknown>,
    dispose: () => listeners.clear(),
  };
}

/**
 * Load an ST extension: inject CSS, evaluate the script with the shim bound to
 * `SillyTavern`, and keep a handle so `uninstall` can clean up.
 */
export async function activateSTExtension(
  pluginId: string,
  files: STExtensionFiles,
): Promise<{ dispose: () => void }> {
  /*
   * SillyTavern extensions ship a global stylesheet (`css` in the manifest) that
   * assumes it owns the page. Injected raw, a `body { padding }` or `* { … }`
   * rule from the extension would restyle RPNow itself — that is what put a 3px
   * inset around the whole app.
   *
   * So the sheet is scoped to the extension's own subtree: selectors gain
   * `[data-rp-scope]`, `html`/`body`/`:root` are rewritten to that subtree, and
   * everything lands in a low-priority `@layer` (see scoped-styles.ts).
   */
  const scopeRoot = `[${SCOPE_ATTR}="${pluginId}"]`;
  let scopedStyles: { dispose: () => void } | undefined;
  if (files.styles) {
    if (isFrontendRendererManifest(files.manifest)) {
      /*
       * 酒馆助手的界面**跨越插件子树**：渲染容器在 `#chat`，设置面板在宿主
       * 设置表面。作用域化会让它的样式全部匹配不到（真机实测：面板只剩边框
       * 和基本布局）。ST 本身也是全局加载这份 CSS，这里保持一致。
       */
      const globalTag = document.createElement('style');
      globalTag.setAttribute('rpnow-st-global-style', pluginId);
      globalTag.textContent = files.styles;
      document.head.appendChild(globalTag);
      scopedStyles = { dispose: () => globalTag.remove() };
    } else {
      document.documentElement.setAttribute(SCOPE_ATTR, pluginId);
      scopedStyles = injectScopedStyles({
        pluginId,
        hostSelector: scopeRoot,
        css: files.styles,
        attrs: { 'rpnow-st-style': pluginId },
      });
    }
  }

  // Host environment: globals, #extensions_settings mount node, host module shims.
  await installHostGlobals();
  publishHostState();

  const { api, dispose } = buildShim(pluginId);
  const g = globalThis as unknown as {
    SillyTavern?: unknown;
    jQuery?: unknown;
    ['$']?: unknown;
  };
  const previous = g.SillyTavern;
  g.SillyTavern = api;

  let runtimeDispose: (() => void) | undefined;
  /** Host-runtime blob URLs, released on dispose. */
  const hostBlobs: Array<[string, string]> = [];
  /** Module blob URLs — released on dispose, never while the graph is loading. */
  const moduleBlobs: string[] = [];
  try {
    /*
     * Extensions come in two shapes and must be loaded differently:
     *
     *   - modern ones (酒馆助手 ≥ v4) are ES modules: `import { … } from '…'`,
     *     `export …`. `new Function` rejects those with
     *     "Cannot use import statement outside a module".
     *   - older ones are plain IIFEs that expect `SillyTavern`/`jQuery` in scope.
     *
     * Strategy: try the ES-module path first (blob URL + dynamic import, which
     * the CSP already allows via `blob:`); if the parse fails, fall back to the
     * classic `new Function` evaluation. Either way the shim is installed on
     * `window` first, so module code can read the global.
     *
     * Bare specifiers (`import x from 'lodash'`) cannot be resolved here — the
     * error message says so explicitly instead of failing cryptically.
     */
    const jQueryLike = Object.assign(() => ({ length: 0 }), {
      ready: (cb: () => void) => setTimeout(cb, 0),
      each: () => jQueryLike,
      on: () => jQueryLike,
      off: () => jQueryLike,
      find: () => jQueryLike,
      text: () => '',
      val: () => '',
      append: () => jQueryLike,
      remove: () => jQueryLike,
    });
    g.jQuery = g.jQuery ?? jQueryLike;
    g.$ = g.$ ?? jQueryLike;

    const looksLikeModule = /(^|[\s;])(import|export)\s/.test(files.script);

    if (looksLikeModule) {
      /*
       * Why this is intricate.
       *
       * SillyTavern serves each extension from a real directory over HTTP and
       * simply appends `<script type="module" src="/scripts/extensions/x/index.js">`.
       * The BROWSER then resolves every relative import against that URL — ST
       * writes zero resolution code itself.
       *
       * We have no such directory: the package lives in IndexedDB, so the only
       * way to give the browser real URLs is one blob URL per module. That means
       * we must rewrite every specifier — and "every" is the hard part. A hand
       * written regex silently misses forms (`export {x} from`, `import.meta`,
       * minified output, `import(/*webpackIgnore*\/…)`), and one miss breaks the
       * whole graph. So specifiers are extracted with **es-module-lexer** (the
       * same parser Vite uses) and substituted by byte offset, which cannot be
       * confused by strings or comments.
       */
      /*
       * Host modules: the caller may pass them, otherwise fall back to the
       * published host runtime (installed by `installHostGlobals`).
       */
      const modules = files.modules ?? {};
      const hostModules = files.hostModules ?? hostShimSources();
      const urls = new Map<string, string>();
      const bareSpecifiers: string[] = [];
      /** Specifiers that resolved to neither the package nor the host runtime. */
      const missingSpecifiers: string[] = [];


      const makeBlob = (source: string) =>
        URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));

      /**
       * Lexical pass: every static + dynamic import specifier with its span.
       *
       * `init` MUST be awaited before the first `parse` — the lexer is a WASM
       * build, and calling `parse` early throws "parse is not a function", which
       * an over-eager catch turned into "no imports found" (so nothing was ever
       * rewritten and every multi-file extension looked broken).
       */
      await lexerInit;

      const parseSpecifiers = (source: string): Array<{ spec: string; start: number; end: number }> => {
        try {
          const [imports] = lexerParse(source);
          return imports.filter((i) => i.n).map((i) => ({ spec: i.n!, start: i.s, end: i.e }));
        } catch (err) {
          // Keep the reason: a silent empty list is what hid this bug before.
          console.warn('[st-bridge] 解析模块说明符失败', err);
          return [];
        }
      };

      /** Rewrite specifiers in one module; returns null when a dep is missing. */
      const rewrite = (fromPath: string, source: string): string => {
        const specs = parseSpecifiers(source);
        if (!specs.length) return source;
        // Apply right-to-left so offsets stay valid.
        let out = source;
        for (const { spec, start, end } of [...specs].sort((a, b) => b.start - a.start)) {
          if (!spec.startsWith('.')) {
            if (!/^https?:/.test(spec)) bareSpecifiers.push(spec);
            continue;
          }
          // Package modules first, then the host runtime (extensions reach
          // outside their ZIP for SillyTavern's own scripts).
          const hit =
            resolveRelative(fromPath, spec).find((c) => urls.has(c)) ??
            (() => {
              const key = hostModuleKey(spec);
              return key && urls.has(key) ? key : undefined;
            })();
          if (!hit) {
            missingSpecifiers.push(spec);
            continue;
          }
          out = `${out.slice(0, start)}${urls.get(hit)!}${out.slice(end)}`;
        }
        return out;
      };

      /*
       * Emission, done once.
       *
       * Every module gets a blob URL BEFORE any body is rewritten, so rewriting
       * never depends on graph order (the old DFS approach broke whenever a
       * parent came before its child, and cycles were unsolvable).
       *
       * The order below is load-bearing:
       *   1. reserve a placeholder blob per module  → `urls` is complete;
       *   2. rewrite every body against that complete map → `finalUrls`;
       *   3. only NOW release the placeholders, since step 2 already copied
       *      every final URL into `urls`.
       * Revoking earlier makes the rewritten bodies point at dead URLs, which
       * surfaces as "Failed to fetch dynamically imported module: blob:…".
       */
      const entryPath = files.entryPath || 'index.js';
      const allPaths = [...new Set([entryPath, ...Object.keys(modules)])];

      /*
       * Host runtime modules get URLs up front too, so a rewrite can point at
       * them exactly like a package module. Their keys are host-relative
       * (`scripts/utils.js`), which never collide with package paths.
       */
      for (const [key, src] of Object.entries(hostModules)) {
        urls.set(key, makeBlob(src));
        hostBlobs.push([key, urls.get(key)!]);
      }

      /*
       * Round 1 — reserve a URL per module so `urls` is complete and every
       * rewrite below can resolve any sibling regardless of graph order.
       */
      for (const p of allPaths) {
        const src = p === entryPath ? files.script : modules[p];
        if (src === undefined) continue;
        urls.set(p, makeBlob(src));
      }

      /*
       * Convergence, without revoking anything.
       *
       * A module body's text depends on its dependencies' URLs, so a single pass
       * yields bodies pointing at not-yet-rewritten blobs. Re-running the pass
       * converges after two iterations (the URL mapping is stable from then on).
       *
       * Every generated blob is LEFT ALIVE until the extension is disposed of.
       * Revoking an intermediate round is what caused
       * "Failed to fetch dynamically imported module: blob:…": the entry of the
       * final round still referenced a sibling from an earlier round, which had
       * been released. The memory cost is bounded by the package size (~1 MB)
       * and everything is freed on `dispose()`.
       */
      const keepAlive = moduleBlobs;
      keepAlive.push(...urls.values());

      for (let pass = 0; pass < 2; pass++) {
        const next = new Map<string, string>();
        for (const p of allPaths) {
          const src = p === entryPath ? files.script : modules[p];
          if (src === undefined) continue;
          next.set(p, makeBlob(rewrite(p, src)));
        }
        for (const [p, u] of next) {
          urls.set(p, u);
          keepAlive.push(u);
        }
      }

      const entryUrl = urls.get(entryPath)!;

      try {
        const mod = (await import(/* @vite-ignore */ entryUrl)) as Record<string, unknown>;
        /*
         * SillyTavern activates extensions by calling the hook named in
         * `manifest.hooks.activate` (酒馆助手 exports `activateTauriTavernChatSurface`
         * and points `hooks.activate` at it). Loading the module alone never
         * starts anything — the exported hook must actually be invoked, or the
         * extension installs but renders nothing (the reported symptom).
         */
        const hooks = (files.manifest as { hooks?: { activate?: string } }).hooks;
        const hookName = hooks?.activate;
        if (hookName && typeof mod[hookName] === 'function') {
          await (mod[hookName] as () => unknown)();
        } else if (typeof mod.default === 'function') {
          await (mod.default as () => unknown)();
        }
        /*
         * Mark the front-end renderer so the message renderer keeps `pre > code`
         * intact instead of swapping in RPNow's own card. Without this flag the
         * two renderers race and the extension never sees its input.
         */
        if (isFrontendRendererManifest(files.manifest)) setFrontendRendererActive(true);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/Failed to resolve module specifier|Cannot find module/i.test(msg)) {
          const which = missingSpecifiers.length
            ? [...new Set(missingSpecifiers)].slice(0, 3).join('、')
            : bareSpecifiers.length
              ? [...new Set(bareSpecifiers)].slice(0, 3).join('、')
              : msg;
          const packed = Object.keys(files.modules ?? {}).slice(0, 8).join('、') || '（无）';
          throw new Error(
            `酒馆扩展依赖了包外模块：${which}。` +
              `包内文件：${packed}${Object.keys(files.modules ?? {}).length > 8 ? ' 等' : ''}。`,
          );
        }
        throw err;
      } finally {
        /*
         * Do NOT revoke here: `import()` resolves asynchronously and the
         * module graph keeps fetching sibling blobs afterwards. Revoking in
         * `finally` produced "Failed to fetch dynamically imported module".
         * The blobs are released in `dispose()` instead.
         */
      }
    } else {
      const factory = new Function(
        'SillyTavern',
        'jQuery',
        '$',
        `${files.script}\n;return undefined;`,
      ) as (st: unknown, jQuery: unknown, $: unknown) => unknown;
      factory(api, jQueryLike, jQueryLike);
    }
  } catch (err) {
    console.error(`[st-bridge] ${pluginId} 执行失败`, err);
    g.SillyTavern = previous;
    g.jQuery = undefined;
    g.$ = undefined;
    dispose();
    throw err;
  }

  return {
    dispose: () => {
      runtimeDispose?.();
      dispose();
      if (isFrontendRendererManifest(files.manifest)) setFrontendRendererActive(false);
      g.SillyTavern = previous;
      scopedStyles?.dispose();
      document.documentElement.removeAttribute(SCOPE_ATTR);
      // Module URLs outlive activation; release them with the extension.
      for (const u of moduleBlobs) URL.revokeObjectURL(u);
      moduleBlobs.length = 0;
      for (const [, u] of hostBlobs) URL.revokeObjectURL(u);
      hostBlobs.length = 0;
    },
  };
}


