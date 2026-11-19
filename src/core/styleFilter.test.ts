import { describe, expect, it } from 'vitest';
import {
  filterBlockedStyleText,
  filterStyleText,
  getStyleFilterHitSegments,
  isStandaloneRenderedContent,
  normalizeStyleFilterHit,
} from './styleFilter.js';

describe('styleFilter (B11/M07, RP-Hub parity)', () => {
  it('removes a blocked cliché sentence and records the hit', () => {
    const { text, hits } = filterStyleText('他站在雨里，语气很平，像在等一个人。后来他走了。');
    expect(text).not.toContain('语气很平');
    expect(text).toContain('后来他走了');
    expect(hits.length).toBeGreaterThan(0);
  });

  it('removes the word 极其 and the "N 个字" aside', () => {
    const { text, hits } = filterStyleText('这是一段极其漫长的等待。二十个字写完了。');
    expect(text).not.toContain('极其');
    expect(text).not.toContain('二十个字');
    expect(hits).toContain('极其');
  });

  it('removes a pale-finger sentence (sentence rule eats the whole sentence, as in RP-Hub)', () => {
    const { text, hits } = filterStyleText('她攥着杯子，指尖发白，却什么也没说。后来她松开了手。');
    expect(text).not.toContain('指尖发白');
    expect(text).toContain('后来她松开了手');
    expect(hits.some((h) => h.includes('指尖'))).toBe(true);
  });

  it('never touches quoted dialogue', () => {
    const src = '他低声说：“这声音很平，像在下雨。”然后转身走了。';
    const { text } = filterStyleText(src);
    expect(text).toContain('“这声音很平，像在下雨。”');
  });

  it('passes standalone rendered content through untouched', () => {
    const src = '<div>语气很平</div>';
    expect(isStandaloneRenderedContent(src)).toBe(true);
    expect(filterStyleText(src).text).toBe(src);
    expect(filterStyleText('```\n语气很平\n```').text).toContain('语气很平');
  });

  it('does nothing when disabled', () => {
    const src = '这是一段极其漫长的等待。';
    expect(filterBlockedStyleText(src, { enabled: false })).toBe(src);
    expect(filterStyleText(src, false).hits).toEqual([]);
  });

  it('leaves clean prose untouched', () => {
    const src = '雨停了，他推开门，闻到了泥土的味道。';
    const { text, hits } = filterStyleText(src);
    expect(text).toBe(src);
    expect(hits).toEqual([]);
  });

  it('normalises hits and highlights the matched words', () => {
    expect(normalizeStyleFilterHit('，语气很平。')).toBe('语气很平。');
    const segments = getStyleFilterHitSegments('语气很平，像在等一个人');
    expect(segments.some((s) => s.matched && s.text === '语气很平')).toBe(true);
    expect(segments.some((s) => s.matched && s.text === '像在')).toBe(true);
  });
});
