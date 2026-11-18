/**
 * SillyTavern 正则脚本引擎（clean-room 复刻，非复制源码）。
 *
 * 依据（行号可回溯）：
 *   - `_ref/SillyTavern/public/scripts/extensions/regex/engine.js`
 *       :11-16   SCRIPT_TYPES（执行顺序 GLOBAL → SCOPED → PRESET）
 *       :281-292 regex_placement 全量枚举
 *       :298-302 substitute_find_regex（0/1/2）
 *       :304-324 sanitizeRegexMacro
 *       :334-381 getRegexedString 真值表
 *       :391-447 runRegexScript 替换语义
 *   - `_ref/SillyTavern/public/scripts/utils.js:1387-1402` regexFromString
 *   - `docs/research/formats.md:1105-1194`（既有真值表记录）
 *   - `docs/research/rpnow-st-compat-contract.md` 通道 2 / C2
 *
 * 与 ST 的关键差异：脚本**来源**由调用方按三层顺序提供（本模块不读 store），
 * 宏替换通过 `substituteParams` 回调注入，便于单测与复用现有宏系统。
 */

import type { RPRegexScript } from '../types/card.js';

/** 执行顺序即数值序：GLOBAL(0) → SCOPED(1) → PRESET(2)。 */
export const REGEX_SCRIPT_TYPES = {
  GLOBAL: 0,
  SCOPED: 1,
  PRESET: 2,
} as const;

/** 与 ST `regex_placement` 对齐（4 是废弃的 sendAs）。 */
export const REGEX_PLACEMENT = {
  MD_DISPLAY: 0,
  USER_INPUT: 1,
  AI_OUTPUT: 2,
  SLASH_COMMAND: 3,
  WORLD_INFO: 5,
  REASONING: 6,
} as const;

export const SUBSTITUTE_FIND_REGEX = {
  NONE: 0,
  RAW: 1,
  ESCAPED: 2,
} as const;

/** 宏替换回调（等价 ST `substituteParams`）。 */
export type SubstituteFn = (text: string, options?: { name2Override?: string }) => string;

/**
 * ST `substituteParamsExtended(findRegex, {}, sanitizeRegexMacro)` 的形状。
 * `escape` **只作用于被替换进去的宏值**——不能把整个模式串转义，否则会连
 * `/pattern/` 的分隔符一起毁掉（这正是 `substituteRegex: 2` 的语义）。
 */
export type SubstituteExtendedFn = (
  text: string,
  options?: { name2Override?: string },
  escape?: (value: string) => string,
) => string;

export interface RegexEnv {
  /** 宏/参数替换；缺省时退化为恒等函数（仍保留转义等纯文本行为）。 */
  substituteParams?: SubstituteFn;
  /** `substituteRegex: 2` 使用；未提供时该模式退化为不做元字符转义。 */
  substituteParamsExtended?: SubstituteExtendedFn;
}

export interface GetRegexedOptions {
  characterOverride?: string;
  isMarkdown?: boolean;
  isPrompt?: boolean;
  isEdit?: boolean;
  /** 距聊天末尾的非系统消息数；`undefined` 表示跳过 depth 门控。 */
  depth?: number;
  env?: RegexEnv;
}

/** ST `sanitizeRegexMacro`（engine.js:304-324）：转义宏值里的正则元字符。 */
export function sanitizeRegexMacro(x: unknown): unknown {
  if (!x || typeof x !== 'string') return x;
  return x.replace(/[\n\r\t\v\f\0.^$*+?{}[\]\\/|()]/gs, (s) => {
    switch (s) {
      case '\n': return '\\n';
      case '\r': return '\\r';
      case '\t': return '\\t';
      case '\v': return '\\v';
      case '\f': return '\\f';
      case '\0': return '\\0';
      default: return '\\' + s;
    }
  });
}

/**
 * ST `regexFromString`（utils.js:1387-1402）的等价实现。
 *
 * 与 ST 一致的坑位：
 *  - `/pattern/flags` → 正确拆分；
 *  - 裸 `foo` → 模式 foo、无 flags；
 *  - `/foo/x` → `new RegExp('foo','x')` 抛错 → **返回 null，脚本被静默跳过**；
 *  - flags 含重复字符（`gg`）→ 整个输入当作 pattern。
 */
export function regexFromString(input: string): RegExp | null {
  try {
    const m = input.match(/(\/?)(.+)\1([a-z]*)/i);
    if (!m) return null;
    if (m[3] && !/^(?!.*?(.).*?\1)[gmixXsuUAJ]+$/.test(m[3])) {
      // 非法或重复 flags：把整串当 pattern（与 ST 一致，不抛）
      return new RegExp(input);
    }
    return new RegExp(m[2], m[3]);
  } catch {
    return null;
  }
}

const compiledCache = new Map<string, RegExp | null>();
const CACHE_LIMIT = 1000;

/** 带 LRU 的编译缓存（对齐 ST `RegexProvider`，engine.js:40-90）。 */
function compileCached(regexString: string): RegExp | null {
  const hit = compiledCache.get(regexString);
  if (hit !== undefined) {
    compiledCache.delete(regexString);
    compiledCache.set(regexString, hit);
    return hit;
  }
  const re = regexFromString(regexString);
  if (compiledCache.size >= CACHE_LIMIT) {
    const oldest = compiledCache.keys().next().value as string | undefined;
    if (oldest !== undefined) compiledCache.delete(oldest);
  }
  compiledCache.set(regexString, re);
  return re;
}

/** 清空编译缓存（设置变更/脚本增删时调用）。 */
export function clearRegexCache(): void {
  compiledCache.clear();
}

