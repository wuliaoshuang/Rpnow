/**
 * 本地商店：浏览 / 搜索 / 分类筛选 / 详情 / 安装与更新。
 *
 * 数据源由 `core/marketplace/client.ts` 提供（默认本地 mock 服务
 * `scripts/market-server.mjs`）。NSFW 内容默认隐藏，需显式开启。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Search, ShieldAlert, Store } from 'lucide-react';
import { formatBytes } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/input.js';
import { Badge, EmptyState } from '@/components/ui/misc.js';
import { toast } from '@/components/ui/toast.js';
import { useApp } from '@/state/store.js';
import { parseCardFile } from '@/core/card/parser.js';
import { install as installPlugin, parseRpnx, listInstalled } from '@/core/plugins/rpnx.js';
import { PublishWizard } from '@/components/marketplace/PublishWizard.js';
import {
  downloadPackage,
  getItem,
  listInstalledSources,
  queryItems,
  recordInstall,
  rateItem,
  reportItem,
  removeInstalledSource,
  saveInstalledSource,
} from '@/core/marketplace/client.js';
import { isNewerVersion, readPublishManifest, readTextFile } from '@/core/marketplace/packaging.js';
import { categoryLabel, listCategories } from '@/core/marketplace/categories.js';
import type { MarketItem, MarketKind, PublishManifest } from '@/core/marketplace/types.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js';

type Sort = 'newest' | 'downloads' | 'rating' | 'name';

export function MarketplacePage() {
  const settings = useApp((s) => s.settings);
  const cards = useApp((s) => s.cards);
  const [kind, setKind] = useState<MarketKind>('card');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [items, setItems] = useState<MarketItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<MarketItem | null>(null);
  const [manifest, setManifest] = useState<PublishManifest | null>(null);
  const [installing, setInstalling] = useState(false);
  const [showNsfw, setShowNsfw] = useState(settings.market?.showNsfw === true);
  /** 发布入口：选择来源后打开向导。 */
  const [publishPickerOpen, setPublishPickerOpen] = useState(false);
  const [publishSubject, setPublishSubject] = useState<{ kind: MarketKind; id: string } | null>(null);
  const [installedPlugins, setInstalledPlugins] = useState<Array<{ id: string; name: string }>>([]);
  const [, force] = useState(0);

  useEffect(() => {
    void listInstalled()
      .then((list) => setInstalledPlugins(list.map((p) => ({ id: p.manifest.id, name: p.manifest.name }))))
      .catch(() => setInstalledPlugins([]));
  }, []);

  const categories = useMemo(() => listCategories(kind), [kind]);
  const installed = useMemo(() => listInstalledSources(), [items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await queryItems({
        kind,
        q: q.trim() || undefined,
        category: category || undefined,
        tag: tag || undefined,
        sort,
        page: 1,
        pageSize: 30,
      });
      setItems(page.items);
      setTotal(page.total);
    } catch (err) {
      toast.error('无法连接商店', err instanceof Error ? err.message : String(err));
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [kind, q, category, tag, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = showNsfw ? items : items.filter((i) => i.manifest.rating !== 'nsfw');

  async function openDetail(item: MarketItem) {
    setDetail(item);
    try {
      const full = await getItem(item.manifest.id);
      setManifest(full.manifest);
    } catch {
      setManifest(item.manifest);
    }
  }

  async function handleInstall(item: MarketItem) {
    if (!item.versions.length) return;
    setInstalling(true);
    try {
      const version = item.versions[0];
      const pkg = await downloadPackage(item.manifest.id, version);
      const pub = await readPublishManifest(pkg);
      if (pub.type === 'card') {
        const cardJson = await readTextFile(pkg, 'card.json');
        if (!cardJson) throw new Error('发布包缺少 card.json');
        const parsed = await parseCardFile(new Blob([cardJson], { type: 'application/json' }), pub.name);
        await useApp.getState().addCard(parsed.card);
      } else {
        const parsed = await parseRpnx(pkg);
        await installPlugin(parsed, true);
      }
      saveInstalledSource({ id: item.manifest.id, kind: item.manifest.type, version, installedAt: new Date().toISOString(), source: 'market' });
      void recordInstall(item.manifest.id).catch(() => {});
      toast.success(`已安装「${item.manifest.name}」v${version}`);
      setDetail(null);
      force((x) => x + 1);
    } catch (err) {
      toast.error('安装失败', err instanceof Error ? err.message : String(err));
    } finally {
      setInstalling(false);
    }
  }

  async function handleUninstall(id: string) {
    removeInstalledSource(id);
    toast.success('已移除来源记录', '内容本身请用对应的卡片/插件管理删除');
    force((x) => x + 1);
  }

  return (
    <div className="rp-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setPublishPickerOpen(true)}>
            <Store className="size-3.5" aria-hidden="true" /> 发布内容
          </Button>
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
              <Store className="size-4" aria-hidden="true" /> 商店
            </h3>
            <p className="text-[11.5px] text-[var(--rp-fg-muted)]">
              本地商店源：{settings.market?.baseURL ?? 'http://127.0.0.1:8799'} · 共 {total} 件
            </p>
          </div>
          <div className="flex rounded-lg border border-[var(--rp-border)] p-0.5 text-[12px]">
            {(['card', 'plugin'] as MarketKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  setKind(k);
                  setCategory('');
                }}
                className={`rounded-md px-2.5 py-1 ${kind === k ? 'bg-[var(--rp-accent-soft)] text-[var(--rp-accent)]' : 'text-[var(--rp-fg-muted)]'}`}
              >
                {k === 'card' ? '角色卡' : '插件'}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-3 space-y-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索名称 / 简介 / 标签 / 作者"
              className="pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setCategory('')}
              className={`rounded-full border px-2.5 py-1 text-[11.5px] ${!category ? 'border-[var(--rp-accent)] text-[var(--rp-accent)]' : 'border-[var(--rp-border)] text-[var(--rp-fg-muted)]'}`}
            >
              全部分类
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`rounded-full border px-2.5 py-1 text-[11.5px] ${category === c.id ? 'border-[var(--rp-accent)] text-[var(--rp-accent)]' : 'border-[var(--rp-border)] text-[var(--rp-fg-muted)]'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between text-[11.5px] text-[var(--rp-fg-subtle)]">
            <span className="flex flex-wrap items-center gap-1">
              排序
              {(['newest', 'downloads', 'rating', 'name'] as Sort[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSort(s)}
                  className={`rounded-full border px-2 py-0.5 ${sort === s ? 'border-[var(--rp-accent)] text-[var(--rp-accent)]' : 'border-[var(--rp-border)] text-[var(--rp-fg-muted)]'}`}
                >
                  {newestLabel(s)}
                </button>
              ))}
            </span>
            <label className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={showNsfw}
                onChange={(e) => setShowNsfw(e.target.checked)}
              />
              显示 NSFW
            </label>
          </div>
        </div>

        {loading ? (
          <p className="py-8 text-center text-[12px] text-[var(--rp-fg-subtle)]">加载中…</p>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Store className="size-5" aria-hidden="true" />}
            title="商店里还没有内容"
            description="在角色卡或插件的菜单里选择「发布到商店」，即可把作品放到这里。"
          />
        ) : (
          <ul className="space-y-2">
            {visible.map((item) => {
              const src = installed[item.manifest.id];
              const latest = item.versions[0] ?? item.manifest.version;
              const updateAvailable = src ? isNewerVersion(latest, src.version) : false;
              return (
                <li key={item.manifest.id}>
                  <button
                    type="button"
                    onClick={() => void openDetail(item)}
                    className="block w-full rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3 text-left transition-colors hover:border-[var(--rp-accent)]/50"
                  >
                    <p className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                      {item.manifest.name}
                      <Badge variant="outline">{categoryLabel(item.manifest.category)}</Badge>
                      {item.manifest.rating === 'nsfw' ? <Badge variant="danger">NSFW</Badge> : null}
                      {updateAvailable ? <Badge variant="accent">可更新</Badge> : null}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-[11.5px] text-[var(--rp-fg-muted)]">
                      {item.manifest.summary}
                    </p>
                    <p className="mt-1 text-[10.5px] text-[var(--rp-fg-subtle)]">
                      v{latest} · {item.manifest.author} · 下载 {item.manifest.stats?.downloads ?? 0}
                      {src ? ` · 已装 v${src.version}` : ''}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-h-[85vh] max-w-xl overflow-y-auto">
          {detail ? (
            <>
              <DialogHeader>
                <DialogTitle>{detail.manifest.name}</DialogTitle>
                <DialogDescription>
                  {manifest?.summary} · {manifest?.author} · v{manifest?.version ?? detail.manifest.version}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-[12px]">
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant="outline">{categoryLabel(detail.manifest.category)}</Badge>
                  {(manifest?.tags ?? []).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setTag(t);
                        setDetail(null);
                        void load();
                      }}
                      className="rounded-full border border-[var(--rp-border)] px-2 py-0.5 text-[11px] text-[var(--rp-fg-muted)]"
                    >
                      #{t}
                    </button>
                  ))}
                </div>

                {manifest?.description ? (
                  <p className="whitespace-pre-wrap text-[var(--rp-fg-muted)]">{manifest.description}</p>
                ) : null}

                {manifest?.permissions?.length ? (
                  <div className="space-y-1 rounded-md border border-[var(--rp-warning)]/30 bg-[var(--rp-warning)]/5 p-2.5">
                    <p className="flex items-center gap-1.5 font-medium">
                      <ShieldAlert className="size-3.5" aria-hidden="true" /> 声明的权限
                    </p>
                    <ul className="list-inside list-disc text-[11.5px] text-[var(--rp-fg-muted)]">
                      {manifest.permissions.map((p) => (
                        <li key={p}>{PERMISSION_LABELS[p] ?? p}</li>
                      ))}
                    </ul>
                    <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                      插件代码以应用同等权限运行；安装即表示你信任其来源。
                    </p>
                  </div>
                ) : null}

                {manifest?.contentWarnings?.length ? (
                  <p className="text-[11.5px] text-[var(--rp-danger)]">
                    内容警告：{manifest.contentWarnings.join('、')}
                  </p>
                ) : null}

                {manifest?.changelog ? (
                  <p className="whitespace-pre-wrap rounded-md bg-[var(--rp-bg-sunken)]/40 p-2 text-[11.5px]">
                    {manifest.changelog}
                  </p>
                ) : null}

                <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                  许可 {manifest?.license ?? '-'} · 大小 {formatBytes(detail.size)} · 更新于{' '}
                  {(detail.updatedAt ?? '').slice(0, 10) || '-'}
                </p>

                {detail.versions.length > 1 ? (
                  <details className="rounded-md bg-[var(--rp-bg-sunken)]/40 p-2 text-[11.5px]">
                    <summary className="cursor-pointer text-[var(--rp-fg-muted)]">
                      版本历史（{detail.versions.length}）
                    </summary>
                    <ul className="mt-1 space-y-0.5">
                      {detail.versions.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-[var(--rp-fg-subtle)]">
                  <span>
                    下载 {detail.manifest.stats?.downloads ?? 0} · 赞 {detail.manifest.stats?.likes ?? 0} · 踩{' '}
                    {detail.manifest.stats?.dislikes ?? 0}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      void rateItem(detail.manifest.id, 'like').then(() => {
                        void load();
                        toast.success('已点赞');
                      });
                    }}
                  >
                    赞
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void rateItem(detail.manifest.id, 'dislike').then(() => {
                        void load();
                      });
                    }}
                  >
                    踩
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void reportItem(detail.manifest.id, 'other').then(() =>
                        toast.success('已提交举报', '感谢反馈，我们会人工复核'),
                      );
                    }}
                  >
                    举报
                  </button>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    onClick={() => void handleInstall(detail)}
                    disabled={installing}
                    className="flex-1"
                  >
                    <Download className="size-3.5" aria-hidden="true" />
                    {installing ? '安装中…' : installed[detail.manifest.id] ? '重新安装 / 更新' : '安装'}
                  </Button>
                  {installed[detail.manifest.id] ? (
                    <Button variant="outline" onClick={() => handleUninstall(detail.manifest.id)}>
                      移除来源记录
                    </Button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* 发布来源选择：卡片或已安装插件 */}
      <Dialog open={publishPickerOpen} onOpenChange={(o) => !o && setPublishPickerOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>发布到商店</DialogTitle>
            <DialogDescription>选择要打包的内容，随后填写元数据并上传。</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium">角色卡</label>
              <Select
                value=""
                onValueChange={(id) => {
                  if (id) setPublishSubject({ kind: 'card', id });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`选择卡片（${cards.length}）`} />
                </SelectTrigger>
                <SelectContent>
                  {cards.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.data.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium">插件</label>
              <Select
                value=""
                onValueChange={(id) => {
                  if (id) setPublishSubject({ kind: 'plugin', id });
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder={`选择已安装插件（${installedPlugins.length}）`} />
                </SelectTrigger>
                <SelectContent>
                  {installedPlugins.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              disabled={!publishSubject}
              onClick={() => {
                setPublishPickerOpen(false);
              }}
            >
              下一步
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <PublishWizard
        kind={publishSubject?.kind ?? kind}
        subjectId={publishSubject?.id ?? ''}
        open={!!publishSubject}
        onClose={() => setPublishSubject(null)}
      />
    </div>
  );
}

const PERMISSION_LABELS: Record<string, string> = {
  network: '网络访问',
  storage: '本地存储',
  clipboard: '剪贴板',
  filesystem: '文件读写',
  'render-injection': '界面/渲染注入',
  'top-window': '顶层窗口访问',
};

function newestLabel(sort: Sort): string {
  switch (sort) {
    case 'downloads':
      return '最多下载';
    case 'rating':
      return '评分最高';
    case 'name':
      return '名称';
    default:
      return '最近更新';
  }
}
