/**
 * Character card parsing and serialisation.
 *
 * Supported inputs (detected by content, not by filename):
 *   - Character Card V3 JSON  (`spec: "chara_card_v3"`)
 *   - Character Card V2 JSON  (`spec: "chara_card_v2"`)
 *   - TavernAI V1 JSON        (flat `name` + `description`, no `spec`)
 *   - PNG with `ccv3`/`chara` tEXt chunks
 *   - CharX / BYAF archive    (ZIP with `card.json`)
 *   - YAML
 *   - RisuAI-style JSON       (has `risum`/`module` markers)
 *
 * The parser is intentionally forgiving: cards in the wild violate the spec
 * routinely (missing `data`, numeric fields as strings), and rejecting them
 * would lose the user's content. Every parsed card records the format it came
 * from so export can pick the best output shape.
 */

import JSZip from 'jszip';
import { parse as parseYaml } from 'yaml';
import {
  fromCardEntry,
  type RPLorebook,
  type RPLorebookEntry,
} from '../types/lorebook.js';
import type {
  CardSourceFormat,
  RPCharacterBook,
  RPCharacterBookEntry,
  RPCard,
  RPCardData,
} from '../types/card.js';

const V1_FIELDS = ['name', 'description', 'personality', 'scenario', 'first_mes', 'mes_example'] as const;

const EMPTY_DATA = (): RPCardData => ({
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  creator_notes: '',
  system_prompt: '',
  post_history_instructions: '',
  alternate_greetings: [],
  tags: [],
  creator: '',
  character_version: '',
  extensions: {},
});

const asString = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : v === null || v === undefined ? fallback : String(v);

