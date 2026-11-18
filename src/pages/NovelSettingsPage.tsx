/**
 * Novel book settings (route `novel-settings`).
 *
 * One job: the book's setup. Title / worldview / outline / word goal /
 * content controls / models, each in its own card. Title and worldview are
 * required — they carry a red asterisk and an inline hint when empty.
 */

import * as React from 'react';
import { BookOpenText } from 'lucide-react';
import { useNovelBook, GoalBar, NovelTabBar, NovelBookIdentity } from './novel/shared.js';
import { Button } from '@/components/ui/button';
import { Input, Label, Switch, Textarea } from '@/components/ui/input';
import type { Route } from '@/components/layout/AppShell.js';

function RequiredHint({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return <p className="mt-1.5 text-[11px] text-[var(--rp-danger)]">{children}</p>;
}

export function NovelSettingsPage({ route, onNavigate }: { route: Route; onNavigate: (r: Route) => void }) {
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

  const titleMissing = !book.title.trim() || book.title.trim() === '无题';
  const worldMissing = !book.worldView.trim();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="rp-scroll min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
        <div className="mx-auto max-w-2xl space-y-3">
          <NovelBookIdentity book={book} />

          <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
            <p className="mb-2 text-[13px] font-semibold">基本信息</p>
            <div className="space-y-1.5">
              <Label htmlFor="nv-title" required>
                书名
              </Label>
              <Input
                id="nv-title"
                value={book.title}
                onChange={(e) => updateBook((b) => ({ ...b, title: e.target.value }))}
                placeholder="给这本小说起个名字"
              />
              <RequiredHint show={titleMissing}>书名是必填的，现在还是“无题”。</RequiredHint>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
            <div className="mb-2">
              <Label htmlFor="nv-world" required className="text-[13px] font-semibold">
                世界观
              </Label>
            </div>
            <Textarea
              id="nv-world"
              rows={8}
              value={book.worldView}
              onChange={(e) => updateBook((b) => ({ ...b, worldView: e.target.value }))}
              placeholder="这个世界是什么样的？时代、规则、氛围……"
            />
            <RequiredHint show={worldMissing}>世界观是必填的，AI 续写全靠它，不然写出来的东西会跑偏。</RequiredHint>
            <p className="mt-1.5 text-[11px] text-[var(--rp-fg-subtle)]">提示：完善的世界观能让 AI 写出更具沉浸感的故事。</p>
          </div>

          <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
            <p className="mb-2 text-[13px] font-semibold">大纲</p>
            <Textarea
              id="nv-outline"
              rows={6}
              value={book.outline ?? ''}
              onChange={(e) => updateBook((b) => ({ ...b, outline: e.target.value }))}
              placeholder="主线是什么？分几卷？关键转折和结局走向……"
            />
            <p className="mt-1.5 text-[11px] text-[var(--rp-fg-subtle)]">大纲会一起发给 AI，续写时不容易跑偏；导出 TXT / Markdown 时也会带上。</p>
          </div>

          <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
            <p className="mb-2 text-[13px] font-semibold">写作目标</p>
            <div className="flex items-center gap-2">
              <Input
                id="nv-goal"
                inputMode="numeric"
                value={(book.wordGoal ?? 0) > 0 ? String(book.wordGoal) : ''}
                onChange={(e) => {
                  const v = parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
                  updateBook((b) => ({ ...b, wordGoal: Number.isNaN(v) ? 0 : Math.max(0, v) }));
                }}
                placeholder="例如 100000"
                aria-label="全书目标字数"
                className="flex-1"
              />
              <span className="shrink-0 text-[12px] text-[var(--rp-fg-muted)]">字</span>
            </div>
            <GoalBar book={book} className="mt-3" />
            {(book.wordGoal ?? 0) <= 0 && (
              <p className="mt-1.5 text-[11px] text-[var(--rp-fg-subtle)]">填一个全书目标字数，书架会显示写作进度。</p>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
            <p className="mb-2 text-[13px] font-semibold">内容控制</p>
            <div className="space-y-1.5">
              <Label htmlFor="nv-negative">负面提示词（不想生成的内容）</Label>
              <Textarea id="nv-negative" rows={3} value={book.negativePrompt} onChange={(e) => updateBook((b) => ({ ...b, negativePrompt: e.target.value }))} placeholder="例如：恐怖、惊悚、现代科技..." />
            </div>
            <label className="mt-3 flex cursor-pointer items-center gap-2 text-[12.5px]">
              <Switch checked={book.isAdultMode} onCheckedChange={(v) => updateBook((b) => ({ ...b, isAdultMode: v }))} />
              成人模式（R18）— 解除内容审查，允许生成 NSFW 内容
            </label>
          </div>

          <div className="rounded-2xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] p-4">
            <p className="mb-2 text-[13px] font-semibold">模型</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="nv-model">正文模型</Label>
                <Input id="nv-model" value={book.model ?? ''} onChange={(e) => updateBook((b) => ({ ...b, model: e.target.value }))} placeholder="留空用默认模型" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nv-review-model">书评模型</Label>
                <Input id="nv-review-model" value={book.reviewModel ?? ''} onChange={(e) => updateBook((b) => ({ ...b, reviewModel: e.target.value }))} placeholder="留空用默认模型" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nv-comment-model">评论区模型</Label>
                <Input id="nv-comment-model" value={book.commentModel ?? ''} onChange={(e) => updateBook((b) => ({ ...b, commentModel: e.target.value }))} placeholder="留空用正文模型" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <NovelTabBar route={route} onNavigate={onNavigate} />
    </div>
  );
}
