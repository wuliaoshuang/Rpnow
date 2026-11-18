/**
 * SillyTavern **host runtime** — the pieces an extension assumes it can reach
 * because it lives inside a SillyTavern install.
 *
 * Why this exists
 * ---------------
 * SillyTavern unpacks an extension to
 * `public/scripts/extensions/third-party/<name>/` and loads
 * `<script type="module" src="…/dist/index.js">`. Every relative import then
 * resolves against that directory, so an extension can reach the *host* tree
 * (`../../../../../scripts/utils.js`). SillyTavern writes no resolution code —
 * the directory layout is the mechanism.
 *
 * RPNow stores packages in IndexedDB, so there is no host tree. This module
 * provides one:
 *
 *   1. `installHostGlobals()` — globals an extension expects on `window`
 *      (`_` lodash, `$`/`jQuery`, `moment`, `DOMPurify`, `Popper`, `toastr`,
 *      `hljs`), plus the `#extensions_settings` mount node and the tavern
 *      state globals (`characters`, `chat`, `eventSource`, `name2`, …).
 *   2. `buildHostShims()` — for every host module an extension imports, a
 *      module exporting the bindings it asked for.
 *
 * Bindings default to a PLAIN function. A proxy that answers every property
 * with another object sends Vue's deep traversal into an endless walk
 * ("Maximum call stack size exceeded"), so value-shaped bindings get real
 * values instead (see `VALUE_BINDINGS`).
 */

import { useApp } from '@/state/store.js';
import {
  getRegexedString as engineGetRegexedString,
  REGEX_PLACEMENT as ST_REGEX_PLACEMENT,
} from '../prompt/regex-engine.js';
import { getPresetRegexScripts } from '../prompt/preset-extensions.js';
import type { RPRegexScript } from '../types/card.js';

/**
 * Scripts a plugin sees through `getRegexedString`, in ST order:
 * SCOPED (character card) then PRESET. The GLOBAL layer has no source yet.
 */
function currentRegexScripts(): RPRegexScript[] {
  const s = useApp.getState();
  const chat = s.chats.find((c) => c.id === s.activeChatId) ?? s.chats[0];
  const card = s.cards.find((c) => c.id === chat?.cardId);
  const preset =
    s.presets.find((p) => p.id === chat?.presetId) ??
    s.presets.find((p) => p.id === (s.settings as { defaultPresetId?: string }).defaultPresetId) ??
    s.presets[0];
  const scoped = (card?.data.extensions?.regex_scripts as RPRegexScript[] | undefined) ?? [];
  return [...scoped, ...getPresetRegexScripts(preset)];
}

/** Attribute marking the extension's own DOM subtree. */
export const HOST_SCOPE = 'data-rp-host';

export interface HostBinding {
  module: string;
  name: string;
}

/**
 * The host-relative modules 酒馆助手 imports, with the bindings it needs.
 * Keys are what `hostModuleKey()` produces.
 */
