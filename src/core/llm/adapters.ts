/**
 * Transport adapters.
 *
 * Three adapters cover every provider in the registry:
 *   - `openai-compatible` : ~35 providers
 *   - `anthropic`         : native Messages API
 *   - `gemini`            : native generateContent
 *
 * All three emit the same {@link LLMStreamEvent} union, so the agent loop has no
 * provider branching. The quirks each one absorbs (documented inline) are the
 * reason naive implementations break in the wild.
 */

import type {
  LLMConnection,
  LLMMessage,
  LLMProviderAdapter,
  LLMRequest,
  LLMStreamEvent,
  LLMToolCall,
} from './types.js';
import { describeHttpError, sseJson } from './sse.js';

const joinURL = (base: string, path: string): string => {
  const b = base.replace(/\/+$/, '');
  return `${b}${path}`;
};

/** Reasoning text can arrive under several non-standard keys (C01). */
function reasoningFromDelta(delta: Record<string, unknown>): string | undefined {
  // DeepSeek: reasoning_content · OpenRouter: reasoning · others: thinking /
  // thinking_content / thought / thoughts / reasoning_text (string or array).
  const candidates = [
    delta.reasoning_content,
    delta.reasoning,
    delta.thinking,
    delta.thinking_content,
    delta.thought,
    delta.thoughts,
    delta.reasoning_text,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c) return c;
    if (Array.isArray(c)) {
      const joined = c
        .map((x) =>
          typeof x === 'string'
            ? x
            : x && typeof x === 'object'
              ? String((x as Record<string, unknown>).text ?? (x as Record<string, unknown>).reasoning ?? '')
              : '',
        )
        .join('');
      if (joined) return joined;
    }
  }
  // OpenAI-compatible `content[]` thought shards (C01): a part flagged
  // `thought: true` or whose type names reasoning/thinking/thought.
  const fromContent = openAIReasoningContent(delta.content);
  if (fromContent) return fromContent;
  // Some providers send structured reasoning details.
  const details = delta.reasoning_details;
  if (Array.isArray(details)) {
    const parts = details
      .map((d) =>
        d && typeof d === 'object'
          ? (d as Record<string, unknown>).text ?? (d as Record<string, unknown>).reasoning ?? (d as Record<string, unknown>).content
          : undefined,
      )
      .filter((x): x is string => typeof x === 'string');
    if (parts.length) return parts.join('');
  }
  return undefined;
}

/** Reasoning tokens, when the provider reports them in the usage payload. */
function openAIUsage(usage: OpenAIChunk['usage']): {
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
} {
  return {
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    cachedTokens: (usage?.prompt_tokens_details as Record<string, number> | undefined)?.cached_tokens,
    reasoningTokens: (usage?.completion_tokens_details as Record<string, number> | undefined)?.reasoning_tokens,
  };
}

/**
 * Events for one parsed OpenAI JSON body (non-stream response, or a server
 * that ignored `stream: true` and answered JSON anyway — C07). Shared so
 * both paths emit exactly the same events.
 */
