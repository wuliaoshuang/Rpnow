import { describe, expect, it } from 'vitest';
import { extractSpeakableText, splitIntoUtterances } from './types.js';

describe('extractSpeakableText', () => {
  it('drops HTML tags but keeps their text', () => {
    expect(extractSpeakableText('<p>Hello <b>there</b></p>', { maxChars: 999 })).toBe('Hello there');
  });

  it('removes style and script blocks entirely', () => {
    const input = 'Before<style>.a{color:red}</style><script>alert(1)</script>After';
    const out = extractSpeakableText(input, { maxChars: 999 });
    expect(out).toBe('Before After');
    expect(out).not.toContain('color');
    expect(out).not.toContain('alert');
  });

  it('strips card-specific custom tags', () => {
    const out = extractSpeakableText('<status>HP 100</status>她笑了。', { maxChars: 999 });
    // The tag is replaced by a space, which reads as a natural pause.
    expect(out.replace(/\s+/g, ' ')).toBe('HP 100 她笑了。');
    expect(out).not.toContain('<');
  });

  it('strips markdown emphasis, headings, lists and links', () => {
    const input = '# 标题\n\n- **粗体** 与 *斜体*\n- [链接](https://x.com)';
    const out = extractSpeakableText(input, { maxChars: 999 });
    expect(out).not.toContain('#');
    expect(out).not.toContain('**');
    expect(out).not.toContain('https://');
    expect(out).toContain('粗体');
    expect(out).toContain('链接');
  });

  it('removes images and horizontal rules', () => {
    const out = extractSpeakableText('![alt](a.png)\n\n---\n\n正文', { maxChars: 999 });
    expect(out).not.toContain('a.png');
    expect(out).not.toContain('---');
    expect(out).toContain('正文');
  });

  it('keeps dialogue and narration intact', () => {
    const out = extractSpeakableText('他放下杯子。\n\n「你来了。」', { maxChars: 999 });
    expect(out).toContain('他放下杯子');
    expect(out).toContain('你来了');
  });

  it('resolves {{char}} / {{user}} so they are never spoken literally', () => {
    const out = extractSpeakableText('{{char}} 看向 {{user}}。', { charName: 'Aria', userName: 'Sam', maxChars: 999 });
    expect(out).toBe('Aria 看向 Sam。');
    expect(out).not.toContain('{{');
  });

  it('drops unknown macros rather than reading braces aloud', () => {
    const out = extractSpeakableText('前{{random::A::B}}后', { maxChars: 999 });
    expect(out).not.toContain('{{');
    expect(out).toContain('前');
    expect(out).toContain('后');
  });

  it('never leaves doubled sentence punctuation', () => {
    // A paragraph break after a full stop must not produce "。。".
    const out = extractSpeakableText('第一句。\n\n第二句。', { maxChars: 999 });
    expect(out).not.toContain('。。');
  });

  it('truncates long text at a sentence boundary', () => {
    const sentence = '这是一句话。';
    const long = sentence.repeat(200);
    const out = extractSpeakableText(long, { maxChars: 100 });
    expect(out.length).toBeLessThanOrEqual(101);
    expect(out.endsWith('。')).toBe(true);
  });

  it('returns empty string for markup-only input', () => {
    expect(extractSpeakableText('<style>a{}</style>')).toBe('');
  });
});

describe('splitIntoUtterances', () => {
  it('splits on Chinese sentence punctuation', () => {
    expect(splitIntoUtterances('你好。我很好！你呢？', 220)).toEqual(['你好。', '我很好！', '你呢？']);
  });

  it('does not cut inside a 「」 quotation', () => {
    // 「这么晚。」他笑了 — the period is inside the quote, so this is one sentence.
    const out = splitIntoUtterances('「这么晚。」他看了一眼窗外的雨。', 220);
    expect(out).toEqual(['「这么晚。」他看了一眼窗外的雨。']);
  });

  it('does not split on single newlines inside dialogue', () => {
    const out = splitIntoUtterances('他放下杯子。\n「你来了。」', 220);
    expect(out.length).toBe(2);
    expect(out[1]).toBe('「你来了。」');
  });

  it('keeps a closing bracket with its sentence', () => {
    const out = splitIntoUtterances('他说完了（笑）。然后走了。', 220);
    expect(out[0]).toContain('（笑）。');
  });

  it('respects the size limit by breaking over-long sentences', () => {
    const text = '第一句话。'.repeat(40);
    const parts = splitIntoUtterances(text, 50);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(55);
  });

  it('groups a full roleplay paragraph into natural utterances', () => {
    const text =
      '门上的铜铃响了一声。阿尔德里克没有立刻抬头，直到把杯子倒扣在架子上。「这么晚。」他看了一眼窗外的雨，「坐吧。」';
    const parts = splitIntoUtterances(text, 220);
    expect(parts).toHaveLength(3);
    expect(parts[2]).toBe('「这么晚。」他看了一眼窗外的雨，「坐吧。」');
  });

  it('returns a single chunk for a short line', () => {
    expect(splitIntoUtterances('就这么一句', 220)).toEqual(['就这么一句']);
  });

  it('handles empty input', () => {
    expect(splitIntoUtterances('', 220)).toEqual([]);
  });
});
