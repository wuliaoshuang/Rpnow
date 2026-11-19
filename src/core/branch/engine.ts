/**
 * Story branches (剧情分支).
 *
 * A branch is a parallel message history. The main line is special: it lives in
 * `chat.messages`, cannot be renamed or deleted, and is addressed as `main`.
 * Child branches hold their own full message array and remember the floor they
 * were cut from.
 *
 * Switching a branch *replaces* `chat.messages` with the target branch's array
 * (after saving the current one). That keeps every consumer — prompt builder,
 * message list, memory — working on a single `chat.messages` without knowing
 * branches exist.
 *
 * Memories are isolated the same way (G10). Each line keeps its own snapshot —
 * `chat.mainMemories` for the main line, `branch.memories` for a child — and
 * the engine saves the outgoing view and restores the incoming one on
 * create/switch. A branch only ever sees records whose source messages are in
 * its own history, so branches can no longer pollute each other (or the main
 * line) through the shared chat-level memory list. Callers pass the live
 * memory list in and read the active view back with `activeBranchMemories`;
 * when no list is passed the engine falls back to whatever snapshots are
 * already stored, and legacy chats without snapshots behave as before.
 */

import type { RPBranch, RPChat, RPChatMessage } from '../types/chat.js';
import { MAIN_BRANCH } from '../types/chat.js';
import type { MemoryRecord } from '../memory/types.js';
import { numberMemories } from '../memory/engine.js';
import { uid } from '../../lib/utils.js';

export interface BranchNode extends RPBranch {
  children: BranchNode[];
  floorCount: number;
  wordCount: number;
}

/** The main-line messages, regardless of which branch is in view. */
export function mainMessages(chat: RPChat): RPChatMessage[] {
  return chat.mainMessages ?? chat.messages;
}

/** The message array currently in view. */
export function currentMessages(chat: RPChat): RPChatMessage[] {
  if (chat.activeBranchId && chat.activeBranchId !== MAIN_BRANCH) {
    return chat.branches?.find((b) => b.id === chat.activeBranchId)?.messages ?? mainMessages(chat);
  }
  return mainMessages(chat);
}

function countWords(messages: RPChatMessage[]): number {
  return messages.reduce((sum, m) => sum + [...m.content].length, 0);
}

