/**
 * Install a plugin straight from a GitHub URL.
 *
 * Accepts the URLs people actually paste:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo/tree/branch/sub/dir
 *   https://github.com/owner/repo/tree/branch
 *
 * Strategy:
 *   1. Parse owner/repo/(ref)/(subdir).
 *   2. README/manifest probe: fetch `manifest.json` (+ `plugin.js` /
 *      ST-style `js`) from the directory. If the directory IS a package
 *      (has manifest.json) → build a ZIP from those few files in memory.
 *   3. Otherwise (a source repo: `src/index.ts`, Vite, etc.) → download the
 *      branch archive (codeload .../tar.gz), then look for a prebuilt
 *      `dist/` / `build/` / `package/` directory containing manifest.json;
 *      fall back to the repo root manifest. TypeScript is NOT compiled here —
 *      the error says so explicitly instead of installing something broken.
 *
 * Everything goes through `parseRpnx` afterwards, so the same validation
 * (and the SillyTavern compatibility path) applies to network installs.
 */

import JSZip from 'jszip';

export interface GitHubTarget {
  owner: string;
  repo: string;
  /** Branch / tag / commit; undefined = default branch (resolved via API). */
  ref?: string;
  /** Path inside the repo, '' for the root. */
  subdir: string;
  /** Normalised `owner/repo` label for messages. */
  label: string;
}

const GH_HOSTS = ['github.com', 'www.github.com'];

