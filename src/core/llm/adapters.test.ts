import { describe, expect, it } from 'vitest';
import { __internal } from './adapters.js';
import type { LLMMessage } from './types.js';

const { toOpenAIMessages, anthropicContent, geminiParts, parseDataUrl, openAITextContent } = __internal;

const DATA_URL = 'data:image/png;base64,iVBORw0KGgo=';
const REMOTE_URL = 'https://example.com/pic.jpg';

describe('toOpenAIMessages — multimodal (I03)', () => {
  it('keeps plain messages as a string content', () => {
    const out = toOpenAIMessages([{ role: 'user', content: 'hi' }]) as Array<{ content: unknown }>;
    expect(out[0].content).toBe('hi');
  });

  it('turns the newest user message with pictures into text + image_url parts (detail high)', () => {
    const msg: LLMMessage = { role: 'user', content: '这是什么？', imageUrls: [DATA_URL, REMOTE_URL] };
    const out = toOpenAIMessages([msg]) as Array<{ role: string; content: unknown }>;
    expect(out[0].content).toEqual([
      { type: 'text', text: '这是什么？' },
      { type: 'image_url', image_url: { url: DATA_URL, detail: 'high' } },
      { type: 'image_url', image_url: { url: REMOTE_URL, detail: 'high' } },
    ]);
  });

  it('leaves tool and assistant messages untouched when they carry no pictures', () => {
    const out = toOpenAIMessages([
      { role: 'assistant', content: 'ok', toolCalls: [{ id: 'c1', name: 'search', arguments: '{}' }] },
    ]) as Array<{ content: unknown }>;
    expect(out[0].content).toBe('ok');
  });
});

