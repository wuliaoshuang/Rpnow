/**
 * studioDraft — the ImageStudio's input state, persisted per chat.
 *
 * Every input in the studio (description, positive prompt, artist string,
 * negative prompt, size, connection, model, and the generation parameters)
 * is kept here so it survives closing the studio and reloading the app.
 * The artist string is never auto-filled — it starts empty and only holds
 * what the user typed.
 *
 * Stored in localStorage (small text, synchronous, no IndexedDB round-trip)
 * under one key per chat, so each chat keeps its own inputs.
 */
import type { ImageStudioParams } from './types.js';

export interface ImageStudioDraft extends ImageStudioParams {
  prompt: string;
  positive: string;
  artist: string;
  negative: string;
  size: 'portrait' | 'square' | 'landscape';
  connectionId: string;
  model: string;
}

const KEY_PREFIX = 'rpnow:image-studio-draft:';

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadStudioDraft(chatId: string): ImageStudioDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(KEY_PREFIX + chatId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ImageStudioDraft>;
    const size = parsed.size === 'square' || parsed.size === 'landscape' ? parsed.size : 'portrait';
    return {
      prompt: typeof parsed.prompt === 'string' ? parsed.prompt : '',
      positive: typeof parsed.positive === 'string' ? parsed.positive : '',
      artist: typeof parsed.artist === 'string' ? parsed.artist : '',
      negative: typeof parsed.negative === 'string' ? parsed.negative : '',
      size,
      connectionId: typeof parsed.connectionId === 'string' ? parsed.connectionId : '',
      model: typeof parsed.model === 'string' ? parsed.model : '',
      steps: typeof parsed.steps === 'number' && Number.isFinite(parsed.steps) ? parsed.steps : undefined,
      scale: typeof parsed.scale === 'number' && Number.isFinite(parsed.scale) ? parsed.scale : undefined,
      sampler: typeof parsed.sampler === 'string' ? parsed.sampler : undefined,
      seed: typeof parsed.seed === 'number' && Number.isFinite(parsed.seed) ? parsed.seed : undefined,
      noiseSchedule: typeof parsed.noiseSchedule === 'string' ? parsed.noiseSchedule : undefined,
      nSamples: typeof parsed.nSamples === 'number' && Number.isFinite(parsed.nSamples) ? parsed.nSamples : undefined,
      ucPreset: typeof parsed.ucPreset === 'number' && Number.isFinite(parsed.ucPreset) ? parsed.ucPreset : undefined,
      cfgRescale:
        typeof parsed.cfgRescale === 'number' && Number.isFinite(parsed.cfgRescale) ? parsed.cfgRescale : undefined,
      variety: typeof parsed.variety === 'boolean' ? parsed.variety : undefined,
      transparentBg: typeof parsed.transparentBg === 'boolean' ? parsed.transparentBg : undefined,
      qualityToggle: typeof parsed.qualityToggle === 'boolean' ? parsed.qualityToggle : undefined,
    };
  } catch {
    return null;
  }
}

export function saveStudioDraft(chatId: string, draft: ImageStudioDraft): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(KEY_PREFIX + chatId, JSON.stringify(draft));
  } catch {
    /* storage full or unavailable — the draft just won't survive */
  }
}
