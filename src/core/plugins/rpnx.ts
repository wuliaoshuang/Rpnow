/**
 * `.rpnx` plugin packaging.
 *
 * Format: a ZIP with
 *
 *   manifest.json   PluginManifest (id, name, version, apiVersion, host, provides, uses…)
 *   plugin.js       ES module exporting `{ manifest, apply }`
 *   README.md       optional
 *   assets/         optional icons / css
 *
 * Why a ZIP instead of a bare `.js`: plugins ship assets (theme CSS, icons) and
 * need to be signed off by a manifest before any code runs. The installer reads
 * the manifest *without* executing anything, so the UI can show what a plugin
 * claims before loading it.
 *
 * Security posture (documented, not hidden):
 *   - Installed code runs in the app's origin and therefore has the same powers
 *     as the app. There is no capability sandbox in a browser beyond that, so
 *     the UI states plainly that plugins are trusted code, and shows exactly
 *     which services each one requests before activation.
 *   - Plugin-provided card/chats data is *not* executed; only JS declared in
 *     `plugin.js` runs.
 */

import JSZip from 'jszip';
import { isSTCompatEnabled } from '../st-compat.js';
import {
  looksLikeSTExtension,
  resolveEntryPath,
  resolveStylePath,
  stDisplayName,
  stPluginId,
  type STManifest,
} from './st-bridge.js';
import { idbStorage } from '../storage/index.js';
import type { PluginManifest } from '../plugin/kernel-types.js';

const KEY = 'rpnow:plugins';

export interface InstalledPlugin {
  manifest: PluginManifest;
  /** Source of `plugin.js`. */
  code: string;
  /** Extra files (path → base64 or text) for themes/assets. */
  assets: Record<string, string>;
  readme?: string;
  installedAt: number;
  enabled: boolean;
  /** Bytes, for the manager UI. */
  size: number;
}

export interface ParsedRpnx {
  manifest: PluginManifest;
  code: string;
  assets: Record<string, string>;
  readme?: string;
  size: number;
}

/** Validate a manifest, returning human-readable problems. */
export function validateManifest(raw: unknown): { manifest?: PluginManifest; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object') return { errors: ['manifest.json 不是一个对象'] };
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9._-]*$/i.test(m.id)) {
    errors.push('manifest.id 必须是字母/数字/点/下划线组成的唯一标识');
  }
  if (typeof m.name !== 'string' || !m.name.trim()) errors.push('manifest.name 不能为空');
  if (typeof m.version !== 'string') errors.push('manifest.version 必须是字符串，如 "1.0.0"');
  if (typeof m.apiVersion !== 'number') errors.push('manifest.apiVersion 必须是数字（当前为 1）');
  /*
   * `host` used to be mandatory, which made the documented minimal manifest
   * (`id` / `name` / `version` / `apiVersion`) fail validation. It now defaults
   * to `ui` — almost every plugin contributes UI, and a plugin that needs the
   * host runtime can still say so explicitly.
   */
  if (m.host !== undefined && m.host !== 'host' && m.host !== 'ui') {
    errors.push('manifest.host 必须是 "host" 或 "ui"（可省略，默认 ui）');
  }
  if (m.provides && !Array.isArray(m.provides)) errors.push('manifest.provides 必须是字符串数组');
  if (m.uses && !Array.isArray(m.uses)) errors.push('manifest.uses 必须是字符串数组');
  if (errors.length) return { errors };
  return {
    errors: [],
    manifest: {
      id: m.id as string,
      name: m.name as string,
      version: m.version as string,
      apiVersion: m.apiVersion as number,
      host: (m.host as 'host' | 'ui' | undefined) ?? 'ui',
      description: typeof m.description === 'string' ? m.description : undefined,
      author: typeof m.author === 'string' ? m.author : undefined,
      homepage: typeof m.homepage === 'string' ? m.homepage : undefined,
      license: typeof m.license === 'string' ? m.license : undefined,
      provides: Array.isArray(m.provides) ? (m.provides as string[]) : [],
      uses: Array.isArray(m.uses) ? (m.uses as string[]) : [],
      optionalUses: Array.isArray(m.optionalUses) ? (m.optionalUses as string[]) : [],
      priority: typeof m.priority === 'number' ? m.priority : undefined,
      tags: Array.isArray(m.tags) ? (m.tags as string[]) : undefined,
      // The declared settings schema drives the generated config form; dropping
      // it here silently makes every plugin unconfigurable from the UI.
      config: m.config && typeof m.config === 'object' ? m.config : undefined,
    },
  };
}

