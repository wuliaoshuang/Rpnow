import { describe, expect, it } from 'vitest';
import { importFiles, normalizeRegexScript, parseRegexOnlyJson } from './cardImport.js';

describe('normalizeRegexScript', () => {
  it('fills defaults for a minimal script', () => {
    const s = normalizeRegexScript({ findRegex: '/foo/g', replaceString: 'bar' });
    expect(s?.scriptName).toBe('正则 1');
    expect(s?.placement).toEqual([2]);
    expect(s?.disabled).toBe(false);
    expect(s?.minDepth).toBeNull();
  });

  it('keeps an explicit name and placement', () => {
    const s = normalizeRegexScript({ scriptName: '去思考', findRegex: 'x', placement: [1, 2] });
    expect(s?.scriptName).toBe('去思考');
    expect(s?.placement).toEqual([1, 2]);
  });

  it('rejects entries without a pattern', () => {
    expect(normalizeRegexScript({ scriptName: '空' })).toBeNull();
    expect(normalizeRegexScript(null)).toBeNull();
  });
});

describe('parseRegexOnlyJson (P09)', () => {
  it('recognises {regex_scripts:[...]}', () => {
    const out = parseRegexOnlyJson({ regex_scripts: [{ scriptName: 'A', findRegex: 'a' }] });
    expect(out).toHaveLength(1);
    expect(out?.[0].scriptName).toBe('A');
  });

  it('recognises a bare array of scripts', () => {
    const out = parseRegexOnlyJson([{ findRegex: 'a' }, { findRegex: 'b' }]);
    expect(out).toHaveLength(2);
  });

  it('recognises {extensions:{regex_scripts:[...]}}', () => {
    const out = parseRegexOnlyJson({ extensions: { regex_scripts: [{ findRegex: 'a' }] } });
    expect(out).toHaveLength(1);
  });

  it('returns null for anything else', () => {
    expect(parseRegexOnlyJson({ name: 'x' })).toBeNull();
    expect(parseRegexOnlyJson([])).toBeNull();
    expect(parseRegexOnlyJson(null)).toBeNull();
    expect(parseRegexOnlyJson([{ scriptName: 'no pattern' }])).toBeNull();
  });
});

describe('importFiles (P09)', () => {
  it('imports a regex-only JSON file on its own', async () => {
    const file = new File(
      [JSON.stringify({ regex_scripts: [{ scriptName: '去标签', findRegex: '<[^>]+>', replaceString: '' }] })],
      'my-regex.json',
      { type: 'application/json' },
    );
    const res = await importFiles([file]);
    expect(res.regexScripts).toHaveLength(1);
    expect(res.regexScripts[0].scriptName).toBe('去标签');
    expect(res.cards).toHaveLength(0);
    expect(res.outcomes[0].kind).toBe('regex');
  });

  it('imports a bare regex array file', async () => {
    const file = new File([JSON.stringify([{ findRegex: 'a', replaceString: 'b' }])], 'regex.json', {
      type: 'application/json',
    });
    const res = await importFiles([file]);
    expect(res.regexScripts).toHaveLength(1);
  });
});
