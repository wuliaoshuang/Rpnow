/**
 * Character card types.
 *
 * RPNow implements the interop formats used across the AI-roleplay ecosystem:
 *   - TavernAI V1 (flat, no `spec`)
 *   - Character Card V2 (`spec: "chara_card_v2"`, mirrored to top level for V1 compat)
 *   - Character Card V3 (`spec: "chara_card_v3"`, superset of V2)
 *
 * Verified against SillyTavern v1.14 `src/validator/TavernCardValidator.js`,
 * `src/endpoints/characters.js` (`charaFormatData`) and `src/character-card-parser.js`.
 *
 * Design rule: RPNow keeps the *raw* parsed object untouched on
 * {@link RPCard.source} and writes a normalised, lossless view over it, so a
 * round-trip import → edit → export never destroys third-party extension keys.
 */

/** World book attached to a character card as `data.character_book`. */
export interface RPCharacterBook {
  name?: string;
  description?: string;
  /** Must exist for V2 validation: TavernCardValidator requires an object. */
  extensions?: Record<string, unknown>;
  entries: RPCharacterBookEntry[];
  /** Spec fields that SillyTavern does not persist per-card; kept for fidelity. */
  scan_depth?: number;
  token_budget?: number;
  recursive_scanning?: boolean;
}

/**
 * One lorebook entry inside `data.character_book`.
 *
 * Positions are double-tracked in the ecosystem and this is the single most
 * common source of import bugs:
 *   - `position` (top level, string) only carries `"before_char"` / `"after_char"`
 *   - `extensions.position` (number 0-7) carries the *real* insertion point
 * We therefore always read `extensions.position` first and fall back to the
 * string, and we always write both on export.
 */
export interface RPCharacterBookEntry {
  id?: number;
  keys: string[];
  secondary_keys?: string[];
  comment?: string;
  content: string;
  constant?: boolean;
  selective?: boolean;
  insertion_order?: number;
  enabled?: boolean;
  /** `"before_char"` | `"after_char"`; never `"atDepth"` etc. */
  position?: 'before_char' | 'after_char' | string;
  use_regex?: boolean;
  case_sensitive?: boolean | null;
  name?: string;
  priority?: number;
  extensions?: CharacterBookEntryExtensions;
}

/** `extensions` bag of a lorebook entry. Enum values verified from ST source. */
export interface CharacterBookEntryExtensions {
  /** Real insertion position. See {@link WI_POSITION}. */
  position?: number;
  /**
   * RP-Hub position name (`system_top` / `global_note` / `user_top` /
   * `assistant_top`) for entries whose native position has no ST equivalent.
   * Written on export alongside the closest ST number in `position`, so a
   * re-import restores the native position instead of the approximation.
   */
  rp_position?: string;
  /** Depth offset for `atDepth` entries. */
  depth?: number;
  /** Message role for `atDepth` entries: 0 system, 1 user, 2 assistant. */
  role?: number;
  /** Secondary-key logic. See {@link WI_LOGIC}. */
  selectiveLogic?: number;
  probability?: number;
  useProbability?: boolean;
  exclude_recursion?: boolean;
  prevent_recursion?: boolean;
  delay_until_recursion?: boolean;
  scan_depth?: number | null;
  match_whole_words?: boolean | null;
  case_sensitive?: boolean | null;
  use_group_scoring?: boolean;
  group?: string;
  group_override?: boolean;
  group_weight?: number;
  display_index?: number;
  vectorized?: boolean;
  sticky?: number;
  cooldown?: number;
  delay?: number;
  automation_id?: string;
  outlet_name?: string;
  triggers?: string[];
  ignore_budget?: boolean;
  [key: string]: unknown;
}

/**
 * World Info insertion positions, exactly as SillyTavern's
 * `world_info_position` enum in `public/scripts/world-info.js` (0–7),
 * plus RP-Hub's four native positions (8–11) which have no ST equivalent:
 *
 *   - `systemTop` / `globalNote`: RP-Hub's `system_top` / `global_note`,
 *     the very top of the system prompt (before every preset block).
 *   - `userTop` / `assistantTop`: RP-Hub's `user_top` / `assistant_top`,
 *     prepended to the newest user / assistant message.
 *
 * Values 8–11 are RPNow-native. When a card is exported for ST readers,
 * `toCardEntry` writes the closest ST number into `extensions.position`
 * and keeps the RP-Hub name in `extensions.rp_position` (see
 * `core/types/lorebook.ts`), so the round-trip stays lossless.
 */
export const WI_POSITION = {
  before: 0,
  after: 1,
  ANTop: 2,
  ANBottom: 3,
  atDepth: 4,
  EMTop: 5,
  EMBottom: 6,
  outlet: 7,
  /** RP-Hub `system_top`: the very top of the system prompt. */
  systemTop: 8,
  /** RP-Hub `global_note`: system prompt, right after `system_top`. */
  globalNote: 9,
  /** RP-Hub `user_top`: prepended to the newest user message. */
  userTop: 10,
  /** RP-Hub `assistant_top`: prepended to the newest assistant message. */
  assistantTop: 11,
} as const;
export type WIPosition = (typeof WI_POSITION)[keyof typeof WI_POSITION];

