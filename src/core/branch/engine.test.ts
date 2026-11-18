import { describe, expect, it } from 'vitest';
import {
  buildBranchTree,
  createBranch,
  currentMessages,
  deleteBranch,
  exportBranches,
  importBranches,
  renameBranch,
  switchBranch,
} from './engine.js';
import { MAIN_BRANCH, type RPBranch, type RPChat, type RPChatMessage } from '../types/chat.js';

function msg(id: string, role: 'user' | 'assistant', content: string): RPChatMessage {
  return { id, role, content, createdAt: 0 };
}

function chat(messages: RPChatMessage[], branches: RPBranch[] = []): RPChat {
  return {
    id: 'c1',
    title: '测试',
    cardId: 'card',
    lorebookIds: [],
    useCardLorebook: false,
    messages,
    variables: {},
    branches,
    activeBranchId: MAIN_BRANCH,
    createdAt: 0,
    updatedAt: 0,
  };
}

const base = () => [
  msg('u1', 'user', '你好'),
  msg('a1', 'assistant', '你好呀'),
  msg('u2', 'user', '今天去哪'),
  msg('a2', 'assistant', '去酒馆'),
];

describe('currentMessages', () => {
  it('returns the main line by default', () => {
    expect(currentMessages(chat(base()))).toHaveLength(4);
  });

  it('returns the active branch messages', () => {
    const b: RPBranch = {
      id: 'b1',
      name: '分支 1',
      parentId: MAIN_BRANCH,
      createdAt: 0,
      updatedAt: 0,
      forkFloor: 1,
      messages: [msg('u1', 'user', '你好'), msg('a1', 'assistant', '另一条线')],
    };
    expect(currentMessages(chat(base(), [b]))).toHaveLength(4);
    expect(currentMessages({ ...chat(base(), [b]), activeBranchId: 'b1' })).toHaveLength(2);
  });
});

describe('createBranch', () => {
  it('forks from an assistant message, inclusive', () => {
    const out = createBranch(chat(base()), 3);
    expect(out).not.toBeNull();
    const { branch, chat: next } = out!;
    expect(branch.messages).toHaveLength(4);
    expect(branch.messages[3].id).toBe('a2');
    expect(branch.parentId).toBe(MAIN_BRANCH);
    expect(next.activeBranchId).toBe(branch.id);
  });

  it('refuses to fork from a user message', () => {
    expect(createBranch(chat(base()), 2)).toBeNull();
  });

  it('refuses an out-of-range index', () => {
    expect(createBranch(chat(base()), 99)).toBeNull();
  });

  it('does not mutate the source chat', () => {
    const source = chat(base());
    createBranch(source, 3);
    expect(source.branches).toEqual([]);
    expect(source.activeBranchId).toBe(MAIN_BRANCH);
    expect(source.messages).toHaveLength(4);
  });

  it('names siblings sequentially within the parent', () => {
    const first = createBranch(chat(base()), 3)!;
    const second = createBranch(first.chat, 1)!;
    expect(second.branch.name).toBe('分支 2');
  });

  it('forks from inside a branch using that branch as parent', () => {
    const first = createBranch(chat(base()), 1)!;
    // The branch holds 2 floors, so fork from its last assistant message.
    const second = createBranch(first.chat, 1)!;
    expect(second.branch.parentId).toBe(first.branch.id);
  });
});

describe('switchBranch', () => {
  it('saves the in-view messages before switching away', () => {
    const first = createBranch(chat(base()), 3)!;
    const dirty: RPChatMessage[] = [
      ...first.chat.messages,
      msg('u3', 'user', '分支里的新消息'),
    ];
    const saved = switchBranch({ ...first.chat, messages: dirty }, MAIN_BRANCH);
    const back = saved.branches!.find((b) => b.id === first.branch.id)!;
    expect(back.messages).toHaveLength(5);
    // The main line survives in its own slot.
    expect(saved.mainMessages).toHaveLength(4);
  });

  it('loads the target branch messages', () => {
    const first = createBranch(chat(base()), 1)!;
    const main = switchBranch(first.chat, MAIN_BRANCH);
    expect(main.activeBranchId).toBe(MAIN_BRANCH);
    expect(main.messages).toHaveLength(4);
    expect(main.messages[1].content).toBe('你好呀');
  });

  it('ignores an unknown branch id', () => {
    const c = chat(base());
    expect(switchBranch(c, 'nope')).toBe(c);
  });
});

describe('deleteBranch', () => {
  it('never deletes the main line', () => {
    const c = chat(base());
    expect(deleteBranch(c, MAIN_BRANCH)).toBe(c);
  });

  it('re-parents children to the deleted branch parent', () => {
    const first = createBranch(chat(base()), 1)!;
    const second = createBranch(first.chat, 1)!;
    const removed = deleteBranch(second.chat, first.branch.id);
    const grandchild = removed.branches!.find((b) => b.id === second.branch.id)!;
    expect(grandchild.parentId).toBe(MAIN_BRANCH);
    expect(removed.branches).toHaveLength(1);
  });

  it('returns to the parent line when the active branch is deleted', () => {
    const first = createBranch(chat(base()), 1)!;
    const removed = deleteBranch(first.chat, first.branch.id);
    expect(removed.activeBranchId).toBe(MAIN_BRANCH);
    expect(removed.messages).toHaveLength(4);
  });
});

