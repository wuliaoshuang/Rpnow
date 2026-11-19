import { describe, expect, it } from 'vitest';
import { activate, entryKey, keyMatches } from './engine.js';
import { WI_LOGIC, WI_POSITION } from '../types/card.js';
import { DEFAULT_LOREBOOK_SETTINGS, emptyLorebook, newEntry, type RPLorebook } from '../types/lorebook.js';
import { entriesToString } from './engine.js';

function book(entries: ReturnType<typeof newEntry>[], id = 'lb1'): RPLorebook {
  const b = emptyLorebook('测试书');
  b.id = id;
  b.entries = entries;
  return b;
}

const msgs = (...texts: string[]) =>
  texts.map((t, i) => ({ role: i % 2 === 0 ? 'user' : 'assistant', content: t }));

describe('keyMatches', () => {
  const base = newEntry();
  it('matches case-insensitively by default', () => {
    expect(keyMatches('Hello DRAGON', 'dragon', base)).toBe(true);
  });
  it('respects caseSensitive', () => {
    expect(keyMatches('Hello DRAGON', 'dragon', { ...base, caseSensitive: true })).toBe(false);
  });
  it('respects matchWholeWords', () => {
    expect(keyMatches('dragons fly', 'dragon', { ...base, matchWholeWords: true })).toBe(false);
    expect(keyMatches('the dragon flies', 'dragon', { ...base, matchWholeWords: true })).toBe(true);
  });
  it('supports regex keys', () => {
    expect(keyMatches('level 42', 'level\\s+\\d+', { ...base, useRegex: true })).toBe(true);
  });
  it('never throws on invalid regex', () => {
    expect(keyMatches('x', '[', { ...base, useRegex: true })).toBe(false);
  });
  it('supports CJK keys', () => {
    expect(keyMatches('他走进酒馆', '酒馆', base)).toBe(true);
  });
});

