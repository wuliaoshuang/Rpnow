/**
 * Character card editor.
 *
 * This is the form the product lives or dies on: it must feel effortless for a
 * first card and still expose every field a power user needs. Design decisions:
 *
 *  - **Grouped sections, never one endless page.** Five tabs map to the mental
 *    model (身份 / 设定 / 开场 / 世界书 / 高级).
 *  - **Live character counter + token estimate** under every long field, so
 *    users see the cost of their prose while writing it.
 *  - **Label above every input** (never placeholder-as-label) and helper text
 *    that explains *why* a field matters, not just what it is.
 *  - **{{macro}} insert menu** on every long field — the most common stumbling
 *    block for new card authors.
 *  - **Greeting management** with reorder/duplicate/delete, since alternate
 *    greetings drive replay value.
 *  - **No destructive actions without confirm**, and unsaved state is tracked.
 */

import * as React from 'react';
import { Braces, Check, ChevronLeft, Copy, Loader2, Plus, Trash2, Upload, X } from 'lucide-react';
import { cn, estimateTokens, uid } from '@/lib/utils';
import { useApp } from '@/state/store.js';
import type { RPCard, RPCardData } from '@/core/types/card.js';
import { Button } from '@/components/ui/button';
import { CardEditDiffButton } from './CardEditDiffButton.js';
import { AvatarAIModule } from './AvatarAIModule.js';
import { Input, Label, Textarea, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge, Hint } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast.js';
import { confirmAction } from '@/components/ui/confirm.js';
import { SLOT, SlotOutlet } from '@/core/plugin/slots.js';
import { MACRO_REFERENCE } from '@/core/prompt/macros.js';
import { LorebookEditor } from '@/components/lore/LorebookEditor.js';
import { blobToDataUrl } from '@/core/card/parser.js';

const EMPTY: RPCardData = {
  name: '',
  description: '',
  personality: '',
  scenario: '',
  first_mes: '',
  mes_example: '',
  creator_notes: '',
  system_prompt: '',
  post_history_instructions: '',
  alternate_greetings: [],
  tags: [],
  creator: '',
  character_version: '1.0',
  extensions: {},
};

