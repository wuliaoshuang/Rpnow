/**
 * Preset types.
 *
 * RPNow imports the three preset families that circulate in the ecosystem and
 * that character cards commonly ship alongside:
 *
 *   1. Chat Completion presets (SillyTavern `openai` presets) — the *ordering*
 *      of the prompt, and the default text of each block.
 *   2. Context templates (Text Completion) — how a chat is flattened into one
 *      string.
 *   3. Instruct templates — how turns are wrapped for base/instruct models.
 *
 * Detection is shape-based ({@link detectPresetKind}) because preset files in
 * the wild carry no reliable type marker.
 */

import type { RPDepthPrompt } from './card.js';

/** Which prompt block a preset entry corresponds to. */
export type PromptIdentifier =
  | 'main'
  | 'nsfw'
  | 'worldInfoBefore'
  | 'worldInfoAfter'
  | 'charDescription'
  | 'charPersonality'
  | 'scenario'
  | 'personaDescription'
  | 'dialogueExamples'
  | 'chatHistory'
  | 'jailbreak'
  | 'enhanceDefinitions'
  | (string & {});

/**
 * One row of a Chat Completion preset's `prompts[]`.
 *
 * `marker: true` entries are *slots* the app fills at render time (chat history,
 * world info, etc.); entries with `content` are literal text. `injection_position`
 * 0 = relative to chat start, 1 = relative to chat end, paired with `injection_depth`
 * (SillyTavern's "In-Chat / depth" injection).
 */
export interface RPPromptEntry {
  identifier: PromptIdentifier;
  name: string;
  system_prompt: boolean;
  role: 'system' | 'user' | 'assistant';
  content?: string;
  marker?: boolean;
  injection_position?: number;
  injection_depth?: number;
  injection_order?: number;
  forbid_overrides?: boolean;
  /** Set true by RPNow when the user disables a block. */
  enabled?: boolean;
  [key: string]: unknown;
}

export interface RPPromptOrderGroup {
  character_id: number;
  order: Array<{ identifier: PromptIdentifier; enabled: boolean }>;
}

/** Chat Completion preset: the payload RPNow's prompt builder consumes. */
export interface RPCompletionPreset {
  /** RPNow id. */
  id?: string;
  name: string;
  /** Preset ordering is per chat-mode; 100000 = normal chat, 100001 = group chat. */
  prompts: RPPromptEntry[];
  prompt_order: RPPromptOrderGroup[];
  /** Generation parameters. */
  temperature?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  top_p?: number;
  top_k?: number;
  repetition_penalty?: number;
  min_p?: number;
  top_a?: number;
  max_context?: number;
  max_tokens?: number;
  seed?: number;
  /** Wrapping formats used when injecting card fields. */
  wi_format?: string;
  scenario_format?: string;
  personality_format?: string;
  /** Nudge prompts. */
  new_chat_prompt?: string;
  new_group_chat_prompt?: string;
  new_example_chat_prompt?: string;
  continue_nudge_prompt?: string;
  group_nudge_prompt?: string;
  impersonation_prompt?: string;
  /** Streaming / behaviour toggles. */
  stream?: boolean;
  squash_system_messages?: boolean;
  use_sysprompt?: boolean;
  assistant_prefill?: string;
  /** Everything else, preserved verbatim. */
  raw?: Record<string, unknown>;
  /**
   * SillyTavern 预设的 `extensions` 命名空间，**原样保留、不白名单**。
   *
   * 它不是附带数据：插件靠它拿到预设上下文（`extensions.regex_scripts`、
   * `extensions.tavern_helper.scripts`、`SPreset.*` …）。见
   * docs/research/st-plugin-preset-coupling.md §2.5/§2.13 与
   * docs/research/rpnow-st-compat-contract.md 通道 1。
   */
  extensions?: Record<string, unknown>;
  sourceFormat?: PresetSourceFormat;
  createdAt?: number;
  updatedAt?: number;
}

