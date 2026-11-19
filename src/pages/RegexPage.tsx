/**
 * Regex management page (A09, RP-Hub parity).
 *
 * RP-Hub has a standalone "正则" view; Rpnow only had the three-field inline
 * editor inside the card editor (name / findRegex / replaceString) with
 * flags/placement/minDepth/maxDepth hard-coded. This page gathers every card's
 * `extensions.regex_scripts` in one place and edits the full script shape:
 * flags, placement, markdownOnly/promptOnly, runOnEdit, trimStrings,
 * substituteRegex, minDepth/maxDepth, enabled — plus drag reorder and
 * JSON import/export of the selected scripts.
 */

import { useMemo, useRef, useState } from 'react';
import { Braces, Download, GripVertical, Plus, Trash2, Upload } from 'lucide-react';
import { useApp } from '@/state/store.js';
import type { RPCard, RPRegexScript } from '@/core/types/card.js';
import { REGEX_PLACEMENT } from '@/core/types/card.js';
import { regexScriptsExportDoc } from '@/core/export/selective.js';
import { ExportSelectionModal } from '@/components/export/ExportSelectionModal.js';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Switch, Textarea } from '@/components/ui/input.js';
import { Badge, EmptyState } from '@/components/ui/misc.js';
import { toast } from '@/components/ui/toast.js';
import { cn, downloadBlob, safeFilename, uid } from '@/lib/utils.js';
import { confirmAction } from '@/components/ui/confirm.js';

const PLACEMENT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: REGEX_PLACEMENT.USER_INPUT, label: '用户输入' },
  { value: REGEX_PLACEMENT.AI_OUTPUT, label: 'AI 输出' },
  { value: REGEX_PLACEMENT.SLASH_COMMAND, label: '斜杠命令' },
  { value: REGEX_PLACEMENT.WORLD_INFO, label: '世界书' },
  { value: REGEX_PLACEMENT.REASONING, label: '推理' },
];

const FLAG_OPTIONS: Array<{ flag: string; label: string }> = [
  { flag: 'g', label: 'g 全局' },
  { flag: 'i', label: 'i 忽略大小写' },
  { flag: 'm', label: 'm 多行' },
  { flag: 's', label: 's 点号通配换行' },
  { flag: 'u', label: 'u Unicode' },
];

function getScripts(card: RPCard): RPRegexScript[] {
  return ((card.data.extensions?.regex_scripts as RPRegexScript[] | undefined) ?? []).map((s) => ({
    ...s,
    placement: s.placement ?? [REGEX_PLACEMENT.AI_OUTPUT],
  }));
}

/** Split `/pattern/flags` into parts; returns null for a bare pattern. */
function splitRegex(findRegex: string): { pattern: string; flags: string } | null {
  const m = /^\/(.*)\/([a-z]*)$/s.exec(findRegex.trim());
  return m ? { pattern: m[1], flags: m[2] } : null;
}