/** RP-Hub-native positions (8–11) and their closest ST equivalents. */
export const WI_POSITION_NATIVE_EXPORT: Record<number, { st: number; name: string }> = {
  [WI_POSITION.systemTop]: { st: WI_POSITION.ANTop, name: 'system_top' },
  [WI_POSITION.globalNote]: { st: WI_POSITION.ANBottom, name: 'global_note' },
  [WI_POSITION.userTop]: { st: WI_POSITION.EMTop, name: 'user_top' },
  [WI_POSITION.assistantTop]: { st: WI_POSITION.EMBottom, name: 'assistant_top' },
};

export const WI_POSITION_LABELS: Record<number, string> = {
  [WI_POSITION.before]: '角色定义之前',
  [WI_POSITION.after]: '角色定义之后',
  [WI_POSITION.ANTop]: '作者注释顶部',
  [WI_POSITION.ANBottom]: '作者注释底部',
  [WI_POSITION.atDepth]: '按深度插入',
  [WI_POSITION.EMTop]: '对话示例顶部',
  [WI_POSITION.EMBottom]: '对话示例底部',
  [WI_POSITION.outlet]: '出口（手动宏）',
  [WI_POSITION.systemTop]: '系统最顶层',
  [WI_POSITION.globalNote]: '全局备注',
  [WI_POSITION.userTop]: '用户消息顶部',
  [WI_POSITION.assistantTop]: '助手消息顶部',
};

/**
 * Secondary-key matching logic, exactly as SillyTavern's
 * `world_info_logic` enum: AND_ANY=0, NOT_ALL=1, NOT_ANY=2, AND_ALL=3.
 */
export const WI_LOGIC = {
  AND_ANY: 0,
  NOT_ALL: 1,
  NOT_ANY: 2,
  AND_ALL: 3,
} as const;
export type WILogic = (typeof WI_LOGIC)[keyof typeof WI_LOGIC];

export const WI_LOGIC_LABELS: Record<number, string> = {
  [WI_LOGIC.AND_ANY]: '主键 与 任一副键',
  [WI_LOGIC.NOT_ALL]: '主键 且 并非全部副键',
  [WI_LOGIC.NOT_ANY]: '主键 且 无任一副键',
  [WI_LOGIC.AND_ALL]: '主键 与 全部副键',
};

/** One alternate greeting plus (optionally) its own display index. */
export interface RPDepthPrompt {
  prompt?: string;
  depth?: number;
  role?: 'system' | 'user' | 'assistant';
}

/** Card data payload (the `data` object of a V2/V3 card). */
export interface RPCardData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  first_mes: string;
  mes_example: string;
  creator_notes?: string;
  creator_notes_multilingual?: Record<string, string>;
  system_prompt?: string;
  post_history_instructions?: string;
  alternate_greetings?: string[];
  group_only_greetings?: string[];
  tags?: string[];
  creator?: string;
  character_version?: string;
  extensions?: Record<string, unknown>;
  character_book?: RPCharacterBook;
  assets?: RPCardAsset[];
  creation_date?: number | string;
  modification_date?: number | string;
}

/** V3 `data.assets[]` — CharX-style embedded media references. */
export interface RPCardAsset {
  type: string;
  uri: string;
  name: string;
  ext: string;
  [key: string]: unknown;
}

/**
 * A character in RPNow's store.
 *
 * `data` is the canonical, editable card payload. `source` retains the original
 * imported document so unknown keys survive a re-export, and `sourceFormat`
 * records which importer produced it (useful for fidelity hints in the UI).
 */
export interface RPCard {
  /** Stable local id (not from the card). */
  id: string;
  /** Normalised card payload. */
  data: RPCardData;
  /** Which spec version the card declares. */
  spec: 'v1' | 'v2' | 'v3';
  specVersion: string;
  /** Avatar as a data URL (PNG cards carry art in the same file). */
  avatar?: string;
  /** Original top-level document for lossless re-export. */
  source?: Record<string, unknown>;
  sourceFormat?: CardSourceFormat;
  createdAt: number;
  updatedAt: number;
  /** Starred cards float to the top of the library. */
  favorite?: boolean;
  /** V1-era flat fields that ST keeps for compatibility. */
  legacy?: Record<string, unknown>;
}

export type CardSourceFormat =
  | 'json-v1'
  | 'json-v2'
  | 'json-v3'
  | 'png'
  | 'charx'
  | 'byaf'
  | 'yaml'
  | 'risu'
  | 'unknown';

/** A regular expression script embedded in a card (`extensions.regex_scripts`). */
export interface RPRegexScript {
  id: string;
  scriptName: string;
  findRegex: string;
  replaceString: string;
  trimStrings?: string[];
  /** 1 user input, 2 AI output, 3 slash command, 5 world info, 6 reasoning. */
  placement: number[];
  disabled: boolean;
  markdownOnly: boolean;
  promptOnly: boolean;
  runOnEdit?: boolean;
  substituteRegex?: number;
  minDepth?: number | null;
  maxDepth?: number | null;
}

export const REGEX_PLACEMENT = {
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
} as const;
