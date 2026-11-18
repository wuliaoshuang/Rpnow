/**
 * 预设 `extensions` 命名空间访问层。
 *
 * 为什么单独成层
 * --------------
 * SillyTavern 的预设不是「提示词顺序表」：它把任意扩展数据塞进
 * `extensions.*` 命名空间，插件直接读取。三条硬证据：
 *
 *   - ST 核心：`presetManager.readPresetExtensionField({ path })`
 *     （`public/scripts/preset-manager.js:853-873`）——lodash.get 任意点号路径，
 *     空 path 取整块，找不到返回 `null`；选中同名预设时优先读运行时份
 *     （`settings.extensions`，ST 在切预设时把 `preset.extensions` 拷进
 *     `oai_settings`，见 `openai.js:5052-5054`）；写是**双写**。
 *   - 酒馆助手：根本不走 manager，直读 `preset.extensions.regex_scripts`
 *     并把 `extensions.tavern_helper` 当自己的脚本存储
 *     （`src/store/settings/preset.ts`、`src/type/settings.ts`）。
 *   - 本预设：`SPreset.RegexBinding.regexes`(7) ⊂ `extensions.regex_scripts`(8)，
 *     另有数据通道 prompt `SPresetSettings`。
 *
 * 因此命名空间**不可白名单**：任何 key 都要能读到新值。
 * 契约见 docs/research/rpnow-st-compat-contract.md 通道 1。
 */

import type { RPCompletionPreset } from '../types/preset.js';
import type { RPRegexScript } from '../types/card.js';

/** 最小预设形状（只需要 `extensions` 与 `prompts`）。 */
export interface PresetExtensionsSource {
  extensions?: Record<string, unknown>;
  prompts?: Array<{ identifier?: string; content?: string; [k: string]: unknown }>;
  /** 兼容旧调用方：老实现把整份文档放在 `raw` 里。 */
  raw?: Record<string, unknown>;
}

/** 预设内嵌的酒馆助手脚本条目（`extensions.tavern_helper.scripts`）。 */
export interface PresetHelperScript {
  type?: string;
  enabled?: boolean;
  name?: string;
  id?: string;
  /** 脚本正文（可能是 loader、HTML 面板或完整运行时）。 */
  content?: string;
  /** 可选的 HTML 说明文档。 */
  info?: string;
  button?: unknown;
  data?: unknown;
  export_with?: unknown;
  [key: string]: unknown;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 把点号路径拆成键序列，支持 `a.b[0].c` 与 `a[0]`。
 * 与 lodash.get 的常用子集等价（足够 preset 的 path 语义）。
 */
function parsePath(path: string): Array<string | number> {
  const out: Array<string | number> = [];
  for (const raw of path.split('.')) {
    if (!raw) continue;
    const re = /([^\[\]]+)|\[(\d+)\]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw))) {
      if (m[2] !== undefined) out.push(Number(m[2]));
      else if (m[1]) out.push(m[1]);
    }
  }
  return out;
}

