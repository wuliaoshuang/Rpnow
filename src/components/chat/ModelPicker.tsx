/**
 * Model picker modal (R04).
 *
 * RP-Hub's `ModelSelectorModal`: search + family tags with counts
 * （全部/claude/gemini/deepseek/llama/glm/moonshot/grok/其他） + three slot
 * drafts that can be switched inside the modal. Two targets:
 *
 *   - `'chat'`  — pick the current chat's model; a tap applies it at once.
 *   - `'slots'` — edit the three global slot drafts (quality/balanced/fast);
 *     tapping a model fills the active slot's draft, and 保存槽位 commits
 *     all three. The caller then also applies the active slot's draft as
 *     the chat model, mirroring RP-Hub's `selectQuickModels`.
 *
 * The list is seeded from the connection provider's known models plus the
 * current/slot models, then replaced by the live `/models` list when the
 * provider answers; a failed fetch keeps the seeds and says so. A free-text
 * model id is always allowed, because ids rotate faster than any seed list.
 */

import * as React from 'react';
import { Check, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LLMConnection, LLMService } from '@/core/llm/types.js';
import {
  MODEL_SLOTS,
  filterModels,
  modelTags,
  seedModels,
  type ModelTag,
} from '@/core/llm/modelSlots.js';

export type ModelPickerTarget = 'chat' | 'slots';

export interface ModelPickerProps {
  open: boolean;
  onClose: () => void;
  target: ModelPickerTarget;
  /** Current chat connection; without one only the seed list is shown. */
  connection?: LLMConnection;
  currentModel: string;
  slotModels: [string, string, string];
  llm: LLMService | null;
  /** `'chat'` mode: apply this model to the chat at once. */
  onSelectModel: (modelId: string) => void;
  /** `'slots'` mode: commit the three drafts; `activeSlot` is 0/1/2. */
  onSaveSlots: (models: [string, string, string], activeSlot: number) => void;
}

