/**
 * "智能修改" — the numbered card diff.
 *
 * The model edits a card by calling `edit_character_card` with numbered
 * references (`1..7` for text fields, `W1…`/`W+` for world-info entries,
 * `R1…`/`R+` for regex scripts). Keeping the references numbered means the
 * model never has to echo whole entries, and the UI can show a word-level diff
 * per change before anything is applied.
 *
 * Validation here mirrors RP-Hub's: truncated output, missing calls, malformed
 * JSON, duplicate ids and unknown ids are all rejected with specific messages.
 */

import type { RPCard } from '../types/card.js';
import { uid } from '../../lib/utils.js';

export const EDIT_TEXT_FIELDS = [
  'name',
  'description',
  'personality',
  'first_mes',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
] as const;

export const EDIT_FIELD_LABELS = [
  '角色卡名称',
  '简短描述',
  '设定',
  '开场白',
  '作者注释',
  '系统提示',
  '后续指令',
] as const;

export interface DiffField {
  id: string;
  text: string;
}

export interface DiffWorldInfo {
  id: string;
  delete?: boolean;
  comment?: string;
  keys?: string;
  content?: string;
  position?: string;
  constant?: boolean;
  enabled?: boolean;
}

export interface DiffRegex {
  id: string;
  delete?: boolean;
  name?: string;
  regex?: string;
  flags?: string;
  replacement?: string;
  placement?: number;
  enabled?: boolean;
  markdownOnly?: boolean;
  promptOnly?: boolean;
}

export interface CardDiff {
  fields: DiffField[];
  worldInfo: DiffWorldInfo[];
  regex: DiffRegex[];
}

export interface DiffError {
  message: string;
}

const ID_RE = /^(?:[1-7]|W\+?[0-9]*|R\+?[0-9]*|W\+|R\+)$/;

/** Parse and validate the `edit_character_card` payload. */
export function parseCardDiff(raw: unknown): { diff?: CardDiff; error?: string } {
  if (!raw || typeof raw !== 'object') return { error: '修改工具参数格式错误，请重试' };
  const obj = raw as Record<string, unknown>;
  const fields = Array.isArray(obj.fields) ? obj.fields : null;
  const worldInfo = Array.isArray(obj.world_info) ? obj.world_info : null;
  const regex = Array.isArray(obj.regex_scripts) ? obj.regex_scripts : null;
  if (!fields && !worldInfo && !regex) return { error: '修改工具参数格式错误，请重试' };

  const seen = new Set<string>();
  const checkId = (id: unknown, label: string): string | null => {
    const key = String(id ?? '');
    if (!key) return `${label}缺少编号`;
    if (seen.has(key)) return `编号 ${key} 被重复提交，请合并后重试`;
    seen.add(key);
    return null;
  };

  const diff: CardDiff = { fields: [], worldInfo: [], regex: [] };

  for (const item of fields ?? []) {
    const f = item as Record<string, unknown>;
    const err = checkId(f.id, '文本字段');
    if (err) return { error: err };
    const num = Number(f.id);
    if (!Number.isInteger(num) || num < 1 || num > 7) return { error: `文本字段编号 ${f.id} 不存在，请重试` };
    diff.fields.push({ id: String(f.id), text: String(f.text ?? '') });
  }
  for (const item of worldInfo ?? []) {
    const w = item as Record<string, unknown>;
    const err = checkId(w.id, '世界书');
    if (err) return { error: err };
    diff.worldInfo.push({
      id: String(w.id),
      delete: w.delete === true,
      comment: w.comment === undefined ? undefined : String(w.comment),
      keys: w.keys === undefined ? undefined : String(w.keys),
      content: w.content === undefined ? undefined : String(w.content),
      position: w.position === undefined ? undefined : String(w.position),
      constant: w.constant as boolean | undefined,
      enabled: w.enabled as boolean | undefined,
    });
  }
  for (const item of regex ?? []) {
    const r = item as Record<string, unknown>;
    const err = checkId(r.id, '正则');
    if (err) return { error: err };
    diff.regex.push({
      id: String(r.id),
      delete: r.delete === true,
      name: r.name === undefined ? undefined : String(r.name),
      regex: r.regex === undefined ? undefined : String(r.regex),
      flags: r.flags === undefined ? undefined : String(r.flags),
      replacement: r.replacement === undefined ? undefined : String(r.replacement),
      placement: r.placement === undefined ? undefined : Number(r.placement),
      enabled: r.enabled as boolean | undefined,
      markdownOnly: r.markdownOnly as boolean | undefined,
      promptOnly: r.promptOnly as boolean | undefined,
    });
  }

  return { diff };
}

