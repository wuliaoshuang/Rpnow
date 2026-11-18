/**
 * Memory settings form.
 *
 * Exposes the four memory behaviours and their knobs. The layout mirrors the
 * mental model: a master switch, a mode, then the models each mode needs.
 */

import * as React from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { useApp } from '@/state/store.js';
import type { MemoryRecord, MemorySettings } from '@/core/memory/types.js';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Slider, Switch } from '@/components/ui/input';
import { Badge, Hint } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast.js';
import { useLLM } from '@/hooks/useKernel.js';
import { MemoryService } from '@/features/memory/service.js';
import { confirmAction } from '@/components/ui/confirm.js';

const MODE_OPTIONS = [
  { value: 'off', label: '关闭' },
  { value: 'classic', label: '基础（总结替换旧正文）' },
  { value: 'enhanced', label: '增强（基础 + 向量召回）' },
] as const;

export function MemorySettingsPanel() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const connections = useApp((s) => s.llmConnections);
  const memories = useApp((s) => s.memories);
  const llm = useLLM();
  const [busy, setBusy] = React.useState(false);
  const [progress, setProgress] = React.useState<{ phase: 'summary' | 'embedding'; done: number; total: number } | null>(null);

  const memory = settings.memory;
  const patch = (p: Partial<MemorySettings>) => setSettings({ memory: { ...memory, ...p } });

  const chat = useApp((s) => s.chats.find((c) => c.id === s.activeChatId) ?? null);
  const card = useApp((s) => {
    const active = s.chats.find((c) => c.id === s.activeChatId);
    return active ? s.cards.find((c) => c.id === active.cardId) ?? null : null;
  });
  const personaName = useApp((s) => s.personas.find((p) => p.id === chat?.personaId)?.name) ?? '用户';
  const saveMemories = useApp((s) => s.saveMemories);

  const service = React.useMemo(
    () =>
      new MemoryService({
        llm: llm!,
        connections,
        settings: memory,
        load: (chatId) => useApp.getState().memories[chatId] ?? [],
        save: (chatId, records) => saveMemories(chatId, records),
      }),
    [llm, connections, memory, saveMemories],
  );

  const totalMemories = Object.values(memories).reduce((sum, list) => sum + list.length, 0);
  const chatMemories = chat ? (memories[chat.id] ?? []) : [];

  /** 压缩率：原始输入字数 ÷ 总结字数，越高说明压缩得越狠。 */
  const compressionOf = (record: MemoryRecord): number | null => {
    const source = (record.sourceUserText ?? '').length;
    const summary = record.summary.length;
    if (!source || !summary) return null;
    return Math.round((source / summary) * 10) / 10;
  };

  const regenerateOne = async (record: MemoryRecord) => {
    if (!chat || !card) return;
    setBusy(true);
    try {
      const updated = await service.regenerateRecord({
        chat,
        card,
        personaName,
        record,
        fallbackConnectionId: settings.defaultConnectionId,
      });
      if (updated) toast.success('已重新生成总结', `M${record.no}`);
      else toast.error('找不到这一轮的原文', '可能消息已被删除');
    } catch (err) {
      toast.error('重生成失败', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <ToggleRow
        id="memory-enabled"
        label="启用记忆系统"
        hint="用总结模型把旧回合压缩成长期记忆。开启后每轮回复会自动生成一条总结。"
        checked={memory.mode !== 'off'}
        onChange={(v) => patch({ mode: v ? 'classic' : 'off' })}
      />

      {memory.mode !== 'off' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="memory-mode">记忆模式</Label>
            <Select value={memory.mode} onValueChange={(v) => patch({ mode: v as MemorySettings['mode'] })}>
              <SelectTrigger id="memory-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.filter((o) => o.value !== 'off').map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="memory-summary-conn">总结模型服务</Label>
              <Select
                value={memory.summaryConnectionId ?? ''}
                onValueChange={(v) => patch({ summaryConnectionId: v || undefined })}
              >
                <SelectTrigger id="memory-summary-conn">
                  <SelectValue placeholder="使用当前对话服务" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">使用当前对话服务</SelectItem>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="memory-summary-model">总结模型</Label>
              <Input
                id="memory-summary-model"
                value={memory.summaryModel}
                onChange={(e) => patch({ summaryModel: e.target.value })}
                placeholder="留空则用该连接的默认模型"
              />
            </div>
          </div>

          {memory.mode === 'enhanced' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="memory-vector-conn">向量模型服务</Label>
                <Select
                  value={memory.vectorConnectionId ?? ''}
                  onValueChange={(v) => patch({ vectorConnectionId: v || undefined })}
                >
                  <SelectTrigger id="memory-vector-conn">
                    <SelectValue placeholder="选择服务" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">选择服务</SelectItem>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="memory-vector-model">向量模型</Label>
                <Input
                  id="memory-vector-model"
                  value={memory.vectorModel}
                  onChange={(e) => patch({ vectorModel: e.target.value })}
                  placeholder="如 text-embedding-3-small"
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <Label>保留最近楼层</Label>
              <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                {memory.keepRecentRounds} 楼
              </span>
            </div>
            <Slider
              value={[memory.keepRecentRounds]}
              min={10}
              max={50}
              step={2}
              onValueChange={([v]) => patch({ keepRecentRounds: v })}
              aria-label="保留最近楼层"
            />
            <p className="text-[11px] text-[var(--rp-fg-subtle)]">
              超出这个范围的旧回复会被总结替换；楼层数按消息计，一轮通常两层。
            </p>
          </div>

          <div className="space-y-3 rounded-lg border border-[var(--rp-border)] p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <Label htmlFor="secondary-mode" className="cursor-pointer">
                  二次压缩
                </Label>
                <p className="mt-0.5 text-[11px] leading-snug text-[var(--rp-fg-muted)]">
                  最近 {memory.secondaryKeepRounds} 轮保留逐轮总结，更早的按每 {memory.secondaryGroupSize} 轮合并成一条。
                </p>
              </div>
              <Switch
                id="secondary-mode"
                checked={memory.secondaryMode === 'on'}
                onCheckedChange={(v) => patch({ secondaryMode: v ? 'on' : 'off' })}
              />
            </div>
            {memory.secondaryMode === 'on' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px]">保留轮数</Label>
                    <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                      {memory.secondaryKeepRounds}
                    </span>
                  </div>
                  <Slider
                    value={[memory.secondaryKeepRounds]}
                    min={5}
                    max={50}
                    step={1}
                    onValueChange={([v]) => patch({ secondaryKeepRounds: v })}
                    aria-label="保留轮数"
                  />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label className="text-[12px]">每组轮数</Label>
                    <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                      {memory.secondaryGroupSize}
                    </span>
                  </div>
                  <Slider
                    value={[memory.secondaryGroupSize]}
                    min={2}
                    max={10}
                    step={1}
                    onValueChange={([v]) => patch({ secondaryGroupSize: v })}
                    aria-label="每组轮数"
                  />
                </div>
              </div>
            )}
          </div>

          {memory.mode === 'enhanced' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px]">召回相似度阈值</Label>
                  <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">
                    {Math.round(memory.recallThreshold * 100)}%
                  </span>
                </div>
                <Slider
                  value={[memory.recallThreshold]}
                  min={0.2}
                  max={0.9}
                  step={0.01}
                  onValueChange={([v]) => patch({ recallThreshold: v })}
                  aria-label="召回相似度阈值"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <Label className="text-[12px]">最多召回条数</Label>
                  <span className="text-[12px] tabular-nums text-[var(--rp-fg-muted)]">{memory.recallMax}</span>
                </div>
                <Slider
                  value={[memory.recallMax]}
                  min={1}
                  max={20}
                  step={1}
                  onValueChange={([v]) => patch({ recallMax: v })}
                  aria-label="最多召回条数"
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-4">
            <label className="flex cursor-pointer items-center gap-2 text-[12px]">
              <Switch
                checked={memory.recallEnabled}
                onCheckedChange={(v) => patch({ recallEnabled: v })}
              />
              启用向量召回
            </label>
            <label className="flex cursor-pointer items-center gap-2 text-[12px]">
              <Switch
                checked={memory.citationEnabled}
                onCheckedChange={(v) => patch({ citationEnabled: v })}
              />
              回复中标注记忆编号 <code className="rounded bg-[var(--rp-bg-sunken)] px-1">[M12]</code>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--rp-border)] pt-3">
            <Badge variant="outline">{totalMemories} 条记忆</Badge>
            {chat && chatMemories.length > 0 && (
              <Hint label="删除当前对话的全部总结与向量">
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-[var(--rp-danger)]"
                  onClick={async () => {
                    if (!(await confirmAction({ title: '确认操作', description: `清空当前对话的 ${chatMemories.length} 条记忆？` }))) return;
                    void saveMemories(chat.id, []);
                    toast.success('已清空记忆');
                  }}
                >
                  清空记忆
                </Button>
              </Hint>
            )}
            <Hint label="为还没有总结的回合补写总结与向量">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !llm || !chat}
                onClick={async () => {
                  if (!chat) {
                    toast.error('请先打开一个对话', '补录针对当前对话的历史回合');
                    return;
                  }
                  setBusy(true);
                  setProgress(null);
                  try {
                    const result = await service.backfill(
                      {
                        chat,
                        card: card as NonNullable<typeof card>,
                        personaName,
                        fallbackConnectionId: settings.defaultConnectionId,
                      },
                      (phase, done, total) => setProgress({ phase, done, total }),
                    );
                    toast.success(
                      '补录完成',
                      [
                        result.summaries ? `总结 ${result.summaries} 条` : '',
                        result.embeddings ? `向量 ${result.embeddings} 条` : '',
                      ]
                        .filter(Boolean)
                        .join(' · ') || '没有需要补录的内容',
                    );
                  } catch (err) {
                    toast.error('补录失败', err instanceof Error ? err.message : String(err));
                  } finally {
                    setBusy(false);
                    setProgress(null);
                  }
                }}
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" aria-hidden="true" />}
                补录缺失记忆
              </Button>
            </Hint>
            {progress && (
              <p className="text-[11px] tabular-nums text-[var(--rp-fg-subtle)]">
                {progress.phase === 'summary' ? '补写总结' : '补写向量'} {progress.done}/{progress.total}
              </p>
            )}
          </div>

          {/* -------------------------------------------- memory records */}
          {chat && chatMemories.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[12.5px] font-semibold">当前对话的记忆</p>
              <ul className="space-y-1.5">
                {chatMemories
                  .slice()
                  .sort((a, b) => a.turn - b.turn)
                  .map((record) => {
                    const ratio = compressionOf(record);
                    return (
                      <li key={record.no} className="rounded-lg border border-[var(--rp-border)] p-2">
                        <div className="flex items-center gap-2">
                          <span className="shrink-0 rounded-full border border-[var(--rp-accent)] bg-[var(--rp-accent-soft)] px-1.5 py-px text-[10.5px] text-[var(--rp-accent)]">
                            M{record.no}
                          </span>
                          <span className="text-[11px] text-[var(--rp-fg-subtle)]">第 {record.turn} 轮</span>
                          {record.secondaryCompressed && (
                            <Badge variant="outline" className="text-[10px]">
                              二次压缩 {record.turnStart}–{record.turnEnd}
                            </Badge>
                          )}
                          {ratio && (
                            <span
                              className="text-[10.5px] tabular-nums text-[var(--rp-fg-subtle)]"
                              title="原始输入 ÷ 总结字数"
                            >
                              压缩 {ratio.toFixed(1)}×
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => void regenerateOne(record)}
                            disabled={busy}
                            className="ml-auto cursor-pointer text-[10.5px] text-[var(--rp-fg-subtle)] hover:text-[var(--rp-accent)] disabled:opacity-50"
                          >
                            重新生成
                          </button>
                        </div>
                        <p className="mt-1 line-clamp-3 text-[11.5px] leading-relaxed text-[var(--rp-fg-muted)]">
                          {record.summary}
                        </p>
                      </li>
                    );
                  })}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-[var(--rp-border)] p-3">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="cursor-pointer">
          {label}
        </Label>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--rp-fg-muted)]">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
