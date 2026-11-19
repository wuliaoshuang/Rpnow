/**
 * K03/K04 unit tests: lorebook-insertion labels per prompt message and the
 * keyword / `[M#]` highlighter used by the inspector's message list.
 */

import { describe, expect, it } from 'vitest';
import * as React from 'react';
import {
  highlightPromptContent,
  keyToPattern,
  loreLabelsForMessage,
  splitByPattern,
} from '@/components/chat/PromptInspector.js';
import type { PromptMessage } from '@/core/prompt/builder.js';

function msg(partial: Partial<PromptMessage>): PromptMessage {
  return { role: 'system', content: '', ...partial };
}

const INJECTED = [
  { comment: '银鹭酒馆', position: '角色定义之前', chars: 10, bookName: '灰烬之城' },
  { comment: '夜市规则', position: '角色定义之后', chars: 8, bookName: '灰烬之城' },
  { comment: '深层回响', position: '按深度插入', chars: 5, bookName: '灰烬之城' },
  { comment: '开场白', position: '用户消息顶部', chars: 6, bookName: '灰烬之城' },
];

describe('loreLabelsForMessage (K03)', () => {
  it('labels before/after blocks by position', () => {
    const messages = [msg({ source: 'worldInfoBefore', content: 'x'.repeat(10) }), msg({ source: 'worldInfoAfter', content: 'y'.repeat(8) })];
    expect(loreLabelsForMessage(messages, INJECTED, 0).map((e) => e.comment)).toEqual(['银鹭酒馆']);
    expect(loreLabelsForMessage(messages, INJECTED, 1).map((e) => e.comment)).toEqual(['夜市规则']);
  });

  it('labels a merged system message via its +-joined source chain', () => {
    const messages = [msg({ source: 'preset:main+worldInfoBefore+card:post', content: 'x'.repeat(10) })];
    expect(loreLabelsForMessage(messages, INJECTED, 0).map((e) => e.comment)).toEqual(['银鹭酒馆']);
  });

  it('labels an at-depth message by exact content length', () => {
    const messages = [msg({ source: 'worldInfo@depth', injection: true, content: 'z'.repeat(5) })];
    expect(loreLabelsForMessage(messages, INJECTED, 0).map((e) => e.comment)).toEqual(['深层回响']);
  });

  it('labels the newest user turn for user_top entries', () => {
    const messages = [
      msg({ role: 'user', content: 'hi' }),
      msg({ role: 'assistant', content: 'hello' }),
      msg({ role: 'user', content: 'again' }),
    ];
    expect(loreLabelsForMessage(messages, INJECTED, 0)).toEqual([]);
    expect(loreLabelsForMessage(messages, INJECTED, 2).map((e) => e.comment)).toEqual(['开场白']);
  });

  it('labels nothing for plain non-history messages', () => {
    const messages = [msg({ role: 'system', source: 'preset:role', content: 'you are doro' })];
    expect(loreLabelsForMessage(messages, INJECTED, 0)).toEqual([]);
  });
});

describe('splitByPattern / keyToPattern (K04)', () => {
  it('splits hits out of plain text', () => {
    expect(splitByPattern('a银鹭b银鹭c', /银鹭/g)).toEqual([
      { text: 'a', hit: false },
      { text: '银鹭', hit: true },
      { text: 'b', hit: false },
      { text: '银鹭', hit: true },
      { text: 'c', hit: false },
    ]);
  });

  it('parses /pattern/flags keys and literal keys', () => {
    expect(keyToPattern('/foo|bar/gi')?.source).toBe('foo|bar');
    expect(keyToPattern('a+b')?.source).toBe('a\\+b');
    expect(keyToPattern('/(/')).toBeNull();
  });

  it('highlights keywords yellow and [M#] purple', () => {
    const nodes = highlightPromptContent('银鹭酒馆里 [M12] 在等你', ['银鹭']) as React.ReactNode[];
    const marks = (Array.isArray(nodes) ? nodes : []).filter(
      (n): n is React.ReactElement<{ className?: string; children?: React.ReactNode }> =>
        React.isValidElement(n) && n.type === 'mark',
    );
    expect(marks.map((m) => m.props.children)).toEqual(['银鹭', '[M12]']);
    expect(marks[0].props.className).toContain('yellow');
    expect(marks[1].props.className).toContain('purple');
  });
});
