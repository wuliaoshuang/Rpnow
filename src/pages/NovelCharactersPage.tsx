/**
 * Novel characters (route `novel-characters`).
 *
 * One job: the cast. Each character is a card with a name (required),
 * a role, and a description. A nameless character shows a red hint.
 */

import { BookOpenText, Plus, Trash2 } from 'lucide-react';
import { useNovelBook, NovelTabBar, NovelBookIdentity } from './novel/shared.js';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { confirmAction } from '@/components/ui/confirm.js';
import type { Route } from '@/components/layout/AppShell.js';

export function NovelCharactersPage({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
  const { book, updateBook } = useNovelBook();

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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mx-auto max-w-2xl space-y-3">
          <NovelBookIdentity book={book} />
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] font-semibold">
              角色 <span className="font-normal text-[var(--rp-fg-subtle)]">· {book.characters.length} 位</span>
            </p>
            <Button
              size="sm"
              variant="outline"
              className="rounded-full"
              aria-label="新建小说角色"
              onClick={() =>
                updateBook((b) => ({
                  ...b,
                  characters: [...b.characters, { id: String(Date.now()), name: '', role: '', desc: '' }],
                }))
              }
            >
              <Plus className="size-3.5" aria-hidden="true" /> 新建角色
            </Button>
          </div>
          {book.characters.length === 0 && (
            <p className="py-8 text-center text-[12px] text-[var(--rp-fg-muted)]">暂无角色，请添加</p>
          )}
          {book.characters.map((c, i) => {
            const nameMissing = !c.name.trim();
            return (
              <div key={c.id} className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
                <div className="flex items-start gap-2.5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--rp-accent-soft)] text-[14px] font-semibold text-[var(--rp-accent)]">
                    {(c.name || '?').slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="space-y-1.5">
                      <Label htmlFor={`nv-char-name-${c.id}`} required>
                        角色名
                      </Label>
                      <Input
                        id={`nv-char-name-${c.id}`}
                        value={c.name}
                        placeholder="角色名"
                        onChange={(e) =>
                          updateBook((b) => ({
                            ...b,
                            characters: b.characters.map((x, xi) => (xi === i ? { ...x, name: e.target.value } : x)),
                          }))
                        }
                      />
                      {nameMissing && <p className="text-[11px] text-[var(--rp-danger)]">角色名是必填的。</p>}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`nv-char-role-${c.id}`}>身份</Label>
                      <Input
                        id={`nv-char-role-${c.id}`}
                        value={c.role ?? ''}
                        placeholder="如主角 / 反派 / 师父"
                        onChange={(e) =>
                          updateBook((b) => ({
                            ...b,
                            characters: b.characters.map((x, xi) => (xi === i ? { ...x, role: e.target.value } : x)),
                          }))
                        }
                      />
                    </div>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="rounded-full text-[var(--rp-danger)]"
                    aria-label="删除角色"
                    onClick={async () => {
                      if (await confirmAction({ title: '确认操作', description: '确定要删除这个角色吗？此操作无法撤销。' })) {
                        updateBook((b) => ({ ...b, characters: b.characters.filter((_, xi) => xi !== i) }));
                      }
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>
                <div className="mt-2.5 space-y-1.5">
                  <Label htmlFor={`nv-char-desc-${c.id}`}>描述</Label>
                  <Textarea
                    id={`nv-char-desc-${c.id}`}
                    rows={2}
                    value={c.desc}
                    placeholder="性格、外貌、背景..."
                    onChange={(e) =>
                      updateBook((b) => ({
                        ...b,
                        characters: b.characters.map((x, xi) => (xi === i ? { ...x, desc: e.target.value } : x)),
                      }))
                    }
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <NovelTabBar route={route} onNavigate={onNavigate} />
    </div>
  );
}
