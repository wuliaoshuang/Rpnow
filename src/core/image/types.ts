/**
 * Image generation service.
 *
 * Three first-class generators plus an extension point:
 *   - `openai-image`  : GPT Image family (`b64_json` only — `url` is unsupported)
 *   - `seedream`      : Volcengine Ark / BytePlus Seedream (`url`, expires in 24h)
 *   - `novelai`       : NovelAI image API (no CORS → proxy or desktop IPC required)
 *
 * Design constraints learned the hard way and encoded here:
 *   - Ark returns **URLs that expire in 24 hours**, so results are fetched and
 *     persisted as blobs immediately, never kept as bare links.
 *   - Ark `watermark` defaults to **true** server-side; RPNow sends it explicitly.
 *   - Ark cannot mix `"2K"` presets with explicit `WxH` in one request.
 *   - GPT image models **always** return base64 and reject `response_format`.
 *   - NovelAI's `generate-image` response is a ZIP unless you send
 *     `Accept: application/json`; sending it is cheaper than unzipping in the
 *     browser, and we fall back to unzip for old proxies.
 *   - NovelAI's `/oa/v1/chat/completions` hosts GLM models, *not* NAI prose
 *     models — so NovelAI is listed as an image provider only.
 */

import JSZip from 'jszip';
import { describeHttpError } from '../llm/sse.js';

export type ImageProviderKey = 'openai-image' | 'seedream' | 'novelai' | (string & {});

export interface ImageConnection {
  id: string;
  name: string;
  provider: ImageProviderKey;
  baseURL: string;
  apiKey: string;
  defaultModel?: string;
  headers?: Record<string, string>;
  options?: Record<string, unknown>;
}

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  /** Preferred output shape. Providers map this to their own size enums. */
  size?: 'square' | 'portrait' | 'landscape' | 'auto';
  width?: number;
  height?: number;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  /** Provider-specific model id override. */
  model?: string;
  /** Reference images as data URLs for image-to-image / edits. */
  references?: string[];
  seed?: number;
  /** NAI-only knobs. */
  steps?: number;
  scale?: number;
  sampler?: string;
  /** How many images to generate in one call (NovelAI `n_samples`, 1-8). */
  nSamples?: number;
  /** NovelAI negative preset (0 Heavy / 1 Light / 2 Human Focus / 3 None). */
  ucPreset?: number;
  /** NovelAI noise schedule (karras / native / exponential / polyexponential). V5 forces karras. */
  noiseSchedule?: string;
  /** NovelAI CFG rescale (0-1). */
  cfgRescale?: number;
  /** NovelAI Decrisper (`dynamic_thresholding`). */
  dynamicThresholding?: boolean;
  /** NovelAI quality toggle (adds the quality tags). */
  qualityToggle?: boolean;
  /** Ask the provider not to watermark (Ark). */
  watermark?: boolean;
  signal?: AbortSignal;
}

/**
 * The generation parameters the ImageStudio lets the user tune (and
 * persists per chat). These are the NovelAI knobs that actually change
 * the picture — steps, CFG, sampler, seed, noise schedule, sample count,
 * negative preset, CFG rescale, Decrisper, quality toggle.
 */
export interface ImageStudioParams {
  steps?: number;
  scale?: number;
  sampler?: string;
  seed?: number;
  noiseSchedule?: string;
  nSamples?: number;
  ucPreset?: number;
  cfgRescale?: number;
  dynamicThresholding?: boolean;
  qualityToggle?: boolean;
}

/** NovelAI samplers (V4.5/V5; `ddim` is remapped to `k_euler_ancestral` on V5). */
export const NAI_SAMPLERS = [
  'k_euler_ancestral',
  'k_euler',
  'k_dpmpp_2s_ancestral',
  'k_dpmpp_2m',
  'k_dpmpp_2m_sde',
  'k_dpmpp_sde',
  'ddim',
] as const;

/** NovelAI noise schedules. V5 forces `karras`. */
export const NAI_NOISE_SCHEDULES = ['karras', 'native', 'exponential', 'polyexponential'] as const;