export const TAVERN_HELPER_BINDINGS: Record<string, string[]> = {
  'scripts/utils.js': [
    'Stopwatch', 'delay', 'download', 'ensureImageFormatSupported', 'getBase64Async',
    'getCharaFilename', 'getImageSizeFromDataURL', 'getSanitizedFilename',
    'getStringHash', 'isDataURL', 'showFontAwesomePicker', 'uuidv4',
  ],
  'scripts/i18n.js': ['getCurrentLocale', 't'],
  'script.js': [
    'Generate', 'MAX_INJECTION_DEPTH', 'activateSendButtons', 'addOneMessage',
    'baseChatReplace', 'characters', 'chat', 'chat_metadata', 'cleanUpMessage',
    'clearChat', 'countOccurrences', 'deactivateSendButtons', 'default_avatar',
    'default_user_avatar', 'deleteCharacter', 'eventSource', 'event_types',
    'extension_prompt_roles', 'extension_prompt_types', 'extension_prompts',
    'getBiasStrings', 'getCharacterCardFields', 'getCharacters', 'getCurrentChatId',
    'getExtensionPromptRoleByName', 'getMaxContextSize', 'getOneCharacter',
    'getPastCharacterChats', 'getRequestHeaders', 'getThumbnailUrl', 'isOdd',
    'is_send_press', 'main_api', 'messageFormatting', 'name1', 'name2', 'online_status',
    'parseMesExamples', 'printCharacters', 'printMessages', 'reloadCurrentChat',
    'reloadMarkdownProcessor', 'saveCharacterDebounced', 'saveChatConditional',
    'saveMetadata', 'saveSettings', 'saveSettingsDebounced', 'scrollChatToBottom',
    'selectCharacterById', 'setExtensionPrompt', 'setGenerationProgress',
    'setUserName', 'showSwipeButtons', 'stopGeneration', 'substituteParams',
    'substituteParamsExtended', 'system_avatar', 'system_message_types', 'this_chid',
    'unshallowCharacter', 'user_avatar',
  ],
  'scripts/world-info.js': [
    'DEFAULT_DEPTH', 'DEFAULT_WEIGHT', 'METADATA_KEY', 'convertCharacterBook',
    'createNewWorldInfo', 'deleteWorldInfo', 'getWorldInfoPrompt', 'getWorldInfoSettings',
    'loadWorldInfo', 'newWorldInfoEntryTemplate', 'parseRegexFromString', 'saveWorldInfo',
    'selected_world_info', 'setWorldInfoButtonClass', 'wi_anchor_position', 'world_info',
    'world_info_include_names', 'world_info_logic', 'world_info_position', 'world_names',
  ],
  'scripts/openai.js': [
    'ChatCompletion', 'Message', 'MessageCollection', 'getChatCompletionModel',
    'getStreamingReply', 'isImageInliningSupported', 'oai_settings',
    'prepareOpenAIMessages', 'promptManager', 'proxies', 'sendOpenAIRequest',
    'setOpenAIMessageExamples', 'setOpenAIMessages', 'setupChatCompletionPromptManager',
    'tryParseStreamingError',
  ],
  'scripts/personas.js': ['getUserAvatar', 'getUserAvatars', 'setUserAvatar', 'user_avatar'],
  'scripts/power-user.js': ['flushEphemeralStoppingStrings', 'persona_description_positions', 'power_user'],
  'scripts/authors-note.js': ['NOTE_MODULE_NAME', 'metadata_keys', 'shouldWIAddPrompt'],
  'scripts/extensions.js': ['extensionTypes', 'extension_settings', 'getContext', 'saveMetadataDebounced'],
  'scripts/macros.js': ['MacrosParser', 'getLastMessageId'],
  'scripts/popup.js': ['POPUP_TYPE', 'callGenericPopup'],
  'scripts/extensions/regex/engine.js': ['getRegexedString', 'regex_placement'],
  'scripts/PromptManager.js': ['Prompt', 'PromptCollection'],
  'scripts/RossAscends-mods.js': ['favsToHotswap', 'isMobile'],
  'scripts/preset-manager.js': ['getPresetManager'],
  'scripts/reasoning.js': ['extractReasoningFromData'],
  'scripts/sse-stream.js': ['getEventSourceStream'],
  'scripts/tokenizers.js': ['getTokenCountAsync'],
  'scripts/user.js': ['isAdmin'],
  'scripts/slash-commands.js': ['executeSlashCommandsWithOptions'],
  'scripts/slash-commands/SlashCommand.js': ['SlashCommand'],
  'scripts/slash-commands/SlashCommandArgument.js': ['ARGUMENT_TYPE', 'SlashCommandArgument', 'SlashCommandNamedArgument'],
  'scripts/slash-commands/SlashCommandCommonEnumsProvider.js': ['commonEnumProviders', 'enumIcons'],
  'scripts/slash-commands/SlashCommandEnumValue.js': ['SlashCommandEnumValue', 'enumTypes'],
  'scripts/slash-commands/SlashCommandParser.js': ['SlashCommandParser'],
  'lib/jsoneditor.js': ['Mode', 'ValidationSeverity', 'createJSONEditor'],
};

/**
 * Bindings that must stay LIVE (re-read at access time) instead of being
 * captured once when the shim module evaluates.
 *
 * `chat` is the load-bearing one: TH's render queue computes
 * `_.range(minMesid, chat.length)` and reads `chat[mesid]`. A snapshot array
 * yields an empty range forever — `.TH-render` containers appear (the collapse
 * feature does not read `chat`) but no iframe is ever mounted. Verified on device.
 */
const LIVE_ARRAY_BINDINGS = new Set(['chat']);

/** Build shim sources for the host modules. */
export function buildHostShims(bindings: Record<string, string[]> = TAVERN_HELPER_BINDINGS): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [mod, names] of Object.entries(bindings)) {
    const lines = [
      `const V = globalThis.__rpHostValues || {};`,
      `const F = globalThis.__rpHostUniversal;`,
    ];
    for (const n of names) {
      if (LIVE_ARRAY_BINDINGS.has(n)) {
        /*
         * Proxy that forwards every property read to the CURRENT array returned
         * by `V.chat` (a getter). `length` and numeric indexes are what TH uses;
         * method/iterator lookups are forwarded bound so lodash still works.
         */
        lines.push(
          `const __live_${n} = () => (V[${JSON.stringify(n)}] ?? []);`,
          `export const ${n} = new Proxy([], {`,
          `  get(_t, p) { const a = __live_${n}(); if (p === 'length') return a.length; const v = a[p]; return typeof v === 'function' ? v.bind(a) : v; },`,
          `  has() { return true; },`,
          `});`,
        );
      } else {
        lines.push(
          `export const ${n} = Object.prototype.hasOwnProperty.call(V, ${JSON.stringify(n)}) ? V[${JSON.stringify(n)}] : F(${JSON.stringify(n)});`,
        );
      }
    }
    out[mod] = lines.join('\n');
  }
  return out;
}

