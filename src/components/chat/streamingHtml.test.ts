import { describe, expect, it } from 'vitest';
import { hasUnclosedHtml } from './streamingHtml.js';

describe('hasUnclosedHtml (B04)', () => {
  it('balanced prose and closed tags are not unclosed', () => {
    expect(hasUnclosedHtml('你好，这是一段普通回复。')).toBe(false);
    expect(hasUnclosedHtml('<div>面板</div>')).toBe(false);
    expect(hasUnclosedHtml('```html\n<div>a</div>\n```')).toBe(false);
  });

  it('an odd number of fences means the fence never closed', () => {
    expect(hasUnclosedHtml('```html\n<div>a</div>\n')).toBe(true);
  });

  it('an opened but unclosed tracked tag counts as unclosed', () => {
    expect(hasUnclosedHtml('<div>面板内容')).toBe(true);
    expect(hasUnclosedHtml('<details><summary>标题</summary>内容')).toBe(true);
    expect(hasUnclosedHtml('前面文字 <div>面板</div> 后面 <section>未完')).toBe(true);
  });

  it('tags inside a fenced block do not count', () => {
    expect(hasUnclosedHtml('```\n<div>代码里的尖括号</div>\n```')).toBe(false);
  });
});
