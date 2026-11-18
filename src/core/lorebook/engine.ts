/**
 * World book activation engine.
 *
 * This is the piece every app gets subtly wrong, so the semantics here are
 * spelled out and unit-tested:
 *
 *  1. **Scan**: the last N messages (N = scanDepth) plus optional "match any"
 *     card fields are searched for entry keys. `constant` entries bypass keys.
 *  2. **Secondary keys**: when `selective` is on, `selectiveLogic` decides
 *     whether the secondary match is required.
 *  3. **Probability**: `probability < 100` makes activation stochastic.
 *  4. **Recursion**: an activated entry's *content* can itself mention keys of
 *     other entries. Those activate too, unless the *activated* entry set
 *     `preventRecursion` or the *candidate* set `excludeRecursion`.
 *     `delayUntilRecursion` entries only appear on recursion passes.
 *  5. **Groups**: entries sharing a `group` are mutually exclusive — only the
 *     highest `groupWeight` (or a deterministic pick) survives, unless an entry
 *     has `groupOverride`.
 *  6. **Sticky / cooldown / delay** are turn-based counters persisted per chat.
 *
 * The engine is pure: it takes a snapshot (activation state) and returns both
 * the ordered insertions and the next snapshot, so chat persistence owns state.
 */

import { WI_LOGIC, WI_POSITION } from '../types/card.js';
import type { RPLorebook, RPLorebookEntry, LorebookDefaults } from '../types/lorebook.js';

/** Per-chat, per-entry counters that must survive across turns. */
export interface EntryState {
  /** Turn index of the last time the entry activated. */
  lastTriggered?: number;
  /** Turn index until which the entry is still considered live (sticky). */
  stickyUntil?: number;
  /** Turn index before which the entry cannot trigger (cooldown/delay). */
  blockedUntil?: number;
  /** Set while a sticky entry is inside its sticky window. */
  stickyActive?: boolean;
}

export interface ActivationSnapshot {
  /** entryKey (`bookId::entryId`) → state */
  entries: Record<string, EntryState>;
  /** Turn counter the snapshot was written at. */
  turn: number;
}

export interface ActivationInput {
  books: RPLorebook[];
  /** Chat messages, oldest → newest, with text used for scanning. */
  messages: Array<{ role: string; content: string }>;
  /** Global defaults, overridable per book. */
  defaults: LorebookDefaults;
  /** Extra text always scanned, e.g. the character description for `match*` flags. */
  cardFields?: {
    description?: string;
    personality?: string;
    scenario?: string;
    creatorNotes?: string;
    depthPrompt?: string;
  };
  /** Previous per-chat state; omit for a fresh chat. */
  snapshot?: ActivationSnapshot;
  /** Deterministic seed so the same turn re-activates the same entries. */
  seed?: number;
  /** Chat-scoped variables for macro substitution before matching. */
  macros?: (text: string) => string;
}

export interface ActivatedEntry {
  bookId: string;
  bookName: string;
  entry: RPLorebookEntry;
  /** The final, macro-substituted content. */
  content: string;
  /** Whether recursion (not the initial scan) activated it. */
  recursive: boolean;
}

export interface ActivationResult {
  /** Entries in insertion order (sorted by position then order). */
  activated: ActivatedEntry[];
  /** Grouped by insertion position for the prompt builder. */
  byPosition: Map<number, ActivatedEntry[]>;
  /** Per-position token-ish accounting (characters; the builder re-tokenizes). */
  newSnapshot: ActivationSnapshot;
  /** Diagnostics for the "why did this not fire" UI. */
  diagnostics: ActivationTrace[];
}

export interface ActivationTrace {
  key: string;
  comment: string;
  bookName: string;
  activated: boolean;
  reason: string;
  /** Which key matched, if any. */
  matchedKey?: string;
}

export const entryKey = (bookId: string, entryId: string) => `${bookId}::${entryId}`;

