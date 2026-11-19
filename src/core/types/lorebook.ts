/**
 * Lorebook (world book) types.
 *
 * A world book is the de-facto interchange format of this ecosystem: SillyTavern
 * "World Info" files, and `data.character_book` inside a character card, share
 * the same entry schema. RPNow models both with one type so a card's embedded
 * book and a standalone imported book go through identical code paths.
 */

import { WI_LOGIC, WI_POSITION, WI_POSITION_NATIVE_EXPORT, type CharacterBookEntryExtensions, type RPCharacterBookEntry } from './card.js';

export type RPLorebook = {
  id: string;
  name: string;
  description?: string;
  /** Book-level knobs. ST stores these globally, but V3 allows per-book values. */
  scanDepth?: number | null;
  /** Token share of context reserved for lore, in percent. */
  tokenBudget?: number | null;
  recursiveScanning?: boolean;
  entries: RPLorebookEntry[];
  /** Where the book came from, for UI provenance. */
  source?: 'user' | 'character' | 'imported' | 'plugin';
  createdAt: number;
  updatedAt: number;
  /** Entry id of the char/lorebook binding, when this is a card-embedded book. */
  cardId?: string;
};

export type RPLorebookEntry = {
  id: string;
  /** Human-readable label; ST's `comment` field. */
  comment: string;
  keys: string[];
  secondaryKeys: string[];
  content: string;
  enabled: boolean;
  /** Always-on regardless of keys. */
  constant: boolean;
  /** Require a secondary key match before activating. */
  selective: boolean;
  /** See {@link WI_LOGIC}. */
  selectiveLogic: number;
  /** Real insertion point; see {@link WI_POSITION}. */
  position: number;
  /** Depth from the end of history for `atDepth` entries. */
  depth: number;
  /** Role for `atDepth` entries: 0 system, 1 user, 2 assistant. */
  role: number;
  order: number;
  probability: number;
  useProbability: boolean;
  caseSensitive: boolean;
  matchWholeWords: boolean;
  useRegex: boolean;
  group: string;
  groupWeight: number;
  groupOverride: boolean;
  excludeRecursion: boolean;
  preventRecursion: boolean;
  delayUntilRecursion: boolean;
  /** Overrides the book's scan depth for this entry. */
  scanDepth: number | null;
  /** Sticky: stays active for N turns after a trigger. */
  sticky: number;
  /** Cooldown: cannot re-trigger for N turns. */
  cooldown: number;
  /** Delay: cannot trigger before N turns have elapsed. */
  delay: number;
  outletName: string;
  /** Set when the entry is a `{{outlet::Name}}` target rather than a keyed entry. */
  ignoreBudget: boolean;
  /** Original key order index, for stable display. */
  displayIndex: number;
  /** Untouched extras so re-export keeps third-party fields. */
  extra?: Record<string, unknown>;
  /** Optional automation/script hook id. */
  automationId?: string;
  triggers?: string[];
  vectorized?: boolean;
  /** Per-session activation bookkeeping is kept out of the persisted entry. */
};

export interface LorebookDefaults {
  scanDepth: number;
  tokenBudget: number;
  recursiveScanning: boolean;
  /**
   * Entry scan-depth cap (RP-Hub `maxDepth`, default 0 = no cap). When > 0,
   * an entry's effective scan depth is `min(entry.scanDepth ?? global, maxDepth)`.
   */
  maxDepth: number;
}

export const DEFAULT_LOREBOOK_SETTINGS: LorebookDefaults = {
  scanDepth: 2,
  tokenBudget: 25,
  recursiveScanning: true,
  maxDepth: 0,
};

/** Default values for a freshly created entry. */
export function newEntry(partial: Partial<RPLorebookEntry> = {}): RPLorebookEntry {
  return {
    id: partial.id ?? `e_${Math.random().toString(36).slice(2, 10)}`,
    comment: '',
    keys: [],
    secondaryKeys: [],
    content: '',
    enabled: true,
    constant: false,
    selective: false,
    selectiveLogic: WI_LOGIC.AND_ANY,
    position: WI_POSITION.before,
    depth: 4,
    role: 0,
    order: 100,
    probability: 100,
    useProbability: true,
    caseSensitive: false,
    matchWholeWords: false,
    useRegex: false,
    group: '',
    groupWeight: 100,
    groupOverride: false,
    excludeRecursion: false,
    preventRecursion: false,
    delayUntilRecursion: false,
    scanDepth: null,
    sticky: 0,
    cooldown: 0,
    delay: 0,
    outletName: '',
    ignoreBudget: false,
    displayIndex: 0,
    ...partial,
  };
}

