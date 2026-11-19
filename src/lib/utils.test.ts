import { describe, expect, it } from 'vitest';
import { formatMessageTime } from './utils.js';
import { isMediaRef, mediaIdFromRef, mediaRef } from '../core/media/store.js';

describe('formatMessageTime', () => {
  it('shows today with seconds', () => {
    const now = new Date();
    now.setHours(18, 32, 5, 0);
    const out = formatMessageTime(now.getTime());
    expect(out).toBe('18:32:05');
  });

  it('shows yesterday with seconds', () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    d.setHours(9, 5, 41, 0);
    const out = formatMessageTime(d.getTime());
    expect(out).toBe('昨天 09:05:41');
  });

  it('shows month/day with seconds for this year', () => {
    const d = new Date();
    d.setMonth(0, 3);
    d.setHours(23, 59, 59, 0);
    // Skip when Jan 3 is today or yesterday (the branch above wins).
    if (d.getDate() === new Date().getDate() && d.getMonth() === new Date().getMonth()) return;
    const out = formatMessageTime(d.getTime());
    expect(out).toMatch(/^1月3日 23:59:59$/);
  });

  it('shows the year for older dates', () => {
    const d = new Date(2024, 4, 6, 7, 8, 9);
    expect(formatMessageTime(d.getTime())).toBe('2024年5月6日 07:08:09');
  });
});

describe('media refs', () => {
  it('round-trips a media reference', () => {
    const ref = mediaRef('img_abc');
    expect(ref).toBe('media:img_abc');
    expect(isMediaRef(ref)).toBe(true);
    expect(mediaIdFromRef(ref)).toBe('img_abc');
  });

  it('does not treat data URLs or http URLs as media refs', () => {
    expect(isMediaRef('data:image/png;base64,xxx')).toBe(false);
    expect(isMediaRef('https://example.com/a.png')).toBe(false);
    expect(mediaIdFromRef('data:image/png;base64,xxx')).toBeUndefined();
  });
});
