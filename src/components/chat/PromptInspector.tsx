/**
 * Prompt inspector.
 *
 * The single most useful debugging surface in a roleplay app: show exactly what
 * will be sent, which preset block produced each message, which world-book
 * entries fired and why others did not, and where the token budget went.
 *
 * Built on the same functions the real request uses, so it cannot drift from
 * what is actually sent.
 */

import * as React from 'react';
import { AlertCircle, Check, Eye, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge, EmptyState } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';
import { cn, estimateTokens } from '@/lib/utils';
import { assemblePrompt, runActivation, type ChatContext } from '@/features/chat/orchestrator.js';
import type { PromptBuildResult } from '@/core/prompt/builder.js';
import type { ActivationResult } from '@/core/lorebook/engine.js';

const ROLE_LABEL: Record<string, string> = {
  system: '系统',
  user: '用户',
  assistant: '角色',
};

const SOURCE_LABEL: Record<string, string> = {
  preset: '预设文本',
  'card:system_prompt': '角色卡 system_prompt（覆盖主提示）',
  'card:post_history_instructions': '角色卡后置指令',
  'card:mes_example': '角色卡对话示例',
  'card:depth_prompt': '角色卡深度提示',
  history: '聊天记录',
  chatHistory: '聊天记录',
  persona: '我的身份',
  plugin: '插件注入',
};

export interface PromptInspectorProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  ctx: () => ChatContext;
}