export interface Change {
  label: string;
  original: string;
  modified: string;
  /** Which group this change belongs to (drives mono rendering + preview). */
  kind: 'field' | 'worldInfo' | 'regex';
  /** Text-field key, set only when kind is 'field' (e.g. 'first_mes'). */
  field?: (typeof EDIT_TEXT_FIELDS)[number];
}

/** Finish reasons that mean the model output was cut off mid-way (P06). */
export function isTruncatedFinishReason(reason: string | undefined): boolean {
  // OpenAI/Gemini report 'length'; Anthropic reports the same cutoff as
  // 'max_tokens' and the adapter passes it through verbatim.
  return reason === 'length' || reason === 'max_tokens';
}

/**
 * Snapshot of everything `apply` would overwrite (P08).
 *
 * The editor's live `data` is what the diff draft replaces, and `savedData`
 * is the stored card the editor was opened from. Both are captured at
 * generate time; if either moved before apply, the diff is stale and must
 * be regenerated. `JSON.stringify` is deterministic here because both
 * snapshots come from the same object lineage (no key reordering in
 * between), and `updatedAt`/`favorite` are deliberately excluded — they
 * change without the editable content changing.
 */
export function snapshotCardForEdit(live: RPCard, saved: RPCard | null): string {
  return JSON.stringify({ data: live.data ?? {}, savedData: saved?.data ?? null });
}

/** Compute the changes a diff would make, for the confirmation UI. */
export function diffCard(card: RPCard, diff: CardDiff): { card: RPCard; changes: Change[] } {
  const next: RPCard = JSON.parse(JSON.stringify(card));
  const changes: Change[] = [];

  for (const field of diff.fields) {
    const key = EDIT_TEXT_FIELDS[Number(field.id) - 1];
    if (!key) continue;
    const original = String((next.data as unknown as Record<string, unknown>)[key] ?? '');
    if (original === field.text) continue;
    (next.data as unknown as Record<string, unknown>)[key] = field.text;
    changes.push({ label: EDIT_FIELD_LABELS[Number(field.id) - 1], original, modified: field.text, kind: 'field', field: key });
  }

  const entries = next.data.character_book?.entries ?? [];
  for (const w of diff.worldInfo) {
    if (w.id === 'W+') {
      if (w.delete) continue;
      entries.push({
        id: uid('we'),
        comment: String(w.comment ?? '新条目'),
        content: String(w.content ?? ''),
        enabled: w.enabled ?? true,
        position: 2,
        order: (entries.length + 1) * 10,
        depth: 4,
        keys: (w.keys ?? '').split(',').map((k) => k.trim()).filter(Boolean),
        constant: w.constant ?? false,
        useRegex: false,
        probability: 100,
      } as never);
      changes.push({ label: '世界书新增', original: '', modified: String(w.content ?? ''), kind: 'worldInfo' });
      continue;
    }
    const index = /^W(\d+)$/.exec(w.id)?.[1];
    const at = index ? Number(index) - 1 : -1;
    if (at < 0 || at >= entries.length) continue;
    const target = entries[at] as unknown as Record<string, unknown>;
    if (w.delete) {
      changes.push({ label: `世界书删除：${String(target.comment)}`, original: String(target.content ?? ''), modified: '', kind: 'worldInfo' });
      entries.splice(at, 1);
      continue;
    }
    if (w.comment !== undefined) {
      changes.push({ label: `世界书名：${String(target.comment)}`, original: String(target.comment), modified: w.comment, kind: 'worldInfo' });
      target.comment = w.comment;
      target.name = w.comment;
    }
    if (w.content !== undefined) {
      changes.push({ label: `世界书内容：${String(target.comment)}`, original: String(target.content ?? ''), modified: w.content, kind: 'worldInfo' });
      target.content = w.content;
    }
    if (w.keys !== undefined) {
      target.keys = w.keys.split(',').map((k) => k.trim()).filter(Boolean);
    }
    if (w.enabled !== undefined) target.enabled = w.enabled;
    if (w.constant !== undefined) target.constant = w.constant;
    if (w.position !== undefined) {
      const map: Record<string, number> = {
        before_char: 0,
        after_char: 1,
        at_depth: 2,
        system_top: 3,
        global_note: 4,
        user_top: 5,
        assistant_top: 6,
      };
      target.position = map[w.position] ?? Number(w.position) ?? 2;
    }
  }

  const scripts = (next.data.extensions?.regex_scripts as Array<Record<string, unknown>> | undefined) ?? [];
  for (const r of diff.regex) {
    if (r.id === 'R+') {
      if (r.delete) continue;
      scripts.push({
        scriptName: String(r.name ?? '新脚本'),
        findRegex: String(r.regex ?? ''),
        replaceString: String(r.replacement ?? ''),
        placement: Number(r.placement) === 2 ? 2 : 1,
        markdownOnly: r.markdownOnly === true,
        promptOnly: r.promptOnly === true,
        enabled: r.enabled ?? true,
      });
      changes.push({ label: '正则新增', original: '', modified: String(r.regex ?? ''), kind: 'regex' });
      continue;
    }
    const index = /^R(\d+)$/.exec(r.id)?.[1];
    const at = index ? Number(index) - 1 : -1;
    if (at < 0 || at >= scripts.length) continue;
    const target = scripts[at];
    if (r.delete) {
      changes.push({ label: `正则删除：${String(target.scriptName)}`, original: String(target.findRegex ?? ''), modified: '', kind: 'regex' });
      scripts.splice(at, 1);
      continue;
    }
    if (r.name !== undefined) {
      changes.push({ label: `正则名：${String(target.scriptName)}`, original: String(target.scriptName), modified: r.name, kind: 'regex' });
      target.scriptName = r.name;
    }
    if (r.regex !== undefined) {
      changes.push({ label: `正则：${String(target.scriptName)}`, original: String(target.findRegex ?? ''), modified: r.regex, kind: 'regex' });
      target.findRegex = r.regex;
    }
    if (r.replacement !== undefined) target.replaceString = r.replacement;
    if (r.placement !== undefined) target.placement = Number(r.placement) === 2 ? 2 : 1;
    if (r.enabled !== undefined) target.enabled = r.enabled;
    if (r.markdownOnly !== undefined) target.markdownOnly = r.markdownOnly;
    if (r.promptOnly !== undefined) target.promptOnly = r.promptOnly;
  }

  if (scripts.length) next.data.extensions = { ...next.data.extensions, regex_scripts: scripts };
  if (entries.length) {
    next.data.character_book = { ...(next.data.character_book ?? { name: '世界书' }), entries };
  }

  next.updatedAt = Date.now();
  return { card: next, changes };
}

