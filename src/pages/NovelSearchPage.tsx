/**
 * Novel search (route `novel-search`).
 *
 * One job: find and replace across the whole book. Regex search with
 * context snippets; tapping a match opens that chapter on the chapters page.
 */

import * as React from 'react';
import { BookOpenText, Search } from 'lucide-react';
import { useNovelBook, NovelTabBar, NovelBookIdentity } from './novel/shared.js';
import { countWords } from '@/core/novel/types.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast.js';
import { confirmAction } from '@/components/ui/confirm.js';
import { cn } from '@/lib/utils.js';
import type { Route } from '@/components/layout/AppShell.js';

export function NovelSearchPage({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  const { book, updateBook } = useNovelBook();
  const [searchQuery, setSearchQuery] = React.useState('');
  const [replaceQuery, setReplaceQuery] = React.useState('');
  const [matches, setMatches] = React.useState<Array<{ chapter: number; index: number; context: string }>>([]);
  const [currentMatch, setCurrentMatch] = React.useState(0);

  if (!book) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <BookOpenText className="size-10 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
        <p className="text-[13px] text-[var(--rp-fg-muted)]">还没有书籍，先去书架新建一本。</p>
        <Button className="rounded-full" onClick={() => onNavigate('novel')}>
          去书架
        </Button>
      </div>
    );
  }

  const performSearch = async () => {
    if (!searchQuery.trim()) {
      setMatches([]);
      return;
    }
    let re: RegExp;
    try {
      re = new RegExp(searchQuery, 'gi');
    } catch (e) {
      toast.error('正则表达式无效', e instanceof Error ? e.message : String(e));
      return;
    }
    const found: Array<{ chapter: number; index: number; context: string }> = [];
    book.chapters.forEach((chapter, ci) => {
      const text = `${chapter.title}\n${chapter.content}`;
      for (const m of text.matchAll(re)) {
        const at = m.index ?? 0;
        found.push({
          chapter: ci,
          index: found.length,
          context: `${at > 10 ? '…' : ''}${text.slice(Math.max(0, at - 10), at + (m[0]?.length ?? 0) + 10)}${at + (m[0]?.length ?? 0) + 10 < text.length ? '…' : ''}`,
        });
      }
    });
    setMatches(found);
    setCurrentMatch(0);
  };

  const replace = async (all: boolean) => {
    if (!matches.length) return;
    if (!(await confirmAction({ title: '确认操作', description: all ? `确定替换全部 ${matches.length} 处吗？` : '确定替换当前这一处吗？' }))) return;
    const targets = all ? matches : [matches[currentMatch]];
    const chapters = book.chapters.map((c) => ({ ...c, content: c.content }));
    for (const target of targets) {
      const chapter = chapters[target.chapter];
      if (!chapter) continue;
      chapter.content = chapter.content.replace(new RegExp(searchQuery, 'gi'), replaceQuery);
      chapter.wordCount = countWords(chapter.content);
    }
    updateBook((b) => ({ ...b, chapters }));
    performSearch();
  };

  const jumpToMatch = (chapterIndex: number) => {
    updateBook((b) => ({
      ...b,
      chapters: b.chapters.map((c, ci) => ({ ...c, isExpanded: ci === chapterIndex ? true : c.isExpanded })),
    }));
    onNavigate('novel-chapters');
    window.setTimeout(() => {
      document.getElementById(`novel-chapter-${chapterIndex}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mx-auto max-w-2xl space-y-3">
          <NovelBookIdentity book={book} />
          <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <Input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="查找内容（支持正则）" aria-label="查找内容" />
              <Input value={replaceQuery} onChange={(e) => setReplaceQuery(e.target.value)} placeholder="替换为" aria-label="替换为" />
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Button size="sm" className="rounded-full" onClick={performSearch}>
                <Search className="size-3.5" aria-hidden="true" /> 查找全部
              </Button>
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => replace(false)} disabled={!matches.length}>
                替换当前
              </Button>
              <Button size="sm" variant="outline" className="rounded-full" onClick={() => replace(true)} disabled={!matches.length}>
                全部替换
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={!matches.length}
                onClick={() => setCurrentMatch((i) => (i - 1 + matches.length) % matches.length)}
              >
                上一处
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-full"
                disabled={!matches.length}
                onClick={() => setCurrentMatch((i) => (i + 1) % matches.length)}
              >
                下一处
              </Button>
            </div>
            <p className="mt-2 text-[11.5px] text-[var(--rp-fg-subtle)]">
              查找是<strong>不区分大小写的正则</strong>，不是字面文本。
            </p>
          </div>
          {matches.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-[var(--rp-fg-muted)]">未找到相关内容</p>
          ) : (
            <ul className="space-y-1.5">
              {matches.map((m, i) => (
                <li
                  key={i}
                  className={cn(
                    'cursor-pointer rounded-xl border px-3 py-2 text-[12px]',
                    i === currentMatch
                      ? 'border-[var(--rp-accent)] bg-[var(--rp-accent-soft)]'
                      : 'border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]',
                  )}
                  onClick={() => {
                    setCurrentMatch(i);
                    jumpToMatch(m.chapter);
                  }}
                >
                  <span className="font-medium">第 {m.chapter + 1} 章</span>
                  <span className="ml-2 text-[var(--rp-fg-muted)]">{m.context}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <NovelTabBar route={route} onNavigate={onNavigate} />
    </div>
  );
}
