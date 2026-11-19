/**
 * Pure deck math for the character-deck carousel (CharacterDeck.tsx).
 * Kept free of component imports so it can be unit-tested under vitest,
 * whose config does not resolve the `@/` alias.
 */

/** Wrap an index into [0, count) — the deck cycles endlessly. */
export function wrapIndex(count: number, index: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/**
 * Which offsets around the focused card are visible. Mirrors RP-Hub:
 * up to two cards each side, fewer when the deck is short (a 2-card deck
 * only shows the focused card plus the one on the right).
 */
export function deckVisibleOffsets(count: number, dragOffset: number): number[] {
  if (count <= 1) return [0];
  const leftCount = Math.min(2, Math.floor((count - (dragOffset > 0 ? 0 : 1)) / 2));
  const rightCount = Math.min(2, count - leftCount - 1);
  const out: number[] = [];
  for (let o = -leftCount; o <= rightCount; o++) out.push(o === 0 ? 0 : o);
  return out;
}