/** Is the script's findRegex compilable? */
function regexError(findRegex: string): string | null {
  const split = splitRegex(findRegex);
  try {
    // eslint-disable-next-line no-new
    new RegExp(split ? split.pattern : findRegex, split ? split.flags : undefined);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function newScript(): RPRegexScript {
  return {
    id: uid('rx'),
    scriptName: '新脚本',
    findRegex: '//g',
    replaceString: '',
    placement: [REGEX_PLACEMENT.AI_OUTPUT],
    disabled: false,
    markdownOnly: true,
    promptOnly: false,
    runOnEdit: true,
    substituteRegex: 0,
    trimStrings: [],
    minDepth: null,
    maxDepth: null,
  };
}

export function RegexPage() {
  const cards = useApp((s) => s.cards);
  const updateCard = useApp((s) => s.updateCard);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<RPRegexScript[] | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const withScripts = useMemo(() => cards.filter((c) => getScripts(c).length > 0), [cards]);
  const selected = cards.find((c) => c.id === selectedId) ?? withScripts[0] ?? cards[0];
  const working = draft ?? (selected ? getScripts(selected) : []);

  function startEdit(card: RPCard) {
    setSelectedId(card.id);
    setDraft(getScripts(card));
  }

  async function save() {
    if (!selected || !draft) return;
    const scripts = draft;
    await updateCard(selected.id, (c) => ({
      ...c,
      data: {
        ...c.data,
        extensions: { ...c.data.extensions, regex_scripts: scripts },
      },
    }));
    setDraft(null);
    toast.success(`已保存「${selected.data.name}」的 ${scripts.length} 条正则`);
  }

  function patchScript(i: number, patch: Partial<RPRegexScript>) {
    if (!draft) return;
    const next = [...draft];
    next[i] = { ...next[i], ...patch };
    setDraft(next);
  }

  function togglePlacement(i: number, placement: number) {
    if (!draft) return;
    const cur = draft[i].placement ?? [];
    const next = cur.includes(placement) ? cur.filter((p) => p !== placement) : [...cur, placement];
    patchScript(i, { placement: next });
  }

  function toggleFlag(i: number, flag: string) {
    if (!draft) return;
    const split = splitRegex(draft[i].findRegex);
    if (!split) return;
    const flags = split.flags.includes(flag)
      ? split.flags.replace(flag, '')
      : [...split.flags, flag].sort().join('');
    patchScript(i, { findRegex: `/${split.pattern}/${flags}` });
  }

  function moveScript(fromId: string, beforeId: string | null) {
    if (!draft) return;
    const idx = draft.findIndex((s) => s.id === fromId);
    if (idx === -1) return;
    const next = [...draft];
    const [moved] = next.splice(idx, 1);
    if (beforeId === null) {
      next.push(moved);
    } else {
      const to = next.findIndex((s) => s.id === beforeId);
      next.splice(to < 0 ? next.length : to, 0, moved);
    }
    setDraft(next);
  }

  async function importScripts(files: FileList) {
    if (!selected) return;
    for (const file of Array.from(files)) {
      try {
        const doc = JSON.parse(await file.text()) as unknown;
        const arr = Array.isArray(doc)
          ? doc
          : (doc as { scripts?: unknown[] }).scripts;
        if (!Array.isArray(arr)) throw new Error('文件里没有正则脚本数组');
        const incoming = arr.filter(
          (s): s is Record<string, unknown> =>
            typeof s === 'object' && s !== null && typeof (s as { findRegex?: unknown }).findRegex === 'string',
        );
        if (!incoming.length) throw new Error('没有可导入的脚本（需要 findRegex 字段）');
        const base = draft ?? getScripts(selected);
        const next = [
          ...base,
          ...incoming.map((s) => {
            const script = newScript();
            script.scriptName = String(s.scriptName ?? s.name ?? '导入的脚本');
            script.findRegex = String(s.findRegex);
            if (typeof s.replaceString === 'string') script.replaceString = s.replaceString;
            if (Array.isArray(s.placement)) script.placement = (s.placement as unknown[]).filter((p): p is number => typeof p === 'number');
            if (typeof s.disabled === 'boolean') script.disabled = s.disabled;
            if (typeof s.markdownOnly === 'boolean') script.markdownOnly = s.markdownOnly;
            if (typeof s.promptOnly === 'boolean') script.promptOnly = s.promptOnly;
            if (typeof s.runOnEdit === 'boolean') script.runOnEdit = s.runOnEdit;
            if (typeof s.substituteRegex === 'number') script.substituteRegex = s.substituteRegex;
            if (Array.isArray(s.trimStrings)) script.trimStrings = s.trimStrings.filter((t): t is string => typeof t === 'string');
            if (typeof s.minDepth === 'number') script.minDepth = s.minDepth;
            if (typeof s.maxDepth === 'number') script.maxDepth = s.maxDepth;
            return script;
          }),
        ];
        setSelectedId(selected.id);
        setDraft(next);
        toast.success(`已导入 ${incoming.length} 条正则到「${selected.data.name}」`, '点保存后生效');
      } catch (err) {
        toast.error(`导入失败：${file.name}`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (!cards.length) {
    return <EmptyState icon={<Braces className="size-6" aria-hidden="true" />} title="还没有角色卡" description="正则脚本挂在角色卡上，先创建或导入一张角色卡。" />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* Card list */}
      <div className="rp-scroll flex max-h-56 shrink-0 flex-col overflow-y-auto border-b border-[var(--rp-border)] lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-1 px-2 py-2">
          <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--rp-fg-subtle)]">
            角色卡
          </span>
          <div className="ml-auto flex">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".json"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void importScripts(e.target.files);
                e.target.value = '';
              }}
            />
            <Button variant="ghost" size="icon-sm" onClick={() => fileInput.current?.click()} aria-label="导入正则 JSON" title="导入正则 JSON（导入到当前卡）">
              <Upload className="size-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setExportOpen(true)} aria-label="选择性导出正则" title="选择性导出">
              <Download className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <ul className="space-y-0.5 px-1.5 pb-3">
          {cards.map((c) => {
            const count = getScripts(c).length;
            const active = c.id === selected?.id;
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => startEdit(c)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                    active
                      ? 'bg-[var(--rp-accent-soft)] text-[var(--rp-fg)]'
                      : 'text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-elevated)]',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{c.data.name}</span>
                    <span className="block truncate text-[10.5px] text-[var(--rp-fg-subtle)]">
                      {count ? `${count} 条正则` : '没有正则脚本'}
                    </span>
                  </span>
                  {draft && active && <Badge variant="accent">编辑中</Badge>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Detail */}
      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-5">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 flex-1 truncate text-[15px] font-semibold">
              {selected?.data.name ?? '正则管理'}
            </h2>
            {draft ? (
              <>
                <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                  放弃
                </Button>
                <Button size="sm" onClick={save}>
                  保存
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => selected && startEdit(selected)}>
                编辑
              </Button>
            )}
            {draft && (
              <Button size="sm" variant="outline" onClick={() => setDraft([...draft, newScript()])}>
                <Plus className="size-3.5" aria-hidden="true" /> 添加脚本
              </Button>
            )}
          </div>

          <p className="rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/50 p-2.5 text-[11.5px] leading-relaxed text-[var(--rp-fg-muted)]">
            正则脚本挂在角色卡上：把模型输出里的自定义标签替换成 HTML，是实现状态栏、气泡对话等效果的标准做法。
            flags、placement、深度范围都在这里改；改完点保存写回角色卡。
          </p>

          {working.length === 0 ? (
            <EmptyState
              icon={<Braces className="size-6" aria-hidden="true" />}
              title="这张卡还没有正则脚本"
              description="点「编辑」再添加脚本，或从右上角导入 JSON。"
            />
          ) : (
            <ol
              className="space-y-2"
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (!dragId) return;
                moveScript(dragId, null);
                setDragId(null);
                setDropId(null);
              }}
            >
              {working.map((s, i) => {
                const split = splitRegex(s.findRegex);
                const err = regexError(s.findRegex);
                const readOnly = !draft;
                return (
                  <li
                    key={s.id ?? i}
                    className={cn(
                      'rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3',
                      dragId === s.id && 'opacity-50',
                      dropId === s.id && 'border-[var(--rp-accent)]',
                    )}
                    onDragOver={(e) => {
                      if (!draft || !dragId || dragId === s.id) return;
                      e.preventDefault();
                      setDropId(s.id);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!draft || !dragId || dragId === s.id) return;
                      moveScript(dragId, s.id);
                      setDragId(null);
                      setDropId(null);
                    }}
                  >
                    <div className="flex items-center gap-2">
                      {draft && (
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', s.id);
                            setDragId(s.id);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setDropId(null);
                          }}
                          className="flex shrink-0 cursor-grab touch-none items-center text-[var(--rp-fg-subtle)] active:cursor-grabbing"
                          title="拖动排序"
                          aria-label={`拖动排序脚本 ${s.scriptName}`}
                        >
                          <GripVertical className="size-4" aria-hidden="true" />
                        </span>
                      )}
                      <Input
                        value={s.scriptName}
                        readOnly={readOnly}
                        onChange={(e) => patchScript(i, { scriptName: e.target.value })}
                        className="h-8 flex-1 font-medium"
                        placeholder="脚本名称"
                        aria-label="脚本名称"
                      />
                      <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[11px]">
                        <Switch
                          checked={!s.disabled}
                          disabled={readOnly}
                          onCheckedChange={(v) => patchScript(i, { disabled: !v })}
                          aria-label={`启用脚本 ${s.scriptName}`}
                        />
                        启用
                      </label>
                      {draft && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="size-8 text-[var(--rp-danger)]"
                          aria-label="删除脚本"
                          onClick={async () => {
                            if (!(await confirmAction({ title: '确认操作', description: `删除脚本「${s.scriptName}」？` }))) return;
                            setDraft(draft.filter((_, j) => j !== i));
                          }}
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </div>

                    <div className="mt-2 space-y-1.5">
                      <Label className="text-[11px]">匹配正则</Label>
                      <Input
                        value={s.findRegex}
                        readOnly={readOnly}
                        onChange={(e) => patchScript(i, { findRegex: e.target.value })}
                        className="h-8 font-mono text-[12px]"
                        placeholder="/<status>(.*?)<\/status>/g"
                        aria-label="匹配正则"
                      />
                      {err && <p className="text-[11px] text-[var(--rp-danger)]">正则无效：{err}</p>}
                    </div>

                    {/* flags: only meaningful in /pattern/flags form. */}
                    <div className="mt-2 space-y-1.5">
                      <Label className="text-[11px]">flags</Label>
                      {split ? (
                        <div className="flex flex-wrap gap-1.5">
                          {FLAG_OPTIONS.map(({ flag, label }) => (
                            <button
                              key={flag}
                              type="button"
                              disabled={readOnly}
                              onClick={() => toggleFlag(i, flag)}
                              aria-pressed={split.flags.includes(flag)}
                              className={cn(
                                'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                split.flags.includes(flag)
                                  ? 'border-[var(--rp-accent)] bg-[var(--rp-accent-soft)] text-[var(--rp-accent)]'
                                  : 'border-[var(--rp-border)] text-[var(--rp-fg-muted)]',
                              )}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                          先写成 <code className="rounded bg-[var(--rp-bg-sunken)] px-1">/pattern/flags</code> 形式才能点选 flags。
                        </p>
                      )}
                    </div>

                    <div className="mt-2 space-y-1.5">
                      <Label className="text-[11px]">替换为</Label>
                      <Textarea
                        value={s.replaceString}
                        readOnly={readOnly}
                        rows={2}
                        onChange={(e) => patchScript(i, { replaceString: e.target.value })}
                        className="font-mono text-[12px]"
                        placeholder={'<div class="status">$1</div>'}
                        aria-label="替换为"
                      />
                    </div>

                    <div className="mt-2 space-y-1.5">
                      <Label className="text-[11px]">作用位置（placement，可多选）</Label>
                      <div className="flex flex-wrap gap-1.5">
                        {PLACEMENT_OPTIONS.map(({ value, label }) => {
                          const on = (s.placement ?? []).includes(value);
                          return (
                            <button
                              key={value}
                              type="button"
                              disabled={readOnly}
                              onClick={() => togglePlacement(i, value)}
                              aria-pressed={on}
                              className={cn(
                                'cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                                on
                                  ? 'border-[var(--rp-accent)] bg-[var(--rp-accent-soft)] text-[var(--rp-accent)]'
                                  : 'border-[var(--rp-border)] text-[var(--rp-fg-muted)]',
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]" htmlFor={`min-${s.id}`}>最小深度 minDepth（留空不限）</Label>
                        <Input
                          id={`min-${s.id}`}
                          type="number"
                          min={0}
                          value={s.minDepth ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            patchScript(i, { minDepth: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })
                          }
                          placeholder="不限"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]" htmlFor={`max-${s.id}`}>最大深度 maxDepth（留空不限）</Label>
                        <Input
                          id={`max-${s.id}`}
                          type="number"
                          min={0}
                          value={s.maxDepth ?? ''}
                          disabled={readOnly}
                          onChange={(e) =>
                            patchScript(i, { maxDepth: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })
                          }
                          placeholder="不限"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]" htmlFor={`sub-${s.id}`}>substituteRegex（宏替换时机）</Label>
                        <Select
                          value={String(s.substituteRegex ?? 0)}
                          disabled={readOnly}
                          onValueChange={(v) => patchScript(i, { substituteRegex: Number(v) })}
                        >
                          <SelectTrigger id={`sub-${s.id}`} aria-label="substituteRegex">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="0">0 不替换宏</SelectItem>
                            <SelectItem value="1">1 替换前</SelectItem>
                            <SelectItem value="2">2 替换后</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]" htmlFor={`trim-${s.id}`}>trimStrings（逗号分隔，去掉首尾）</Label>
                        <Input
                          id={`trim-${s.id}`}
                          value={(s.trimStrings ?? []).join(', ')}
                          disabled={readOnly}
                          onChange={(e) =>
                            patchScript(i, {
                              trimStrings: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
                            })
                          }
                          placeholder="例如：<br>, 空格"
                        />
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-4 rounded-md border border-[var(--rp-border)] p-2.5">
                      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <Switch
                          checked={s.markdownOnly}
                          disabled={readOnly}
                          onCheckedChange={(v) => patchScript(i, { markdownOnly: v, promptOnly: v ? false : s.promptOnly })}
                          aria-label="仅 Markdown 渲染"
                        />
                        仅 Markdown 渲染
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <Switch
                          checked={s.promptOnly}
                          disabled={readOnly}
                          onCheckedChange={(v) => patchScript(i, { promptOnly: v, markdownOnly: v ? false : s.markdownOnly })}
                          aria-label="仅提示词"
                        />
                        仅提示词
                      </label>
                      <label className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <Switch
                          checked={s.runOnEdit ?? false}
                          disabled={readOnly}
                          onCheckedChange={(v) => patchScript(i, { runOnEdit: v })}
                          aria-label="编辑消息时也执行"
                        />
                        编辑消息时也执行
                      </label>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </div>

      <ExportSelectionModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="选择性导出正则"
        description="只导出勾选的正则脚本（RP-Hub 的 toRegexExportEntry 格式）。"
        groups={cards
          .filter((c) => getScripts(c).length > 0)
          .map((c) => ({
            id: c.id,
            label: c.data.name,
            items: getScripts(c).map((s) => ({
              id: `${c.id}::${s.id}`,
              label: s.scriptName,
              hint: (s.placement ?? []).map((p) => PLACEMENT_OPTIONS.find((o) => o.value === p)?.label ?? p).join('/') || '未设位置',
            })),
          }))}
        onExport={(selected) => {
          const picked: RPRegexScript[] = [];
          for (const c of cards) {
            const ids = new Set(selected[c.id] ?? []);
            for (const s of getScripts(c)) {
              if (ids.has(`${c.id}::${s.id}`)) picked.push(s);
            }
          }
          downloadBlob(
            new Blob([JSON.stringify(regexScriptsExportDoc(picked), null, 2)], { type: 'application/json' }),
            safeFilename('正则精选', 'json'),
          );
          toast.success(`已导出 ${picked.length} 条正则`);
        }}
      />
    </div>
  );
}
