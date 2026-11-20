import { describe, expect, it } from 'vitest';
import {
  extractSceneText,
  fetchAsDataUrl,
  hasImageMarkers,
  IMAGE_SIZES,
  markerForTags,
  naiJobAdapter,
  normalizeTags,
  parseImageMarkers,
  pollJob,
  rerollTags,
  rewriteImageMarker,
  stripImageMarkers,
} from './nai.js';

describe('parseImageMarkers', () => {
  it('finds markers with their offsets', () => {
    const text = '她推开门。image###1girl, smile###风铃响了。';
    const markers = parseImageMarkers(text);
    expect(markers).toHaveLength(1);
    expect(markers[0].tags).toBe('1girl, smile');
    expect(text.slice(markers[0].start, markers[0].end)).toBe('image###1girl, smile###');
  });

  it('finds several markers in order', () => {
    const markers = parseImageMarkers('image###a, b###中间image###c, d###');
    expect(markers.map((m) => m.tags)).toEqual(['a, b', 'c, d']);
  });

  it('ignores empty markers', () => {
    expect(parseImageMarkers('image######')).toEqual([]);
  });

  it('does not span lines', () => {
    expect(parseImageMarkers('image###a\nb###')).toEqual([]);
  });

  it('detects presence', () => {
    expect(hasImageMarkers('image###a, b###')).toBe(true);
    expect(hasImageMarkers('普通正文')).toBe(false);
  });
});

describe('stripImageMarkers', () => {
  it('replaces markers with a placeholder', () => {
    expect(stripImageMarkers('前image###a, b###后')).toBe('前（插图）后');
  });

  it('collapses the newlines a marker removal leaves behind', () => {
    expect(stripImageMarkers('a\nimage###x, y###\n\n\nb')).toBe('a\n（插图）\n\nb');
  });
});

describe('rerollTags', () => {
  it('swaps two adjacent tags', () => {
    const result = rerollTags('1girl, smile, indoors');
    expect(result.swapped).toBe(true);
    expect(result.tags.split(', ').length).toBe(3);
    // Same multiset, different order.
    expect(result.tags.split(', ').sort()).toEqual(['1girl', 'indoors', 'smile']);
  });

  it('refuses when there is nothing to swap', () => {
    expect(rerollTags('1girl')).toEqual({ tags: '1girl', swapped: false });
    expect(rerollTags('')).toEqual({ tags: '', swapped: false });
  });

  it('normalises separators', () => {
    expect(normalizeTags(' a ,  b ,, c ')).toBe('a, b, c');
  });
});

describe('IMAGE_SIZES', () => {
  it('uses the aspect ratios RP-Hub uses', () => {
    expect(IMAGE_SIZES.vertical).toEqual({ width: 832, height: 1216 });
    expect(IMAGE_SIZES.horizontal).toEqual({ width: 1216, height: 832 });
    expect(IMAGE_SIZES.square).toEqual({ width: 1024, height: 1024 });
  });
});

describe('pollJob', () => {
  it('returns as soon as the job is done', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ status: 'done', imageUrl: 'https://x/y.png' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    const status = await pollJob('job1', { token: 'k', tags: 'a', model: 'm', width: 1, height: 1, fetchImpl: fakeFetch, intervalMs: 1 });
    expect(status.status).toBe('done');
    expect(status.imageUrl).toBe('https://x/y.png');
    expect(calls[0]).toContain('/api/jobs/job1?token=k');
  });

  it('gives up after repeated failures', async () => {
    const fakeFetch = (async () => {
      throw new Error('network');
    }) as unknown as typeof fetch;
    const status = await pollJob('job1', {
      token: 'k',
      tags: 'a',
      model: 'm',
      width: 1,
      height: 1,
      fetchImpl: fakeFetch,
      intervalMs: 1,
      maxFailures: 2,
    });
    expect(status.status).toBe('failed');
    expect(status.error).toContain('network');
  });
});

describe('fetchAsDataUrl', () => {
  it('converts a blob to a data URL', async () => {
    const fakeFetch = (async () =>
      new Response(new Blob(['abc'], { type: 'image/png' }), { status: 200 })) as unknown as typeof fetch;
    const url = await fetchAsDataUrl('https://x/y.png', fakeFetch);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });
});