describe('renameBranch', () => {
  it('renames a child branch and trims to 30 chars', () => {
    const first = createBranch(chat(base()), 1)!;
    const renamed = renameBranch(first.chat, first.branch.id, ' 新名字 ');
    expect(renamed.branches![0].name).toBe('新名字');
    const long = renameBranch(first.chat, first.branch.id, 'x'.repeat(40));
    expect(long.branches![0].name).toHaveLength(30);
  });

  it('cannot rename the main line', () => {
    const source = chat(base());
    expect(renameBranch(source, MAIN_BRANCH, '别的')).toBe(source);
  });
});

describe('buildBranchTree', () => {
  it('puts every branch under its parent', () => {
    const first = createBranch(chat(base()), 1)!;
    const second = createBranch(first.chat, 1)!;
    const tree = buildBranchTree(second.chat);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(MAIN_BRANCH);
    expect(tree[0].children.map((c) => c.id)).toEqual([first.branch.id]);
    expect(tree[0].children[0].children.map((c) => c.id)).toEqual([second.branch.id]);
  });

  it('reports floor and word counts', () => {
    const tree = buildBranchTree(chat(base()));
    expect(tree[0].floorCount).toBe(4);
    expect(tree[0].wordCount).toBeGreaterThan(0);
  });

  it('adopts orphaned branches under main', () => {
    const orphan: RPBranch = {
      id: 'orphan',
      name: '孤儿',
      parentId: 'missing',
      createdAt: 0,
      updatedAt: 0,
      forkFloor: 0,
      messages: [msg('u1', 'user', 'x')],
    };
    const tree = buildBranchTree(chat(base(), [orphan]));
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe('orphan');
  });
});

describe('importBranches', () => {
  it('round-trips an exported chat', () => {
    const first = createBranch(chat(base()), 1)!;
    const restored = importBranches(chat([]), exportBranches(first.chat));
    expect(restored.messages).toHaveLength(4);
    expect(restored.branches).toHaveLength(1);
    expect(restored.branches![0].messages).toHaveLength(2);
    expect(restored.branches![0].name).toBe(first.branch.name);
    expect(restored.activeBranchId).toBe(MAIN_BRANCH);
  });

  it('reads the RP-Hub manifest type too', () => {
    const jsonl = [
      JSON.stringify({ type: 'rp-hub-branch-chat', version: 1, branches: [{ id: 'b1', name: '支线', parentId: 'main' }] }),
      JSON.stringify({ branch: 'main', id: 'm1', role: 'user', content: '你好' }),
      JSON.stringify({ branch: 'b1', id: 'm2', role: 'assistant', content: '你好呀' }),
    ].join('\n');
    const restored = importBranches(chat([]), jsonl);
    expect(restored.messages).toHaveLength(1);
    expect(restored.branches![0]).toMatchObject({ id: 'b1', name: '支线', parentId: 'main' });
  });

  it('imports a bare message array onto the main line', () => {
    const jsonl = JSON.stringify([
      { id: 'u1', role: 'user', content: 'a' },
      { id: 'a1', role: 'assistant', content: 'b' },
    ]);
    const restored = importBranches(chat([]), jsonl);
    expect(restored.messages).toHaveLength(2);
    expect(restored.branches ?? []).toHaveLength(0);
  });

  it('skips malformed lines', () => {
    const restored = importBranches(chat([]), ['{oops', JSON.stringify({ role: 'user', content: 'ok' })].join('\n'));
    expect(restored.messages).toHaveLength(1);
  });

  it('leaves the chat untouched for empty input', () => {
    const source = chat(base());
    expect(importBranches(source, '')).toBe(source);
  });
});

describe('exportBranches', () => {
  it('writes a manifest line then one line per message', () => {
    const first = createBranch(chat(base()), 1)!;
    const jsonl = exportBranches(first.chat);
    const lines = jsonl.trim().split('\n');
    const manifest = JSON.parse(lines[0]);
    expect(manifest.type).toBe('rp-branch-chat');
    expect(manifest.branches).toHaveLength(2);
    // main (4) + branch (2) messages
    expect(lines).toHaveLength(1 + 4 + 2);
  });

  it('round-trips message roles and branch ids', () => {
    const first = createBranch(chat(base()), 1)!;
    const lines = exportBranches(first.chat).trim().split('\n').slice(1);
    const records = lines.map((l) => JSON.parse(l));
    expect(records.some((r) => r.branch === MAIN_BRANCH)).toBe(true);
    expect(records.some((r) => r.branch === first.branch.id)).toBe(true);
    expect(records.every((r) => r.role === 'user' || r.role === 'assistant')).toBe(true);
  });
});
