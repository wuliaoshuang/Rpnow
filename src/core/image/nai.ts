/**
 * NovelAI-style inline image generation.
 *
 * RP-Hub's auto-image feature puts generated pictures *inside* the reply: the
 * model writes markers of the form `image###English,comma,tags###`, and the app
 * turns each marker into a real picture. That is different from a standalone
 * "generate an image" button — the pictures are part of the narrative, in the
 * order the model chose.
 *
 * Rules that keep the output usable:
 *   - Markers are only recognised on their own; a marker followed by more text
 *     on the same line is still a marker (the model often appends prose).
 *   - Tags must be English comma-separated; a marker with fewer than 2 tags is
 *     rejected rather than sent to a paid endpoint.
 *   - Rerolling swaps two adjacent tags, so the composition changes without
 *     discarding the model's intent.
 */

export interface ImageMarker {
  /** Index into the original text where the marker starts. */
  start: number;
  end: number;
  tags: string;
}

export const IMAGE_MARKER_RE = /image###([^#\n]+?)###/gi;

/** Extract every `image###…###` marker, in order. */
export function parseImageMarkers(text: string): ImageMarker[] {
  const out: ImageMarker[] = [];
  for (const match of text.matchAll(IMAGE_MARKER_RE)) {
    const tags = (match[1] ?? '').trim();
    if (!tags) continue;
    out.push({ start: match.index ?? 0, end: (match.index ?? 0) + match[0].length, tags });
  }
  return out;
}

/** True when a reply contains at least one usable marker. */
export function hasImageMarkers(text: string): boolean {
  return parseImageMarkers(text).length > 0;
}

/** Replace every marker with `replacement` (used to keep the stored text clean). */
export function stripImageMarkers(text: string, replacement = '（插图）'): string {
  return text.replace(IMAGE_MARKER_RE, replacement).replace(/\n{3,}/g, '\n\n');
}

/**
 * Reroll a marker by swapping two adjacent tags.
 *
 * With fewer than two tags there is nothing to swap, so the caller is told to
 * fall back to a plain regeneration.
 */
export function rerollTags(tags: string): { tags: string; swapped: boolean } {
  const parts = tags.split(',').map((t) => t.trim()).filter(Boolean);
  if (parts.length < 2) return { tags, swapped: false };
  const i = Math.floor(Math.random() * (parts.length - 1));
  [parts[i], parts[i + 1]] = [parts[i + 1], parts[i]];
  return { tags: parts.join(', '), swapped: true };
}

/** Split tags into the model-facing form (comma + space). */
export function normalizeTags(tags: string): string {
  return tags
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .join(', ');
}

export type ImageSize = 'vertical' | 'horizontal' | 'square';

/** NovelAI pixel sizes per aspect choice. */
export const IMAGE_SIZES: Record<ImageSize, { width: number; height: number }> = {
  vertical: { width: 832, height: 1216 },
  horizontal: { width: 1216, height: 832 },
  square: { width: 1024, height: 1024 },
};

export const IMAGE_GEN_BASE_URL = 'https://nai.sta1n.cn';

export type ImageStyleId =
  | 'vertical'
  | 'comicDoujin'
  | 'r18'
  | 'lolita25d'
  | 'anime'
  | 'galgame'
  | 'custom';

/**
 * Style → artist string, mirroring RP-Hub's style map. `custom` returns the
 * user's own artist string.
 */
export const IMAGE_STYLES: Array<{ id: ImageStyleId; label: string; artists: string }> = [
  {
    id: 'vertical',
    label: '韩漫小清新风',
    artists:
      '1.1::tianlianghe::, 1.2::monju_rou::, 1.1::sako_01::, 1::yayanomo::, 0.9::mika_pikaso::, 1::oppaiguy123::, 0.8::as1063::',
  },
  {
    id: 'comicDoujin',
    label: '动漫同人风',
    artists: 'asanagi, {{{{artist:asanagi}}}}, xiaoluo_xl, 1.2::Artist: misaka_12003-gou::, 1.2::Artist:shexyo::',
  },
  {
    id: 'r18',
    label: '2.5D唯美风（r18）',
    artists: '1.2::xiaoluo_xl::, 1.3::Artist: misaka_12003-gou::, 1.1::mika_pikaso::, 0.9::yayanomo::',
  },
  {
    id: 'lolita25d',
    label: '2.5D唯美风（萝）',
    artists: '1.2::asanagi::, 1.1::tianlianghe::, 1::sako_01::, 0.9::monju_rou::, 1::yayanomo::',
  },
  {
    id: 'anime',
    label: '本子里番风',
    artists:
      '1.4::asanagi::, {{{{artist:asanagi}}}}, 1.2::xiaoluo_xl::, 1.3::Artist: misaka_12003-gou::, 1.2::Artist:shexyo::, year 2025, realistic, 4k',
  },
  {
    id: 'galgame',
    label: 'GalGame风',
    artists: 'artist:ningen_mame, noyu_(noyu23386566), toosaka asagi, 20::best quality, absurdres, very aesthetic, detailed, masterpiece::',
  },
  { id: 'custom', label: '自定义', artists: '' },
];

