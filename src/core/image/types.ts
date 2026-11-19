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
  /** Ask the provider not to watermark (Ark). */
  watermark?: boolean;
  signal?: AbortSignal;
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

const SIZE_MAP: Record<string, { openai: string; ark: string; nai: [number, number] }> = {
  square: { openai: '1024x1024', ark: '1024x1024', nai: [1024, 1024] },
  portrait: { openai: '1024x1536', ark: '1024x1536', nai: [832, 1216] },
  landscape: { openai: '1536x1024', ark: '1536x1024', nai: [1216, 832] },
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

    const parameters: Record<string, unknown> = {
      width: w,
      height: h,
      scale: req.scale ?? 5,
      sampler: req.sampler ?? 'k_euler_ancestral',
      steps: req.steps ?? 28,
      n_samples: 1,
      ucPreset: 0,
      qualityToggle: true,
      negative_prompt: req.negativePrompt || NAI_DEFAULT_NEGATIVE,
      seed: req.seed !== undefined && req.seed >= 0 ? req.seed : Math.floor(Math.random() * 4294967295),
      dynamic_thresholding: false,
      controlnet_strength: 1,
      legacy: false,
      add_original_image: false,
      cfg_rescale: 0,
      noise_schedule: 'native',
    };
    if (/^nai-diffusion-[45]/.test(model)) {
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
        caption: { base_caption: parameters.negative_prompt, char_captions: [] },
        legacy_uc: false,
      };
      parameters.sm = false;
      parameters.sm_dyn = false;
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

    const json = (await res.json()) as { images?: Array<{ image: string }> };
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
