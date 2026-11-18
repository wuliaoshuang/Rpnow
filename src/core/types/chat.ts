/**
 * Chat / persona / settings types.
 *
 * A chat binds together the four things that must stay consistent with each
 * other: a character card, a preset, a set of world books, and the message log.
 * Anything that affects prompt assembly but is *not* the card lives here, so
 * "same card, different preset" is a first-class concept.
 */

import type { ActivationSnapshot } from '../lorebook/engine.js';
import type { MemorySettings } from '../memory/types.js';
import type { ToolSettings } from '../tools/types.js';

export interface RPPersona {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  /** Free-form preferences, shown in the `[User Info]` block. */
  preferences?: string;
  /** `second` (default) or `third`, controls the persona presets. */
  person?: 'second' | 'third';
  createdAt: number;
  updatedAt: number;
}

export interface RPChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  /** Greeting swipes for the first message; selected one is `content`. */
  swipes?: string[];
  swipeId?: number;
  /** Excluded from the prompt but shown in the transcript. */
  hidden?: boolean;
  /** Marks the opening greetings so the UI can style them. */
  isGreeting?: boolean;
  createdAt: number;
  /** Model that produced this message. */
  model?: string;
  reasoning?: string;
  /** Token estimate/usage for this turn. */
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    /** Prompt tokens served from the provider's cache. */
    cachedTokens?: number;
    /** Wall-clock time of the request, for the tok/s readout. */
    durationMs?: number;
  };
  /** Generated images attached to this message. */
  images?: string[];
  /** Arbitrary per-message plugin data. */
  meta?: Record<string, unknown>;
  /**
   * Group chats: which character said this. Rendered above the bubble so a
   * multi-character transcript never loses track of who is speaking.
   */
  speaker?: string;
}

/** A story branch: a parallel message history forked from a floor. */
export interface RPBranch {
  id: string;
  name: string;
  /** Parent branch id; `main` has none. */
  parentId: string | null;
  createdAt: number;
  updatedAt: number;
  /** Floor index in the parent branch this fork was cut from. */
  forkFloor: number;
  messages: RPChatMessage[];
}

/** Branch ids are stable strings; `main` is reserved. */
export const MAIN_BRANCH = 'main';

export interface RPChat {
  id: string;
  title: string;
  cardId: string;
  /** Preset ids; `undefined` means "use the global default". */
  presetId?: string;
  /** User world books enabled for this chat. */
  lorebookIds: string[];
  /** Whether to include the card's embedded `character_book`. */
  useCardLorebook: boolean;
  personaId?: string;
  /** LLM connection + model frozen at chat creation (overridable per chat). */
  connectionId?: string;
  model?: string;
  messages: RPChatMessage[];
  /** Persisted sticky/cooldown counters for the lorebook engine. */
  activation?: ActivationSnapshot;
  /** Chat-scoped variables written by `{{setvar}}`. */
  variables: Record<string, number | string>;
  createdAt: number;
  updatedAt: number;
  /** Background image (data URL or remote). */
  background?: string;
  /** Per-chat overrides of generation settings. */
  params?: Record<string, unknown>;
  /** Parallel story branches. The main line lives in `messages`. */
  branches?: RPBranch[];
  /**
   * Main-line messages, kept separately so switching to a child branch does not
   * lose them. Falls back to `messages` for chats created before branching.
   */
  mainMessages?: RPChatMessage[];
  /** Currently viewed branch; `main` means the main line. */
  activeBranchId?: string;
  /**
   * Group chat: every participant's card id, in speaking order. When set,
   * `cardId` still names the "host" card (avatar/background) but the prompt is
   * assembled from all members — see `buildGroupPrompt`.
   */
  groupCardIds?: string[];
  /** Group-only: which member replies next, or `auto` for round-robin. */
  groupSpeaker?: 'auto' | string;
}