/** Resolve the artist string for a style setting. */
export function artistsForStyle(style: string, custom: string): string {
  if (style === 'custom') return custom.trim();
  return IMAGE_STYLES.find((s) => s.id === style)?.artists ?? '';
}

/** V5 does not support the r18 / lolita25d / anime styles. */
export const V5_MODEL = 'nai-diffusion-5-full';
export function isV5(model: string): boolean {
  return /nai-diffusion-5/i.test(model);
}

export interface NAIJobParams {
  token: string;
  tags: string;
  model: string;
  width: number;
  height: number;
  steps?: number;
  scale?: number;
  sampler?: string;
  negative?: string;
  /** Artist/style string appended to the prompt (RP-Hub's `artist` param). */
  artist?: string;
  /** Force a fresh generation instead of reusing a cached result. */
  nocache?: boolean;
  fetchImpl?: typeof fetch;
  /** Polled every `intervalMs`, giving up after `maxFailures`. */
  intervalMs?: number;
  maxFailures?: number;
}

export interface NAIJobResult {
  imageUrl?: string;
  /** True when the job failed; `error` carries the reason. */
  failed: boolean;
  error?: string;
}

export interface NAIJobStatus {
  status: 'queued' | 'running' | 'done' | 'failed';
  imageUrl?: string;
  error?: string;
}

/**
 * Poll a job until it finishes.
 *
 * RP-Hub polls every 150 ms and tolerates up to 5 consecutive failures, so a
 * flaky connection does not abort a long generation.
 */
export async function pollJob(
  jobId: string,
  params: NAIJobParams,
): Promise<NAIJobStatus> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const interval = params.intervalMs ?? 150;
  const maxFailures = params.maxFailures ?? 5;
  let failures = 0;

  for (;;) {
    try {
      const res = await fetchImpl(`${IMAGE_GEN_BASE_URL}/api/jobs/${jobId}?token=${encodeURIComponent(params.token)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as NAIJobStatus;
      failures = 0;
      if (json.status === 'done' || json.status === 'failed') return json;
    } catch (err) {
      failures += 1;
      if (failures > maxFailures) {
        return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
      }
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/** Submit a generation job. */
export async function submitJob(params: NAIJobParams): Promise<{ jobId?: string; error?: string }> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const query = new URLSearchParams({
    token: params.token,
    prompt: params.artist ? `${params.tags}, ${params.artist}` : params.tags,
    model: params.model,
    width: String(params.width),
    height: String(params.height),
    steps: String(params.steps ?? 40),
    scale: String(params.scale ?? 6),
    sampler: params.sampler ?? 'k_dpmpp_2m_sde',
    ...(params.negative ? { negative: params.negative } : {}),
    ...(params.nocache ? { nocache: '1' } : {}),
  });

  try {
    const res = await fetchImpl(`${IMAGE_GEN_BASE_URL}/api/jobs?${query.toString()}`, { method: 'POST' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const json = (await res.json()) as { id?: string };
    if (!json.id) return { error: '服务没有返回任务 id' };
    return { jobId: json.id };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Fetch a finished image as a data URL so it can be stored in the chat. */
export async function fetchAsDataUrl(url: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<string> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  // Node (unit tests, some embedded runtimes) has no FileReader.
  if (typeof FileReader === 'undefined') {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return `data:${blob.type || 'image/png'};base64,${btoa(binary)}`;
  }
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

/** Query the remaining generation quota. */
export async function fetchQuota(
  key: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ ok: boolean; value?: number }> {
  try {
    const res = await fetchImpl(`${IMAGE_GEN_BASE_URL}/api/api/getUser`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toUserId: key }),
    });
    if (!res.ok) return { ok: false };
    const json = (await res.json()) as { status?: string; type?: string; value?: number };
    if (json.status === 'ok' && json.type === 'sta1n') return { ok: true, value: json.value };
    return { ok: false };
  } catch {
    return { ok: false };
  }
}