/** Deterministic 32-bit hash, used as a stand-in for random() in tests. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compile a lorebook regex key.
 *
 * RP-Hub (and SillyTavern) accept the `/pattern/flags` literal form. The flags
 * are normalised to a canonical set: `i` is always on, `g` is dropped (the test
 * is a boolean), and `u` is added automatically for `\p{…}` property escapes
 * because they are a syntax error without it.
 */
export function compileLorebookRegex(key: string, caseSensitive = false): RegExp | null {
  let pattern = key;
  let flags = caseSensitive ? '' : 'i';

  const literal = /^\/(.*)\/([a-z]*)$/.exec(key.trim());
  if (literal) {
    pattern = literal[1];
    const raw = literal[2] ?? '';
    const wanted = new Set(raw.split(''));
    wanted.delete('g');
    if (caseSensitive) wanted.delete('i');
    else wanted.add('i');
    if (pattern.includes('\\p{')) wanted.add('u');
    flags = [...wanted].join('');
  } else if (!caseSensitive) {
    flags = 'i';
  }

  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Test whether `text` contains `key` under `entry`'s matching rules.
 *
 * `useRegex` keys are treated as regular expressions (optionally in
 * `/pattern/flags` form); otherwise the key is escaped and (optionally)
 * word-bounded. `caseSensitive` defaults to off, matching SillyTavern's
 * behaviour for imported entries.
 */
export function keyMatches(text: string, key: string, entry: RPLorebookEntry): boolean {
  if (!key) return false;
  if (entry.useRegex) {
    const re = compileLorebookRegex(key, entry.caseSensitive);
    return re ? re.test(text) : false;
  }
  if (entry.caseSensitive) {
    if (entry.matchWholeWords) {
      return new RegExp(`(^|\\W)${escapeRegExp(key)}(\\W|$)`).test(text);
    }
    return text.includes(key);
  }
  const hay = text.toLowerCase();
  const needle = key.toLowerCase();
  if (entry.matchWholeWords) {
    return new RegExp(`(^|\\W)${escapeRegExp(needle)}(\\W|$)`, 'i').test(hay);
  }
  return hay.includes(needle);
}

/** Build the scan buffer: the last `depth` messages, newest first for weighting. */
function buildScanText(
  messages: Array<{ role: string; content: string }>,
  depth: number,
  entry: RPLorebookEntry,
  cardFields?: ActivationInput['cardFields'],
): string {
  const effectiveDepth = entry.scanDepth ?? depth;
  if (effectiveDepth <= 0) return '';
  const slice = messages.slice(-effectiveDepth);
  const parts = slice.map((m) => m.content);
  // Entries may opt into matching against character definition fields.
  if (cardFields) {
    if (entry.extra?.match_character_description && cardFields.description) {
      parts.push(cardFields.description);
    }
    if (entry.extra?.match_character_personality && cardFields.personality) {
      parts.push(cardFields.personality);
    }
    if (entry.extra?.match_scenario && cardFields.scenario) parts.push(cardFields.scenario);
    if (entry.extra?.match_creator_notes && cardFields.creatorNotes) {
      parts.push(cardFields.creatorNotes);
    }
    if (entry.extra?.match_character_depth_prompt && cardFields.depthPrompt) {
      parts.push(cardFields.depthPrompt);
    }
  }
  return parts.join('\n');
}

function secondarySatisfied(text: string, entry: RPLorebookEntry): boolean {
  if (!entry.selective || !entry.secondaryKeys.length) return true;
  const matched = entry.secondaryKeys.filter((k) => keyMatches(text, k, entry)).length;
  switch (entry.selectiveLogic) {
    case WI_LOGIC.AND_ANY:
      return matched >= 1;
    case WI_LOGIC.NOT_ALL:
      return matched < entry.secondaryKeys.length;
    case WI_LOGIC.NOT_ANY:
      return matched === 0;
    case WI_LOGIC.AND_ALL:
      return matched === entry.secondaryKeys.length;
    default:
      return matched >= 1;
  }
}

/**
 * Run activation for one turn.
 *
 * Pure with respect to its inputs except for the RNG, which is seeded from
 * `seed + turn` so repeated renders of the same turn are stable.
 */
export function activate(input: ActivationInput): ActivationResult {
  const { books, messages, defaults, snapshot } = input;
  const turn = (snapshot?.turn ?? -1) + 1;
  const prev = snapshot?.entries ?? {};
  const next: Record<string, EntryState> = { ...prev };
  const activated: ActivatedEntry[] = [];
  const traces: ActivationTrace[] = [];

  const substitute = input.macros ?? ((t: string) => t);
  const rand = (key: string) => (hashString(`${input.seed ?? 0}:${turn}:${key}`) % 1000) / 1000;

  // Pass 0 = initial scan; later passes = recursion.
  const activatedKeys = new Map<string, ActivatedEntry>();
  // Entries that activated with `preventRecursion` may still appear in the
  // recursion buffer (their own content stays visible), but nothing they
  // contain may trigger further entries. That reads more predictably than
  // stripping their text, which authors use as scene glue.
  let globalPreventRecursion = false;


  for (let pass = 0; pass < 6; pass++) {
    const isRecursion = pass > 0;
    if (isRecursion && !defaults.recursiveScanning) break;

    // Recursion scans the content activated so far. Because an entry activated
    // early in this very pass may unlock another later in the same pass, we
    // rebuild the buffer before each entry: within-pass chaining is the rule
    // authors expect ("entry A reveals B reveals C").
    const buildRecursionText = () =>
      [...activatedKeys.values()].map((a) => a.content).join('\n');

    let passProgress = false;

    for (const book of books) {
      const bookDepth = book.scanDepth ?? defaults.scanDepth;
      const recursive = book.recursiveScanning ?? defaults.recursiveScanning;

      for (const entry of book.entries) {
        if (!entry.enabled) continue;
        const key = entryKey(book.id, entry.id);
        const state = prev[key] ?? {};
        const already = activatedKeys.has(key);

        // Outlet entries are injected via macro only.
        if (entry.position === WI_POSITION.outlet) {
          continue;
        }

        // Delay: entry cannot trigger before chat reaches N turns.
        if (!already && entry.delay > 0 && turn < entry.delay) {
          traces.push({
            key,
            comment: entry.comment,
            bookName: book.name,
            activated: false,
            reason: `延迟 ${entry.delay} 条消息后才会激活`,
          });
          continue;
        }

        // Cooldown: recently triggered → skip.
        if (!already && state.blockedUntil !== undefined && turn < state.blockedUntil) {
          traces.push({
            key,
            comment: entry.comment,
            bookName: book.name,
            activated: false,
            reason: `冷却中（到第 ${state.blockedUntil} 楼）`,
          });
          continue;
        }

        // Sticky: keep the entry alive through its window.
        const stickyLive =
          entry.sticky > 0 && state.stickyUntil !== undefined && turn <= state.stickyUntil;

        let matched = false;
        let reason = '';
        let matchedKey: string | undefined;

        if (entry.constant) {
          matched = true;
          reason = '常驻条目';
        } else if (stickyLive) {
          matched = true;
          reason = `粘性维持（到第 ${state.stickyUntil} 楼）`;
        } else if (entry.keys.length === 0) {
          matched = false;
          reason = '没有关键词';
        } else if (isRecursion) {
          if (entry.delayUntilRecursion || !already) {
            if (!recursive) {
              matched = false;
              reason = '该书禁用了递归扫描';
            } else {
              const text = buildRecursionText();
              // Allow a `preventRecursion` entry to be read by nothing more.
              if (!globalPreventRecursion) {
                const hit = entry.keys.find((k) => keyMatches(text, k, entry));
                if (hit) {
                  if (entry.excludeRecursion) {
                    matched = false;
                    reason = '该条目禁止被递归触发';
                  } else {
                    matched = true;
                    matchedKey = hit;
                    reason = `递归触发（关键词「${hit}」）`;
                  }
                }
              }
            }
          }
          if (!matched && !reason) continue;
        } else {
          const scanEntry: RPLorebookEntry = { ...entry };
          const text = buildScanText(messages, bookDepth, scanEntry, input.cardFields);
          const hit = entry.keys.find((k) => keyMatches(text, k, entry));
          if (hit) {
            if (!secondarySatisfied(text, entry)) {
              matched = false;
              reason = `主键「${hit}」命中，但副键条件不满足`;
            } else if (entry.useProbability && entry.probability < 100) {
              const roll = rand(key) * 100;
              if (roll <= entry.probability) {
                matched = true;
                matchedKey = hit;
                reason = `关键词「${hit}」命中（概率 ${entry.probability}% 通过）`;
              } else {
                matched = false;
                reason = `关键词「${hit}」命中，但概率 ${entry.probability}% 未通过`;
              }
            } else {
              matched = true;
              matchedKey = hit;
              reason = `关键词「${hit}」命中`;
            }
          } else {
            matched = false;
            reason = `未命中任何关键词（扫描最近 ${entry.scanDepth ?? bookDepth} 条消息）`;
          }
        }

        if (!matched) {
          if (!already && !isRecursion) {
            traces.push({ key, comment: entry.comment, bookName: book.name, activated: false, reason });
          }
          continue;
        }
        if (already) continue;

        // Commit activation.
        const content = substitute(entry.content);
        const act: ActivatedEntry = {
          bookId: book.id,
          bookName: book.name,
          entry,
          content,
          recursive: isRecursion,
        };
        activated.push(act);
        activatedKeys.set(key, act);
        passProgress = true;

        if (entry.preventRecursion) globalPreventRecursion = true;

        const stateNext: EntryState = {
          ...state,
          lastTriggered: turn,
        };
        if (entry.sticky > 0) stateNext.stickyUntil = turn + entry.sticky;
        const block = Math.max(entry.cooldown, entry.delay);
        if (block > 0) stateNext.blockedUntil = turn + block;
        next[key] = stateNext;

        traces.push({
          key,
          comment: entry.comment,
          bookName: book.name,
          activated: true,
          matchedKey,
          reason: isRecursion ? `递归激活：${reason}` : reason,
        });
      }
    }

    if (!passProgress) break;
  }

  // ---------------------------------------------------------------- groups
  const grouped = new Map<string, ActivatedEntry[]>();
  for (const a of activated) {
    if (!a.entry.group) continue;
    const gk = `${a.bookId}::${a.entry.group}`;
    const list = grouped.get(gk) ?? [];
    list.push(a);
    grouped.set(gk, list);
  }
  const suppressed = new Set<string>();
  for (const [, list] of grouped) {
    if (list.length <= 1) continue;
    if (list.some((x) => x.entry.groupOverride)) continue;
    const weightSum = list.reduce((s, x) => s + Math.max(1, x.entry.groupWeight), 0);
    let roll = rand(`group:${list[0].entry.group}`) * weightSum;
    let chosen = list[list.length - 1];
    for (const item of list) {
      roll -= Math.max(1, item.entry.groupWeight);
      if (roll <= 0) {
        chosen = item;
        break;
      }
    }
    for (const item of list) {
      if (item !== chosen) suppressed.add(entryKey(item.bookId, item.entry.id));
    }
  }

  const finalActivated = activated.filter((a) => !suppressed.has(entryKey(a.bookId, a.entry.id)));

  // ---------------------------------------------------------- order & group
  const byPosition = new Map<number, ActivatedEntry[]>();
  const sorted = [...finalActivated].sort((a, b) => {
    if (a.entry.position !== b.entry.position) return a.entry.position - b.entry.position;
    if (a.entry.order !== b.entry.order) return a.entry.order - b.entry.order;
    return a.entry.displayIndex - b.entry.displayIndex;
  });
  for (const a of sorted) {
    const list = byPosition.get(a.entry.position) ?? [];
    list.push(a);
    byPosition.set(a.entry.position, list);
  }

  return {
    activated: sorted,
    byPosition,
    newSnapshot: { entries: next, turn },
    diagnostics: traces,
  };
}

/** Reduce a book's activated entries into the string injected at a position. */
export function entriesToString(entries: ActivatedEntry[], separator = '\n'): string {
  return entries
    .map((e) => e.content.trim())
    .filter(Boolean)
    .join(separator);
}