/** Publish the value-shaped bindings so shim modules can import them. */
export function publishHostValues(): void {
  /*
   * `eventSource` must resolve to the CURRENT bus at read time, not publish
   * time: the bridge publishes its bus in `spy()`, which runs AFTER
   * `installHostGlobals()` but BEFORE the shim modules are imported. Defining
   * it as a getter on the values object makes every shim import (which reads
   * `V.eventSource` at module-evaluation) pick up whichever bus is live.
   */
  const values = VALUE_BINDINGS as Record<string, unknown>;
  Object.defineProperty(values, 'eventSource', {
    get: () => getEventBus(),
    enumerable: true,
    configurable: true,
  });
  /*
   * Live chat array. Read through a getter so every shim import and every
   * `chat.length` / `chat[mesid]` access sees the CURRENT transcript.
   */
  Object.defineProperty(values, 'chat', {
    get: () => stChatArray(),
    enumerable: true,
    configurable: true,
  });
  (window as unknown as Record<string, unknown>).__rpHostValues = values;
}

/*
 * The shared tavern event bus.
 *
 * The bridge's spy emits ST event names into ONE bus, and every extension that
 * imports `eventSource` (from script.js or via the host snapshot) must get THAT
 * bus - otherwise an extension subscribes to a no-op and never hears the
 * RENDERED events that drive its renderer.
 *
 * Declared at the TOP: VALUE_BINDINGS is evaluated at import time and calls
 * getEventBus(), and a `let` referenced before its declaration line throws
 * "Cannot access before initialization" (TDZ).
 */
interface TavernEventSource {
  on: (name: string, cb: (...args: unknown[]) => void) => void;
  once: (name: string, cb: (...args: unknown[]) => void) => void;
  off: (name: string, cb: (...args: unknown[]) => void) => void;
  /** ST EventEmitter priority registration (used by 酒馆助手). */
  makeFirst: (name: string, cb: (...args: unknown[]) => void) => void;
  makeLast: (name: string, cb: (...args: unknown[]) => void) => void;
  emit: (name: string, ...args: unknown[]) => void;
}

let sharedEventBus: TavernEventSource | undefined;

/** The bridge publishes its live bus here on every activation. */
export function setSharedEventBus(bus: TavernEventSource): void {
  sharedEventBus = bus;
}

/** The bus to hand out - the bridge's when present, else a self-contained one. */
function getEventBus(): TavernEventSource {
  if (sharedEventBus) return sharedEventBus;
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const bus: TavernEventSource = {
    on: (name, cb) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(cb);
    },
    once: (name, cb) => {
      const wrap = (...args: unknown[]) => {
        listeners.get(name)?.delete(wrap);
        cb(...args);
      };
      bus.on(name, wrap);
    },
    off: (name, cb) => {
      listeners.get(name)?.delete(cb);
    },
    makeFirst: (name, cb) => {
      const set = listeners.get(name);
      if (!set || !set.has(cb)) return;
      set.delete(cb);
      listeners.set(name, new Set([cb, ...set]));
    },
    makeLast: (name, cb) => {
      const set = listeners.get(name);
      if (!set || !set.has(cb)) return;
      set.delete(cb);
      listeners.set(name, new Set([...set, cb]));
    },
    emit: (name, ...args) => {
      for (const cb of listeners.get(name) ?? []) {
        try {
          cb(...args);
        } catch (err) {
          console.error('[st-host] event listener failed', name, err);
        }
      }
    },
  };
  return bus;
}
/**
 * ST 形状的当前聊天数组（**实时**）。
 *
 * 为什么必须实时：TH 的渲染队列用 `chat.length` 与 `chat[mesid]` 计算要渲染哪些
 * 楼层（`dist/index.js` `calcToRender`/`DI`/`KV`）。若 shim 导出的是空数组快照，
 * `_.range(min_mesid, 0)` 为空 → runtimes 为空 → `.TH-render iframe` 永不出现
 * （真机实测：容器与折叠按钮都在，唯独 iframe 为 0）。
 */
function stChatArray(): Array<Record<string, unknown>> {
  const s = useApp.getState();
  const chat = s.chats.find((c) => c.id === s.activeChatId) ?? s.chats[0];
  const card = s.cards.find((c) => c.id === chat?.cardId);
  const persona = s.personas.find((p) => p.id === chat?.personaId) ?? s.personas[0];
  const userName = persona?.name || 'User';
  return (chat?.messages ?? []).map((m) => ({
    name: m.role === 'user' ? userName : (card?.data.name ?? 'Assistant'),
    is_user: m.role === 'user',
    is_system: m.role === 'system',
    mes: m.content,
    send_date: String(m.createdAt ?? ''),
    extra: {},
  }));
}

/**
 * Bindings that must return real VALUES rather than a function.
 *
 * The extension formats these into UI text; a function would render as
 * "[object Function]" (or send Vue's traversal into a loop).
 */
