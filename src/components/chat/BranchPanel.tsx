/**
 * Branch panel.
 *
 * A tree of the chat's story branches: switch, rename, delete, and export.
 * The main line is fixed (like RP-Hub): it cannot be renamed or deleted, and it
 * is always the root of the tree.
 */

import * as React from 'react';
import { Download, Upload, GitBranch, Pencil, Trash2, X } from 'lucide-react';
import type { RPChat } from '@/core/types/chat.js';
import { MAIN_BRANCH } from '@/core/types/chat.js';
import { buildBranchTree, exportBranches, importBranches, type BranchNode } from '@/core/branch/engine.js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils.js';
import { toast } from '@/components/ui/toast.js';
import { confirmAction } from '@/components/ui/confirm.js';

export function BranchPanel({
  open,
  onOpenChange,
  chat,
  activeBranchId,
  onSwitch,
  onRename,
  onDelete,
  saveChat,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  chat: RPChat | null;
  activeBranchId: string;
  onSwitch: (branchId: string) => void;
  onRename: (branchId: string, name: string) => void;
  onDelete: (branchId: string) => void;
  /** Persist an imported chat. */
  saveChat: (chat: RPChat) => Promise<void>;
}) {
  const [editing, setEditing] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement | null>(null);

  if (!open || !chat) return null;

  const tree = buildBranchTree(chat);

  const handleExport = () => {
    const jsonl = exportBranches(chat);
    const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${chat.title || 'chat'}_全部分支_chat.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('已导出全部分支', `${manifestCount(chat)} 条记录`);
  };

  const handleImport = async (file: File) => {
    if (!(await confirmAction({ title: '确认操作', description: `确定导入「${file.name}」吗？当前对话的消息会被替换。` }))) return;
    try {
      const text = await file.text();
      const next = importBranches(chat, text);
      await saveChat(next);
      toast.success('导入完成', `${next.messages.length} 条主线消息 · ${next.branches?.length ?? 0} 条分支`);
    } catch (err) {
      toast.error('导入失败', err instanceof Error ? err.message : String(err));
    }
  };

  const commitRename = (branchId: string) => {
    const name = draft.trim();
    setEditing(null);
    if (name) onRename(branchId, name);
  };

  return (
    <div
      role="dialog"
      aria-label="剧情分支"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-3 backdrop-blur-[2px] sm:items-center"
      onClick={() => onOpenChange(false)}
    >
      <div
        className="flex max-h-[82vh] w-[min(34rem,100%)] flex-col overflow-hidden rounded-xl border border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] shadow-rp"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--rp-border)] px-3 py-2">
          <GitBranch className="size-4 text-[var(--rp-accent)]" aria-hidden="true" />
          <p className="text-[13px] font-semibold">剧情分支</p>
          <span className="text-[11px] text-[var(--rp-fg-subtle)]">{countBranches(chat)} 条分支</span>
          <div className="ml-auto flex items-center gap-1">
            <Button size="icon-sm" variant="ghost" aria-label="导入分支" title="导入 JSONL" onClick={() => fileRef.current?.click()}>
              <Upload className="size-3.5" aria-hidden="true" />
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".jsonl,.json,application/json,application/x-ndjson"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleImport(f);
                e.target.value = '';
              }}
            />
            <Button size="icon-sm" variant="ghost" aria-label="导出全部分支" title="导出全部分支" onClick={handleExport}>
              <Download className="size-3.5" aria-hidden="true" />
            </Button>
            <Button size="icon-sm" variant="ghost" aria-label="关闭" onClick={() => onOpenChange(false)}>
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <div className="rp-scroll flex-1 overflow-y-auto p-3">
          {tree.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-[var(--rp-fg-muted)]">
              在助手消息上点「从这里分支」，就能从那条消息开出一条新的剧情线。
            </p>
          ) : (
            tree.map((node) => (
              <BranchRow
                key={node.id}
                node={node}
                depth={0}
                activeBranchId={activeBranchId}
                editing={editing}
                draft={draft}
                setDraft={setDraft}
                setEditing={setEditing}
                onSwitch={onSwitch}
                onDelete={onDelete}
                commitRename={commitRename}
                renderChildren={(child, depth) => (
                  <BranchRow
                    key={child.id}
                    node={child}
                    depth={depth}
                    activeBranchId={activeBranchId}
                    editing={editing}
                    draft={draft}
                    setDraft={setDraft}
                    setEditing={setEditing}
                    onSwitch={onSwitch}
                    onDelete={onDelete}
                    commitRename={commitRename}
                    renderChildren={() => null}
                  />
                )}
              />
            ))
          )}
        </div>

        <p className="border-t border-[var(--rp-border)] px-3 py-2 text-[10.5px] leading-relaxed text-[var(--rp-fg-subtle)]">
          切换分支会先保存当前分支；分支消息独立保存，主线不可删除。删除子分支时它的子分支会顺延到父节点。
        </p>
      </div>
    </div>
  );
}