const asStringArray = (v: unknown): string[] => {
  if (Array.isArray(v)) return v.map((x) => asString(x)).filter(Boolean);
  if (typeof v === 'string' && v.trim()) {
    // Some exporters write a comma-separated string.
    return v.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return [];
};

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** Normalise a `data` object, accepting V2/V3 shapes and tolerating junk. */
export function normalizeCardData(raw: Record<string, unknown>): RPCardData {
  const base = EMPTY_DATA();
  const alt = raw.alternate_greetings;
  return {
    ...base,
    name: asString(raw.name),
    description: asString(raw.description),
    personality: asString(raw.personality),
    scenario: asString(raw.scenario),
    first_mes: asString(raw.first_mes),
    mes_example: asString(raw.mes_example),
    creator_notes: asString(raw.creator_notes ?? raw.creatorcomment),
    creator_notes_multilingual: asRecord(raw.creator_notes_multilingual) as Record<string, string>,
    system_prompt: asString(raw.system_prompt),
    post_history_instructions: asString(raw.post_history_instructions),
    alternate_greetings: Array.isArray(alt) ? alt.map((x) => asString(x)) : [],
    group_only_greetings: asStringArray(raw.group_only_greetings),
    tags: asStringArray(raw.tags),
    creator: asString(raw.creator),
    character_version: asString(raw.character_version),
    extensions: asRecord(raw.extensions),
    character_book: raw.character_book
      ? normalizeCharacterBook(asRecord(raw.character_book))
      : undefined,
    assets: Array.isArray(raw.assets) ? (raw.assets as RPCardData['assets']) : undefined,
    creation_date: raw.creation_date as number | string | undefined,
    modification_date: raw.modification_date as number | string | undefined,
  };
}

export function normalizeCharacterBook(raw: Record<string, unknown>): RPCharacterBook {
  const entriesRaw = Array.isArray(raw.entries) ? raw.entries : [];
  const entries: RPCharacterBookEntry[] = entriesRaw.map((e, i) => {
    const r = asRecord(e);
    return {
      id: typeof r.id === 'number' ? r.id : i,
      keys: asStringArray(r.keys ?? r.key),
      secondary_keys: asStringArray(r.secondary_keys ?? r.keysecondary),
      comment: asString(r.comment ?? r.name),
      content: asString(r.content ?? r.value),
      constant: Boolean(r.constant),
      selective: r.selective === undefined ? undefined : Boolean(r.selective),
      insertion_order: typeof r.insertion_order === 'number' ? r.insertion_order : Number(r.insertion_order) || undefined,
      enabled: r.enabled === undefined ? true : Boolean(r.enabled),
      position: asString(r.position, 'before_char') || 'before_char',
      use_regex: Boolean(r.use_regex),
      case_sensitive: typeof r.case_sensitive === 'boolean' ? r.case_sensitive : null,
      extensions: asRecord(r.extensions),
    };
  });
  return {
    name: asString(raw.name),
    description: asString(raw.description),
    extensions: asRecord(raw.extensions),
    entries,
    scan_depth: typeof raw.scan_depth === 'number' ? raw.scan_depth : undefined,
    token_budget: typeof raw.token_budget === 'number' ? raw.token_budget : undefined,
    recursive_scanning: typeof raw.recursive_scanning === 'boolean' ? raw.recursive_scanning : undefined,
  };
}

/** Result of parsing one imported blob. */
export interface ParsedCardResult {
  card: RPCard;
  /** Extra books found inside an archive (CharX/BYAF), already card-attached. */
  extraBooks: RPLorebook[];
  warnings: string[];
}

function newId(): string {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Detect the spec version from a parsed document and build an {@link RPCard}.
 */
export function cardFromDocument(
  doc: Record<string, unknown>,
  format: CardSourceFormat,
  warnings: string[] = [],
): RPCard {
  const specRaw = asString(doc.spec);
  let spec: RPCard['spec'] = 'v1';
  let dataRaw: Record<string, unknown>;
  let specVersion = '';

  if (specRaw === 'chara_card_v3' || specRaw === 'chara_card_v2') {
    spec = specRaw === 'chara_card_v3' ? 'v3' : 'v2';
    specVersion = asString(doc.spec_version, spec === 'v3' ? '3.0' : '2.0');
    // V2/V3 store real content under `data`, but mirror V1 fields at top level.
    // Some exporters put content only at the top level; merge with `data` winning.
    const topLevel: Record<string, unknown> = {};
    for (const f of V1_FIELDS) if (doc[f] !== undefined) topLevel[f] = doc[f];
    dataRaw = { ...topLevel, ...asRecord(doc.data) };
    if (!doc.data) warnings.push('卡片声明了 V2/V3，但缺少 data 字段，已回退读取顶层字段。');
  } else if (specRaw && specRaw !== 'chara_card_v1' && specRaw !== 'chara_card_v2_nai') {
    warnings.push(`未识别的卡片规范 "${specRaw}"，将按 V1 兼容格式解析。`);
    dataRaw = doc;
  } else {
    // RisuAI / risum style: { risum, module: { name, description, ... } }
    if (doc.risum || doc.module) {
      warnings.push('检测到 RisuAI 格式卡片，已尽力映射为通用字段。');
      const mod = asRecord(doc.module ?? {});
      dataRaw = {
        name: mod.name ?? doc.name,
        description: mod.description,
        personality: mod.personality ?? '',
        scenario: mod.scenario ?? '',
        first_mes: asRecord(mod.firstMessage).data ?? mod.first_mes ?? '',
        mes_example: asStringArray(mod.exampleMessage).join('\n<START>\n'),
        creator_notes: mod.decoder ?? '',
        extensions: { risu: mod },
      };
      spec = 'v1';
    } else {
      dataRaw = doc;
    }
  }

  if (!specVersion && spec !== 'v1') specVersion = spec === 'v3' ? '3.0' : '2.0';
  const data = normalizeCardData(dataRaw);

  if (!data.name.trim()) {
    warnings.push('卡片没有名称，已命名为「未命名角色」。');
    data.name = '未命名角色';
  }

  // ST keeps a V1 compatibility mirror at the top level; preserve the extras.
  const legacy: Record<string, unknown> = {};
  for (const key of Object.keys(doc)) {
    if (key === 'data' || key === 'spec' || key === 'spec_version') continue;
    if ((V1_FIELDS as readonly string[]).includes(key)) continue;
    legacy[key] = doc[key];
  }

  const now = Date.now();
  return {
    id: newId(),
    data,
    spec,
    specVersion,
    source: doc,
    sourceFormat: format,
    createdAt: now,
    updatedAt: now,
    legacy,
  };
}

// --------------------------------------------------------------------- PNG

/** Read the 4-byte big-endian length and 4-byte ASCII type of a PNG chunk. */
function readChunkType(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
  );
}

/**
 * Extract embedded card JSON from a PNG's `tEXt` chunks.
 *
 * Card data lives base64-encoded under keyword `ccv3` (V3) or `chara` (V2).
 * V3 takes precedence, matching SillyTavern's server-side reader.
 */
export function extractPngCardJson(bytes: Uint8Array): { json: string; keyword: string } | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return null;

  const found: Record<string, string> = {};
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = readChunkType(bytes, offset + 4);
    const dataStart = offset + 8;
    if (type === 'tEXt') {
      const data = bytes.subarray(dataStart, dataStart + length);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const keyword = new TextDecoder('latin1').decode(data.subarray(0, nul));
        const text = new TextDecoder('latin1').decode(data.subarray(nul + 1));
        found[keyword] = text;
      }
    } else if (type === 'iTXt') {
      // iTXt: keyword\0 compFlag compMethod langTag\0 translated\0 text
      const data = bytes.subarray(dataStart, dataStart + length);
      const nul = data.indexOf(0);
      if (nul > 0) {
        const keyword = new TextDecoder('latin1').decode(data.subarray(0, nul));
        if (data[nul + 1] === 0) {
          const rest = data.subarray(nul + 3);
          const l1 = rest.indexOf(0);
          const l2 = rest.indexOf(0, l1 + 1);
          if (l1 > -1 && l2 > -1) {
            found[keyword] = new TextDecoder('utf-8').decode(rest.subarray(l2 + 1));
          }
        }
      }
    }
    offset = dataStart + length + 4; // skip data + CRC
    if (type === 'IEND') break;
  }

  const pick = found['ccv3'] ?? found['chara'] ?? found['CCv3'] ?? found['chara_card_v3'];
  if (!pick) return null;
  const keyword = found['ccv3'] || found['CCv3'] ? 'ccv3' : 'chara';
  try {
    return { json: decodeBase64Utf8(pick), keyword };
  } catch {
    return null;
  }
}