export const VALUE_BINDINGS: Record<string, unknown> = {
  /*
   * i18n — the extension renders translated strings everywhere. Its components
   * use `t` as a TAGGED TEMPLATE (`t\`渲染\``), so the first argument is an
   * array of literal parts, not a plain string. Returning the array verbatim
   * made Vue render every label as `[ "渲染" ]` (the screenshot symptom).
   */
  t: ((...args: unknown[]) => {
    const first = args[0];
    if (Array.isArray(first)) return String(first[0] ?? '');
    return String(first ?? '');
  }) as unknown,
  getCurrentLocale: () => 'zh-cn',
  // macros
  getLastMessageId: () => '',
  // authors-note
  NOTE_MODULE_NAME: "author's-note",
  metadata_keys: { prompt: 'prompt', depth: 'depth' },
  shouldWIAddPrompt: () => false,
  // personas
  user_avatar: '',
  getUserAvatar: () => '',
  getUserAvatars: () => [],
  setUserAvatar: () => {},
  // power-user / settings blobs — plain objects so traversal terminates.
  power_user: {},
  persona_description_positions: { NONE: 0, BEFORE_CHAR: 1, AFTER_CHAR: 2 },
  flushEphemeralStoppingStrings: () => {},
  // slash commands
  ARGUMENT_TYPE: { STRING: 'string', NUMBER: 'number', BOOLEAN: 'boolean', ENUM: 'enum' },
  enumTypes: {},
  enumIcons: {},
  /*
   * `commonEnumProviders.boolean('trueFalse')()` returns an enum provider —
   * two chained calls. Each returns a chainable callable so both hops work.
   */
  commonEnumProviders: new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === 'symbol') return undefined;
        const step1 = () => {
          const step2 = () => ({ values: [], icon: '' });
          return new Proxy(step2, {
            get(_t2, p2) {
              if (typeof p2 === 'symbol') return undefined;
              return () => ({ values: [], icon: '' });
            },
          });
        };
        return step1;
      },
    }),
  executeSlashCommandsWithOptions: () => Promise.resolve(),
  // regex engine — real implementation, real enum.
  // ST's `regex_placement` (engine.js:281-292); the previous placeholder used
  // invented names (MD_ONLY/PROMPT_ONLY) that no extension could match.
  regex_placement: ST_REGEX_PLACEMENT,
  /*
   * Real `getRegexedString`: scripts come from the active card (SCOPED) then
   * the preset (PRESET) — ST executes GLOBAL → SCOPED → PRESET. The global
   * layer has no source in RPNow yet, so it contributes nothing.
   */
  getRegexedString: (
    rawString: string,
    placement?: number,
    options?: { isMarkdown?: boolean; isPrompt?: boolean; isEdit?: boolean; depth?: number },
  ) => engineGetRegexedString(String(rawString ?? ''), Number(placement ?? ST_REGEX_PLACEMENT.AI_OUTPUT), {
    isMarkdown: true,
    ...options,
  }, currentRegexScripts()),
  // popup
  POPUP_TYPE: { TEXT: 'text', CONFIRM: 'confirm', INPUT: 'input' },
  callGenericPopup: () => Promise.resolve(),
  // sse
  getEventSourceStream: () => ({ getReader: () => ({ read: async () => ({ done: true }) }) }),
  // tokenizers
  getTokenCountAsync: async () => 0,
  isAdmin: () => false,
  // reasoning
  extractReasoningFromData: () => '',
  /*
   * Preset manager — the extension calls many methods on it at mount
   * (`getSelectedPreset`, `getSelectedPresetName`, …). A proxy supplies any
   * method on demand; every method returns the universal callable so a
   * follow-up call on its result still works.
   */
  getPresetManager: makeUniversalCallable(),
  // classes used with `new`
  Prompt: makeStubClass('Prompt'),
  PromptCollection: makeStubClass('PromptCollection'),
  SlashCommand: makeStubClass('SlashCommand'),
  SlashCommandArgument: makeStubClass('SlashCommandArgument'),
  SlashCommandNamedArgument: makeStubClass('SlashCommandNamedArgument'),
  SlashCommandParser: makeStubClass('SlashCommandParser'),
  SlashCommandEnumValue: makeStubClass('SlashCommandEnumValue'),
  // Classes below need static factory methods the extension calls
  // (`SlashCommandArgument.fromProps`, `MacrosParser.registerMacro`, …).
  // A static proxy supplies any of them instead of enumerating by hand.
  MacrosParser: makeStubClass('MacrosParser'),
  // world-info
  DEFAULT_DEPTH: 4,
  DEFAULT_WEIGHT: 100,
  METADATA_KEY: 'world_info',
  world_info: '',
  selected_world_info: [],
  world_info_position: { BEFORE: 0, AFTER: 1 },
  wi_anchor_position: { BEFORE: 0, AFTER: 1 },
  world_info_logic: { AND_ANY: 0, NOT_ANY: 1, NOT_ALL: 2, AND_ALL: 3 },
  world_info_include_names: false,
  world_names: [],
  convertCharacterBook: () => ({ entries: [] }),
  createNewWorldInfo: () => {},
  deleteWorldInfo: () => Promise.resolve(),
  getWorldInfoPrompt: () => Promise.resolve(''),
  getWorldInfoSettings: () => ({}),
  loadWorldInfo: () => Promise.resolve({}),
  newWorldInfoEntryTemplate: {},
  parseRegexFromString: () => ({}),
  saveWorldInfo: () => Promise.resolve(),
  setWorldInfoButtonClass: () => {},
  // extensions
  extensionTypes: {},
  extension_settings: {},
  getContext: () => ({}),
  saveMetadataDebounced: () => {},
  // RossAscends
  favsToHotswap: () => {},
  isMobile: () => false,
  // jsoneditor
  Mode: {},
  ValidationSeverity: {},
  createJSONEditor: () => {},
  // utils — real implementations where trivial
  delay: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  uuidv4: () =>
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    }),
  getStringHash: (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
  },
  isDataURL: (s: unknown) => typeof s === 'string' && s.startsWith('data:'),
  getBase64Async: async (s: string) => s,
  download: () => {},
  getImageSizeFromDataURL: () => ({ width: 0, height: 0 }),
  getCharaFilename: () => '',
  getSanitizedFilename: (s: string) => s,
  ensureImageFormatSupported: async (s: string) => s,
  showFontAwesomePicker: () => Promise.resolve(''),
  Stopwatch: class {
    start() {}
    stop() {}
    getElapsed() {
      return 0;
    }
  },
  // openai / chat completion — structural stubs
  Message: makeStubClass('Message'),
  MessageCollection: makeStubClass('MessageCollection'),
  ChatCompletion: makeStubClass('ChatCompletion'),
  oai_settings: {},
  proxies: [],
  // A `null` here breaks module-scope reads such as
  // `renderPromptManager: promptManager.render` — the whole bundle dies.
  promptManager: { render: () => {}, renderDebounced: () => {} },
  getChatCompletionModel: () => '',
  getStreamingReply: async function* () {},
  isImageInliningSupported: () => false,
  prepareOpenAIMessages: () => [],
  setOpenAIMessageExamples: () => {},
  setOpenAIMessages: () => {},
  sendOpenAIRequest: () => Promise.resolve(),
  setupChatCompletionPromptManager: () => {},
  tryParseStreamingError: () => null,
  // script.js — primitives/objects, not functions
  characters: [],
  /*
   * `chat` is deliberately NOT defined here as a value: it is installed as a
   * live getter in `publishHostValues()` and handed to shim modules through a
   * proxy (see `LIVE_ARRAY_BINDINGS`). A static array makes TH's render queue
   * compute an empty range.
   */
  chat_metadata: {},
  default_avatar: '',
  default_user_avatar: '',
  /*
   * `eventSource` is imported from script.js by 酒馆助手 and needs the full
   * listener API. It MUST be the shared bus — the bridge's spy emits the
   * RENDERED events into it, and a separate no-op leaves the renderer deaf.
   */
  eventSource: getEventBus(),
  event_types: {},
  extension_prompt_roles: { SYSTEM: 0, USER: 1, ASSISTANT: 2 },
  extension_prompt_types: { NONE: -1, IN_CHAT: 0, BEFORE_PROMPT: 1, AFTER_PROMPT: 2 },
  extension_prompts: [],
  is_send_press: false,
  main_api: '',
  name1: '',
  name2: '',
  online_status: '',
  system_avatar: '',
  system_message_types: {},
  this_chid: null,
  Generate: () => Promise.resolve(''),
  MAX_INJECTION_DEPTH: 4,
  activateSendButtons: () => {},
  deactivateSendButtons: () => {},
  addOneMessage: () => {},
  baseChatReplace: (s: string) => s,
  cleanUpMessage: (s: string) => s,
  clearChat: () => Promise.resolve(),
  countOccurrences: () => 0,
  deleteCharacter: () => Promise.resolve(),
  getBiasStrings: () => '',
  getCharacterCardFields: () => ({}),
  getCharacters: () => Promise.resolve(),
  getCurrentChatId: () => '',
  getExtensionPromptRoleByName: () => 0,
  getMaxContextSize: () => 32000,
  getOneCharacter: () => null,
  getPastCharacterChats: () => [],
  getRequestHeaders: () => ({}),
  getThumbnailUrl: () => '',
  isOdd: (n: number) => n % 2 === 1,
  messageFormatting: (s: string) => s,
  parseMesExamples: () => '',
  printCharacters: () => {},
  printMessages: () => {},
  reloadCurrentChat: () => {},
  reloadMarkdownProcessor: () => {},
  saveCharacterDebounced: () => {},
  saveChatConditional: () => Promise.resolve(),
  saveMetadata: () => {},
  saveSettings: () => {},
  saveSettingsDebounced: () => {},
  scrollChatToBottom: () => {},
  selectCharacterById: () => {},
  setExtensionPrompt: () => {},
  setGenerationProgress: () => {},
  setUserName: () => {},
  showSwipeButtons: () => {},
  stopGeneration: () => {},
  substituteParams: (s: string) => s,
  substituteParamsExtended: (s: string) => s,
  unshallowCharacter: () => {},
};