export interface RPAppSettings {
  /** UI language. */
  locale: 'zh' | 'en';
  /** Theme plugin id. */
  themeId: string;
  /** Default preset id. */
  defaultPresetId?: string;
  /** Default LLM connection id. */
  defaultConnectionId?: string;
  /** Default persona id. */
  defaultPersonaId?: string;
  /** Active text area is bottom-anchored (chat-like) or free-scrolling. */
  /** Distance from top for the floating nav. */
  /** Lorebook defaults. */
  lorebook: {
    scanDepth: number;
    tokenBudget: number;
    recursiveScanning: boolean;
  };
  /** Memory (summarisation / recall) settings. */
  memory: MemorySettings;
  /** Agent tools (transcript search / web search / random). */
  tools: ToolSettings;
  /** UI templates (HTML 状态栏). */
  uiTemplate: {
    enabled: boolean;
    /** true = the main model writes updates; false = a separate analysis model. */
    mainModelAnalysis: boolean;
    /** Inject the state snapshot into the sub-model prompt. */
    injectContext: boolean;
    /** Analysis model (sub-model mode). */
    model: string;
    /** Recent floors analysed by the sub-model, 4–10. */
    analysisDepth: number;
  };
  /** Inline (in-reply) image generation, RP-Hub style. */
  imageGen: {
    enabled: boolean;
    key: string;
    model: string;
    size: 'vertical' | 'horizontal' | 'square';
    /** Pictures per reply, 2–8. */
    count: number;
    /** Generate automatically after each reply. */
    autoGenerate: boolean;
    /** Style preset; `custom` uses `customArtists`. */
    style: string;
    customArtists: string;
  };
  /** Cloud backup endpoint (optional, self-hosted). */
  backup: {
    serverURL: string;
  };
  /** 本地商店源（默认指向内置 mock 服务，可切换）。 */
  market?: {
    baseURL: string;
    autoUpdate: boolean;
    showNsfw: boolean;
  };
  /**
   * SillyTavern / 酒馆助手 扩展兼容层开关。
   *
   * **默认关闭**：不再投入兼容，安装 ST 扩展会明确提示不支持；相关代码保留在
   * `core/plugins/st-*` 中，仅当这里显式打开时才会被触达（便于将来恢复）。
   */
  stCompat?: {
    enabled?: boolean;
  };
  /** Optional update-check endpoint. */
  update: {
    checkURL: string;
    /** Last announcement id the user has seen. */
    seenAnnouncementId?: number;
  };
  /** Rendering. */
  render: {
    allowExternalMedia: boolean;
    /** Sandbox card-provided HTML in an iframe. */
    sandboxHtml: boolean;
    fontSize: number;
    messageWidth: 'narrow' | 'full';
    /** Use the character's avatar as a blurred ambient background. */
    useCharacterBackground: boolean;
    /** Hide the header/footer chrome for an immersive reading view. */
    immersiveMode: boolean;
  };
  /**
   * Haptic feedback (Android vibration motor).
   *
   * Both switches are independent: a user may want taps to buzz but not every
   * incoming message, or the reverse.
   */
  haptics: {
    /** Buzz on deliberate taps (navigation, send, toggles). */
    enabled: boolean;
    /** Buzz when an AI reply arrives. */
    onMessage: boolean;
  };
  /** Behaviour. */
  chat: {
    /** Prefer card `system_prompt` over the preset's main prompt. */
    preferCharacterPrompt: boolean;
    /** Prefer card `post_history_instructions`. */
    preferCharacterJailbreak: boolean;
    /** Auto-generate the first reply after the greeting. */
    autoGreeting: boolean;
    streamResponses: boolean;
    /** Show the model's thinking block. */
    showReasoning: boolean;
    /** Max chars of chat history sent as prompt. */
    historyBudgetChars: number;
    /**
     * Gemini anti-truncation: submit the body through the `output_reply` tool
     * instead of the normal content channel. Only meaningful for Gemini models.
     */
    preventTruncation: boolean;
    /**
     * Reasoning effort for providers that support it (`none`/`low`/`medium`/
     * `high`/`max`). Passed through as `reasoning_effort`.
     */
    reasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'max' | '';
    /**
     * Max output tokens. `0` means unlimited — the parameter is omitted from
     * the request entirely so the model can run to its natural stop.
     */
    maxTokens: number;
    /**
     * Context window budget in tokens. Values above ~1M effectively disable
     * trimming; the default follows "the model's context, or 1M when unknown".
     */
    contextTokens: number;
    /**
     * Auto-compress the context once usage reaches this share of the window
     * (50–95). The oldest floors fold into a summary floor.
     */
    compressThresholdPct: number;
    /**
     * 聊天建议：AI 回完后给出 3 条可点的接话（用快速模型生成）。默认开；
     * 老存档里没有这个字段时按开算。
     */
    suggestionsEnabled?: boolean;
    /** 快速模型连接；不填则跟随当前对话的连接。 */
    fastConnectionId?: string;
    /** 快速模型；不填则用该连接的默认模型。 */
    fastModel?: string;
  };
  /** Network. */
  network: {
    proxyUrl: string;
    proxyEnabled: boolean;
  };
  /** Plugin enablement map (id → enabled). */
  plugins: Record<string, boolean>;
  /** Plugin config map. */
  pluginConfig: Record<string, Record<string, unknown>>;
}

