/**
 * Novel bookshelf (route `novel`).
 *
 * A real bookshelf: portrait book covers in a 3-column grid, like a library
 * shelf. Tap a cover to open the book. Long-press a cover to enter selection
 * mode (mobile pattern — no per-card delete button cluttering the grid);
 * in selection mode, tap covers to toggle, and the bottom bar deletes the
 * selected books (with confirmation) or cancels.
 *
 * Design constraints (refactoring-ui): the covers carry the hierarchy, so
 * nothing else on a card competes with them (Law 1/2); delete is a
 * destructive action, not the page's primary action, so it lives only in the
 * selection bar (Law 8).
 */

import * as React from 'react';
import { BookOpenText, Check, Plus, Search, Trash2, X } from 'lucide-react';
import { useNovelBook, BookCover } from './novel/shared.js';
import { totalWords } from '@/core/novel/types.js';
import { Button } from '@/components/ui/button';
import { Input, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/input';
import { confirmAction } from '@/components/ui/confirm.js';
import type { Route } from '@/components/layout/AppShell.js';

/** Long-press threshold for entering selection mode. */
const LONG_PRESS_MS = 500;

export function NovelBookshelfPage({ onNavigate }: { onNavigate: (r: Route) => void }) {
  const { novel, createBook, deleteBooks, openBook } = useNovelBook();
  const [bookQuery, setBookQuery] = React.useState('');
  const [bookSort, setBookSort] = React.useState<'updated' | 'words' | 'chapters'>('updated');
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(new Set());
  const selecting = selectedIds.size > 0;
  const longPressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = React.useRef(false);

  const clearLongPress = React.useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
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

  const handleDeleteSelected = React.useCallback(async () => {
    const count = selectedIds.size;
    if (count === 0) return;
    const label = count === 1 ? `《${novel.books.find((b) => selectedIds.has(b.id))?.title ?? ''}》` : `${count} 本书`;
    if (await confirmAction({ title: '确认操作', description: `确定删除${label}？此操作无法撤销。` })) {
      deleteBooks(selectedIds);
      setSelectedIds(new Set());
    }
  }, [selectedIds, novel.books, deleteBooks]);

  const visibleBooks = React.useMemo(() => {
    const q = bookQuery.trim();
    const list = novel.books.filter((b) => !q || b.title.includes(q) || (b.worldView || '').includes(q));
    const sorted = [...list];
    if (bookSort === 'words') sorted.sort((a, b) => totalWords(b) - totalWords(a));
    else if (bookSort === 'chapters') sorted.sort((a, b) => b.chapters.length - a.chapters.length);
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }, [novel.books, bookQuery, bookSort]);

  if (novel.books.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <BookOpenText className="size-10 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
        <p className="text-[13px] text-[var(--rp-fg-muted)]">还没有书籍。新建一本开始写作。</p>
        <Button
          className="rounded-full"
          onClick={() => {
            createBook();
            onNavigate('novel-settings');
          }}
        >
          <Plus className="size-3.5" aria-hidden="true" /> 新建书籍
        </Button>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-0">
      <div className="rp-scroll h-full min-h-0 overflow-y-auto p-3 pb-20 sm:p-4 sm:pb-20">
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
              <Input
                value={bookQuery}
                onChange={(e) => setBookQuery(e.target.value)}
                placeholder="搜索书名 / 世界观"
                aria-label="搜索书籍"
                className="rounded-full pl-8"
              />
            </div>
            <Select value={bookSort} onValueChange={(v) => setBookSort(v as typeof bookSort)}>
              <SelectTrigger className="w-[118px] shrink-0 rounded-full" aria-label="排序方式">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="updated">最近更新</SelectItem>
                <SelectItem value="words">字数最多</SelectItem>
                <SelectItem value="chapters">章节最多</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] font-semibold">
              书架 <span className="font-normal text-[var(--rp-fg-subtle)]">· {novel.books.length} 本</span>
            </p>
            <Button
              size="sm"
              className="rounded-full"
              onClick={() => {
                createBook();
                onNavigate('novel-settings');
              }}
            >
              <Plus className="size-3.5" aria-hidden="true" /> 新建书籍
            </Button>
          </div>
          {selecting && (
            <p className="text-[12px] text-[var(--rp-fg-muted)]">长按一本书可进入多选，点选更多书，再点下方删除。</p>
          )}
          {visibleBooks.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-[var(--rp-fg-muted)]">没有找到匹配的书。</p>
          ) : (
            <ul className="grid grid-cols-3 gap-x-3 gap-y-4">
              {visibleBooks.map((b) => {
                const bw = totalWords(b);
                const isActive = b.id === novel.activeBookId;
                const isSelected = selectedIds.has(b.id);
                return (
                  <li key={b.id} className="min-w-0">
                    <button
                      type="button"
                      className="block w-full cursor-pointer select-none text-left [-webkit-touch-callout:none]"
                      aria-label={selecting ? `选择《${b.title || '无题'}》` : `打开《${b.title || '无题'}》`}
                      aria-pressed={selecting ? isSelected : undefined}
                      onContextMenu={(e) => e.preventDefault()}
                      onPointerDown={() => {
                        longPressed.current = false;
                        clearLongPress();
                        longPressTimer.current = setTimeout(() => {
                          longPressed.current = true;
                          toggleSelect(b.id);
                        }, LONG_PRESS_MS);
                      }}
                      onPointerUp={clearLongPress}
                      onPointerLeave={clearLongPress}
                      onPointerCancel={clearLongPress}
                      onClick={() => {
                        if (longPressed.current) {
                          longPressed.current = false;
                          return;
                        }
                        if (selecting) toggleSelect(b.id);
                        else {
                          openBook(b.id);
                          onNavigate('novel-chapters');
                        }
                      }}
                    >
                      <span className="relative block">
                        <BookCover
                          title={b.title}
                          words={bw}
                          className={`relative aspect-[2/3] w-full overflow-hidden rounded-lg shadow-md transition-all ${isSelected ? 'ring-2 ring-[var(--rp-accent)] ring-offset-2 ring-offset-[var(--rp-bg)]' : ''}`}
                        />
                        {isSelected && (
                          <span className="absolute right-1.5 top-1.5 flex size-5 items-center justify-center rounded-full bg-[var(--rp-accent)] text-[var(--rp-accent-fg)] shadow">
                            <Check className="size-3" aria-hidden="true" />
                          </span>
                        )}
                        {isActive && !isSelected && (
                          <span className="absolute right-1.5 top-1.5 rounded-full bg-[var(--rp-accent)] px-1.5 py-0.5 text-[9.5px] font-semibold text-[var(--rp-accent-fg)] shadow">
                            当前
                          </span>
                        )}
                        {isSelected && <span className="absolute inset-0 rounded-lg bg-black/25" aria-hidden="true" />}
                      </span>
                      <span className="mt-1.5 block truncate text-[12px] font-medium leading-tight">{b.title || '无题'}</span>
                      <span className="mt-0.5 block text-[10.5px] text-[var(--rp-fg-subtle)]">
                        {b.chapters.length} 章 · {bw.toLocaleString()} 字
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {selecting && (
        <div className="absolute inset-x-0 bottom-0 border-t border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]/95 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+10px)] pt-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.25)] backdrop-blur">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setSelectedIds(new Set())}>
              <X className="size-3.5" aria-hidden="true" /> 取消
            </Button>
            <span className="min-w-0 flex-1 text-center text-[12.5px] text-[var(--rp-fg-muted)]">已选 {selectedIds.size} 本</span>
            <Button variant="destructive" size="sm" className="rounded-full" onClick={handleDeleteSelected}>
              <Trash2 className="size-3.5" aria-hidden="true" /> 删除
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
