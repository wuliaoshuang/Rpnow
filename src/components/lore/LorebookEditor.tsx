/**
 * Lorebook editor.
 *
 * Used in two modes:
 *   - `embedded` : editing the `character_book` inside a card (no save button,
 *     changes flow up to the card editor),
 *   - standalone : editing a world book from the library.
 *
 * The position control is the one thing this editor must get right: it writes
 * the numeric `extensions.position` (the value that actually decides insertion),
 * and labels every option in plain language because "↑AT/@D4" is meaningless to
 * most users.
 */

import * as React from 'react';
import { ChevronDown, ChevronRight, Plus, Search, Trash2, Info } from 'lucide-react';
import { cn, uid } from '@/lib/utils';
import {
  newEntry as makeEntry,
  type RPLorebook,
  type RPLorebookEntry,
} from '@/core/types/lorebook.js';
import { WI_LOGIC_LABELS, WI_POSITION, WI_POSITION_LABELS } from '@/core/types/card.js';
import { fromCardEntry, toCardEntry, type RPCharacterBook } from '@/core/types/lorebookCardAdapter.js';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Switch, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider } from '@/components/ui/input';
import { Badge, Hint } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast.js';
import { confirmAction } from '@/components/ui/confirm.js';

export interface LorebookEditorProps {
  /** Embedded card book or a standalone book. */
  book?: RPCharacterBook;
  /** Standalone mode. */
  lorebook?: RPLorebook;
  embedded?: boolean;
  onChange?: (book: RPCharacterBook) => void;
  onSave?: (book: RPLorebook) => void;
  onDelete?: () => void;
}

/** Convert a card book into editable entries once. */
function bookToEntries(book?: RPCharacterBook): RPLorebookEntry[] {
  return (book?.entries ?? []).map((e, i) => fromCardEntry(e, i));
}