describe('activate', () => {
  it('activates constant entries without keys', () => {
    const b = book([newEntry({ constant: true, content: 'ALWAYS', keys: [] })]);
    const r = activate({ books: [b], messages: msgs('hi'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated).toHaveLength(1);
    expect(r.activated[0].content).toBe('ALWAYS');
  });

  it('activates on keyword in scan depth', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'DRAGON LORE' })]);
    const r = activate({ books: [b], messages: msgs('hello', 'a dragon appears'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(entriesToString(r.activated)).toBe('DRAGON LORE');
  });

  it('does not activate keys outside scan depth', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'X' })]);
    const r = activate({
      books: [b],
      messages: msgs('dragon', 'a', 'b', 'c', 'd', 'e'),
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS, scanDepth: 2 },
    });
    expect(r.activated).toHaveLength(0);
  });

  it('respects per-entry scanDepth override', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'X', scanDepth: 10 })]);
    const r = activate({
      books: [b],
      messages: msgs('dragon', 'a', 'b', 'c', 'd', 'e'),
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS, scanDepth: 2 },
    });
    expect(r.activated).toHaveLength(1);
  });

  it('honours AND_ANY secondary logic', () => {
    const b = book([
      newEntry({ keys: ['dragon'], secondaryKeys: ['fire'], selective: true, selectiveLogic: WI_LOGIC.AND_ANY, content: 'X' }),
    ]);
    expect(activate({ books: [b], messages: msgs('dragon'), defaults: DEFAULT_LOREBOOK_SETTINGS }).activated).toHaveLength(0);
    expect(activate({ books: [b], messages: msgs('dragon fire'), defaults: DEFAULT_LOREBOOK_SETTINGS }).activated).toHaveLength(1);
  });

  it('honours NOT_ANY secondary logic', () => {
    const b = book([
      newEntry({ keys: ['dragon'], secondaryKeys: ['fire'], selective: true, selectiveLogic: WI_LOGIC.NOT_ANY, content: 'X' }),
    ]);
    expect(activate({ books: [b], messages: msgs('dragon fire'), defaults: DEFAULT_LOREBOOK_SETTINGS }).activated).toHaveLength(0);
    expect(activate({ books: [b], messages: msgs('dragon ice'), defaults: DEFAULT_LOREBOOK_SETTINGS }).activated).toHaveLength(1);
  });

  it('honours AND_ALL secondary logic', () => {
    const b = book([
      newEntry({
        keys: ['dragon'],
        secondaryKeys: ['fire', 'ice'],
        selective: true,
        selectiveLogic: WI_LOGIC.AND_ALL,
        content: 'X',
      }),
    ]);
    expect(activate({ books: [b], messages: msgs('dragon fire'), defaults: DEFAULT_LOREBOOK_SETTINGS }).activated).toHaveLength(0);
    expect(activate({ books: [b], messages: msgs('dragon fire ice'), defaults: DEFAULT_LOREBOOK_SETTINGS }).activated).toHaveLength(1);
  });

  it('recurses into activated content', () => {
    const b = book([
      newEntry({ keys: ['dragon'], content: 'The dragon guards the amulet.' }),
      newEntry({ keys: ['amulet'], content: 'AMULET LORE' }),
    ]);
    const r = activate({ books: [b], messages: msgs('a dragon'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated.map((a) => a.content)).toContain('AMULET LORE');
    const recursive = r.activated.find((a) => a.content === 'AMULET LORE');
    expect(recursive?.recursive).toBe(true);
  });

  it('does not recurse when recursion is disabled', () => {
    const b = book([
      newEntry({ keys: ['dragon'], content: 'The dragon guards the amulet.' }),
      newEntry({ keys: ['amulet'], content: 'AMULET LORE' }),
    ]);
    const r = activate({
      books: [b],
      messages: msgs('a dragon'),
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS, recursiveScanning: false },
    });
    expect(r.activated).toHaveLength(1);
  });

  it('excludeRecursion blocks a candidate from recursion', () => {
    const b = book([
      newEntry({ keys: ['dragon'], content: 'The dragon guards the amulet.' }),
      newEntry({ keys: ['amulet'], content: 'AMULET', excludeRecursion: true }),
    ]);
    const r = activate({ books: [b], messages: msgs('a dragon'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated).toHaveLength(1);
  });

  it('preventRecursion stops the activated entry from recursing', () => {
    const b = book([
      newEntry({ keys: ['dragon'], content: 'The dragon guards the amulet.', preventRecursion: true }),
      newEntry({ keys: ['amulet'], content: 'AMULET' }),
    ]);
    const r = activate({ books: [b], messages: msgs('a dragon'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated).toHaveLength(1);
  });

  it('delayUntilRecursion entries need a recursion pass', () => {
    const b = book([
      newEntry({ keys: ['dragon'], content: 'dragon speaks of the amulet' }),
      newEntry({ keys: ['amulet'], content: 'LATE', delayUntilRecursion: true }),
    ]);
    // Without any triggered entry there is no recursion, so it stays quiet.
    const r2 = activate({ books: [b], messages: msgs('nothing here'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r2.activated).toHaveLength(0);
  });

  it('sorts by position then insertion order', () => {
    const b = book([
      newEntry({ keys: ['x'], content: 'B', position: WI_POSITION.before, order: 50 }),
      newEntry({ keys: ['x'], content: 'A', position: WI_POSITION.before, order: 10 }),
      newEntry({ keys: ['x'], content: 'C', position: WI_POSITION.after, order: 1 }),
    ]);
    const r = activate({ books: [b], messages: msgs('x'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated.map((a) => a.content)).toEqual(['A', 'B', 'C']);
  });

  it('keeps only the highest-weight member of a group', () => {
    const b = book([
      newEntry({ keys: ['x'], content: 'LIGHT', group: 'mood', groupWeight: 10 }),
      newEntry({ keys: ['x'], content: 'HEAVY', group: 'mood', groupWeight: 90 }),
    ]);
    const r = activate({ books: [b], messages: msgs('x'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated.map((a) => a.content)).toEqual(['HEAVY']);
  });

  it('groupOverride keeps every member', () => {
    const b = book([
      newEntry({ keys: ['x'], content: 'A', group: 'g', groupWeight: 10 }),
      newEntry({ keys: ['x'], content: 'B', group: 'g', groupWeight: 10, groupOverride: true }),
    ]);
    const r = activate({ books: [b], messages: msgs('x'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated).toHaveLength(2);
  });

  it('sticky keeps an entry alive after its key leaves the scan window', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'STICKY', sticky: 3 })]);
    const first = activate({ books: [b], messages: msgs('dragon'), defaults: { ...DEFAULT_LOREBOOK_SETTINGS, scanDepth: 1 } });
    expect(first.activated).toHaveLength(1);

    const second = activate({
      books: [b],
      messages: msgs('dragon', 'unrelated'),
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS, scanDepth: 1 },
      snapshot: first.newSnapshot,
    });
    expect(second.activated.map((a) => a.content)).toContain('STICKY');
  });

  it('cooldown suppresses re-triggering', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'CD', cooldown: 3 })]);
    const first = activate({ books: [b], messages: msgs('dragon'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    const second = activate({
      books: [b],
      messages: msgs('dragon'),
      defaults: DEFAULT_LOREBOOK_SETTINGS,
      snapshot: first.newSnapshot,
    });
    // Constant-free entry with cooldown still activates on the next turn only
    // after the cooldown window; within it the entry is suppressed.
    expect(second.activated.find((a) => a.content === 'CD' && !a.recursive)).toBeUndefined();
  });

  it('delay prevents early activation', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'DELAYED', delay: 5 })]);
    const r = activate({ books: [b], messages: msgs('dragon'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated).toHaveLength(0);
  });

  it('probability 100 always fires and probability 0 never does', () => {
    const all = book([newEntry({ keys: ['x'], content: 'ALL', probability: 100, useProbability: true })]);
    const none = book([newEntry({ keys: ['x'], content: 'NONE', probability: 0, useProbability: true })], 'lb2');
    const r = activate({ books: [all, none], messages: msgs('x'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated.map((a) => a.content)).toEqual(['ALL']);
  });

  it('probability is deterministic for the same seed and turn', () => {
    const b = book([newEntry({ keys: ['x'], content: 'P', probability: 50 })]);
    const a = activate({ books: [b], messages: msgs('x'), defaults: DEFAULT_LOREBOOK_SETTINGS, seed: 7 });
    const c = activate({ books: [b], messages: msgs('x'), defaults: DEFAULT_LOREBOOK_SETTINGS, seed: 7 });
    expect(a.activated.length).toBe(c.activated.length);
  });

  it('skips outlet entries', () => {
    const b = book([newEntry({ keys: ['x'], content: 'OUT', position: WI_POSITION.outlet, outletName: 'foo' })]);
    const r = activate({ books: [b], messages: msgs('x'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated).toHaveLength(0);
  });

  it('applies the macro substituter to content', () => {
    const b = book([newEntry({ keys: ['x'], content: 'Hello {{name}}' })]);
    const r = activate({
      books: [b],
      messages: msgs('x'),
      defaults: DEFAULT_LOREBOOK_SETTINGS,
      macros: (t) => t.replace('{{name}}', 'Aria'),
    });
    expect(r.activated[0].content).toBe('Hello Aria');
  });

  it('ignores disabled entries', () => {
    const b = book([newEntry({ keys: ['x'], content: 'OFF', enabled: false })]);
    const r = activate({ books: [b], messages: msgs('x'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.activated).toHaveLength(0);
  });

  it('records diagnostics explaining non-activation', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'X' })]);
    const r = activate({ books: [b], messages: msgs('nothing'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.diagnostics).toHaveLength(1);
    expect(r.diagnostics[0].activated).toBe(false);
    expect(r.diagnostics[0].reason).toContain('未命中');
  });

  it('groups results by position', () => {
    const b = book([
      newEntry({ keys: ['x'], content: 'BEFORE', position: WI_POSITION.before }),
      newEntry({ keys: ['x'], content: 'DEPTH', position: WI_POSITION.atDepth, depth: 2 }),
    ]);
    const r = activate({ books: [b], messages: msgs('x'), defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(r.byPosition.get(WI_POSITION.before)?.map((e) => e.content)).toEqual(['BEFORE']);
    expect(r.byPosition.get(WI_POSITION.atDepth)?.map((e) => e.content)).toEqual(['DEPTH']);
  });

  it('produces stable entry keys', () => {
    expect(entryKey('b', 'e')).toBe('b::e');
  });
});

describe('scanDepth defaults and maxDepth', () => {
  it('defaults the global scan depth to 2 (RP-Hub parity)', () => {
    expect(DEFAULT_LOREBOOK_SETTINGS.scanDepth).toBe(2);
    expect(DEFAULT_LOREBOOK_SETTINGS.maxDepth).toBe(0);
  });

  it('caps an entry scanDepth at maxDepth', () => {
    // Keyword only in the 5th message back: visible at scanDepth 10, hidden
    // once maxDepth 2 caps the entry's own scanDepth.
    const b = book([newEntry({ keys: ['dragon'], content: 'CAPPED', scanDepth: 10 })]);
    const messages = msgs('a dragon appears', 'filler', 'filler', 'filler', 'filler');
    const uncapped = activate({ books: [b], messages, defaults: DEFAULT_LOREBOOK_SETTINGS });
    expect(uncapped.activated).toHaveLength(1);
    const capped = activate({
      books: [b],
      messages,
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS, maxDepth: 2 },
    });
    expect(capped.activated).toHaveLength(0);
  });

  it('caps the global / book scan depth at maxDepth', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'CAPPED' })]);
    const messages = msgs('a dragon appears', 'filler', 'filler', 'filler');
    const wide = activate({
      books: [b],
      messages,
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS, scanDepth: 4 },
    });
    expect(wide.activated).toHaveLength(1);
    const capped = activate({
      books: [b],
      messages,
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS, scanDepth: 4, maxDepth: 2 },
    });
    expect(capped.activated).toHaveLength(0);
  });

  it('maxDepth 0 means no cap', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'FREE', scanDepth: 10 })]);
    const messages = msgs('a dragon appears', 'filler', 'filler', 'filler', 'filler');
    const r = activate({
      books: [b],
      messages,
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS, maxDepth: 0 },
    });
    expect(r.activated).toHaveLength(1);
  });

  it('still fires when the keyword is inside the capped window', () => {
    const b = book([newEntry({ keys: ['dragon'], content: 'NEAR', scanDepth: 10 })]);
    const messages = msgs('filler', 'filler', 'filler', 'a dragon appears');
    const r = activate({
      books: [b],
      messages,
      defaults: { ...DEFAULT_LOREBOOK_SETTINGS, maxDepth: 2 },
    });
    expect(r.activated).toHaveLength(1);
  });
});
