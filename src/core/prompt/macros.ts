/**
 * Macro / placeholder substitution.
 *
 * Macro semantics follow the de-facto standard set used by SillyTavern, because
 * imported cards and presets are written against it. Unknown macros are left
 * verbatim (never blanked) so a user can see what a card expected.
 *
 * Substitution is done in ordered phases:
 *   phase 1 — definitions & identity (`{{char}}`, `{{user}}`, `{{description}}`…)
 *   phase 2 — chat-derived (`{{lastMessage}}`, `{{input}}`, `{{idle_duration}}`…)
 *   phase 3 — functional (`{{random}}`, `{{pick}}`, `{{roll}}`, `{{getvar}}`…)
 *   phase 4 — legacy angle-bracket forms (`<USER>`, `<BOT>`)
 *   phase 5 — trim/noop/comment cleanup
 */

export interface MacroContext {
  char: string;
  user: string;
  /** Character's own name inside group chats. */
  charIfNotGroup: string;
  group?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  persona?: string;
  /** `mes_example` body with `<START>` separators already normalised. */
  mesExamples?: string;
  /** The preset/persona text the character's `system_prompt` overrides. */
  original?: string;
  /** Model name for `{{model}}`. */
  model?: string;
  /** Last user input, for `{{input}}`. */
  input?: string;
  lastMessage?: string;
  lastUserMessage?: string;
  lastCharMessage?: string;
  /** Milliseconds since the previous assistant message. */
  idleDuration?: () => string;
  /** Chat/global variables. */
  getvar?: (name: string) => string | undefined;
  setvar?: (name: string, value: string) => void;
  /** `{{outlet::Name}}` resolver — injected world book outlet content. */
  outlet?: (name: string) => string;
  /** `{{time}}`/`{{date}}` formatting overrides. */
  now?: Date;
  /** Seed for deterministic `{{random}}`/`{{pick}}` inside one render. */
  seed?: number;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
function fmtDate(d: Date): string {
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Split `a::b::c` on the double-colon separator, respecting nothing exotic. */
function splitArgs(raw: string): string[] {
  return raw.split('::');
}

/** Roll dice in `NdM(+K)` notation. */
function rollDice(expr: string): string {
  const m = /^\s*(\d*)d(\d+)\s*(?:([+-])\s*(\d+))?\s*$/i.exec(expr);
  if (!m) {
    const flat = Number(expr);
    return Number.isFinite(flat) ? String(Math.trunc(flat)) : expr;
  }
  const count = Math.min(Math.max(parseInt(m[1] || '1', 10), 1), 100);
  const sides = Math.min(Math.max(parseInt(m[2], 10), 1), 100000);
  let total = 0;
  for (let i = 0; i < count; i++) total += Math.floor(Math.random() * sides) + 1;
  if (m[3] === '+') total += Number(m[4]);
  if (m[3] === '-') total -= Number(m[4]);
  return String(total);
}

/**
 * `{{charIfNotGroup}}` resolves like `{{group}}` (ST's new engine makes it a
 * hidden alias of `group`, and the legacy engine mapped both to `env.group`).
 * In a solo chat `group` is the character's name; in a group it is the member
 * list. We therefore fill it from `group` when set, otherwise from the char
 * name — and do NOT implement the "empty in groups" reading that the public
 * docs describe, because the source does not do that.
 */
const charIfNotGroup = (ctx: MacroContext): string => ctx.group || ctx.char;

const DEFINITION_MACROS = new Set([
  'char',
  'user',
  'description',
  'personality',
  'scenario',
  'persona',
  'mesExamples',
  'original',
  'charIfNotGroup',
  'group',
]);/**
 * Core substitution. `text` may be a template containing any supported macro.
 */
export function substituteMacros(input: string, ctx: MacroContext): string {
  if (!input) return '';
  let text = input;

  // ------------------------------------------------------- phase 1: identity
  const defs: Record<string, string> = {
    char: ctx.char,
    user: ctx.user,
    description: ctx.description ?? '',
    personality: ctx.personality ?? '',
    scenario: ctx.scenario ?? '',
    persona: ctx.persona ?? '',
    mesExamples: ctx.mesExamples ?? '',
    original: ctx.original ?? '',
    charIfNotGroup: charIfNotGroup(ctx),
    group: ctx.group || ctx.char,
  };
  // Longest-first so `{{charIfNotGroup}}` is not eaten by `{{char}}`.
  // Names are matched case-insensitively and tolerate surrounding spaces
  // (`{{ User }}`), matching RP-Hub's macro syntax.
  const defKeys = Object.keys(defs).sort((a, b) => b.length - a.length);
  for (const key of defKeys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'gi');
    text = text.replace(re, defs[key]);
  }

  // ---------------------------------------------------- phase 2: chat-derived
  text = text.replace(/\{\{\s*lastMessage\s*\}\}/gi, ctx.lastMessage ?? '');
  text = text.replace(/\{\{\s*lastUserMessage\s*\}\}/gi, ctx.lastUserMessage ?? '');
  text = text.replace(/\{\{\s*lastCharMessage\s*\}\}/gi, ctx.lastCharMessage ?? '');
  text = text.replace(/\{\{\s*input\s*\}\}/gi, ctx.input ?? '');

  // ------------------------------------------------------- phase 3: functional
  // Random literal: {{random::a::b}} or {{random:a,b}}
  text = text.replace(/\{\{random(?:::|:)([^}]*)\}\}/g, (_m, raw: string) => {
    const opts = raw.includes('::') ? splitArgs(raw) : raw.split(',');
    if (!opts.length) return '';
    return opts[Math.floor(Math.random() * opts.length)] ?? '';
  });