/** Read a `.rpnx` archive WITHOUT executing any of its code. */
/**
 * Extract a SillyTavern extension out of an already-opened ZIP.
 *
 * ST extensions are `manifest.json` + script (+ optional css). Paths in the
 * manifest are relative to the archive root, but many archives are wrapped in a
 * single top-level folder, so resolve against both.
 *
 * IMPORTANT: real extensions (酒馆助手) are multi-file ES modules that use
 * *relative* imports (`import … from '../../scripts/utils.js'`). Extracting only
 * the entry file breaks them with "Failed to resolve module specifier". So we
 * also collect the whole JS module graph reachable from the entry and hand it to
 * the bridge, which rewrites each specifier to a real blob URL.
 */
async function parseSTExtension(
  zip: JSZip,
  manifest: STManifest,
): Promise<{ manifest: STManifest; script: string; styles?: string; modules?: Record<string, string>; entryPath: string }> {
  const names = Object.keys(zip.files);
  const find = (rel: string): JSZip.JSZipObject | null => {
    const candidates = [rel, ...names.filter((n) => n.endsWith(`/${rel}`))];
    for (const c of candidates) {
      const f = zip.file(c);
      if (f) return f;
    }
    return null;
  };
  const entryPath = resolveEntryPath(manifest);
  const scriptFile = find(entryPath) ?? zip.file(/index\.m?js$/)[0];
  if (!scriptFile) throw new Error(`酒馆扩展缺少脚本入口（期望 ${entryPath}）`);

  /** Path *inside the extension root* used as the module key. */
  const rootOf = (full: string): { root: string; rel: string } => {
    const idx = full.lastIndexOf(entryPath);
    if (idx >= 0) return { root: full.slice(0, idx), rel: entryPath };
    const slash = full.lastIndexOf('/');
    return { root: full.slice(0, slash + 1), rel: full.slice(slash + 1) };
  };
  const { root } = rootOf(scriptFile.name);

  // Collect every JS file under the extension root (bounded: these packages
  // ship a few dozen files, not thousands).
  const modules: Record<string, string> = {};
  const jsFiles = names.filter(
    (n) => n.startsWith(root) && /\.m?js$/i.test(n) && !zip.files[n]!.dir,
  );
  for (const full of jsFiles.slice(0, 400)) {
    const key = full.slice(root.length);
    if (/^\.\./.test(key)) continue;
    modules[key] = await zip.files[full]!.async('text');
  }

  const stylePath = resolveStylePath(manifest);
  const styleFile = stylePath ? find(stylePath) : null;
  return {
    manifest,
    script: await scriptFile.async('text'),
    styles: styleFile ? await styleFile.async('text') : undefined,
    modules: Object.keys(modules).length > 1 ? modules : undefined,
    entryPath,
  };
}

