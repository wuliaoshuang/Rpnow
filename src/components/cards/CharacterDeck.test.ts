import { describe, expect, it } from 'vitest';
import { deckVisibleOffsets, wrapIndex } from './deck.js';

describe('wrapIndex', () => {
  it('wraps forward and backward around the deck', () => {
    expect(wrapIndex(5, 5)).toBe(0);
    expect(wrapIndex(5, -1)).toBe(4);
    expect(wrapIndex(5, 7)).toBe(2);
    expect(wrapIndex(1, 3)).toBe(0);
  });

  it('returns 0 for an empty deck', () => {
    expect(wrapIndex(0, 2)).toBe(0);
  });
});

describe('deckVisibleOffsets', () => {
  it('shows a single card alone', () => {
    expect(deckVisibleOffsets(1, 0)).toEqual([0]);
  });

  it('shows the focused card plus the right neighbour for two cards', () => {
    expect(deckVisibleOffsets(2, 0)).toEqual([0, 1]);
  });

  it('shows one card each side for three cards', () => {
    expect(deckVisibleOffsets(3, 0)).toEqual([-1, 0, 1]);
  });

  it('shows up to two cards each side for a full deck', () => {
    expect(deckVisibleOffsets(5, 0)).toEqual([-2, -1, 0, 1, 2]);
    expect(deckVisibleOffsets(8, 0)).toEqual([-2, -1, 0, 1, 2]);
  });

  it('shifts the window while dragging right', () => {
    // Dragging right reveals one more card on the left, like RP-Hub.
    expect(deckVisibleOffsets(5, 0.5)).toEqual([-2, -1, 0, 1, 2]);
    expect(deckVisibleOffsets(4, 0.5)).toEqual([-2, -1, 0, 1]);
  });
});