/** Load a UMD bundle as a classic script (it registers its own global). */
function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`无法加载 ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * A universal callable shared by several host objects.
 *
 * Calling it, reading any property, or constructing all yield the SAME value —
 * the walk terminates, and chained factory calls
 * (`X.fromProps(...)()`) still resolve.
 */
function makeUniversalCallable(): unknown {
  const u = function (..._args: unknown[]) {
    return u;
  };
  return new Proxy(u, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive) return () => '';
      if (prop === 'toString') return () => '';
      if (prop === 'then') return undefined;
      if (prop === Symbol.iterator) return undefined;
      if (prop === 'length') return 0;
      return u;
    },
    apply() {
      return u;
    },
    construct() {
      return u;
    },
  });
}

/**
 * A class whose ANY static member resolves to a safe no-op function.
 *
 * Extensions call static factories (`X.fromProps(...)`, `X.registerMacro(...)`)
 * on host classes; enumerating them one by one is a losing game, so unknown
 * statics are supplied on demand. Instance side stays empty.
 */
export function makeStubClass(name: string): unknown {
  const Base = class {};
  const cache = new Map<string, unknown>([['name', name]]);

  /*
   * A universal CALLABLE for this class's statics.
   *
   * Extensions use chained factories: `SlashCommandArgument.boolean('x')()`
   * (the result of `.boolean()` is itself called). Returning `undefined` or a
   * plain function breaks the chain — "X.boolean is not a function" /
   * "undefined is not a function". So every unknown static returns the
   * universal callable, which is itself callable and re-callable.
   */
  const universal = (): unknown => {
    const u = function (..._args: unknown[]) {
      return u;
    };
    return new Proxy(u, {
      get(_t, prop) {
        if (prop === Symbol.toPrimitive) return () => '';
        if (prop === 'toString') return () => '';
        if (prop === 'then') return undefined;
        if (prop === Symbol.iterator) return undefined;
        if (prop === 'length') return 0;
        return u;
      },
      apply() {
        return u;
      },
      construct() {
        return u;
      },
    });
  };

  return new Proxy(Base, {
    get(target, prop) {
      if (typeof prop === 'symbol') return universal();
      const key = String(prop);
      if (key in target) return (target as unknown as Record<string, unknown>)[key];
      if (!cache.has(key)) cache.set(key, universal());
      return cache.get(key);
    },
  });
}

/**
 * Install the placeholder factory used by shim modules.
 *
 * Bindings default to a PLAIN function, not a proxy. A proxy that answers every
 * property with another object sends Vue's deep traversal into an endless walk
 * ("Maximum call stack size exceeded"); a plain function has no enumerable
 * properties, so the walk stops, and calling it returns undefined.
 */
export function installUniversalFactory(): void {
  const plain = function () {
    return undefined;
  };
  (globalThis as Record<string, unknown>).__rpHostUniversal = () => plain;
}

/**
 * Minimal highlight.js stand-in.
 *
 * The npm package ships no UMD build and the only call the extension makes is
 * `hljs.highlightElement(el)`, so a tiny implementation keeps code blocks
 * readable (escaped, monospace) without pretending to tokenise.
 */
function installMinimalHljs(): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.hljs) return;
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  w.hljs = {
    highlightElement(el: HTMLElement) {
      if (el.dataset.highlighted) return;
      el.dataset.highlighted = 'true';
      el.innerHTML = escape(el.textContent ?? '');
    },
    highlight(code: string, _opts: { language?: string } = {}) {
      return { value: escape(code), language: _opts.language ?? '' };
    },
    highlightAuto(code: string) {
      return { value: escape(code), language: '' };
    },
    getLanguage: () => undefined,
    registerLanguage: () => {},
    configure: () => {},
    initHighlighting: () => {},
  };
}

/**
 * Install the globals and DOM an extension expects from its host.
 *
 * Async because the UMD bundles (lodash/jQuery/moment/DOMPurify/popper) are
 * loaded as classic scripts — they do not register globals when imported as
 * modules.
 */
export async function installHostGlobals(): Promise<void> {
  installUniversalFactory();
  publishHostValues();
  installMinimalHljs();

  const w = globalThis as unknown as Record<string, unknown>;

  await Promise.all([
    w._ ? Promise.resolve() : loadScript('/vendor/lodash.js'),
    w.jQuery || w.$ ? Promise.resolve() : loadScript('/vendor/jquery.js'),
    w.moment ? Promise.resolve() : loadScript('/vendor/moment.js').catch(() => {}),
    w.DOMPurify ? Promise.resolve() : loadScript('/vendor/dompurify.js').catch(() => {}),
    w.Popper ? Promise.resolve() : loadScript('/vendor/popper.js').catch(() => {}),
  ]);
  if (!w.moment) {
    const shim = (d?: Date | string | number) => {
      const date = d === undefined ? new Date() : new Date(d as string | number);
      return {
        format: () => date.toISOString(),
        fromNow: () => '',
        add: () => shim(date),
        subtract: () => shim(date),
        isValid: () => !Number.isNaN(date.getTime()),
      };
    };
    w.moment = shim;
  }
  if (!w.DOMPurify) {
    w.DOMPurify = { sanitize: (s: string) => s };
  }

  const popper = w.Popper as unknown as Record<string, unknown> | undefined;
  if (!popper) {
    const factory = function () {
      return { update: () => {}, destroy: () => {}, setOptions: () => {} };
    };
    (factory as unknown as Record<string, unknown>).placements = [];
    (factory as unknown as Record<string, unknown>).createPopper = () => ({
      update: () => {},
      destroy: () => {},
      forceUpdate: () => {},
      setOptions: () => {},
      state: {},
    });
    w.Popper = factory;
  } else {
    if (typeof popper.createPopper !== 'function') {
      popper.createPopper = () => ({
        update: () => {},
        destroy: () => {},
        forceUpdate: () => {},
        setOptions: () => {},
        state: {},
      });
    }
    if (typeof popper.placements !== 'object' || !popper.placements) {
      popper.placements = [];
    }
  }

  // toastr — toast notifications; a no-op keeps the extension from throwing.
  if (!w.toastr) {
    const noop = () => {};
    w.toastr = {
      success: noop, error: noop, info: noop, warning: noop,
      clear: noop, remove: noop, options: {}, getContainer: () => null,
    };
  }

  /*
   * The extension mounts its Vue app into `#extensions_settings`.
   *
   * ⚠️ Do NOT append this to `main`: it is `overflow:hidden` with a fixed
   * flex height (`AppShell.tsx`), so anything appended there is clipped and the
   * user has no route to reach it — the root cause of "plugin settings are
   * invisible / squeezed". The visible surface is rendered by PluginsPage;
   * if the user installs an extension before ever opening that page we fall
   * back to a body-level node (functional, not pretty) and PluginsPage moves it
   * into view when opened.
   */
  if (!document.getElementById('extensions_settings')) {
    const host = document.createElement('div');
    host.id = 'extensions_settings';
    host.setAttribute(HOST_SCOPE, '');
    /*
     * Global, **host-owned** mount point — never rendered by React.
     *
     * 酒馆助手 mounts its Vue app here once at startup and renders front-end
     * documents by teleporting iframes into `#chat`. If this node lived inside
     * the plugin page's React tree it would vanish whenever the user opens a
     * chat → the Vue app unmounts → no iframe can ever be created (device
     * verified: `.TH-render` containers appear, `iframe`s never do).
     *
     * Visibility is toggled by `showExtensionsSurface()/hideExtensionsSurface()`
     * so the panel only appears where the user expects it.
     */
    host.className = 'rp-extensions-drawer';
    host.style.cssText =
      'display:none;position:fixed;inset:0;z-index:1200;' +
      'background:rgba(0,0,0,0.35);pointer-events:auto;' +
      'overflow-y:auto;padding:16px';
    host.dataset.rpFallbackSurface = '1';
    document.body.appendChild(host);
    document.dispatchEvent(new CustomEvent('rp:extensions-surface-needed'));
  }
}