/** Aggregate prompt blocks into the five buckets RP-Hub shows. */
function CompositionBar({ blocks }: { blocks: Array<{ name: string; source: string; chars: number; enabled: boolean }> }) {
  const buckets: Array<{ key: string; label: string; chars: number; color: string }> = [
    { key: 'system', label: '系统提示词', chars: 0, color: 'var(--rp-accent)' },
    { key: 'lore', label: '世界书', chars: 0, color: 'var(--rp-ok)' },
    { key: 'memory', label: '记忆', chars: 0, color: 'var(--rp-warn)' },
    { key: 'tools', label: '工具', chars: 0, color: 'var(--rp-danger)' },
    { key: 'history', label: '原文', chars: 0, color: 'var(--rp-fg-subtle)' },
  ];
  const byKey = new Map(buckets.map((b) => [b.key, b]));

  for (const block of blocks) {
    if (!block.enabled) continue;
    const source = block.source.toLowerCase();
    let key = 'history';
    if (source.startsWith('worldinfo')) key = 'lore';
    else if (source.startsWith('memory') || source.startsWith('card:depth')) key = 'memory';
    else if (source.startsWith('plugin') || source.startsWith('tool')) key = 'tools';
    else if (source.startsWith('preset') || source.startsWith('card:')) key = 'system';
    byKey.get(key)!.chars += block.chars;
  }

  const total = buckets.reduce((sum, b) => sum + b.chars, 0) || 1;
  return (
    <div className="mb-3 space-y-1.5 rounded-lg border border-[var(--rp-border)] p-2.5">
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-[var(--rp-bg-sunken)]">
        {buckets
          .filter((b) => b.chars > 0)
          .map((b) => (
            <div
              key={b.key}
              style={{ width: `${(b.chars / total) * 100}%`, background: b.color }}
              title={`${b.label} ${b.chars.toLocaleString()} 字`}
            />
          ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-[var(--rp-fg-subtle)]">
        {buckets.map((b) => (
          <span key={b.key} className="inline-flex items-center gap-1">
            <span className="size-2 rounded-full" style={{ background: b.color }} aria-hidden="true" />
            {b.label} {b.chars.toLocaleString()}
          </span>
        ))}
      </div>
    </div>
  );
}

export function PromptInspector({ open, onOpenChange, ctx }: PromptInspectorProps) {
  const [built, setBuilt] = React.useState<{ prompt: PromptBuildResult; activation: ActivationResult } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        // Build against a clone so previewing never mutates live chat variables.
        const base = ctx();
        const cloned: ChatContext = {
          ...base,
          chat: { ...base.chat, variables: { ...base.chat.variables } },
        };
        const activation = runActivation(cloned);
        const prompt = await assemblePrompt(cloned, activation);
        if (cancelled) return;
        setBuilt({ prompt, activation });
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setBuilt(null);
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, ctx]);

  const totalTokens = built ? estimateTokens(built.prompt.messages.map((m) => m.content).join('\n')) : 0;
  const activatedTrace = built?.activation.diagnostics.filter((d) => d.activated) ?? [];
  const skippedTrace = built?.activation.diagnostics.filter((d) => !d.activated) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>提示词构成</DialogTitle>
          <DialogDescription>
            这就是本次请求会发送给模型的全部内容。预设决定「顺序」，角色卡提供「内容」，世界书决定「插入什么」。
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <div className="mx-5 mb-4 rounded-md border border-[var(--rp-danger)]/40 bg-[var(--rp-danger)]/10 p-3 text-[13px] text-[var(--rp-danger)]">
            <AlertCircle className="mr-1 inline size-4" aria-hidden="true" /> 构建失败：{error}
          </div>
        ) : (
          <Tabs defaultValue="messages" className="px-5 pb-5">
            <TabsList>
              <TabsTrigger value="messages">消息({built?.prompt.messages.length ?? 0})</TabsTrigger>
              <TabsTrigger value="blocks">区块</TabsTrigger>
              <TabsTrigger value="lore">世界书({activatedTrace.length})</TabsTrigger>
              <TabsTrigger value="raw">原始</TabsTrigger>
            </TabsList>

            <TabsContent value="messages" className="max-h-[52vh] overflow-y-auto rp-scroll">
              <div className="space-y-2">
                {built?.prompt.messages.map((m, i) => (
                  <div key={i} className="rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)]/60 p-2.5">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge variant={m.role === 'system' ? 'accent' : m.role === 'user' ? 'outline' : 'ok'}>
                        {ROLE_LABEL[m.role] ?? m.role}
                      </Badge>
                      <span className="text-[11px] text-[var(--rp-fg-subtle)]">
                        {SOURCE_LABEL[m.source ?? ''] ?? m.source ?? ''}
                      </span>
                      {m.injection && <Badge variant="warn">注入</Badge>}
                      <span className="ml-auto text-[11px] tabular-nums text-[var(--rp-fg-subtle)]">
                        {estimateTokens(m.content)} tok
                      </span>
                    </div>
                    <pre className="whitespace-pre-wrap break-words font-sans text-[12px] leading-relaxed text-[var(--rp-fg-muted)]">
                      {m.content}
                    </pre>
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="blocks" className="max-h-[52vh] overflow-y-auto rp-scroll">
              <div className="mb-2 flex items-center justify-between text-[12px] text-[var(--rp-fg-muted)]">
                <span>总大小约 {totalTokens.toLocaleString()} tokens</span>
                {built && built.prompt.droppedHistory > 0 && (
                  <span className="text-[var(--rp-warn)]">
                    因长度限制丢弃了最早 {built.prompt.droppedHistory} 条消息
                  </span>
                )}
              </div>

              {/* Composition bar: where the prompt budget actually goes. */}
              {built && <CompositionBar blocks={built.prompt.blocks} />}

              <div className="space-y-1">
                {built?.prompt.blocks.map((b, i) => (
                  <div
                    key={`${b.identifier}-${i}`}
                    className={cn(
                      'flex items-center gap-2 rounded-md border border-[var(--rp-border)] px-2.5 py-1.5 text-[12px]',
                      !b.enabled && 'opacity-50',
                    )}
                  >
                    <span className="w-4 text-[var(--rp-fg-subtle)]">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{b.name}</span>
                    <span className="shrink-0 text-[11px] text-[var(--rp-fg-subtle)]">{b.source}</span>
                    <span className="w-16 shrink-0 text-right tabular-nums text-[var(--rp-fg-muted)]">
                      {b.chars} 字
                    </span>
                    {b.enabled ? (
                      <Check className="size-3.5 shrink-0 text-[var(--rp-ok)]" aria-label="已启用" />
                    ) : (
                      <X className="size-3.5 shrink-0 text-[var(--rp-fg-subtle)]" aria-label="未启用" />
                    )}
                  </div>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="lore" className="max-h-[52vh] overflow-y-auto rp-scroll">
              {activatedTrace.length === 0 && skippedTrace.length === 0 ? (
                <EmptyState icon={<Eye className="size-5" />} title="这张卡没有世界书条目" description="在角色卡里添加 character_book，或在世界书页面导入。" />
              ) : (
                <div className="space-y-3">
                  <section>
                    <h4 className="mb-1.5 text-[12px] font-semibold text-[var(--rp-ok)]">
                      已激活 {activatedTrace.length} 条
                    </h4>
                    <div className="space-y-1">
                      {activatedTrace.map((t) => (
                        <div key={t.key} className="rounded-md border border-[var(--rp-ok)]/30 bg-[var(--rp-ok)]/5 px-2.5 py-1.5">
                          <p className="text-[12px] font-medium">{t.comment || '(无标题)'}</p>
                          <p className="text-[11px] text-[var(--rp-fg-muted)]">
                            {t.bookName} · {t.reason}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                  {skippedTrace.length > 0 && (
                    <section>
                      <h4 className="mb-1.5 text-[12px] font-semibold text-[var(--rp-fg-subtle)]">
                        未激活 {skippedTrace.length} 条
                      </h4>
                      <div className="space-y-1">
                        {skippedTrace.map((t) => (
                          <div key={t.key} className="rounded-md border border-[var(--rp-border)] px-2.5 py-1.5 opacity-70">
                            <p className="text-[12px] font-medium">{t.comment || '(无标题)'}</p>
                            <p className="text-[11px] text-[var(--rp-fg-subtle)]">{t.reason}</p>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}
                </div>
              )}
            </TabsContent>

            <TabsContent value="raw">
              <div className="max-h-[52vh] overflow-auto rp-scroll">
                <pre className="whitespace-pre-wrap break-words rounded-md border border-[var(--rp-border)] bg-[var(--rp-bg-sunken)] p-3 font-mono text-[11.5px] leading-relaxed">
                  {JSON.stringify(built?.prompt.messages ?? [], null, 2)}
                </pre>
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void navigator.clipboard.writeText(JSON.stringify(built?.prompt.messages ?? [], null, 2));
                  }}
                >
                  复制 JSON
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