/** Text Completion context template — flattens a chat into one string. */
export interface RPContextTemplate {
  id?: string;
  name: string;
  story_string: string;
  chat_start: string;
  example_separator: string;
  use_stop_strings?: boolean;
  names_as_stop_strings?: boolean;
  story_string_position?: number;
  story_string_depth?: number;
  story_string_role?: number;
  always_force_name2?: boolean;
  trim_sentences?: boolean;
  raw?: Record<string, unknown>;
  /**
   * SillyTavern 预设的 `extensions` 命名空间，**原样保留、不白名单**。
   *
   * 它不是附带数据：插件靠它拿到预设上下文（`extensions.regex_scripts`、
   * `extensions.tavern_helper.scripts`、`SPreset.*` …）。见
   * docs/research/st-plugin-preset-coupling.md §2.5/§2.13 与
   * docs/research/rpnow-st-compat-contract.md 通道 1。
   */
  extensions?: Record<string, unknown>;
  sourceFormat?: PresetSourceFormat;
  createdAt?: number;
  updatedAt?: number;
}

/** Instruct template — wraps user/assistant turns for instruct models. */
export interface RPInstructTemplate {
  id?: string;
  name: string;
  input_sequence: string;
  output_sequence: string;
  last_output_sequence?: string;
  system_sequence: string;
  stop_sequence: string;
  wrap: boolean;
  macro: boolean;
  names_behavior?: number;
  activation_regex?: string;
  first_output_sequence?: string;
  skip_examples?: boolean;
  system_same_as_user?: boolean;
  raw?: Record<string, unknown>;
  /**
   * SillyTavern 预设的 `extensions` 命名空间，**原样保留、不白名单**。
   *
   * 它不是附带数据：插件靠它拿到预设上下文（`extensions.regex_scripts`、
   * `extensions.tavern_helper.scripts`、`SPreset.*` …）。见
   * docs/research/st-plugin-preset-coupling.md §2.5/§2.13 与
   * docs/research/rpnow-st-compat-contract.md 通道 1。
   */
  extensions?: Record<string, unknown>;
  sourceFormat?: PresetSourceFormat;
  createdAt?: number;
  updatedAt?: number;
}

/** Reasoning / thinking preset (DeepSeek, Harmony, Think XML, ...). */
export interface RPReasoningTemplate {
  id?: string;
  name: string;
  prefix: string;
  suffix: string;
  separator?: string;
  suffix_parsed?: string;
  /** ST `extensions` 命名空间，原样保留（同 Completion/Context/Instruct）。 */
  extensions?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  createdAt?: number;
  updatedAt?: number;
}

export type PresetKind =
  | 'completion'
  | 'context'
  | 'instruct'
  | 'reasoning'
  | 'unknown';

export type PresetSourceFormat =
  | 'sillytavern-openai'
  | 'sillytavern-text'
  | 'sillytavern-context'
  | 'sillytavern-instruct'
  | 'sillytavern-reasoning'
  | 'rpnow'
  | 'unknown';

/**
 * A bundle shipped by a character card (`data.extensions.rpnow_bundle`), or by
 * an `.rpnx` plugin, that carries a preset + worldbook + regex scripts together.
 */
export interface RPPresetBundle {
  preset?: RPCompletionPreset;
  contextTemplate?: RPContextTemplate;
  instructTemplate?: RPInstructTemplate;
  reasoning?: RPReasoningTemplate;
  worldbook?: import('./lorebook.js').RPLorebook;
  regexScripts?: import('./card.js').RPRegexScript[];
  depthPrompt?: RPDepthPrompt;
}

/**
 * Detect which preset family a parsed JSON document belongs to.
 *
 * Order matters: context and instruct templates both contain `name`, so the
 * discriminating keys are tested before the generic fallback.
 */
export function detectPresetKind(doc: unknown): PresetKind {
  if (!doc || typeof doc !== 'object') return 'unknown';
  const d = doc as Record<string, unknown>;
  if (Array.isArray(d.prompts) || Array.isArray(d.prompt_order)) return 'completion';
  if (typeof d.story_string === 'string' && typeof d.chat_start === 'string') return 'context';
  if (typeof d.input_sequence === 'string' && typeof d.output_sequence === 'string') {
    return 'instruct';
  }
  if (typeof d.prefix === 'string' && typeof d.suffix === 'string') return 'reasoning';
  return 'unknown';
}