/**
 * Style for the host-owned extension drawer (kept global on purpose: the panel
 * may be mounted by an extension and lives outside React's tree).
 */
function installDrawerStyles(): void {
  const doc = document;
  if (doc.getElementById('rp-extension-drawer-style')) return;
  const tag = doc.createElement('style');
  tag.id = 'rp-extension-drawer-style';
  tag.textContent = `
#extensions_settings.rp-open {
  display: block;
}
#extensions_settings .inline-drawer,
#extensions_settings > div {
  max-width: min(1100px, 92vw);
  margin-inline: auto;
}
`;
  doc.head.appendChild(tag);
}

/**
 * Show / hide the extension settings drawer (host-owned, survives routing).
 *
 * The drawer is a full-screen scrim with the panels laid out centred, mirroring
 * SillyTavern's own Extensions drawer rather than dumping content at the bottom
 * of the chat transcript.
 */
export function showExtensionsSurface(): void {
  installDrawerStyles();
  const host = document.getElementById('extensions_settings');
  if (!host) return;
  host.style.display = 'block';
  host.classList.add('rp-open');
}

export function hideExtensionsSurface(): void {
  const host = document.getElementById('extensions_settings');
  if (!host) return;
  host.style.display = 'none';
  host.classList.remove('rp-open');
}