/**
 * Convert a card's `character_book` entry into the RPNow entry shape.
 *
 * The position double-track is resolved here in one place: `extensions.position`
 * (numeric) is authoritative and the top-level string is only a fallback.
 */
/**
 * Position names used by RP-Hub / other tools, resolved onto RPNow's
 * position enum.
 *
 * RP-Hub's seven positions are native here: `system_top` (8),
 * `global_note` (9), `user_top` (10) and `assistant_top` (11) are real enum
 * values with their own builder semantics — they are NOT approximated by the
 * ST slots any more. ST-only aliases (`an_top`, `em_top`, …) still map to
 * their ST positions, and RP-Hub's own aliases follow RP-Hub's normaliser
 * (`an_top` / `author_note` / `an_bottom` → `global_note`).
 */
export const POSITION_ALIASES: Record<string, number> = {
  system_top: WI_POSITION.systemTop,
  an_top: WI_POSITION.globalNote,
  author_note: WI_POSITION.globalNote,
  global_note: WI_POSITION.globalNote,
  an_bottom: WI_POSITION.globalNote,
  before_char: WI_POSITION.before,
  before_character: WI_POSITION.before,
  after_char: WI_POSITION.after,
  after_character: WI_POSITION.after,
  at_depth: WI_POSITION.atDepth,
  emotioncheck: WI_POSITION.atDepth,
  user_top: WI_POSITION.userTop,
  em_top: WI_POSITION.EMTop,
  assistant_top: WI_POSITION.assistantTop,
  em_bottom: WI_POSITION.EMBottom,
};

/** Resolve any accepted position spelling to a numeric position. */
export function resolvePosition(value: unknown): number | undefined {
  if (typeof value === 'number' && value >= 0 && value <= 11) return Math.round(value);
  if (typeof value === 'string') {
    const key = value.trim().toLowerCase();
    if (key in POSITION_ALIASES) return POSITION_ALIASES[key];
    const n = Number(key);
    if (Number.isFinite(n) && n >= 0 && n <= 11) return Math.round(n);
  }
  return undefined;
}

export function fromCardEntry(raw: RPCharacterBookEntry, index: number): RPLorebookEntry {
  const ext: CharacterBookEntryExtensions = raw.extensions ?? {};
  // `rp_position` (written by toCardEntry for native positions) wins over the
  // numeric ST slot, so an export → import round-trip restores the native
  // position instead of its ST approximation.
  const nativePos = resolvePosition(ext.rp_position);
  const numericPos = nativePos ?? resolvePosition(ext.position);
  const fallback = resolvePosition(raw.position) ?? WI_POSITION.before;
  return newEntry({
    id: String(raw.id ?? `e_${index}`),
    comment: raw.comment ?? raw.name ?? '',
    keys: raw.keys ?? [],
    secondaryKeys: raw.secondary_keys ?? [],
    content: raw.content ?? '',
    enabled: raw.enabled ?? true,
    constant: raw.constant ?? false,
    selective: raw.selective ?? false,
    selectiveLogic: typeof ext.selectiveLogic === 'number' ? ext.selectiveLogic : WI_LOGIC.AND_ANY,
    position: numericPos ?? fallback,
    depth: typeof ext.depth === 'number' ? ext.depth : 4,
    role: typeof ext.role === 'number' ? ext.role : 0,
    order: raw.insertion_order ?? 100,
    probability: typeof ext.probability === 'number' ? ext.probability : 100,
    useProbability: ext.useProbability ?? true,
    caseSensitive: Boolean(raw.case_sensitive ?? ext.case_sensitive ?? false),
    matchWholeWords: Boolean(ext.match_whole_words ?? false),
    useRegex: Boolean(raw.use_regex ?? false),
    group: (ext.group as string) ?? '',
    groupWeight: typeof ext.group_weight === 'number' ? ext.group_weight : 100,
    groupOverride: Boolean(ext.group_override ?? false),
    excludeRecursion: Boolean(ext.exclude_recursion ?? false),
    preventRecursion: Boolean(ext.prevent_recursion ?? false),
    delayUntilRecursion: Boolean(ext.delay_until_recursion ?? false),
    scanDepth: typeof ext.scan_depth === 'number' ? ext.scan_depth : null,
    sticky: typeof ext.sticky === 'number' ? ext.sticky : 0,
    cooldown: typeof ext.cooldown === 'number' ? ext.cooldown : 0,
    delay: typeof ext.delay === 'number' ? ext.delay : 0,
    outletName: (ext.outlet_name as string) ?? '',
    ignoreBudget: Boolean(ext.ignore_budget ?? false),
    displayIndex: typeof ext.display_index === 'number' ? ext.display_index : index,
    automationId: (ext.automation_id as string) ?? '',
    triggers: Array.isArray(ext.triggers) ? (ext.triggers as string[]) : [],
    vectorized: Boolean(ext.vectorized ?? false),
    extra: Object.fromEntries(
      Object.entries(ext).filter(
        ([k]) =>
          ![
            'position',
            'rp_position',
            'depth',
            'role',
            'selectiveLogic',
            'probability',
            'useProbability',
            'group',
            'group_weight',
            'group_override',
            'exclude_recursion',
            'prevent_recursion',
            'delay_until_recursion',
            'scan_depth',
            'match_whole_words',
            'case_sensitive',
            'sticky',
            'cooldown',
            'delay',
            'outlet_name',
            'ignore_budget',
            'display_index',
            'automation_id',
            'triggers',
            'vectorized',
          ].includes(k),
      ),
    ),
  });
}

