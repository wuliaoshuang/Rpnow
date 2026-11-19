import { describe, expect, it } from 'vitest';
import { isWritesPaused, runAsRestoreWrite, setWritesPaused } from './index.js';

describe('writesPaused (O02)', () => {
  it('pauses and resumes', () => {
    setWritesPaused(true);
    expect(isWritesPaused()).toBe(true);
    setWritesPaused(false);
    expect(isWritesPaused()).toBe(false);
  });

  it('runAsRestoreWrite allows writes inside and restores the pause after', async () => {
    setWritesPaused(true);
    try {
      const out = await runAsRestoreWrite(async () => 'ok');
      expect(out).toBe('ok');
      expect(isWritesPaused()).toBe(true);
      // Nested restore sections also work.
      await runAsRestoreWrite(async () => {
        await runAsRestoreWrite(async () => undefined);
      });
    } finally {
      setWritesPaused(false);
    }
    expect(isWritesPaused()).toBe(false);
  });
});
