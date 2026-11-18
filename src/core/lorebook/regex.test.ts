import { describe, expect, it } from 'vitest';
import { compileLorebookRegex, keyMatches } from './engine.js';
import { newEntry } from '../types/lorebook.js';

function entry(over: Partial<ReturnType<typeof newEntry>> = {}) {
  return newEntry({ keys: ['x'], useRegex: true, ...over });
}

describe('compileLorebookRegex', () => {
  it('treats a bare key as a pattern', () => {
    expect(compileLorebookRegex('abc')?.test('xabcx')).toBe(true);
  });

  it('parses /pattern/flags', () => {
    const re = compileLorebookRegex('/^雨/');
    expect(re?.test('雨停了')).toBe(true);
    expect(re?.test('不下雨')).toBe(false);
  });

  it('always enables case-insensitive matching', () => {
    expect(compileLorebookRegex('/HELLO/')?.test('say hello')).toBe(true);
  });

  it('respects caseSensitive when asked', () => {
    expect(compileLorebookRegex('/HELLO/', true)?.test('say hello')).toBe(false);
  });

  it('drops the g flag', () => {
    const re = compileLorebookRegex('/a/g');
    expect(re?.flags).toBe('i');
  });

  it('adds u for \\p{…} escapes', () => {
    const re = compileLorebookRegex('/\\p{L}+/');
    expect(re?.flags).toContain('u');
    expect(re?.test('abc')).toBe(true);
  });

  it('keeps an explicit u flag', () => {
    expect(compileLorebookRegex('/a/iu')?.flags).toContain('u');
  });

  it('returns null for an invalid pattern', () => {
    expect(compileLorebookRegex('/(/')).toBeNull();
  });

  it('rejects a trailing segment that is not a valid flag list', () => {
    // `/a/b` parses as pattern `a` with flag `b`, which is not a real flag.
    expect(compileLorebookRegex('/a/b')).toBeNull();
  });

  it('compiles \\p{L} with the unicode flag', () => {
    const re = compileLorebookRegex('/\\p{L}+/');
    expect(re).not.toBeNull();
    expect(re!.flags).toContain('u');
    expect(re!.test('abc')).toBe(true);
  });
});

describe('keyMatches with regex keys', () => {
  it('matches through the entry rules', () => {
    expect(keyMatches('今天下雨了', '/^今/', entry())).toBe(true);
    expect(keyMatches('今天下雨了', '/^明/', entry())).toBe(false);
  });

  it('falls back to no-match on a bad regex', () => {
    expect(keyMatches('text', '/(/', entry())).toBe(false);
  });

  it('still supports plain substring keys', () => {
    expect(keyMatches('今天下雨了', '下雨', entry({ useRegex: false }))).toBe(true);
  });
});