  // Deterministic pick per session: {{pick::a::b}}
  text = text.replace(/\{\{pick(?:::|:)([^}]*)\}\}/g, (_m, raw: string) => {
    const opts = raw.includes('::') ? splitArgs(raw) : raw.split(',');
    if (!opts.length) return '';
    const idx = hash(`${ctx.seed ?? 0}|${raw}`) % opts.length;
    return opts[idx] ?? '';
  });

  // Dice: {{roll:1d20}}
  text = text.replace(/\{\{roll(?:::|:)([^}]*)\}\}/g, (_m, raw: string) => rollDice(raw));

  // Time & date
  const now = ctx.now ?? new Date();
  text = text.replace(/\{\{time\}\}/g, fmtTime(now));
  text = text.replace(/\{\{date\}\}/g, fmtDate(now));
  text = text.replace(/\{\{datetime\}\}/g, `${fmtDate(now)} ${fmtTime(now)}`);
  text = text
    .replace(/\{\{weekday\}\}/g, now.toLocaleDateString('zh-CN', { weekday: 'long' }))
    .replace(/\{\{isotime\}\}/g, now.toISOString().slice(11, 19))
    .replace(/\{\{isodate\}\}/g, now.toISOString().slice(0, 10));

  if (ctx.idleDuration) {
    text = text.replace(/\{\{idle_duration\}\}/g, () => ctx.idleDuration!());
  }
  text = text.replace(/\{\{model\}\}/g, ctx.model ?? '');

  // Variables. `{{getvar::name}}` is a simple lookup.
  text = text.replace(/\{\{getvar::([^}]*)\}\}/g, (_m, name: string) => ctx.getvar?.(name) ?? '');
  text = text.replace(/\{\{getglobalvar::([^}]*)\}\}/g, (_m, name: string) =>
    ctx.getvar?.(`global.${name}`) ?? '',
  );
  // `{{setvar::name::value}}` — the separator is the `::` pair, so both the
  // name and value patterns must exclude `}` only. Excluding `:` from the name
  // (or a lazy value) leaves the second colon inside the captured value.
  text = text.replace(/\{\{setvar::([^}]*?)::([^}]*)\}\}/g, (_m, name: string, value: string) => {
    ctx.setvar?.(name, value);
    return '';
  });
  text = text.replace(/\{\{addvar::([^}]*?)::([^}]*)\}\}/g, (_m, name: string, value: string) => {
    const cur = Number(ctx.getvar?.(name) ?? 0);
    ctx.setvar?.(name, String(cur + Number(value)));
    return '';
  });
  text = text.replace(/\{\{incvar::([^}]*)\}\}/g, (_m, name: string) => {
    const cur = Number(ctx.getvar?.(name) ?? 0);
    ctx.setvar?.(name, String(cur + 1));
    return '';
  });

  // Outlets: {{outlet::Name}}
  text = text.replace(/\{\{outlet::([^}]*)\}\}/g, (_m, name: string) => ctx.outlet?.(name) ?? '');

  // ------------------------------------------------------ phase 4: legacy forms
  text = text.replace(/<USER>/g, ctx.user).replace(/<BOT>/g, ctx.char);

  // ----------------------------------------------------------- phase 5: cleanup
  text = text.replace(/\{\{noop\}\}/gi, '').replace(/\{\{newline\}\}/gi, '\n');
  // Comments: {{// anything }}
  text = text.replace(/\{\{\/\/[^}]*\}\}/g, '');
  // Trim markers apply at the end of the *whole* string.
  if (/\{\{trim\}\}/i.test(text)) {
    const trimLeft = /\{\{trim\/\}\}/i.test(text) || /\{\{trim\}\}/i.test(text);
    const trimRight = /\{\{\/trim\}\}/i.test(text) || /\{\{trim\}\}/i.test(text);
    text = text.replace(/\{\{(trim|\/trim|trim\/)\}\}/gi, '');
    if (trimLeft) text = text.trimStart();
    if (trimRight) text = text.trimEnd();
  }
  return text;
}

