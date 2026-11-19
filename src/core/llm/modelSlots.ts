/**
 * Model slots + per-chat generation overrides (R04 / N02 / N03).
 *
 * RP-Hub keeps three model slots — quality / balanced / fast — that the chat
 * quick panel can switch between, and a model picker (search + family tags
 * with counts + three slot drafts). Rpnow previously had only
 * `settings.chat.fastModel` (used for post-reply suggestions) and a single
 * `chat.model`. This module is the shared, UI-free half of the feature:
 *
 *   - slot accessors over `settings.chat` (the three slots are global, like
 *     RP-Hub's `settings.qualityModel/balancedModel/fastModel`);
 *   - model-family tagging for the picker (RP-Hub's `popularModelFamilies`);
 *   - per-chat overrides stored in `chat.params` — temperature, reasoning
 *     effort, stream and immersive mode — each falling back to the global
 *     setting / preset when the chat has no override. Nothing here touches
 *     the DOM, so it is unit-tested directly.
 */

import type { RPAppSettings, RPChat } from '../types/chat.js';
import type { LLMConnection } from './types.js';
import { PROVIDERS } from './providers.js';

export type ModelSlotId = 'quality' | 'balanced' | 'fast';

export interface ModelSlotDef {
  id: ModelSlotId;
  /** 槽位序号（RP-Hub 快捷面板按 1/2/3 排）。 */
  index: number;
  label: string;
}

export const MODEL_SLOTS: ModelSlotDef[] = [
  { id: 'quality', index: 0, label: '优质' },
  { id: 'balanced', index: 1, label: '均衡' },
  { id: 'fast', index: 2, label: '快速' },
];

/** Model id stored in a slot; empty means the slot is not configured. */
export function slotModel(settings: RPAppSettings, slot: ModelSlotId): string {
  switch (slot) {
    case 'quality':
      return settings.chat.qualityModel?.trim() ?? '';
    case 'balanced':
      return settings.chat.balancedModel?.trim() ?? '';
    case 'fast':
      return settings.chat.fastModel?.trim() ?? '';
  }
}

/** All three slot models in quality/balanced/fast order. */
export function slotModels(settings: RPAppSettings): [string, string, string] {
  return [slotModel(settings, 'quality'), slotModel(settings, 'balanced'), slotModel(settings, 'fast')];
}

/** Which slot (if any) currently holds this model id. */
export function slotIdForModel(settings: RPAppSettings, model: string): ModelSlotId | undefined {
  const id = model.trim();
  if (!id) return undefined;
  return MODEL_SLOTS.find((s) => slotModel(settings, s.id) === id)?.id;
}

// ------------------------------------------------------------ picker lists

/**
 * Model families for the picker's category chips — RP-Hub's
 * `popularModelFamilies`, in the same order. Anything matching none of them
 * falls under `other`.
 */
export const MODEL_FAMILIES = ['claude', 'gemini', 'deepseek', 'llama', 'glm', 'moonshot', 'grok'] as const;

export type ModelFamily = (typeof MODEL_FAMILIES)[number] | 'other';

/** Family tag for one model id (case-insensitive substring match). */
export function modelFamily(modelId: string): ModelFamily {
  const id = modelId.toLowerCase();
  return MODEL_FAMILIES.find((f) => id.includes(f)) ?? 'other';
}

export interface ModelTag {
  /** `'all'` first, then the families that occur, `'other'` last. */
  name: 'all' | ModelFamily;
  count: number;
}

/** Category chips with counts, from the full model list. */
export function modelTags(models: string[]): ModelTag[] {
  const counts = new Map<ModelFamily, number>();
  for (const m of models) counts.set(modelFamily(m), (counts.get(modelFamily(m)) ?? 0) + 1);
  const tags: ModelTag[] = [{ name: 'all', count: models.length }];
  for (const f of MODEL_FAMILIES) {
    const c = counts.get(f);
    if (c) tags.push({ name: f, count: c });
  }
  const other = counts.get('other');
  if (other) tags.push({ name: 'other', count: other });
  return tags;
}

