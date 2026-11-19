/**
 * SSE (Server-Sent Events) parsing.
 *
 * Providers stream with `data: {...}\n\n` frames, but the details that break
 * naive implementations are:
 *   - a chunk boundary can land mid-frame, so a decoder must buffer by line,
 *   - OpenAI's usage chunk has `choices: []` (naive `choices[0]` throws),
 *   - the terminator is a literal `data: [DONE]`,
 *   - some providers send `event:` lines (Anthropic), some comments `: ping`.
 */

/** SSE idle timeout (C06): 120s without a chunk ends the stream. */
export const SSE_IDLE_TIMEOUT_MS = 120_000;

/** Split a byte stream into SSE `data:` payload strings. */
export async function* sseData(
  body: ReadableStream<Uint8Array>,
  opts?: { idleTimeoutMs?: number },
): AsyncGenerator<string> {
  const idleMs = opts?.idleTimeoutMs ?? SSE_IDLE_TIMEOUT_MS;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      // Race each read against the idle timer: a provider that goes quiet
      // for `idleMs` is treated as a failed stream, not an endless spinner.
      // The timer is reset on every chunk that arrives.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          // Reject FIRST, then cancel: cancelling settles the pending read()
          // with done:true, and if that resolution won the race the stream
          // would end silently instead of reporting the timeout.
          reject(new Error(`SSE 空闲超时（${Math.round(idleMs / 1000)} 秒无数据），已断开连接`));
          void reader.cancel();
        }, idleMs);
      });
      let result: ReadableStreamReadResult<Uint8Array>;
      try {
        result = await Promise.race([reader.read(), timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      const { done, value } = result;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Normalise CRLF so `\r\n\r\n` separators work too.
      let idx: number;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + (buffer[idx] === '\r' ? 4 : 2));
        const payload = extractData(raw);
        if (payload !== undefined) yield payload;
      }
    }
    // Flush a trailing frame that has no terminating blank line.
    const tail = extractData(buffer + decoder.decode());
    if (tail !== undefined) yield tail;
  } finally {
    reader.releaseLock();
  }
}

/** Parse a raw SSE block into its data payload, joining multi-line data fields. */
export function extractData(block: string): string | undefined {
  if (!block.trim()) return undefined;
  const lines = block.split(/\r?\n/);
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (!dataLines.length) return undefined;
  return dataLines.join('\n');
}

/** Yield parsed JSON objects from an SSE body, stopping at `[DONE]`. */
export async function* sseJson<T = unknown>(
  body: ReadableStream<Uint8Array>,
  opts?: { idleTimeoutMs?: number },
): AsyncGenerator<T> {
  for await (const payload of sseData(body, opts)) {
    if (payload === '[DONE]') return;
    if (!payload.trim()) continue;
    try {
      yield JSON.parse(payload) as T;
    } catch {
      // Ignore malformed keepalive frames rather than killing the stream.
    }
  }
}

/** Read an error body into a human-readable message. */
export async function describeHttpError(res: Response): Promise<string> {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      const err = json.error as Record<string, unknown> | string | undefined;
      if (typeof err === 'string') detail = err;
      else if (err && typeof err === 'object') {
        detail = String(err.message ?? err.msg ?? JSON.stringify(err));
      } else if (json.message) detail = String(json.message);
      else detail = text.slice(0, 500);
    } catch {
      detail = text.slice(0, 500);
    }
  } catch {
    /* ignore */
  }
  const hint =
    res.status === 401
      ? '（API Key 无效或未填写）'
      : res.status === 403
        ? '（被拒绝：可能是 Key 权限、地区限制或浏览器 CORS 限制）'
        : res.status === 404
          ? '（接口地址或模型名不存在）'
          : res.status === 429
            ? '（请求过于频繁或额度不足）'
            : res.status >= 500
              ? '（服务端错误，请稍后重试）'
              : '';
  return `HTTP ${res.status} ${res.statusText}${hint}${detail ? ` — ${detail}` : ''}`;
}