/**
 * Move a body-level fallback surface into the visible PluginsPage slot.
 * Called by the plugin page after mount.
 */
export function adoptExtensionsSurface(slot: HTMLElement): void {
  const host = document.getElementById('extensions_settings');
  if (!host || host.parentElement === slot) return;
  delete host.dataset.rpFallbackSurface;
  // Reveal it now that a real, visible surface owns it.
  (host as HTMLElement).style.display = 'flex';
  slot.insertBefore(host, slot.firstChild);
}

/**
 * True while a front-end rendering extension (酒馆助手 / Tavern Helper) is
 * installed and active.
 *
 * The renderer reads this to decide whether to keep `pre > code` for the
 * extension (`false` → RPNow renders its own HTML card instead). See
 * docs/research/rpnow-st-compat-contract.md §2「兜底与插件共存」.
 */
export function isFrontendRendererActive(): boolean {
  return Boolean((globalThis as unknown as { __rpFrontendRendererActive?: boolean }).__rpFrontendRendererActive);
}

/** Mark/unmark the front-end renderer. Idempotent; cleared on dispose. */
export function setFrontendRendererActive(active: boolean): void {
  (globalThis as unknown as { __rpFrontendRendererActive?: boolean }).__rpFrontendRendererActive = active;
}

/** The host module key for a specifier, or null when it is not host-relative. */
export function hostModuleKey(spec: string): string | null {
  const m = spec.match(/((?:scripts|lib)\/[^/].*|script\.js)$/);
  return m ? m[1] : null;
}

