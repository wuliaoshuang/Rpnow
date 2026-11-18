import { describe, expect, it } from 'vitest';
import { cotTagFor, parseCot, stripCot, usesThinkingCotTag } from './cot.js';

describe('usesThinkingCotTag', () => {
  it('matches the reasoning-model vendors', () => {
    expect(usesThinkingCotTag('deepseek-chat')).toBe(true);
    expect(usesThinkingCotTag('glm-4-plus')).toBe(true);
    expect(usesThinkingCotTag('kimi-k2')).toBe(true);
    expect(usesThinkingCotTag('moonshot-v1-8k')).toBe(true);
  });

  it('does not flag ordinary chat models', () => {
    expect(usesThinkingCotTag('gpt-4o')).toBe(false);
    expect(usesThinkingCotTag('claude-sonnet-4')).toBe(false);
    expect(usesThinkingCotTag('gemini-2.5-pro')).toBe(false);
  });
});

describe('cotTagFor', () => {
  it('uses thinking for reasoning vendors and cot otherwise', () => {
    expect(cotTagFor('deepseek-chat')).toBe('thinking');
    expect(cotTagFor('gpt-4o')).toBe('cot');
  });
});

describe('parseCot', () => {
  it('splits a thinking block from the body', () => {
    const parsed = parseCot('先想一想。<thinking>用户心情不好。</thinking>那你还好吗？');
    expect(parsed.reasoning).toBe('用户心情不好。');
    expect(parsed.main).toBe('先想一想。\n\n那你还好吗？');
    expect(parsed.hasReasoning).toBe(true);
  });

  it('handles <think> and <cot> too', () => {
    expect(parseCot('<think>a</think>b').reasoning).toBe('a');
    expect(parseCot('<cot>c</cot>d').reasoning).toBe('c');
    expect(parseCot('<thinking>t</thinking>u').reasoning).toBe('t');
  });

  it('collects several segments in order', () => {
    const parsed = parseCot('<think>一</think>中<think>二</think>');
    expect(parsed.reasoning).toBe('一\n\n二');
    expect(parsed.main).toBe('中');
  });

  it('is case-insensitive and tolerates attributes', () => {
    expect(parseCot('<Think type="x">a</Think>b').reasoning).toBe('a');
    expect(parseCot('<thinking lang="zh">x</thinking>').main).toBe('');
  });

  it('protects fenced code containing the tag text', () => {
    const text = '看这段：\n```js\nconst s = "<think>not reasoning</think>";\n```\n正文';
    const parsed = parseCot(text);
    expect(parsed.hasReasoning).toBe(false);
    expect(parsed.main).toContain('<think>not reasoning</think>');
  });

  it('protects inline code and HTML comments', () => {
    expect(parseCot('`<think>x</think>`').hasReasoning).toBe(false);
    expect(parseCot('<!-- <think>x</think> -->').hasReasoning).toBe(false);
  });

  it('leaves ordinary text alone', () => {
    const parsed = parseCot('普通正文');
    expect(parsed.reasoning).toBe('');
    expect(parsed.main).toBe('普通正文');
    expect(parsed.hasReasoning).toBe(false);
  });

  it('handles an empty string', () => {
    expect(parseCot('')).toEqual({ reasoning: '', main: '', hasReasoning: false });
  });

  it('tolerates an unclosed tag without eating the body', () => {
    const parsed = parseCot('正文<thinking>没闭合');
    // No closing tag => no reasoning extracted, body preserved.
    expect(parsed.main).toContain('正文');
  });
});

describe('stripCot', () => {
  it('returns only the body', () => {
    expect(stripCot('<think>x</think>正文')).toBe('正文');
  });
});