/** NovelAI negative presets: 0 Heavy / 1 Light / 2 Human Focus / 3 None. */
export const NAI_UC_PRESETS = [
  { value: 0, label: 'Heavy（重）' },
  { value: 1, label: 'Light（轻）' },
  { value: 2, label: 'Human Focus（人物）' },
  { value: 3, label: 'None（无）' },
] as const;

/**
 * Estimate the Anlas a NovelAI generation will cost, from NovelAI's own
 * web-client formula (see NAIWeaver / MooshieUI docs): the price tracks
 * pixels × steps, ×1.5 for a plain generation, ×n_samples, ×SMEA when on.
 * Returns the paid cost. Whether it is actually free depends on the
 * subscription: on Opus, a single V4.5 image at ≤1024×1024 and ≤28 steps
 * (no base image) costs 0 Anlas; V5 draws from the Opus battery instead.
 */
export function estimateAnlasCost(opts: {
  width: number;
  height: number;
  steps: number;
  nSamples?: number;
  smea?: boolean;
  smeaDyn?: boolean;
}): number {
  const px = Math.max(0, opts.width) * Math.max(0, opts.height);
  const steps = Math.min(50, Math.max(1, Math.round(opts.steps)));
  const base = Math.ceil(2.951823174884865e-6 * px + 5.753298233447344e-7 * px * steps);
  let cost = base * 1.5;
  if (opts.smea) cost *= 1.2;
  if (opts.smeaDyn) cost *= 1.4;
  cost *= Math.min(8, Math.max(1, Math.round(opts.nSamples ?? 1)));
  return Math.ceil(cost);
}

/** Does this generation qualify for the Opus free allowance (V4.5 only)? */
export function isOpusFreeGeneration(opts: {
  model: string;
  width: number;
  height: number;
  steps: number;
  nSamples?: number;
}): boolean {
  if (!opts.model.startsWith('nai-diffusion-4')) return false;
  if (opts.width > 1024 || opts.height > 1024) return false;
  if (opts.steps > 28) return false;
  if ((opts.nSamples ?? 1) > 1) return false;
  return true;
}

export interface ImageResult {
  /** Data URL so results survive reloads and can be written into cards. */
  dataUrl: string;
  /** Remote URL when the provider returned one, for provenance. */
  sourceUrl?: string;
  seed?: number;
  model?: string;
  provider: string;
}

export interface ImageProviderAdapter {
  key: string;
  label: string;
  defaultBaseURL: string;
  knownModels: string[];
  browserCors: boolean;
  keyOptional?: boolean;
  note?: string;
  generate(conn: ImageConnection, req: ImageRequest, fetchImpl?: typeof fetch): Promise<ImageResult[]>;
  /** Probe the provider's model list when supported. */
  listModels?(conn: ImageConnection, fetchImpl?: typeof fetch): Promise<string[]>;
}

export interface ImageService {
  adapters(): ImageProviderAdapter[];
  registerAdapter(a: ImageProviderAdapter): () => void;
  connections(): ImageConnection[];
  generate(connectionId: string, req: ImageRequest): Promise<ImageResult[]>;
}

const joinURL = (base: string, path: string): string => `${base.replace(/\/+$/, '')}${path}`;

export const SIZE_MAP: Record<string, { openai: string; ark: string; nai: [number, number] }> = {
  square: { openai: '1024x1024', ark: '1024x1024', nai: [1024, 1024] },
  // NovelAI 的尺寸两边都要 ≤1024 才进 Opus 免费额度（单张、≤28 步、不用底图
  // 时 V4.5 免费；V5 从额度电池里扣）。832×1216 高 1216 超了，每张都要扣
  // Anlas，所以竖版/横版都改成 1024 以内。
  portrait: { openai: '1024x1536', ark: '1024x1536', nai: [832, 1024] },
  landscape: { openai: '1536x1024', ark: '1536x1024', nai: [1024, 832] },
  auto: { openai: 'auto', ark: '1024x1024', nai: [1024, 1024] },
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
}

/**
 * Compress a user-picked picture before it is stored on the message (I01/I03,
 * RP-Hub's `compressImage(dataUrl, 1600, 0.86)`): longest side ≤ 1600px,
 * JPEG quality 0.86 on a white background so transparency does not go black.
 * Animated GIFs are left untouched; runtimes without canvas (unit tests)
 * fall back to the raw data URL.
 */