export async function parseRpnx(file: Blob): Promise<ParsedRpnx> {
  // let: a single wrapper folder is unwrapped below.
  let zip = await JSZip.loadAsync(await file.arrayBuffer());

  // Zip-slip / hostile-archive guards.
  const names = Object.keys(zip.files);
  if (names.length > 2000) throw new Error('压缩包内文件数量异常（>2000）');
  for (const n of names) {
    if (n.includes('..') || n.startsWith('/')) throw new Error(`非法文件路径：${n}`);
  }

  /*
   * The manifest may sit at the archive root OR one level down: GitHub "Download
   * ZIP" (and most extension releases) wrap everything in a single folder.
   * Only one nesting level is unwrapped, to keep zip-slip guards meaningful.
   *
   * Re-rooting copies file *paths* only — each entry is re-registered with the
   * original compressed payload, so nothing is decoded twice.
   */
  let manifestFile = zip.file('manifest.json');
  if (!manifestFile) {
    const nested = names.filter((n) => /^[^/]+\/manifest\.json$/.test(n));
    if (nested.length === 1) {
      const rootPrefix = nested[0]!.slice(0, nested[0]!.lastIndexOf('/') + 1);
      const rerooted = new JSZip();
      for (const n of names) {
        const entry = zip.files[n]!;
        if (!n.startsWith(rootPrefix)) continue;
        const rel = n.slice(rootPrefix.length);
        if (!rel) continue;
        if (entry.dir) {
          rerooted.folder(rel);
        } else {
          rerooted.file(rel, entry.async('uint8array'));
        }
      }
      zip = rerooted;
      manifestFile = zip.file('manifest.json');
    }
  }
  if (!manifestFile) throw new Error('缺少 manifest.json，这不是有效的插件包');
  // The archive has been re-rooted above; a copy of the payload is enough.
  const manifestText = await manifestFile.async('text');
  const manifestRaw = JSON.parse(manifestText) as unknown;

  /*
   * SillyTavern extension? Its manifest has `js`/`css` and no `id`+`entry`.
   *
   * The compatibility layer is **off by default** now (see core/st-compat.ts):
   * instead of silently installing a package we cannot support, fail with an
   * explicit message. Turning the switch on restores the old bridge behaviour.
   */
  if (looksLikeSTExtension(manifestRaw) && !isSTCompatEnabled()) {
    throw new Error(
      '这是 SillyTavern 扩展（如酒馆助手），RPNow 当前暂不支持此类插件。' +
        '请改用 .rpnx 插件包（manifest.json + plugin.js）。',
    );
  }
  if (looksLikeSTExtension(manifestRaw)) {
    const st = await parseSTExtension(zip, manifestRaw as STManifest);
    const bytes = new TextEncoder().encode(st.script + (st.styles ?? '')).length;
    return {
      manifest: {
        id: stPluginId(st.manifest),
        name: stDisplayName(st.manifest),
        version: st.manifest.version ?? '0.0.0',
        /*
         * 必须等于内核版本（1）。此前写 2 会被 `registry.ts:168` 判为
         * 「targets API v2 > v1」并直接拒绝，插件永远停在「已注册」。
         */
        apiVersion: 1,
        host: 'rpnow',
        description: st.manifest.description ?? 'SillyTavern 扩展（兼容层运行）',
        author: st.manifest.author,
        /** Marker consumed by the loader to pick the ST runtime path. */
        kind: 'st-extension',
        /** Entry file inside the package — relative imports resolve from here. */
        stEntry: st.entryPath,
      } as unknown as PluginManifest,
      code: st.script,
      assets: {
        /*
         * 原始 ST manifest **全文**。`hooks` / `requires` / `loading_order` /
         * `i18n` / `minimum_client_version` 都是 SillyTavern 的通用加载契约
         * （`extensions.js:385-403`），此前被压字段丢弃，导致
         * `manifest.hooks.activate` 永远读不到、扩展初始化钩子从不执行。
         */
        '__st__/manifest.json': manifestText,
        ...(st.styles ? { '__st__/styles.css': st.styles } : {}),
        // Multi-file ES modules (酒馆助手): every JS file under the extension
        // root, keyed by relative path. The bridge turns these into blob URLs so
        // relative imports resolve.
        ...Object.fromEntries(
          Object.entries(st.modules ?? {}).map(([p, src]) => [`__st__/modules/${p}`, src]),
        ),
      },
      readme: st.manifest.description,
      size: bytes,
    };
  }

  const { manifest, errors } = validateManifest(manifestRaw);
  if (!manifest) throw new Error(`manifest.json 校验失败：${errors.join('；')}`);

  // Entry point: `plugin.js` (preferred) or the manifest's `main`.
  const mainName = manifestFile ? 'plugin.js' : null;
  const entry = (mainName && zip.file(mainName)) ?? zip.file(/^plugin\.(m?js)$/)[0];
  if (!entry) throw new Error('缺少 plugin.js（插件入口）');
  const code = await entry.async('text');

  const assets: Record<string, string> = {};
  for (const name of names) {
    const f = zip.files[name];
    if (f.dir || name === 'manifest.json' || name === entry.name) continue;
    if (name === 'README.md') continue;
    // Store small text assets inline (themes, css, svg). Read then measure so we
    // never pull a huge binary into memory just to discard it.
    if (/\.(css|json|svg|txt|md)$/i.test(name)) {
      const text = await f.async('text');
      if (text.length < 400_000) assets[name] = text;
    }
  }

  const readme = zip.file(/^README\.md$/i)[0] ? await zip.file(/^README\.md$/i)[0]!.async('text') : undefined;
  const size = file.size;

  return { manifest, code, assets, readme, size };
}

