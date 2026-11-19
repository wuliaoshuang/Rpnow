/**
 * Sub-model UI template analysis (J06/J07).
 *
 * When `settings.uiTemplate.mainModelAnalysis` is false, the main model is
 * NOT asked to emit `<ui_template_updates>` (ChatView withholds the templates
 * from the orchestrator context). Instead, after each turn completes, this
 * module asks a separate analysis model to read the most recent
 * `analysisDepth` floors and emit one update block per template — the same
 * `<ui_template_updates>` JSON the main-model path parses, so validation,
 * change-logging and rendering are shared (`engine.parseUpdates` /
 * `validateVariables` / `diffVariables`).
 *
 * RP-Hub behaviour this mirrors: sub-model, temperature 0.4, non-streaming,
 * recent 4–10 floors, optional variable-snapshot injection (`injectContext`).
 * Runs best-effort in the background: a failed or empty analysis never
 * touches the reply the user is already reading.
 */

import type { RPChatMessage } from '../types/chat.js';
import type { LLMMessage, LLMService } from '../llm/types.js';
import { parseUpdates, type TemplateUpdate } from './engine.js';
import type { RPUITemplate } from './types.js';

/** RP-Hub's sub-model analysis depth range; the settings slider is 4–10. */
export const ANALYSIS_DEPTH_MIN = 4;
export const ANALYSIS_DEPTH_MAX = 10;

/** Clamp a depth into the supported range (settings stored before the slider existed may be out of range). */
export function clampAnalysisDepth(depth: number): number {
  if (!Number.isFinite(depth)) return ANALYSIS_DEPTH_MIN;
  return Math.min(ANALYSIS_DEPTH_MAX, Math.max(ANALYSIS_DEPTH_MIN, Math.floor(depth)));
}

export interface AnalysisPromptInput {
  template: RPUITemplate;
  /** Full transcript; only the newest `depth` floors are sent. */
  messages: RPChatMessage[];
  /** How many recent floors to analyse (clamped to 4–10). */
  depth: number;
  /** Include the current variable snapshot in the prompt. */
  injectContext: boolean;
  personaName?: string;
  characterName?: string;
}

function speakerOf(m: RPChatMessage, personaName: string, characterName: string): string {
  if (m.role === 'user') return m.speaker || personaName;
  if (m.role === 'assistant') return m.speaker || characterName;
  return '系统';
}

/**
 * Build the messages for one template's analysis call.
 *
 * The model must answer with ONLY a `<ui_template_updates>` block containing
 * this template's id and the variables that actually changed. Nothing changed
 * → an empty array, so the caller can tell "analysed, no change" apart from
 * "the model ignored the format" (no block at all).
 */
export function buildAnalysisMessages(input: AnalysisPromptInput): LLMMessage[] {
  const { template, depth, injectContext } = input;
  const personaName = input.personaName || '用户';
  const characterName = input.characterName || '角色';
  const recent = input.messages
    .filter((m) => m.role !== 'system' || !m.hidden)
    .slice(-clampAnalysisDepth(depth));
  const transcript = recent
    .map((m) => `${speakerOf(m, personaName, characterName)}：${m.content}`)
    .join('\n\n');
  const allowedKeys = [
    ...Object.keys(template.initialVariableState),
    ...Object.keys(template.variableSchema),
  ];
  const lines = [
    '你是 UI 模板的状态分析员。只根据下面最近的对话内容，判断模板变量有哪些确实发生了变化。',
    `模板「${template.name}」（id：${template.id}）。`,
    `允许更新的变量：${allowedKeys.length ? allowedKeys.join('、') : '（无，模板没有声明任何变量）'}。不要编造未声明的变量名；不要输出与当前状态相同的值。`,
  ];
  if (injectContext) {
    lines.push(`当前变量快照：${JSON.stringify(template.variableState)}`);
  }
  if (template.variableSchema && Object.keys(template.variableSchema).length) {
    lines.push(`变量类型声明：${JSON.stringify(template.variableSchema)}`);
  }
  lines.push(
    '只输出一个 <ui_template_updates> 代码块，内容为 JSON 数组，每项为 {"id":"模板id","variables":{…}}；没有任何变化时输出空数组 []。不要输出任何解释、正文或其他文字。',
    '',
    '最近对话：',
    transcript || '（暂无对话内容）',
  );
  return [{ role: 'system', content: lines.join('\n') }];
}

export interface AnalyseTemplateInput {
  /** Minimal LLM surface — `complete` is all the analysis needs. */
  llm: Pick<LLMService, 'complete'>;
  connectionId: string;
  /** Analysis model; empty means "use the connection's default model". */
  model: string;
  /** Fallback model name (the chat's model) when `model` is empty. */
  fallbackModel?: string;
  template: RPUITemplate;
  messages: RPChatMessage[];
  depth: number;
  injectContext: boolean;
  personaName?: string;
  characterName?: string;
}

/**
 * Analyse one template with the sub-model and return its parsed updates
 * (empty when the model reported no change). Throws when the LLM call fails
 * — the caller treats that as best-effort and keeps the old state.
 */
export async function analyseTemplate(input: AnalyseTemplateInput): Promise<TemplateUpdate[]> {
  const messages = buildAnalysisMessages({
    template: input.template,
    messages: input.messages,
    depth: input.depth,
    injectContext: input.injectContext,
    personaName: input.personaName,
    characterName: input.characterName,
  });
  const res = await input.llm.complete(input.connectionId, {
    model: input.model || input.fallbackModel || '',
    messages,
    temperature: 0.4,
    maxTokens: 800,
  });
  const updates = parseUpdates(res.text ?? '');
  if (!updates) return [];
  // Only this template's block counts here; other ids belong to other calls.
  return updates.filter((u) => u.id === input.template.id);
}

export interface AnalyseTemplatesInput extends Omit<AnalyseTemplateInput, 'template'> {
  templates: RPUITemplate[];
}

/**
 * Analyse every template in turn (sequential — the calls share one
 * connection and the states are independent, so there is nothing to gain
 * from parallel calls that could interleave saves).
 */
export async function analyseTemplates(input: AnalyseTemplatesInput): Promise<TemplateUpdate[]> {
  const out: TemplateUpdate[] = [];
  for (const template of input.templates) {
    const updates = await analyseTemplate({ ...input, template });
    out.push(...updates);
  }
  return out;
}
