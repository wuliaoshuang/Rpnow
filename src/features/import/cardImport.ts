/**
 * Card import.
 *
 * A single entry point that accepts anything the user drops: PNG, JSON, YAML,
 * CharX/BYAF archives, plus multi-file drops and multi-card JSON arrays.
 * Import results report per-file outcomes so a partial failure is visible
 * instead of silently losing files.
 */

import { parseCardFile, parseLorebookFile } from '@/core/card/parser.js';
import { detectPresetKind } from '@/core/types/preset.js';
import type { RPCard } from '@/core/types/card.js';
import type { RPLorebook } from '@/core/types/lorebook.js';
import type {
  RPCompletionPreset,
  RPContextTemplate,
  RPInstructTemplate,
  RPReasoningTemplate,
} from '@/core/types/preset.js';

export interface ImportOutcome {
  file: string;
  kind: 'card' | 'lorebook' | 'preset' | 'unknown' | 'error';
  name?: string;
  message?: string;
  warnings?: string[];
}

export interface ImportResult {
  cards: RPCard[];
  lorebooks: RPLorebook[];
  presets: RPCompletionPreset[];
  contextTemplates: RPContextTemplate[];
  instructTemplates: RPInstructTemplate[];
  reasoningTemplates: RPReasoningTemplate[];
  outcomes: ImportOutcome[];
}