export function LorebookEditor({ book, lorebook, embedded, onChange, onSave, onDelete }: LorebookEditorProps) {
  const [entries, setEntries] = React.useState<RPLorebookEntry[]>(() =>
    bookToEntries(embedded ? book : lorebook ? { name: lorebook.name, description: lorebook.description, entries: lorebook.entries.map((e, i) => toCardEntry(e, i)) } : undefined),
  );
  const [name, setName] = React.useState(book?.name ?? lorebook?.name ?? '');
  const [query, setQuery] = React.useState('');
  const [openId, setOpenId] = React.useState<string | null>(null);

  // Propagate upward on every change (embedded mode is a controlled sub-form).
  const emit = React.useCallback(
    (next: RPLorebookEntry[], bookName = name) => {
      setEntries(next);
      if (embedded) {
        onChange?.({
          name: bookName,
          description: book?.description ?? '',
          // ST's V2 validator requires `extensions` to exist even when empty.
          extensions: book?.extensions ?? {},
          entries: next.map((e, i) => toCardEntry(e, i)),
        });
      } else if (lorebook) {
        onSave?.({
          ...lorebook,
          name: bookName,
          entries: next,
          updatedAt: Date.now(),
        });
      }
    },
    [embedded, book, lorebook, name, onChange, onSave],
  );

  const updateEntry = (id: string, patch: Partial<RPLorebookEntry>) => {
    emit(entries.map((e) => (e.id === id ? { ...e, ...patch } : e)));
  };

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        e.comment.toLowerCase().includes(q) ||
        e.keys.some((k) => k.toLowerCase().includes(q)) ||
        e.content.toLowerCase().includes(q),
    );
  }, [entries, query]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1.5">
          <Label htmlFor="book-name">世界书名称</Label>
          <Input
            id="book-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              emit(entries, e.target.value);
            }}
            placeholder="例如：灰烬之城"
          />
        </div>
        <div className="relative w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索条目…"
            aria-label="搜索世界书条目"
            className="pl-8"
          />
        </div>
        <Button size="sm" onClick={() => emit([...entries, makeEntry({ displayIndex: entries.length, comment: '新条目' })])}>
          <Plus className="size-3.5" aria-hidden="true" /> 添加条目
        </Button>
        {!embedded && onDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="text-[var(--rp-danger)]"
            onClick={async () => {
              if (await confirmAction({ title: '确认操作', description: `删除世界书「${name}」？` })) onDelete();
            }}
          >
            <Trash2 className="size-3.5" aria-hidden="true" /> 删除
          </Button>
        )}
      </div>

      <div className="rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/50 p-2.5 text-[11.5px] leading-relaxed text-[var(--rp-fg-muted)]">
        <Info className="mr-1 inline size-3.5" aria-hidden="true" />
        条目会在最近 N 条聊天记录里出现关键词时被插入提示词。「常驻」条目每次都插入。位置决定它插在哪一段。
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[var(--rp-border)] p-8 text-center">
          <p className="text-[13px] font-medium">{entries.length ? '没有匹配的条目' : '还没有条目'}</p>
          <p className="mt-1 text-[12px] text-[var(--rp-fg-muted)]">
            {entries.length ? '换个关键词。' : '添加一个条目，让角色在聊到某个话题时获取额外设定。'}
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {filtered.map((entry) => {
            const open = openId === entry.id;
            return (
              <li key={entry.id} className="overflow-hidden rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]">
                <div className="flex items-center gap-2 px-2.5 py-2">
                  <button
                    type="button"
                    onClick={() => setOpenId(open ? null : entry.id)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
                    aria-expanded={open}
                  >
                    {open ? (
                      <ChevronDown className="size-4 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-medium">{entry.comment || '(无标题)'}</span>
                      <span className="block truncate text-[11px] text-[var(--rp-fg-subtle)]">
                        {entry.constant ? '常驻' : entry.keys.length ? entry.keys.join(' / ') : '无关键词'}
                        {entry.position === WI_POSITION.atDepth ? ` · @${entry.depth}` : ` · ${WI_POSITION_LABELS[entry.position]}`}
                      </span>
                    </span>
                  </button>
                  {!entry.enabled && <Badge variant="outline">已停用</Badge>}
                  <Switch
                    checked={entry.enabled}
                    onCheckedChange={(v) => updateEntry(entry.id, { enabled: v })}
                    aria-label={`启用条目 ${entry.comment}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7 text-[var(--rp-fg-subtle)] hover:text-[var(--rp-danger)]"
                    aria-label="删除条目"
                    onClick={() => emit(entries.filter((e) => e.id !== entry.id))}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                </div>

                {open && (
                  <div className="space-y-3 border-t border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/30 p-3 rp-anim-in">
                    <div className="space-y-1.5">
                      <Label htmlFor={`c-${entry.id}`}>标题（仅给自己看）</Label>
                      <Input
                        id={`c-${entry.id}`}
                        value={entry.comment}
                        onChange={(e) => updateEntry(entry.id, { comment: e.target.value })}
                        placeholder="例如：银鹭酒馆"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`k-${entry.id}`}>关键词（英文逗号分隔，命中任一即激活）</Label>
                      <Input
                        id={`k-${entry.id}`}
                        value={entry.keys.join(', ')}
                        onChange={(e) =>
                          updateEntry(entry.id, {
                            keys: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                          })
                        }
                        placeholder="银鹭, tavern, 酒馆"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`sec-${entry.id}`}>次要关键词（可选，用于组合条件）</Label>
                      <div className="flex gap-2">
                        <Input
                          id={`sec-${entry.id}`}
                          value={entry.secondaryKeys.join(', ')}
                          onChange={(e) =>
                            updateEntry(entry.id, {
                              secondaryKeys: e.target.value.split(',').map((s) => s.trim()).filter(Boolean),
                            })
                          }
                          placeholder="夜晚"
                        />
                        <Select
                          value={String(entry.selectiveLogic)}
                          onValueChange={(v) => updateEntry(entry.id, { selectiveLogic: Number(v), selective: true })}
                        >
                          <SelectTrigger className="w-40" aria-label="次要关键词逻辑">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(WI_LOGIC_LABELS).map(([k, label]) => (
                              <SelectItem key={k} value={k}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor={`ct-${entry.id}`}>内容</Label>
                      <Textarea
                        id={`ct-${entry.id}`}
                        value={entry.content}
                        rows={5}
                        onChange={(e) => updateEntry(entry.id, { content: e.target.value })}
                        placeholder="被激活时插入提示词的文本。可以写设定、环境描写或规则。"
                      />
                      <p className="text-right text-[11px] tabular-nums text-[var(--rp-fg-subtle)]">
                        {entry.content.length} 字
                      </p>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`p-${entry.id}`}>插入位置</Label>
                        <Select value={String(entry.position)} onValueChange={(v) => updateEntry(entry.id, { position: Number(v) })}>
                          <SelectTrigger id={`p-${entry.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(WI_POSITION_LABELS).map(([k, label]) => (
                              <SelectItem key={k} value={k}>
                                {label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {entry.position === WI_POSITION.atDepth && (
                        <div className="space-y-1.5">
                          <Label htmlFor={`d-${entry.id}`}>插入深度（从最后一条往前数）</Label>
                          <Input
                            id={`d-${entry.id}`}
                            type="number"
                            min={0}
                            max={30}
                            value={entry.depth}
                            onChange={(e) => updateEntry(entry.id, { depth: Number(e.target.value) })}
                          />
                        </div>
                      )}
                      <div className="space-y-1.5">
                        <Label htmlFor={`o-${entry.id}`}>顺序（越小越靠前）</Label>
                        <Input
                          id={`o-${entry.id}`}
                          type="number"
                          value={entry.order}
                          onChange={(e) => updateEntry(entry.id, { order: Number(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 rounded-md border border-[var(--rp-border)] p-2.5">
                      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <Switch checked={entry.constant} onCheckedChange={(v) => updateEntry(entry.id, { constant: v })} />
                        常驻（无视关键词）
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <Switch checked={entry.useRegex} onCheckedChange={(v) => updateEntry(entry.id, { useRegex: v })} />
                        关键词按正则匹配
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <Switch
                          checked={entry.caseSensitive}
                          onCheckedChange={(v) => updateEntry(entry.id, { caseSensitive: v })}
                        />
                        区分大小写
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <Switch
                          checked={entry.excludeRecursion}
                          onCheckedChange={(v) => updateEntry(entry.id, { excludeRecursion: v })}
                        />
                        禁止被递归触发
                      </label>
                    </div>

                    <div className="space-y-1 rounded-md border border-[var(--rp-border)] p-2.5">
                      <div className="flex items-center justify-between text-[12px]">
                        <span>触发概率</span>
                        <span className="tabular-nums text-[var(--rp-fg-muted)]">{entry.probability}%</span>
                      </div>
                      <Slider
                        value={[entry.probability]}
                        min={0}
                        max={100}
                        step={5}
                        onValueChange={([v]) => updateEntry(entry.id, { probability: v, useProbability: v < 100 })}
                        aria-label="触发概率"
                      />
                    </div>

                    <details className="rounded-md border border-[var(--rp-border)] p-2.5">
                      <summary className="cursor-pointer text-[12px] font-medium">高级（粘性 / 冷却 / 延迟 / 分组）</summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        {(
                          [
                            ['sticky', '粘性：触发后保持 N 楼'],
                            ['cooldown', '冷却：触发后 N 楼内不再触发'],
                            ['delay', '延迟：至少 N 楼后才可能触发'],
                          ] as const
                        ).map(([field, label]) => (
                          <div key={field} className="space-y-1">
                            <Label htmlFor={`${field}-${entry.id}`} className="text-[11px]">
                              {label}
                            </Label>
                            <Input
                              id={`${field}-${entry.id}`}
                              type="number"
                              min={0}
                              value={entry[field]}
                              onChange={(e) => updateEntry(entry.id, { [field]: Number(e.target.value) } as Partial<RPLorebookEntry>)}
                              className="h-8"
                            />
                          </div>
                        ))}
                        <div className="space-y-1">
                          <Label htmlFor={`g-${entry.id}`} className="text-[11px]">
                            分组（同组只插入一个）
                          </Label>
                          <Input
                            id={`g-${entry.id}`}
                            value={entry.group}
                            onChange={(e) => updateEntry(entry.id, { group: e.target.value })}
                            placeholder="例如：天气"
                            className="h-8"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor={`gw-${entry.id}`} className="text-[11px]">
                            组内权重
                          </Label>
                          <Input
                            id={`gw-${entry.id}`}
                            type="number"
                            value={entry.groupWeight}
                            onChange={(e) => updateEntry(entry.id, { groupWeight: Number(e.target.value) })}
                            className="h-8"
                          />
                        </div>
                      </div>
                    </details>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {!embedded && lorebook && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-[11px] text-[var(--rp-fg-subtle)]">{entries.length} 个条目</span>
          <Hint label="所有修改在输入时自动保存">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void toast.success('已保存');
              }}
            >
              完成
            </Button>
          </Hint>
        </div>
      )}
    </div>
  );
}

export { makeEntry, uid, cn };
