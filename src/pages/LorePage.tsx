/**
 * World book library.
 *
 * Lists standalone books and lets the user create, import, edit and delete them.
 * Card-embedded books are edited inside the card editor; this page explains that
 * relationship so users do not look for them here.
 */

import { useRef, useState } from 'react';
import { BookMarked, Download, Plus, Upload, Trash2, Info } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { emptyLorebook, type RPLorebook } from '@/core/types/lorebook.js';
import { parseLorebookFile } from '@/core/card/parser.js';
import { LorebookEditor } from '@/components/lore/LorebookEditor.js';
import { Button } from '@/components/ui/button';
import { Badge, EmptyState } from '@/components/ui/misc.js';
import { Input } from '@/components/ui/input.js';
import { toast } from '@/components/ui/toast.js';
import { SLOT, SlotOutlet } from '@/core/plugin/slots.js';
import { downloadBlob, formatRelativeTime, safeFilename } from '@/lib/utils.js';
import { confirmAction } from '@/components/ui/confirm.js';

export function LorePage() {
  const lorebooks = useApp((s) => s.lorebooks);
  const saveLorebook = useApp((s) => s.saveLorebook);
  const removeLorebook = useApp((s) => s.removeLorebook);
  const [editing, setEditing] = useState<RPLorebook | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function importBook(files: FileList) {
    for (const file of Array.from(files)) {
      try {
        const doc = JSON.parse(await file.text()) as unknown;
        const book = parseLorebookFile(doc);
        await saveLorebook(book);
        toast.success(`已导入世界书「${book.name}」`, `${book.entries.length} 个条目`);
      } catch (err) {
        toast.error(`导入失败：${file.name}`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (editing) {
    return (
      <div className="rp-scroll h-full overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <div className="mb-3 flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
              ← 返回列表
            </Button>
            <h2 className="text-sm font-semibold">{editing.name}</h2>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto text-[var(--rp-danger)]"
              onClick={async () => {
                if (!(await confirmAction({ title: '确认操作', description: `删除世界书「${editing.name}」？` }))) return;
                void removeLorebook(editing.id);
                setEditing(null);
              }}
            >
              <Trash2 className="size-3.5" aria-hidden="true" /> 删除
            </Button>
          </div>
          <LorebookEditor
            lorebook={editing}
            onSave={(next) => {
              setEditing(next);
              void saveLorebook(next);
            }}
            onDelete={() => {
              void removeLorebook(editing.id);
              setEditing(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--rp-border)] px-3 py-2.5 sm:px-5">
        <p className="min-w-0 flex-1 truncate text-[12px] text-[var(--rp-fg-muted)]">
          <Info className="mr-1 inline size-3.5" aria-hidden="true" />
          角色卡自带的「内嵌世界书」在角色卡编辑器里编辑；这里管理可跨角色复用的独立世界书。
        </p>
        <SlotOutlet slot={SLOT.LORE_ENTRY} componentProps={{ books: lorebooks }} />
        <input
          ref={fileInput}
          type="file"
          multiple
          accept=".json,.yaml,.yml"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void importBook(e.target.files);
            e.target.value = '';
          }}
        />
        <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          <Upload className="size-3.5" aria-hidden="true" /> 导入
        </Button>
        <Button
          size="sm"
          onClick={() => {
            const book = emptyLorebook('新世界书');
            void saveLorebook(book);
            setEditing(book);
          }}
        >
          <Plus className="size-3.5" aria-hidden="true" /> 新建
        </Button>
      </div>

      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        {lorebooks.length === 0 ? (
          <EmptyState
            icon={<BookMarked className="size-6" aria-hidden="true" />}
            title="还没有世界书"
            description="世界书里的条目会在聊天中出现关键词时自动加入提示词，让角色「记得」更多设定。"
            action={
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                导入世界书 JSON
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {lorebooks.map((book) => (
              <li key={book.id}>
                <button
                  type="button"
                  onClick={() => setEditing(book)}
                  className="group flex w-full cursor-pointer flex-col gap-1.5 rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3 text-left transition-shadow hover:shadow-rp"
                >
                  <div className="flex items-center gap-2">
                    <BookMarked className="size-4 shrink-0 text-[var(--rp-accent)]" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{book.name}</span>
                    <Badge variant="outline">{book.entries.length} 条</Badge>
                  </div>
                  <p className="truncate text-[11.5px] text-[var(--rp-fg-muted)]">
                    {book.description || '没有描述'}
                  </p>
                  <div className="flex items-center gap-2 text-[10.5px] text-[var(--rp-fg-subtle)]">
                    <span>
                      常驻 {book.entries.filter((e) => e.constant).length} · 关键词{' '}
                      {book.entries.filter((e) => !e.constant).length}
                    </span>
                    <span className="ml-auto">{formatRelativeTime(book.updatedAt)}</span>
                  </div>
                </button>
                <div className="mt-1 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={() => {
                      const doc = {
                        name: book.name,
                        entries: book.entries.map((e) => ({
                          keys: e.keys,
                          secondary_keys: e.secondaryKeys,
                          comment: e.comment,
                          content: e.content,
                          constant: e.constant,
                          insertion_order: e.order,
                          enabled: e.enabled,
                          position: 'before_char',
                          extensions: {
                            position: e.position,
                            depth: e.depth,
                            role: e.role,
                            probability: e.probability,
                            group: e.group,
                          },
                        })),
                      };
                      downloadBlob(
                        new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }),
                        safeFilename(book.name, 'json'),
                      );
                    }}
                  >
                    <Download className="size-3" aria-hidden="true" /> 导出
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <input type="hidden" aria-hidden="true" />
    </div>
  );
}

export { Input };