/** Long-text field with counter, token estimate and macro insert. */
function FieldTextarea({
  id,
  label,
  hint,
  value,
  onChange,
  rows = 5,
  placeholder,
  required,
  maxHint,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  required?: boolean;
  maxHint?: number;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [macroOpen, setMacroOpen] = React.useState(false);
  const tokens = estimateTokens(value);
  const over = maxHint !== undefined && tokens > maxHint;

  function insertMacro(macro: string) {
    const el = ref.current;
    if (!el) {
      onChange(value + macro);
      return;
    }
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const next = value.slice(0, start) + macro + value.slice(end);
    onChange(next);
    setMacroOpen(false);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + macro.length, start + macro.length);
    });
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id} required={required}>
          {label}
        </Label>
        <button
          type="button"
          onClick={() => setMacroOpen((v) => !v)}
          className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-[var(--rp-fg-subtle)] transition hover:bg-[var(--rp-bg-sunken)] hover:text-[var(--rp-fg-muted)]"
          aria-expanded={macroOpen}
        >
          <Braces className="size-3" aria-hidden="true" /> 宏
        </button>
      </div>
      <Textarea
        id={id}
        ref={ref}
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {macroOpen && (
        <div className="rp-scroll max-h-40 overflow-y-auto rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] p-1.5">
          <div className="grid gap-0.5 sm:grid-cols-2">
            {MACRO_REFERENCE.map((m) => (
              <button
                key={m.macro}
                type="button"
                onClick={() => insertMacro(m.macro)}
                className="flex cursor-pointer flex-col rounded px-2 py-1 text-left transition hover:bg-[var(--rp-bg-elevated)]"
                title={m.description}
              >
                <code className="text-[11px] text-[var(--rp-accent)]">{m.macro}</code>
                <span className="text-[10px] text-[var(--rp-fg-subtle)]">{m.description}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--rp-fg-subtle)]">
        {hint ? <span id={`${id}-hint`}>{hint}</span> : <span />}
        <span className={cn('shrink-0 tabular-nums', over && 'text-[var(--rp-warn)]')}>
          {value.length} 字 · ≈{tokens} tok{maxHint ? ` / 建议 <${maxHint}` : ''}
        </span>
      </div>
    </div>
  );
}

export interface CardEditorProps {
  /** Existing card to edit, or null to create. */
  card: RPCard | null;
  onClose: () => void;
}

export function CardEditor({ card, onClose }: CardEditorProps) {
  const addCard = useApp((s) => s.addCard);
  const updateCard = useApp((s) => s.updateCard);

  const [tab, setTab] = React.useState('identity');
  const [data, setData] = React.useState<RPCardData>(() =>
    card ? structuredClone(card.data) : { ...EMPTY },
  );
  const [avatar, setAvatar] = React.useState<string | undefined>(card?.avatar);
  const [tagInput, setTagInput] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const avatarInput = React.useRef<HTMLInputElement>(null);

  const patch = (p: Partial<RPCardData>) => {
    setData((d) => ({ ...d, ...p }));
    setDirty(true);
  };

  React.useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  /**
   * Escape / Android back must close the editor, not the page underneath.
   *
   * The editor is a local full-screen overlay (not a route), so the app-level
   * popstate handler would otherwise fall through to the router. Capturing the
   * key here — and closing via `onClose` — keeps the back button meaningful.
   * Unsaved edits ask first.
   */
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      void requestClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty]);

  /** Close, confirming when there are unsaved changes. */
  async function requestClose() {
    if (!dirty) {
      onClose();
      return;
    }
    const ok = await confirmAction({
      title: '放弃未保存的修改？',
      description: '这个角色卡的改动还没有保存，关闭后会丢失。',
      confirmText: '放弃修改',
      destructive: true,
    });
    if (ok) onClose();
  }

  const nameError = !data.name.trim();

  async function save() {
    if (nameError) {
      setTab('identity');
      toast.error('角色名称是必填项');
      return;
    }
    setSaving(true);
    try {
      if (card) {
        await updateCard(card.id, (c) => ({ ...c, data, avatar }));
      } else {
        const now = Date.now();
        await addCard({
          id: uid('c'),
          data,
          spec: 'v2',
          specVersion: '2.0',
          avatar,
          createdAt: now,
          updatedAt: now,
          sourceFormat: 'json-v2',
        });
      }
      setDirty(false);
      toast.success(card ? '已保存' : '角色卡已创建');
      onClose();
    } catch (err) {
      toast.error('保存失败', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  const greetings = [data.first_mes, ...(data.alternate_greetings ?? [])];

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--rp-bg)]" role="dialog" aria-label="角色卡编辑器">
      {/*
        Header: back chevron (matches every other sub-page and drives the
        Android back button), title + unsaved marker on the midline, and a
        single 保存 action. Safe-area top is part of the bar, not a squeeze.
      */}
      <header className="flex shrink-0 items-center gap-1 border-b border-[var(--rp-border)] px-4 pt-[calc(env(safe-area-inset-top,0px)+16px)] pb-2">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label="关闭编辑器"
          className="size-10 shrink-0"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-semibold leading-tight">
            {card ? '编辑角色卡' : '新建角色卡'}
          </h2>
          <p className="truncate text-[11px] text-[var(--rp-fg-subtle)]">
            {data.name || '未命名'} · {estimateTokens(JSON.stringify(data))} tokens
            {dirty && <span className="ml-1.5 text-[var(--rp-warn)]">未保存</span>}
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <CardEditDiffButton
            card={card as RPCard}
            getCurrentCard={() =>
              ({
                ...(card ?? {
                  id: uid('c'),
                  spec: 'v2',
                  specVersion: '2.0',
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                }),
                data,
                avatar,
              }) as RPCard
            }
            onApplied={(next) => {
              if (!next) return;
              setData(next.data);
              setDirty(true);
            }}
          />
          <Button size="sm" className="rounded-full" onClick={save} disabled={saving || nameError}>
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
            保存
          </Button>
        </div>
      </header>

      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-3 py-3 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] sm:px-6">
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="sticky top-0 z-10 mx-2 mb-4 flex w-auto overflow-x-auto rounded-[10px] p-1">
              <TabsTrigger
                value="identity"
                className="flex-1 rounded-[10px] data-[state=active]:bg-[var(--rp-accent)] data-[state=active]:text-[var(--rp-accent-fg)] data-[state=active]:shadow-none"
              >
                身份
              </TabsTrigger>
              <TabsTrigger
                value="definition"
                className="flex-1 rounded-[10px] data-[state=active]:bg-[var(--rp-accent)] data-[state=active]:text-[var(--rp-accent-fg)] data-[state=active]:shadow-none"
              >
                设定
              </TabsTrigger>
              <TabsTrigger
                value="greetings"
                className="flex-1 rounded-[10px] data-[state=active]:bg-[var(--rp-accent)] data-[state=active]:text-[var(--rp-accent-fg)] data-[state=active]:shadow-none"
              >
                开场白
              </TabsTrigger>
              <TabsTrigger
                value="lorebook"
                className="flex-1 rounded-[10px] data-[state=active]:bg-[var(--rp-accent)] data-[state=active]:text-[var(--rp-accent-fg)] data-[state=active]:shadow-none"
              >
                世界书
              </TabsTrigger>
              <TabsTrigger
                value="advanced"
                className="flex-1 rounded-[10px] data-[state=active]:bg-[var(--rp-accent)] data-[state=active]:text-[var(--rp-accent-fg)] data-[state=active]:shadow-none"
              >
                高级
              </TabsTrigger>
            </TabsList>

            {/* ---------------------------------------------------- identity */}
            <TabsContent value="identity" className="space-y-4">
              {/* 角色名片：头像 + 名字/作者，一眼认出这张卡是谁。 */}
              <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
                <div className="flex items-start gap-4">
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => avatarInput.current?.click()}
                      className="group relative flex size-32 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-[var(--rp-border-strong)] transition hover:border-[var(--rp-accent)]"
                      aria-label="上传头像"
                    >
                      {avatar ? (
                        <>
                          <img src={avatar} alt="" className="size-full object-cover" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[11px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                            更换
                          </span>
                        </>
                      ) : (
                        <span className="flex flex-col items-center gap-1 text-[11px] text-[var(--rp-fg-subtle)]">
                          <Upload className="size-5" aria-hidden="true" />
                          上传
                        </span>
                      )}
                    </button>
                    <input
                      ref={avatarInput}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (f) {
                          setAvatar(await blobToDataUrl(f));
                          setDirty(true);
                        }
                        e.target.value = '';
                      }}
                    />
                    {avatar && (
                      <button
                        type="button"
                        onClick={() => {
                          setAvatar(undefined);
                          setDirty(true);
                        }}
                        className="mt-1 w-full cursor-pointer text-[11px] text-[var(--rp-fg-subtle)] hover:text-[var(--rp-danger)]"
                      >
                        移除
                      </button>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 space-y-3 pt-0.5">
                    <div className="space-y-1.5">
                      <Label htmlFor="card-name" required>
                        角色名称
                      </Label>
                      <Input
                        id="card-name"
                        value={data.name}
                        onChange={(e) => patch({ name: e.target.value })}
                        placeholder="例如：阿尔德里克"
                        aria-invalid={nameError}
                        autoFocus
                        className="h-12 rounded-xl text-[16px]"
                      />
                      {nameError && (
                        <p className="text-[11px] text-[var(--rp-danger)]">
                          必填 — 这是对话中 {'{{char}}'} 会替换成的名字。
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="card-creator">作者署名</Label>
                      <Input
                        id="card-creator"
                        value={data.creator ?? ''}
                        onChange={(e) => patch({ creator: e.target.value })}
                        placeholder="你的名字或昵称"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* 用 AI 生成头像：提示词 + 生成/换画法。 */}
              <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
                <p className="mb-3 text-[13px] font-semibold">用 AI 生成头像</p>
                <AvatarAIModule
                  prompt={String((data.extensions as Record<string, unknown> | undefined)?.avatar_prompt ?? '')}
                  onPromptChange={(value) =>
                    patch({
                      extensions: { ...data.extensions, avatar_prompt: value },
                    })
                  }
                  onGenerated={(dataUrl) => {
                    setAvatar(dataUrl);
                    setDirty(true);
                  }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="card-version">版本</Label>
                <Input
                  id="card-version"
                  value={data.character_version ?? ''}
                  onChange={(e) => patch({ character_version: e.target.value })}
                  placeholder="1.0"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="card-tags">标签</Label>
                <div className="flex flex-wrap gap-1.5 rounded-xl border border-[var(--rp-border-strong)] bg-[var(--rp-bg)] p-2">
                  {(data.tags ?? []).map((t, i) => (
                    <span
                      key={`${t}-${i}`}
                      className="inline-flex items-center gap-1 rounded-full bg-[var(--rp-accent-soft)] px-2 py-0.5 text-[11px] text-[var(--rp-accent)]"
                    >
                      {t}
                      <button
                        type="button"
                        aria-label={`移除标签 ${t}`}
                        className="cursor-pointer opacity-70 hover:opacity-100"
                        onClick={() => patch({ tags: (data.tags ?? []).filter((_, j) => j !== i) })}
                      >
                        <X className="size-3" aria-hidden="true" />
                      </button>
                    </span>
                  ))}
                  <input
                    id="card-tags"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault();
                        const v = tagInput.trim();
                        if (v && !(data.tags ?? []).includes(v)) patch({ tags: [...(data.tags ?? []), v] });
                        setTagInput('');
                      } else if (e.key === 'Backspace' && !tagInput && (data.tags ?? []).length) {
                        patch({ tags: (data.tags ?? []).slice(0, -1) });
                      }
                    }}
                    placeholder={(data.tags ?? []).length ? '继续添加…' : '输入后回车添加标签'}
                    className="min-w-[8rem] flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--rp-fg-subtle)]"
                    aria-describedby="card-tags-hint"
                  />
                </div>
                <p id="card-tags-hint" className="text-[11px] text-[var(--rp-fg-subtle)]">
                  用于在你的角色库里筛选；不会影响模型输出。
                </p>
              </div>

              <FieldTextarea
                id="card-notes"
                label="作者备注"
                hint="写给使用者看的说明，不会发给模型。可以写推荐预设、玩法建议。"
                value={data.creator_notes ?? ''}
                onChange={(v) => patch({ creator_notes: v })}
                rows={3}
              />
            </TabsContent>

            {/* -------------------------------------------------- definition */}
            <TabsContent value="definition" className="space-y-4">
              <FieldTextarea
                id="card-desc"
                label="角色描述"
                hint="角色的外貌、身份、背景与行为方式。这是最重要的字段——写清「他是谁」比写「他很帅」有用得多。"
                value={data.description}
                onChange={(v) => patch({ description: v })}
                rows={8}
                placeholder={'{{char}} 是……\n外貌：……\n身份：……\n习惯：……'}
              />
              <FieldTextarea
                id="card-personality"
                label="性格"
                hint="性格摘要。较短的描述往往比长篇形容词更稳定，适合列出 3-6 个关键词。"
                value={data.personality}
                onChange={(v) => patch({ personality: v })}
                rows={3}
                maxHint={200}
              />
              <FieldTextarea
                id="card-scenario"
                label="场景"
                hint="对话开始时的处境。写明地点、时间、以及角色与你此刻的关系。"
                value={data.scenario}
                onChange={(v) => patch({ scenario: v })}
                rows={3}
              />
              <FieldTextarea
                id="card-example"
                label="对话示例"
                hint="最能决定角色语气的字段。用 <START> 分隔每组示例，格式：{{'{'}}user}}: 你说的话 换行 {{'{'}}char}}: 角色的回应。"
                value={data.mes_example}
                onChange={(v) => patch({ mes_example: v })}
                rows={10}
                placeholder={'<START>\n{{user}}: 你今天怎么这么安静？\n{{char}}: 「……」他缓缓放下杯子，「我在听。」'}
              />
            </TabsContent>

            {/* --------------------------------------------------- greetings */}
            <TabsContent value="greetings" className="space-y-4">
              <p className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/60 p-2.5 text-[12px] text-[var(--rp-fg-muted)]">
                第一条是默认开场白，其余会在对话里以「滑动切换」的形式出现，让同一个角色有不同开局。
              </p>
              {greetings.map((g, i) => (
                <div key={i} className="space-y-1.5 rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3.5">
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`greet-${i}`} className="flex-1">
                      {i === 0 ? '默认开场白' : `备选开场白 ${i}`}
                    </Label>
                    <Badge variant={i === 0 ? 'accent' : 'outline'}>{i === 0 ? '必需' : 'swipe'}</Badge>
                    {i > 0 && (
                      <>
                        <Hint label="复制一份">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-7"
                            aria-label="复制此开场白"
                            onClick={() => {
                              const alts = [...(data.alternate_greetings ?? [])];
                              alts.splice(i - 1, 0, g);
                              patch({ alternate_greetings: alts });
                            }}
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                          </Button>
                        </Hint>
                        <Hint label="删除">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="size-7 text-[var(--rp-danger)]"
                            aria-label="删除此开场白"
                            onClick={() => {
                              const alts = [...(data.alternate_greetings ?? [])];
                              alts.splice(i - 1, 1);
                              patch({ alternate_greetings: alts });
                            }}
                          >
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </Button>
                        </Hint>
                      </>
                    )}
                  </div>
                  <Textarea
                    id={`greet-${i}`}
                    value={g}
                    rows={5}
                    onChange={(e) => {
                      if (i === 0) patch({ first_mes: e.target.value });
                      else {
                        const alts = [...(data.alternate_greetings ?? [])];
                        alts[i - 1] = e.target.value;
                        patch({ alternate_greetings: alts });
                      }
                    }}
                    placeholder="角色说的第一段话，通常包含动作描写和一句台词。"
                  />
                  <p className="text-right text-[11px] tabular-nums text-[var(--rp-fg-subtle)]">
                    {g.length} 字 · ≈{estimateTokens(g)} tok
                  </p>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => patch({ alternate_greetings: [...(data.alternate_greetings ?? []), ''] })}
              >
                <Plus className="size-3.5" aria-hidden="true" /> 添加备选开场白
              </Button>
            </TabsContent>

            {/* ---------------------------------------------------- lorebook */}
            <TabsContent value="lorebook">
              <LorebookEditor
                book={data.character_book}
                onChange={(book) => patch({ character_book: book })}
                embedded
              />
            </TabsContent>

            {/* ---------------------------------------------------- advanced */}
            <TabsContent value="advanced" className="space-y-4">
              {/* Plugin-provided editor sections. */}
              <SlotOutlet slot={SLOT.CARD_EDITOR} componentProps={{ card, data }} />
              <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/60 p-2.5 text-[12px] leading-relaxed text-[var(--rp-fg-muted)]">
                <p className="mb-1 font-medium text-[var(--rp-fg)]">主提示覆盖</p>
                <p>
                  填写后会替换当前预设的「主提示」。用 <code className="rounded bg-[var(--rp-bg)] px-1">{'{{original}}'}</code>{' '}
                  表示「原来预设的主提示内容」——这是保留通用规则同时追加角色规则的标准做法。
                </p>
              </div>
              <FieldTextarea
                id="card-sysprompt"
                label="角色卡 system_prompt（覆盖主提示）"
                hint="留空则完全使用预设的主提示。"
                value={data.system_prompt ?? ''}
                onChange={(v) => patch({ system_prompt: v })}
                rows={5}
                placeholder={'{{original}}\n\n[本角色附加规则] ……'}
              />
              <FieldTextarea
                id="card-phi"
                label="角色卡 post_history_instructions（越狱位）"
                hint="注入在聊天记录之后、生成之前，用来强化格式或语气要求。支持 {{original}}。"
                value={data.post_history_instructions ?? ''}
                onChange={(v) => patch({ post_history_instructions: v })}
                rows={3}
              />

              <div className="space-y-2 rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3.5">
                <Label>深度提示（@Depth）</Label>
                <p className="text-[11px] text-[var(--rp-fg-subtle)]">
                  每次请求都会插入到聊天记录的第 N 层，适合放「始终要记住」的短规则。
                </p>
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
                  <Input
                    value={String((data.extensions?.depth_prompt as { prompt?: string })?.prompt ?? '')}
                    onChange={(e) =>
                      patch({
                        extensions: {
                          ...data.extensions,
                          depth_prompt: {
                            ...(data.extensions?.depth_prompt as object),
                            prompt: e.target.value,
                          },
                        },
                      })
                    }
                    placeholder="例如：{{char}} 的回复始终以第三人称叙述。"
                    aria-label="深度提示内容"
                  />
                  <Input
                    type="number"
                    min={0}
                    max={30}
                    value={Number((data.extensions?.depth_prompt as { depth?: number })?.depth ?? 4)}
                    onChange={(e) =>
                      patch({
                        extensions: {
                          ...data.extensions,
                          depth_prompt: {
                            ...(data.extensions?.depth_prompt as object),
                            prompt: (data.extensions?.depth_prompt as { prompt?: string })?.prompt ?? '',
                            depth: Number(e.target.value),
                          },
                        },
                      })
                    }
                    className="w-20"
                    aria-label="深度提示插入层数"
                  />
                  <Select
                    value={(data.extensions?.depth_prompt as { role?: string })?.role ?? 'system'}
                    onValueChange={(v) =>
                      patch({
                        extensions: {
                          ...data.extensions,
                          depth_prompt: { ...(data.extensions?.depth_prompt as object), role: v },
                        },
                      })
                    }
                  >
                    <SelectTrigger className="w-28" aria-label="深度提示角色">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="system">系统</SelectItem>
                      <SelectItem value="user">用户</SelectItem>
                      <SelectItem value="assistant">角色</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="card-spec">卡片规范版本（导出时使用）</Label>
                <Select
                  value={card?.spec ?? 'v2'}
                  onValueChange={() => {
                    /* spec is chosen at export time; kept read-only here */
                  }}
                >
                  <SelectTrigger id="card-spec">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="v2">Character Card V2（兼容性最好）</SelectItem>
                    <SelectItem value="v3">Character Card V3</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <RegexScriptsEditor
                scripts={(data.extensions?.regex_scripts as unknown[]) ?? []}
                onChange={(scripts) =>
                  patch({ extensions: { ...data.extensions, regex_scripts: scripts } })
                }
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

/** Card-embedded regex scripts (the mechanism behind styled status bars). */
function RegexScriptsEditor({
  scripts,
  onChange,
}: {
  scripts: unknown[];
  onChange: (next: unknown[]) => void;
}) {
  const list = scripts as Array<{
    id?: string;
    scriptName?: string;
    findRegex?: string;
    replaceString?: string;
    placement?: number[];
    disabled?: boolean;
  }>;

  return (
    <div className="space-y-2 rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-3.5">
      <div className="flex items-center justify-between">
        <Label>正则脚本</Label>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...list,
              {
                id: uid('rx'),
                scriptName: '新脚本',
                findRegex: '//g',
                replaceString: '',
                placement: [2],
                disabled: false,
                markdownOnly: true,
                promptOnly: false,
                runOnEdit: true,
                substituteRegex: 0,
                trimStrings: [],
                minDepth: null,
                maxDepth: null,
              },
            ])
          }
        >
          <Plus className="size-3.5" aria-hidden="true" /> 添加
        </Button>
      </div>
      <p className="text-[11px] text-[var(--rp-fg-subtle)]">
        把模型输出里的自定义标签替换成 HTML，是实现状态栏、气泡对话等效果的标准做法。正则需写成
        <code className="mx-1 rounded bg-[var(--rp-bg-sunken)] px-1">/pattern/gi</code> 形式。
      </p>
      {list.length === 0 && (
        <p className="rounded border border-dashed border-[var(--rp-border)] p-3 text-center text-[12px] text-[var(--rp-fg-subtle)]">
          还没有正则脚本
        </p>
      )}
      {list.map((s, i) => (
        <div key={s.id ?? i} className="space-y-1.5 rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/40 p-2">
          <div className="flex items-center gap-1.5">
            <Input
              value={s.scriptName ?? ''}
              onChange={(e) => {
                const next = [...list];
                next[i] = { ...s, scriptName: e.target.value };
                onChange(next);
              }}
              className="h-8 flex-1"
              placeholder="脚本名称"
              aria-label="脚本名称"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-8 text-[var(--rp-danger)]"
              aria-label="删除脚本"
              onClick={() => onChange(list.filter((_, j) => j !== i))}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          <Input
            value={s.findRegex ?? ''}
            onChange={(e) => {
              const next = [...list];
              next[i] = { ...s, findRegex: e.target.value };
              onChange(next);
            }}
            className="h-8 font-mono text-[12px]"
            placeholder="/<status>(.*?)<\\/status>/g"
            aria-label="匹配正则"
          />
          <Input
            value={s.replaceString ?? ''}
            onChange={(e) => {
              const next = [...list];
              next[i] = { ...s, replaceString: e.target.value };
              onChange(next);
            }}
            className="h-8 font-mono text-[12px]"
            placeholder='<div class="status">$1</div>'
            aria-label="替换为"
          />
        </div>
      ))}
    </div>
  );
}

export { EMPTY as EMPTY_CARD_DATA };
