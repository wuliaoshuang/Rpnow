import { describe, expect, it } from 'vitest';
import { compressImageFile, novelaiAdapter } from './types.js';
import { DEFAULT_TAG_PROMPT } from './nai.js';

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

describe('novelaiAdapter V5', () => {
  const conn = {
    id: 'c1',
    name: 'NAI',
    provider: 'novelai',
    baseURL: 'https://image.novelai.net',
    apiKey: 'k',
  };

  /** Capture the request body the adapter sends, answering with one fake image. */
  async function captureBody(model: string) {
    let body: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      const png = Buffer.from('fake-png').toString('base64');
      return new Response(JSON.stringify({ images: [{ image: png }] }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    await novelaiAdapter.generate(conn, { prompt: '1girl, white hair', model }, fetchImpl);
    return body;
  }

  it('lists V5 models first', () => {
    expect(novelaiAdapter.knownModels).toContain('nai-diffusion-5-full');
    expect(novelaiAdapter.knownModels).toContain('nai-diffusion-5-curated');
    expect(novelaiAdapter.knownModels[0]).toBe('nai-diffusion-5-full');
  });

  it('sends v4_prompt for V5 (there is no v5_prompt; omitting it is a 500)', async () => {
    const body = await captureBody('nai-diffusion-5-full');
    expect(body.model).toBe('nai-diffusion-5-full');
    const params = body.parameters as Record<string, unknown>;
    expect(params.v4_prompt).toBeDefined();
    expect(params.v4_negative_prompt).toBeDefined();
    expect((params.v4_prompt as { caption: { base_caption: string } }).caption.base_caption).toBe(
      '1girl, white hair',
    );
  });

  it('still sends v4_prompt for V4.5', async () => {
    const body = await captureBody('nai-diffusion-4-5-full');
    const params = body.parameters as Record<string, unknown>;
    expect(params.v4_prompt).toBeDefined();
    expect(params.v4_negative_prompt).toBeDefined();
  });

  it('does not send v4_prompt for V3', async () => {
    const body = await captureBody('nai-diffusion-3');
    const params = body.parameters as Record<string, unknown>;
    expect(params.v4_prompt).toBeUndefined();
  });
});

describe('DEFAULT_TAG_PROMPT (NovelAI V5)', () => {
  it('ends with the V5 quality suffix and forbids V4.5 suffixes', () => {
    expect(DEFAULT_TAG_PROMPT).toContain('very aesthetic, masterpiece, no text');
    expect(DEFAULT_TAG_PROMPT).toContain('best quality');
    expect(DEFAULT_TAG_PROMPT).toContain('Danbooru');
  });
});
