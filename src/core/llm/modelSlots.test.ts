import { describe, expect, it } from 'vitest';
import {
  MODEL_SLOTS,
  chatImmersive,
  chatReasoningEffort,
  chatStream,
  chatTemperature,
  filterModels,
  hasChatReasoningEffort,
  hasChatTemperature,
  modelFamily,
  modelTags,
  reasoningEffortIndex,
  seedModels,
  slotIdForModel,
  slotModel,
  slotModels,
} from './modelSlots.js';
import type { RPAppSettings, RPChat } from '../types/chat.js';
import { DEFAULT_SETTINGS } from '../types/chat.js';

function settingsWith(chat: Partial<RPAppSettings['chat']>): RPAppSettings {
  return { ...DEFAULT_SETTINGS, chat: { ...DEFAULT_SETTINGS.chat, ...chat } };
}

function chatWith(params?: Record<string, unknown>): RPChat {
  return {
    id: 'c1',
    title: 't',
    cardId: 'card',
    lorebookIds: [],
    useCardLorebook: false,
    messages: [],
    variables: {},
    createdAt: 0,
    updatedAt: 0,
    params,
  };
}

describe('model slots (N03)', () => {
  it('reads the three slots and reports unconfigured ones as empty', () => {
    const s = settingsWith({ qualityModel: 'claude-opus-4-5', fastModel: 'gpt-5-mini' });
    expect(slotModels(s)).toEqual(['claude-opus-4-5', '', 'gpt-5-mini']);
    expect(slotModel(s, 'balanced')).toBe('');
    expect(MODEL_SLOTS.map((m) => m.id)).toEqual(['quality', 'balanced', 'fast']);
  });

  it('finds which slot holds a model', () => {
    const s = settingsWith({ qualityModel: 'a', balancedModel: 'b', fastModel: 'c' });
    expect(slotIdForModel(s, 'b')).toBe('balanced');
    expect(slotIdForModel(s, 'nope')).toBeUndefined();
    expect(slotIdForModel(s, '')).toBeUndefined();
  });
});

describe('model picker lists (R04)', () => {
  it('tags families and counts them, all first and other last', () => {
    const tags = modelTags(['claude-opus-4-5', 'gpt-5', 'gemini-2.5-pro', 'deepseek-chat', 'foo-bar']);
    expect(tags[0]).toEqual({ name: 'all', count: 5 });
    expect(tags.find((t) => t.name === 'claude')).toEqual({ name: 'claude', count: 1 });
    expect(tags.find((t) => t.name === 'other')).toEqual({ name: 'other', count: 2 });
    expect(tags.at(-1)?.name).toBe('other');
  });

  it('modelFamily is case-insensitive and defaults to other', () => {
    expect(modelFamily('Claude-Sonnet-4')).toBe('claude');
    expect(modelFamily('GLM-4.6')).toBe('glm');
    expect(modelFamily('gpt-5')).toBe('other');
  });

  it('filterModels applies tag then search and sorts by id', () => {
    const models = ['gemini-2.5-pro', 'claude-opus-4-5', 'claude-sonnet-4-5', 'gpt-5'];
    expect(filterModels(models, '', 'claude')).toEqual(['claude-opus-4-5', 'claude-sonnet-4-5']);
    expect(filterModels(models, 'sonnet', 'all')).toEqual(['claude-sonnet-4-5']);
    expect(filterModels(models, 'GEMINI', 'all')).toEqual(['gemini-2.5-pro']);
    expect(filterModels(models, '', 'all')).toEqual([...models].sort());
  });

  it('seedModels merges provider models with current/slot models, deduped', () => {
    const conn = { id: 'x', name: 'n', provider: 'anthropic', baseURL: '', apiKey: '' };
    const seeds = seedModels(conn, ['custom-model', 'claude-opus-4-5']);
    expect(seeds).toContain('custom-model');
    expect(new Set(seeds).size).toBe(seeds.length);
    expect(seedModels(undefined, ['only-this'])).toEqual(['only-this']);
  });
});

describe('reasoning effort slider (N02)', () => {
  it('maps 0–5 to the six RP-Hub values', () => {
    expect(reasoningEffortIndex('')).toBe(0);
    expect(reasoningEffortIndex('medium')).toBe(3);
    expect(reasoningEffortIndex('max')).toBe(5);
    expect(reasoningEffortIndex('bogus')).toBe(0);
  });
});

describe('per-chat overrides (N02)', () => {
  it('temperature falls back to the preset, then 0.9', () => {
    expect(chatTemperature(chatWith(), 1.2)).toBe(1.2);
    expect(chatTemperature(chatWith(), undefined)).toBe(0.9);
    expect(chatTemperature(chatWith({ temperature: 0.5 }), 1.2)).toBe(0.5);
    expect(hasChatTemperature(chatWith({ temperature: 0.5 }))).toBe(true);
    expect(hasChatTemperature(chatWith())).toBe(false);
  });

  it('reasoning effort falls back to the global setting', () => {
    const s = settingsWith({ reasoningEffort: 'high' });
    expect(chatReasoningEffort(chatWith(), s)).toBe('high');
    expect(chatReasoningEffort(chatWith({ reasoningEffort: 'low' }), s)).toBe('low');
    // Empty string in params means "follow global", not "none".
    expect(chatReasoningEffort(chatWith({ reasoningEffort: '' }), s)).toBe('high');
    expect(hasChatReasoningEffort(chatWith({ reasoningEffort: 'low' }))).toBe(true);
    expect(hasChatReasoningEffort(chatWith({ reasoningEffort: '' }))).toBe(false);
  });

  it('stream and immersive fall back to the global switches', () => {
    const s = settingsWith({ streamResponses: false });
    const s2 = { ...s, render: { ...s.render, immersiveMode: true } };
    expect(chatStream(chatWith(), s)).toBe(false);
    expect(chatStream(chatWith({ stream: true }), s)).toBe(true);
    expect(chatImmersive(chatWith(), s2)).toBe(true);
    expect(chatImmersive(chatWith({ immersiveMode: false }), s2)).toBe(false);
  });
});
