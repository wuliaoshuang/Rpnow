import { describe, expect, it } from 'vitest';
import { extractToolTrace, isErrorResult, summarizeValue } from './ToolTimeline.js';
import type { RPChatMessage } from '@/core/types/chat.js';

function msg(meta?: Record<string, unknown>): RPChatMessage {
  return { id: 'm1', role: 'assistant', content: 'hi', createdAt: 0, meta };
}

describe('extractToolTrace', () => {
  it('returns undefined when there is no trace', () => {
    expect(extractToolTrace(msg())).toBeUndefined();
    expect(extractToolTrace(msg({ toolTrace: [] }))).toBeUndefined();
    expect(extractToolTrace(msg({ toolTrace: 'nope' }))).toBeUndefined();
  });

  it('keeps valid entries and drops corrupt ones', () => {
    const trace = extractToolTrace(
      msg({
        toolTrace: [
          { name: 'dice', args: { sides: 6 }, result: 4 },
          { name: 42, args: {}, result: null },
          'junk',
        ],
      }),
    );
    expect(trace).toEqual([{ name: 'dice', args: { sides: 6 }, result: 4 }]);
  });
});

describe('isErrorResult', () => {
  it('flags results carrying an error field', () => {
    expect(isErrorResult({ error: 'boom' })).toBe(true);
    expect(isErrorResult({ ok: true })).toBe(false);
    expect(isErrorResult('plain string')).toBe(false);
    expect(isErrorResult(null)).toBe(false);
  });
});

describe('summarizeValue', () => {
  it('truncates long JSON and strings', () => {
    expect(summarizeValue('short')).toBe('short');
    expect(summarizeValue({ a: 1 })).toBe('{"a":1}');
    expect(summarizeValue('x'.repeat(200))).toBe(`${'x'.repeat(160)}…`);
    expect(summarizeValue(undefined)).toBe('—');
  });
});