function openAIJsonEvents(json: OpenAIChunk): LLMStreamEvent[] {
  const events: LLMStreamEvent[] = [];
  const choice = json.choices?.[0];
  const text = openAITextContent(choice?.message?.content);
  if (text) events.push({ type: 'text', delta: text });
  const r = choice?.message ? reasoningFromDelta(choice.message as Record<string, unknown>) : undefined;
  if (r) events.push({ type: 'reasoning', delta: r });
  for (const tc of choice?.message?.tool_calls ?? []) {
    events.push({
      type: 'tool_call',
      call: { id: tc.id ?? String(Math.random()), name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
    });
  }
  if (json.usage) events.push({ type: 'usage', ...openAIUsage(json.usage) });
  events.push({ type: 'finish', reason: choice?.finish_reason ?? 'stop' });
  return events;
}

// ------------------------------------------------------------ Multimodal

/** Split a `data:<mime>;base64,<data>` URL; null for remote URLs / junk. */
export function parseDataUrl(url: string): { mime: string; data: string } | null {
  const m = /^data:([^;,]+)?;base64,(.+)$/s.exec(url);
  if (!m) return null;
  return { mime: m[1] || 'image/jpeg', data: m[2] };
}

/** OpenAI `content`: plain text, or text + `image_url` parts (detail high). */
function openAIContent(m: LLMMessage): unknown {
  if (!m.imageUrls?.length) return m.content;
  const parts: unknown[] = [{ type: 'text', text: m.content }];
  for (const url of m.imageUrls) {
    parts.push({ type: 'image_url', image_url: { url, detail: 'high' } });
  }
  return parts;
}

/** Anthropic `content`: text block + one image block per picture. */
function anthropicContent(m: LLMMessage): unknown {
  if (!m.imageUrls?.length) return m.content;
  const blocks: unknown[] = [{ type: 'text', text: m.content || '（图片）' }];
  for (const url of m.imageUrls) {
    const parsed = parseDataUrl(url);
    blocks.push(
      parsed
        ? { type: 'image', source: { type: 'base64', media_type: parsed.mime, data: parsed.data } }
        : { type: 'image', source: { type: 'url', url } },
    );
  }
  return blocks;
}

/** Gemini `parts`: text + inline base64 (or a file reference for remote URLs). */
function geminiParts(m: LLMMessage): unknown[] {
  const parts: unknown[] = [{ text: m.content }];
  for (const url of m.imageUrls ?? []) {
    const parsed = parseDataUrl(url);
    parts.push(
      parsed
        ? { inlineData: { mimeType: parsed.mime, data: parsed.data } }
        : { fileData: { mimeType: 'image/jpeg', fileUri: url } },
    );
  }
  return parts;
}

/** A message/delta `content` may be a string or a parts array — read the text. */
function openAITextContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (!p || typeof p !== 'object') return '';
        const part = p as Record<string, unknown>;
        // A `thought: true` text part is reasoning, not prose — it must not
        // leak into the reply (C01); see openAIReasoningContent below.
        if (part.thought === true) return '';
        return part.type === 'text' ? String(part.text ?? '') : '';
      })
      .join('');
  }
  return '';
}

/**
 * Reasoning text hidden in an OpenAI-compatible `content[]` parts array
 * (C01): parts flagged `thought: true`, or whose `type` names
 * reasoning/thinking/thought (e.g. `{type:'reasoning', text:'…'}`).
 */
function openAIReasoningContent(content: unknown): string {
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => {
      if (!p || typeof p !== 'object') return '';
      const part = p as Record<string, unknown>;
      const isThought =
        part.thought === true ||
        (typeof part.type === 'string' && /reason|think|thought/i.test(part.type));
      if (!isThought) return '';
      const t = part.text ?? part.reasoning_content ?? part.reasoning ?? part.content;
      return typeof t === 'string' ? t : '';
    })
    .join('');
}

// --------------------------------------------------------------- OpenAI