describe('anthropicContent / geminiParts (I03)', () => {
  it('Anthropic: data URL becomes a base64 image block, remote URL a url block', () => {
    const msg: LLMMessage = { role: 'user', content: '看图', imageUrls: [DATA_URL, REMOTE_URL] };
    expect(anthropicContent(msg)).toEqual([
      { type: 'text', text: '看图' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0KGgo=' } },
      { type: 'image', source: { type: 'url', url: REMOTE_URL } },
    ]);
  });

  it('Anthropic: no pictures stays a plain string', () => {
    expect(anthropicContent({ role: 'user', content: 'hi' })).toBe('hi');
  });

  it('Gemini: data URL becomes inlineData, remote URL a fileData part', () => {
    const msg: LLMMessage = { role: 'user', content: '看图', imageUrls: [DATA_URL, REMOTE_URL] };
    expect(geminiParts(msg)).toEqual([
      { text: '看图' },
      { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
      { fileData: { mimeType: 'image/jpeg', fileUri: REMOTE_URL } },
    ]);
  });
});

describe('parseDataUrl / openAITextContent', () => {
  it('parses mime + base64, returns null for remote URLs', () => {
    expect(parseDataUrl(DATA_URL)).toEqual({ mime: 'image/png', data: 'iVBORw0KGgo=' });
    expect(parseDataUrl(REMOTE_URL)).toBeNull();
  });

  it('reads text out of a parts-array content', () => {
    expect(openAITextContent('plain')).toBe('plain');
    expect(
      openAITextContent([
        { type: 'text', text: 'a' },
        { type: 'image_url', image_url: { url: DATA_URL } },
        { type: 'text', text: 'b' },
      ]),
    ).toBe('ab');
    expect(openAITextContent(null)).toBe('');
  });

  it('skips thought-flagged text parts (they are reasoning, not prose)', () => {
    expect(
      openAITextContent([
        { type: 'text', text: 'hello' },
        { type: 'text', text: 'secret-thought', thought: true },
      ]),
    ).toBe('hello');
  });
});

describe('reasoningFromDelta — C01 extra keys', () => {
  const { reasoningFromDelta, openAIReasoningContent } = __internal;
  it('reads thinking_content / thought / thoughts / reasoning_text', () => {
    expect(reasoningFromDelta({ thinking_content: 'tc' })).toBe('tc');
    expect(reasoningFromDelta({ thought: 'th' })).toBe('th');
    expect(reasoningFromDelta({ thoughts: ['a', 'b'] })).toBe('ab');
    expect(reasoningFromDelta({ thoughts: [{ text: 'x' }, { text: 'y' }] })).toBe('xy');
    expect(reasoningFromDelta({ reasoning_text: 'rt' })).toBe('rt');
  });

  it('reads reasoning_details[].reasoning as well as [].text', () => {
    expect(reasoningFromDelta({ reasoning_details: [{ reasoning: 'r1' }, { text: 'r2' }] })).toBe('r1r2');
  });

  it('reads OpenAI content[] thought shards', () => {
    expect(
      openAIReasoningContent([
        { type: 'text', text: 'hi' },
        { type: 'reasoning', text: 'r1' },
        { type: 'text', text: 'hidden', thought: true },
      ]),
    ).toBe('r1hidden');
    expect(
      reasoningFromDelta({
        content: [{ type: 'text', text: 'hi' }, { type: 'thinking', text: 'th' }],
      }),
    ).toBe('th');
  });
});

describe('openAICompatibleAdapter stream — C01/C07/reasoning tokens', () => {
  const conn = {
    id: 'c1',
    name: 'test',
    provider: 'openai-compatible',
    baseURL: 'https://example.com/v1',
    apiKey: 'k',
  };
  const enc = new TextEncoder();
  function sseResponse(frames: string[]): Response {
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        for (const f of frames) c.enqueue(enc.encode(f));
        c.close();
      },
    });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
  }
  function jsonResponse(json: unknown): Response {
    return new Response(JSON.stringify(json), { headers: { 'content-type': 'application/json' } });
  }
  async function collect(gen: AsyncGenerator<unknown>): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const ev of gen) out.push(ev);
    return out;
  }

  it('streams thinking_content and content[] thought shards as reasoning, and parses reasoning_tokens', async () => {
    const { openAICompatibleAdapter } = await import('./adapters.js');
    const fetchImpl = (async () =>
      sseResponse([
        `data: ${JSON.stringify({ choices: [{ delta: { thinking_content: 'tc' } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [{ delta: { content: [{ type: 'text', text: 'hi' }, { type: 'reasoning', text: 'r1' }] } }] })}\n\n`,
        `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 42 } } })}\n\n`,
        'data: [DONE]\n\n',
      ])) as unknown as typeof fetch;
    const events = await collect(
      openAICompatibleAdapter.stream(conn, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, fetchImpl),
    );
    expect(events).toContainEqual({ type: 'reasoning', delta: 'tc' });
    expect(events).toContainEqual({ type: 'text', delta: 'hi' });
    expect(events).toContainEqual({ type: 'reasoning', delta: 'r1' });
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 10,
      outputTokens: 5,
      cachedTokens: undefined,
      reasoningTokens: 42,
    });
  });

  it('non-stream JSON parses reasoning_tokens and thought shards', async () => {
    const { openAICompatibleAdapter } = await import('./adapters.js');
    const fetchImpl = (async () =>
      jsonResponse({
        choices: [
          {
            message: {
              content: [
                { type: 'text', text: 'hi' },
                { type: 'text', text: 'deep', thought: true },
              ],
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 3, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 7 } },
      })) as unknown as typeof fetch;
    const events = await collect(
      openAICompatibleAdapter.stream(
        conn,
        { model: 'm', messages: [{ role: 'user', content: 'hi' }], stream: false },
        fetchImpl,
      ),
    );
    expect(events).toContainEqual({ type: 'text', delta: 'hi' });
    expect(events).toContainEqual({ type: 'reasoning', delta: 'deep' });
    expect(events).toContainEqual({
      type: 'usage',
      inputTokens: 3,
      outputTokens: 2,
      cachedTokens: undefined,
      reasoningTokens: 7,
    });
  });

  it('falls back to JSON when the server ignores stream:true (C07)', async () => {
    const { openAICompatibleAdapter } = await import('./adapters.js');
    const fetchImpl = (async () =>
      jsonResponse({
        choices: [{ message: { content: 'json-fallback' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      })) as unknown as typeof fetch;
    const events = await collect(
      openAICompatibleAdapter.stream(conn, { model: 'm', messages: [{ role: 'user', content: 'hi' }] }, fetchImpl),
    );
    expect(events).toContainEqual({ type: 'text', delta: 'json-fallback' });
    expect(events).toContainEqual({ type: 'finish', reason: 'stop' });
  });
});