function BranchRow({
  node,
  depth,
  activeBranchId,
  editing,
  draft,
  setDraft,
  setEditing,
  onSwitch,
  onDelete,
  commitRename,
  renderChildren,
}: {
  node: BranchNode;
  depth: number;
  activeBranchId: string;
  editing: string | null;
  draft: string;
  setDraft: (v: string) => void;
  setEditing: (v: string | null) => void;
  onSwitch: (id: string) => void;
  onDelete: (id: string) => void;
  commitRename: (id: string) => void;
  renderChildren: (node: BranchNode, depth: number) => React.ReactNode;
}) {
  const isMain = node.id === MAIN_BRANCH;
  const active = activeBranchId === node.id;

  return (
    <div>
      <div
        className={cn(
          'group flex items-center gap-2 rounded-lg px-2 py-1.5',
          active ? 'bg-[var(--rp-accent-soft)]' : 'hover:bg-[var(--rp-bg-sunken)]',
        )}
        style={{ marginLeft: depth * 14 }}
      >
        <GitBranch
          className={cn('size-3.5 shrink-0', active ? 'text-[var(--rp-accent)]' : 'text-[var(--rp-fg-subtle)]')}
          aria-hidden="true"
        />

        {editing === node.id ? (
          <Input
            autoFocus
            value={draft}
            maxLength={30}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => commitRename(node.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(node.id);
              if (e.key === 'Escape') setEditing(null);
            }}
            className="h-7 text-[12.5px]"
            aria-label="分支名称"
          />
        ) : (
          <button
            type="button"
            className="min-w-0 flex-1 cursor-pointer truncate text-left text-[12.5px]"
            onClick={() => onSwitch(node.id)}
            title="切换到这个分支"
          >
            {node.name}
            {isMain && <span className="ml-1.5 text-[10.5px] text-[var(--rp-fg-subtle)]">主线</span>}
          </button>
        )}

        <span className="shrink-0 text-[10.5px] tabular-nums text-[var(--rp-fg-subtle)]">
          {node.floorCount} 楼 · {(node.wordCount / 10000).toFixed(1)}W
        </span>

        {!isMain && editing !== node.id && (
          <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="重命名分支"
              onClick={() => {
                setEditing(node.id);
                setDraft(node.name);
              }}
            >
              <Pencil className="size-3" aria-hidden="true" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-[var(--rp-danger)]"
              aria-label="删除分支"
              onClick={async () => {
                if (await confirmAction({ title: '确认操作', description: `删除分支「${node.name}」？它的子分支会顺延到父节点。` })) onDelete(node.id);
              }}
            >
              <Trash2 className="size-3" aria-hidden="true" />
            </Button>
          </span>
        )}
      </div>
      {node.children.map((child) => renderChildren(child, depth + 1))}
    </div>
  );
}

function countBranches(chat: RPChat): number {
  return chat.branches?.length ?? 0;
}

function manifestCount(chat: RPChat): number {
  const main = chat.mainMessages?.length ?? chat.messages.length;
  return main + (chat.branches ?? []).reduce((sum, b) => sum + b.messages.length, 0);
}