/** Build the branch tree, annotated with floor/word counts for the map UI. */
export function buildBranchTree(chat: RPChat): BranchNode[] {
  const branches = chat.branches ?? [];
  const nodes = new Map<string, BranchNode>();

  const makeNode = (branch: RPBranch): BranchNode => ({
    ...branch,
    floorCount: branch.messages.length,
    wordCount: countWords(branch.messages),
    children: [],
  });

  // Synthesise the main line so it can be the root.
  const mainMessages = chat.mainMessages ?? chat.messages;
  const main: BranchNode = {
    id: MAIN_BRANCH,
    name: '主线',
    parentId: null,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    forkFloor: 0,
    messages: mainMessages,
    floorCount: mainMessages.length,
    wordCount: countWords(mainMessages),
    children: [],
  };
  nodes.set(MAIN_BRANCH, main);
  for (const b of branches) nodes.set(b.id, makeNode(b));

  const roots: BranchNode[] = [];
  for (const node of nodes.values()) {
    if (node.id !== MAIN_BRANCH && node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else if (node.id !== MAIN_BRANCH) {
      // Orphaned branch (parent deleted): hang it off main.
      node.parentId = MAIN_BRANCH;
      main.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Persist the in-view messages back to whichever branch is active. */
function saveCurrent(chat: RPChat, messages: RPChatMessage[]): Partial<RPChat> {
  if (chat.activeBranchId && chat.activeBranchId !== MAIN_BRANCH) {
    return {
      branches: (chat.branches ?? []).map((b) =>
        b.id === chat.activeBranchId ? { ...b, messages, updatedAt: Date.now() } : b,
      ),
    };
  }
  // Main line has its own slot so switching away never loses it.
  return { mainMessages: messages };
}

/** Deep-copy one record (one level of group children) so a snapshot never aliases the live list. */
function copyMemoryRecord(record: MemoryRecord): MemoryRecord {
  return {
    ...record,
    sourceUserIds: [...(record.sourceUserIds ?? [])],
    sourceAssistantIds: [...(record.sourceAssistantIds ?? [])],
    sourceMemories: record.sourceMemories?.map((child) => ({
      ...child,
      sourceUserIds: [...(child.sourceUserIds ?? [])],
      sourceAssistantIds: [...(child.sourceAssistantIds ?? [])],
    })),
  };
}

/**
 * Derive a branch's memory view from a full record list: keep only records
 * whose source messages are in this branch's history. Group summaries keep
 * only their surviving children and are dropped when none survive. The input
 * is never mutated, and records keep their original `M{no}` numbers so
 * citations stay stable across lines.
 */
export function memoriesForBranch(records: MemoryRecord[], messages: RPChatMessage[]): MemoryRecord[] {
  const live = new Set(messages.map((m) => m.id));
  const survives = (record: MemoryRecord): boolean => {
    const ids = [...(record.sourceUserIds ?? []), ...(record.sourceAssistantIds ?? [])];
    if (!ids.length) return true;
    return ids.some((id) => live.has(id));
  };
  const view: MemoryRecord[] = [];
  for (const record of records) {
    if (record.secondaryCompressed) {
      const children = (record.sourceMemories ?? []).filter(survives).map(copyMemoryRecord);
      if (!children.length) continue;
      view.push({ ...copyMemoryRecord(record), sourceMemories: children });
    } else if (survives(record)) {
      view.push(copyMemoryRecord(record));
    }
  }
  numberMemories(view);
  return view;
}

/** The stored snapshot for one line, if any. */
export function branchMemories(chat: RPChat, branchId: string): MemoryRecord[] | undefined {
  if (branchId === MAIN_BRANCH) return chat.mainMemories;
  return chat.branches?.find((b) => b.id === branchId)?.memories;
}

/** The memory view for the line currently in view, or `fallback` when no snapshot exists yet. */
export function activeBranchMemories(chat: RPChat, fallback: MemoryRecord[] = []): MemoryRecord[] {
  return branchMemories(chat, chat.activeBranchId ?? MAIN_BRANCH) ?? fallback;
}

/** Apply a stashed memory list onto an already-computed branch array. */
function stashMemoriesIntoBranches(
  branches: RPBranch[],
  branchId: string,
  memories: MemoryRecord[],
): RPBranch[] {
  return branches.map((b) =>
    b.id === branchId ? { ...b, memories: memories.map(copyMemoryRecord), updatedAt: Date.now() } : b,
  );
}

/**
 * Create a child branch cut after `fromIndex` (inclusive).
 *
 * `fromIndex` must point at an assistant message — a branch cut mid-user-turn
 * would leave the model without a reply.
 *
 * When the live memory list is passed in, the outgoing line's view is stashed
 * (main line → `mainMemories`, branch → its own snapshot) and the new branch
 * starts with only the records whose source messages it actually contains —
 * it never sees the main line's later memories, and the main line's records
 * are untouched by anything the branch does afterwards.
 */
export function createBranch(
  chat: RPChat,
  fromIndex: number,
  name?: string,
  memories?: MemoryRecord[],
): { chat: RPChat; branch: RPBranch } | null {
  const messages = currentMessages(chat);
  const target = messages[fromIndex];
  if (!target || target.role !== 'assistant') return null;
  if (fromIndex < 0 || fromIndex >= messages.length) return null;

  const now = Date.now();
  const branchMessages = messages.slice(0, fromIndex + 1).map((m) => ({ ...m }));
  // The new branch inherits only what it can see: records anchored to its own
  // floors. Without a live list, fall back to the stored snapshot of the line
  // we fork from; without that either, the branch carries no snapshot.
  const source = memories ?? branchMemories(chat, chat.activeBranchId ?? MAIN_BRANCH);
  // Names are numbered across the whole chat, so deleting a branch never makes
  // two live branches share a name.
  const branch: RPBranch = {
    id: uid('branch'),
    name: (name ?? `分支 ${(chat.branches ?? []).length + 1}`).slice(0, 30),
    parentId: chat.activeBranchId ?? MAIN_BRANCH,
    createdAt: now,
    updatedAt: now,
    forkFloor: fromIndex,
    messages: branchMessages,
    memories: source ? memoriesForBranch(source, branchMessages) : undefined,
  };

  const saved = saveCurrent(chat, messages);
  let baseBranches = saved.branches ?? chat.branches ?? [];
  const onBranch = !!chat.activeBranchId && chat.activeBranchId !== MAIN_BRANCH;
  if (memories !== undefined && onBranch) {
    baseBranches = stashMemoriesIntoBranches(baseBranches, chat.activeBranchId!, memories);
  }

  return {
    branch,
    chat: {
      ...chat,
      ...saved,
      ...(memories !== undefined && !onBranch
        ? { mainMemories: memories.map(copyMemoryRecord) }
        : {}),
      branches: [...baseBranches, branch],
      activeBranchId: branch.id,
      messages: branch.messages,
      updatedAt: now,
    },
  };
}
/** Switch to another branch, saving the current one first. */
export function switchBranch(chat: RPChat, branchId: string, memories?: MemoryRecord[]): RPChat {
  const branches = chat.branches ?? [];
  const target = branchId === MAIN_BRANCH ? null : branches.find((b) => b.id === branchId);
  if (branchId !== MAIN_BRANCH && !target) return chat;

  const nextMessages = target ? target.messages : mainMessages(chat);
  // Persist whatever the caller currently has on screen — it may be newer than
  // the stored branch array.
  const saved = saveCurrent(chat, chat.messages);
  let nextBranches = saved.branches ?? branches;
  const onBranch = !!chat.activeBranchId && chat.activeBranchId !== MAIN_BRANCH;
  // Stash the outgoing line's memory view before leaving it, so the line we
  // come back to still has exactly what it had — branch work never leaks
  // into the main line's memories, or vice versa.
  if (memories !== undefined && onBranch) {
    nextBranches = stashMemoriesIntoBranches(nextBranches, chat.activeBranchId!, memories);
  }

  const next: RPChat = {
    ...chat,
    ...saved,
    ...(memories !== undefined && !onBranch
      ? { mainMemories: memories.map(copyMemoryRecord) }
      : {}),
    branches: nextBranches,
    activeBranchId: branchId,
    messages: nextMessages.map((m) => ({ ...m })),
    updatedAt: Date.now(),
  };
  if (branchId !== MAIN_BRANCH) {
    next.branches = nextBranches.map((b) =>
      b.id === branchId ? { ...b, updatedAt: Date.now() } : b,
    );
  }
  return next;
}

/**
 * Delete a branch. Children are re-parented to the deleted branch's parent, and
 * the main line can never be deleted.
 */
export function deleteBranch(chat: RPChat, branchId: string): RPChat {
  if (branchId === MAIN_BRANCH) return chat;
  const branches = chat.branches ?? [];
  const victim = branches.find((b) => b.id === branchId);
  if (!victim) return chat;

  const fallbackParent = victim.parentId ?? MAIN_BRANCH;
  const remaining = branches
    .filter((b) => b.id !== branchId)
    .map((b) => (b.parentId === branchId ? { ...b, parentId: fallbackParent } : b));

  const patch: Partial<RPChat> = { branches: remaining };
  if (chat.activeBranchId === branchId) {
    // Re-enter the parent line.
    const parentMessages =
      fallbackParent === MAIN_BRANCH
        ? mainMessages(chat)
        : remaining.find((b) => b.id === fallbackParent)?.messages ?? mainMessages(chat);
    patch.activeBranchId = fallbackParent;
    patch.messages = parentMessages.map((m) => ({ ...m }));
  }
  return { ...chat, ...patch, updatedAt: Date.now() };
}

/** Rename a branch (main is fixed). */
export function renameBranch(chat: RPChat, branchId: string, name: string): RPChat {
  if (branchId === MAIN_BRANCH) return chat;
  const trimmed = name.trim().slice(0, 30);
  if (!trimmed) return chat;
  return {
    ...chat,
    branches: (chat.branches ?? []).map((b) => (b.id === branchId ? { ...b, name: trimmed } : b)),
    updatedAt: Date.now(),
  };
}

/** Find the newest branch id for a chat. */
export function nextBranchName(chat: RPChat): string {
  const count = (chat.branches ?? []).length;
  return `分支 ${count + 1}`;
}

/**
 * Import a chat JSONL written by `exportBranches` (or by RP-Hub, whose manifest
 * type is `rp-hub-branch-chat`).
 *
 * Two shapes are accepted: a manifest line followed by `{"branch":…}` records
 * (the exported format), or a bare JSON array / JSONL of messages, which lands
 * on the main line.
 */
export function importBranches(chat: RPChat, jsonl: string): RPChat {
  const lines = jsonl.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return chat;

  const records: Array<Record<string, unknown>> = [];
  let manifest: { branches?: Array<{ id: string; name: string; parentId: string | null; forkFloor?: number }> } | null =
    null;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (Array.isArray(parsed)) {
        records.push(...parsed.filter((m) => m && typeof m === 'object') as Array<Record<string, unknown>>);
        continue;
      }
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (obj.type === 'rp-branch-chat' || obj.type === 'rp-hub-branch-chat') {
          manifest = obj as { branches?: Array<{ id: string; name: string; parentId: string | null; forkFloor?: number }> };
          continue;
        }
        if (obj.role === 'user' || obj.role === 'assistant' || obj.role === 'system') {
          records.push(obj);
        }
      }
    } catch {
      /* skip a malformed line rather than aborting the whole import */
    }
  }

  if (!records.length) return chat;

  const now = Date.now();
  const byBranch = new Map<string, RPChatMessage[]>();
  for (const raw of records) {
    const branchId = typeof raw.branch === 'string' && raw.branch ? raw.branch : MAIN_BRANCH;
    const list = byBranch.get(branchId) ?? [];
    list.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid('m'),
      role: raw.role === 'assistant' || raw.role === 'system' ? raw.role : 'user',
      content: String(raw.content ?? ''),
      reasoning: typeof raw.reasoning === 'string' ? raw.reasoning : undefined,
      hidden: raw.hidden === true,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    });
    byBranch.set(branchId, list);
  }

  const mainMessages = byBranch.get(MAIN_BRANCH) ?? [];
  const declared = new Set((manifest?.branches ?? []).map((b) => b.id));
  const branchIds = [...new Set([...byBranch.keys(), ...declared])].filter((id) => id !== MAIN_BRANCH);

  const branches: RPBranch[] = branchIds.map((id) => {
    const meta = manifest?.branches?.find((b) => b.id === id);
    return {
      id,
      name: meta?.name ?? `分支 ${id.slice(0, 6)}`,
      parentId: meta?.parentId ?? MAIN_BRANCH,
      createdAt: now,
      updatedAt: now,
      forkFloor: meta?.forkFloor ?? 0,
      messages: byBranch.get(id) ?? [],
    };
  });

  return { ...chat, messages: mainMessages, branches, activeBranchId: MAIN_BRANCH, updatedAt: now };
}

