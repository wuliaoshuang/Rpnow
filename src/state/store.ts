/**
 * Application state (zustand).
 *
 * One store keeps the collections the UI reads plus the live kernel reference.
 * Persistence is explicit (`persistCard`, `persistChat`, …) so a failed write
 * never leaves the UI and the database disagreeing silently.
 *
 * Collections:
 *   cards · lorebooks · presets (4 families) · personas · chats
 *   llm connections · image connections · settings
 */

import { create } from 'zustand';
import { idbStorage, settingsStore } from '../core/storage/index.js';
import { DEFAULT_SETTINGS, type RPAppSettings, type RPChat, type RPPersona } from '../core/types/chat.js';
import type { RPCard } from '../core/types/card.js';
import type { RPLorebook } from '../core/types/lorebook.js';
import type { RPUITemplate } from '../core/uitemplate/types.js';
import type { NovelState } from '../core/novel/types.js';
import type { MemoryRecord } from '../core/memory/types.js';
import {
  createBranch as createBranchEngine,
  deleteBranch as deleteBranchEngine,
  renameBranch as renameBranchEngine,
  switchBranch as switchBranchEngine,
} from '../core/branch/engine.js';
import type {
  RPCompletionPreset,
  RPContextTemplate,
  RPInstructTemplate,
  RPReasoningTemplate,
} from '../core/types/preset.js';
import type { LLMConnection } from '../core/llm/types.js';
import type { ImageConnection } from '../core/image/types.js';
import type { ServiceRegistry } from '../core/plugin/registry.js';
import type { RpnxLoader } from '../core/plugins/loader.js';

const KEY = {
  cards: 'rpnow:cards',
  lorebooks: 'rpnow:lorebooks',
  chats: 'rpnow:chats',
  presets: 'rpnow:presets',
  contextTemplates: 'rpnow:context-templates',
  instructTemplates: 'rpnow:instruct-templates',
  reasoning: 'rpnow:reasoning-templates',
  personas: 'rpnow:personas',
  llm: 'rpnow:llm-connections',
  image: 'rpnow:image-connections',
} as const;

export interface AppState {
  /** Kernel instance, created once at boot. */
  kernel?: ServiceRegistry;
  /**
   * Plugin loader, kept in the store rather than a module-level variable so an
   * HMR update cannot reset it out from under a running kernel.
   */
  pluginLoader?: RpnxLoader;

  cards: RPCard[];
  lorebooks: RPLorebook[];
  chats: RPChat[];
  presets: RPCompletionPreset[];
  contextTemplates: RPContextTemplate[];
  instructTemplates: RPInstructTemplate[];
  reasoningTemplates: RPReasoningTemplate[];
  personas: RPPersona[];
  /** Per-chat memory records, keyed by chat id. */
  memories: Record<string, MemoryRecord[]>;
  /** UI templates (HTML 状态栏). */
  uiTemplates: RPUITemplate[];
  /** Novel editor state. */
  novel: NovelState;
  llmConnections: LLMConnection[];
  imageConnections: ImageConnection[];
  settings: RPAppSettings;

  /** Boot state. */
  ready: boolean;
  bootError?: string;

  /** Active chat id for the chat view. */
  activeChatId?: string;

  /**
   * Transient request from the top bar: open the publish picker for a store.
   * The store page consumes it (opens its picker) and clears it; never persisted.
   */
  publishStoreRequest: 'card' | 'plugin' | null;
  requestStorePublish(kind: 'card' | 'plugin' | null): void;

  /**
   * Transient request from the top bar: open the new-connection form on the
   * 聊天 API page. The models section consumes it (opens the form) and clears
   * it; never persisted. Same pattern as publishStoreRequest.
   */
  addModelRequest: boolean;
  requestAddModel(next: boolean): void;

  /**
   * Transient UI state: a sub-page with its own header (e.g. 创建角色) hides
   * the shell top bar so there is only one header. The sub-page sets it and
   * clears it on exit; never persisted.
   */
  hideTopbar: boolean;
  setHideTopbar(next: boolean): void;

  // ------------------------------------------------------------- actions
  boot(): Promise<void>;
  setSettings(patch: Partial<RPAppSettings>): void;

  addCard(card: RPCard): Promise<void>;
  updateCard(id: string, patch: Partial<RPCard> | ((c: RPCard) => RPCard)): Promise<void>;
  removeCard(id: string): Promise<void>;

