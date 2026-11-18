/**
 * 发布包打包 / 解包。
 *
 * 两类包都是 ZIP，根目录放 `publish.json`（发布元数据）：
 *   - `.rpcard`：publish.json + card.json + avatar.png? + worldbook.json? + preset.json?
 *                + screenshots/* + README.md?
 *   - `.rpxn`  ：publish.json + manifest.json + plugin.js + assets/** + screenshots/*
 *
 * 只打包、不执行任何被打包的代码；`parseRpnx` 与卡片导入继续走各自既有校验。
 */

import JSZip from 'jszip';
import type { MarketKind, PublishManifest } from './types.js';

export const PUBLISH_FILE = 'publish.json';

/** 计算 SHA-256（十六进制），用于安装前完整性校验。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function addFile(
  zip: JSZip,
  path: string,
  data: string | Uint8Array | ArrayBuffer,
): Promise<void> {
  zip.file(path, data);
}

export interface ScreenshotInput {
  /** 仅文件名（不含路径），如 `cover.png`。 */
  name: string;
  bytes: Uint8Array;
}

export interface CardPackageInput {
  manifest: PublishManifest;
  /** 卡片数据（含 spec / data）。 */
  card: Record<string, unknown>;
  avatar?: Uint8Array;
  worldbook?: Record<string, unknown>;
  preset?: Record<string, unknown>;
  screenshots?: ScreenshotInput[];
  readme?: string;
}

/** 打包角色卡发布包（`.rpcard`）。 */
export async function buildCardPackage(input: CardPackageInput): Promise<Blob> {
  const zip = new JSZip();
  await addFile(zip, PUBLISH_FILE, JSON.stringify({ ...input.manifest, type: 'card' }, null, 2));
  await addFile(zip, 'card.json', JSON.stringify(input.card, null, 2));
  if (input.avatar) await addFile(zip, 'avatar.png', input.avatar);
  if (input.worldbook) await addFile(zip, 'worldbook.json', JSON.stringify(input.worldbook, null, 2));
  if (input.preset) await addFile(zip, 'preset.json', JSON.stringify(input.preset, null, 2));
  for (const s of input.screenshots ?? []) {
    const safe = s.name.replace(/[^\w.-]/g, '_').slice(-64);
    await addFile(zip, `screenshots/${safe}`, s.bytes);
  }
  if (input.readme) await addFile(zip, 'README.md', input.readme);
  return zip.generateAsync({ type: 'blob' });
}

export interface PluginPackageInput {
  manifest: PublishManifest;
  /** `.rpnx` 的 manifest.json 内容。 */
  pluginManifest: Record<string, unknown>;
  /** 入口脚本（plugin.js 等）。 */
  entryName: string;
  entry: string;
  assets?: Record<string, string>;
  screenshots?: ScreenshotInput[];
  readme?: string;
}

/** 打包插件发布包（`.rpxn`，即带 publish.json 的 .rpnx）。 */
export async function buildPluginPackage(input: PluginPackageInput): Promise<Blob> {
  const zip = new JSZip();
  await addFile(zip, PUBLISH_FILE, JSON.stringify({ ...input.manifest, type: 'plugin' }, null, 2));
  await addFile(zip, 'manifest.json', JSON.stringify(input.pluginManifest, null, 2));
  await addFile(zip, input.entryName, input.entry);
  for (const [path, text] of Object.entries(input.assets ?? {})) {
    await addFile(zip, path, text);
  }
  for (const s of input.screenshots ?? []) {
    const safe = s.name.replace(/[^\w.-]/g, '_').slice(-64);
    await addFile(zip, `screenshots/${safe}`, s.bytes);
  }
  if (input.readme) await addFile(zip, 'README.md', input.readme);
  return zip.generateAsync({ type: 'blob' });
}

/** 从发布包读取 publish.json（不解释其余内容）。 */
export async function readPublishManifest(pkg: Blob): Promise<PublishManifest> {
  const zip = await JSZip.loadAsync(await pkg.arrayBuffer());
  const file = zip.file(PUBLISH_FILE);
  if (!file) throw new Error('发布包缺少 publish.json');
  return JSON.parse(await file.async('text')) as PublishManifest;
}

/** 列出发布包内截图文件名。 */
export async function listScreenshots(pkg: Blob): Promise<string[]> {
  const zip = await JSZip.loadAsync(await pkg.arrayBuffer());
  return Object.keys(zip.files)
    .filter((n) => n.startsWith('screenshots/') && !zip.files[n]!.dir)
    .map((n) => n.slice('screenshots/'.length));
}

/** 读取包内某个文本文件（不存在返回 null）。 */
export async function readTextFile(pkg: Blob, path: string): Promise<string | null> {
  const zip = await JSZip.loadAsync(await pkg.arrayBuffer());
  const f = zip.file(path);
  if (!f) return null;
  return f.async('text');
}

/** 判断 blob 是不是我们认识的发布包（有 publish.json）。 */
export async function isPublishPackage(pkg: Blob): Promise<boolean> {
  try {
    const zip = await JSZip.loadAsync(await pkg.arrayBuffer());
    return !!zip.file(PUBLISH_FILE);
  } catch {
    return false;
  }
}

/** 生成稳定的发布 id（防止同名冲突；作者段由调用方给稳定 slug）。 */
export function makeMarketId(kind: MarketKind, authorSlug: string, slug: string): string {
  /*
   * 保留 Unicode 字母/数字（中文名很常见），其余字符折叠成短横线。
   * 完全非字母数字时会落到 `untitled`，仍可由调用方再加序号去重。
   */
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'untitled';
  return `${kind}.${clean(authorSlug)}.${clean(slug)}`;
}

/** 判断一个版本是否比当前版本更新（semver）。 */
export function isNewerVersion(next: string, current: string): boolean {
  const pa = next.split(/[+-]/)[0].split('.').map((x) => parseInt(x, 10));
  const pb = current.split(/[+-]/)[0].split('.').map((x) => parseInt(x, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