export const openAICompatibleAdapter: LLMProviderAdapter = {
  key: 'openai-compatible',
  label: 'OpenAI 兼容',
  defaultBaseURL: 'https://api.openai.com/v1',
  keyOptional: true,
  browserCors: true,
  knownModels: [],

  async listModels(conn, fetchImpl = fetch) {
    const res = await fetchImpl(joinURL(conn.baseURL, '/models'), {
      headers: buildHeaders(conn),
    });
    if (!res.ok) throw new Error(await describeHttpError(res));
    const json = (await res.json()) as { data?: Array<{ id?: string }> };
    return (json.data ?? []).map((m) => m.id).filter((x): x is string => Boolean(x)).sort();
  },

  async *stream(conn, req, fetchImpl = fetch) {
    const body: Record<string, unknown> = {
      model: req.model,
      messages: toOpenAIMessages(req.messages),
      stream: req.stream !== false,
    };
    if (req.stream !== false) {
      // Without this, OpenAI-compatible servers omit the final usage chunk.
      body.stream_options = { include_usage: true };
    }
    assignSamplers(body, req);
    if (req.stop?.length) body.stop = req.stop;
    if (req.seed !== undefined && req.seed >= 0) body.seed = req.seed;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
      body.tool_choice = req.toolChoice ?? 'auto';
      // RP-Hub's tool timeline assumes one call at a time; parallel calls would
      // interleave results and make the transcript harder to follow.
      body.parallel_tool_calls = false;
    }
    if (req.extra) Object.assign(body, req.extra);

    const res = await fetchImpl(joinURL(conn.baseURL, '/chat/completions'), {
      method: 'POST',
      headers: { ...buildHeaders(conn), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      yield { type: 'error', message: await describeHttpError(res) };
      return;
    }

    if (req.stream === false) {
      const json = (await res.json()) as OpenAIChunk;
      for (const ev of openAIJsonEvents(json)) yield ev;
      return;
    }

    // C07: the server ignored `stream: true` and answered plain JSON. A
    // content-type check catches that before the SSE parser chokes on it;
    // a missing header still falls through to SSE (some servers omit it).
    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('text/event-stream') && contentType.includes('application/json')) {
      const json = (await res.json()) as OpenAIChunk;
      for (const ev of openAIJsonEvents(json)) yield ev;
      return;
    }

    if (!res.body) {
      yield { type: 'error', message: '服务端没有返回数据流' };
      return;
    }

    // Tool calls stream as incremental deltas keyed by index; assemble then emit
    // once the stream finishes so consumers never see half a JSON argument.
    const toolAcc = new Map<number, { id: string; name: string; arguments: string }>();
    let finishReason = 'stop';

    for await (const chunk of sseJson<OpenAIChunk>(res.body)) {
      // The usage chunk legitimately has `choices: []` — never index blindly.
      if (chunk.usage) {
        yield { type: 'usage', ...openAIUsage(chunk.usage) };
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      const text = openAITextContent(delta.content);
      if (text) {
        yield { type: 'text', delta: text };
      }
      const reasoning = reasoningFromDelta(delta as Record<string, unknown>);
      if (reasoning) yield { type: 'reasoning', delta: reasoning };

      for (const tc of delta.tool_calls ?? []) {
        const idx = tc.index ?? 0;
        const acc = toolAcc.get(idx) ?? { id: '', name: '', arguments: '' };
        if (tc.id) acc.id = tc.id;
        if (tc.function?.name) acc.name += tc.function.name;
        if (tc.function?.arguments) acc.arguments += tc.function.arguments;
        toolAcc.set(idx, acc);
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }

    for (const [idx, acc] of [...toolAcc.entries()].sort((a, b) => a[0] - b[0])) {
      yield {
        type: 'tool_call',
        call: { id: acc.id || `call_${idx}`, name: acc.name, arguments: acc.arguments || '{}' },
      };
    }
    yield { type: 'finish', reason: finishReason };
  },
};

interface OpenAIChunk {
  choices?: Array<{
    index?: number;
    delta?: { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } & Record<string, unknown>;
    message?: { content?: string | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> } & Record<string, unknown>;
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    /** OpenAI reports reasoning tokens here (o1 / DeepSeek-R1 style). */
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

function toOpenAIMessages(messages: LLMMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === 'tool') {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      return {
        role: 'assistant',
        content: openAIContent(m),
        tool_calls: m.toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.arguments },
        })),
      };
    }
    const out: Record<string, unknown> = { role: m.role, content: openAIContent(m) };
    if (m.name) out.name = m.name;
    return out;
  });
}

/** Only send samplers the caller actually set; some APIs reject unknown keys.
 *  `maxTokens === 0` means unlimited and is omitted so the model runs to its
 *  natural stop instead of being cut at a provider default. */