let cachedShims: Record<string, string> | undefined;

/**
 * The shim sources, generating them on first use.
 *
 * Generating lazily matters: the shim text depends only on the binding table,
 * so there is no reason to require an explicit publish step first.
 */
export function hostShimSources(): Record<string, string> {
  if (!cachedShims) cachedShims = buildHostShims();
  return cachedShims;
}

/** Expose the shim sources so the bridge can pass them as `hostModules`. */
export function publishHostShims(): void {
  (window as unknown as Record<string, unknown>).__rpHostShims = buildHostShims();
  installUniversalFactory();
}


/** Snapshot of RPNow state, used to populate the tavern globals. */
export function hostStateSnapshot(): Record<string, unknown> {
  const s = useApp.getState();
  const activeChat = s.chats.find((c) => c.id === s.activeChatId);
  const activeCard = s.cards.find((c) => c.id === activeChat?.cardId);
  const bus = getEventBus();
  return {
    characters: s.cards.map((c) => ({
      name: c.data.name,
      avatar: c.avatar,
      description: c.data.description,
      personality: c.data.personality,
      scenario: c.data.scenario,
      first_mes: c.data.first_mes,
      mes_example: c.data.mes_example,
      creator_notes: c.data.creator_notes ?? '',
      tags: c.data.tags ?? [],
    })),
    chat: activeChat ? activeChat.messages : [],
    chat_metadata: {},
    name1: s.personas[0]?.name ?? 'User',
    name2: activeCard?.data.name ?? '',
    characterId: activeCard?.id ?? null,
    eventSource: {
      on: bus.on,
      once: bus.once,
      off: bus.off,
      removeListener: bus.off,
      makeFirst: bus.makeFirst,
      makeLast: bus.makeLast,
      emit: bus.emit,
      listeners: () => ({}),
    },
    /*
     * Event names follow SillyTavern's `event_types`. The four RENDERED events
     * drive 酒馆助手's floor renderer; MESSAGE_UPDATED/DELETED/SWIPED and
     * CHAT_LOADED keep the rest of its state machine honest.
     */
    event_types: {
      MESSAGE_SENT: 'message_sent',
      MESSAGE_RECEIVED: 'message_received',
      CHARACTER_MESSAGE_RENDERED: 'character_message_rendered',
      USER_MESSAGE_RENDERED: 'user_message_rendered',
      MESSAGE_UPDATED: 'message_updated',
      MESSAGE_DELETED: 'message_deleted',
      MESSAGE_SWIPED: 'message_swiped',
      MORE_MESSAGES_LOADED: 'more_messages_loaded',
      GENERATION_STARTED: 'generation_started',
      GENERATION_ENDED: 'generation_ended',
      GENERATION_STOPPED: 'generation_stopped',
      CHAT_CHANGED: 'chat_changed',
      CHAT_LOADED: 'chat_loaded',
    },
    saveSettingsDebounced: () => {},
    saveMetadata: () => {},
    getRequestHeaders: () => ({ 'Content-Type': 'application/json' }),
    substituteParams: (text: string) => text,
    baseChatReplace: (text: string) => text,
  };
}

/** Publish the snapshot as the tavern globals the bundle reads. */
export function publishHostState(): void {
  const snap = hostStateSnapshot();
  const w = window as unknown as Record<string, unknown>;
  /*
   * `chat` must NOT go through Object.assign: it is published as a getter-only
   * property (live view into the store), and a second activation's plain
   * assignment would throw "Cannot set property chat of #<Window> which has
   * only a getter" — the crash seen on device after reinstall/reactivation.
   */
  const { chat: _chat, eventSource: _eventSource, event_types: _eventTypes, ...rest } = snap as Record<string, unknown>;
  Object.assign(w, rest);
  /*
   * `chat` / `eventSource` / `event_types` are published as dynamic getters so a
   * second activation (or an extension reading the global at any time) always
   * resolves the CURRENT values. Assigning `eventSource` used to freeze the
   * fallback bus that existed before the bridge published its own — listeners
   * then subscribed on one bus while the kernel emitted on another
   * (docs/research/st-plugin-preset-coupling.md §2.10).
   */
  Object.defineProperty(w, 'eventSource', {
    get: () => getEventBus(),
    configurable: true,
  });
  Object.defineProperty(w, 'event_types', {
    get: () => hostStateSnapshot().event_types,
    configurable: true,
  });
  // (Re)define the live getter; configurable so re-activation can replace it.
  Object.defineProperty(w, 'chat', {
    get: () => {
      const s = useApp.getState();
      const active = s.chats.find((c) => c.id === s.activeChatId);
      return active ? active.messages : [];
    },
    configurable: true,
  });
}
