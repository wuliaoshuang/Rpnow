import { describe, expect, it, beforeEach } from 'vitest';
import { loadStudioDraft, saveStudioDraft } from './studioDraft.js';

function makeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

describe('studioDraft', () => {
  beforeEach(() => {
    (globalThis as unknown as { localStorage: Storage }).localStorage = makeStorage();
  });

  it('round-trips every field, including the generation parameters', () => {
    saveStudioDraft('chat1', {
      prompt: '夜里 doro 在雪山上。',
      positive: '1girl, snow',
      artist: '1.1::tianlianghe::',
      negative: 'lowres',
      size: 'landscape',
      connectionId: 'img-nai-1',
      model: 'nai-diffusion-5-full',
      steps: 32,
      scale: 7.5,
      sampler: 'k_dpmpp_2m',
      seed: 12345,
      noiseSchedule: 'exponential',
      nSamples: 2,
      ucPreset: 1,
      cfgRescale: 0.5,
      variety: true,
      transparentBg: true,
      qualityToggle: false,
    });
    const loaded = loadStudioDraft('chat1');
    expect(loaded?.prompt).toBe('夜里 doro 在雪山上。');
    expect(loaded?.positive).toBe('1girl, snow');
    expect(loaded?.artist).toBe('1.1::tianlianghe::');
    expect(loaded?.size).toBe('landscape');
    expect(loaded?.steps).toBe(32);
    expect(loaded?.scale).toBe(7.5);
    expect(loaded?.sampler).toBe('k_dpmpp_2m');
    expect(loaded?.seed).toBe(12345);
    expect(loaded?.noiseSchedule).toBe('exponential');
    expect(loaded?.nSamples).toBe(2);
    expect(loaded?.ucPreset).toBe(1);
    expect(loaded?.cfgRescale).toBe(0.5);
    expect(loaded?.variety).toBe(true);
    expect(loaded?.transparentBg).toBe(true);
    expect(loaded?.qualityToggle).toBe(false);
  });

  it('is per-chat: another chat sees nothing', () => {
    saveStudioDraft('chat1', {
      prompt: 'a',
      positive: 'b',
      artist: '',
      negative: '',
      size: 'portrait',
      connectionId: '',
      model: '',
    });
    expect(loadStudioDraft('chat2')).toBeNull();
  });

  it('returns null for a corrupt entry instead of throwing', () => {
    localStorage.setItem('rpnow:image-studio-draft:chat9', '{not json');
    expect(loadStudioDraft('chat9')).toBeNull();
  });
});