  saveLorebook(book: RPLorebook): Promise<void>;
  removeLorebook(id: string): Promise<void>;

  saveChat(chat: RPChat): Promise<void>;
  removeChat(id: string): Promise<void>;
  setActiveChat(id?: string): void;

  savePreset(preset: RPCompletionPreset): Promise<void>;
  removePreset(id: string): Promise<void>;
  saveContextTemplate(t: RPContextTemplate): Promise<void>;
  saveInstructTemplate(t: RPInstructTemplate): Promise<void>;
  saveReasoningTemplate(t: RPReasoningTemplate): Promise<void>;

  savePersona(p: RPPersona): Promise<void>;
  removePersona(id: string): Promise<void>;

  /** Replace one chat's memory records (summaries, groups, embeddings). */
  saveMemories(chatId: string, records: MemoryRecord[]): Promise<void>;
  /** Drop a chat's memory when the chat is deleted. */
  clearMemories(chatId: string): Promise<void>;

  /** UI templates. */
  saveUITemplate(tpl: RPUITemplate): Promise<void>;
  removeUITemplate(id: string): Promise<void>;

  /** Replace the whole novel state (bookshelf + active book). */
  saveNovel(novel: NovelState): Promise<void>;

  // ------------------------------------------------------------- branches
  /** Fork a child branch after `fromIndex` (an assistant message). */
  createBranch(chatId: string, fromIndex: number, name?: string): Promise<string | null>;
  switchBranch(chatId: string, branchId: string): Promise<void>;
  renameBranch(chatId: string, branchId: string, name: string): Promise<void>;
  deleteBranch(chatId: string, branchId: string): Promise<void>;

  saveLLMConnection(c: LLMConnection): Promise<void>;
  removeLLMConnection(id: string): Promise<void>;
  saveImageConnection(c: ImageConnection): Promise<void>;
  removeImageConnection(id: string): Promise<void>;

  /** Adopt data imported from a backup / plugin. */
  reloadAll(): Promise<void>;
}

function upsert<T extends { id?: string }>(list: T[], item: T): T[] {
  // Imported presets may lack an id; assigning one on first save keeps the
  // collection addressable without mutating the caller's object shape.
  const withId = (item.id ? item : { ...item, id: `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}` }) as T;
  const idx = list.findIndex((x) => x.id === withId.id);
  if (idx === -1) return [...list, withId];
  const next = [...list];
  next[idx] = withId;
  return next;
}

