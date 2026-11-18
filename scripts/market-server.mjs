/**
 * 本地商店服务（第一阶段"先用本地测试"的落点）。
 *
 * 零依赖 Node HTTP 服务，监听 127.0.0.1:8799，数据放在 `market-local/`：
 *
 *   market-local/
 *     items.json                  # 索引（manifest + 版本 + 统计 + sha256）
 *     packages/<id>/<version>.zip # 发布包本体
 *
 * REST：
 *   GET  /v1/items?kind=card&category=&tag=&q=&sort=newest|downloads|rating|name&page=&pageSize=
 *   GET  /v1/items/:id
 *   GET  /v1/items/:id/versions
 *   GET  /v1/package/:id/:version        （zip 二进制）
 *   POST /v1/publish      { manifest, base64 }   → { id, version }
 *   POST /v1/items/:id/install
 *   POST /v1/items/:id/like | /dislike | /report { reason }
 *   GET  /v1/categories/:kind
 *
 * 说明：服务端不做内容审核、不执行任何包内代码；它只做存储与检索。
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const PORT = Number(process.env.MARKET_PORT ?? 8799);
const HOST = process.env.MARKET_HOST ?? '127.0.0.1';
const ROOT = process.env.MARKET_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'market-local');
const MAX_BODY = Number(process.env.MARKET_MAX_BODY ?? 64 * 1024 * 1024);

const CATEGORIES = {
  card: [
    ['modern', '现代'],
    ['ancient', '古风'],
    ['fantasy', '奇幻'],
    ['scifi', '科幻'],
    ['wuxia', '武侠'],
    ['horror', '恐怖'],
    ['comedy', '搞笑'],
    ['utility', '辅助·工具'],
    ['other', '其他'],
  ],
  plugin: [
    ['render', '渲染'],
    ['prompt', '提示词'],
    ['worldinfo', '世界书'],
    ['tools', '工具'],
    ['theme', '主题'],
    ['provider', '模型接入'],
    ['security', '安全'],
    ['dev', '开发调试'],
    ['other', '其他'],
  ],
};

async function ensureDirs() {
  await mkdir(join(ROOT, 'packages'), { recursive: true });
}

function readIndex() {
  const file = join(ROOT, 'items.json');
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return {};
  }
}

async function writeIndex(index) {
  await writeFile(join(ROOT, 'items.json'), JSON.stringify(index, null, 2));
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers,
  });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function parseItemsQuery(url) {
  const q = url.searchParams;
  return {
    kind: q.get('kind') === 'plugin' ? 'plugin' : 'card',
    category: q.get('category') || '',
    tag: q.get('tag') || '',
    q: (q.get('q') || '').toLowerCase(),
    sort: q.get('sort') || 'newest',
    page: Math.max(1, Number(q.get('page') || 1)),
    pageSize: Math.min(50, Math.max(1, Number(q.get('pageSize') || 20))),
  };
}

function matches(item, query) {
  const m = item.manifest;
  if (query.category && m.category !== query.category) return false;
  if (query.tag && !(m.tags ?? []).includes(query.tag)) return false;
  if (query.q) {
    const hay = `${m.name} ${m.summary} ${m.author} ${(m.tags ?? []).join(' ')}`.toLowerCase();
    if (!hay.includes(query.q)) return false;
  }
  return true;
}

function sortItems(items, sort) {
  const arr = [...items];
  switch (sort) {
    case 'downloads':
      arr.sort((a, b) => (b.manifest.stats?.downloads ?? 0) - (a.manifest.stats?.downloads ?? 0));
      break;
    case 'rating':
      arr.sort(
        (a, b) =>
          (b.manifest.stats?.likes ?? 0) - (b.manifest.stats?.dislikes ?? 0) -
          ((a.manifest.stats?.likes ?? 0) - (a.manifest.stats?.dislikes ?? 0)),
      );
      break;
    case 'name':
      arr.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
      break;
    default:
      arr.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }
  return arr;
}

const server = createServer(async (req, res) => {
  try {
    await ensureDirs();
    const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`);

    if (req.method === 'OPTIONS') return send(res, 204, '');

    // ---------------- categories ----------------
    if (req.method === 'GET' && url.pathname === '/v1/categories/card')
      return send(res, 200, { categories: CATEGORIES.card.map(([id, label]) => ({ id, label })) });
    if (req.method === 'GET' && url.pathname === '/v1/categories/plugin')
      return send(res, 200, { categories: CATEGORIES.plugin.map(([id, label]) => ({ id, label })) });

    // ---------------- list ----------------
    if (req.method === 'GET' && url.pathname === '/v1/items') {
      const index = readIndex();
      const query = await parseItemsQuery(url);
      const all = Object.values(index).filter((i) => i.manifest.type === query.kind);
      const filtered = sortItems(
        all.filter((i) => matches(i, query)),
        query.sort,
      );
      const start = (query.page - 1) * query.pageSize;
      const slice = filtered.slice(start, start + query.pageSize).map((i) => ({
        manifest: i.manifest,
        versions: i.versions,
        updatedAt: i.updatedAt,
        size: i.size,
        sha256: i.sha256,
      }));
      return send(res, 200, { items: slice, total: filtered.length, page: query.page, pageSize: query.pageSize });
    }

    // ---------------- detail / versions ----------------
    const detailMatch = url.pathname.match(/^\/v1\/items\/(.+)$/);
    if (req.method === 'GET' && detailMatch) {
      const id = decodeURIComponent(detailMatch[1]);
      const item = readIndex()[id];
      if (!item) return send(res, 404, { error: 'not_found' });
      if (url.pathname.endsWith('/versions')) return send(res, 200, { versions: item.versions });
      return send(res, 200, item);
    }

    // ---------------- download package ----------------
    const pkgMatch = url.pathname.match(/^\/v1\/package\/([^/]+)\/([^/]+)$/);
    if (req.method === 'GET' && pkgMatch) {
      const id = decodeURIComponent(pkgMatch[1]);
      const version = decodeURIComponent(pkgMatch[2]);
      const safeId = normalize(id).replace(/\.\./g, '');
      const safeVersion = normalize(version).replace(/[^0-9A-Za-z.+-]/g, '');
      const file = join(ROOT, 'packages', safeId, `${safeVersion}.zip`);
      if (!existsSync(file)) return send(res, 404, { error: 'package_not_found' });
      const bytes = await readFile(file);
      res.writeHead(200, {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/zip',
        'Content-Length': bytes.length,
      });
      return res.end(bytes);
    }

    // ---------------- publish ----------------
    if (req.method === 'POST' && url.pathname === '/v1/publish') {
      const raw = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(raw.toString('utf8'));
      } catch {
        return send(res, 400, { error: 'invalid_json' });
      }
      const { manifest, base64 } = payload ?? {};
      if (!manifest || typeof manifest.id !== 'string' || !base64)
        return send(res, 400, { error: 'missing_manifest_or_payload' });
      const buf = Buffer.from(base64, 'base64');
      if (!buf.length || buf.slice(0, 2).toString() !== 'PK') return send(res, 400, { error: 'not_a_zip' });

      const sha256 = await crypto.subtle
        .digest('SHA-256', buf)
        .then((d) => [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join(''));

      const dir = join(ROOT, 'packages', normalize(manifest.id).replace(/\.\./g, ''));
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${manifest.version}.zip`), buf);

      const index = readIndex();
      const existing = index[manifest.id];
      const versions = existing?.versions ?? [];
      if (!versions.includes(manifest.version)) versions.unshift(manifest.version);
      index[manifest.id] = {
        manifest: { ...manifest, stats: { downloads: existing?.manifest?.stats?.downloads ?? 0 } },
        versions,
        updatedAt: new Date().toISOString(),
        size: buf.length,
        sha256,
      };
      await writeIndex(index);
      return send(res, 200, { id: manifest.id, version: manifest.version, sha256 });
    }

    // ---------------- interactions ----------------
    const actionMatch = url.pathname.match(/^\/v1\/items\/([^/]+)\/(install|like|dislike|report)$/);
    if (req.method === 'POST' && actionMatch) {
      const id = decodeURIComponent(actionMatch[1]);
      const action = actionMatch[2];
      const raw = (await readBody(req)).toString('utf8');
      const index = readIndex();
      const item = index[id];
      if (!item) return send(res, 404, { error: 'not_found' });
      item.manifest.stats = item.manifest.stats ?? { downloads: 0 };
      if (action === 'install') item.manifest.stats.downloads = (item.manifest.stats.downloads ?? 0) + 1;
      if (action === 'like') item.manifest.stats.likes = (item.manifest.stats.likes ?? 0) + 1;
      if (action === 'dislike') item.manifest.stats.dislikes = (item.manifest.stats.dislikes ?? 0) + 1;
      if (action === 'report') {
        const reason = (() => {
          try {
            return JSON.parse(raw || '{}').reason ?? '';
          } catch {
            return '';
          }
        })();
        item.reports = item.reports ?? [];
        item.reports.push({ at: new Date().toISOString(), reason });
      }
      await writeIndex(index);
      return send(res, 200, { ok: true, stats: item.manifest.stats });
    }

    return send(res, 404, { error: 'no_route', path: url.pathname });
  } catch (err) {
    const code = String(err?.message ?? err);
    if (code === 'BODY_TOO_LARGE') return send(res, 413, { error: 'body_too_large' });
    console.error('[market]', code);
    return send(res, 500, { error: 'server_error', detail: code });
  }
});

server.listen(PORT, HOST, async () => {
  await ensureDirs();
  console.log(`RPNow 本地商店已启动: http://${HOST}:${PORT}`);
  console.log(`数据目录: ${ROOT}`);
});