/**
 * Export every branch as JSONL.
 *
 * Line 1 is a manifest describing the branch graph; each following line is one
 * message. RP-Hub uses the same shape so chats stay portable between the two.
 */
export function exportBranches(chat: RPChat): string {
  const branches = chat.branches ?? [];
  const mainLine = chat.mainMessages ?? chat.messages;
  const manifest = {
    type: 'rp-branch-chat',
    version: 1,
    exportedAt: new Date().toISOString(),
    chatId: chat.id,
    chatName: chat.title,
    branches: [
      {
        id: MAIN_BRANCH,
        name: '主线',
        parentId: null,
        forkFloor: 0,
        floorCount: mainLine.length,
        wordCount: countWords(mainLine),
      },
      ...branches.map((b) => ({
        id: b.id,
        name: b.name,
        parentId: b.parentId,
        forkFloor: b.forkFloor,
        floorCount: b.messages.length,
        wordCount: countWords(b.messages),
      })),
    ],
  };

  const lines: string[] = [JSON.stringify(manifest)];
  const emit = (branchId: string, messages: RPChatMessage[]) => {
    for (const m of messages) {
      lines.push(
        JSON.stringify({
          branch: branchId,
          id: m.id,
          role: m.role,
          content: m.content,
          reasoning: m.reasoning,
          hidden: m.hidden ?? false,
          createdAt: m.createdAt,
        }),
      );
    }
  };
  emit(MAIN_BRANCH, mainLine);
  for (const b of branches) emit(b.id, b.messages);
  return lines.join('\n') + '\n';
}