export function ModelPicker({
  open,
  onClose,
  target,
  connection,
  currentModel,
  slotModels,
  llm,
  onSelectModel,
  onSaveSlots,
}: ModelPickerProps) {
  const [query, setQuery] = React.useState('');
  const [tag, setTag] = React.useState<ModelTag['name']>('all');
  const [activeSlot, setActiveSlot] = React.useState(0);
  const [drafts, setDrafts] = React.useState<[string, string, string]>(slotModels);
  const [customModel, setCustomModel] = React.useState('');
  const [models, setModels] = React.useState<string[]>(() =>
    seedModels(connection, [currentModel, ...slotModels]),
  );
  const [fetchFailed, setFetchFailed] = React.useState(false);

  // Fresh state per opening; the live list replaces the seeds when it lands.
  React.useEffect(() => {
    if (!open) return;
    setQuery('');
    setTag('all');
    setActiveSlot(0);
    setDrafts(slotModels);
    setCustomModel('');
    setFetchFailed(false);
    const seeds = seedModels(connection, [currentModel, ...slotModels]);
    setModels(seeds);
    let cancelled = false;
    if (llm && connection) {
      void llm
        .listModels(connection.id)
        .then((live) => {
          if (cancelled || !live.length) return;
          const merged = [...live];
          for (const s of seeds) if (!merged.includes(s)) merged.push(s);
          setModels(merged);
        })
        .catch(() => {
          if (!cancelled) setFetchFailed(true);
        });
    }
    return () => {
      cancelled = true;
    };
    // Re-seed only when the modal opens, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const tags = modelTags(models);
  const filtered = filterModels(models, query, tag);
  const selected = target === 'slots' ? drafts[activeSlot] : currentModel;

  const choose = (modelId: string) => {
    const id = modelId.trim();
    if (!id) return;
    if (target === 'chat') {
      onSelectModel(id);
      onClose();
      return;
    }
    // Slot draft: tapping the same model again clears the slot.
    setDrafts((d) => {
      const next: [string, string, string] = [...d];
      next[activeSlot] = d[activeSlot] === id ? '' : id;
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={target === 'slots' ? '编辑模型槽位' : '选择模型'}
    >
      <button type="button" aria-label="关闭模型选择" onClick={onClose} className="absolute inset-0 cursor-default" />
      <div className="relative flex max-h-[calc(100dvh-3rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] shadow-rp">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--rp-border)] px-4 py-3">
          <h3 className="min-w-0 truncate text-[15px] font-semibold">
            {target === 'slots' ? '聊天主模型槽位' : '选择模型'}
          </h3>
          <button
            type="button"
            aria-label="关闭模型选择"
            onClick={onClose}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)]"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        {target === 'slots' && (
          <div className="grid shrink-0 grid-cols-3 gap-2 px-4 pt-3" role="group" aria-label="模型槽位草稿">
            {MODEL_SLOTS.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => setActiveSlot(slot.index)}
                aria-pressed={activeSlot === slot.index}
                className={cn(
                  'min-w-0 cursor-pointer rounded-xl border p-2.5 text-left transition-colors',
                  activeSlot === slot.index
                    ? 'border-[var(--rp-accent)] bg-[var(--rp-accent)]/10 text-[var(--rp-accent)]'
                    : 'border-[var(--rp-border)] text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)]',
                )}
              >
                <span className="mb-1 flex items-center justify-between text-[12px] font-semibold">
                  槽位 {slot.index + 1} · {slot.label}
                  {activeSlot === slot.index && <span className="size-1.5 rounded-full bg-[var(--rp-accent)]" aria-hidden="true" />}
                </span>
                <span className="block truncate font-mono text-[11px]" title={drafts[slot.index]}>
                  {drafts[slot.index] || '未选择'}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex shrink-0 flex-col gap-3 px-4 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-5 -translate-y-1/2 text-[var(--rp-fg-subtle)]" aria-hidden="true" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="text"
              aria-label="搜索模型"
              autoComplete="off"
              spellCheck={false}
              placeholder="搜索模型名称…"
              className="h-11 w-full min-w-0 rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] py-2 pl-11 pr-11 text-[15px] text-[var(--rp-fg)] outline-none placeholder:text-[var(--rp-fg-subtle)] focus:border-[var(--rp-accent)] sm:text-sm"
            />
            {query && (
              <button
                type="button"
                aria-label="清空搜索"
                onClick={() => setQuery('')}
                className="absolute right-0 top-0 flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl text-[var(--rp-fg-muted)] hover:text-[var(--rp-fg)]"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="rp-no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-1" role="group" aria-label="模型分类">
            {tags.map((t) => (
              <button
                key={t.name}
                type="button"
                onClick={() => setTag(t.name)}
                aria-pressed={tag === t.name}
                className={cn(
                  'flex h-7 shrink-0 cursor-pointer items-center whitespace-nowrap rounded-lg border px-2.5 text-[11px] font-medium transition-colors',
                  tag === t.name
                    ? 'border-[var(--rp-accent)] bg-[var(--rp-accent)]/10 text-[var(--rp-accent)]'
                    : 'border-[var(--rp-border)] text-[var(--rp-fg-muted)] hover:bg-[var(--rp-bg-sunken)]',
                )}
              >
                <span>{t.name === 'all' ? '全部' : t.name === 'other' ? '其他' : t.name.toUpperCase()}</span>
                <span className="ml-1.5 text-[10px] tabular-nums">{t.count}</span>
              </button>
            ))}
          </div>
          {fetchFailed && (
            <p className="text-[11.5px] text-[var(--rp-fg-muted)]">拉取模型列表失败，显示内置模型；也可直接输入模型名。</p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--rp-bg-sunken)]/40 p-3 sm:p-4">
          {filtered.length === 0 ? (
            <p className="flex min-h-full flex-col items-center justify-center gap-3 py-8 text-sm text-[var(--rp-fg-muted)]">
              未找到可选模型
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="group" aria-label="可选模型">
              {filtered.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => choose(id)}
                  aria-label={id}
                  aria-pressed={selected === id}
                  title={id}
                  className={cn(
                    'flex min-h-[56px] min-w-0 cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors',
                    selected === id
                      ? 'border-[var(--rp-accent)] bg-[var(--rp-accent)]/10 text-[var(--rp-fg)]'
                      : 'border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] text-[var(--rp-fg)] hover:border-[var(--rp-accent)]/50',
                  )}
                >
                  <span className="min-w-0 flex-1 text-sm font-semibold leading-5 [overflow-wrap:anywhere]">{id}</span>
                  <Check
                    className={cn('size-5 shrink-0 text-[var(--rp-accent)]', selected === id ? 'visible' : 'invisible')}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col gap-2 border-t border-[var(--rp-border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <input
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  choose(customModel);
                  setCustomModel('');
                }
              }}
              type="text"
              aria-label="自定义模型名"
              autoComplete="off"
              spellCheck={false}
              placeholder="不在列表里？直接输入模型名"
              className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--rp-border)] bg-transparent px-3 text-[13px] text-[var(--rp-fg)] outline-none placeholder:text-[var(--rp-fg-subtle)] focus:border-[var(--rp-accent)]"
            />
            <button
              type="button"
              onClick={() => {
                choose(customModel);
                setCustomModel('');
              }}
              disabled={!customModel.trim()}
              className="h-10 shrink-0 cursor-pointer rounded-xl bg-[var(--rp-accent)] px-3.5 text-[13px] font-medium text-[var(--rp-accent-fg)] disabled:opacity-40"
            >
              {target === 'slots' ? '填入槽位' : '使用该模型'}
            </button>
          </div>
          {target === 'slots' && (
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11.5px] text-[var(--rp-fg-muted)]">保存后，当前槽位的模型会成为本聊天的模型。</p>
              <button
                type="button"
                onClick={() => {
                  onSaveSlots(drafts, activeSlot);
                  onClose();
                }}
                className="h-10 shrink-0 cursor-pointer rounded-xl bg-[var(--rp-accent)] px-4 text-[13px] font-medium text-[var(--rp-accent-fg)]"
              >
                保存槽位
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
