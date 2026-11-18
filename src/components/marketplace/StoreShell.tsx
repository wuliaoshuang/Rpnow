/**
 * 商店共用壳：浏览 / 搜索 / 分类筛选 / 详情 / 安装与更新。
 *
 * 角色卡商店与插件商店各用一个 kind 写死的页面包一层这个壳；
 * 壳本身不认识“另一类内容”，安装逻辑由调用方传入（卡片只写卡库，
 * 插件只装插件并刷新内核），两类 state（搜索/分类/排序）各自独立。
 *
 * 数据源由 `core/marketplace/client.ts` 提供（默认本地 mock 服务
 * `scripts/market-server.mjs`）。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Download, LayoutGrid, List, Search, ShieldAlert, Store, Tag, User } from 'lucide-react';
import { vibrate } from '@/lib/haptics';
import { formatBytes } from '@/lib/utils.js';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
} from '@/components/ui/misc.js';
import { toast } from '@/components/ui/toast.js';
import { useApp } from '@/state/store.js';
import {
  avatarUrl,
  getItem,
  listInstalledSources,
  queryCardItems,
  queryPluginItems,
  rateItem,
  recordInstall,
  removeInstalledSource,
  reportItem,
  saveInstalledSource,
} from '@/core/marketplace/client.js';
import { isNewerVersion } from '@/core/marketplace/packaging.js';
import { listCategories } from '@/core/marketplace/categories.js';
import { PLUGIN_PERMISSION_LABELS } from '@/core/marketplace/types.js';
import type { MarketItem, MarketKind, PublishManifest } from '@/core/marketplace/types.js';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.js';

type Sort = 'newest' | 'downloads' | 'rating' | 'name';

/** 商店头像：从服务端取最新版包里的 avatar.png；没有头像（404）就显示名字首字占位。
    `bare` 给卡片网格用：图片自己铺满卡片，不带圆角与边框（卡片本身有圆角与裁剪）。 */
function StoreAvatar({ id, name, className, bare }: { id: string; name: string; className?: string; bare?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span
        className={`flex items-center justify-center ${bare ? '' : 'rounded-lg border border-[var(--rp-border)]'} bg-[var(--rp-bg-sunken)] text-[var(--rp-fg-subtle)] ${className ?? ''}`}
        aria-hidden="true"
      >
        {name.slice(0, 1)}
      </span>
    );
  }
  return (
    <img
      src={avatarUrl(id)}
      alt={`${name} 的头像`}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`${bare ? '' : 'rounded-lg border border-[var(--rp-border)]'} object-cover ${className ?? ''}`}
    />
  );
}

export interface StoreShellProps {
  kind: MarketKind;
  /** 角色卡商店显示 NSFW 开关；插件无分级，不显示。 */
  showNsfwToggle: boolean;
  /** 插件详情常驻权限块；角色卡只在 manifest 带权限时显示。 */
  permissionsAlwaysVisible: boolean;
  /** 只做“下载包并装进本地”的那一步；来源记录与计数由壳统一处理。 */
  onInstall: (item: MarketItem) => Promise<void>;
}

