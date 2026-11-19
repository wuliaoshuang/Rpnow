import { describe, expect, it } from 'vitest';
import {
  filterUsage,
  formatDuration,
  formatSpeed,
  formatTokens,
  recordTotalTokens,
  summarizeUsage,
  type UsageRecord,
} from './usage.js';

function record(partial: Partial<UsageRecord> & { at: number }): UsageRecord {
  return { id: 'u_test', kind: 'chat', ...partial };
}

describe('formatTokens', () => {
  it('小数字直接显示', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(9999)).toBe('9999');
  });
  it('过万用 万 为单位', () => {
    expect(formatTokens(10000)).toBe('1万');
    expect(formatTokens(12345)).toBe('1.23万');
    expect(formatTokens(105000)).toBe('10.5万');
  });
  it('缺失显示 —', () => {
    expect(formatTokens(undefined)).toBe('—');
  });
});

describe('formatDuration', () => {
  it('毫秒 / 秒 / 分', () => {
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(1200)).toBe('1.2s');
    expect(formatDuration(65000)).toBe('1m05s');
    expect(formatDuration(undefined)).toBe('—');
  });
});

describe('formatSpeed', () => {
  it('输出 token / 秒', () => {
    expect(formatSpeed(record({ at: 0, outputTokens: 100, durationMs: 2000 }))).toBe('50.0 tok/s');
  });
  it('缺数据时显示 —', () => {
    expect(formatSpeed(record({ at: 0 }))).toBe('—');
    expect(formatSpeed(record({ at: 0, outputTokens: 10, durationMs: 0 }))).toBe('—');
  });
});

describe('filterUsage', () => {
  const now = 1_800_000_000_000;
  const rows = [
    record({ at: now - 1000, kind: 'chat' }),
    record({ at: now - 25 * 60 * 60 * 1000, kind: 'memory' }),
    record({ at: now - 8 * 24 * 60 * 60 * 1000, kind: 'embedding' }),
  ];
  it('按分类筛', () => {
    expect(filterUsage(rows, { kind: 'memory', now })).toHaveLength(1);
    expect(filterUsage(rows, { kind: 'all', now })).toHaveLength(3);
  });
  it('按时间筛', () => {
    expect(filterUsage(rows, { range: '24h', now })).toHaveLength(1);
    expect(filterUsage(rows, { range: '7d', now })).toHaveLength(2);
    expect(filterUsage(rows, { range: '30d', now })).toHaveLength(3);
  });
});

describe('summarizeUsage', () => {
  it('汇总请求数与各类 token', () => {
    const rows = [
      record({ at: 0, kind: 'chat', inputTokens: 100, cachedTokens: 20, outputTokens: 50, durationMs: 1000 }),
      record({ at: 0, kind: 'memory', inputTokens: 200, outputTokens: 30, reasoningTokens: 5, durationMs: 500 }),
      record({ at: 0, kind: 'embedding', inputTokens: 10 }),
    ];
    const s = summarizeUsage(rows);
    expect(s.requests).toBe(3);
    expect(s.inputTokens).toBe(310);
    expect(s.cachedTokens).toBe(20);
    expect(s.outputTokens).toBe(80);
    expect(s.reasoningTokens).toBe(5);
    expect(s.totalTokens).toBe(410);
    expect(s.durationMs).toBe(1500);
  });
  it('空历史汇总为 0', () => {
    expect(summarizeUsage([])).toEqual({
      requests: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      durationMs: 0,
    });
  });
});

describe('recordTotalTokens', () => {
  it('输入 + 缓存 + 输出', () => {
    expect(
      recordTotalTokens(record({ at: 0, inputTokens: 100, cachedTokens: 20, outputTokens: 50 })),
    ).toBe(170);
  });
});