/** Turn a parsed preset JSON document into the right typed record. */
export function normalizePreset(
  doc: Record<string, unknown>,
  fallbackName: string,
): { preset?: RPCompletionPreset; context?: RPContextTemplate; instruct?: RPInstructTemplate; reasoning?: RPReasoningTemplate } {
  const kind = detectPresetKind(doc);
  const name = typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : fallbackName;
  const id = `preset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

  switch (kind) {
    case 'completion':
      return {
        preset: applyCompletionRepairs({
          id,
          name,
          prompts: (doc.prompts as RPCompletionPreset['prompts']) ?? [],
          prompt_order: (doc.prompt_order as RPCompletionPreset['prompt_order']) ?? [],
          temperature: num(doc.temperature),
          frequency_penalty: num(doc.frequency_penalty),
          presence_penalty: num(doc.presence_penalty),
          top_p: num(doc.top_p),
          top_k: num(doc.top_k),
          repetition_penalty: num(doc.repetition_penalty),
          min_p: num(doc.min_p),
          top_a: num(doc.top_a),
          max_context: num(doc.openai_max_context) ?? num(doc.max_context),
          max_tokens: num(doc.openai_max_tokens) ?? num(doc.max_tokens),
          seed: num(doc.seed),
          wi_format: str(doc.wi_format),
          scenario_format: str(doc.scenario_format),
          personality_format: str(doc.personality_format),
          new_chat_prompt: str(doc.new_chat_prompt),
          new_group_chat_prompt: str(doc.new_group_chat_prompt),
          continue_nudge_prompt: str(doc.continue_nudge_prompt),
          group_nudge_prompt: str(doc.group_nudge_prompt),
          impersonation_prompt: str(doc.impersonation_prompt),
          assistant_prefill: str(doc.assistant_prefill),
          stream: typeof doc.stream_openai === 'boolean' ? doc.stream_openai : undefined,
          squash_system_messages: Boolean(doc.squash_system_messages),
          use_sysprompt: Boolean(doc.use_sysprompt),
          raw: doc,
          /*
           * ST 预设的 `extensions` 命名空间必须**原样保真**：插件（酒馆助手）
           * 直接读它拿预设脚本与正则。曾经它只在 `raw` 里隐式存在、无人消费。
           */
          extensions: asRecord(doc.extensions),
          sourceFormat: 'sillytavern-openai',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
      };
    case 'context':
      return {
        context: {
          id,
          name,
          story_string: String(doc.story_string ?? ''),
          chat_start: String(doc.chat_start ?? ''),
          example_separator: String(doc.example_separator ?? '<START>'),
          use_stop_strings: doc.use_stop_strings as boolean | undefined,
          names_as_stop_strings: doc.names_as_stop_strings as boolean | undefined,
          story_string_position: num(doc.story_string_position),
          story_string_depth: num(doc.story_string_depth),
          story_string_role: num(doc.story_string_role),
          raw: doc,
          /*
           * ST 预设的 `extensions` 命名空间必须**原样保真**：插件（酒馆助手）
           * 直接读它拿预设脚本与正则。曾经它只在 `raw` 里隐式存在、无人消费。
           */
          extensions: asRecord(doc.extensions),
          sourceFormat: 'sillytavern-context',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    case 'instruct':
      return {
        instruct: {
          id,
          name,
          input_sequence: String(doc.input_sequence ?? ''),
          output_sequence: String(doc.output_sequence ?? ''),
          last_output_sequence: str(doc.last_output_sequence),
          system_sequence: String(doc.system_sequence ?? ''),
          stop_sequence: String(doc.stop_sequence ?? ''),
          wrap: Boolean(doc.wrap),
          macro: Boolean(doc.macro),
          names_behavior: num(doc.names_behavior),
          activation_regex: str(doc.activation_regex),
          first_output_sequence: str(doc.first_output_sequence),
          skip_examples: Boolean(doc.skip_examples),
          system_same_as_user: Boolean(doc.system_same_as_user),
          raw: doc,
          /*
           * ST 预设的 `extensions` 命名空间必须**原样保真**：插件（酒馆助手）
           * 直接读它拿预设脚本与正则。曾经它只在 `raw` 里隐式存在、无人消费。
           */
          extensions: asRecord(doc.extensions),
          sourceFormat: 'sillytavern-instruct',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    case 'reasoning':
      return {
        reasoning: {
          id,
          name,
          prefix: String(doc.prefix ?? ''),
          suffix: String(doc.suffix ?? ''),
          separator: str(doc.separator),
          raw: doc,
          /*
           * ST 预设的 `extensions` 命名空间必须**原样保真**：插件（酒馆助手）
           * 直接读它拿预设脚本与正则。曾经它只在 `raw` 里隐式存在、无人消费。
           */
          extensions: asRecord(doc.extensions),
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      };
    default:
      return {};
  }
}

/**
 * Replicate the repair rules a preset needs to load correctly.
 *
 * Imported presets routinely reference blocks they do not define (orphans) or
 * omit blocks the renderer expects. Left unrepaired they render as gaps.
 */
export function applyCompletionRepairs(preset: RPCompletionPreset): RPCompletionPreset {
  const prompts = [...(preset.prompts ?? [])];
  const known = new Set(prompts.map((p) => p.identifier));

  // Drop order rows whose identifier has no prompt entry (orphans).
  let order = preset.prompt_order ?? [];
  order = order.map((group) => ({
    ...group,
    order: group.order.filter((row) => known.has(row.identifier)),
  }));

  // Persist blocks the order forgets so they are not silently unreachable.
  for (const group of order) {
    const inOrder = new Set(group.order.map((r) => r.identifier));
    for (const p of prompts) {
      if (!inOrder.has(p.identifier)) group.order.push({ identifier: p.identifier, enabled: p.enabled !== false });
    }
  }

  // If nothing was defined at all, fall back to a minimal usable order.
  if (!order.length) {
    order = [
      {
        character_id: 100001,
        order: prompts.map((p) => ({ identifier: p.identifier, enabled: p.enabled !== false })),
      },
    ];
  }

  return { ...preset, prompts, prompt_order: order };
}

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
/**
 * Coerce to a plain record, or `undefined`.
 *
 * ST preset `extensions` is an open namespace: any key may appear (today
 * `regex_scripts` / `tavern_helper` / `SPreset`, tomorrow something else), so
 * it is carried through **verbatim** rather than field-filtered. Plugins read
 * it directly (`docs/research/st-plugin-preset-coupling.md` §2.13 D5).
 */
function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  return v as Record<string, unknown>;
}

/** Import an arbitrary list of files. */
export async function importFiles(files: File[]): Promise<ImportResult> {
  const result: ImportResult = {
    cards: [],
    lorebooks: [],
    presets: [],
    contextTemplates: [],
    instructTemplates: [],
    reasoningTemplates: [],
    outcomes: [],
  };

  for (const file of files) {
    try {
      const lower = file.name.toLowerCase();
      // JSON/YAML need shape sniffing to decide card vs lorebook vs preset.
      if (/\.(json|yaml|yml)$/.test(lower) || file.type.includes('json')) {
        const parsed = await tryParseStructured(file);
        if (parsed) {
          if ('preset' in parsed || 'context' in parsed || 'instruct' in parsed || 'reasoning' in parsed) {
            if (parsed.preset) result.presets.push(parsed.preset);
            if (parsed.context) result.contextTemplates.push(parsed.context);
            if (parsed.instruct) result.instructTemplates.push(parsed.instruct);
            if (parsed.reasoning) result.reasoningTemplates.push(parsed.reasoning);
            result.outcomes.push({
              file: file.name,
              kind: 'preset',
              name: parsed.preset?.name ?? parsed.context?.name ?? parsed.instruct?.name ?? parsed.reasoning?.name,
            });
            continue;
          }
          if (parsed.lorebook) {
            result.lorebooks.push(parsed.lorebook);
            result.outcomes.push({ file: file.name, kind: 'lorebook', name: parsed.lorebook.name });
            continue;
          }
          if (parsed.cards?.length) {
            result.cards.push(...parsed.cards);
            for (const c of parsed.cards) {
              result.outcomes.push({
                file: file.name,
                kind: 'card',
                name: c.data.name,
                warnings: parsed.warnings,
              });
            }
            continue;
          }
        }
      }

      const parsed = await parseCardFile(file, file.name);
      result.cards.push(parsed.card);
      result.outcomes.push({ file: file.name, kind: 'card', name: parsed.card.data.name, warnings: parsed.warnings });
    } catch (err) {
      result.outcomes.push({
        file: file.name,
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return result;
}

interface StructuredParse {
  cards?: RPCard[];
  lorebook?: RPLorebook;
  preset?: RPCompletionPreset;
  context?: RPContextTemplate;
  instruct?: RPInstructTemplate;
  reasoning?: RPReasoningTemplate;
  warnings?: string[];
}

/** Decide what a structured document is, without guessing from the filename. */
async function tryParseStructured(file: File): Promise<StructuredParse | null> {
  const text = await file.text();
  let doc: unknown;
  if (/\.(yaml|yml)$/i.test(file.name)) {
    const yaml = await import('yaml');
    try {
      doc = yaml.parse(text);
    } catch {
      return null;
    }
  } else {
    try {
      doc = JSON.parse(text);
    } catch {
      // Could still be a YAML card with a .json extension; try that too.
      try {
        const yaml = await import('yaml');
        doc = yaml.parse(text);
      } catch {
        return null;
      }
    }
  }
  if (!doc || typeof doc !== 'object') return null;
  const rec = doc as Record<string, unknown>;

  // Preset families are structurally distinct.
  if (detectPresetKind(rec) !== 'unknown') {
    const base = file.name.replace(/\.[^.]+$/, '');
    return normalizePreset(rec, base);
  }

  // A world book has `entries` and no card identity fields.
  const looksLikeCard = 'spec' in rec || 'first_mes' in rec || ('name' in rec && 'description' in rec && !('entries' in rec));
  if (!looksLikeCard && ('entries' in rec || 'originalData' in rec)) {
    return { lorebook: parseLorebookFile(rec) };
  }

  if (looksLikeCard) {
    const parsed = await parseCardFile(new Blob([text], { type: 'application/json' }), file.name);
    return { cards: [parsed.card], warnings: parsed.warnings };
  }

  return null;
}