function assignSamplers(body: Record<string, unknown>, req: LLMRequest): void {
  const map: Array<[keyof LLMRequest, string]> = [
    ['temperature', 'temperature'],
    ['topP', 'top_p'],
    ['topK', 'top_k'],
    ['maxTokens', 'max_tokens'],
    ['frequencyPenalty', 'frequency_penalty'],
    ['presencePenalty', 'presence_penalty'],
    ['repetitionPenalty', 'repetition_penalty'],
    ['minP', 'min_p'],
    ['topA', 'top_a'],
  ];
  for (const [from, to] of map) {
    const v = req[from];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (to === 'frequency_penalty' || to === 'presence_penalty') {
      // These two are legitimately 0 for many models; keep 0.
      if (v !== 0) body[to] = v;
    } else if (to === 'max_tokens') {
      // 0 = unlimited: omit so the model is not cut at a provider default.
      if (v > 0) body[to] = v;
    } else if (v !== 0) {
      body[to] = v;
    }
  }
}

function buildHeaders(conn: LLMConnection): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json', ...(conn.headers ?? {}) };
  if (conn.apiKey) headers.Authorization = `Bearer ${conn.apiKey}`;
  // OpenRouter asks clients to identify themselves; harmless elsewhere.
  if (/openrouter\.ai/.test(conn.baseURL)) {
    headers['HTTP-Referer'] = typeof location !== 'undefined' ? location.origin : 'https://rpnow.app';
    headers['X-Title'] = 'RPNow';
  }
  // GitHub Models accepts this token form too; Bearer also works.
  return headers;
}

// -------------------------------------------------------------- Anthropic

export const anthropicAdapter: LLMProviderAdapter = {
  key: 'anthropic',
  label: 'Anthropic Messages',
  defaultBaseURL: 'https://api.anthropic.com',
  browserCors: true,
  knownModels: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5'],

  async listModels(conn, fetchImpl = fetch) {
    const res = await fetchImpl(joinURL(conn.baseURL, '/v1/models'), {
      headers: {
        'x-api-key': conn.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    });
    if (!res.ok) throw new Error(await describeHttpError(res));
    const json = (await res.json()) as { data?: Array<{ id: string }> };
    return (json.data ?? []).map((m) => m.id);
  },

  async *stream(conn, req, fetchImpl = fetch) {
    // Anthropic takes `system` as a TOP-LEVEL string, not a message, and
    // requires max_tokens. Both are hard errors if omitted.
    const systemParts = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
    const turns = req.messages.filter((m) => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens && req.maxTokens > 0 ? req.maxTokens : 4096,
      messages: turns.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: anthropicContent(m),
      })),
      stream: req.stream !== false,
    };
    if (systemParts.length) body.system = systemParts.join('\n\n');
    if (req.temperature !== undefined) body.temperature = Math.min(req.temperature, 1);
    if (req.topP !== undefined) body.top_p = req.topP;
    if (req.topK !== undefined && req.topK > 0) body.top_k = req.topK;
    if (req.stop?.length) body.stop_sequences = req.stop;
    if (req.extra) Object.assign(body, req.extra);

    const res = await fetchImpl(joinURL(conn.baseURL, '/v1/messages'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': conn.apiKey,
        'anthropic-version': '2023-06-01',
        // Required for browser calls; org settings may still deny.
        'anthropic-dangerous-direct-browser-access': 'true',
        ...(conn.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });

    if (!res.ok) {
      yield { type: 'error', message: await describeHttpError(res) };
      return;
    }
    // C07: non-SSE JSON answer to a streaming request — parse it as one
    // message instead of feeding it to the SSE parser.
    const anthropicCt = res.headers.get('content-type') ?? '';
    if (!anthropicCt.includes('text/event-stream') && anthropicCt.includes('application/json')) {
      const json = (await res.json()) as {
        content?: Array<{ type?: string; text?: string; thinking?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
        stop_reason?: string;
      };
      for (const block of json.content ?? []) {
        if (block.type === 'text' && block.text) yield { type: 'text', delta: block.text };
        else if (block.type === 'thinking' && block.thinking) yield { type: 'reasoning', delta: block.thinking };
      }
      if (json.usage) {
        yield {
          type: 'usage',
          inputTokens: json.usage.input_tokens,
          outputTokens: json.usage.output_tokens,
          cachedTokens: json.usage.cache_read_input_tokens,
        };
      }
      yield { type: 'finish', reason: json.stop_reason ?? 'stop' };
      return;
    }
    if (!res.body) {
      yield { type: 'error', message: '服务端没有返回数据流' };
      return;
    }

    let finishReason = 'stop';
    let inputTokens: number | undefined;
    let cachedTokens: number | undefined;
    for await (const evt of sseJson<Record<string, unknown>>(res.body)) {
      const type = String(evt.type ?? '');
      switch (type) {
        case 'message_start': {
          const msg = evt.message as Record<string, unknown> | undefined;
          const usage = msg?.usage as Record<string, number> | undefined;
          inputTokens = usage?.input_tokens;
          cachedTokens = usage?.cache_read_input_tokens;
          break;
        }
        case 'content_block_delta': {
          const delta = evt.delta as Record<string, unknown> | undefined;
          if (!delta) break;
          if (delta.type === 'text_delta' && typeof delta.text === 'string') {
            yield { type: 'text', delta: delta.text };
          } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
            yield { type: 'reasoning', delta: delta.thinking };
          }
          break;
        }
        case 'message_delta': {
          const delta = evt.delta as Record<string, unknown> | undefined;
          if (delta && typeof delta.stop_reason === 'string') finishReason = delta.stop_reason;
          const usage = evt.usage as Record<string, number> | undefined;
          if (usage) {
            yield {
              type: 'usage',
              inputTokens,
              outputTokens: usage.output_tokens,
              cachedTokens,
            };
          }
          break;
        }
        case 'error': {
          const err = evt.error as Record<string, unknown> | undefined;
          yield { type: 'error', message: String(err?.message ?? 'Anthropic 返回错误') };
          return;
        }
        default:
          break;
      }
    }
    yield { type: 'finish', reason: finishReason };
  },
};