/** Parse a GitHub URL (or `owner/repo` shorthand). Throws a readable error. */
export function parseGitHubUrl(input: string): GitHubTarget {
  const raw = input.trim();
  if (!raw) throw new Error('请输入 GitHub 链接');

  // Shorthand: `owner/repo`
  if (/^[\w.-]+\/[\w.-]+(?:#[\w./-]+)?$/.test(raw) && !raw.includes('://')) {
    const [repoPath, frag] = raw.split('#');
    const [owner, repo] = repoPath!.split('/');
    return {
      owner: owner!,
      repo: repo!.replace(/\.git$/, ''),
      ref: frag?.split('/')[0],
      subdir: frag?.split('/').slice(1).join('/') ?? '',
      label: `${owner}/${repo!.replace(/\.git$/, '')}`,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('链接格式不正确，需要形如 https://github.com/用户名/仓库');
  }
  if (!GH_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new Error('只支持 GitHub 链接（github.com）');
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').split('/');
  if (parts.length < 2) throw new Error('链接缺少仓库名，需要形如 https://github.com/用户名/仓库');
  const owner = parts[0]!;
  const repo = parts[1]!.replace(/\.git$/, '');

  let ref: string | undefined;
  let subdir = '';
  const kind = parts[2];
  if (kind === 'tree' || kind === 'blob') {
    ref = parts[3] ? decodeURIComponent(parts[3]) : undefined;
    subdir = parts.slice(4).map(decodeURIComponent).join('/');
  }
  return { owner, repo, ref, subdir, label: `${owner}/${repo}` };
}

async function getJson(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  } catch {
    throw new Error('无法访问 GitHub（网络受限或跨域被拦截）');
  }
  if (!res.ok) {
    if (res.status === 404) throw new Error('仓库不存在或无法访问（可能是私有仓库）');
    if (res.status === 403) throw new Error('GitHub 访问受限（触发限流），请稍后再试');
    throw new Error(`GitHub 返回 ${res.status}`);
  }
  return res.json();
}

/** Default branch for a repo (the API is public and cheap). */
async function defaultBranch(owner: string, repo: string): Promise<string> {
  try {
    const info = (await getJson(`https://api.github.com/repos/${owner}/${repo}`)) as { default_branch?: string };
    return info.default_branch || 'main';
  } catch {
    return 'main';
  }
}

/** Raw file text, or null when missing / unreachable. */
async function rawFile(owner: string, repo: string, ref: string, path: string): Promise<string | null> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${path}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface GitHubPackage {
  /** ZIP blob ready for `parseRpnx`. */
  blob: Blob;
  /** Where it came from, for oasts/toasts. */
  source: string;
  /** How the package was located. */
  mode: 'manifest-dir' | 'dist-archive';
}

/** Candidate filenames a package may ship (RPNow `.rpnx` or ST extension). */
const ENTRY_CANDIDATES = ['plugin.js', 'plugin.mjs', 'index.js', 'index.mjs', 'main.js'];

/**
 * Fetch a package from GitHub. Throws a user-facing error when the URL does not
 * point at something installable.
 */
export async function fetchPackageFromGitHub(target: GitHubTarget): Promise<GitHubPackage> {
  const { owner, repo, subdir } = target;
  const ref = target.ref ?? (await defaultBranch(owner, repo));
  const prefix = subdir ? `${subdir.replace(/\/$/, '')}/` : '';

  // ---- 1. Is this directory itself a package? --------------------------
  const manifestText = await rawFile(owner, repo, ref, `${prefix}manifest.json`);
  if (manifestText) {
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestText) as Record<string, unknown>;
    } catch {
      throw new Error('manifest.json 不是合法 JSON');
    }
    const zip = new JSZip();
    zip.file('manifest.json', manifestText);

    // Collect the entry script + stylesheet the manifest names.
    const asArray = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : []);
    const wanted = [
      ...asArray(manifest.js ?? manifest.main ?? manifest.entry),
      ...asArray(manifest.css),
      ...ENTRY_CANDIDATES,
    ];
    let foundEntry = false;
    for (const rel of [...new Set(wanted)]) {
      const clean = rel.replace(/^\.\//, '');
      const text = await rawFile(owner, repo, ref, `${prefix}${clean}`);
      if (!text) continue;
      zip.file(clean, text);
      if (clean.endsWith('.js') || clean.endsWith('.mjs')) foundEntry = true;
    }
    if (!foundEntry) {
      throw new Error('目录里有 manifest.json，但找不到入口脚本（plugin.js / index.js）');
    }
    return {
      blob: await zip.generateAsync({ type: 'blob' }),
      source: `${target.label}${subdir ? `/${subdir}` : ''}@${ref}`,
      mode: 'manifest-dir',
    };
  }

  // ---- 2. Source repo: look for a built package ------------------------
  // codeload serves `.zip`s we can read with JSZip (the `.tar.gz` variant
  // cannot be parsed here). One request per plausible ref.
  const refs = [ref, 'main', 'master'].filter((v, i, a) => v && a.indexOf(v) === i) as string[];
  let zip: JSZip | null = null;
  let sawNetworkError = false;
  for (const r of refs) {
    try {
      const res = await fetch(`https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${encodeURIComponent(r)}`);
      if (!res.ok) continue;
      zip = await JSZip.loadAsync(await res.arrayBuffer());
      break;
    } catch {
      sawNetworkError = true;
    }
  }
  if (!zip) {
    try {
      const tagRes = await fetch(`https://codeload.github.com/${owner}/${repo}/zip/refs/tags/${encodeURIComponent(ref)}`);
      if (tagRes.ok) zip = await JSZip.loadAsync(await tagRes.arrayBuffer());
    } catch {
      sawNetworkError = true;
    }
  }
  if (!zip) {
    // A network/CORS failure is not the same as "this repo has no plugin".
    if (sawNetworkError) throw new Error('无法从 GitHub 下载仓库（网络受限或跨域被拦截）');
    throw new Error(`仓库里没有可安装的插件包（未找到 manifest.json）。${SOURCE_REPO_HINT}`);
  }

  // Archive paths look like `repo-ref/…`; strip that single top folder.
  const names = Object.keys(zip.files).filter((n) => !zip!.files[n]!.dir);
  const roots = new Set(names.map((n) => n.split('/')[0]));
  const root = roots.size === 1 ? `${[...roots][0]}/` : '';
  const strip = (n: string) => (root && n.startsWith(root) ? n.slice(root.length) : n);

  // Preferred places a built package lives.
  const searchDirs = [prefix, `${prefix}dist/`, `${prefix}build/`, `${prefix}package/`];
  for (const dir of searchDirs) {
    const manifestPath = names.find((n) => strip(n) === `${dir}manifest.json`);
    if (!manifestPath) continue;
    const manifestText = await zip.files[manifestPath]!.async('text');
    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(manifestText) as Record<string, unknown>;
    } catch {
      continue;
    }
    const asArray = (v: unknown): string[] => (typeof v === 'string' ? [v] : Array.isArray(v) ? (v as string[]) : []);
    const wanted = [...asArray(manifest.js ?? manifest.main ?? manifest.entry), ...asArray(manifest.css)];
    const candidates = [
      ...wanted.map((w) => w.replace(/^\.\//, '')),
      ...ENTRY_CANDIDATES,
    ];

    const out = new JSZip();
    out.file('manifest.json', manifestText);
    let foundEntry = false;
    for (const rel of [...new Set(candidates)]) {
      const full = names.find((n) => strip(n) === `${dir}${rel}`);
      if (!full) continue;
      out.file(rel, await zip.files[full]!.async('text'));
      if (rel.endsWith('.js') || rel.endsWith('.mjs')) foundEntry = true;
    }
    if (!foundEntry) continue;
    return {
      blob: await out.generateAsync({ type: 'blob' }),
      source: `${target.label}${dir ? `/${dir.replace(/\/$/, '')}` : ''}@${ref}`,
      mode: 'dist-archive',
    };
  }

  throw new Error(`仓库里没有可安装的插件包（未找到 manifest.json）。${SOURCE_REPO_HINT}`);
}

/** Message shown for a source-only repo, so the user knows what to do. */
export const SOURCE_REPO_HINT =
  '如果这是源码仓库，请把链接指向已经构建好的目录（例如 /tree/main/dist），或者让作者提供 .rpnx 包。';