/** Search + family filter, sorted by id (RP-Hub's `filteredModels`). */
export function filterModels(models: string[], query: string, tag: ModelTag['name']): string[] {
  const q = query.trim().toLowerCase();
  return models
    .filter((m) => (tag === 'all' ? true : modelFamily(m) === tag))
    .filter((m) => (q ? m.toLowerCase().includes(q) : true))
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Seed list for the picker before the live `/models` call returns: the
 * current connection provider's known models, plus the chat's current model
 * and the three slot models so they are always pickable. The UI always
 * allows a free-text model id on top of this list.
 */
export function seedModels(connection: LLMConnection | undefined, extra: string[]): string[] {
  const provider = connection ? PROVIDERS.find((p) => p.key === connection.provider) : undefined;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of [...(provider?.models ?? []), ...extra]) {
    const id = m.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ------------------------------------------------------- reasoning effort

/**
 * Reasoning-effort slider steps (RP-Hub: 0–5 slider over the same six
 * values). `''` means "follow the global setting" when stored per chat.
 */
export const REASONING_EFFORT_OPTIONS = [
  { value: '', label: '跟随全局' },
  { value: 'none', label: '无' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' },
  { value: 'max', label: '极高' },
] as const;

export type ReasoningEffortValue = (typeof REASONING_EFFORT_OPTIONS)[number]['value'];

export function reasoningEffortIndex(value: string): number {
  const i = REASONING_EFFORT_OPTIONS.findIndex((o) => o.value === value);
  return i < 0 ? 0 : i;
}

// ------------------------------------------------- per-chat overrides
//
// Stored in `chat.params` so each chat keeps its own values; every accessor
// falls back to the global setting (or preset for temperature) when the chat
// has no override, exactly like the orchestrator already did for
// temperature (`ctx.chat.params?.temperature ?? ctx.preset.temperature`).

function chatParam(chat: RPChat, key: string): unknown {
  return chat.params?.[key];
}

/** Active slot for this chat, if its model came from a slot. */
export function chatModelSlot(chat: RPChat): ModelSlotId | undefined {
  const v = chatParam(chat, 'modelSlot');
  return v === 'quality' || v === 'balanced' || v === 'fast' ? v : undefined;
}

/** Per-chat temperature; falls back to the preset, then 0.9. */
export function chatTemperature(chat: RPChat, presetTemperature?: number): number {
  const raw = chatParam(chat, 'temperature');
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
  return presetTemperature ?? 0.9;
}

/** Whether this chat overrides the temperature (shows the reset affordance). */
export function hasChatTemperature(chat: RPChat): boolean {
  return chatParam(chat, 'temperature') !== undefined;
}

/** Per-chat reasoning effort; `''` (or missing) means the global setting. */
export function chatReasoningEffort(chat: RPChat, settings: RPAppSettings): ReasoningEffortValue {
  const raw = chatParam(chat, 'reasoningEffort');
  if (typeof raw === 'string' && raw !== '' && REASONING_EFFORT_OPTIONS.some((o) => o.value === raw)) {
    return raw as ReasoningEffortValue;
  }
  return settings.chat.reasoningEffort;
}

/** Whether this chat overrides the reasoning effort. */
export function hasChatReasoningEffort(chat: RPChat): boolean {
  const raw = chatParam(chat, 'reasoningEffort');
  return typeof raw === 'string' && raw !== '';
}

/** Per-chat stream toggle; falls back to the global `streamResponses`. */
export function chatStream(chat: RPChat, settings: RPAppSettings): boolean {
  const raw = chatParam(chat, 'stream');
  return typeof raw === 'boolean' ? raw : settings.chat.streamResponses;
}

/** Per-chat immersive-mode toggle; falls back to the global setting. */
export function chatImmersive(chat: RPChat, settings: RPAppSettings): boolean {
  const raw = chatParam(chat, 'immersiveMode');
  return typeof raw === 'boolean' ? raw : settings.render.immersiveMode;
}
