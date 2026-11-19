import { describe, expect, it } from 'vitest';
import { compactDiffParts, countDiffChars, DIFF_CONTEXT_CHARS, diffText, wordDiff } from './wordDiff.js';

describe('diffText', () => {
  it('returns one same run for identical text', () => {
    expect(diffText('你好世界', '你好世界')).toEqual([{ type: 'same', text: '你好世界' }]);
  });

  it('marks a CJK replacement char by char', () => {
    const parts = diffText('他性格冷淡', '他性格温柔');
    expect(parts).toEqual([
      { type: 'same', text: '他性格' },
      { type: 'del', text: '冷淡' },
      { type: 'add', text: '温柔' },
    ]);
  });

  it('diffs Latin text word by word', () => {
    const parts = diffText('the quick brown fox', 'the quick red fox');
    expect(parts).toContainEqual({ type: 'del', text: 'brown' });
    expect(parts).toContainEqual({ type: 'add', text: 'red' });
    expect(parts.some((p) => p.type === 'same' && p.text.includes('quick'))).toBe(true);
  });

  it('handles pure insertion and pure deletion', () => {
    expect(diffText('', '新内容')).toEqual([{ type: 'add', text: '新内容' }]);
    expect(diffText('旧内容', '')).toEqual([{ type: 'del', text: '旧内容' }]);
    expect(diffText('', '')).toEqual([]);
  });

  it('folds a 1-2 char match stranded between edits into the edit', () => {
    // "ab" between two edits is too short to read as context.
    const parts = diffText('甲ab乙', '丙ab丁');
    expect(parts.some((p) => p.type === 'same' && p.text === 'ab')).toBe(false);
  });
});

describe('compactDiffParts', () => {
  it('folds a long unchanged run with 60 chars of context each side', () => {
    const pad = '垫'.repeat(200);
    const parts = compactDiffParts(diffText(`${pad}冷淡${pad}`, `${pad}温柔${pad}`));
    const gap = parts.find((p) => p.type === 'gap');
    expect(gap?.text).toBe('……');
    const sames = parts.filter((p) => p.type === 'same');
    // Head run keeps its leading 60 (no edit before it); tail run keeps 60.
    expect(sames.some((p) => p.text.length === DIFF_CONTEXT_CHARS)).toBe(true);
    expect(sames.every((p) => p.text.length <= DIFF_CONTEXT_CHARS)).toBe(true);
  });

  it('leaves short unchanged runs alone', () => {
    const parts = compactDiffParts(diffText('他性格冷淡', '他性格温柔'));
    expect(parts.some((p) => p.type === 'gap')).toBe(false);
  });
});

describe('wordDiff', () => {
  it('counts added and removed characters', () => {
    const { added, removed, parts } = wordDiff('他性格冷淡', '他性格温柔');
    expect(added).toBe(2);
    expect(removed).toBe(2);
    expect(countDiffChars(parts, 'add')).toBe(2);
    expect(countDiffChars(parts, 'del')).toBe(2);
  });

  it('counts zero for identical text', () => {
    const { added, removed } = wordDiff('相同', '相同');
    expect(added).toBe(0);
    expect(removed).toBe(0);
  });
});