export function StoreShell({
  kind,
  showNsfwToggle,
  permissionsAlwaysVisible,
  onInstall,
}: StoreShellProps) {
  const settings = useApp((s) => s.settings);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<Sort>('newest');
  const [items, setItems] = useState<MarketItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<MarketItem | null>(null);
  const [manifest, setManifest] = useState<PublishManifest | null>(null);
  const [installing, setInstalling] = useState(false);
  const [showNsfw, setShowNsfw] = useState(settings.market?.showNsfw === true);
  /** 角色卡商店默认双列卡片网格，列表是可选项（插件店没有图，只有列表）。 */
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [, force] = useState(0);

  const categories = useMemo(() => listCategories(kind), [kind]);
  // 按本类分类树查显示名，避免两类都有 'other' 时串类。
  const categoryLabel = useCallback(
    (id: string) => categories.find((c) => c.id === id)?.label ?? id,
    [categories],
  );
  const installed = useMemo(() => listInstalledSources(), [items]);

  const query = kind === 'card' ? queryCardItems : queryPluginItems;
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await query({
        q: q.trim() || undefined,
        category: category || undefined,
        tag: tag || undefined,
        sort,
        page: 1,
        pageSize: 30,
      });
      // 服务端返回形状不对也不能把整页炸成白屏：缺字段就按空列表算。
      setItems(page?.items ?? []);
    } catch (err) {
      toast.error('无法连接商店', err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [query, q, category, tag, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = showNsfwToggle && !showNsfw ? items.filter((i) => i.manifest.rating !== 'nsfw') : items;

  async function openDetail(item: MarketItem) {
    setDetail(item);
    try {
      const full = await getItem(item.manifest.id);
      setManifest(full?.manifest ?? item.manifest);
    } catch {
      setManifest(item.manifest);
    }
  }

  async function handleInstall(item: MarketItem) {
    if (!item.versions.length) return;
    setInstalling(true);
    try {
      const version = item.versions[0];
      await onInstall(item);
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

  function handleUninstall(id: string) {
    removeInstalledSource(id);
    toast.success('已移除来源记录', '内容本身请用对应的卡片/插件管理删除');
    force((x) => x + 1);
  }

  // permissions 只属于插件 manifest；卡片分支没有该字段。
  const pluginPermissions = manifest?.type === 'plugin' ? manifest.permissions : undefined;
  const showPermissions = permissionsAlwaysVisible || Boolean(pluginPermissions?.length);

  return (
    <div className="rp-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
        {/* 工具栏：搜索 / 分类（单行横滑，不换行）/ 控制行（排序下拉 + NSFW + 视图切换）。
            之前是分类两行 + 排序四个 pill + 开关挤在一行里换行，看着很乱。 */}
        <div className="mb-3 space-y-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索名称 / 简介 / 标签 / 作者"
              className="pl-8"
            />
          </div>
          <div className="rp-no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
            <button
              type="button"
              onClick={() => setCategory('')}
              className={`shrink-0 rounded-full border px-2.5 py-1 text-[11.5px] ${!category ? 'border-[var(--rp-accent)] text-[var(--rp-accent)]' : 'border-[var(--rp-border)] text-[var(--rp-fg-muted)]'}`}
            >
              全部分类
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                className={`shrink-0 rounded-full border px-2.5 py-1 text-[11.5px] ${category === c.id ? 'border-[var(--rp-accent)] text-[var(--rp-accent)]' : 'border-[var(--rp-border)] text-[var(--rp-fg-muted)]'}`}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-[11.5px] text-[var(--rp-fg-subtle)]">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="选择排序方式"
                  className="flex cursor-pointer items-center gap-1 rounded-full border border-[var(--rp-border)] px-2.5 py-1 text-[var(--rp-fg-muted)]"
                >
                  {newestLabel(sort)}
                  <ChevronDown className="size-3.5" aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {(['newest', 'downloads', 'rating', 'name'] as Sort[]).map((s) => (
                  <DropdownMenuItem key={s} onSelect={() => setSort(s)}>
                    <span className={sort === s ? 'font-semibold' : undefined}>{newestLabel(s)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {showNsfwToggle ? (
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showNsfw}
                  onChange={(e) => setShowNsfw(e.target.checked)}
                />
                显示 NSFW
              </label>
            ) : null}
            {kind === 'card' ? (
              <span className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={view === 'grid' ? '切换为列表视图' : '切换为网格视图'}
                  onClick={() => {
                    vibrate('tap');
                    setView((v) => (v === 'grid' ? 'list' : 'grid'));
                  }}
                >
                  {view === 'grid' ? <List className="size-4" aria-hidden="true" /> : <LayoutGrid className="size-4" aria-hidden="true" />}
                  {view === 'grid' ? '列表' : '网格'}
                </Button>
              </span>
            ) : null}
          </div>
        </div>

        {loading ? (
          <p className="py-8 text-center text-[12px] text-[var(--rp-fg-subtle)]">加载中…</p>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Store className="size-5" aria-hidden="true" />}
            title="商店里还没有内容"
            description={
              kind === 'card'
                ? '在角色卡的菜单里选择「发布到商店」，即可把作品放到这里。'
                : '在插件的菜单里选择「发布到商店」，即可把作品放到这里。'
            }
          />
        ) : kind === 'card' && view === 'grid' ? (
          <ul className="grid grid-cols-2 gap-3">
            {visible.map((item) => {
              const src = installed[item.manifest.id];
              const latest = item.versions[0] ?? item.manifest.version;
              const updateAvailable = src ? isNewerVersion(latest, src.version) : false;
              return (
                <li key={item.manifest.id}>
                  <button
                    type="button"
                    onClick={() => void openDetail(item)}
                    className="group relative block aspect-[2/3] w-full overflow-hidden rounded-2xl bg-[var(--rp-bg-sunken)] text-left ring-1 ring-[var(--rp-border)]"
                    aria-label={`查看 ${item.manifest.name} 的详情`}
                  >
                    <StoreAvatar
                      id={item.manifest.id}
                      name={item.manifest.name}
                      bare
                      className="absolute inset-0 size-full text-[28px] transition-transform duration-300 group-hover:scale-105"
                    />
                    {item.manifest.rating === 'nsfw' || updateAvailable ? (
                      <span className="absolute left-2 top-2 flex gap-1">
                        {item.manifest.rating === 'nsfw' ? <Badge variant="danger">NSFW</Badge> : null}
                        {updateAvailable ? <Badge variant="accent">可更新</Badge> : null}
                      </span>
                    ) : null}
                    {/* 已安装：右上角主题色胶囊小标签（勾＋已安装）。 */}
                    {src ? (
                      <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-[var(--rp-accent)] px-2 py-0.5 text-[10.5px] font-medium text-[var(--rp-accent-fg)] shadow-md">
                        <Check className="size-3" aria-hidden="true" />
                        已安装
                      </span>
                    ) : null}
                    {/* 遮罩层：底部渐变，名字与信息压在图上。遮罩要轻——太黑会在白底立绘上
                        洇出一大块黑斑；卡片描边让白底图在浅色主题里也有形状，不至于
                        融进页面里。 */}
                    <span
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 via-black/30 to-transparent"
                    />
                    <span className="absolute inset-x-0 bottom-0 p-3">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="min-w-0 truncate text-[16px] font-semibold leading-tight text-white drop-shadow">
                          {item.manifest.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-white/70">v{latest}</span>
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] leading-tight text-white/85">
                        <span className="flex items-center gap-1">
                          <Tag className="size-3" aria-hidden="true" />
                          {categoryLabel(item.manifest.category)}
                        </span>
                        <span className="flex items-center gap-1">
                          <User className="size-3" aria-hidden="true" />
                          <span className="max-w-[64px] truncate">{item.manifest.author}</span>
                        </span>
                        <span className="flex items-center gap-1">
                          <Download className="size-3" aria-hidden="true" />
                          {item.manifest.stats?.downloads ?? 0}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
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
                    className="flex w-full gap-3 rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3 text-left transition-colors hover:border-[var(--rp-accent)]/50"
                  >
                    {kind === 'card' ? (
                      <StoreAvatar id={item.manifest.id} name={item.manifest.name} className="size-16 shrink-0" />
                    ) : null}
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5 text-[13px] font-medium">
                        {item.manifest.name}
                        <Badge variant="outline">{categoryLabel(item.manifest.category)}</Badge>
                        {item.manifest.rating === 'nsfw' ? <Badge variant="danger">NSFW</Badge> : null}
                        {updateAvailable ? <Badge variant="accent">可更新</Badge> : null}
                      </span>
                      <span className="mt-0.5 block line-clamp-2 text-[11.5px] text-[var(--rp-fg-muted)]">
                        {item.manifest.summary}
                      </span>
                      <span className="mt-1 block text-[10.5px] text-[var(--rp-fg-subtle)]">
                        v{latest} · {item.manifest.author} · 下载 {item.manifest.stats?.downloads ?? 0}
                        {src ? ` · 已装 v${src.version}` : ''}
                      </span>
                    </span>
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
                {kind === 'card' ? (
                  <div className="flex justify-center">
                    <StoreAvatar
                      id={detail.manifest.id}
                      name={detail.manifest.name}
                      className="h-56 w-auto max-w-full text-[32px]"
                    />
                  </div>
                ) : null}
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

                {showPermissions ? (
                  <div className="space-y-1 rounded-md border border-[var(--rp-warning)]/30 bg-[var(--rp-warning)]/5 p-2.5">
                    <p className="flex items-center gap-1.5 font-medium">
                      <ShieldAlert className="size-3.5" aria-hidden="true" /> 声明的权限
                    </p>
                    {pluginPermissions?.length ? (
                      <ul className="list-inside list-disc text-[11.5px] text-[var(--rp-fg-muted)]">
                        {pluginPermissions.map((p) => (
                          <li key={p}>{PLUGIN_PERMISSION_LABELS[p] ?? p}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[11.5px] text-[var(--rp-fg-muted)]">未声明权限。</p>
                    )}
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
    </div>
  );
}

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
