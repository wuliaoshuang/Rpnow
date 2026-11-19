/**
 * LLM service contract.
 *
 * Every provider — OpenAI, Anthropic, Gemini, a local Ollama, or a user's custom
 * endpoint — is normalised to ONE streaming primitive so the agent loop never
 * contains provider branching:
 *
 *   for await (const ev of llm.stream(req)) { ... }
 *
 * The service itself is provided by plugins, which is what makes "add a provider"
 * and "replace the transport entirely" the same operation.
 */

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface LLMMessage {
  role: ChatRole;
  content: string;
  /** User-attached pictures (data URLs), sent as multimodal content. */
  imageUrls?: string[];
  /** Tool call id for `role: 'tool'` results. */
  toolCallId?: string;
  /** For assistant messages that requested tools. */
  toolCalls?: LLMToolCall[];
  /** Optional name (multi-character chats). */
  name?: string;
}

export interface LLMToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface LLMToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  repetitionPenalty?: number;
  minP?: number;
  topA?: number;
  stop?: string[];
  seed?: number;
  stream?: boolean;
  tools?: LLMToolDef[];
  /** `required` forces at least one call; `auto` lets the model decide. */
  toolChoice?: 'auto' | 'required' | 'none';
  /** Provider-specific passthrough (e.g. reasoning effort, thinking budget). */
  extra?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type LLMStreamEvent =
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'tool_call'; call: LLMToolCall }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; cachedTokens?: number; reasoningTokens?: number }
  | { type: 'finish'; reason: string }
  | { type: 'error'; message: string };

export interface LLMResult {
  text: string;
  reasoning?: string;
  toolCalls: LLMToolCall[];
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; cachedTokens?: number; reasoningTokens?: number };
}

/** A connection = provider kind + endpoint + credential + defaults. */
export interface LLMConnection {
  id: string;
  name: string;
  /** Registered provider adapter key, e.g. `openai-compatible`, `anthropic`. */
  provider: string;
  baseURL: string;
  apiKey: string;
  /** Extra headers a user wants on every request (e.g. OpenRouter ranking). */
  headers?: Record<string, string>;
  /** Default model for new chats. */
  defaultModel?: string;
  /** Free-form per-provider settings. */
  options?: Record<string, unknown>;
}

export interface LLMProviderAdapter {
  /** Registry key. */
  key: string;
  /** Display name. */
  label: string;
  /** Default base URL when the user adds a new connection of this kind. */
  defaultBaseURL: string;
  /** Whether this adapter can be used without an API key (local servers). */
  keyOptional?: boolean;
  /**
   * Whether the provider's endpoint sends CORS headers that allow a browser to
   * call it directly. When false the UI warns and routes through the proxy.
   */
  browserCors: boolean;
  /** Models this adapter is known to serve (used to seed the picker). */
  knownModels?: string[];
  /** Fetch the live model list, if the provider exposes one. */
  listModels?(conn: LLMConnection, fetchImpl?: typeof fetch): Promise<string[]>;
  /** The single streaming entry point. */
  stream(conn: LLMConnection, req: LLMRequest, fetchImpl?: typeof fetch): AsyncGenerator<LLMStreamEvent>;
}

export interface LLMService {
  adapters(): LLMProviderAdapter[];
  registerAdapter(adapter: LLMProviderAdapter): () => void;
  connections(): LLMConnection[];
  connection(id: string): LLMConnection | undefined;
  stream(connectionId: string, req: LLMRequest): AsyncGenerator<LLMStreamEvent>;
  complete(connectionId: string, req: LLMRequest): Promise<LLMResult>;
  listModels(connectionId: string): Promise<string[]>;
  /**
   * Probe an *unsaved* connection (the settings form's "test connection").
   * Keeping this on the service avoids duplicating adapter selection in the UI.
   */
  completeFrom?(conn: LLMConnection, req: LLMRequest): Promise<LLMResult>;
  listModelsFrom?(conn: LLMConnection): Promise<string[]>;
  /**
   * Embed text for memory recall. Optional: providers without an embeddings
   * endpoint simply do not offer enhanced memory.
   */
  embedFrom?(conn: LLMConnection, input: string | string[], model?: string): Promise<number[][]>;
}

/** Minimal embedding surface an adapter can provide. */
export interface LLMEmbeddingAdapter {
  embed(conn: LLMConnection, input: string | string[], model?: string, fetchImpl?: typeof fetch): Promise<number[][]>;
}

/** Concatenate a whole stream into a result; useful for utility calls. */
export async function collectStream(gen: AsyncGenerator<LLMStreamEvent>): Promise<LLMResult> {
  let text = '';
  let reasoning = '';
  const toolCalls: LLMToolCall[] = [];
  let finishReason: string | undefined;
  let usage: LLMResult['usage'];
  for await (const ev of gen) {
    switch (ev.type) {
      case 'text':
        text += ev.delta;
        break;
      case 'reasoning':
        reasoning += ev.delta;
        break;
      case 'tool_call':
        toolCalls.push(ev.call);
        break;
      case 'usage':
        usage = {
          inputTokens: ev.inputTokens,
          outputTokens: ev.outputTokens,
          cachedTokens: ev.cachedTokens,
          reasoningTokens: ev.reasoningTokens,
        };
        break;
      case 'finish':
        finishReason = ev.reason;
        break;
      case 'error':
        throw new Error(ev.message);
    }
  }
  return { text, reasoning: reasoning || undefined, toolCalls, finishReason, usage };
}