/** lodash.get 等价（缺失返回 `undefined`）。 */
export function getPath(source: unknown, path: string): unknown {
  let cur: unknown = source;
  for (const key of parsePath(path)) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

/** 不可变的 lodash.set 等价：返回新对象，不修改入参。 */
export function setPath<T extends Record<string, unknown>>(source: T, path: string, value: unknown): T {
  const keys = parsePath(path);
  if (!keys.length) return { ...source, ...(isRecord(value) ? value : {}) };
  const clone = (node: unknown): unknown => {
    if (Array.isArray(node)) return [...node];
    if (isRecord(node)) return { ...node };
    return {};
  };
  // 自顶向下重建路径上的每个节点，其余分支保持原引用。
  const build = (node: unknown, depth: number): unknown => {
    const copy = clone(node);
    const key = keys[depth];
    if (depth === keys.length - 1) {
      (copy as Record<string | number, unknown>)[key] = value;
      return copy;
    }
    (copy as Record<string | number, unknown>)[key] = build(
      isRecord(node) ? node[key as string] : undefined,
      depth + 1,
    );
    return copy;
  };
  return build(source, 0) as T;
}

/**
 * ST `readPresetExtensionField({ name, path })` 的等价实现。
 *
 * @param source      预设对象（或其 `extensions` 宿主）
 * @param path        点号路径；空串/`undefined` = 取整块
 * @param runtime     运行时份（ST 的 `settings.extensions`）。提供时优先读它，
 *                    以复刻「切预设后读到运行时副本」的行为。
 * @returns 命中值；路径不存在返回 `null`（对齐 ST 的 lodash.get 默认值）。
 */
export function readPresetExtensionField(
  source: PresetExtensionsSource | undefined,
  path?: string,
  runtime?: Record<string, unknown>,
): unknown {
  const extensions = runtime ?? source?.extensions ?? (source?.raw?.extensions as Record<string, unknown> | undefined);
  if (!isRecord(extensions)) return null;
  if (!path) return extensions;
  const value = getPath(extensions, path);
  return value === undefined ? null : value;
}

/**
 * 写入预设 extension 字段（不可变）。
 *
 * ST 是**双写**（运行时份 + 文件份，`preset-manager.js:883-908`）。RPNow 目前
 * 只有文件份一份持久化载体，调用方需在保存时同时写入两处（若引入运行时副本）。
 */
export function writePresetExtensionField<T extends Record<string, unknown>>(
  extensions: T,
  path: string,
  value: unknown,
): T {
  return setPath(extensions, path, value);
}

/** 从预设 prompts 里找出承载 JSON 的数据通道条目（如 `SPresetSettings`）。 */
function jsonContentPrompts(source: PresetExtensionsSource | undefined): unknown[] {
  const out: unknown[] = [];
  for (const p of source?.prompts ?? []) {
    if (typeof p.content !== 'string') continue;
    try {
      out.push(JSON.parse(p.content));
    } catch {
      /* 不是 JSON 的 prompt 跳过 */
    }
  }
  return out;
}

/** 收集三个载体里的正则脚本原始对象。 */
function collectRawRegexScripts(source: PresetExtensionsSource | undefined): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const pushList = (v: unknown) => {
    if (Array.isArray(v)) for (const item of v) if (isRecord(item)) out.push(item);
  };

  const ext = source?.extensions ?? (source?.raw?.extensions as Record<string, unknown> | undefined);
  if (isRecord(ext)) {
    // 标准 ST 载体
    pushList(ext.regex_scripts);
    // SPreset 私有载体
    const spreset = ext.SPreset;
    if (isRecord(spreset)) {
      const binding = spreset.RegexBinding;
      if (isRecord(binding)) pushList(binding.regexes);
    }
  }

  // 数据通道 prompt（Meowssiah: identifier === 'SPresetSettings'）
  for (const doc of jsonContentPrompts(source)) {
    if (!isRecord(doc)) continue;
    const binding = doc.RegexBinding;
    if (isRecord(binding)) pushList(binding.regexes);
  }

  return out;
}

const numOr = (v: unknown, fallback: number | null): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return fallback;
};

/**
 * 预设显示层正则（含私有载体的并集，按 find/replace 去重）。
 *
 * 三份快照是包含关系（`SPresetSettings` 6 ⊂ `RegexBinding` 7 ⊂
 * `extensions.regex_scripts` 8），所以必须去重，否则同一标签会被包两次围栏。
 */
export function getPresetRegexScripts(
  source?: PresetExtensionsSource | RPCompletionPreset | null,
): RPRegexScript[] {
  const seen = new Set<string>();
  const out: RPRegexScript[] = [];
  for (const raw of collectRawRegexScripts(source as PresetExtensionsSource)) {
    const findRegex = typeof raw.findRegex === 'string' ? raw.findRegex : '';
    const replaceString = typeof raw.replaceString === 'string' ? raw.replaceString : '';
    if (!findRegex) continue;
    const key = `${findRegex} ${replaceString}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: String(raw.id ?? raw.scriptName ?? `preset-regex-${out.length}`),
      scriptName: String(raw.scriptName ?? ''),
      findRegex,
      replaceString,
      trimStrings: Array.isArray(raw.trimStrings)
        ? raw.trimStrings.map((s) => String(s))
        : undefined,
      placement: Array.isArray(raw.placement)
        ? raw.placement.map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : [2],
      disabled: raw.disabled === true,
      markdownOnly: raw.markdownOnly === true,
      promptOnly: raw.promptOnly === true,
      runOnEdit: raw.runOnEdit === true,
      substituteRegex: numOr(raw.substituteRegex, 0) ?? 0,
      minDepth: numOr(raw.minDepth, null),
      maxDepth: numOr(raw.maxDepth, null),
    });
  }
  return out;
}

/**
 * 预设内嵌的酒馆助手脚本（`extensions.tavern_helper.scripts`）。
 * 这些脚本是**插件资产**，宿主只负责透传与持久化，不解释其内容。
 */
export function getPresetHelperScripts(source?: PresetExtensionsSource | null): PresetHelperScript[] {
  const value = readPresetExtensionField(source as PresetExtensionsSource, 'tavern_helper.scripts');
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord) as PresetHelperScript[];
}