describe('markerForTags / rewriteImageMarker (I08)', () => {
  it('builds the raw marker text', () => {
    expect(markerForTags('1girl, smile')).toBe('image###1girl, smile###');
  });

  it('rewrites the old marker in stored prose after a reroll', () => {
    const text = '她推开门。image###1girl, smile###风铃响了。';
    expect(rewriteImageMarker(text, 'image###1girl, smile###', 'image###smile, 1girl###')).toBe(
      '她推开门。image###smile, 1girl###风铃响了。',
    );
  });

  it('leaves prose untouched when the marker was already stripped to （插图）', () => {
    const text = '她推开门。（插图）风铃响了。';
    expect(rewriteImageMarker(text, 'image###1girl, smile###', 'image###smile, 1girl###')).toBe(text);
  });

  it('is a no-op when the marker did not change', () => {
    const text = 'image###a, b###';
    expect(rewriteImageMarker(text, 'image###a, b###', 'image###a, b###')).toBe(text);
  });
});

describe('extractSceneText', () => {
  it('keeps the narrative and drops preset markup, markers and the placeholder', () => {
    const text = extractSceneText(
      '<think_nya>偷偷想：她在害怕</think_nya>雪山上，咕嘎在找曲奇。<summary>小总结</summary>image###1girl, snow###（插图）<options><option>继续</option></options>',
    );
    expect(text).toBe('雪山上，咕嘎在找曲奇。');
  });

  it('strips html tags and collapses whitespace', () => {
    expect(extractSceneText('<p>第一句。</p>\n\n<p>第二句。</p>')).toBe('第一句。 第二句。');
  });

  it('returns empty when only markup remains', () => {
    expect(extractSceneText('<think_nya>想</think_nya>image###a, b###')).toBe('');
  });

  it('keeps a long reply in full instead of cutting it off', () => {
    const text = extractSceneText('啊'.repeat(600));
    expect(text.length).toBe(600);
  });
});

describe('naiJobAdapter', () => {
  const conn = {
    id: 'img_nai',
    name: 'NAI',
    provider: 'nai',
    baseURL: 'https://nai.sta1n.cn',
    apiKey: 'test-token',
    defaultModel: 'nai-diffusion-5-full',
  };

  it('key 是 nai：image.generate 能按它找到这个适配器', () => {
    expect(naiJobAdapter.key).toBe('nai');
  });

  it('提交时提示词和负面提示词都在 query 里，轮询后返回 data URL', async () => {
    const calls: string[] = [];
    const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      calls.push(`${init?.method ?? 'GET'} ${u}`);
      if (u.includes('/api/jobs?')) {
        return new Response(JSON.stringify({ id: 'job-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (u.includes('/api/jobs/job-1')) {
        return new Response(JSON.stringify({ status: 'done', imageUrl: 'data:image/png;base64,AAA' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      // fetchAsDataUrl 取图：返回一小段 png。
      return new Response(new Uint8Array([137, 80, 78, 71]), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      });
    }) as unknown as typeof fetch;

    const results = await naiJobAdapter.generate(
      conn,
      {
        prompt: '1girl, long blue hair, artist:test_artist',
        negativePrompt: 'lowres, bad hands',
        size: 'square',
        model: 'nai-diffusion-5-full',
      },
      fakeFetch,
    );
    expect(results).toHaveLength(1);
    expect(results[0].provider).toBe('nai');
    expect(results[0].model).toBe('nai-diffusion-5-full');
    expect(results[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    const submitCall = calls.find((c) => c.startsWith('POST'));
    expect(submitCall).toBeDefined();
    const submitUrl = new URL(submitCall!.slice('POST '.length));
    expect(submitUrl.searchParams.get('prompt')).toBe('1girl, long blue hair, artist:test_artist');
    expect(submitUrl.searchParams.get('negative')).toBe('lowres, bad hands');
    expect(submitUrl.searchParams.get('token')).toBe('test-token');
    expect(calls.some((c) => c.includes('/api/jobs/job-1'))).toBe(true);
  });

  it('提交失败时抛错，调用方能报出来', async () => {
    const fakeFetch = (async () =>
      new Response('nope', { status: 500 })) as unknown as typeof fetch;
    await expect(
      naiJobAdapter.generate(conn, { prompt: '1girl', size: 'square' }, fakeFetch),
    ).rejects.toThrow('HTTP 500');
  });
});
