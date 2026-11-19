/**
 * Presets page.
 *
 * A preset is the *skeleton* of every prompt, so this page must make the
 * concept legible: show the ordered blocks, let the user enable/disable and
 * reorder them, edit each block's default text, and tune samplers. Importing a
 * preset from the ecosystem should "just work", including its quirk of ordering
 * blocks by numeric identifier.
 */

import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Download,
  FileJson,
  GripVertical,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';
import { useApp } from '@/state/store.js';
import type { RPCompletionPreset, RPPromptEntry } from '@/core/types/preset.js';
import { BUILTIN_PRESETS } from '@/core/defaults/presets.js';
import {
  managedPresetIdentifier,
  managedPresetOrder,
  managedPresetToEntry,
  type ManagedPreset,
} from '@/core/presets/managed.js';
import { normalizePreset } from '@/features/import/cardImport.js';
import { applyCompletionRepairs } from '@/features/import/cardImport.js';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea, Slider } from '@/components/ui/input.js';
import { Badge, EmptyState } from '@/components/ui/misc.js';
import { ExportSelectionModal } from '@/components/export/ExportSelectionModal.js';
import { toast } from '@/components/ui/toast.js';
import { downloadBlob, safeFilename, uid } from '@/lib/utils.js';
import { cn } from '@/lib/utils.js';
import { confirmAction } from '@/components/ui/confirm.js';

const ORDER_ID = 100001;

/** Read the active order rows for a preset. */
function orderRows(preset: RPCompletionPreset): Array<{ identifier: string; enabled: boolean }> {
  const group =
    preset.prompt_order?.find((g) => String(g.character_id) === String(ORDER_ID)) ??
    preset.prompt_order?.[0];
  return group?.order ?? [];
}

