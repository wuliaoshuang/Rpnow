import { describe, expect, it } from 'vitest';
import { sseData, sseJson } from './sse.js';

function streamFromChunks(chunks: string[], close = true): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const chunk of chunks) c.enqueue(enc.encode(chunk));
      if (close) c.close();
    },
  });
}

describe('sseData', () => {
  it('yields data payloads split across chunk boundaries', async () => {
    const out: string[] = [];
    for await (const payload of sseData(streamFromChunks(['data: {"a"', ':1}\n\ndata: [DONE]\n\n']))) {
      out.push(payload);
    }
    expect(out).toEqual(['{"a":1}', '[DONE]']);
  });

  it('throws after the idle timeout when no chunk arrives (C06)', async () => {
    // A stream that never enqueues and never closes: every read pends forever.
    const hanging = new ReadableStream<Uint8Array>({ start() {} });
    await expect(
      (async () => {
        for await (const _payload of sseData(hanging, { idleTimeoutMs: 20 })) {
          // never reached
        }
      })(),
    ).rejects.toThrow(/空闲超时/);
  });
});

describe('sseJson', () => {
  it('parses frames and stops at [DONE]', async () => {
    const out: unknown[] = [];
    for await (const obj of sseJson<{ x: number }>(
      streamFromChunks(['data: {"x":1}\n\n', 'data: [DONE]\n\n', 'data: {"x":2}\n\n']),
    )) {
      out.push(obj);
    }
    expect(out).toEqual([{ x: 1 }]);
  });
});
