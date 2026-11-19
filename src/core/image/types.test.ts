import { describe, expect, it } from 'vitest';
import { compressImageFile } from './types.js';

describe('compressImageFile (I01/I03)', () => {
  it('falls back to a raw data URL where canvas is unavailable (node)', async () => {
    const blob = new Blob(['abc'], { type: 'image/png' });
    const url = await compressImageFile(blob);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('leaves animated GIFs untouched', async () => {
    const blob = new Blob(['gif-bytes'], { type: 'image/gif' });
    const url = await compressImageFile(blob);
    expect(url.startsWith('data:image/gif;base64,')).toBe(true);
  });
});