export function PresetsPage() {
  const presets = useApp((s) => s.presets);
  const savePreset = useApp((s) => s.savePreset);
  const removePreset = useApp((s) => s.removePreset);
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);

  // Builtins are always listed; a saved preset with the same id (e.g. an
  // imported copy of a builtin) must not appear twice or React keys collide.
  const all = useMemo(() => {
    const savedIds = new Set(presets.map((p) => p.id));
    return [...BUILTIN_PRESETS.filter((b) => !savedIds.has(b.id)), ...presets];
  }, [presets]);
  const [selectedId, setSelectedId] = useState<string>(settings.defaultPresetId ?? all[0]?.id ?? '');
  const [draft, setDraft] = useState<RPCompletionPreset | null>(null);
  /** O07: selective export sheet (pick which presets leave the app). */
  const [exportOpen, setExportOpen] = useState(false);
  /** R10: HTML5 drag sort — identifier of the block being dragged, if any. */
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selected = all.find((p) => p.id === selectedId) ?? all[0];
  const isBuiltin = BUILTIN_PRESETS.some((p) => p.id === selected?.id);
  const working = draft ?? selected;

  function forkPreset(source: RPCompletionPreset): RPCompletionPreset {
    // Editing a builtin forks it, so the original stays pristine.
    const builtin = BUILTIN_PRESETS.some((p) => p.id === source.id);
    const fork: RPCompletionPreset = {
      ...structuredClone(source),
      id: builtin ? uid('preset') : source.id,
      name: builtin ? `${source.name}（副本）` : source.name,
    };
    setDraft(fork);
    setSelectedId(fork.id ?? uid('preset'));
    return fork;
  }

  function startEdit(source: RPCompletionPreset) {
    forkPreset(source);
  }

  async function save() {
    if (!draft) return;
    await savePreset(draft);
    setDraft(null);
    toast.success('预设已保存');
  }

  async function importPreset(files: FileList) {
    for (const file of Array.from(files)) {
      try {
        const doc = JSON.parse(await file.text()) as Record<string, unknown>;
        const res = normalizePreset(doc, file.name.replace(/\.[^.]+$/, ''));
        if (!res.preset) {
          toast.error(`${file.name} 不是对话补全预设`);
          continue;
        }
        await savePreset(res.preset);
        setSelectedId(res.preset.id ?? file.name);
        toast.success(`已导入预设「${res.preset.name}」`, `${res.preset.prompts.length} 个区块`);
      } catch (err) {
        toast.error(`导入失败：${file.name}`, err instanceof Error ? err.message : String(err));
      }
    }
  }

  if (!working) {
    return <EmptyState title="没有可用的预设" />;
  }

  const rows = orderRows(working);
  const byId = new Map(working.prompts.map((p) => [p.identifier, p]));

  function commitPreset(next: RPCompletionPreset) {
    setDraft(next);
  }

  function setRowEnabled(identifier: string, enabled: boolean) {
    const next = structuredClone(working!);
    const group = next.prompt_order.find((g) => String(g.character_id) === String(ORDER_ID)) ?? next.prompt_order[0];
    const row = group?.order.find((r) => r.identifier === identifier);
    if (row) row.enabled = enabled;
    commitPreset(next);
  }

  function move(identifier: string, dir: -1 | 1) {
    const next = structuredClone(working!);
    const group = next.prompt_order.find((g) => String(g.character_id) === String(ORDER_ID)) ?? next.prompt_order[0];
    if (!group) return;
    const idx = group.order.findIndex((r) => r.identifier === identifier);
    const target = idx + dir;
    if (idx === -1 || target < 0 || target >= group.order.length) return;
    [group.order[idx], group.order[target]] = [group.order[target], group.order[idx]];
    commitPreset(next);
  }

  /** R10: drag a block before another (or to the end of the order). */
  function moveBlockTo(identifier: string, beforeId: string | null) {
    const next = structuredClone(working!);
    const group = next.prompt_order.find((g) => String(g.character_id) === String(ORDER_ID)) ?? next.prompt_order[0];
    if (!group) return;
    const idx = group.order.findIndex((r) => r.identifier === identifier);
    if (idx === -1) return;
    const [moved] = group.order.splice(idx, 1);
    if (beforeId === null) {
      group.order.push(moved);
    } else {
      const to = group.order.findIndex((r) => r.identifier === beforeId);
      group.order.splice(to < 0 ? group.order.length : to, 0, moved);
    }
    commitPreset(next);
  }

  function setContent(identifier: string, content: string) {
    const next = structuredClone(working!);
    const entry = next.prompts.find((p) => p.identifier === identifier);
    if (entry) entry.content = content;
    commitPreset(next);
  }

  function addBlock() {
    const next = structuredClone(working!);
    const id = `custom_${uid('b')}`;
    const entry: RPPromptEntry = {
      identifier: id,
      name: '自定义区块',
      system_prompt: true,
      role: 'system',
      content: '',
      enabled: true,
    };
    next.prompts.push(entry);
    const group = next.prompt_order.find((g) => String(g.character_id) === String(ORDER_ID)) ?? next.prompt_order[0];
    group?.order.push({ identifier: id, enabled: true });
    commitPreset(next);
  }

  /** 在当前预设里加入/移除一个托管预设区块（F05）。没开编辑时先复制一份再改。 */
  function toggleManaged(p: ManagedPreset) {
    const base = draft ?? forkPreset(working);
    const next = structuredClone(base);
    const id = managedPresetIdentifier(p);
    const existing = next.prompts.findIndex((e) => e.identifier === id);
    const group = next.prompt_order.find((g) => String(g.character_id) === String(ORDER_ID)) ?? next.prompt_order[0];
    if (existing >= 0) {
      next.prompts.splice(existing, 1);
      for (const g of next.prompt_order) {
        const i = g.order.findIndex((r) => r.identifier === id);
        if (i >= 0) g.order.splice(i, 1);
      }
    } else {
      next.prompts.push(managedPresetToEntry(p));
      const row = { identifier: id, enabled: true };
      const jailIdx = group?.order.findIndex((r) => r.identifier === 'jailbreak') ?? -1;
      if (group && jailIdx >= 0) group.order.splice(jailIdx, 0, row);
      else group?.order.push(row);
    }
    commitPreset(next);
  }

  /** COT 预设（F06）是动态生成的占位区块：勾选后 builder 在组装提示词时
   * 按当前上下文（记忆/UI 模板/剧情面板/模型）现场生成 COT 文本。 */
  function toggleCot() {
    const base = draft ?? forkPreset(working);
    const next = structuredClone(base);
    const id = 'cotPreset';
    const existing = next.prompts.findIndex((e) => e.identifier === id);
    const group = next.prompt_order.find((g) => String(g.character_id) === String(ORDER_ID)) ?? next.prompt_order[0];
    if (existing >= 0) {
      next.prompts.splice(existing, 1);
      for (const g of next.prompt_order) {
        const i = g.order.findIndex((r) => r.identifier === id);
        if (i >= 0) g.order.splice(i, 1);
      }
    } else {
      next.prompts.push({
        identifier: id,
        name: 'COT 预设（动态生成）',
        system_prompt: true,
        role: 'system',
        marker: true,
        enabled: true,
      });
      const row = { identifier: id, enabled: true };
      const jailIdx = group?.order.findIndex((r) => r.identifier === 'jailbreak') ?? -1;
      if (group && jailIdx >= 0) group.order.splice(jailIdx, 0, row);
      else group?.order.push(row);
    }
    commitPreset(next);
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      {/* List */}
      <div className="rp-scroll flex max-h-56 shrink-0 flex-col overflow-y-auto border-b border-[var(--rp-border)] lg:max-h-none lg:w-64 lg:border-b-0 lg:border-r">
        <div className="flex items-center gap-1 px-2 py-2">
          <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--rp-fg-subtle)]">
            预设
          </span>
          <div className="ml-auto flex">
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".json"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) void importPreset(e.target.files);
                e.target.value = '';
              }}
            />
            <Button variant="ghost" size="icon-sm" onClick={() => fileInput.current?.click()} aria-label="导入预设">
              <Upload className="size-4" aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => setExportOpen(true)} aria-label="选择性导出预设" title="选择性导出">
              <Download className="size-4" aria-hidden="true" />
            </Button>
          </div>
        </div>
        <ul className="space-y-0.5 px-1.5 pb-3">
          {all.map((p) => {
            const active = p.id === working.id;
            const builtin = BUILTIN_PRESETS.some((b) => b.id === p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(null);
                    setSelectedId(p.id!);
                  }}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors',
                    active
                      ? 'bg-[var(--rp-accent-soft)] text-[var(--rp-fg)]'
                      : 'text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-elevated)]',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium">{p.name}</span>
                    <span className="block truncate text-[10.5px] text-[var(--rp-fg-subtle)]">
                      {p.prompts.length} 区块 · {p.max_context ?? 32000} ctx
                    </span>
                  </span>
                  {builtin && <Badge variant="outline">内置</Badge>}
                  {settings.defaultPresetId === p.id && <Badge variant="accent">默认</Badge>}
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
            <div className="min-w-0 flex-1">
              <Input
                value={working.name}
                onChange={(e) => commitPreset({ ...working, name: e.target.value })}
                className="h-9 max-w-xs font-semibold"
                aria-label="预设名称"
                disabled={working.id === selected?.id && !draft}
              />
            </div>
            {/*
              Built-in presets can absolutely be the default — that is the only
              way a built-in becomes "enabled" for new chats. Only editing /
              deleting needs a copy, which stays gated below.
            */}
            {settings.defaultPresetId !== working.id && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setSettings({ defaultPresetId: working.id });
                  toast.success(`已把「${working.name}」设为默认预设`);
                }}
              >
                设为默认
              </Button>
            )}
            {settings.defaultPresetId === working.id && (
              <Badge variant="accent">当前默认</Badge>
            )}
            {!draft && isBuiltin && (
              <Button size="sm" variant="outline" onClick={() => startEdit(working)}>
                <Sparkles className="size-3.5" aria-hidden="true" /> 复制并编辑
              </Button>
            )}
            {draft && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDraft(null);
                  }}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" /> 放弃
                </Button>
                <Button size="sm" onClick={save}>
                  <Save className="size-3.5" aria-hidden="true" /> 保存
                </Button>
              </>
            )}
            {!isBuiltin && !draft && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    downloadBlob(
                      new Blob([JSON.stringify(toStPreset(working), null, 2)], { type: 'application/json' }),
                      safeFilename(working.name, 'json'),
                    );
                  }}
                >
                  <Download className="size-3.5" aria-hidden="true" /> 导出
                </Button>
                <Button size="sm" variant="outline" onClick={() => startEdit(working)}>
                  编辑
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[var(--rp-danger)]"
                  onClick={async () => {
                    if (!(await confirmAction({ title: '确认操作', description: `删除预设「${working.name}」？` }))) return;
                    void removePreset(working.id!);
                    setSelectedId(all[0]?.id ?? '');
                  }}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" /> 删除
                </Button>
              </>
            )}
          </div>

          <div className="rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/50 p-2.5 text-[11.5px] leading-relaxed text-[var(--rp-fg-muted)]">
            预设决定「提示词的骨架」：区块的顺序与默认文字。角色卡提供内容，世界书负责在指定位置插入。
            拖动顺序即改变模型看到的上下文结构。
          </div>

          {/* Order + blocks */}
          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">区块顺序</h3>
              {draft && (
                <Button size="sm" variant="outline" onClick={addBlock}>
                  <Plus className="size-3.5" aria-hidden="true" /> 添加区块
                </Button>
              )}
            </div>
            <ol
              className="space-y-1.5"
              onDragOver={(e) => {
                if (!dragId) return;
                e.preventDefault();
              }}
              onDrop={(e) => {
                // Dropping on the list itself moves the block to the end.
                e.preventDefault();
                if (!dragId) return;
                moveBlockTo(dragId, null);
                setDragId(null);
                setDropId(null);
              }}
            >
              {rows.map((row, i) => {
                const entry = byId.get(row.identifier);
                if (!entry) return null;
                const marker = entry.marker === true;
                return (
                  <li
                    key={row.identifier}
                    className={cn(
                      'rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)]',
                      !row.enabled && 'opacity-60',
                      dragId === row.identifier && 'opacity-50',
                      dropId === row.identifier && 'border-[var(--rp-accent)]',
                    )}
                    onDragOver={(e) => {
                      if (!draft || !dragId || dragId === row.identifier) return;
                      e.preventDefault();
                      setDropId(row.identifier);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!draft || !dragId || dragId === row.identifier) return;
                      moveBlockTo(dragId, row.identifier);
                      setDragId(null);
                      setDropId(null);
                    }}
                  >
                    <div className="flex items-center gap-2 p-2">
                      {/* R10: drag handle — only while editing a draft. */}
                      {draft && (
                        <span
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', row.identifier);
                            setDragId(row.identifier);
                          }}
                          onDragEnd={() => {
                            setDragId(null);
                            setDropId(null);
                          }}
                          className="flex shrink-0 cursor-grab touch-none items-center text-[var(--rp-fg-subtle)] active:cursor-grabbing"
                          title="拖动排序"
                          aria-label={`拖动排序区块 ${entry.name}`}
                        >
                          <GripVertical className="size-4" aria-hidden="true" />
                        </span>
                      )}
                      <span className="w-5 text-center text-[11px] tabular-nums text-[var(--rp-fg-subtle)]">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[12.5px] font-medium">{entry.name}</p>
                        <p className="truncate text-[10.5px] text-[var(--rp-fg-subtle)]">
                          {marker ? '运行时填充' : `${(entry.content ?? '').length} 字`} · 角色 {entry.role}
                        </p>
                      </div>
                      <Badge variant={marker ? 'accent' : 'outline'}>{marker ? '占位' : '文本'}</Badge>
                      {draft && (
                        <div className="flex items-center">
                          <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => move(row.identifier, -1)} aria-label="上移">
                            <ArrowUp className="size-3.5" aria-hidden="true" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" className="size-7" onClick={() => move(row.identifier, 1)} aria-label="下移">
                            <ArrowDown className="size-3.5" aria-hidden="true" />
                          </Button>
                        </div>
                      )}
                      <label className="flex cursor-pointer items-center gap-1.5 text-[11px]">
                        <input
                          type="checkbox"
                          checked={row.enabled}
                          disabled={!draft}
                          onChange={(e) => setRowEnabled(row.identifier, e.target.checked)}
                          className="size-3.5 accent-[var(--rp-accent)]"
                        />
                        启用
                      </label>
                    </div>
                    {!marker && (
                      <div className="border-t border-[var(--rp-border)] p-2">
                        <Textarea
                          value={entry.content ?? ''}
                          readOnly={!draft}
                          rows={Math.min(6, Math.max(2, (entry.content ?? '').split('\n').length + 1))}
                          onChange={(e) => setContent(row.identifier, e.target.value)}
                          className="text-[12px]"
                          aria-label={`${entry.name} 的内容`}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Managed preset library (F05) + dynamic COT preset (F06) */}
          <section className="space-y-2">
            <h3 className="text-[13px] font-semibold">托管预设库</h3>
            <p className="text-[11.5px] leading-relaxed text-[var(--rp-fg-muted)]">
              勾选后把该预设作为一个区块加入当前预设（内置预设会自动先复制一份）。
              文风预设会按 &lt;writing_style&gt; 协议拼进聊天记录之后的下条回复指令里；
              破限预注入的 user/assistant 区块固定插在角色前导之前。
            </p>
            <ul className="space-y-1.5">
              {managedPresetOrder().map((p) => {
                const id = managedPresetIdentifier(p);
                const checked = byId.has(id);
                return (
                  <li
                    key={p.key}
                    className="flex items-start gap-2 rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-2"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleManaged(p)}
                      className="mt-0.5 size-3.5 shrink-0 accent-[var(--rp-accent)]"
                      aria-label={`启用托管预设「${p.name}」`}
                    />
                    <span className="min-w-0">
                      <span className="block text-[12.5px] font-medium">{p.name}</span>
                      <span className="block text-[11px] leading-relaxed text-[var(--rp-fg-muted)]">
                        {p.description}
                      </span>
                    </span>
                  </li>
                );
              })}
              <li className="flex items-start gap-2 rounded-lg border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-2">
                <input
                  type="checkbox"
                  checked={byId.has('cotPreset')}
                  onChange={toggleCot}
                  className="mt-0.5 size-3.5 shrink-0 accent-[var(--rp-accent)]"
                  aria-label="启用 COT 预设（动态生成）"
                />
                <span className="min-w-0">
                  <span className="block text-[12.5px] font-medium">COT 预设（动态生成）</span>
                  <span className="block text-[11px] leading-relaxed text-[var(--rp-fg-muted)]">
                    组装提示词时按当前上下文（记忆、UI 模板、剧情面板、模型）现场生成思考协议，不存写死文本。
                  </span>
                </span>
              </li>
            </ul>
          </section>

          {/* Samplers */}
          <section className="space-y-3">
            <h3 className="text-[13px] font-semibold">生成参数</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['temperature', '温度 (temperature)', 0, 2, 0.05],
                  ['top_p', 'Top P', 0, 1, 0.01],
                  ['frequency_penalty', '频率惩罚', 0, 2, 0.05],
                  ['presence_penalty', '存在惩罚', 0, 2, 0.05],
                ] as const
              ).map(([key, label, min, max, step]) => (
                <div key={key} className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px]">{label}</Label>
                    <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                      {Number(working[key] ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    value={[Number(working[key] ?? 0)]}
                    min={min}
                    max={max}
                    step={step}
                    disabled={!draft}
                    onValueChange={([v]) => commitPreset({ ...working, [key]: v })}
                    aria-label={label}
                  />
                </div>
              ))}
              <div className="space-y-1">
                <Label className="text-[12px]">最大输出 token</Label>
                <Input
                  type="number"
                  value={working.max_tokens ?? 1200}
                  disabled={!draft}
                  onChange={(e) => commitPreset({ ...working, max_tokens: Number(e.target.value) })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[12px]">上下文长度</Label>
                <Input
                  type="number"
                  value={working.max_context ?? 32000}
                  disabled={!draft}
                  onChange={(e) => commitPreset({ ...working, max_context: Number(e.target.value) })}
                />
              </div>
            </div>
          </section>

          <p className="flex items-start gap-1.5 text-[11px] text-[var(--rp-fg-subtle)]">
            <FileJson className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            支持直接导入市面上的对话补全预设 JSON（SillyTavern 格式），区块顺序、区块文本与采样参数都会保留。
          </p>
        </div>
      </div>

      <ExportSelectionModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="选择性导出预设"
        description="只导出勾选的预设（SillyTavern 格式数组）。"
        groups={[
          {
            id: 'presets',
            label: '对话补全预设',
            items: all.map((p) => ({
              id: p.id ?? p.name,
              label: p.name,
              hint: `${p.prompts.length} 区块`,
            })),
          },
        ]}
        onExport={(selected) => {
          const ids = new Set(selected.presets ?? []);
          const picked = all.filter((p) => ids.has(p.id ?? p.name));
          downloadBlob(
            new Blob([JSON.stringify(picked.map((p) => toStPreset(p)), null, 2)], { type: 'application/json' }),
            safeFilename('预设精选', 'json'),
          );
          toast.success(`已导出 ${picked.length} 个预设`);
        }}
      />
    </div>
  );
}

/** Export back to the ecosystem's preset shape so it stays portable. */
function toStPreset(preset: RPCompletionPreset): Record<string, unknown> {
  const repaired = applyCompletionRepairs(preset);
  return {
    name: preset.name,
    temperature: preset.temperature,
    frequency_penalty: preset.frequency_penalty,
    presence_penalty: preset.presence_penalty,
    top_p: preset.top_p,
    top_k: preset.top_k,
    repetition_penalty: preset.repetition_penalty,
    openai_max_context: preset.max_context,
    openai_max_tokens: preset.max_tokens,
    stream_openai: preset.stream ?? true,
    prompts: repaired.prompts,
    prompt_order: repaired.prompt_order,
  };
}

export { applyCompletionRepairs };