/** Numbered snapshot of a card, used as the model's edit context. */
export function describeCardForEdit(card: RPCard): string {
  const lines: string[] = [];
  EDIT_TEXT_FIELDS.forEach((key, i) => {
    const value = String((card.data as unknown as Record<string, unknown>)[key] ?? '');
    lines.push(`${i + 1}. ${EDIT_FIELD_LABELS[i]}：\n${value || '（空）'}`);
  });

  const entries = card.data.character_book?.entries ?? [];
  lines.push(`\n世界书（共 ${entries.length} 条）：`);
  entries.forEach((e, i) => {
    lines.push(
      `W${i + 1}. comment=${e.comment} keys=${(e.keys ?? []).join('|')} content=${String(e.content).slice(0, 120)}`,
    );
  });

  const scripts = (card.data.extensions?.regex_scripts as Array<Record<string, unknown>> | undefined) ?? [];
  lines.push(`\n正则（共 ${scripts.length} 条）：`);
  scripts.forEach((s, i) => {
    lines.push(`R${i + 1}. name=${String(s.scriptName)} regex=${String(s.findRegex)}`);
  });

  return lines.join('\n');
}

export const EDIT_CARD_TOOL = {
  type: 'function',
  function: {
    name: 'edit_character_card',
    description: '按编号修改角色卡。文本字段用 1..7，世界书用 W1…（新增 W+），正则用 R1…（新增 R+）。',
    parameters: {
      type: 'object',
      properties: {
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, text: { type: 'string' } },
            required: ['id', 'text'],
          },
        },
        world_info: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              delete: { type: 'boolean' },
              comment: { type: 'string' },
              keys: { type: 'string' },
              content: { type: 'string' },
              position: { type: 'string' },
              constant: { type: 'boolean' },
              enabled: { type: 'boolean' },
            },
            required: ['id'],
          },
        },
        regex_scripts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              delete: { type: 'boolean' },
              name: { type: 'string' },
              regex: { type: 'string' },
              flags: { type: 'string' },
              replacement: { type: 'string' },
              placement: { type: 'number' },
              enabled: { type: 'boolean' },
              markdownOnly: { type: 'boolean' },
              promptOnly: { type: 'boolean' },
            },
            required: ['id'],
          },
        },
      },
    },
  },
} as const;

export { ID_RE };