/** Macros that must be resolved only at final assembly (they expand to macros). */
export const LATE_MACROS = ['original', 'mesExamples'] as const;

/** Human-readable catalog for the macro reference UI. */
export const MACRO_REFERENCE: Array<{ macro: string; description: string; example?: string }> = [
  { macro: '{{char}}', description: '当前角色名' },
  { macro: '{{user}}', description: '你的名字（用户身份）' },
  { macro: '{{description}}', description: '角色描述全文' },
  { macro: '{{personality}}', description: '角色性格' },
  { macro: '{{scenario}}', description: '场景设定' },
  { macro: '{{persona}}', description: '用户身份的自我描述' },
  { macro: '{{mesExamples}}', description: '对话示例（含 <START> 分隔）' },
  { macro: '{{original}}', description: '被角色卡覆盖前的预设原文', example: '用于 system_prompt 内引用主提示' },
  { macro: '{{charIfNotGroup}}', description: '在群聊中为空，单聊中为角色名' },
  { macro: '{{group}}', description: '群聊成员名单' },
  { macro: '{{input}}', description: '本次用户输入' },
  { macro: '{{lastMessage}}', description: '上一条消息内容' },
  { macro: '{{lastUserMessage}}', description: '上一条用户消息' },
  { macro: '{{lastCharMessage}}', description: '上一条角色消息' },
  { macro: '{{random::a::b::c}}', description: '随机选一个', example: '{{random::白天::夜晚}}' },
  { macro: '{{pick::a::b}}', description: '本会话内固定选择', example: '{{pick::红::蓝}}' },
  { macro: '{{roll:1d20}}', description: '掷骰', example: '{{roll:2d6+3}}' },
  { macro: '{{time}}', description: '当前时间 HH:mm' },
  { macro: '{{date}}', description: '当前日期' },
  { macro: '{{weekday}}', description: '星期几' },
  { macro: '{{idle_duration}}', description: '距上次回复过去多久' },
  { macro: '{{model}}', description: '当前模型名' },
  { macro: '{{getvar::name}}', description: '读取聊天变量' },
  { macro: '{{setvar::name::value}}', description: '写入聊天变量（输出为空）' },
  { macro: '{{addvar::name::n}}', description: '变量数值累加' },
  { macro: '{{incvar::name}}', description: '变量自增' },
  { macro: '{{outlet::Name}}', description: '插入世界书"出口"条目内容' },
  { macro: '{{newline}}', description: '换行符' },
  { macro: '{{noop}}', description: '空操作（用于清空占位）' },
  { macro: '{{// 注释 }}', description: '注释，渲染时移除' },
  { macro: '{{trim}}', description: '去除最终文本首尾空白' },
];

/** True if the string contains any `{{...}}` construct. */
export function hasMacros(text: string): boolean {
  return /\{\{[^}]*\}\}/.test(text);
}

export { DEFINITION_MACROS };