/**
 * Convert an RPNow entry back to a card `character_book` entry.
 *
 * Writes BOTH position tracks, because ST's importer trusts the numeric one
 * while other tools read the string, and an inconsistent pair is the classic
 * "my lorebook inserts in the wrong place" bug.
 */
export function toCardEntry(entry: RPLorebookEntry, index: number): RPCharacterBookEntry {
  const atDepth = entry.position === WI_POSITION.atDepth;
  // Native RP-Hub positions (8–11) have no ST equivalent: export the closest
  // ST number so ST readers still place the entry approximately, and keep the
  // RP-Hub name in `rp_position` (plus the top-level string) so RPNow and
  // RP-Hub readers restore the exact position on re-import.
  const nativeExport = WI_POSITION_NATIVE_EXPORT[entry.position];
  return {
    id: index,
    keys: entry.keys,
    secondary_keys: entry.secondaryKeys,
    comment: entry.comment,
    content: entry.content,
    constant: entry.constant,
    selective: entry.selective,
    insertion_order: entry.order,
    enabled: entry.enabled,
    position: nativeExport
      ? nativeExport.name
      : entry.position === WI_POSITION.after
        ? 'after_char'
        : 'before_char',
    use_regex: entry.useRegex,
    case_sensitive: entry.caseSensitive,
    extensions: {
      position: nativeExport ? nativeExport.st : entry.position,
      ...(nativeExport ? { rp_position: nativeExport.name } : {}),
      // A few readers only honour `depth` when position is atDepth; keep the
      // value meaningful either way.
      depth: atDepth ? entry.depth : entry.depth,
      role: entry.role,
      selectiveLogic: entry.selectiveLogic,
      probability: entry.probability,
      useProbability: entry.useProbability,
      group: entry.group,
      group_weight: entry.groupWeight,
      group_override: entry.groupOverride,
      exclude_recursion: entry.excludeRecursion,
      prevent_recursion: entry.preventRecursion,
      delay_until_recursion: entry.delayUntilRecursion,
      scan_depth: entry.scanDepth,
      match_whole_words: entry.matchWholeWords,
      case_sensitive: entry.caseSensitive,
      use_group_scoring: false,
      display_index: entry.displayIndex || index,
      vectorized: entry.vectorized ?? false,
      sticky: entry.sticky,
      cooldown: entry.cooldown,
      delay: entry.delay,
      outlet_name: entry.outletName,
      ignore_budget: entry.ignoreBudget,
      automation_id: entry.automationId ?? '',
      triggers: entry.triggers ?? [],
      ...(entry.extra ?? {}),
    },
  };
}

export function emptyLorebook(name = '新世界书'): RPLorebook {
  const now = Date.now();
  return {
    id: `lb_${Math.random().toString(36).slice(2, 10)}`,
    name,
    entries: [],
    scanDepth: null,
    tokenBudget: null,
    recursiveScanning: true,
    source: 'user',
    createdAt: now,
    updatedAt: now,
  };
}
