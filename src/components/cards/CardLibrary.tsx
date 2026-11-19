/**
 * Card library.
 *
 * The entry point for most users: see your cards, drop new files anywhere on the
 * page, and open one to chat. Import feedback is per-file and loud, because a
 * silently-skipped card is the worst outcome for a library screen.
 */

import * as React from 'react';
import {
  Check,
  Download,
  FileArchive,
  IdCard,
  Layers,
  Pencil,
  Plus,
  Search,
  Star,
  Trash2,
  Upload,
  MessageSquarePlus,
  MoreVertical,
  List,
  LayoutGrid,
  Store,
  X,
} from 'lucide-react';
import { cn, downloadBlob, safeFilename, uid } from '@/lib/utils';
import { useApp } from '@/state/store.js';
import type { RPCard } from '@/core/types/card.js';
import { PublishWizard } from '@/components/marketplace/PublishWizard.js';
import type { RPChat } from '@/core/types/chat.js';
import { buildGreetings } from '@/features/chat/orchestrator.js';
import { importFiles } from '@/features/import/cardImport.js';
import { toPngBlob, toJsonBlob, toCharXBlob, parseCardFile } from '@/core/card/parser.js';
import {
  downloadPackage,
  listInstalledSources,
  queryCardItems,
  recordInstall,
  saveInstalledSource,
} from '@/core/marketplace/client.js';
import { readPublishManifest } from '@/core/marketplace/packaging.js';
import type { MarketItem } from '@/core/marketplace/types.js';
import { CardAIGenerateDialog } from './CardAIGenerateDialog.js';
import { CardIntroPanel } from './CardIntroPanel.js';
import { SLOT, SlotOutlet } from '@/core/plugin/slots.js';
import { CreateCharacterPage } from './CreateCharacterPage.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/ui/misc';
import {
  DropdownMenu,
  DropdownMenuLabel,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/misc';
import { toast } from '@/components/ui/toast.js';
import { vibrate } from '@/lib/haptics';
import { CardEditor } from '@/components/cards/CardEditor.js';
import { ImportDialog } from '@/components/cards/ImportDialog.js';
import { ExportSelectionModal } from '@/components/export/ExportSelectionModal.js';
import { loreItemId, regexItemId, selectiveCard } from '@/core/export/selective.js';
import type { RPRegexScript } from '@/core/types/card.js';
import { CharacterDeck } from '@/components/cards/CharacterDeck.js';
import { confirmAction } from '@/components/ui/confirm.js';

/** Long-press threshold for entering selection mode (same as the novel bookshelf). */
const LONG_PRESS_MS = 500;

export interface CardLibraryProps {
  onStartChat: (cardId: string) => void;
}

export function CardLibrary({ onStartChat }: CardLibraryProps) {
  const cards = useApp((s) => s.cards);
  const removeCard = useApp((s) => s.removeCard);
  const updateCard = useApp((s) => s.updateCard);
  const addCard = useApp((s) => s.addCard);
  const saveChat = useApp((s) => s.saveChat);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const personas = useApp((s) => s.personas);
  const setActiveChat = useApp((s) => s.setActiveChat);

  const [query, setQuery] = React.useState('');
  const [dragOver, setDragOver] = React.useState(false);
  const [editing, setEditing] = React.useState<RPCard | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [aiOpen, setAiOpen] = React.useState(false);
  /** 创建角色子页面（＋ 的唯一去向）。 */
  const [createOpen, setCreateOpen] = React.useState(false);
  /** Card layout: Tavo offers both a poster grid and a compact list; RP-Hub adds a stacked deck. */
  const [view, setView] = React.useState<'grid' | 'list' | 'deck'>('grid');
  /** Batch-delete selection (long-press a card to enter, tap to toggle). */
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  const selecting = selectedIds.size > 0;
  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = React.useRef(false);
  /** Pointer position where the current long-press started (move cancels it). */
  const longPressStart = React.useRef<{ x: number; y: number } | null>(null);
  const lastPointerType = React.useRef<string>('mouse');
  /** Card whose long-press action menu is open. */
  const [menuCard, setMenuCard] = React.useState<RPCard | null>(null);
  /** Card id being published to the marketplace (opens the wizard). */
  const [publishingId, setPublishingId] = React.useState<string | null>(null);
  const [introCard, setIntroCard] = React.useState<RPCard | null>(null);
  const [importing, setImporting] = React.useState(false);
  const [importResult, setImportResult] = React.useState<Awaited<ReturnType<typeof importFiles>> | null>(null);
  /** Card open in the selective-export sheet (P10). */
  const [exportingCard, setExportingCard] = React.useState<RPCard | null>(null);
  const fileInput = React.useRef<HTMLInputElement>(null);

  const setHideTopbar = useApp((s) => s.setHideTopbar);
  // 创建角色子页面和角色卡编辑器都自带返回头，壳顶栏要藏起来，免得两个头叠着。
  const editorOpen = Boolean(editing || creating);
  React.useEffect(() => {
    setHideTopbar(createOpen || editorOpen);
    return () => setHideTopbar(false);
  }, [createOpen, editorOpen, setHideTopbar]);

  /** 商店里的卡（快捷导入用）：打开创建页时拉一次，拉不到就藏起这块。 */
  const [storePicks, setStorePicks] = React.useState<MarketItem[]>([]);
  const [installingId, setInstallingId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!createOpen) return;
    let alive = true;
    queryCardItems({ page: 1, pageSize: 6, sort: 'newest' })
      .then((page) => {
        if (alive) setStorePicks(page?.items ?? []);
      })
      .catch(() => {
        if (alive) setStorePicks([]);
      });
    return () => {
      alive = false;
    };
  }, [createOpen]);

  const installedSources = React.useMemo(() => listInstalledSources(), [storePicks, cards]);

  /** 点商店里的卡：已装过且本地还在就直接打开；否则下载安装再打开。 */
  async function handleStorePick(item: MarketItem) {
    const storeId = item.manifest.id;
    if (installedSources[storeId]) {
      const local = cards.find((c) => c.data.name === item.manifest.name);
      if (local) {
        setCreateOpen(false);
        setIntroCard(local);
        return;
      }
    }
    if (installingId) return;
    setInstallingId(storeId);
    try {
      if (!item.versions.length) throw new Error('这张卡没有可用版本');
      const version = item.versions[0];
      const pkg = await downloadPackage(storeId, version);
      const pub = await readPublishManifest(pkg);
      if (pub.type !== 'card') throw new Error('该发布包不是角色卡');
      const parsed = await parseCardFile(pkg, `${pub.name}.rpcard`);
      await addCard(parsed.card);
      saveInstalledSource({ id: storeId, kind: item.manifest.type, version, installedAt: new Date().toISOString(), source: 'market' });
      void recordInstall(storeId).catch(() => {});
      toast.success(`已安装「${item.manifest.name}」`);
      void askAutoImageGen(1);
      setCreateOpen(false);
      setIntroCard(parsed.card);
    } catch (err) {
      toast.error('安装失败', err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingId(null);
    }
  }

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = [...cards];
    if (!q) return list.sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false) || b.updatedAt - a.updatedAt);
    return list
      .filter((c) => {
        const haystack = [c.data.name, c.data.creator, ...(c.data.tags ?? []), c.data.description]
          .join(' ')
          .toLowerCase();
        return haystack.includes(q);
      })
      .sort((a, b) => Number(b.favorite ?? false) - Number(a.favorite ?? false) || b.updatedAt - a.updatedAt);
  }, [cards, query]);

  const clearLongPress = React.useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
    longPressStart.current = null;
  }, []);

  React.useEffect(() => clearLongPress, [clearLongPress]);

  const toggleSelect = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Begin a long-press: after 500ms the card joins the selection. */
  const beginLongPress = React.useCallback(
    (e: React.PointerEvent, id: string) => {
      lastPointerType.current = e.pointerType;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      longPressed.current = false;
      clearLongPress();
      longPressStart.current = { x: e.clientX, y: e.clientY };
      longPressTimer.current = setTimeout(() => {
        longPressed.current = true;
        vibrate('tap');
        toggleSelect(id);
      }, LONG_PRESS_MS);
    },
    [clearLongPress, toggleSelect],
  );

  /**
   * Cancel a pending long-press once the pointer actually moves away.
   * Deliberately NOT onPointerLeave: the grid's stagger-in animation moves
   * tiles under a stationary pointer, and that leave would cancel a
   * legitimate long-press before the timer fires.
   */
  const cancelLongPressOnMove = React.useCallback(
    (e: React.PointerEvent) => {
      const start = longPressStart.current;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
        clearLongPress();
      }
    },
    [clearLongPress],
  );

  /** Switch views; the deck is for browsing, so selection is left behind. */
  function switchView(next: 'grid' | 'list' | 'deck') {
    vibrate('tap');
    if (next === 'deck') setSelectedIds(new Set());
    setView(next);
  }

  const handleDeleteSelected = React.useCallback(async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    const label =
      count === 1
        ? `「${cards.find((c) => selectedIds.has(c.id))?.data.name ?? ''}」`
        : `${count} 张角色卡`;
    if (
      !(await confirmAction({
        title: '确认操作',
        description: `删除${label}？相关对话不会被删除，此操作无法撤销。`,
      }))
    )
      return;
    // One deletion per card, awaited in sequence: each removeCard reads the
    // fresh list from the store, so the next call sees the previous deletion.
    for (const id of selectedIds) await removeCard(id);
    setSelectedIds(new Set());
    toast.success(`已删除 ${count} 张角色卡`);
  }, [selectedIds, cards, removeCard]);

  async function handleFiles(files: FileList | File[]) {
    const arr = Array.from(files);
    if (!arr.length) return;
    setImporting(true);
    try {
      const res = await importFiles(arr);
      for (const c of res.cards) await addCard(c);
      // Lorebooks and presets are handled by their own stores; announce them so
      // the user knows they were not dropped.
      const extras =
        res.lorebooks.length + res.presets.length + res.contextTemplates.length + res.instructTemplates.length;
      setImportResult(res);
      if (res.cards.length) {
        toast.success(`已导入 ${res.cards.length} 张角色卡`, extras ? `另有 ${extras} 个世界书/预设已识别` : undefined);
        // R07: RP-Hub asks after a card import whether to turn on auto image gen.
        void askAutoImageGen(res.cards.length);
      } else if (res.regexScripts.length) {
        toast.success(`已导入 ${res.regexScripts.length} 条正则脚本`, '可在导入结果里附加到角色卡');
      } else if (res.outcomes.some((o) => o.kind === 'error')) {
        toast.error('导入失败', res.outcomes.find((o) => o.kind === 'error')?.message);
      }
    } finally {
      setImporting(false);
    }
  }

  /** R07: ask once after an import whether replies should auto-generate images. */
  async function askAutoImageGen(count: number) {
    if (settings.imageGen.autoGenerate) return;
    const ok = await confirmAction({
      title: '开启自动生图？',
      description: `已导入 ${count} 张角色卡，是否在每次助手回复后自动生成配图？`,
      confirmText: '立即开启',
      cancelText: '暂不开启',
    });
    if (!ok) return;
    setSettings({ imageGen: { ...settings.imageGen, autoGenerate: true } });
    toast.success('已开启自动生图', settings.imageGen.key ? undefined : '还需在设置里配置生图密钥');
  }

  /** P09: attach imported standalone regex scripts to one of the user's cards. */
  async function attachRegexScripts(scripts: RPRegexScript[], cardId: string) {
    const target = cards.find((c) => c.id === cardId);
    if (!target) return;
    const existing = (target.data.extensions?.regex_scripts as RPRegexScript[] | undefined) ?? [];
    await updateCard(cardId, (c) => ({
      ...c,
      data: {
        ...c.data,
        extensions: { ...c.data.extensions, regex_scripts: [...existing, ...scripts] },
      },
    }));
    toast.success(`已把 ${scripts.length} 条正则附加到「${target.data.name}」`);
  }

  /** P10: export a card with only the checked lorebook entries / regex scripts. */
  function exportCardSelective(card: RPCard, selected: Record<string, string[]>) {
    try {
      const picked = selectiveCard(card, selected.lorebook ?? [], selected.regex ?? []);
      downloadBlob(toJsonBlob(picked, card.spec === 'v3' ? 'v3' : 'v2'), safeFilename(`${card.data.name}-精选`, 'json'));
      toast.success('已导出选中内容');
    } catch (err) {
      toast.error('导出失败', err instanceof Error ? err.message : String(err));
    }
  }

  function startChat(card: RPCard) {
    const chat: RPChat = {
      id: uid('chat'),
      title: card.data.name,
      cardId: card.id,
      lorebookIds: [],
      useCardLorebook: true,
      personaId: personas[0]?.id,
      connectionId: settings.defaultConnectionId,
      model: undefined,
      messages: buildGreetings(card),
      variables: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    void saveChat(chat);
    setActiveChat(chat.id);
    onStartChat(chat.id);
  }

  async function exportCard(card: RPCard, format: 'png' | 'json' | 'charx') {
    try {
      let blob: Blob;
      let ext: string;
      if (format === 'png') {
        blob = await toPngBlob(card);
        ext = 'png';
      } else if (format === 'charx') {
        blob = await toCharXBlob(card);
        ext = 'charx';
      } else {
        blob = toJsonBlob(card, card.spec === 'v3' ? 'v3' : 'v2');
        ext = 'json';
      }
      downloadBlob(blob, safeFilename(card.data.name, ext));
      toast.success(`已导出 .${ext}`);
    } catch (err) {
      toast.error('导出失败', err instanceof Error ? err.message : String(err));
    }
  }

  // 创建角色子页面：＋ 的唯一去向，返回时回到列表。
  if (createOpen) {
    return (
      <CreateCharacterPage
        onBack={() => setCreateOpen(false)}
        onNew={() => {
          setCreateOpen(false);
          setCreating(true);
        }}
        onImportFile={() => {
          setCreateOpen(false);
          fileInput.current?.click();
        }}
        onImportUrl={() => {
          setCreateOpen(false);
          setAiOpen(true);
        }}
        storePicks={storePicks}
        installedIds={installedSources}
        installingId={installingId}
        onStorePick={(item) => {
          void handleStorePick(item);
        }}
      />
    );
  }

  return (
    <div
      className="relative flex h-full min-h-0 flex-col"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      {/*
        Toolbar. `flex-wrap` + a shrinkable search box: on a 390px phone the
        search field previously overflowed and its input swallowed taps meant
        for the view-toggle button.
      */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-[var(--rp-border)] px-3 py-2.5 sm:flex-nowrap sm:px-5">
        <div className="relative min-w-0 flex-1 basis-[8rem]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索角色名、标签、作者…"
            aria-label="搜索角色卡"
            className="h-9 pl-8"
          />
        </div>
        {/*
          Toolbar actions. Each carries a visible label — icon-only buttons on a
          phone were unreadable and crowded together.
        */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <div className="flex shrink-0 items-center gap-1" role="group" aria-label="卡库视图">
            <Button
              variant={view === 'grid' ? 'secondary' : 'ghost'}
              size="sm"
              aria-label="网格视图"
              aria-pressed={view === 'grid'}
              onClick={() => switchView('grid')}
            >
              <LayoutGrid className="size-4" aria-hidden="true" />
              网格
            </Button>
            <Button
              variant={view === 'list' ? 'secondary' : 'ghost'}
              size="sm"
              aria-label="列表视图"
              aria-pressed={view === 'list'}
              onClick={() => switchView('list')}
            >
              <List className="size-4" aria-hidden="true" />
              列表
            </Button>
            <Button
              variant={view === 'deck' ? 'secondary' : 'ghost'}
              size="sm"
              aria-label="叠卡视图"
              aria-pressed={view === 'deck'}
              onClick={() => switchView('deck')}
            >
              <Layers className="size-4" aria-hidden="true" />
              叠卡
            </Button>
          </div>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".png,.json,.yaml,.yml,.charx,.byaf,.txt"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {/*
            单一入口：＋ → 创建角色子页面，那里再分「新建 / 从文件 / 从 URL」。
            Three competing buttons in a 390px toolbar crowded each other out.
          */}
          <Button size="sm" onClick={() => setCreateOpen(true)} aria-label="新建角色">
            <Plus className="size-3.5" aria-hidden="true" /> 新建
          </Button>
        </div>
      </div>

      {/* Grid / list / deck */}
      <div className={`rp-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-5${selecting ? ' pb-24' : ''}`}>
        {filtered.length === 0 ? (
          <EmptyState
            icon={<IdCard className="size-6" aria-hidden="true" />}
            title={query ? '没有匹配的角色' : '还没有角色卡'}
            description={
              query
                ? '换个关键词试试。'
                : '把 PNG / JSON / CharX 角色卡直接拖到这个页面，或者新建一张自己的角色卡。'
            }
            action={
              !query && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => fileInput.current?.click()}>
                    <Upload className="size-3.5" aria-hidden="true" /> 导入角色卡
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                    手动创建
                  </Button>
                </div>
              )
            }
          />
        ) : view === 'deck' ? (
          <CharacterDeck
            cards={filtered}
            onOpen={(card) => setIntroCard(card)}
            onStartChat={(card) => startChat(card)}
          />
        ) : view === 'list' ? (
          /* Compact list: round portrait, name, and the card's own metadata —
             matches the second reference screenshot. */
          <ul className="rp-anim-stagger divide-y divide-[var(--rp-border)]">
            {filtered.map((card) => {
              const tags = (card.data.tags ?? []).filter(Boolean);
              const creator = card.data.creator;
              const version = card.data.character_version;
              const spec = card.specVersion || card.spec;
              const isSelected = selectedIds.has(card.id);
              return (
                <li key={card.id}>
                  <div
                    className={`flex items-center gap-3 px-1 py-3 transition-colors hover:bg-[var(--rp-bg-sunken)]/50${isSelected ? ' bg-[var(--rp-accent-soft)]/40' : ''}`}
                    onContextMenu={(e) => e.preventDefault()}
                    onPointerDown={(e) => beginLongPress(e, card.id)}
                    onPointerUp={clearLongPress}
                    onPointerMove={cancelLongPressOnMove}
                    onPointerCancel={clearLongPress}
                    onClick={() => {
                      if (selecting) toggleSelect(card.id);
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        if (longPressed.current) {
                          longPressed.current = false;
                          e.stopPropagation();
                          return;
                        }
                        if (selecting) return;
                        vibrate('tap');
                        startChat(card);
                      }}
                      aria-label={selecting ? `选择 ${card.data.name}` : `和 ${card.data.name} 开始对话`}
                      aria-pressed={selecting ? isSelected : undefined}
                      className="flex min-w-0 flex-1 cursor-pointer select-none items-center gap-3 text-left [-webkit-touch-callout:none]"
                    >
                      <span className="relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[16px] font-semibold text-[var(--rp-fg-muted)]">
                        {card.avatar ? (
                          <img src={card.avatar} alt="" className="size-full object-cover" loading="lazy" />
                        ) : (
                          card.data.name.slice(0, 1)
                        )}
                        {isSelected && (
                          <span className="absolute inset-0 flex items-center justify-center bg-black/40">
                            <Check className="size-5 text-white" aria-hidden="true" />
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[14.5px] font-semibold">{card.data.name}</span>
                          {card.favorite && (
                            <Star className="size-3 shrink-0 fill-current text-[var(--rp-warn)]" aria-hidden="true" />
                          )}
                        </span>
                        {(version || tags.length || creator) && (
                          <span className="mt-0.5 flex items-center gap-1.5 overflow-hidden text-[11px] text-[var(--rp-fg-muted)]">
                            {version && (
                              <span className="shrink-0 rounded bg-[var(--rp-bg-sunken)] px-1 py-px">▤ {version}</span>
                            )}
                            {tags.length > 0 && (
                              <span className="truncate">🏷 {tags.slice(0, 3).join('、')}{tags.length > 3 ? '…' : ''}</span>
                            )}
                            {creator && <span className="shrink-0">👤 {creator}</span>}
                          </span>
                        )}
                        {card.data.description && (
                          <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-[var(--rp-fg-subtle)]">
                            {card.data.description.replace(/\s+/g, ' ').slice(0, 60)}
                          </span>
                        )}
                        <span className="sr-only">{spec}</span>
                      </span>
                    </button>
                    {!selecting && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="shrink-0"
                          aria-label={`${card.data.name} 的更多操作`}
                        >
                          <MoreVertical className="size-4" aria-hidden="true" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setIntroCard(card)}>简介</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => startChat(card)}>开始对话</DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            void updateCard(card.id, { favorite: !card.favorite });
                          }}
                        >
                          {card.favorite ? '取消收藏' : '收藏'}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          onSelect={async () => {
                            if (await confirmAction({ title: '确认操作', description: `删除角色卡「${card.data.name}」？` })) void removeCard(card.id);
                          }}
                        >
                          删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <ul className="rp-anim-stagger grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((card) => {
              const isSelected = selectedIds.has(card.id);
              /*
               * Pure poster card, matching the reference: the art fills the
               * tile, the name sits on a bottom gradient scrim, and the ⋮ menu
               * hides in the top-right corner. Every action (简介 / 编辑 /
               * 导出 / 置顶 / 删除) lives behind long-press or ⋮ — nothing else
               * clutters the card.
               */
              return (
                <li key={card.id}>
                  <article
                    className={`rp-tap-card group relative aspect-[3/4] w-full select-none overflow-hidden rounded-2xl bg-[var(--rp-bg-sunken)] [-webkit-touch-callout:none]${isSelected ? ' ring-2 ring-[var(--rp-accent)] ring-offset-2 ring-offset-[var(--rp-bg)]' : ''}`}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      // Touch long-press belongs to selection mode; only a
                      // mouse right-click opens the action menu here.
                      if (lastPointerType.current !== 'mouse') return;
                      if (longPressed.current) return;
                      vibrate('tap');
                      setMenuCard(card);
                    }}
                    onPointerDown={(e) => beginLongPress(e, card.id)}
                    onPointerUp={clearLongPress}
                    onPointerMove={cancelLongPressOnMove}
                    onPointerCancel={clearLongPress}
                    onClick={() => {
                      if (selecting) toggleSelect(card.id);
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        if (longPressed.current) {
                          longPressed.current = false;
                          e.stopPropagation();
                          return;
                        }
                        if (selecting) return;
                        vibrate('tap');
                        // Tap = open the detail sheet, NOT a new chat: the user
                        // reads who this is first, then starts from there.
                        setIntroCard(card);
                      }}
                      className="block size-full cursor-pointer"
                      aria-label={selecting ? `选择 ${card.data.name}` : `查看 ${card.data.name} 的角色详情`}
                      aria-pressed={selecting ? isSelected : undefined}
                    >
                      {card.avatar ? (
                        <img
                          src={card.avatar}
                          alt=""
                          className="size-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center bg-gradient-to-br from-[var(--rp-accent-soft)] to-[var(--rp-bg-sunken)] text-3xl font-semibold text-[var(--rp-accent)]">
                          {card.data.name.slice(0, 1)}
                        </div>
                      )}
                    </button>

                    {/* Name scrim: gradient from the bottom edge, as in the
                        reference — the art fades out under the label. */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/75 via-black/35 to-transparent"
                    />
                    <span className="pointer-events-none absolute bottom-3 left-3 right-3 text-[15px] font-semibold leading-tight text-white drop-shadow">
                      {card.data.name}
                    </span>

                    {/* ⋮ tucked in the top-right corner (hidden while selecting). */}
                    {!selecting && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          aria-label={`${card.data.name} 的操作菜单`}
                          onClick={(e) => e.stopPropagation()}
                          className="absolute right-2 top-2 flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/35 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/55 hover:text-white"
                        >
                          <MoreVertical className="size-4" aria-hidden="true" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => { vibrate('tap'); startChat(card); }}>
                          <MessageSquarePlus className="size-3.5" aria-hidden="true" /> 开始对话
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setIntroCard(card)}>
                          简介
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setEditing(card)}>
                          <Pencil className="size-3.5" aria-hidden="true" /> 编辑角色卡
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() => {
                            void updateCard(card.id, { favorite: !card.favorite });
                          }}
                        >
                          <Star className="size-3.5" aria-hidden="true" /> {card.favorite ? '取消置顶' : '置顶（收藏）'}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void exportCard(card, 'png')}>
                          <Download className="size-3.5" aria-hidden="true" /> 导出 PNG
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void exportCard(card, 'json')}>
                          <Download className="size-3.5" aria-hidden="true" /> 导出 JSON
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => void exportCard(card, 'charx')}>
                          <FileArchive className="size-3.5" aria-hidden="true" /> 导出 CharX
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setExportingCard(card)}>
                          <Download className="size-3.5" aria-hidden="true" /> 选择性导出…
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setPublishingId(card.id)}>
                          <Store className="size-3.5" aria-hidden="true" /> 发布到商店
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          destructive
                          onSelect={async () => {
                            if (!(await confirmAction({ title: '确认操作', description: `删除角色卡「${card.data.name}」？相关对话不会被删除。` }))) return;
                            void removeCard(card.id);
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" /> 删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                    )}

                    {isSelected && (
                      <>
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-0 bg-black/25"
                        />
                        <span className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-full bg-[var(--rp-accent)] text-[var(--rp-accent-fg)] shadow">
                          <Check className="size-3.5" aria-hidden="true" />
                        </span>
                      </>
                    )}
                    {card.favorite && (
                      <Star
                        className="pointer-events-none absolute left-2 top-2 size-4 fill-current text-[var(--rp-warn)] drop-shadow"
                        aria-hidden="true"
                      />
                    )}
                    {/* Plugin widgets for this card tile. */}
                    <SlotOutlet slot={SLOT.CARD_TILE} componentProps={{ card }} />
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {/* Batch-delete bar: same pattern as the novel bookshelf. */}
      {selecting && (
        <div className="absolute inset-x-0 bottom-0 z-30 border-t border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]/95 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+10px)] pt-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.25)] backdrop-blur">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setSelectedIds(new Set())}>
              <X className="size-3.5" aria-hidden="true" /> 取消
            </Button>
            <span className="min-w-0 flex-1 text-center text-[12.5px] text-[var(--rp-fg-muted)]">
              已选 {selectedIds.size} 张
            </span>
            <Button variant="destructive" size="sm" className="rounded-full" onClick={handleDeleteSelected}>
              <Trash2 className="size-3.5" aria-hidden="true" /> 删除
            </Button>
          </div>
        </div>
      )}
      {/* Long-press / context-menu card actions. */}
      <DropdownMenu open={menuCard !== null} onOpenChange={(o) => !o && setMenuCard(null)}>
        <DropdownMenuTrigger asChild>
          <span className="sr-only" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {menuCard && (
            <>
              <DropdownMenuLabel>{menuCard.data.name}</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => { setIntroCard(menuCard); setMenuCard(null); }}>
                简介
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { startChat(menuCard); setMenuCard(null); }}>
                开始对话
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setEditing(menuCard); setMenuCard(null); }}>
                <Pencil className="size-3.5" aria-hidden="true" /> 编辑角色卡
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  void updateCard(menuCard.id, { favorite: !menuCard.favorite });
                  setMenuCard(null);
                }}
              >
                <Star className="size-3.5" aria-hidden="true" /> {menuCard.favorite ? '取消置顶' : '置顶（收藏）'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { void exportCard(menuCard, 'png'); setMenuCard(null); }}>
                <Download className="size-3.5" aria-hidden="true" /> 导出 PNG
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { void exportCard(menuCard, 'json'); setMenuCard(null); }}>
                <Download className="size-3.5" aria-hidden="true" /> 导出 JSON
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { void exportCard(menuCard, 'charx'); setMenuCard(null); }}>
                <FileArchive className="size-3.5" aria-hidden="true" /> 导出 CharX
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { setExportingCard(menuCard); setMenuCard(null); }}>
                <Download className="size-3.5" aria-hidden="true" /> 选择性导出…
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={async () => {
                  if (!(await confirmAction({ title: '确认操作', description: `删除角色卡「${menuCard.data.name}」？相关对话不会被删除。` }))) return;
                  void removeCard(menuCard.id);
                  setMenuCard(null);
                }}
              >
                <Trash2 className="size-3.5" aria-hidden="true" /> 删除
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Drop overlay */}
      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-[var(--rp-bg)]/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-[var(--rp-accent)] px-8 py-10 text-center">
            <Upload className="mx-auto mb-2 size-8 text-[var(--rp-accent)]" aria-hidden="true" />
            <p className="text-sm font-semibold">松开即可导入</p>
            <p className="mt-1 text-[12px] text-[var(--rp-fg-muted)]">PNG · JSON · YAML · CharX · BYAF</p>
          </div>
        </div>
      )}

      {(editing || creating) && (
        <CardEditor
          card={editing}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
        />
      )}

      <CardIntroPanel
        card={introCard}
        onClose={() => setIntroCard(null)}
        onStartChat={(card) => {
          setIntroCard(null);
          vibrate('tap');
          startChat(card);
        }}
        onEdit={(card) => {
          setIntroCard(null);
        setEditing(card);
      }} />

      <CardAIGenerateDialog
        open={aiOpen}
        onOpenChange={setAiOpen}
        onCreated={(id) => {
          const card = useApp.getState().cards.find((c) => c.id === id);
          if (card) setEditing(card);
        }}
      />

      {importResult && !importing && (
        <ImportDialog
          result={importResult}
          onClose={() => setImportResult(null)}
          cards={cards.map((c) => ({ id: c.id, name: c.data.name }))}
          onAttachRegex={(scripts, cardId) => {
            void attachRegexScripts(scripts, cardId);
          }}
        />
      )}

      {exportingCard && (
        <ExportSelectionModal
          open
          onOpenChange={(v) => !v && setExportingCard(null)}
          title={`选择性导出「${exportingCard.data.name}」`}
          description="只导出勾选的世界书条目与正则脚本，其余内容不随卡片出去。"
          groups={[
            {
              id: 'lorebook',
              label: '世界书条目',
              items: (exportingCard.data.character_book?.entries ?? []).map((e, i) => ({
                id: loreItemId(i),
                label: (e as { comment?: string }).comment || (e as { content?: string }).content?.slice(0, 30) || `条目 ${i + 1}`,
                hint: ((e as { keys?: string[] }).keys ?? []).slice(0, 2).join('、'),
              })),
            },
            {
              id: 'regex',
              label: '正则脚本',
              items: ((exportingCard.data.extensions?.regex_scripts as RPRegexScript[] | undefined) ?? []).map((s) => ({
                id: regexItemId(s),
                label: s.scriptName,
                hint: s.findRegex.slice(0, 24),
              })),
            },
          ]}
          onExport={(selected) => exportCardSelective(exportingCard, selected)}
        />
      )}

      <PublishWizard kind="card" subjectId={publishingId ?? ''} open={!!publishingId} onClose={() => setPublishingId(null)} />
    </div>
  );
}

export { cn };
