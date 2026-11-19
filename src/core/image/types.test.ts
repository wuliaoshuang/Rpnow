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

  it('sends karras + params_version 4 for V5, and no sm/sm_dyn', async () => {
    const body = await captureBody('nai-diffusion-5-full');
    const params = body.parameters as Record<string, unknown>;
    expect(params.noise_schedule).toBe('karras');
    expect(params.params_version).toBe(4);
    expect(params.sm).toBeUndefined();
    expect(params.sm_dyn).toBeUndefined();
    expect(params.uc).toBeDefined();
    expect(params.negative_prompt).toBeUndefined();
    expect(params.scale).toBe(6);
  });

  it('sends params_version 3 + sm false for V4.5', async () => {
    const body = await captureBody('nai-diffusion-4-5-full');
    const params = body.parameters as Record<string, unknown>;
    expect(params.noise_schedule).toBe('karras');
    expect(params.params_version).toBe(3);
    expect(params.sm).toBe(false);
    expect(params.sm_dyn).toBe(false);
    expect(params.uc).toBeDefined();
  });

  it('surfaces a JSON error field as the failure reason', async () => {
    const fetchImpl = (async () => {
      return new Response(JSON.stringify({ error: 'Anlas 不足' }), {
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    await expect(
      novelaiAdapter.generate(conn, { prompt: '1girl', model: 'nai-diffusion-5-full' }, fetchImpl),
    ).rejects.toThrow('Anlas 不足');
  });
});

describe('DEFAULT_TAG_PROMPT (NovelAI V5)', () => {
  it('ends with the V5 quality suffix and forbids V4.5 suffixes', () => {
    expect(DEFAULT_TAG_PROMPT).toContain('very aesthetic, masterpiece, no text');
    expect(DEFAULT_TAG_PROMPT).toContain('best quality');
    expect(DEFAULT_TAG_PROMPT).toContain('Danbooru');
  });
});
