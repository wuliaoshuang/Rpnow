/**
 * RPNow plugin — MiMo TTS read-aloud.
 *
 * Provides the `tts` service so the chat UI grows a speaker button on every
 * message. Everything about the provider is contained here: the core knows only
 * the `TTSService` interface.
 *
 * ── Why this request shape ──────────────────────────────────────────────────
 * MiMo does **not** expose an OpenAI-style `/v1/audio/speech` endpoint (that path
 * returns an openresty HTML 404). TTS is served through **Chat Completions**:
 *
 *   POST {baseURL}/chat/completions
 *   { "model": "mimo-v2.5-tts",
 *     "messages": [
 *       { "role": "user",      "content": "<style instruction, optional>" },
 *       { "role": "assistant", "content": "<text to speak — required>" }
 *     ],
 *     "audio": { "voice": "冰糖", "format": "wav" } }
 *
 * The audio comes back base64-encoded at `choices[0].message.audio.data`.
 * Auth accepts either `api-key: <key>` or `Authorization: Bearer <key>`.
 */
export function apply(ctx) {
  const log = ctx.logger;

  // ---------------------------------------------------------------- config
  const DEFAULTS = {
    baseURL: 'https://api.xiaomimimo.com/v1',
    model: 'mimo-v2.5-tts',
    voice: '冰糖',
    format: 'wav',
    instruction: '',
  };

  function cfg() {
    const stored = ctx.config.get() || {};
    return { ...DEFAULTS, ...stored };
  }

  /**
   * Preset voices. MiMo's `mimo-v2.5-tts` accepts exactly these ids; the list is
   * mirrored from the official docs and shown in the plugin settings form.
   */
  const VOICES = [
    { id: 'mimo_default', label: '默认音色', language: 'zh-CN' },
    { id: '冰糖', label: '冰糖（女声，清亮）', language: 'zh-CN' },
    { id: '茉莉', label: '茉莉（女声，温柔）', language: 'zh-CN' },
    { id: '苏打', label: '苏打（中性，年轻）', language: 'zh-CN' },
    { id: '白桦', label: '白桦（男声，沉稳）', language: 'zh-CN' },
    { id: 'Mia', label: 'Mia（英文女声）', language: 'en-US' },
    { id: 'Chloe', label: 'Chloe（英文女声）', language: 'en-US' },
    { id: 'Milo', label: 'Milo（英文男声）', language: 'en-US' },
    { id: 'Dean', label: 'Dean（英文男声）', language: 'en-US' },
  ];

  // --------------------------------------------------------------- helper
  /** Decode base64 → data URL for playback. */
  function toDataUrl(base64, format) {
    const mime =
      format === 'mp3'
        ? 'audio/mpeg'
        : format === 'pcm' || format === 'pcm16'
          ? 'audio/wav'
          : 'audio/wav';
    return `data:${mime};base64,${base64}`;
  }

  /**
   * Map provider failures onto messages a user can act on. The three common ones
   * (no key / wrong endpoint / CORS in the browser) otherwise all look like an
   * opaque "failed to fetch".
   */
  async function describeError(res) {
    let detail = '';
    try {
      const text = await res.text();
      try {
        const json = JSON.parse(text);
        detail =
          json?.error?.message ?? json?.message ?? json?.error ?? text.slice(0, 200);
        if (typeof detail === 'object') detail = JSON.stringify(detail);
      } catch {
        // An HTML body means the endpoint is wrong (openresty 404 page).
        detail = /<html/i.test(text) ? '接口返回了 HTML 页面，通常是地址或路径不对' : text.slice(0, 200);
      }
    } catch {
      /* ignore */
    }
    if (res.status === 401 || res.status === 403) {
      return `MiMo 鉴权失败（${res.status}）：请检查 API Key。${detail ? ` ${detail}` : ''}`;
    }
    if (res.status === 404) {
      return `MiMo 接口 404：TTS 必须走 /chat/completions，请确认地址以 /v1 结尾。${detail ? ` ${detail}` : ''}`;
    }
    return `MiMo TTS 请求失败（HTTP ${res.status}）${detail ? `：${detail}` : ''}`;
  }

  // ---------------------------------------------------------------- speak
  async function speak(req) {
    const c = cfg();
    if (!c.apiKey) {
      throw new Error('还没有填写 MiMo API Key，请在「插件 → MiMo TTS 语音朗读」中设置');
    }

    const text = (req?.text ?? '').trim();
    if (!text) throw new Error('没有可朗读的文本');

    const messages = [];
    // Style instruction is a separate `user` turn; the spoken text is the
    // `assistant` turn. This ordering is what the API expects.
    const instruction = req?.instruction || c.instruction;
    if (instruction) messages.push({ role: 'user', content: instruction });
    messages.push({ role: 'assistant', content: text });

    const body = {
      model: c.model,
      messages,
      audio: {
        voice: req?.voice || c.voice,
        format: c.format,
      },
    };

    const base = String(c.baseURL || DEFAULTS.baseURL).replace(/\/+$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Both auth styles are documented; send both so either works.
        'api-key': c.apiKey,
        Authorization: `Bearer ${c.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: req?.signal,
    });

    if (!res.ok) throw new Error(await describeError(res));

    const json = await res.json();
    const audio = json?.choices?.[0]?.message?.audio;
    const data = audio?.data ?? audio;
    if (!data || typeof data !== 'string') {
      const hint =
        json?.choices?.[0]?.message?.content ??
        json?.error?.message ??
        '响应里没有音频数据';
      throw new Error(`MiMo 没有返回音频：${String(hint).slice(0, 160)}`);
    }

    return {
      audio: toDataUrl(data, c.format),
      format: c.format,
      voice: req?.voice || c.voice,
      meta: { model: c.model, usage: json?.usage },
    };
  }

  // ------------------------------------------------------------- register
  const service = {
    label: 'MiMo TTS',
    ready: () => Boolean(cfg().apiKey),
    voices: () => VOICES,
    speak,
  };

  ctx.provide('tts', service);
  log.info('MiMo TTS 已就绪，音色：', cfg().voice);

  return () => log.info('MiMo TTS 已停用');
}