// ----------------------------------------------------------------- Gemini

export const geminiAdapter: LLMProviderAdapter = {
  key: 'gemini',
  label: 'Google Gemini',
  defaultBaseURL: 'https://generativelanguage.googleapis.com/v1beta',
  browserCors: true,
  knownModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],

  async listModels(conn, fetchImpl = fetch) {
    const res = await fetchImpl(`${joinURL(conn.baseURL, '/models')}?key=${encodeURIComponent(conn.apiKey)}`);
    if (!res.ok) throw new Error(await describeHttpError(res));
    const json = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    return (json.models ?? [])
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  },

  async *stream(conn, req, fetchImpl = fetch) {
    const systemText = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const contents = req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        // Gemini calls the assistant role "model", not "assistant".
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: geminiParts(m),
      }));

    const generationConfig: Record<string, unknown> = {};
    if (req.temperature !== undefined) generationConfig.temperature = req.temperature;
    if (req.topP !== undefined) generationConfig.topP = req.topP;
    if (req.topK !== undefined) generationConfig.topK = req.topK;
    if (req.maxTokens) generationConfig.maxOutputTokens = req.maxTokens;
    if (req.stop?.length) generationConfig.stopSequences = req.stop;
    if (req.extra?.thinkingConfig) generationConfig.thinkingConfig = req.extra.thinkingConfig;

    const body: Record<string, unknown> = { contents, generationConfig };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };

    const isStream = req.stream !== false;
    // Without ?alt=sse Gemini returns a JSON ARRAY instead of SSE frames.
    const path = isStream
      ? `/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(conn.apiKey)}`
      : `/models/${encodeURIComponent(req.model)}:generateContent?key=${encodeURIComponent(conn.apiKey)}`;

    const res = await fetchImpl(joinURL(conn.baseURL, path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(conn.headers ?? {}) },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      yield { type: 'error', message: await describeHttpError(res) };
      return;
    }

    type GeminiResp = {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        finishReason?: string;
      }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
    };

    let finishReason = 'stop';
    // C07: the stream endpoint answered plain JSON instead of SSE.
    const geminiCt = res.headers.get('content-type') ?? '';
    if (isStream && !geminiCt.includes('text/event-stream') && geminiCt.includes('application/json')) {
      const json = (await res.json()) as GeminiResp;
      for (const part of json.candidates?.[0]?.content?.parts ?? []) {
        if (!part.text) continue;
        if (part.thought) yield { type: 'reasoning', delta: part.text };
        else yield { type: 'text', delta: part.text };
      }
      if (json.usageMetadata) {
        yield {
          type: 'usage',
          inputTokens: json.usageMetadata.promptTokenCount,
          outputTokens: json.usageMetadata.candidatesTokenCount,
          reasoningTokens: json.usageMetadata.thoughtsTokenCount,
        };
      }
      yield { type: 'finish', reason: json.candidates?.[0]?.finishReason ?? 'stop' };
      return;
    }
    if (!isStream) {
      const json = (await res.json()) as GeminiResp;
      for (const part of json.candidates?.[0]?.content?.parts ?? []) {
        if (!part.text) continue;
        if (part.thought) yield { type: 'reasoning', delta: part.text };
        else yield { type: 'text', delta: part.text };
      }
      if (json.usageMetadata) {
        yield {
          type: 'usage',
          inputTokens: json.usageMetadata.promptTokenCount,
          outputTokens: json.usageMetadata.candidatesTokenCount,
          reasoningTokens: json.usageMetadata.thoughtsTokenCount,
        };
      }
      yield { type: 'finish', reason: json.candidates?.[0]?.finishReason ?? 'stop' };
      return;
    }
    if (!res.body) {
      yield { type: 'error', message: '服务端没有返回数据流' };
      return;
    }

    for await (const chunk of sseJson<GeminiResp>(res.body)) {
      const cand = chunk.candidates?.[0];
      for (const part of cand?.content?.parts ?? []) {
        if (!part.text) continue;
        // Thinking arrives as a part flagged `thought: true`, not a separate field.
        if (part.thought) yield { type: 'reasoning', delta: part.text };
        else yield { type: 'text', delta: part.text };
      }
      if (cand?.finishReason) finishReason = cand.finishReason;
      if (chunk.usageMetadata) {
        yield {
          type: 'usage',
          inputTokens: chunk.usageMetadata.promptTokenCount,
          outputTokens: chunk.usageMetadata.candidatesTokenCount,
          reasoningTokens: chunk.usageMetadata.thoughtsTokenCount,
        };
      }
    }
    yield { type: 'finish', reason: finishReason };
  },
};

