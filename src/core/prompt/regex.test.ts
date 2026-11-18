import { describe, expect, it } from 'vitest';
import { runRegex, applyPromptRegex } from './builder.js';
import { renderMessageText } from '../../features/chat/orchestrator.js';
import type { RPRegexScript } from '../types/card.js';

function script(over: Partial<RPRegexScript> = {}): RPRegexScript {
  return {
    id: 'r1',
    scriptName: '测试',
    findRegex: '/(.+)/g',
    replaceString: '$1',
    placement: [2],
    disabled: false,
    markdownOnly: false,
    promptOnly: false,
    ...over,
  };
}

describe('runRegex', () => {
  it('parses the /pattern/flags literal form', () => {
    const out = runRegex(script({ findRegex: '/[0-9]+/gi', replaceString: '#' }), 'a1b22');
    expect(out).toBe('a#b#');
  });

  it('drops the g flag from the literal form (it re-adds it)', () => {
    // Without the de-dupe, `gg` would throw.
    expect(() => runRegex(script({ findRegex: '/x/gg' }), 'x')).not.toThrow();
  });

  it('supports the bare-pattern form', () => {
    expect(runRegex(script({ findRegex: '\\d+', replaceString: 'N' }), 'a1b2')).toBe('aNbN');
  });

  it('applies trimStrings after replacement', () => {
    expect(runRegex(script({ findRegex: '/.*/g', replaceString: 'x', trimStrings: ['x'] }), 'anything')).toBe('');
  });

  it('returns the text unchanged for an invalid pattern', () => {
    expect(runRegex(script({ findRegex: '/(/' }), '原文')).toBe('原文');
  });
});

describe('placement semantics', () => {
  it('markdownOnly affects only the rendered message, not the prompt', () => {
    const s = script({ markdownOnly: true, findRegex: '/秘密/', replaceString: '***' });
    expect(renderMessageText('这是一个秘密', [s], 2)).toBe('这是一个***');
    expect(applyPromptRegex('这是一个秘密', [s], 2)).toBe('这是一个秘密');
  });

  it('promptOnly affects only the prompt, not the rendered message', () => {
    const s = script({ promptOnly: true, findRegex: '/秘密/', replaceString: '***' });
    expect(renderMessageText('这是一个秘密', [s], 2)).toBe('这是一个秘密');
    expect(applyPromptRegex('这是一个秘密', [s], 2)).toBe('这是一个***');
  });

  it('when neither flag is set the script only affects what the user sees', () => {
    const s = script({ findRegex: '/秘密/', replaceString: '***' });
    expect(renderMessageText('这是一个秘密', [s], 2)).toBe('这是一个***');
    expect(applyPromptRegex('这是一个秘密', [s], 2)).toBe('这是一个秘密');
  });

  it('respects the placement list', () => {
    const s = script({ markdownOnly: true, placement: [1], findRegex: '/x/', replaceString: 'y' });
    expect(renderMessageText('x', [s], 2)).toBe('x');
    expect(renderMessageText('x', [s], 1)).toBe('y');
  });

  it('skips disabled scripts', () => {
    const s = script({ markdownOnly: true, disabled: true, findRegex: '/x/', replaceString: 'y' });
    expect(renderMessageText('x', [s], 2)).toBe('x');
  });

  it('treats 0 as a real bound (maxDepth 0 = newest only)', () => {
    const s = script({ markdownOnly: true, findRegex: '/x/', replaceString: 'y', minDepth: 0, maxDepth: 0 });
    expect(renderMessageText('x', [s], 2, 0)).toBe('y');
    expect(renderMessageText('x', [s], 2, 1)).toBe('x');
  });

  it('honours minDepth/maxDepth relative to the end of the history', () => {
    const s = script({
      markdownOnly: true,
      findRegex: '/x/',
      replaceString: 'y',
      minDepth: 1,
      maxDepth: 2,
    });
    expect(renderMessageText('x', [s], 2, 1)).toBe('y');
    expect(renderMessageText('x', [s], 2, 2)).toBe('y');
    expect(renderMessageText('x', [s], 2, 3)).toBe('x');
  });
});