export async function listInstalled(): Promise<InstalledPlugin[]> {
  return (await idbStorage.get<InstalledPlugin[]>(KEY)) ?? [];
}

export async function saveInstalled(list: InstalledPlugin[]): Promise<void> {
  await idbStorage.set(KEY, list);
}

export async function install(parsed: ParsedRpnx, replace = false): Promise<InstalledPlugin[]> {
  const list = await listInstalled();
  const idx = list.findIndex((p) => p.manifest.id === parsed.manifest.id);
  if (idx !== -1 && !replace) {
    throw new Error(`插件 ${parsed.manifest.id} 已安装。请先卸载，或选择覆盖安装。`);
  }
  const record: InstalledPlugin = {
    manifest: parsed.manifest,
    code: parsed.code,
    assets: parsed.assets,
    readme: parsed.readme,
    installedAt: Date.now(),
    enabled: true,
    size: parsed.size,
  };
  const next = idx === -1 ? [...list, record] : list.map((p, i) => (i === idx ? record : p));
  await saveInstalled(next);
  return next;
}

export async function uninstall(id: string): Promise<InstalledPlugin[]> {
  const list = (await listInstalled()).filter((p) => p.manifest.id !== id);
  await saveInstalled(list);
  return list;
}

export async function setEnabled(id: string, enabled: boolean): Promise<InstalledPlugin[]> {
  const list = (await listInstalled()).map((p) => (p.manifest.id === id ? { ...p, enabled } : p));
  await saveInstalled(list);
  return list;
}

/**
 * Turn stored plugin source into an importable ES module URL.
 *
 * The source may `import` nothing from the app (no bare specifiers) — plugins
 * receive everything through `apply(ctx)`, which keeps the ABI explicit and
 * versionable.
 */
export function toModuleUrl(code: string): { url: string; revoke: () => void } {
  const blob = new Blob([code], { type: 'text/javascript' });
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

/**
 * Rewrite bare relative imports inside a plugin to blob URLs of its own assets,
 * so a plugin can `import './parts.js'` without a bundler.
 */
export function resolveAssetImport(
  code: string,
  assets: Record<string, string>,
  baseUrl: URL,
): Map<string, string> {
  const map = new Map<string, string>();
  const re = /from\s+['"](\.[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const spec = m[1];
    const resolved = new URL(spec, baseUrl).pathname.replace(/^\//, '');
    if (assets[resolved] !== undefined) {
      map.set(spec, assets[resolved]);
    }
  }
  return map;
}

/** Generate a starter `.rpnx` so plugin authors have something that runs. */
export async function createTemplate(manifest: PluginManifest, code: string, readme?: string): Promise<Blob> {
  const zip = new JSZip();
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('plugin.js', code);
  zip.file('README.md', readme ?? `# ${manifest.name}\n\n${manifest.description ?? ''}\n`);
  return zip.generateAsync({ type: 'blob' });
}