export const useApp = create<AppState>((set, get) => ({
  cards: [],
  lorebooks: [],
  chats: [],
  presets: [],
  contextTemplates: [],
  instructTemplates: [],
  reasoningTemplates: [],
  personas: [],
  memories: {},
  uiTemplates: [],
  novel: { books: [] },
  llmConnections: [],
  imageConnections: [],
  settings: DEFAULT_SETTINGS,
  ready: false,
  publishStoreRequest: null,
  addModelRequest: false,
  hideTopbar: false,

  boot: async () => {
    try {
      const settings = { ...DEFAULT_SETTINGS, ...settingsStore.get<RPAppSettings>('settings', DEFAULT_SETTINGS) };
      const [cards, lorebooks, chats, presets, contextTemplates, instructTemplates, reasoningTemplates, personas, llmConnections, imageConnections, memories, uiTemplates, novel] =
        await Promise.all([
          idbStorage.get<RPCard[]>(KEY.cards),
          idbStorage.get<RPLorebook[]>(KEY.lorebooks),
          idbStorage.get<RPChat[]>(KEY.chats),
          idbStorage.get<RPCompletionPreset[]>(KEY.presets),
          idbStorage.get<RPContextTemplate[]>(KEY.contextTemplates),
          idbStorage.get<RPInstructTemplate[]>(KEY.instructTemplates),
          idbStorage.get<RPReasoningTemplate[]>(KEY.reasoning),
          idbStorage.get<RPPersona[]>(KEY.personas),
          idbStorage.get<LLMConnection[]>(KEY.llm),
          idbStorage.get<ImageConnection[]>(KEY.image),
          idbStorage.get<Record<string, MemoryRecord[]>>('rpnow:memories'),
          idbStorage.get<RPUITemplate[]>('rpnow:ui-templates'),
          idbStorage.get<NovelState>('rpnow:novel'),
        ]);
      set({
        settings,
        cards: cards ?? [],
        lorebooks: lorebooks ?? [],
        chats: chats ?? [],
        // Restore the conversation the user was last reading. Falls back to
        // nothing when that chat has since been deleted, so the chat page can
        // pick the newest one instead of showing a blank shell.
        activeChatId: (() => {
          const last = settingsStore.get<string>('activeChatId', '');
          return last && (chats ?? []).some((c) => c.id === last) ? last : undefined;
        })(),
        presets: presets ?? [],
        contextTemplates: contextTemplates ?? [],
        instructTemplates: instructTemplates ?? [],
        reasoningTemplates: reasoningTemplates ?? [],
        personas: personas ?? [],
        memories: memories ?? {},
        uiTemplates: uiTemplates ?? [],
        novel: novel ?? { books: [] },
        llmConnections: llmConnections ?? [],
        imageConnections: imageConnections ?? [],
        ready: true,
      });
    } catch (err) {
      set({ ready: true, bootError: err instanceof Error ? err.message : String(err) });
    }
  },

  setSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    settingsStore.set('settings', next);
  },

  addCard: async (card) => {
    const cards = upsert(get().cards, card);
    set({ cards });
    await idbStorage.set(KEY.cards, cards);
  },
  updateCard: async (id, patch) => {
    const cards = get().cards.map((c) =>
      c.id === id ? { ...(typeof patch === 'function' ? patch(c) : { ...c, ...patch }), updatedAt: Date.now() } : c,
    );
    set({ cards });
    await idbStorage.set(KEY.cards, cards);
  },
  removeCard: async (id) => {
    const cards = get().cards.filter((c) => c.id !== id);
    set({ cards });
    await idbStorage.set(KEY.cards, cards);
  },

  saveLorebook: async (book) => {
    const lorebooks = upsert(get().lorebooks, { ...book, updatedAt: Date.now() });
    set({ lorebooks });
    await idbStorage.set(KEY.lorebooks, lorebooks);
  },
  removeLorebook: async (id) => {
    const lorebooks = get().lorebooks.filter((b) => b.id !== id);
    set({ lorebooks });
    await idbStorage.set(KEY.lorebooks, lorebooks);
  },

  saveChat: async (chat) => {
    const chats = upsert(get().chats, { ...chat, updatedAt: Date.now() });
    set({ chats });
    await idbStorage.set(KEY.chats, chats);
  },
  removeChat: async (id) => {
    const chats = get().chats.filter((c) => c.id !== id);
    const stillActive = get().activeChatId === id ? undefined : get().activeChatId;
    set({ chats, activeChatId: stillActive });
    await idbStorage.set(KEY.chats, chats);
    // Keep the persisted selection in step with the in-memory one.
    settingsStore.set('activeChatId', stillActive ?? '');
    await get().clearMemories(id);
  },
  /**
   * Select a conversation. Persisted outside the store (it is a UI preference,
   * not chat data) so reopening the app lands on the same chat.
   */
  setActiveChat: (id) => {
    set({ activeChatId: id });
    try {
      settingsStore.set('activeChatId', id ?? '');
    } catch {
      /* private mode — selection simply is not remembered */
    }
  },

  requestStorePublish: (kind) => {
    set({ publishStoreRequest: kind });
  },

  requestAddModel: (next) => {
    set({ addModelRequest: next });
  },

  setHideTopbar: (next) => {
    set({ hideTopbar: next });
  },

  savePreset: async (preset) => {
    const presets = upsert(get().presets, { ...preset, updatedAt: Date.now() });
    set({ presets });
    await idbStorage.set(KEY.presets, presets);
  },
  removePreset: async (id) => {
    const presets = get().presets.filter((p) => p.id !== id);
    set({ presets });
    await idbStorage.set(KEY.presets, presets);
  },
  saveContextTemplate: async (t) => {
    const contextTemplates = upsert(get().contextTemplates, t);
    set({ contextTemplates });
    await idbStorage.set(KEY.contextTemplates, contextTemplates);
  },
  saveInstructTemplate: async (t) => {
    const instructTemplates = upsert(get().instructTemplates, t);
    set({ instructTemplates });
    await idbStorage.set(KEY.instructTemplates, instructTemplates);
  },
  saveReasoningTemplate: async (t) => {
    const reasoningTemplates = upsert(get().reasoningTemplates, t);
    set({ reasoningTemplates });
    await idbStorage.set(KEY.reasoning, reasoningTemplates);
  },

  savePersona: async (p) => {
    const personas = upsert(get().personas, { ...p, updatedAt: Date.now() });
    set({ personas });
    await idbStorage.set(KEY.personas, personas);
  },
  removePersona: async (id) => {
    const personas = get().personas.filter((p) => p.id !== id);
    set({ personas });
    await idbStorage.set(KEY.personas, personas);
  },

  saveMemories: async (chatId, records) => {
    const memories = { ...get().memories, [chatId]: records };
    set({ memories });
    await idbStorage.set('rpnow:memories', memories);
  },
  clearMemories: async (chatId) => {
    const memories = { ...get().memories };
    delete memories[chatId];
    set({ memories });
    await idbStorage.set('rpnow:memories', memories);
  },

  saveUITemplate: async (tpl) => {
    const uiTemplates = upsert(get().uiTemplates, tpl);
    set({ uiTemplates });
    await idbStorage.set('rpnow:ui-templates', uiTemplates);
  },
  removeUITemplate: async (id) => {
    const uiTemplates = get().uiTemplates.filter((t) => t.id !== id);
    set({ uiTemplates });
    await idbStorage.set('rpnow:ui-templates', uiTemplates);
  },

  saveNovel: async (novel) => {
    set({ novel });
    await idbStorage.set('rpnow:novel', novel);
  },

  createBranch: async (chatId, fromIndex, name) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return null;
    const out = createBranchEngine(chat, fromIndex, name);
    if (!out) return null;
    const chats = get().chats.map((c) => (c.id === chatId ? out.chat : c));
    set({ chats });
    await idbStorage.set(KEY.chats, chats);
    return out.branch.id;
  },
  switchBranch: async (chatId, branchId) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return;
    const next = switchBranchEngine(chat, branchId);
    const chats = get().chats.map((c) => (c.id === chatId ? next : c));
    set({ chats });
    await idbStorage.set(KEY.chats, chats);
  },
  renameBranch: async (chatId, branchId, name) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return;
    const next = renameBranchEngine(chat, branchId, name);
    const chats = get().chats.map((c) => (c.id === chatId ? next : c));
    set({ chats });
    await idbStorage.set(KEY.chats, chats);
  },
  deleteBranch: async (chatId, branchId) => {
    const chat = get().chats.find((c) => c.id === chatId);
    if (!chat) return;
    const next = deleteBranchEngine(chat, branchId);
    const chats = get().chats.map((c) => (c.id === chatId ? next : c));
    set({ chats });
    await idbStorage.set(KEY.chats, chats);
  },

  saveLLMConnection: async (c) => {
    const llmConnections = upsert(get().llmConnections, c);
    set({ llmConnections });
    await idbStorage.set(KEY.llm, llmConnections);
  },
  removeLLMConnection: async (id) => {
    const llmConnections = get().llmConnections.filter((c) => c.id !== id);
    set({ llmConnections });
    await idbStorage.set(KEY.llm, llmConnections);
    // 删的是默认连接时不能留一个指向不存在 id 的 defaultConnectionId，
    // 否则侧边栏/设置页会继续显示“已配置”：顺延到剩余第一个，没有则清空。
    if (get().settings.defaultConnectionId === id) {
      get().setSettings({ defaultConnectionId: llmConnections[0]?.id });
    }
  },
  saveImageConnection: async (c) => {
    const imageConnections = upsert(get().imageConnections, c);
    set({ imageConnections });
    await idbStorage.set(KEY.image, imageConnections);
  },
  removeImageConnection: async (id) => {
    const imageConnections = get().imageConnections.filter((c) => c.id !== id);
    set({ imageConnections });
    await idbStorage.set(KEY.image, imageConnections);
  },

  reloadAll: async () => {
    await get().boot();
  },
}));

/** Convenience selectors. */
export const selectCard = (id?: string) => (s: AppState) => s.cards.find((c) => c.id === id);
export const selectChat = (id?: string) => (s: AppState) => s.chats.find((c) => c.id === id);

/**
 * Dev-only handle for the e2e scripts.
 *
 * Vite resolves `/src/state/store.ts`, `/src/state/store.js` and `@/state/store.js`
 * to distinct module instances, so a test that imports a different specifier than
 * the app would mutate a store the UI never reads. Exposing the live instance
 * keeps every script on the same object.
 */
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __rpnowStore?: typeof useApp }).__rpnowStore = useApp;
}
