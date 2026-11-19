/**
 * Word-level diff for the smart-edit review dialog (P07).
 *
 * Ported from RP-Hub's `diffText`/`compactDiffParts` in
 * `character/index.html`: Latin runs count as words, everything else
 * (CJK, punctuation) is diffed character by character, over a
 * longest-common-subsequence table. Long unchanged runs are folded so the
 * reviewer only sees the neighbourhood of each edit.
 */

export type DiffPartType = 'same' | 'add' | 'del' | 'gap';

export interface DiffPart {
  type: DiffPartType;
  text: string;
}

/** Unchanged context kept on each side of a folded run (RP-Hub: 60). */
export const DIFF_CONTEXT_CHARS = 60;

/** LCS table size cap; beyond it the whole middle is treated as replaced. */
const LCS_CELL_CAP = 4e6;

const diffTokens = (text: string): string[] =>
  text.match(/[A-Za-z0-9_]+|\s+|[^]/gu) || [];

/**
 * Split `from` → `to` into same/add/del runs.
 *
 * Common head/tail are trimmed first so the LCS table only covers the
 * changed middle. A one- or two-character match stranded between edits is
 * folded into the edits — it reads better as part of the change.
 */
export function diffText(from: string, to: string): DiffPart[] {
  const a = diffTokens(from);
  const b = diffTokens(to);
  let head = 0;
  let tail = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  while (
    tail < a.length - head &&
    tail < b.length - head &&
    a[a.length - 1 - tail] === b[b.length - 1 - tail]
  ) {
    tail++;
  }
  const x = a.slice(head, a.length - tail);
  const y = b.slice(head, b.length - tail);

  const ops: Array<['same' | 'del' | 'add', string]> = [];
  if (x.length * y.length <= LCS_CELL_CAP) {
    // Longest-common-subsequence table, filled from the end so the walk
    // below runs forward. min(x, y) <= 2000 under the cell cap, so the
    // LCS value can never overflow Uint16.
    const width = y.length + 1;
    const lcs = new Uint16Array((x.length + 1) * width);
    for (let i = x.length - 1; i >= 0; i--) {
      for (let j = y.length - 1; j >= 0; j--) {
        lcs[i * width + j] =
          x[i] === y[j]
            ? lcs[(i + 1) * width + j + 1] + 1
            : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < x.length && j < y.length) {
      if (x[i] === y[j]) {
        ops.push(['same', x[i]]);
        i++;
        j++;
      } else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) {
        ops.push(['del', x[i++]]);
      } else {
        ops.push(['add', y[j++]]);
      }
    }
    while (i < x.length) ops.push(['del', x[i++]]);
    while (j < y.length) ops.push(['add', y[j++]]);
  } else {
    x.forEach((token) => ops.push(['del', token]));
    y.forEach((token) => ops.push(['add', token]));
  }

  const runs: DiffPart[] = [];
  ops.forEach(([type, token]) => {
    const last = runs[runs.length - 1];
    if (last?.type === type) last.text += token;
    else runs.push({ type, text: token });
  });

  const parts: DiffPart[] = [{ type: 'same', text: a.slice(0, head).join('') }];
  let removed = '';
  let added = '';
  runs.forEach((run) => {
    const stranded = run.type === 'same' && run.text.length <= 2;
    if (run.type === 'del' || stranded) removed += run.text;
    if (run.type === 'add' || stranded) added += run.text;
    if (run.type === 'same' && !stranded) {
      parts.push({ type: 'del', text: removed }, { type: 'add', text: added }, run);
      removed = added = '';
    }
  });
  parts.push(
    { type: 'del', text: removed },
    { type: 'add', text: added },
    { type: 'same', text: b.slice(b.length - tail).join('') },
  );
  return parts.filter((part) => part.text);
}

/**
 * Fold long unchanged runs: keep `DIFF_CONTEXT_CHARS` on the side facing
 * an edit, replace the middle with a single `gap` part (`……`).
 */
export function compactDiffParts(parts: DiffPart[]): DiffPart[] {
  return parts.flatMap((part, index) => {
    if (part.type !== 'same' || part.text.length <= DIFF_CONTEXT_CHARS * 2) return [part];
    const head = index > 0 ? part.text.slice(0, DIFF_CONTEXT_CHARS) : '';
    const tail = index < parts.length - 1 ? part.text.slice(-DIFF_CONTEXT_CHARS) : '';
    const folded: DiffPart[] = [
      { type: 'same', text: head },
      { type: 'gap', text: '……' },
      { type: 'same', text: tail },
    ];
    return folded.filter((item) => item.text);
  });
}

/** Total characters of one kind (`add`/`del`) across the parts. */
export function countDiffChars(parts: DiffPart[], type: 'add' | 'del'): number {
  return parts.reduce((sum, part) => sum + (part.type === type ? part.text.length : 0), 0);
}

/** Full review shape for one change: folded parts plus `+added/−removed`. */
export function wordDiff(
  from: string,
  to: string,
): { parts: DiffPart[]; added: number; removed: number } {
  const parts = compactDiffParts(diffText(from, to));
  return { parts, added: countDiffChars(parts, 'add'), removed: countDiffChars(parts, 'del') };
}
