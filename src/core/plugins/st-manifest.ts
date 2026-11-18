/**
 * SillyTavern extension detection heuristics (pure).
 *
 * Split out from `st-bridge.ts` so the rules can be unit-tested without pulling
 * in the store/kernel graph.
 */

/** The subset of the ST manifest we care about. */
export interface STManifest {
  display_name?: string;
  name?: string;
  version?: string;
  js?: string;
  css?: string | string[];
  author?: string;
  description?: string;
  /** Some extensions use these instead of `js`. */
  main?: string;
  entry?: string;
  requires?: string[];
  /*
   * SillyTavern's lifecycle hook map (`extensions.js:385-403`): hook name →
   * exported function name. Supports install/update/delete/clean/enable/
   * disable/activate. Losing this made every hook-dependent extension inert.
   */
  hooks?: Record<string, string>;
  optional?: string[];
  dependencies?: string[];
  loading_order?: number;
  minimum_client_version?: string;
  i18n?: Record<string, string>;
  auto_update?: boolean;
  homePage?: string;
  /** Global function name used as a generation interceptor. */
  generate_interceptor?: string;
}

/** True when a parsed ZIP looks like a SillyTavern extension rather than .rpnx. */
export function looksLikeSTExtension(manifest: unknown): boolean {
  if (!manifest || typeof manifest !== 'object') return false;
  const m = manifest as Record<string, unknown>;
  // .rpnx manifests always carry an `id` + `entry`; ST ones never do.
  if (typeof m.id === 'string' && typeof m.entry === 'string') return false;
  return (
    typeof m.js === 'string' ||
    typeof m.main === 'string' ||
    typeof m.entry === 'string' ||
    typeof m.css === 'string' ||
    Array.isArray(m.css) ||
    Array.isArray(m.requires)
  );
}

/** Pick the script path declared by the manifest. */
export function resolveEntryPath(manifest: STManifest): string {
  const raw = manifest.js ?? manifest.main ?? manifest.entry ?? 'index.js';
  return String(raw).replace(/^\.\//, '');
}

/** Resolve the stylesheet path (ST allows a string or an array). */
export function resolveStylePath(manifest: STManifest): string | null {
  const raw = manifest.css as unknown;
  if (!raw) return null;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (typeof first !== 'string' || !first) return null;
  return first.replace(/^\.\//, '');
}

/** Human-facing name for an ST extension. */
export function stDisplayName(manifest: STManifest): string {
  return manifest.display_name || manifest.name || '未命名扩展';
}

/** Generate a stable plugin id for an ST extension. */
export function stPluginId(manifest: STManifest): string {
  const raw = (manifest.name || manifest.display_name || '').trim();
  /*
   * A slug-only id collapses every Chinese-named extension to `st.extension`
   * (the census showed 酒馆助手 installing as exactly that), so two such
   * packages would collide. Keep latin characters when present and otherwise
   * disambiguate with a short hash of the display name.
   */
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (slug) return `st.${slug}`;
  const label = manifest.display_name || manifest.name || '';
  let h = 0;
  for (let i = 0; i < label.length; i++) {
    h = (h * 31 + label.charCodeAt(i)) | 0;
  }
  return `st.${Math.abs(h).toString(36)}`;
}
