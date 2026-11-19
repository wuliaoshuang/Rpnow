/**
 * Agent loop service contract.
 *
 * The loop is a *service*, not a hard-coded function, because the loop is the
 * most opinionated part of a roleplay app: some users want a single completion,
 * some want tool-calling agents (search, dice, memory writes), some want a
 * multi-stage "director" that plans then narrates. All three are loop
 * implementations that a plugin can provide.
 *
 * The default loop (below, in `defaultLoop.ts`) does exactly one thing well:
 * build the prompt, stream the reply, persist it, run post-processing.
 */

import type { LLMRequest, LLMStreamEvent } from '../llm/types.js';

export interface AgentContext {
  /** The assembled prompt messages, already macro-substituted. */
  messages: import('../llm/types.js').LLMMessage[];
  /** Chat-level knobs. */
  temperature?: number;
  maxTokens?: number;
  /** Tools the current character/plugins expose. */
  tools?: import('../llm/types.js').LLMToolDef[];
  /**
   * Stream the reply. Defaults to true; the settings toggle exists because a
   * few providers behave better with a single non-streamed response.
   */
  stream?: boolean;
  /**
   * Stop after the first tool result instead of feeding it back for another
   * round. Used by Gemini anti-truncation, where the tool *is* the reply.
   */
  stopOnToolResult?: boolean;
  /** Arbitrary state a plugin wants to carry through the loop. */
  state?: Record<string, unknown>;
}

export interface AgentRunOptions {
  connectionId: string;
  model: string;
  context: AgentContext;
  signal?: AbortSignal;
  /** Extra sampler params from the preset. */
  params?: Partial<LLMRequest>;
  /** Invoked for every upstream event, so UI can render partial output. */
  onEvent?: (ev: LLMStreamEvent) => void;
  /** Executes a tool call; the loop decides when to call it. */
  executeTool?: (name: string, args: unknown) => Promise<unknown>;
}

export interface AgentResult {
  text: string;
  reasoning?: string;
  /** Number of upstream model round-trips the loop performed. */
  steps: number;
  usage?: { inputTokens?: number; outputTokens?: number; cachedTokens?: number; reasoningTokens?: number };
  toolTrace?: Array<{ name: string; args: unknown; result: unknown }>;
}

export interface AgentLoop {
  /** Display name for the loop picker. */
  readonly label: string;
  run(opts: AgentRunOptions, llm: import('../llm/types.js').LLMService): Promise<AgentResult>;
}

export interface RendererService {
  /**
   * Render one message body to sanitized HTML.
   * Implementations must sanitize; returning raw model output is a bug.
   */
  render(markdown: string, opts?: RendererOptions): string;
}

export interface RendererOptions {
  /** Card regex scripts already applied? */
  regexApplied?: boolean;
  /** Allow remote media (defaults to false, like ST's forbid_external_media). */
  allowExternalMedia?: boolean;
  /** Scope prefix for `<style>` selectors, e.g. `.mes-body`. */
  styleScope?: string;
  /**
   * Render whole-HTML messages and ```html fences into a sandboxed iframe
   * instead of inline. Off by default: it is the card-author opt-in that lets a
   * card ship interactive HTML panels.
   */
  sandboxHtml?: boolean;
}

export interface ThemeService {
  /** Active theme id. */
  readonly id: string;
  /** CSS custom properties for the active theme. */
  tokens(): Record<string, string>;
  /** Raw CSS contributed by the theme (already scoped by the installer). */
  css(): string;
  /** Switch to another registered theme by id. */
  activate(id: string): void;
  /** Available themes. */
  list(): Array<{ id: string; label: string; description?: string }>;
}

export interface SettingsService {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
  subscribe(key: string, handler: (value: unknown) => void): () => void;
  getPluginConfig(pluginId: string): Record<string, unknown>;
  setPluginConfig(pluginId: string, value: Record<string, unknown>): Promise<void>;
}

export interface StorageService {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
  clear(): Promise<void>;
}
