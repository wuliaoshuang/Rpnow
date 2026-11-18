/**
 * 商店远端客户端。
 *
 * 与 UI 解耦、按生产可用形状设计（分页/错误码/鉴权头预留），但**第一版指向本地
 * mock 服务**（`scripts/market-server.mjs`）。将来接真实后端只需替换 baseURL。
 */

import type { InstalledSource, MarketItem, MarketPage, MarketQuery, PublishManifest } from './types.js';

export const DEFAULT_MARKET_BASE = 'http://127.0.0.1:8799';

let baseUrlOverride: string | undefined;

/** 供测试或设置页切换商店源（留作生产后端的接口点）。 */
export function setMarketBase(url: string): void {
  baseUrlOverride = url.replace(/\/$/, '');
}

export function marketBase(): string {
  return baseUrlOverride ?? DEFAULT_MARKET_BASE;
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${marketBase()}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = ((await res.json()) as { error?: string }).error ?? '';
    } catch {
      /* ignore */
    }
    throw new Error(detail || `商店请求失败（${res.status}）`);
  }
  return (await res.json()) as T;
}

function queryToString(q: MarketQuery): string {
  const p = new URLSearchParams();
  p.set('kind', q.kind);
  if (q.q) p.set('q', q.q);
  if (q.category) p.set('category', q.category);
  if (q.tag) p.set('tag', q.tag);
  if (q.sort) p.set('sort', q.sort);
  p.set('page', String(q.page ?? 1));
  p.set('pageSize', String(q.pageSize ?? 20));
  return p.toString();
}

/** 列表（搜索 + 筛选 + 排序 + 分页）。 */
export function queryItems(q: MarketQuery): Promise<MarketPage> {
  return req<MarketPage>(`/v1/items?${queryToString(q)}`);
}

export function getItem(id: string): Promise<MarketItem> {
  return req<MarketItem>(`/v1/items/${encodeURIComponent(id)}`);
}

/** 下载发布包（zip Blob）。 */
export async function downloadPackage(id: string, version: string): Promise<Blob> {
  const res = await fetch(
    `${marketBase()}/v1/package/${encodeURIComponent(id)}/${encodeURIComponent(version)}`,
  );
  if (!res.ok) throw new Error(`下载失败（${res.status}）`);
  return res.blob();
}

export interface PublishResult {
  id: string;
  version: string;
  sha256: string;
}

/** 发布：把 zip 以 base64 提交（本地服务直存；生产可换 multipart）。 */
export async function publishPackage(manifest: PublishManifest, pkg: Blob): Promise<PublishResult> {
  const buf = new Uint8Array(await pkg.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  // btoa 处理大字符串可能栈溢出，分段拼接已完成
  const base64 = globalThis.btoa(binary);
  return req<PublishResult>('/v1/publish', {
    method: 'POST',
    body: JSON.stringify({ manifest, base64 }),
  });
}

/** 安装计数 / 点赞 / 点踩 / 举报。 */
export function recordInstall(id: string): Promise<unknown> {
  return req(`/v1/items/${encodeURIComponent(id)}/install`, { method: 'POST' });
}
export function rateItem(id: string, kind: 'like' | 'dislike'): Promise<unknown> {
  return req(`/v1/items/${encodeURIComponent(id)}/${kind}`, { method: 'POST' });
}
export function reportItem(id: string, reason: string): Promise<unknown> {
  return req(`/v1/items/${encodeURIComponent(id)}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export interface CategoryDTO {
  id: string;
  label: string;
}

/** 服务端分类表（与本地 categories.ts 对账用；缺项时以本地为准）。 */
export function fetchCategories(kind: 'card' | 'plugin'): Promise<{ categories: CategoryDTO[] }> {
  return req(`/v1/categories/${kind}`);
}

/** 已安装来源记录（本地状态）。 */
const KEY_INSTALLED = 'rpnow:market-installed';

export function listInstalledSources(): Record<string, InstalledSource> {
  try {
    return JSON.parse(localStorage.getItem(KEY_INSTALLED) ?? '{}') as Record<string, InstalledSource>;
  } catch {
    return {};
  }
}

export function saveInstalledSource(source: InstalledSource): void {
  const all = listInstalledSources();
  all[source.id] = source;
  localStorage.setItem(KEY_INSTALLED, JSON.stringify(all));
}

export function removeInstalledSource(id: string): void {
  const all = listInstalledSources();
  delete all[id];
  localStorage.setItem(KEY_INSTALLED, JSON.stringify(all));
}