/** Base64 → UTF-8 string that survives non-ASCII card text. */
export function decodeBase64Utf8(b64: string): string {
  const clean = b64.replace(/\s+/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

/** UTF-8 string → base64, chunked to avoid call-stack limits on big cards. */
export function encodeBase64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

// ------------------------------------------------------------------- ZIP

/** Read `card.json` (and any extra books) out of a CharX/BYAF archive. */
async function parseArchive(buffer: ArrayBuffer, warnings: string[]): Promise<ParsedCardResult> {
  const zip = await JSZip.loadAsync(buffer);
  const cardFile =
    zip.file('card.json') ??
    zip.file('Card.json') ??
    zip.file(/card\.json$/i)[0] ??
    zip.file(/^.*\.card\.json$/i)[0];
  if (!cardFile) {
    // Some archives put the card at the root under a .json with no card.json.
    const anyJson = zip.file(/^[^/]+\.json$/i)[0];
    if (!anyJson) throw new Error('压缩包中没有找到 card.json');
    warnings.push('压缩包中没有 card.json，已尝试使用根目录的 JSON 文件。');
    const text = await anyJson.async('text');
    const doc = JSON.parse(text) as Record<string, unknown>;
    return { card: cardFromDocument(doc, 'charx', warnings), extraBooks: [], warnings };
  }

  const text = await cardFile.async('text');
  const doc = JSON.parse(text) as Record<string, unknown>;

  // CharX stores assets separately; inline them as data URLs so the card is
  // self-contained after import.
  const assets = (doc.data as Record<string, unknown> | undefined)?.assets;
  if (Array.isArray(assets)) {
    for (const a of assets as Array<Record<string, unknown>>) {
      const uri = asString(a.uri);
      const m = /^(?:embeded?ed?|__asset):\/{0,2}(.*)$/i.exec(uri);
      if (!m) continue;
      const path = m[1];
      const file = zip.file(path) ?? zip.file(new RegExp(`${escapeRe(path)}$`, 'i'))[0];
      if (!file) continue;
      const b64 = await file.async('base64');
      const ext = (asString(a.ext) || path.split('.').pop() || 'png').toLowerCase();
      const mime = ext === 'jpg' ? 'jpeg' : ext;
      a.uri = `data:image/${mime};base64,${b64}`;
    }
  }

  // BYAF: chat.json holds the history; we import the card and note the chat so
  // the user can decide (we deliberately do not auto-import conversations).
  if (zip.file('chat.json')) {
    warnings.push('检测到 BYAF 格式（包含 chat.json 聊天记录）：已导入角色卡，聊天记录未自动导入。');
  }

  const card = cardFromDocument(doc, 'charx', warnings);
  return { card, extraBooks: [], warnings };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ------------------------------------------------------------------ public

/**
 * Parse any supported card blob into an {@link RPCard}.
 *
 * @param input   File/Blob from a picker or drop target.
 * @param filename Optional name used only to improve warnings.
 */
export async function parseCardFile(input: Blob, filename = ''): Promise<ParsedCardResult> {
  const warnings: string[] = [];
  const head = new Uint8Array(await input.slice(0, 8).arrayBuffer());
  const isPng =
    head[0] === 137 && head[1] === 80 && head[2] === 78 && head[3] === 71;

  if (isPng) {
    const bytes = new Uint8Array(await input.arrayBuffer());
    const found = extractPngCardJson(bytes);
    if (!found) throw new Error('这个 PNG 里没有嵌入角色卡数据（缺少 chara/ccv3 数据块）');
    const doc = JSON.parse(found.json) as Record<string, unknown>;
    const card = cardFromDocument(doc, 'png', warnings);
    card.avatar = await blobToDataUrl(input);
    return { card, extraBooks: [], warnings };
  }

  // ZIP magic
  if (head[0] === 0x50 && head[1] === 0x4b) {
    try {
      const res = await parseArchive(await input.arrayBuffer(), warnings);
      const avatarFile = (await findArchiveAvatar(input)) ?? null;
      if (avatarFile) res.card.avatar = avatarFile;
      return res;
    } catch (err) {
      throw new Error(`压缩包解析失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const text = await input.text();

  // JSON
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    let doc: unknown;
    try {
      doc = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`);
    }
    if (Array.isArray(doc)) {
      // Some tools export an array of cards.
      if (!doc.length) throw new Error('JSON 是空数组');
      warnings.push(`文件包含 ${doc.length} 张卡片，已导入第一张。`);
      doc = doc[0];
    }
    const rec = doc as Record<string, unknown>;
    const specRaw = asString(rec.spec);
    const format: CardSourceFormat =
      specRaw === 'chara_card_v3' ? 'json-v3' : specRaw === 'chara_card_v2' ? 'json-v2' : 'json-v1';
    return { card: cardFromDocument(rec, format, warnings), extraBooks: [], warnings };
  }

  // YAML
  try {
    const doc = parseYaml(text);
    if (doc && typeof doc === 'object') {
      warnings.push('已按 YAML 解析角色卡。');
      return {
        card: cardFromDocument(doc as Record<string, unknown>, 'yaml', warnings),
        extraBooks: [],
        warnings,
      };
    }
  } catch {
    /* fall through */
  }

  throw new Error(`无法识别的文件格式${filename ? `（${filename}）` : ''}。支持 PNG / JSON / YAML / CharX / BYAF。`);
}

/** Look for a sensible avatar image inside an archive. */
async function findArchiveAvatar(input: Blob): Promise<string | undefined> {
  const zip = await JSZip.loadAsync(await input.arrayBuffer());
  const candidates = [
    zip.file(/^card\.png$/i)[0],
    zip.file(/^assets\/icon\.(png|jpe?g|webp)$/i)[0],
    zip.file(/^icon\.(png|jpe?g|webp)$/i)[0],
    zip.file(/^assets\/(png|images)\//i)[0],
    zip.file(/\.(png|jpe?g|webp)$/i)[0],
  ].filter(Boolean);
  for (const f of candidates) {
    if (!f) continue;
    const b64 = await f.async('base64');
    const ext = (f.name.split('.').pop() ?? 'png').toLowerCase().replace('jpg', 'jpeg');
    return `data:image/${ext};base64,${b64}`;
  }
  return undefined;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

/** Parse a JSON world book file that is *not* a card (a standalone lorebook). */
export function parseLorebookFile(doc: unknown): RPLorebook {
  const rec = asRecord(doc);
  const isLorebookDoc =
    ('entries' in rec && !('name' in rec && 'description' in rec && 'first_mes' in rec)) ||
    'entries' in rec;
  if (!isLorebookDoc) {
    throw new Error('这不是世界书文件（缺少 entries 字段）');
  }
  // Two shapes circulate: {entries: {...}|[...]} and ST's originalData wrapper.
  let entriesRaw: unknown = rec.entries;
  if (entriesRaw && typeof entriesRaw === 'object' && !Array.isArray(entriesRaw)) {
    entriesRaw = Object.values(entriesRaw as Record<string, unknown>);
  }
  const book = normalizeCharacterBook({ ...rec, entries: (entriesRaw as unknown[]) ?? [] });
  const now = Date.now();
  return {
    id: `lb_${Math.random().toString(36).slice(2, 10)}`,
    name: book.name || asString(rec.name) || '导入的世界书',
    description: book.description,
    scanDepth: book.scan_depth ?? null,
    tokenBudget: book.token_budget ?? null,
    recursiveScanning: book.recursive_scanning ?? true,
    entries: book.entries.map((e, i) => fromCardEntry(e, i)) as RPLorebookEntry[],
    source: 'imported',
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------- export

/** Build a V2 card document (the most widely accepted export shape). */
export function toV2Document(card: RPCard): Record<string, unknown> {
  const d = card.data;
  const data: Record<string, unknown> = {
    name: d.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    mes_example: d.mes_example,
    creator_notes: d.creator_notes ?? '',
    system_prompt: d.system_prompt ?? '',
    post_history_instructions: d.post_history_instructions ?? '',
    alternate_greetings: d.alternate_greetings ?? [],
    tags: d.tags ?? [],
    creator: d.creator ?? '',
    character_version: d.character_version ?? '',
    extensions: d.extensions ?? {},
  };
  if (d.character_book) {
    data.character_book = {
      name: d.character_book.name ?? '',
      description: d.character_book.description ?? '',
      // Required by SillyTavern's V2 validator even when empty.
      extensions: d.character_book.extensions ?? {},
      entries: d.character_book.entries,
    };
  }
  return {
    // V1 compatibility mirror at top level.
    name: d.name,
    description: d.description,
    personality: d.personality,
    scenario: d.scenario,
    first_mes: d.first_mes,
    mes_example: d.mes_example,
    creatorcomment: d.creator_notes ?? '',
    avatar: 'none',
    talkativeness: '0.5',
    fav: false,
    tags: d.tags ?? [],
    spec: 'chara_card_v2',
    spec_version: '2.0',
    data,
    ...(card.legacy ?? {}),
  };
}

/** Build a V3 card document (superset of V2). */
export function toV3Document(card: RPCard): Record<string, unknown> {
  const v2 = toV2Document(card);
  const data = { ...(v2.data as Record<string, unknown>) };
  data.group_only_greetings = card.data.group_only_greetings ?? [];
  if (card.data.assets?.length) data.assets = card.data.assets;
  data.creation_date = card.data.creation_date ?? Math.floor(card.createdAt / 1000);
  data.modification_date = card.data.modification_date ?? Math.floor(card.updatedAt / 1000);
  if (card.data.creator_notes_multilingual) {
    data.creator_notes_multilingual = card.data.creator_notes_multilingual;
  }
  return { ...v2, spec: 'chara_card_v3', spec_version: '3.0', data };
}

/** Serialise the card as pretty JSON. */
export function toJsonBlob(card: RPCard, version: 'v2' | 'v3' = 'v2'): Blob {
  const doc = version === 'v3' ? toV3Document(card) : toV2Document(card);
  return new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
}

/** CRCs for PNG chunk writing. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeTextChunk(keyword: string, text: string): Uint8Array {
  const kw = new TextEncoder().encode(keyword);
  // tEXt is Latin-1; base64 payload is ASCII so this is safe.
  const payload = new TextEncoder().encode(text);
  const dataLen = kw.length + 1 + payload.length;
  const chunk = new Uint8Array(12 + dataLen);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, dataLen);
  chunk.set(new TextEncoder().encode('tEXt'), 4);
  chunk.set(kw, 8);
  chunk[8 + kw.length] = 0;
  chunk.set(payload, 9 + kw.length);
  const crcInput = chunk.subarray(4, 8 + dataLen);
  view.setUint32(8 + dataLen, crc32(crcInput));
  return chunk;
}

/**
 * Embed the card into a PNG.
 *
 * Writes both `chara` (V2) and `ccv3` (V3) chunks before IEND so the file is
 * readable by every client in circulation, matching SillyTavern's writer.
 */
export async function toPngBlob(card: RPCard, avatar?: string | Blob): Promise<Blob> {
  const basePng = avatar ?? card.avatar;
  let pngBytes: Uint8Array;
  if (basePng) {
    const blob = typeof basePng === 'string' ? await (await fetch(basePng)).blob() : basePng;
    pngBytes = new Uint8Array(await blob.arrayBuffer());
  } else {
    pngBytes = await generatePlaceholderPng(card.data.name);
  }

  // Strip existing card chunks so re-export is idempotent.
  const chunks: Uint8Array[] = [];
  let offset = 8;
  let iend: Uint8Array | null = null;
  while (offset + 8 <= pngBytes.length) {
    const length = readU32(pngBytes, offset);
    const type = readChunkType(pngBytes, offset + 4);
    const total = 12 + length;
    const slice = pngBytes.subarray(offset, offset + total);
    if (type === 'IEND') {
      iend = slice;
      break;
    }
    if (type === 'tEXt') {
      const data = pngBytes.subarray(offset + 8, offset + 8 + length);
      const nul = data.indexOf(0);
      const kw = nul > 0 ? String.fromCharCode(...data.subarray(0, nul)) : '';
      if (kw === 'chara' || kw === 'ccv3') {
        offset += total;
        continue;
      }
    }
    chunks.push(slice);
    offset += total;
  }

  const v2 = encodeBase64Utf8(JSON.stringify(toV2Document(card)));
  const v3 = encodeBase64Utf8(JSON.stringify(toV3Document(card)));
  const parts = [
    pngBytes.subarray(0, 8),
    ...chunks,
    makeTextChunk('chara', v2),
    makeTextChunk('ccv3', v3),
    iend ?? new Uint8Array([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]),
  ];
  return new Blob(parts as BlobPart[], { type: 'image/png' });
}

/** Draw a simple gradient card image when the card has no avatar. */
async function generatePlaceholderPng(name: string): Promise<Uint8Array> {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法创建画布');
  const g = ctx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, '#2b1b3d');
  g.addColorStop(0.5, '#6d3b7a');
  g.addColorStop(1, '#c2456b');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = 'bold 200px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText((name || '?').slice(0, 1).toUpperCase(), size / 2, size / 2);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出图片失败'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

/** CharX archive: card.json + assets + card.png. */
export async function toCharXBlob(card: RPCard): Promise<Blob> {
  const zip = new JSZip();
  const doc = toV2Document(card);
  zip.file('card.json', JSON.stringify(doc, null, 2));
  if (card.avatar) {
    const blob = await (await fetch(card.avatar)).blob();
    zip.file('assets/icon.png', blob);
  } else {
    zip.file('assets/icon.png', await generatePlaceholderPng(card.data.name));
  }
  zip.file(
    'README.txt',
    `RPNow CharX export\nCharacter: ${card.data.name}\nExported: ${new Date().toISOString()}\n`,
  );
  return zip.generateAsync({ type: 'blob' });
}

/** Whole-character bundle: card + its lorebook + a generated preset. */
export async function toBundleBlob(card: RPCard, extra: Record<string, unknown> = {}): Promise<Blob> {
  const zip = new JSZip();
  zip.file('card.json', JSON.stringify(toV2Document(card), null, 2));
  if (card.data.character_book) {
    zip.file('worldbook.json', JSON.stringify(card.data.character_book, null, 2));
  }
  for (const [name, data] of Object.entries(extra)) {
    zip.file(name, JSON.stringify(data, null, 2));
  }
  zip.file(
    'rpnow-bundle.json',
    JSON.stringify({ format: 'rpnow-bundle/1', name: card.data.name, exported: Date.now() }, null, 2),
  );
  return zip.generateAsync({ type: 'blob' });
}