/**
 * 执行一条正则脚本（ST `runRegexScript`，engine.js:391-447）。
 *
 * 替换串语义：
 *   - `{{match}}` → `$0`；
 *   - `$1`/`$<name>` 取捕获组，未命中该组则整段替换为空串；
 *   - `trimStrings` 从捕获值里剔除；
 *   - 末尾再做一次宏替换（ST 的 `substituteParams(replaceWithGroups)`）。
 */
export function runRegexScript(
  script: RPRegexScript,
  rawString: string,
  { characterOverride, env, forceGlobal }: { characterOverride?: string; env?: RegexEnv; forceGlobal?: boolean } = {},
): string {
  if (!script || script.disabled || !script.findRegex || !rawString) return rawString;

  let regexString = script.findRegex;
  const mode = Number(script.substituteRegex ?? 0);
  if (mode === SUBSTITUTE_FIND_REGEX.RAW && env?.substituteParams) {
    regexString = env.substituteParams(regexString);
  } else if (mode === SUBSTITUTE_FIND_REGEX.ESCAPED && env?.substituteParamsExtended) {
    // ST：substituteParamsExtended(findRegex, {}, sanitizeRegexMacro)
    regexString = env.substituteParamsExtended(regexString, {}, (v) => sanitizeRegexMacro(v) as string);
  } else if (mode === SUBSTITUTE_FIND_REGEX.ESCAPED && env?.substituteParams) {
    // 无 Extended 实现时退化为普通宏展开（不做元字符转义）——比把整个模式串
    // 转义掉分隔符更接近可用。
    regexString = env.substituteParams(regexString);
  }

  let findRegex = compileCached(regexString);
  if (!findRegex) return rawString;
  /*
   * ST keeps whatever flags the script declared (a bare pattern has none, so
   * `replace` hits only the first match). RPNow's card-script entry point
   * historically forced a global replace; opt in explicitly there.
   */
  if (forceGlobal && !/[gy]/.test(findRegex.flags)) {
    findRegex = new RegExp(findRegex.source, `${findRegex.flags}g`);
  }

  const substitute = env?.substituteParams;
  const trim = script.trimStrings ?? [];

  const out = rawString.replace(findRegex, function (_match: string) {
    const args = Array.from(arguments) as unknown[];
    // 末位是 groups（命名捕获）；未命名时为 undefined。
    const groups = args.length > 0 ? args[args.length - 1] : undefined;

    let replaceWith = (script.replaceString ?? '').replace(/{{match}}/gi, '$0');
    replaceWith = replaceWith.replace(/\$(\d+)|\$<([^>]+)>/g, (_m, num, groupName) => {
      let value: unknown;
      if (num) {
        value = args[Number(num)];
      } else if (groupName) {
        value = groups && typeof groups === 'object'
          ? (groups as Record<string, unknown>)[groupName]
          : undefined;
      }
      if (value === undefined || value === null || value === '') return '';
      let filtered = String(value);
      for (const t of trim) {
        const sub = substitute ? substitute(String(t), { name2Override: characterOverride }) : String(t);
        filtered = filtered.split(sub).join('');
      }
      return filtered;
    });

    return substitute ? substitute(replaceWith) : replaceWith;
  });

  return out;
}

/**
 * ST `getRegexedString`（engine.js:334-381）的真值表实现。
 *
 * `scripts` 必须已由调用方按 **GLOBAL → SCOPED → PRESET** 顺序拼接（可用
 * {@link orderRegexScripts}）。trust gate 由调用方在装配阶段过滤。
 */
export function getRegexedString(
  rawString: string,
  placement: number,
  options: GetRegexedOptions = {},
  scripts: RPRegexScript[] = [],
): string {
  if (typeof rawString !== 'string' || !rawString || !scripts.length) return rawString;
  if (!Number.isFinite(placement)) return rawString;

  const { characterOverride, isMarkdown, isPrompt, isEdit, depth, env } = options;
  let finalString = rawString;

  for (const script of scripts) {
    if (
      (script.markdownOnly && isMarkdown) ||
      (script.promptOnly && isPrompt) ||
      (!script.markdownOnly && !script.promptOnly && !isMarkdown && !isPrompt)
    ) {
      if (isEdit && !script.runOnEdit) continue;

      if (typeof depth === 'number' && Number.isFinite(depth)) {
        const min = script.minDepth;
        const max = script.maxDepth;
        // ST：`!isNaN(x) && x !== null && x >= -1`；undefined 同样落到「不跳过」。
        if (typeof min === 'number' && !Number.isNaN(min) && min >= -1 && depth < min) continue;
        if (typeof max === 'number' && !Number.isNaN(max) && max >= 0 && depth > max) continue;
      }

      if (!(script.placement ?? []).includes(placement)) continue;
      finalString = runRegexScript(script, finalString, { characterOverride, env });
    }
  }

  return finalString;
}

/**
 * 按 ST 的三层顺序装配脚本：GLOBAL → SCOPED → PRESET。
 *
 * `Object.values({GLOBAL:0,PRESET:2,SCOPED:1}).flatMap(...)` 的数值序即 0,1,2。
 */
export function orderRegexScripts(byType: Partial<Record<number, RPRegexScript[]>>): RPRegexScript[] {
  const ordered: RPRegexScript[] = [];
  const types = [REGEX_SCRIPT_TYPES.GLOBAL, REGEX_SCRIPT_TYPES.SCOPED, REGEX_SCRIPT_TYPES.PRESET];
  for (const t of types) ordered.push(...(byType[t] ?? []));
  return ordered;
}