/**
 * OpenAI-compatible embeddings. Used by enhanced memory recall; providers that
 * have no embeddings endpoint simply never call this.
 */
export async function openAIEmbed(
  conn: LLMConnection,
  input: string | string[],
  model?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number[][]> {
  const res = await fetchImpl(joinURL(conn.baseURL, '/embeddings'), {
    method: 'POST',
    headers: {
      Authorization: conn.apiKey ? `Bearer ${conn.apiKey}` : '',
      'Content-Type': 'application/json',
      ...(conn.headers ?? {}),
    },
    body: JSON.stringify({ model: model || conn.defaultModel || '', input }),
  });
  if (!res.ok) throw new Error(await describeHttpError(res));
  const json = (await res.json()) as { data?: Array<{ embedding: number[]; index?: number }> };
  // One entry per input; restore the caller's order via the returned index.
  return (json.data ?? [])
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((d) => d.embedding);
}

export const BUILTIN_ADAPTERS: LLMProviderAdapter[] = [
  openAICompatibleAdapter,
  anthropicAdapter,
  geminiAdapter,
];

/** Exported for tests. */
export const __internal = { toOpenAIMessages, assignSamplers, reasoningFromDelta, openAIContent, anthropicContent, geminiParts, parseDataUrl, openAITextContent, openAIReasoningContent };
export type { LLMToolCall };