export const DEFAULT_SETTINGS: RPAppSettings = {
  locale: 'zh',
  themeId: 'rpnow.theme.midnight-rose',
  lorebook: { scanDepth: 4, tokenBudget: 25, recursiveScanning: true },
  memory: {
    mode: 'off',
    summaryModel: '',
    summaryConnectionId: undefined,
    vectorModel: '',
    vectorConnectionId: undefined,
    keepRecentRounds: 20,
    secondaryKeepRounds: 25,
    secondaryGroupSize: 5,
    secondaryMode: 'off',
    recallThreshold: 0.48,
    recallMax: 10,
    citationEnabled: false,
    recallEnabled: true,
  },
  tools: {
    keywordEnabled: false,
    webEnabled: false,
    randomEnabled: false,
    aggressiveness: 'adaptive',
    resultCount: 5,
    tavilyKey: '',
    maxToolCalls: 5,
    maxAutoContinue: 4,
  },
  uiTemplate: {
    enabled: false,
    mainModelAnalysis: true,
    injectContext: false,
    model: '',
    analysisDepth: 4,
  },
  imageGen: {
    enabled: false,
    key: '',
    model: 'nai-diffusion-4-5-full',
    size: 'vertical',
    count: 2,
    autoGenerate: true,
    style: 'vertical',
    customArtists: '',
  },
  backup: {
    serverURL: '',
  },
  update: {
    checkURL: '',
  },
  render: {
    allowExternalMedia: false,
    // Full HTML documents inside cards render in a sandboxed iframe by default —
    // showing raw markup is the classic "imported card looks broken" bug.
    sandboxHtml: true,
    fontSize: 15,
    messageWidth: 'narrow',
    useCharacterBackground: true,
    immersiveMode: false,
  },
  haptics: {
    enabled: true,
    onMessage: true,
  },
  chat: {
    preferCharacterPrompt: true,
    preferCharacterJailbreak: true,
    autoGreeting: false,
    streamResponses: true,
    showReasoning: true,
    historyBudgetChars: 24000,
    preventTruncation: false,
    reasoningEffort: '',
    // 0 = omit max_tokens (provider default / unlimited).
    maxTokens: 0,
    // Follow the model's context window; 1M is a safe stand-in when the real
    // limit is unknown (trimming only bites near that ceiling).
    contextTokens: 1_000_000,
    /** Auto-compress the context at this share of the window (percent). */
    compressThresholdPct: 80,
    /** 聊天建议默认开；快速模型默认跟随当前对话的连接与模型。 */
    suggestionsEnabled: true,
    fastConnectionId: undefined,
    fastModel: '',
  },
  network: { proxyUrl: '', proxyEnabled: false },
  plugins: {},
  pluginConfig: {},
};
