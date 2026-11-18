# RPNow — HTTP Provider API Reference

Implementation-ready reference for every external AI API RPNow talks to: chat completions, the
native Anthropic and Gemini APIs, and image generation.

**Research cut-off:** 2026-11-15. Vendor APIs move fast; every non-obvious claim carries an inline
source link. Anything I could not verify against a primary source is marked `⚠️ uncertain`.

**Scope note:** This document is research only. No application code is described or implied here.

---

## Table of contents

1. [OpenAI-compatible chat](#1-openai-compatible-chat)
2. [Provider registry](#2-provider-registry)
3. [Anthropic Messages API (native)](#3-anthropic-messages-api-native)
4. [Google Gemini API (native + OpenAI-compat)](#4-google-gemini-api-native--openai-compat)
5. [Image generation](#5-image-generation)
6. [CORS reality check](#6-cors-reality-check)
7. [Appendix: what to build in an adapter layer](#7-appendix-what-to-build-in-an-adapter-layer)

---

## 1. OpenAI-compatible chat

Almost every provider on earth now exposes a Chat Completions-shaped endpoint. RPNow should treat
`POST {baseURL}/chat/completions` as the default transport and reserve special adapters only for
the providers called out in §2.

### 1.1 Endpoint and headers

```http
POST https://api.openai.com/v1/chat/completions
Content-Type: application/json
Authorization: Bearer sk-...
```

- `baseURL` **includes** `/v1`. The path you append is the literal string `/chat/completions`.
  So a full URL is `baseURL + "/chat/completions"`.
- Auth is the standard `Authorization: Bearer <key>` header for essentially every compatible
  provider. Two notable native exceptions: Anthropic (`x-api-key`) and Gemini native (`x-goog-api-key`
  or `?key=`), both covered in their own sections.
- Some gateways want extra headers; OpenRouter documents optional `HTTP-Referer` and `X-Title` for
  attribution on its leaderboards. They are not required for the request to succeed.

### 1.2 Request body (the subset RPNow needs)

```json
{
  "model": "deepseek-chat",
  "messages": [
    { "role": "system", "content": "You are a narrator." },
    { "role": "user", "content": "Describe the tavern." }
  ],
  "stream": true,
  "stream_options": { "include_usage": true },
  "temperature": 1.0,
  "max_tokens": 2048,
  "stop": ["\n\nUser:"]
}
```

### 1.3 `stream_options: {include_usage: true}`

The authoritative description, from the OpenAI Python SDK type file
([`chat_completion_stream_options_param.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion_stream_options_param.py)):

> If set, an additional chunk will be streamed **before** the `data: [DONE]` message. The `usage`
> field on this chunk shows the token usage statistics for the entire request, and the `choices`
> field will always be an **empty array**. All other chunks will also include a `usage` field, but
> with a **null value**.

Practical consequences for RPNow:

- **Do not** assume every chunk has `choices[0]`. The final usage chunk has `choices: []`, so a
  naive `chunk.choices[0].delta.content` will throw. Guard with `if (!chunk.choices?.length) continue`.
- `usage` is `null` on every chunk until the usage chunk arrives.
- If the stream is interrupted or cancelled you may **never** receive the usage chunk — treat usage
  as best-effort, not guaranteed.
- `stream_options` is **only** legal when `stream: true`. Sending it with `stream: false` is a
  validation error on OpenAI.
- Support varies by provider. Several Chinese and open-source servers ignore `stream_options`
  entirely (see §2 notes). Never depend on it for correctness — only for display.

There is a sibling option `include_obfuscation` (default `true`) which pads chunks with an
`obfuscation` field to normalise payload sizes against side-channel attacks. It is safe to ignore
the field, but do not crash if it appears.

### 1.4 SSE wire format

The body is `Content-Type: text/event-stream`. The format is standard SSE with one event per
`data:` line and a blank line terminator:

```
data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1730000000,"model":"deepseek-chat","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1730000000,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":"The"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1730000000,"model":"deepseek-chat","choices":[{"index":0,"delta":{"content":" tavern"},"finish_reason":null}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1730000000,"model":"deepseek-chat","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}

data: {"id":"chatcmpl-abc","object":"chat.completion.chunk","created":1730000000,"model":"deepseek-chat","choices":[],"usage":{"prompt_tokens":18,"completion_tokens":9,"total_tokens":27}}

data: [DONE]
```

Parsing rules that matter in practice:

| Rule | Why |
| --- | --- |
| Split the byte stream on `\n\n` (not `\n`) | A JSON payload can legally contain newlines inside string values. |
| Strip the leading `data: ` then `JSON.parse` | There is normally exactly one space after the colon, but strip gently: `line.replace(/^data:\s?/, '')`. |
| Terminate on the literal `data: [DONE]` | Sentinel, not JSON. Do **not** pass it to `JSON.parse`. |
| Ignore `:` comment/keepalive lines | Some providers (and proxies) send `: ping` heartbeats. |
| Handle `event:` lines | Native Anthropic/Gemini SSE use named events. OpenAI-style streams generally do not. |
| Concatenate, never replace | `delta.content` is an increment. `acc += delta.content ?? ''`. |
| `delta.role` appears only on the first chunk | Do not expect it later. |

`finish_reason` values: `stop`, `length`, `tool_calls`, `content_filter`, `function_call`
(deprecated). Some providers add non-standard values — DeepSeek, for example, can return
`insufficient_system_resource` and `aborted`
([DeepSeek API reference](https://api-docs.deepseek.com/api/create-chat-completion)).

### 1.5 Tool-call streaming delta shape

Tool calls stream as **indexed fragments**. The first fragment for a given `index` carries `id`,
`type`, and `function.name`; every subsequent fragment for that same index carries **only**
`function.arguments`, as a *partial JSON string*.

First chunk (note the deliberately truncated `{"ci` — this is normal, not corruption):

```json
{ "choices": [ { "index": 0, "delta": { "tool_calls": [
  { "index": 0, "id": "call_abc123", "type": "function",
    "function": { "name": "get_weather", "arguments": "{\"ci" } } ] } } ] }
```

Second chunk:

```json
{ "choices": [ { "index": 0, "delta": { "tool_calls": [
  { "index": 0, "function": { "arguments": "ty\":\"Beijing\"}" } } ] } } ] }
```

Accumulation algorithm: keep a map keyed by `index`; append `function.arguments` strings; only
`JSON.parse` once `finish_reason === "tool_calls"` and the stream ends. Source for this exact
shape and the "first frame has id/name, later frames append arguments" rule:
[Tencent Cloud OpenAI-protocol field notes](https://www.tencentcloud.com/zh/document/product/1300/82345)
and the
[OpenAI `ChatCompletionChunk` type](https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion_chunk.py)
(`ChoiceDeltaToolCall` has `index: int` required, `id`/`type`/`function` optional).

Note that RPNow is a roleplay app, so tool calling is likely not on the critical path — but if you
ever add a "memory retrieval" or "state update" tool, this is the shape you must handle.

### 1.6 Reasoning / thinking content — the messy part

There is **no** standard. Each provider invents a field name. This table is the practical
compatibility matrix; treat "reasoning" as a **separate accumulator** from "content" in your
stream handler.

| Provider | Field (non-streaming) | Field (streaming) | Notes |
| --- | --- | --- | --- |
| **OpenAI** (o-series, GPT-5 class) | none in Chat Completions | none in Chat Completions | Reasoning is opaque and *not* returned as text. Summary items only exist on the Responses API. Treat as "no thinking text available". |
| **DeepSeek** | `message.reasoning_content` | `delta.reasoning_content` | Confirmed in the DeepSeek API reference: *"For thinking mode only. The reasoning contents of the assistant message, before the final answer."* ([source](https://api-docs.deepseek.com/api/create-chat-completion)) |
| **Anthropic** (native) | `content[]` blocks of `type: "thinking"` | `thinking_delta` events | Not OpenAI-shaped at all. See §3. |
| **Anthropic** (via OpenRouter / compat) | `message.reasoning` | `delta.reasoning` | OpenRouter normalises to `reasoning` + `reasoning_details`. |
| **Gemini** (native) | `parts[].text` with `parts[].thought: true` | same, per chunk | See §4.4. |
| **Gemini** (via OpenAI-compat) | ⚠️ uncertain — the compat layer historically drops thought parts; some models surface a non-standard `reasoning_content` | ⚠️ uncertain | Verify per model before relying on it. |
| **OpenRouter** | `message.reasoning` + `message.reasoning_details[]` | `delta.reasoning` + `delta.reasoning_details[]` | See §1.6.1. |
| **Moonshot / Kimi**, **Zhipu GLM**, **Qwen**, **MiniMax**, **SiliconFlow** | usually `reasoning_content` (DeepSeek-compatible) | `delta.reasoning_content` | ⚠️ field name varies by model and gateway; feature-detect at runtime. |
| **Groq** | model-dependent (`reasoning` for some gpt-oss models) | same | ⚠️ uncertain; probe per model. |

**Feature-detection guidance:** don't hardcode a provider list. On each chunk, check for the
presence (not truthiness of the whole delta) of, in order: `delta.reasoning_content`,
`delta.reasoning`, `delta.thinking`, and render whichever is a string into the "thinking" pane.

#### 1.6.1 OpenRouter `reasoning` and `reasoning_details`

OpenRouter is the one gateway that has documented a *normalised* shape, and it is worth mirroring
internally because it is the closest thing to a standard. From the
[OpenRouter Reasoning Tokens guide](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens):

- Request control object:

```json
{
  "model": "anthropic/claude-sonnet-4.5",
  "reasoning": {
    "effort": "high"
  }
}
```

  `effort` accepts `max | xhigh | high | medium | low | minimal | none`. Alternative
  `"max_tokens": 2000` (token-budget style) and `"enabled": true` (defaults) are also accepted —
  *not both* `effort` and `max_tokens` together.

- Plain text lands in **`message.reasoning`** (non-streaming) and **`delta.reasoning`** (streaming).
- Structured detail lands in **`reasoning_details[]`** at `choices[].message.reasoning_details`
  (non-streaming) or `choices[].delta.reasoning_details` (streaming).

Three detail object types, all sharing `id`, `format`, `index`:

```json
{ "type": "reasoning.summary",   "summary": "Analysed the problem by breaking it into components", "id": "reasoning-summary-1", "format": "anthropic-claude-v1", "index": 0 }
{ "type": "reasoning.encrypted", "data": "eyJlbmNyeXB0ZWQiOnRydWU...", "id": "reasoning-encrypted-1", "format": "anthropic-claude-v1", "index": 1 }
{ "type": "reasoning.text",      "text": "Let me think step by step...", "signature": null, "id": "reasoning-text-1", "format": "anthropic-claude-v1", "index": 2 }
```

`format` values include `anthropic-claude-v1` (default), `openai-responses-v1`, `google-gemini-v1`,
`xai-responses-v1`, `meta-responses-v1`, `azure-openai-responses-v1`,
`bedrock-openai-responses-v1`, `google-vertex-responses-v1`, `unknown`.

Legacy params still accepted: `include_reasoning: true` (≡ `reasoning: {}`) and
`include_reasoning: false` (≡ `reasoning: {exclude: true}`). The `exclude` key is
**Chat Completions only**.

Important budget gotcha documented by OpenRouter: reasoning tokens count against
`max_tokens`/`max_completion_tokens`. If the model spends the whole budget thinking, you get
`finish_reason: "length"` with **empty `content`** — and with `reasoning.exclude: true` you get
literally no text at all. For a roleplay app that means: never set `max_tokens` so tight that a
reasoning model can burn it all, and detect the case by comparing
`usage.completion_tokens_details.reasoning_tokens` against `usage.completion_tokens`.

**For RPNow specifically:** the pragmatic option is to send `"reasoning": {"exclude": true}` (or the
per-provider equivalent) for providers that expose a switch, if the thinking pane is not a product
feature — it saves tokens and latency. If thinking *is* shown, render it in a collapsible block and
never mix it into the message text.

---

## 2. Provider registry

Legend for the **Compat** column:

- **OAI** — OpenAI-compatible Chat Completions. Use the generic adapter with `baseURL`.
- **OAI (native auth)** — OpenAI-compatible body, but not `Bearer` auth. Needs a header tweak only.
- **NATIVE** — needs a genuine separate adapter (request *and* response shapes differ).
- **OAI-ish** — OpenAI-shaped but with enough quirks to warrant per-provider handling.

### 2.1 Quick table

| Provider | Compat | `baseURL` | Default / example model ids |
| --- | --- | --- | --- |
| **OpenAI** | OAI | `https://api.openai.com/v1` | `gpt-5`, `gpt-5-mini`, `gpt-4.1`, `gpt-4o` ⚠️ ids rotate; fetch `GET /v1/models` |
| **Anthropic** | **NATIVE** | `https://api.anthropic.com` (no `/v1` in base; path is `/v1/messages`) | `claude-sonnet-4-5`, `claude-opus-4-5`, `claude-haiku-4-5`, `claude-sonnet-5` ⚠️ |
| **Google Gemini** | **BOTH** | native: `https://generativelanguage.googleapis.com/v1beta` — OAI: `https://generativelanguage.googleapis.com/v1beta/openai` | `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3-pro-preview` ⚠️ |
| **DeepSeek** | OAI | `https://api.deepseek.com/v1` (also `https://api.deepseek.com`) | `deepseek-chat`, `deepseek-reasoner` |
| **Moonshot / Kimi** | OAI | `https://api.moonshot.ai/v1` (global) · `https://api.moonshot.cn/v1` (China) | `kimi-k2.5`, `kimi-k2-thinking`, `moonshot-v1-8k` ⚠️ |
| **Zhipu / Z.ai / GLM** | OAI | `https://open.bigmodel.cn/api/paas/v4` (CN) · `https://api.z.ai/api/paas/v4` ⚠️ (intl) | `glm-4.7`, `glm-4.5`, `glm-5` ⚠️ |
| **Alibaba DashScope / Qwen** | OAI | `https://dashscope.aliyuncs.com/compatible-mode/v1` (CN) · `https://dashscope-intl.aliyuncs.com/compatible-mode/v1` (intl) | `qwen-max`, `qwen-plus`, `qwen3-235b-a22b` ⚠️ |
| **MiniMax** | OAI | `https://api.minimax.io/v1` (global) · `https://api.minimax.chat/v1` (CN) | `MiniMax-Text-01`, `MiniMax-M2` ⚠️ |
| **Baidu Qianfan** | OAI | `https://qianfan.baidubce.com/v2` | `ernie-4.0-8k`, `ernie-4.5-8k-preview` ⚠️ |
| **ByteDance / Volcengine Ark (Doubao)** | OAI | `https://ark.cn-beijing.volces.com/api/v3` (CN) · `https://ark.ap-southeast.bytepluses.com/api/v3` (BytePlus intl) | `doubao-seed-1-6-250615`, `doubao-pro-32k` ⚠️; also hosts DeepSeek/GLM/Kimi |
| **SiliconFlow** | OAI | `https://api.siliconflow.cn/v1` | `deepseek-ai/DeepSeek-V3`, `Qwen/Qwen3-235B-A22B` ⚠️ |
| **OpenRouter** | OAI | `https://openrouter.ai/api/v1` | `openrouter/auto`, `anthropic/claude-sonnet-4.5`, `google/gemini-3-flash-preview` |
| **Groq** | OAI | `https://api.groq.com/openai/v1` | `llama-3.3-70b-versatile`, `openai/gpt-oss-120b`, `moonshotai/kimi-k2-instruct` ⚠️ |
| **Mistral** | OAI | `https://api.mistral.ai/v1` | `mistral-large-latest`, `mistral-small-latest`, `codestral-latest` |
| **xAI Grok** | OAI | `https://api.x.ai/v1` | `grok-4`, `grok-3-mini`, `grok-4.20-0309-reasoning` ⚠️ |
| **Together AI** | OAI | `https://api.together.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct-Turbo`, `deepseek-ai/DeepSeek-V3` ⚠️ |
| **Fireworks AI** | OAI | `https://api.fireworks.ai/inference/v1` | `accounts/fireworks/models/llama-v3p3-70b-instruct` ⚠️ |
| **DeepInfra** | OAI | `https://api.deepinfra.com/v1/openai` | `meta-llama/Meta-Llama-3.1-70B-Instruct` ⚠️ |
| **Perplexity** | OAI-ish | `https://api.perplexity.ai` | `sonar`, `sonar-pro`, `sonar-reasoning` |
| **Cohere** | **OAI-ish / NATIVE** | `https://api.cohere.com/v2` (native `POST /chat`); OpenAI-compat at `https://api.cohere.ai/compatibility/v1` ⚠️ | `command-a-03-2025`, `command-r-plus-08-2024` |
| **01.AI (Yi)** | OAI | `https://api.lingyiwanwu.com/v1` ⚠️ uncertain (service status unclear) | `yi-large`, `yi-lightning` ⚠️ |
| **Tencent Hunyuan** | OAI | `https://api.hunyuan.cloud.tencent.com/v1` | `hunyuan-turbos-latest`, `hunyuan-t1-latest`, `hunyuan-lite` |
| **iFlytek Spark** | OAI | `https://spark-api-open.xf-yun.com/v1` | `4.0Ultra`, `generalv3.5`, `lite` |
| **Baichuan** | OAI | `https://api.baichuan-ai.com/v1` | `Baichuan4-Turbo`, `Baichuan4-Air` |
| **StepFun** | OAI | `https://api.stepfun.ai/v1` (intl) · `https://api.stepfun.com/v1` (CN) | `step-2-16k`, `step-1-8k` ⚠️ |
| **NVIDIA NIM** | OAI | `https://integrate.api.nvidia.com/v1` | `meta/llama-3.3-70b-instruct`, `deepseek-ai/deepseek-r1` ⚠️ |
| **Cerebras** | OAI | `https://api.cerebras.ai/v1` | `llama3.3-70b`, `llama-4-scout-17b-16e-instruct` ⚠️ |
| **AI21** | **NATIVE** | `https://api.ai21.com/studio/v1` (chat is OpenAI-ish: `POST /studio/v1/chat/completions`) | `jamba-1.5-large`, `jamba-1.5-mini` |
| **Nebius AI Studio** | OAI | `https://api.studio.nebius.ai/v1` | `deepseek-ai/DeepSeek-V3`, `meta-llama/Llama-3.3-70B-Instruct` ⚠️ |
| **Novita AI** | OAI | `https://api.novita.ai/v3/openai` | `deepseek/deepseek-v3.2`, `zai-org/glm-4.7` ⚠️ |
| **Hyperbolic** | OAI | `https://api.hyperbolic.xyz/v1` | `meta-llama/Llama-3.3-70B-Instruct` ⚠️ |
| **GitHub Models** | OAI (native auth) | `https://models.github.ai/inference` | `openai/gpt-4o`, `deepseek/DeepSeek-V3-0324` ⚠️ |
| **Ollama** (local) | OAI | `http://localhost:11434/v1` | whatever `ollama list` shows, e.g. `llama3.2`, `qwen2.5` |
| **LM Studio** (local) | OAI | `http://localhost:1234/v1` | loaded model id from `GET /v1/models` |
| **vLLM** (self-host) | OAI | `http://localhost:8000/v1` | served model name (`--served-model-name`) |
| **KoboldCpp** | OAI | `http://localhost:5001/v1` | `koboldcpp/<loaded>` ⚠️; has its own `/api/v1/generate` too |
| **text-generation-webui** | OAI | `http://localhost:5000/v1` | enabled via `--api` flag ⚠️ |

> ⚠️ Default model ids in this table are the *commonly used* ones as of the research date. Model
> ids change constantly and are region-account-dependent. **Never hardcode as the only option —
> always let the user type/pick a model id, and where the provider supports it, populate the picker
> from `GET {baseURL}/models`.**

### 2.2 Native adapters you must actually write

Only three families genuinely need bespoke code:

1. **Anthropic Messages API** — different path, different auth header, different body
   (`system` is top-level, not a message), different streaming events. See §3.
2. **Gemini native `generateContent`** — `contents[].parts[]`, `systemInstruction`,
   `generationConfig`, `?alt=sse`, and per-part `thought` flags. See §4.
3. **Cohere v2 `/chat`** (if you use the native path) — `messages`, but `message.content` is an
   array of `{type:"text", text:...}`, and responses stream as `event`+`data` pairs.

Everything else fits one OpenAI-compatible adapter with a `baseURL` + header map.

### 2.3 Provider-specific quirks worth knowing

**DeepSeek** — base URL accepts both with and without `/v1`. `frequency_penalty` and
`presence_penalty` are **deprecated and silently ignored**: *"This parameter is no longer supported.
It will not take effect if you pass it to the API."* ([source](https://api-docs.deepseek.com/api/create-chat-completion)).
Also exposes `user_id` (ASCII, ≤512 bytes) for rate-limit isolation. `finish_reason` can be
`insufficient_system_resource` or `aborted` in addition to the standard set.

**Groq / Cerebras** — both front their endpoints with a WAF that returned HTTP 403 to non-browser
clients during my probing, and neither returned CORS headers. They work from servers; do not
assume they work from the browser (§6).

**Moonshot / MiniMax / Baichuan / Hunyuan / Hyperbolic** — these *do* echo back the request
`Origin` in `Access-Control-Allow-Origin` (§6), so browser-direct calls are plausible. Baichuan's
CORS allow-headers list is unusually long and explicitly includes `Authorization`.

**OpenRouter** — returns `Access-Control-Allow-Origin: *` and answered an `OPTIONS` preflight with
`204`. This is the lowest-friction "many models" option for a browser app. If you ship OpenRouter
from a browser, note that the user's key is then exposed client-side — which for a local-first app
is usually acceptable, and for a hosted app is not.

**Perplexity / Qianfan / AI21 / Cohere / Novita / Nebius / SiliconFlow / xAI / Together / Mistral** —
all returned `Access-Control-Allow-Origin: *` on an authenticated probe request.

---

## 3. Anthropic Messages API (native)

### 3.1 Endpoint and headers

```http
POST https://api.anthropic.com/v1/messages
Content-Type: application/json
x-api-key: sk-ant-...
anthropic-version: 2023-06-01
anthropic-dangerous-direct-browser-access: true
```

Three differences from OpenAI, all mandatory:

| | OpenAI | Anthropic |
| --- | --- | --- |
| Auth header | `Authorization: Bearer <key>` | **`x-api-key: <key>`** |
| Versioning | in the path (`/v1`) | **`anthropic-version` header** (currently `2023-06-01`) |
| Browser CORS | provider-dependent | **requires `anthropic-dangerous-direct-browser-access: true`** |

`anthropic-version` is required on every request. Additional opt-in features use
`anthropic-beta: <beta-name>` headers.

### 3.2 Request body — `system` is TOP-LEVEL

This is the single biggest structural difference and the most common porting bug.

```json
{
  "model": "claude-sonnet-4-5",
  "max_tokens": 2048,
  "system": "You are RPNow's narrative engine. Never speak for the player.",
  "messages": [
    { "role": "user", "content": "The tavern door creaks open." },
    { "role": "assistant", "content": "A hooded figure steps inside, shaking off the rain." }
  ],
  "temperature": 1.0,
  "stop_sequences": ["\n\nHuman:"],
  "stream": true
}
```

- `system` is a **string or an array of content blocks** at the top level. There is **no**
  `{"role":"system"}` message. Putting one in `messages` is a 400.
- `messages` must alternate `user`/`assistant`. Anthropic is stricter about this than OpenAI.
- `max_tokens` is **required** (OpenAI treats it as optional).
- `content` may be a plain string or an array of blocks: `{"type":"text","text":"..."}`,
  `{"type":"image","source":{"type":"base64","media_type":"image/png","data":"..."}}`.
- Stop sequences are `stop_sequences`, not `stop`.

### 3.3 Streaming event types

Anthropic uses **named SSE events**, and every event's `data` also repeats its type in a `type`
field. You must handle both the `event:` line and the in-payload `type`.

Event flow: `message_start` → (`content_block_start` → `content_block_delta`* → `content_block_stop`)*
→ `message_delta`* → `message_stop`. Interleaved with any number of `ping` events. Errors can
arrive mid-stream as `error` events (e.g. `overloaded_error`, which is HTTP 529 in non-streaming
mode). ([Anthropic streaming docs](https://platform.claude.com/docs/en/build-with-claude/streaming))

```
event: message_start
data: {"type":"message_start","message":{"id":"msg_014p7gG3wDgGV9EUtLvnow3U","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":472,"output_tokens":2}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}

event: ping
data: {"type":"ping"}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me consider the scene."}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"EqQBCgIYAhIM1gbcDa9GJrHqd9..."}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: content_block_start
data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"A hooded figure"}}

event: content_block_stop
data: {"type":"content_block_stop","index":1}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":15}}

event: message_stop
data: {"type":"message_stop"}
```

Delta types you will see inside `content_block_delta` (from the TS SDK's
`RawContentBlockDelta` union — [`messages.ts`](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)):

| `delta.type` | Payload | Meaning |
| --- | --- | --- |
| `text_delta` | `{"text": "..."}` | Ordinary visible text increment. |
| `thinking_delta` | `{"thinking": "..."}` | Reasoning increment. Goes to the thinking pane. |
| `signature_delta` | `{"signature": "..."}` | Sent **just before `content_block_stop`** for a thinking block; verifies block integrity. Pass it back unchanged on later turns. |
| `input_json_delta` | `{"partial_json": "..."}` | Tool-call arguments, partial JSON. |
| `citations_delta` | `{"citation": {...}}` | Citation markers on document blocks. |

Event/type notes:

- `message_start.message.stop_reason` is `null` in streaming; it becomes non-null in `message_delta`.
- `message_delta` carries cumulative `usage.output_tokens` — read usage here, not from
  `message_start`.
- Content blocks other than `thinking` can arrive whole with no deltas: `redacted_thinking`,
  server tool results, etc.
- Anthropic's docs explicitly tell you: **new event types may be added — handle unknown types
  gracefully.** A `switch` with a `default: ignore` is correct; a throw is not.

### 3.4 `anthropic-dangerous-direct-browser-access`

Anthropic enabled CORS on their JSON API in August 2024, gated behind this opt-in header, so that
API keys are not silently usable from arbitrary web pages
([Simon Willison's writeup](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/),
[anthropic-sdk-typescript PR #504](https://github.com/anthropics/anthropic-sdk-typescript/pull/504)).
The value is the literal string `"true"`.

Two important caveats:

1. **Org-level CORS policy can still reject you.** Users have reported
   `{"type":"error","error":{"type":"authentication_error","message":"CORS requests are not allowed for this Organization because of its settings..."}}`
   even with the header present. Handle that error explicitly and fall back to your proxy path.
2. Adding this header tells Anthropic "I accept that my key is in the browser". For a local-first
   RPNow that is a reasonable trade; for a hosted deployment, proxy it.

---

## 4. Google Gemini API (native + OpenAI-compat)

Gemini has **two** surfaces and you should know both. The native one is richer; the compat one is
nearly free to support because it is just your OpenAI adapter with a different `baseURL`.

### 4.1 Native endpoint

```http
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
POST https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse
Content-Type: application/json
x-goog-api-key: YOUR_API_KEY
```

- The method-after-colon (`:generateContent`, `:streamGenerateContent`) is the Gemini-specific
  RPC-style URL pattern. It is not a query parameter.
- **`?alt=sse` is mandatory** if you want SSE. Without it, `streamGenerateContent` returns a
  **JSON array** of response objects (newline-delimited, not `data:`-prefixed) — which is a common
  source of "my SSE parser gets nothing" bugs.
- Auth: either `x-goog-api-key: <KEY>` header (preferred) or `?key=<KEY>` query param.

Official example, verbatim from the API reference
([StreamGenerateContent](https://aistudio.google.com/api-reference/generate-content/stream-generate-content)):

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}" \
  -H 'Content-Type: application/json' \
  --no-buffer \
  -d '{ "contents":[{"parts":[{"text": "Write a story about a magic backpack."}]}]}'
```

### 4.2 Native request body

```json
{
  "systemInstruction": {
    "parts": [ { "text": "You are RPNow's narrative engine." } ]
  },
  "contents": [
    { "role": "user",  "parts": [ { "text": "The tavern door creaks open." } ] },
    { "role": "model", "parts": [ { "text": "A hooded figure steps inside." } ] },
    { "role": "user",  "parts": [ { "text": "What does she order?" } ] }
  ],
  "generationConfig": {
    "temperature": 1.0,
    "topP": 0.95,
    "topK": 40,
    "maxOutputTokens": 2048,
    "stopSequences": ["\n\nUser:"]
  },
  "safetySettings": [
    { "category": "HARM_CATEGORY_HARASSMENT",        "threshold": "BLOCK_NONE" },
    { "category": "HARM_CATEGORY_HATE_SPEECH",       "threshold": "BLOCK_NONE" },
    { "category": "HARM_CATEGORY_SEXUALLY_EXPLICIT", "threshold": "BLOCK_NONE" },
    { "category": "HARM_CATEGORY_DANGEROUS_CONTENT", "threshold": "BLOCK_NONE" }
  ]
}
```

Mapping gotchas vs OpenAI:

| OpenAI | Gemini native |
| --- | --- |
| `messages[].role: "system"` | **`systemInstruction`** (top level), parts-based |
| `role: "assistant"` | **`role: "model"`** |
| `content: "string"` | **`parts: [{text}]`** |
| `max_tokens` | **`maxOutputTokens`** (camelCase, inside `generationConfig`) |
| `stop` | **`stopSequences`** |
| `top_p` / `top_k` | **`topP` / `topK`** |
| inline images | `parts[].inlineData: {mimeType, data}` (base64) |

Roles are **exactly** `user` and `model`. There is no `system` role in `contents` and no
`assistant` role — sending either is an error.

### 4.3 SSE chunk shape

Each SSE event `data:` is one `GenerateContentResponse` object. Text arrives split across
`candidates[0].content.parts[].text` — accumulate across chunks; never treat one chunk as a whole
sentence.

```
data: {"candidates":[{"content":{"parts":[{"text":"The tavern"}],"role":"model"},"index":0}],"modelVersion":"gemini-2.5-flash","responseId":"..."}

data: {"candidates":[{"content":{"parts":[{"text":" is warm."}],"role":"model"},"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":18,"candidatesTokenCount":7,"thoughtsTokenCount":0,"totalTokenCount":25},"modelVersion":"gemini-2.5-flash"}
```

Field notes:

- `candidates[].finishReason` is `STOP | MAX_TOKENS | SAFETY | RECITATION | LANGUAGE | OTHER |
  BLOCKLIST | PROHIBITED_CONTENT | SPII | ...`. It is generally only populated on the **final**
  chunk for a candidate.
- `usageMetadata` fields: `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`,
  `cachedContentTokenCount`, `totalTokenCount`.
- `promptFeedback.blockReason` (`SAFETY | OTHER | BLOCKLIST | PROHIBITED_CONTENT | IMAGE_SAFETY`) is
  set when the *prompt* was blocked and **no candidates are returned**. Always check
  `candidates?.length === 0` before indexing.
- Thinking models may stream parts marked as thoughts — see §4.4.

### 4.4 Thinking in native Gemini

Instead of a separate field, Gemini puts reasoning into ordinary `parts[]` with a boolean flag:

```json
{
  "candidates": [{
    "content": { "role": "model", "parts": [
      { "text": "Let me think about the scene...", "thought": true, "thoughtSignature": "..." },
      { "text": "A hooded figure steps inside." }
    ]}
  }]
}
```

Per the Part schema: `thought` — *"Optional. Indicates if the part is thought from the model."* and
`thoughtSignature` — *"Optional. An opaque signature for the thought so it can be reused in
subsequent requests."*

So the rule is: **if `part.thought === true`, route `part.text` to the thinking pane; otherwise it is
visible content.** Do not concatenate them.

Reasoning *effort* is controlled via the thinking configuration — on the compat layer this is passed
through `extra_body` as `thinking_config` (see `extra_body` table below).

### 4.5 Safety settings

`safetySettings` is an array of `{category, threshold}`. Categories use the `HARM_CATEGORY_*` enum
values (`HARM_CATEGORY_HARASSMENT`, `HARM_CATEGORY_HATE_SPEECH`,
`HARM_CATEGORY_SEXUALLY_EXPLICIT`, `HARM_CATEGORY_DANGEROUS_CONTENT`).

Threshold levels: `HARM_BLOCK_THRESHOLD_UNSPECIFIED`, `BLOCK_LOW_AND_ABOVE`,
`BLOCK_MEDIUM_AND_ABOVE`, `BLOCK_ONLY_HIGH`, `BLOCK_NONE`, `OFF`
(`BLOCK_NONE` — all content allowed; `OFF` — turn the safety filter off).

Two practical cautions, both from Google's own docs:

- *"Applications that use less restrictive safety settings may be subject to review."*
- The newer Interactions API documents the default threshold as **Off** for Gemini 2.5 and later,
  and notes that filter category *names differ between the two API surfaces*: the newer surface uses
  lowercase identifiers like `hate_speech`, `harassment`, `sexually_explicit`, `dangerous_content`,
  `jailbreak`, whereas `generateContent` uses the `HARM_CATEGORY_*` constants. **Do not mix them.**
  ([safety settings](https://aistudio.google.com/docs/safety-settings))

⚠️ For a roleplay app, whether `BLOCK_NONE` is honoured for a given model/account is not guaranteed
and can change. Treat blocked generations (`blockReason` / `finishReason: SAFETY`) as expected
outcomes with a user-visible message, not as crashes.

### 4.6 OpenAI-compatible endpoint — confirmed path

**`https://generativelanguage.googleapis.com/v1beta/openai/`** — so chat completions is:

```http
POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
Authorization: Bearer GEMINI_API_KEY
Content-Type: application/json
```

Confirmed in Google's own [OpenAI compatibility guide](https://ai.google.dev/gemini-api/docs/openai),
which uses exactly `base_url="https://generativelanguage.googleapis.com/v1beta/openai/"` with the
standard `openai` Python client.

Supported compat surfaces: `/chat/completions`, `/models`, `/embeddings`, `/images/generations`,
batch, and `service_tier`.

Unsupported / dropped parameters: *"Any other parameters not listed here or in the `extra_body`
section will be silently ignored by the compatibility layer."* — note **silently**, so a typo'd
parameter fails quietly.

`extra_body` escape hatch for Gemini-only features:

| `extra_body` key | Type | Endpoint | Meaning |
| --- | --- | --- | --- |
| `cached_content` | string | Chat | Gemini context cache handle |
| `thinking_config` | object | Chat | Gemini `ThinkingConfig` |
| `aspect_ratio` | string | Images | `"16:9"`, `"1:1"`, `"9:16"`, … |
| `generation_config` | object | Images | e.g. `{"responseModalities":["IMAGE"],"candidateCount":2}` |
| `safety_settings` | array | Images | e.g. `[{"category":"HARM_CATEGORY_HATE_SPEECH","threshold":"BLOCK_NONE"}]` |
| `tools` | array | Images | Grounding, e.g. `[{"google_search":{}}]` (Gemini 3+ only) |

Gemini's compat layer *does* support `stream_options: {'include_usage': True}` — the official
sample passes it — but as always, verify per model.

---

## 5. Image generation

This section is deliberately long. Image APIs are far less standardised than chat APIs and each one
has a distinct response-encoding problem.

### 5.1 OpenAI GPT Image (`gpt-image-1` / `gpt-image-1.5`)

#### Endpoints

```http
POST https://api.openai.com/v1/images/generations     # text -> image
POST https://api.openai.com/v1/images/edits           # image/mask + prompt (multipart/form-data)
```

#### ⚠️ Model availability warning (important, and easy to miss)

The OpenAI Python SDK's generated type file states plainly:

> `gpt-image-1` was shut down on October 23, 2026. Use `gpt-image-2.5-sunburst` or
> `gpt-image-2.5-flare` instead.
>
> Deprecated values: `"dall-e-2"`, `"dall-e-3"`: This model was retired on May 12, 2026.

([`image_generate_params.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/image_generate_params.py))

Critically, **`gpt-image-1.5` is still listed as supported** in the same enum. So: prefer
`gpt-image-1.5` for compatibility with the parameter set described here, but expect to migrate to
`gpt-image-2`/`2.5` ids, which add arbitrary `WxH` sizes and extra quality levels. Build the model id
as configuration, not as a constant.

#### Request parameters (`POST /v1/images/generations`, JSON)

| Field | Type | Values / notes |
| --- | --- | --- |
| `model` | string | `gpt-image-1.5`, `gpt-image-1-mini`, `gpt-image-2`, … |
| `prompt` | string **required** | Max **32000** characters for GPT image models |
| `size` | string | `auto`, `"1024x1024"`, `"1536x1024"` (landscape), `"1024x1536"` (portrait). Newer `gpt-image-2`+ accept arbitrary `WIDTHxHEIGHT` where both are divisible by **16** and the aspect ratio is between **1:3 and 3:1**, max `3840x2160` ⚠️ |
| `quality` | string | `low` \| `medium` \| `high` \| `auto`. (`standard`/`hd` are retired DALL·E values; `xhigh`/`max` only on gpt-image-2.5+) |
| `n` | int | 1–10 |
| `background` | string | `transparent` \| `opaque` \| `auto`. Requires `output_format` of `png` or `webp` when `transparent` |
| `output_format` | string | `png` \| `webp` \| `jpeg` (+ `gif`,`svg` on newer models). Default `png` |
| `output_compression` | int | 0–100, only for `webp`/`jpeg`. Default 100 |
| `moderation` | string | `low` \| `auto` |
| `stream` | bool | Enables partial-image streaming (GPT image models only) |
| `partial_images` | int | 0–3. With `stream`, how many intermediate frames to emit |
| `response_format` | — | **Explicitly "Unsupported for GPT image models, which always return base64-encoded images."** |

Two traps for a roleplay app:

1. **There is no `response_format: "url"` for GPT image models.** You always get base64. Budget the
   payload size (a 1024×1024 PNG is routinely >1 MB as base64). Render with
   `data:image/png;base64,...` and store bytes, not data URIs, long-term.
2. **`transparent` background requires png/webp.** If you want transparent character cut-outs, set
   both `background: "transparent"` *and* `output_format: "png"`.

#### Response shape (JSON)

```json
{
  "created": 1730000000,
  "background": "opaque",
  "output_format": "png",
  "quality": "high",
  "size": "1024x1024",
  "data": [
    { "b64_json": "iVBORw0KGgoAAAANSUhEUg..." }
  ],
  "usage": {
    "input_tokens": 50,
    "input_tokens_details": { "image_tokens": 0, "text_tokens": 50 },
    "output_tokens": 4160,
    "total_tokens": 4210,
    "output_tokens_details": { "image_tokens": 4160, "text_tokens": 0 }
  }
}
```

`data[]` is an array of `Image` objects with `b64_json` (always populated for GPT image models),
`url` (only for models that support `response_format: "url"` — not GPT image models), and
`revised_prompt` (*"Not returned by GPT image models"*).

#### Streaming / partial images

When `stream: true`, the endpoint returns SSE whose `data:` payloads are discriminated by `type`:

`image_generation.partial_image`:

```json
{
  "type": "image_generation.partial_image",
  "b64_json": "iVBORw0KGgo...",
  "partial_image_index": 0,
  "created_at": 1730000000,
  "size": "1024x1024",
  "quality": "high",
  "background": "opaque",
  "output_format": "png"
}
```

`image_generation.completed`:

```json
{
  "type": "image_generation.completed",
  "b64_json": "iVBORw0KGgo...",
  "created_at": 1730000000,
  "size": "1024x1024",
  "quality": "high",
  "background": "opaque",
  "output_format": "png",
  "usage": {
    "input_tokens": 50,
    "input_tokens_details": { "image_tokens": 0, "text_tokens": 50 },
    "output_tokens": 4160,
    "total_tokens": 4210
  }
}
```

Notes: `partial_image_index` is **0-based**. Google/OpenAI both warn that the final image may arrive
before the full count of partial images if generation finishes quickly — so the completion event, not
a counter, is what ends the stream. Source:
[`image_gen_partial_image_event.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/image_gen_partial_image_event.py),
[`image_gen_completed_event.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/image_gen_completed_event.py).

This is a genuinely nice UX primitive for RPNow: set `partial_images: 2` and paint a blurry
preview while the real image renders.

#### Image edit endpoint

`POST /v1/images/edits` is **`multipart/form-data`**, not JSON. Fields:

| Field | Notes |
| --- | --- |
| `image` | required; PNG/WebP/JPG < 50 MB each; **up to 16 images** for GPT image models. Repeat the field for multiple files |
| `prompt` | required, ≤32000 chars |
| `mask` | optional PNG < 4 MB, same dimensions as `image`; **fully transparent areas = where to edit**. Applied to the first image if multiple |
| `model` | e.g. `gpt-image-1.5` |
| `size`, `quality`, `n`, `background`, `output_format`, `output_compression`, `stream`, `partial_images` | same semantics as generations |
| `input_fidelity` | `high` \| `low` — *"Supports `high` and `low` on `gpt-image-1.5`; `gpt-image-1-mini` supports only `low`. For `gpt-image-2`, omit this parameter. Defaults to `low`"* |

```bash
curl -s https://api.openai.com/v1/images/edits \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -F "model=gpt-image-1.5" \
  -F "image=@./character.png" \
  -F "mask=@./mask.png" \
  -F "prompt=Change the outfit to a rain-soaked travelling cloak." \
  -F "size=1024x1536" \
  -F "quality=high"
```

Response shape is identical to generations (`data[].b64_json`). The edit endpoint streams the same
two event types (`ImageEditPartialImageEvent` / `ImageEditCompletedEvent`).

`input_fidelity: "high"` is the parameter that matters most for character consistency in roleplay —
it tells the model to work harder to preserve facial features of the input image.

---

### 5.2 Volcengine Ark — Seedream (火山引擎 / 字节豆包)

There are two live hosts for the same API. Pick by account/region:

- **Volcengine (China):** `https://ark.cn-beijing.volces.com/api/v3/images/generations`
- **BytePlus ModelArk (international):** `https://ark.ap-southeast.bytepluses.com/api/v3/images/generations`

#### Request

```http
POST https://ark.cn-beijing.volces.com/api/v3/images/generations
Content-Type: application/json
Authorization: Bearer $ARK_API_KEY
```

```json
{
  "model": "doubao-seedream-4-0-250828",
  "prompt": "Vibrant close-up editorial portrait, dramatic studio lighting.",
  "size": "2K",
  "output_format": "png",
  "response_format": "url",
  "watermark": false
}
```

#### Model ids (the `-YYYYMMDD` suffix is part of the id)

| Model | Model ID |
| --- | --- |
| Seedream 4.0 | `doubao-seedream-4-0-250828` |
| Seedream 4.0 (BytePlus naming) | `seedream-4-0-250828` |
| Seedream 4.5 | `seedream-4-5-251128` |
| Seedream 5.0 lite | `seedream-5-0-260128` (alias `seedream-5-0-lite-260128`) |
| Seedream 5.0 pro | `dola-seedream-5-0-pro-260628` |
| Seedream 5.0 flash | `dola-seedream-5-0-flash-260915` |
| Seedream 5.5 | `dola-seedream-5-5-261028` |

> **Yes, "Seedream 5" exists** — in fact 5.0 lite/pro/flash and 5.5 are all live, and the naming has
> split: the highest-end models carry a **`dola-` prefix**. Separately, the Volcengine console marks
> `doubao-seedream-4-0-250828` as **"即将下线" (scheduled for retirement)** — so a new integration
> should default to 4.5 or 5.x rather than 4.0. Source:
> [BytePlus ModelArk image-generation tutorial](https://docs.byteplus.com/en/docs/modelark/image-generation-tutorial),
> [Volcengine model detail](https://console.volcengine.com/ark/region:cn-beijing/model/detail?name=doubao-seedream-4-0).

#### Request parameters

| Field | Type | Notes |
| --- | --- | --- |
| `model` | string | required |
| `prompt` | string | text prompt |
| `image` | string \| string[] | reference image(s) for image-to-image / blending. 4.0/4.5 accept up to 14 references; 5.x up to 10 |
| `size` | string | **Two mutually exclusive modes.** Mode 1: resolution preset `"1K"`/`"2K"`/`"4K"` (varies by model; 4.0 supports 1K/2K/4K). Mode 2: explicit `"WIDTHxHEIGHT"` in pixels. You must not mix them |
| `response_format` | string | `url` (default) or `b64_json` |
| `watermark` | boolean | **default `true`** — set `false` explicitly or you get a watermark |
| `output_format` | string | `png` or `jpeg` (4.0/4.5 are `jpeg` only per the capability table ⚠️; 5.x adds png) |
| `sequential_image_generation` | string | `"disabled"` (default) or `"auto"` — enables 组图 / multi-image output |
| `sequential_image_generation_options` | object | e.g. `{"max_images": 4}` ⚠️ exact key set |
| `stream` | boolean | default `false` |
| `optimize_prompt_options` | object | `{"mode": "standard" \| "fast"}` prompt optimisation |
| `background` | string | transparency mode (5.x) |
| `safety_identifier` | string | end-user id for safety monitoring |

**Pixel bounds matter.** Seedream 4.0 enforces both a total-pixel range and an aspect-ratio range.
The documented valid range for explicit sizes is roughly `[1280x720 … 4096x4096]` with aspect ratio
between 1/16 and 16, and a minimum of 921,600 total pixels — so `800x800` (640,000 px) is **invalid**
while `1600x600` (960,000 px, ratio 8:3) is valid
([Volcengine image generation API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh)).
If you let users pick a size, clamp it yourself rather than round-tripping a 400.

#### Response shape

```json
{
  "model": "doubao-seedream-4-0-250828",
  "created": 1784696685,
  "data": [
    { "url": "https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com/...", "size": "2048x2048" }
  ],
  "usage": { "generated_images": 1, "output_tokens": 16384, "total_tokens": 16384 }
}
```

Key facts:

- `data[].url` is a **signed URL valid for 24 hours**. *"The URL is valid for 24 hours after
  generation. Download or persist the image promptly."* — For RPNow, this means you **must** fetch
  and re-store the bytes; a stored Ark URL will rot overnight.
- `data[].size` reports the **actual** generated size, which may differ from what you asked for when
  you used a `1K`/`2K` preset — the model picks the closest aspect.
- `usage.generated_images` counts only successes (and only successes are billed).
- With `response_format: "b64_json"` the objects carry `b64_json` instead of `url`.
- Failures can be **partial**: with multi-image generation some images succeed and others don't, and
  the response includes an `error` object alongside partial `data`.

#### Streaming events

With `"stream": true` the response is SSE with these event types:

- `image_generation.partial_succeeded` — `{type, model, created, image_index, url (if response_format=url), b64_json (if b64_json), size}`
- `image_generation.partial_failed` — `{type, model, created, image_index, error:{code,message}}`
- `image_generation.completed` — `{type, model, created, usage:{generated_images, output_tokens, total_tokens}}`
- `error` — `{error:{code, message}}`

Note the asymmetry vs OpenAI: Ark has **no** progressive-diffusion partial images. Its "partial" means
"one of N images finished", not "a blurry version of this image". Don't build a preview UI on it.
Source: [ModelArk streaming response](https://docs.byteplus.com/en/docs/modelark/image-generation-streaming-responses).

---

### 5.3 NovelAI (NAI) — the hard one

NovelAI is the odd one out: binary-packed responses, no CORS, and a request body that is
semi-documented. Good news: **the official OpenAPI spec is public and fetchable**, which is what I
used as the primary source below.

#### Endpoints

```http
POST https://image.novelai.net/ai/generate-image        # main generation
POST https://image.novelai.net/ai/generate-image-stream # SSE/msgpack progress streaming
POST https://image.novelai.net/ai/encode-vibe           # vibe transfer encode
POST https://image.novelai.net/ai/augment-image         # Director Tools
POST https://text.novelai.net/oa/v1/chat/completions    # OpenAI-compatible TEXT
GET  https://text.novelai.net/oa/v1/models
POST https://text.novelai.net/oa/v1/completions
```

Spec: `https://image.novelai.net/docs/doc.json` (Swagger; human UI at
`https://image.novelai.net/docs/index.html`).

#### Auth

```http
Authorization: Bearer pst-xxxxxxxx...
```

You need a **Persistent API Token**, obtained from NovelAI's User Settings → Account →
**Get Persistent API Token**. It is prefixed `pst-`. Do **not** use an email/password login token —
the official docs say: *"you need to request a user's Persistent API token for integration and use it
in the Authorization header."* The generic `Authorization` API-key scheme is declared in the spec as
`ApiKeyAuth` with `name: Authorization, in: header`.

#### Request body

```json
{
  "input": "1girl, silver hair, tavern, candlelight, masterpiece, best quality",
  "model": "nai-diffusion-4-5-full",
  "action": "generate",
  "parameters": {
    "width": 832,
    "height": 1216,
    "scale": 5.0,
    "sampler": "k_euler_ancestral",
    "steps": 28,
    "n_samples": 1,
    "ucPreset": 0,
    "qualityToggle": true,
    "negative_prompt": "lowres, bad anatomy, bad hands, jpeg artifacts",
    "seed": 1234567890,
    "sm": false,
    "sm_dyn": false,
    "noise_schedule": "karras",
    "cfg_rescale": 0,
    "skip_cfg_above_sigma": null
  }
}
```

Top level (from `image.ImageGenerationRequest` in the official spec): `action`, `input`, `model`,
`parameters`, `url`.

**`input` is the positive prompt** and `parameters.prompt` also exists (the spec lists both) — the
web UI sends `input`. Send `input` and you match the client.

#### `parameters` — confirmed keys

From `image.RequestParameters` in the official spec (this is the authoritative list):

`add_original_image`, `cfg_rescale`, `color_correct`, `controlnet_condition`, `controlnet_model`,
`controlnet_strength`, `deliberate_euler_ancestral_bug`, `director_reference_*` (7 keys),
`dynamic_thresholding`, `extra_noise_seed`, `height`, `image`, `image_format`, `img2img`, `legacy`,
`legacy_v3_extend`, `mask`, `n_samples`, `negative_prompt`, `noise`, `noise_schedule`,
`params_version`, `prefer_brownian`, `prompt`, `qualityToggle`, `reference_image`,
`reference_image_multiple`, `reference_information_extracted`,
`reference_information_extracted_multiple`, `reference_strength`, `reference_strength_multiple`,
`sampler`, `scale`, `seed`, `skip_cfg_above_sigma`, `sm`, `sm_dyn`, `steps`, `straight_alpha`,
`stream`, `strength`, `tag_hint_qt`, `tag_hint_transparent_background`, `tag_hint_uc_preset`,
`ucPreset`, `upscale`, `upscaled_enhance`, `v4_negative_prompt`, `v4_prompt`, `width`.

Notes on the fields actually used in practice:

| Field | Type | Typical / sensible value |
| --- | --- | --- |
| `width` / `height` | int | **Multiples of 64**, range **64–1600**. Portrait 832×1216, landscape 1216×832, square 1024×1024 |
| `scale` | float | CFG; 0–10, default ~5.0 |
| `sampler` | string | `k_euler_ancestral`, `k_euler`, `ddim`, `k_dpmpp_2m`, … |
| `steps` | int | 1–50; 28 typical for V4.5 |
| `n_samples` | int | 1–8 |
| `ucPreset` | int | 0 = heavy (Heavy), 1 = light, 2 = human focus, 3 = furry focus. **0 = "Heavy" is the web default** ⚠️ mapping order verified against community SDKs, not the spec text |
| `qualityToggle` | bool | Appends quality tags (`best quality, amazing quality, very aesthetic, absurdres`) — the "Quality Tags" checkbox |
| `negative_prompt` | string | merged with the UC preset text |
| `seed` | int | 0 = random |
| `sm` / `sm_dyn` | bool | SMEA / SMEA DYN sampling. Historical fields; marked `(inop)` in one community SDK ⚠️ still accepted, effect model-dependent |
| `noise_schedule` | string | `karras`, `native`, `exponential`, `polyexponential` |
| `cfg_rescale` | float | 0–1, V4+ only |
| `skip_cfg_above_sigma` | number | this is what the UI calls **Variety Boost** |
| `image_format` | `"png"` \| `"webp"` | webp is lossless |
| `v4_prompt` / `v4_negative_prompt` | object | V4/V4.5 structured prompt: `{caption:{base_caption, char_captions[]}, use_coords, use_order, legacy_uc}` |
| `image` | string | base64 source image for img2img |
| `strength` / `noise` | float | img2img strength / noise |
| `mask` | string | base64 mask for inpainting |

#### Model ids

**V5 (current flagship):** `nai-diffusion-5-full`, `nai-diffusion-5-full-medium`,
`nai-diffusion-5-curated`, plus `-inpainting` variants.
**V4.5:** `nai-diffusion-4-5-full`, `nai-diffusion-4-5-curated`, plus `-inpainting`.
**V4:** `nai-diffusion-4-full`, `nai-diffusion-4-curated-preview`.
**V3:** `nai-diffusion-3`, `nai-diffusion-3-furry`.

(Sourced from the community SDK's model enum, which tracks the web UI closely —
[novelai-sdk on PyPI](https://pypi.org/project/novelai-sdk/).)

Model quirks worth encoding:

- `nai-diffusion-5-full-medium` **always** runs 14 steps, `k_euler_ancestral`, UC preset `strong`,
  and **takes no negative prompts / no cfg_rescale**. Sending those is an error.
- **V5 does not support Vibe Transfer / ControlNet.** Character Reference is V4.5-only.
- `qualityToggle` behaviour and UC preset availability differ per model.

#### ⚠️ The ZIP-wrapped response problem

**This is the single most important thing to know about NAI's image API.** By default
`/ai/generate-image` responds `201` with `Content-Type: application/zip`, containing one entry per
generated image (e.g. `image_0.png`, `image_1.png`). A naive `fetch(...).then(r => r.blob())` gives
you a ZIP file that the browser cannot display directly.

**Three ways clients solve it, in order of preference:**

**(1) Ask for JSON instead of ZIP — best option, and it is officially supported.**

The official spec declares `produces: ["application/zip", "application/json"]` and documents the
`201` response as:

> *"A JSON array of base64-encoded images (when `Accept: application/json` is sent)."*

Schema `image.ImageGenerationJsonResponse`:

```json
{
  "images": [
    { "image": "<base64>", "index": 0, "seed": 1234567890 }
  ]
}
```

So:

```bash
curl -s https://image.novelai.net/ai/generate-image \
  -H "Authorization: Bearer pst-..." \
  -H "Content-Type: application/json" \
  -H "Accept: application/json" \
  -d @body.json
```

This sidesteps ZIP parsing entirely. Note the spec also documents a multipart form
(`files: request=("blob", json, "application/json")`) — that is how the web UI posts, and the
`request` part is the JSON body above. JSON `POST` with `Accept: application/json` is the cleaner
path for a third-party client. ⚠️ Some community clients still post multipart; both should work, but
test against a real account before committing.

**(2) Parse the ZIP in the browser.** Use `fflate` (`unzipSync`) or `JSZip`. A ZIP entry is a PNG,
so `URL.createObjectURL(new Blob([bytes], {type:'image/png'}))` works. This is what happens when
you cannot control the `Accept` header. Cost: ~10 KB of library, sync decompress.

**(3) Proxy through a server** that unzips and returns PNG bytes. Correct and simple, but requires
a backend (§6).

> Historical note: some older writeups describe the response as *MessagePack* rather than ZIP. The
> current official spec (`image.ImageGenerationJsonResponse`, `produces: application/zip`, and the
> `Accept: application/json` JSON response) supersedes that — the *final* image response is
> **ZIP or JSON**. MessagePack (`stream: "msgpack"`) applies to the **streaming** progress channel
> (`/ai/generate-image-stream`), where `image.StreamingType` is `enum ["msgpack", "sse"]`.

#### Streaming progress

`POST https://image.novelai.net/ai/generate-image-stream` with `parameters.stream` set to `"sse"` or
`"msgpack"`. SSE chunk payloads look like:

```json
{ "event_type": "intermediate", "samp_ix": 0, "step_ix": 12, "gen_id": 1234567, "sigma": 4.15, "image": "<base64>" }
```

`event_type` is `intermediate` or `final`. This gives you a real step-by-step preview (unlike Ark).

#### CORS limitations — confirmed by probe

I ran a live preflight against the real host:

```
OPTIONS https://image.novelai.net/ai/generate-image
→ HTTP 405 (Method Not Allowed), headers: Connection, allow, alt-svc, vary, cf-cache-status,
  Server-Timing, CF-RAY, Content-Length, Date, Server
→ No Access-Control-Allow-Origin. No Access-Control-Allow-Headers. No Access-Control-Allow-Methods.
```

**NovelAI does not support CORS.** The preflight fails, so **a browser cannot call
`image.novelai.net` directly at all** — you will get an opaque CORS failure before your bearer token
is even considered.

Solutions, ranked:

1. **A local/server proxy** (`POST /api/nai/generate` on your own origin) that attaches the user's
   `pst-` token server-side. This is the only robust option for a packaged app with a backend.
2. **A local desktop-app process** — if RPNow ships as an Electron/Tauri app, do the request in the
   main/backend process and pass bytes to the renderer over IPC. No CORS in the way at all.
3. **A public CORS-bypass proxy** — technically works, but you would be sending a user's NovelAI
   token through a third party. Do not do this.
4. **`fetch` with `mode: "no-cors"`** — gets you an opaque response you cannot read. Useless here.

For a purely browser-hosted build, NovelAI is simply not reachable without your own proxy.

#### NovelAI OpenAI-compatible text endpoint — yes, it exists

Confirmed in the official spec (`/oa/v1/chat/completions`, `/oa/v1/completions`, `/oa/v1/models`,
`/oa/v1/internal/token-count` on the `image.novelai.net` doc, and documented as the Text Generation
API on `https://text.novelai.net/docs/index.html`):

```
POST https://text.novelai.net/oa/v1/chat/completions
Authorization: Bearer pst-...
```

⚠️ **Critical caveat:** this OpenAI-compat surface serves **GLM models** (`glm-4-5`, `glm-4-6`),
**not** NovelAI's own story models. NovelAI's own models (Erato/Kayra/Clio, `llama-3-erato-v1`,
`kayra-v1`, `clio-v1`) are served by the *native* text API at `POST https://text.novelai.net/ai/generate`
and `/ai/generate-stream` — which is **not** OpenAI-shaped and has its own `AiGenerateParameters`
schema ([spec](https://text.novelai.net/docs/index.html)).

This matters a lot for RPNow: the whole selling point of NAI text is its prose models, and those are
**not** reachable through `/oa/v1`. The `/oa/v1` request schema is also slightly extended
(`enable_thinking`, `min_p`, `top_k`, `best_of`, `echo`, `generation_prefix`,
`frequency_penalty`, `presence_penalty`, `logit_bias`, `stop`, `suffix`, `unified_*` samplers).

---

### 5.4 Stability AI

```http
POST https://api.stability.ai/v2beta/stable-image/generate/{core|sd3|ultra}
Authorization: Bearer sk-...
Accept: image/*        # or application/json
Content-Type: multipart/form-data
```

- The modern v2beta endpoints are **multipart**, and you **must** send `Accept: image/*` to get raw
  bytes; otherwise the default JSON response is `{"image":"<base64>","finish_reason":"SUCCESS","seed":0}`
  ⚠️.
- Core parameters: `prompt` (required), `negative_prompt`, `aspect_ratio` (`1:1`, `16:9`, `21:9`,
  `2:3`, `3:2`, `4:5`, `5:4`, `9:16`, `9:21`), `seed`, `output_format` (`png`|`jpeg`|`webp`), `model`
  for `sd3` (`sd3.5-large`, `sd3.5-large-turbo`, `sd3.5-medium`), `strength`/`image` for
  image-to-image, `cfg_scale`, `style_preset`.
- **Content moderation**: Stability applies a safety filter and returns a `finish_reason` other than
  `SUCCESS` (e.g. `CONTENT_FILTERED`) with a 200 status on some endpoints — check `finish_reason`,
  don't assume success from the HTTP code.
- Stability **does** send `Access-Control-Allow-Origin` on its API host (my `OPTIONS` probe returned
  `204` with the header) ⚠️ but I could not confirm it works with `Authorization` from a browser;
  keep the proxy path available.
- ⚠️ uncertain: exact v2beta path set and which models remain served; Stability's model lineup
  changes frequently. Check `https://platform.stability.ai/docs/api-reference` before implementing.

---

### 5.5 Google Imagen (via Gemini API)

```http
POST https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict
x-goog-api-key: $GEMINI_API_KEY
```

```json
{
  "instances": [ { "prompt": "A hooded traveller in a candlelit tavern, oil painting" } ],
  "parameters": {
    "sampleCount": 1,
    "aspectRatio": "1:1",
    "personGeneration": "allow_adult",
    "safetySetting": "block_low_and_above"
  }
}
```

- Note the method is **`:predict`**, not `:generateContent` — a different RPC with a different body
  shape (`instances[]` + `parameters`).
- `instances[].prompt` is the only instance field. `parameters`: `sampleCount` (1–4; **clamped to 1
  for "ultra" models**), `aspectRatio` (`1:1`, `3:4`, `4:3`, `9:16`, `16:9`), `personGeneration`
  (`dont_allow` | `allow_adult` | `allow_all`), `safetySetting`
  (`block_low_and_above` | `block_medium_and_above` | `block_only_high` | `block_none`).
  ([promptfoo's Imagen provider](https://github.com/promptfoo/promptfoo/pull/5104/files) mirrors
  exactly this wire format.)
- Response: `{"predictions":[{"bytesBase64Encoded":"...","mimeType":"image/png"}]}` ⚠️.
- `personGeneration: "allow_adult"` is as permissive as this API gets; there is no `allow_all`
  equivalent for realistic adult content on all models.
- ⚠️ Model ids: `imagen-4.0-generate-001`, `imagen-4.0-ultra-generate-001`,
  `imagen-3.0-generate-002`. Verify against `GET /v1beta/models`.

Note also that Gemini's **image-output Gemini models** (e.g. `gemini-2.5-flash-image`,
`gemini-3-pro-image-preview`) are a *different path* — they are called through
`generateContent`/OpenAI-compat `/images/generations`, not `:predict`.

---

### 5.6 FLUX via Black Forest Labs (BFL) API

BFL is **asynchronous by design** — you submit, then poll. This is a fundamentally different control
flow from every other image API here.

```http
POST https://api.bfl.ai/v1/flux-pro-1.1
x-key: $BFL_API_KEY
Content-Type: application/json
```

```json
{ "prompt": "A hooded traveller in a candlelit tavern", "width": 1024, "height": 1024, "steps": 25, "seed": 42 }
```

Response gives an id to poll:

```json
{ "id": "7f1b...", "polling_url": "https://api.bfl.ai/v1/get_result?id=7f1b..." }
```

```http
GET https://api.bfl.ai/v1/get_result?id=7f1b...
x-key: $BFL_API_KEY
```

```json
{ "id": "7f1b...", "status": "Ready", "result": { "sample": "https://delivery.../image.jpeg" } }
```

- `status` values: `Task not found` | `Pending` | `Request Moderated` | `Content Moderated` |
  `Ready` | `Error`. Poll every ~0.5–1 s; typical completion in 2–10 s.
- `result.sample` is a **signed URL that expires** (documented as ~10 minutes) — download immediately.
- Endpoint ids: `flux-pro-1.1`, `flux-pro-1.1-ultra`, `flux-dev`, `flux-kontext-pro`,
  `flux-kontext-max` (Kontext = instruction-based editing).
- Parameters: `prompt`, `width`/`height` (multiples of 32, 256–1440), `steps` (1–50), `seed`,
  `guidance` (1.5–5), `prompt_upsampling`, `safety_tolerance` (0–6), `output_format`
  (`jpeg`|`png`), `aspect_ratio` (ultra instead of width/height).
- **`flux-kontext-*`** is the one you want for "change the outfit but keep the character" — it takes
  `input_image` plus an instruction prompt.
- Async + polling means BFL is **not** suitable for a browser-direct integration in the same way the
  others are, and I measured no CORS headers on `get_result` (405 on `OPTIONS`, no ACAO).

---

## 6. CORS reality check

This section is based on **live probes I ran against the real hosts on 2026-11-15**, plus vendor
documentation. Method: send an `OPTIONS` preflight and then an authenticated `GET`/`POST` carrying
`Origin: https://app.example.com` and a dummy `Bearer` token, then read back
`Access-Control-Allow-Origin`.

**Read this before trusting any row.** A missing ACAO header can have three causes: (a) the API
genuinely has no CORS support, (b) an edge WAF rejected my request before CORS handling, or (c) the
host varies by region/account. Where a probe was inconclusive I say so.

### 6.1 Summary matrix

| Provider | ACAO observed from browser-style request | Verdict for browser-direct |
| --- | --- | --- |
| **OpenAI** | none (403 from edge WAF) | ❌ **No** — OpenAI does not allow browser CORS for API keys. Proxy required. |
| **Anthropic** | ⚠️ probe blocked at network level | ✅ **Yes, with opt-in header** `anthropic-dangerous-direct-browser-access: true`. Org policy can override. |
| **Google Gemini** | ⚠️ probe blocked at network level | ✅ **Yes** — Gemini has long supported browser calls with an API key. |
| **OpenRouter** | `*` (preflight 204) | ✅ **Yes** |
| **Perplexity** | `*` | ✅ Yes (⚠️ rate-limit/abuse restrictions may apply) |
| **xAI (Grok)** | `*` | ✅ Yes |
| **Together AI** | `*` | ✅ Yes |
| **Mistral** | `*` | ✅ Yes |
| **DeepInfra** | none observed (405 on OPTIONS) | ⚠️ Uncertain — assume no, proxy |
| **Novita** | `*` | ✅ Yes |
| **Nebius** | `*` | ✅ Yes |
| **SiliconFlow** | `*` | ✅ Yes |
| **AI21** | `*` | ✅ Yes |
| **Cohere** | `*` (v2/chat) | ✅ Yes |
| **Baidu Qianfan** | `*` | ✅ Yes |
| **Moonshot / Kimi** | echoes origin | ✅ Yes |
| **MiniMax** | echoes origin; allow-headers list includes `Authorization` | ✅ Yes |
| **Baichuan** | echoes origin; allow-headers includes `Authorization` | ✅ Yes |
| **Tencent Hunyuan** | echoes origin | ✅ Yes |
| **Hyperbolic** | echoes origin (404 on that path first) | ✅ Likely yes ⚠️ |
| **DeepSeek** | none observed (200 on OPTIONS, no ACAO) | ⚠️ Uncertain — **assume no**, proxy |
| **Zhipu BigModel** | none observed (401, no ACAO) | ⚠️ Uncertain — assume no, proxy |
| **DashScope / Qwen** | none observed | ⚠️ Uncertain — assume no, proxy |
| **GitHub Models** | none observed (200, no ACAO) | ❌ No |
| **Cerebras** | none (403 from WAF) | ❌ No / ⚠️ |
| **Groq** | none (403 from WAF) | ❌ No / ⚠️ |
| **Volcengine Ark** | none observed | ❌ No — proxy required |
| **iFlytek Spark** | none observed (401) | ❌ No |
| **StepFun** | none observed | ❌ No |
| **Fireworks** | none observed (405) | ❌ No |
| **Stability AI** | `204` with ACAO present ⚠️ | ⚠️ Partial — needs verification with real auth |
| **BFL / FLUX** | none observed (405/422) | ❌ No — plus async polling |
| **NovelAI (image)** | **none; OPTIONS returns 405** | ❌ **No — hard blocker.** Proxy or desktop backend required |
| **Ollama / LM Studio / vLLM / KoboldCpp / text-gen-webui** | n/a (localhost) | ✅ **Yes — must configure CORS** |

### 6.2 The localhost caveat — config, not code

For self-hosted local servers, CORS is **off by default** and you enable it explicitly. This is a
user-facing config step RPNow must document, because the default failure is an opaque browser error.

- **Ollama.** Cross-origin requests are **blocked by default** since Ollama added `OLLAMA_ORIGINS`
  enforcement. To let a web app on another origin call it, the user must start the server with the
  origin allow-listed:

  ```bash
  # macOS
  launchctl setenv OLLAMA_ORIGINS "http://localhost:5173,https://rpnow.app"
  # Linux (systemd)
  systemctl edit ollama.service   # add: Environment="OLLAMA_ORIGINS=*"
  # Windows (env var, then restart Ollama)
  setx OLLAMA_ORIGINS "*"
  ```

  `*` allows every origin. Ollama's OpenAI-compatible base is `http://localhost:11434/v1`.
- **LM Studio.** Start the local server from the Developer tab and **enable "Enable CORS"** (recent
  versions expose a CORS toggle and a per-origin allow list). Base: `http://localhost:1234/v1`.
- **vLLM.** vLLM's OpenAI server sets permissive CORS by default; use `--allowed-origins` to tighten
  it. Base: `http://localhost:8000/v1`.
- **KoboldCpp.** Run with `--cors` (or `--cors-allow-origin`). Base: `http://localhost:5001/v1`.
- **text-generation-webui.** Launch with `--api --api-all-origins`. Base: `http://localhost:5000/v1` ⚠️.

For desktop-packaged RPNow (Electron/Tauri), the cleanest answer for **all** of the above — including
NovelAI, OpenAI, Ark, and every ❌ row — is to do the HTTP call in the **main/backend process** and
ship bytes to the renderer over IPC. That removes CORS as a design constraint entirely, at the cost
of one IPC boundary.

### 6.3 Recommended architecture given all of the above

```
┌─────────────── Browser renderer ───────────────┐
│  Chat UI / Image grid                          │
│      │ direct fetch (if provider allows CORS)   │
│      └──────────────────────────────────┐       │
│      │ IPC  (desktop build)              │       │
└──────┼───────────────────────────────────┼──────┘
       │                                   ▼
┌──────▼───────────┐            ╔══════════════════════════╗
│ Rust/Node backend│            ║ Public CORS-friendly APIs ║
│  • NovelAI proxy ║            ║  OpenRouter, Anthropic    ║
│  • OpenAI proxy  ║            ║  Gemini, Moonshot, MiniMax║
│  • Ark proxy     ║            ║  Baichuan, Hunyuan, xAI…  ║
│  • Ollama bridge ║            ╚══════════════════════════╝
└──────────────────┘
```

Rule of thumb: **if the provider does not return `Access-Control-Allow-Origin`, it needs a backend
path** — and since you already need a backend for NovelAI (the flagship roleplay image provider),
build one generic "provider proxy" endpoint with an allowlist of upstream hosts, rather than N
bespoke proxies.

---

## 7. Appendix: what to build in an adapter layer

Condensed implementation notes, distilled from everything above.

### 7.1 Adapter interface (conceptual)

```
ChatAdapter
  id, label
  baseURL: string | null
  authHeaders(apiKey): Record<string,string>
  buildRequest(messages, system, opts): unknown
  parseSSEChunk(raw): { text?, thinking?, toolCall?, usage?, finishReason? } | null
  isDone(raw): boolean
```

Two concrete adapters plus one generic:

| Adapter | Used by |
| --- | --- |
| `OpenAICompatAdapter` | ~30 providers. Handles `data: {...}` / `[DONE]`, `delta.content`, `delta.reasoning_content`, `delta.reasoning`, `tool_calls`. |
| `AnthropicAdapter` | Anthropic native. `x-api-key` + `anthropic-version` + browser header, top-level `system`, named events. |
| `GeminiNativeAdapter` | Gemini native. `contents[].parts[]`, `?alt=sse`, `parts[].thought`. |

### 7.2 Checklist of the traps that will actually bite

1. **`choices: []`** on the final OpenAI usage chunk — guard array length, always.
2. **`data: [DONE]` is not JSON** — check for the sentinel *before* parsing.
3. **Split SSE on `\n\n`**, not `\n`.
4. **Anthropic `system` is top-level**; a `role:"system"` message is a 400.
5. **Anthropic requires `max_tokens`**; OpenAI does not.
6. **Gemini role is `model`, not `assistant`**; system prompt is `systemInstruction`.
7. **Gemini `streamGenerateContent` returns a JSON array unless `?alt=sse`** is present.
8. **Gemini native thinking is `parts[].thought === true`**, not a `reasoning_content` field.
9. **DeepSeek/OpenRouter/others disagree on the thinking field name** — feature-detect, don't branch on provider id.
10. **`gpt-image-1` is shut down** (2026-10-23); `dall-e-*` retired (2026-05-12). Model ids are config.
11. **GPT image models always return `b64_json`**; `response_format:"url"` is unsupported.
12. **Ark returns `data[].url` valid for 24 hours only** — persist the bytes.
13. **Ark `watermark` defaults to `true`** — explicitly send `false`.
14. **Ark `size` cannot mix presets and explicit pixels**; `800x800` is below the minimum pixel count.
15. **NovelAI image API has no CORS** and its default response is a **ZIP** — but `Accept:
    application/json` returns `{"images":[{"image":"<b64>","index":0,"seed":0}]}`. Prefer that.
16. **NovelAI's `/oa/v1` text endpoint serves GLM models**, not NAI's own prose models.
17. **NovelAI width/height must be multiples of 64, 64–1600**; `ucPreset: 0` is the "Heavy" default.
18. **NovelAI V5 rejects Vibe Transfer** and `nai-diffusion-5-full-medium` rejects negative prompts.
19. **Local servers need CORS enabled by the user** (`OLLAMA_ORIGINS`, LM Studio toggle, `--cors`).
20. **Never hardcode model ids as the only choice** — populate pickers from `GET /models` where available and always allow free text.

### 7.3 Sources consulted

- OpenAI Python SDK generated types (authoritative for parameters/responses):
  [`image_generate_params.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/image_generate_params.py),
  [`image_edit_params.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/image_edit_params.py),
  [`images_response.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/images_response.py),
  [`chat_completion_chunk.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion_chunk.py),
  [`chat_completion_stream_options_param.py`](https://github.com/openai/openai-python/blob/main/src/openai/types/chat/chat_completion_stream_options_param.py)
- [OpenAI streaming events reference](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)
- [Anthropic — Streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming) ·
  [anthropic-sdk-typescript `messages.ts`](https://github.com/anthropics/anthropic-sdk-typescript/blob/main/src/resources/messages/messages.ts)
- [Simon Willison — Claude's API now supports CORS](https://simonwillison.net/2024/Aug/23/anthropic-dangerous-direct-browser-access/)
- [Gemini — StreamGenerateContent reference](https://aistudio.google.com/api-reference/generate-content/stream-generate-content) ·
  [Gemini OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) ·
  [Gemini safety settings](https://aistudio.google.com/docs/safety-settings)
- [DeepSeek — Create Chat Completion](https://api-docs.deepseek.com/api/create-chat-completion)
- [OpenRouter — Reasoning Tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens)
- [BytePlus ModelArk — Image generation tutorial](https://docs.byteplus.com/en/docs/modelark/image-generation-tutorial) ·
  [Image generation API](https://docs.byteplus.com/en/docs/modelark/image-generation-api) ·
  [Streaming responses](https://docs.byteplus.com/en/docs/modelark/image-generation-streaming-responses)
- [Volcengine Ark — 图片生成 API](https://docs.volcengine.com/docs/ark/image-generation-api?lang=zh) ·
  [Seedream 4.0 model detail](https://console.volcengine.com/ark/region:cn-beijing/model/detail?name=doubao-seedream-4-0)
- **NovelAI official OpenAPI spec:** [`https://image.novelai.net/docs/doc.json`](https://image.novelai.net/docs/doc.json) ·
  [image API docs](https://image.novelai.net/docs/index.html) ·
  [text API docs](https://text.novelai.net/docs/index.html) ·
  [primary API docs](https://api.novelai.net/docs/)
- [novelai-sdk (PyPI)](https://pypi.org/project/novelai-sdk/) — community SDK used to cross-check
  `parameters` keys and model id lists
- [LiteLLM provider docs](https://docs.litellm.ai/docs/providers) and
  [`model_prices_and_context_window.json`](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
  — used for base URLs and provider inventory
- [Tencent Cloud — OpenAI Chat Completions protocol field notes](https://www.tencentcloud.com/zh/document/product/1300/82345)
  — tool-call streaming delta shape
- [Baidu Qianfan — OpenAI SDK compatibility](https://cloud.baidu.com/doc/qianfan/s/Hmh4suq26) ·
  [iFlytek Spark HTTP docs](https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html) ·
  [Baichuan Chat Completions](https://platform.baichuan-ai.com/docs-v2/api) ·
  [StepFun Chat Completions](https://platform.stepfun.ai/docs/en/api-reference/chat/chat-completion-create) ·
  [MiniMax OpenAI-compatible](https://platform.minimax.io/docs/api-reference/text-chat-openai) ·
  [Zhipu BigModel HTTP API](https://docs.bigmodel.cn/cn/guide/develop/http/introduction.md)
- [promptfoo Imagen provider](https://github.com/promptfoo/promptfoo/pull/5104/files) — Imagen
  `:predict` wire format