export async function compressImageFile(file: Blob, maxDim = 1600, quality = 0.86): Promise<string> {
  if (file.type === 'image/gif') return blobToDataUrl(file);
  try {
    if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') {
      return blobToDataUrl(file);
    }
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale >= 1 && file.type === 'image/jpeg') {
      bitmap.close();
      return blobToDataUrl(file);
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return blobToDataUrl(file);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const out: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (!out) return blobToDataUrl(file);
    return blobToDataUrl(out);
  } catch {
    return blobToDataUrl(file);
  }
}

/** Fetch a remote image and inline it, because provider URLs expire. */
async function inlineRemote(url: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`下载生成结果失败：HTTP ${res.status}`);
  return blobToDataUrl(await res.blob());
}

// ------------------------------------------------------------ OpenAI GPT Image

export const openAIImageAdapter: ImageProviderAdapter = {
  key: 'openai-image',
  label: 'OpenAI GPT Image',
  defaultBaseURL: 'https://api.openai.com/v1',
  knownModels: ['gpt-image-1.5', 'gpt-image-1-mini', 'gpt-image-2'],
  browserCors: false,
  note: 'GPT Image 系列只返回 base64，不支持 response_format=url。官方接口需代理。',

  async generate(conn, req, fetchImpl = fetch) {
    const sizeKey = req.size ?? 'portrait';
    const size = req.width && req.height ? `${req.width}x${req.height}` : SIZE_MAP[sizeKey].openai;

    if (req.references?.length) {
      // Edits use multipart, not JSON.
      const form = new FormData();
      form.set('model', req.model || conn.defaultModel || 'gpt-image-1.5');
      form.set('prompt', composePrompt(req));
      form.set('size', size);
      if (req.quality) form.set('quality', req.quality);
      for (let i = 0; i < req.references.length; i++) {
        const blob = await (await fetchImpl(req.references[i])).blob();
        form.append('image[]', blob, `ref-${i}.png`);
      }
      const res = await fetchImpl(joinURL(conn.baseURL, '/images/edits'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${conn.apiKey}`, ...(conn.headers ?? {}) },
        body: form,
        signal: req.signal,
      });
      if (!res.ok) throw new Error(await describeHttpError(res));
      return parseOpenAIImages(await res.json(), 'openai-image', req.model);
    }

    const body: Record<string, unknown> = {
      model: req.model || conn.defaultModel || 'gpt-image-1.5',
      prompt: composePrompt(req),
      size,
      n: 1,
    };
    if (req.quality) body.quality = req.quality;

    const res = await fetchImpl(joinURL(conn.baseURL, '/images/generations'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.apiKey}`,
        'Content-Type': 'application/json',
        ...(conn.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(await describeHttpError(res));
    return parseOpenAIImages(await res.json(), 'openai-image', req.model);
  },
};

function parseOpenAIImages(json: unknown, provider: string, model?: string): ImageResult[] {
  const data = (json as { data?: Array<{ b64_json?: string; url?: string }> }).data ?? [];
  const out: ImageResult[] = [];
  for (const d of data) {
    if (d.b64_json) out.push({ dataUrl: `data:image/png;base64,${d.b64_json}`, provider, model });
    else if (d.url) out.push({ dataUrl: '', sourceUrl: d.url, provider, model });
  }
  return out;
}

function composePrompt(req: ImageRequest): string {
  return req.negativePrompt ? `${req.prompt}\n\nNegative: ${req.negativePrompt}` : req.prompt;
}

// ------------------------------------------------------------------ Seedream

export const seedreamAdapter: ImageProviderAdapter = {
  key: 'seedream',
  label: 'Seedream（火山方舟）',
  defaultBaseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  knownModels: [
    'doubao-seedream-4-0-250828',
    'seedream-4-5-251128',
    'seedream-5-0-260128',
    'dola-seedream-5-5-261028',
  ],
  browserCors: false,
  note: '返回的 URL 仅 24 小时有效，RPNow 会立即下载保存。浏览器直连需代理。',

  async generate(conn, req, fetchImpl = fetch) {
    const sizeKey = req.size ?? 'portrait';
    // Ark rejects mixing "2K" presets with explicit WxH, so pick one form.
    const size =
      req.width && req.height ? `${req.width}x${req.height}` : SIZE_MAP[sizeKey].ark;

    const body: Record<string, unknown> = {
      model: req.model || conn.defaultModel || 'doubao-seedream-4-0-250828',
      prompt: req.prompt,
      size,
      // Server default is TRUE, so always send it explicitly.
      watermark: req.watermark ?? false,
      response_format: 'url',
    };
    if (req.negativePrompt) body.negative_prompt = req.negativePrompt;
    if (req.seed !== undefined && req.seed >= 0) body.seed = req.seed;
    if (req.references?.length) {
      body.image = req.references;
      if (req.references.length > 1) body.sequential_image_generation = 'disabled';
    }

    const res = await fetchImpl(joinURL(conn.baseURL, '/images/generations'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.apiKey}`,
        'Content-Type': 'application/json',
        ...(conn.headers ?? {}),
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(await describeHttpError(res));

    const json = (await res.json()) as {
      data?: Array<{ url?: string; b64_json?: string; size?: string }>;
      error?: { message?: string };
    };
    if (json.error?.message) throw new Error(json.error.message);
    const out: ImageResult[] = [];
    for (const item of json.data ?? []) {
      if (item.b64_json) {
        out.push({ dataUrl: `data:image/png;base64,${item.b64_json}`, provider: 'seedream', model: body.model as string });
      } else if (item.url) {
        // Download immediately: the URL dies after 24h.
        const dataUrl = await inlineRemote(item.url, fetchImpl);
        out.push({
          dataUrl,
          sourceUrl: item.url,
          provider: 'seedream',
          model: body.model as string,
          seed: req.seed,
        });
      }
    }
    if (!out.length) throw new Error('Seedream 没有返回图片');
    return out;
  },
};

// ------------------------------------------------------------------ NovelAI

const NAI_DEFAULT_NEGATIVE =
  'lowres, bad anatomy, bad hands, text, error, missing fingers, extra digit, fewer digits, cropped, worst quality, low quality, normal quality, jpeg artifacts, signature, watermark, username, blurry';

export const novelaiAdapter: ImageProviderAdapter = {
  key: 'novelai',
  label: 'NovelAI',
  defaultBaseURL: 'https://image.novelai.net',
  knownModels: [
    'nai-diffusion-5-full',
    'nai-diffusion-5-curated',
    'nai-diffusion-4-5-full',
    'nai-diffusion-4-full',
    'nai-diffusion-3',
  ],
  browserCors: false,
  note: 'NovelAI 图片接口不发送 CORS 头，浏览器无法直连：请开启代理，或使用桌面版。',

  async generate(conn, req, fetchImpl = fetch) {
    const sizeKey = req.size ?? 'portrait';
    const [w, h] = req.width && req.height ? [req.width, req.height] : SIZE_MAP[sizeKey].nai;
    const model = req.model || conn.defaultModel || 'nai-diffusion-4-5-full';
    const isV5 = model.startsWith('nai-diffusion-5');
    const isV4Family = /^nai-diffusion-[45]/.test(model);
    const negative = req.negativePrompt || NAI_DEFAULT_NEGATIVE;

    // Parameters follow NovelAI's own frontend / the NAIWeaver API doc
    // (POST /ai/generate-image), per model family:
    //   - noise_schedule is `karras` for V4.5 and V5 (V5 forces it);
    //     `native` is not a V4/V5 schedule and degrades the image.
    //   - params_version is 3 for V4.5, 4 for V5.
    //   - sm / sm_dyn are sent (false) for V4.5 but NOT sent for V5
    //     (sending them to V5 is a 500).
    //   - the string negative prompt is `uc` on V4/V5 (the old
    //     `negative_prompt` field is a pre-V4 name and is ignored there);
    //     the structured negative lives in v4_negative_prompt.
    //   - `ucPreset` picks the predefined negative preset (0 Heavy /
    //     1 Light / 2 Human Focus / 3 None); it is merged with `uc`.
    //   - V5 with k_euler_ancestral also carries
    //     deliberate_euler_ancestral_bug=false / prefer_brownian=true.
    //   - `ddim` is remapped to `k_euler_ancestral` on V5.
    const sampler = isV5 && (req.sampler ?? 'k_euler_ancestral') === 'ddim' ? 'k_euler_ancestral' : (req.sampler ?? 'k_euler_ancestral');
    const parameters: Record<string, unknown> = {
      width: w,
      height: h,
      scale: Math.min(10, Math.max(0, req.scale ?? 6)),
      sampler,
      steps: Math.min(50, Math.max(1, Math.round(req.steps ?? 23))),
      n_samples: Math.min(8, Math.max(1, Math.round(req.nSamples ?? 1))),
      qualityToggle: req.qualityToggle ?? true,
      seed: req.seed !== undefined && req.seed >= 0 ? req.seed : Math.floor(Math.random() * 4294967295),
      dynamic_thresholding: req.dynamicThresholding ?? false,
      cfg_rescale: Math.min(1, Math.max(0, req.cfgRescale ?? 0)),
      noise_schedule: isV5 ? 'karras' : (req.noiseSchedule ?? 'karras'),
      ucPreset: req.ucPreset ?? 0,
    };
    if (isV4Family) {
      parameters.params_version = isV5 ? 4 : 3;
      parameters.uc = negative;
      // V4 and V5 both require structured prompt objects; there is no
      // `v5_prompt` — V5 reuses the `v4_prompt` / `v4_negative_prompt`
      // structure. Dropping either one is a 500, not a 400, so always send
      // both for V4/V5. The simple string form is only accepted on older
      // models, so we send the compatible v4 shape here.
      parameters.v4_prompt = {
        caption: { base_caption: req.prompt, char_captions: [] },
        use_coords: false,
        use_order: true,
      };
      parameters.v4_negative_prompt = {
        caption: { base_caption: negative, char_captions: [] },
        legacy_uc: false,
      };
      if (isV5) {
        parameters.deliberate_euler_ancestral_bug = false;
        parameters.prefer_brownian = true;
      } else {
        parameters.sm = false;
        parameters.sm_dyn = false;
      }
    } else {
      // Pre-V4 models take the plain string negative prompt.
      parameters.negative_prompt = negative;
      parameters.ucPreset = 0;
    }

    const res = await fetchImpl(joinURL(conn.baseURL, '/ai/generate-image'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.apiKey}`,
        'Content-Type': 'application/json',
        // Without this the response is a ZIP; asking for JSON avoids unzipping.
        Accept: 'application/json',
        ...(conn.headers ?? {}),
      },
      body: JSON.stringify({ input: req.prompt, model, action: 'generate', parameters }),
      signal: req.signal,
    });
    if (!res.ok) throw new Error(await describeHttpError(res));

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('zip') || contentType.includes('octet-stream')) {
      // Older proxies ignore Accept; unzip and take the first entry.
      const zip = await JSZip.loadAsync(await res.arrayBuffer());
      const file = zip.file(/\.(png|webp|jpg)$/i)[0];
      if (!file) throw new Error('NovelAI 返回的压缩包中没有图片');
      const b64 = await file.async('base64');
      const ext = file.name.split('.').pop()!.toLowerCase();
      return [{ dataUrl: `data:image/${ext === 'jpg' ? 'jpeg' : ext};base64,${b64}`, provider: 'novelai', model }];
    }

    const json = (await res.json()) as { images?: Array<{ image: string }>; error?: string | { message?: string } };
    if (json.error) {
      const detail = typeof json.error === 'string' ? json.error : json.error.message ?? JSON.stringify(json.error);
      throw new Error(`NovelAI 报错：${detail}`);
    }
    const images = json.images ?? [];
    if (!images.length) throw new Error('NovelAI 没有返回图片');
    return images.map((img) => ({
      dataUrl: `data:image/png;base64,${img.image}`,
      provider: 'novelai',
      model,
    }));
  },
};

export const BUILTIN_IMAGE_ADAPTERS: ImageProviderAdapter[] = [
  openAIImageAdapter,
  seedreamAdapter,
  novelaiAdapter,
];

export { blobToDataUrl };
