import { describe, expect, it } from 'vitest';
import { WI_POSITION } from './card.js';
import { DEFAULT_SETTINGS } from './chat.js';
import {
  DEFAULT_LOREBOOK_SETTINGS,
  fromCardEntry,
  newEntry,
  resolvePosition,
  toCardEntry,
} from './lorebook.js';

describe('resolvePosition — RP-Hub native positions', () => {
  it('resolves the four RP-Hub positions to native enum values', () => {
    expect(resolvePosition('system_top')).toBe(WI_POSITION.systemTop);
    expect(resolvePosition('global_note')).toBe(WI_POSITION.globalNote);
    expect(resolvePosition('user_top')).toBe(WI_POSITION.userTop);
    expect(resolvePosition('assistant_top')).toBe(WI_POSITION.assistantTop);
    expect(WI_POSITION.systemTop).toBe(8);
    expect(WI_POSITION.globalNote).toBe(9);
    expect(WI_POSITION.userTop).toBe(10);
    expect(WI_POSITION.assistantTop).toBe(11);
  });

  it('keeps SillyTavern positions and numbers unchanged', () => {
    expect(resolvePosition('before_char')).toBe(WI_POSITION.before);
    expect(resolvePosition('after_char')).toBe(WI_POSITION.after);
    expect(resolvePosition('at_depth')).toBe(WI_POSITION.atDepth);
    expect(resolvePosition('em_top')).toBe(WI_POSITION.EMTop);
    expect(resolvePosition('em_bottom')).toBe(WI_POSITION.EMBottom);
    expect(resolvePosition(2)).toBe(WI_POSITION.ANTop);
    expect(resolvePosition(7)).toBe(WI_POSITION.outlet);
    expect(resolvePosition(10)).toBe(WI_POSITION.userTop);
  });

  it('maps RP-Hub aliases onto global_note', () => {
    expect(resolvePosition('an_top')).toBe(WI_POSITION.globalNote);
    expect(resolvePosition('author_note')).toBe(WI_POSITION.globalNote);
    expect(resolvePosition('an_bottom')).toBe(WI_POSITION.globalNote);
  });

  it('returns undefined for unknown values', () => {
    expect(resolvePosition('nowhere')).toBeUndefined();
    expect(resolvePosition(99)).toBeUndefined();
    expect(resolvePosition(null)).toBeUndefined();
  });
});

describe('toCardEntry / fromCardEntry — native position round-trip', () => {
  it('restores a native position through export and re-import', () => {
    for (const pos of [
      WI_POSITION.systemTop,
      WI_POSITION.globalNote,
      WI_POSITION.userTop,
      WI_POSITION.assistantTop,
    ]) {
      const entry = newEntry({ comment: 'x', content: 'c', position: pos });
      const exported = toCardEntry(entry, 0);
      // ST readers get the closest ST number; RPNow keeps the exact name.
      expect(exported.extensions?.position).toBeLessThan(8);
      expect(exported.extensions?.rp_position).toBeTruthy();
      const back = fromCardEntry(exported, 0);
      expect(back.position).toBe(pos);
    }
  });

  it('imports an RP-Hub string position directly', () => {
    const back = fromCardEntry(
      {
        keys: ['x'],
        content: 'c',
        position: 'user_top',
        extensions: {},
      },
      0,
    );
    expect(back.position).toBe(WI_POSITION.userTop);
  });
});

describe('lorebook defaults', () => {
  it('defaults the global scan depth to 2 and maxDepth to 0', () => {
    expect(DEFAULT_LOREBOOK_SETTINGS.scanDepth).toBe(2);
    expect(DEFAULT_LOREBOOK_SETTINGS.maxDepth).toBe(0);
    expect(DEFAULT_SETTINGS.lorebook.scanDepth).toBe(2);
    expect(DEFAULT_SETTINGS.lorebook.maxDepth).toBe(0);
  });
});
