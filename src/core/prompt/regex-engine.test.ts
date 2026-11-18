import { describe, expect, it } from 'vitest';
import {
  clearRegexCache,
  getRegexedString,
  orderRegexScripts,
  REGEX_PLACEMENT,
  REGEX_SCRIPT_TYPES,
  regexFromString,
  runRegexScript,
} from './regex-engine.js';
import type { RPRegexScript } from '../types/card.js';

/** 构造一条脚本，未指定的字段取安全默认。 */
function script(patch: Partial<RPRegexScript>): RPRegexScript {
  return {
    id: patch.id ?? 's',
    scriptName: patch.scriptName ?? 's',
    findRegex: patch.findRegex ?? '/a/g',
    replaceString: patch.replaceString ?? 'b',
    placement: patch.placement ?? [REGEX_PLACEMENT.AI_OUTPUT],
    disabled: patch.disabled ?? false,
    markdownOnly: patch.markdownOnly ?? false,
    promptOnly: patch.promptOnly ?? false,
    ...patch,
  };
}

describe('regexFromString', () => {
  it('解析 /pattern/flags', () => {
    const re = regexFromString('/foo/gi')!;
    expect(re.source).toBe('foo');
    expect(re.flags).toContain('g');
    expect(re.flags).toContain('i');
  });

  it('裸模式无 flags', () => {
    expect(regexFromString('foo')!.source).toBe('foo');
  });

  it('非法 flag 静默跳过（返回 null）', () => {
    // ST：new RegExp('foo','x') 抛错 → catch → undefined → 脚本被跳过
    expect(regexFromString('/foo/x')).toBeNull();
  });

  it('重复 flag 把整串当模式', () => {
    // RegExp.source 会把字面斜杠转义显示，断言语义而非源码串。
    const re = regexFromString('/foo/gg')!;
    expect(re.test('/foo/gg')).toBe(true);
  });
});

describe('getRegexedString 真值表（对齐 engine.js:347-355）', () => {
  it('markdownOnly 仅在 isMarkdown 时生效', () => {
    const s = script({ markdownOnly: true });
    expect(getRegexedString('aaa', 2, { isMarkdown: true }, [s])).toBe('bbb');
    expect(getRegexedString('aaa', 2, {}, [s])).toBe('aaa');
    expect(getRegexedString('aaa', 2, { isPrompt: true }, [s])).toBe('aaa');
  });

  it('promptOnly 仅在 isPrompt 时生效', () => {
    const s = script({ promptOnly: true });
    expect(getRegexedString('aaa', 2, { isPrompt: true }, [s])).toBe('bbb');
    expect(getRegexedString('aaa', 2, { isMarkdown: true }, [s])).toBe('aaa');
    expect(getRegexedString('aaa', 2, {}, [s])).toBe('aaa');
  });

  it('默认（两者皆 false）只在非 markdown 非 prompt 时生效', () => {
    const s = script({});
    expect(getRegexedString('aaa', 2, {}, [s])).toBe('bbb');
    expect(getRegexedString('aaa', 2, { isMarkdown: true }, [s])).toBe('aaa');
  });

  it('双标记不是「死组合」——按源码真值表两条通道都会命中', () => {
    // ⚠️ 旧笔记 docs/research/formats.md:1178 记为 "both-flags is a dead
    // combination"，但 engine.js:347-355 的判据是
    //   (markdownOnly && isMarkdown) || (promptOnly && isPrompt) || (...)
    // 因此 markdownOnly=true 且 promptOnly=true 时，只要 isMarkdown 或
    // isPrompt 任一为真就会执行。以源码为准。
    const s = script({ markdownOnly: true, promptOnly: true });
    expect(getRegexedString('aaa', 2, { isMarkdown: true }, [s])).toBe('bbb');
    expect(getRegexedString('aaa', 2, { isPrompt: true }, [s])).toBe('bbb');
  });

  it('placement 必须匹配', () => {
    const s = script({ placement: [REGEX_PLACEMENT.USER_INPUT] });
    expect(getRegexedString('aaa', REGEX_PLACEMENT.USER_INPUT, {}, [s])).toBe('bbb');
    expect(getRegexedString('aaa', REGEX_PLACEMENT.AI_OUTPUT, {}, [s])).toBe('aaa');
  });
});

describe('getRegexedString 门控', () => {
  const s = script({ minDepth: 1, maxDepth: 2 });

  it('depth 在区间外跳过、区间内执行', () => {
    expect(getRegexedString('aaa', 2, { depth: 0 }, [s])).toBe('aaa'); // 0 < 1
    expect(getRegexedString('aaa', 2, { depth: 1 }, [s])).toBe('bbb');
    expect(getRegexedString('aaa', 2, { depth: 2 }, [s])).toBe('bbb');
    expect(getRegexedString('aaa', 2, { depth: 3 }, [s])).toBe('aaa'); // 3 > 2
  });

  it('depth 为 undefined 时跳过门控（流式预览 -1 场景）', () => {
    expect(getRegexedString('aaa', 2, { depth: undefined }, [s])).toBe('bbb');
  });

  it('isEdit 且未开 runOnEdit 时跳过', () => {
    const noEdit = script({ runOnEdit: false });
    const withEdit = script({ runOnEdit: true });
    expect(getRegexedString('aaa', 2, { isEdit: true }, [noEdit])).toBe('aaa');
    expect(getRegexedString('aaa', 2, { isEdit: true }, [withEdit])).toBe('bbb');
  });

  it('disabled 与坏正则不会抛错', () => {
    expect(getRegexedString('aaa', 2, {}, [script({ disabled: true })])).toBe('aaa');
    expect(getRegexedString('aaa', 2, {}, [script({ findRegex: '/a/x' })])).toBe('aaa');
  });
});

describe('runRegexScript 替换语义', () => {
  it('{{match}} 等价 $0', () => {
    const out = runRegexScript(script({ findRegex: '/(\\d+)/g', replaceString: '[{{match}}]' }), 'a1b22');
    expect(out).toBe('a[1]b[22]');
  });

  it('命名捕获 $<name>', () => {
    const out = runRegexScript(
      script({ findRegex: '/(?<word>\\w+)/g', replaceString: '[$<word>]' }),
      'a b',
    );
    expect(out).toBe('[a] [b]');
  });

  it('缺失的捕获组替换为空串', () => {
    const out = runRegexScript(
      script({ findRegex: '/(a)|(z)/g', replaceString: '<$1|$2>' }),
      'az',
    );
    expect(out).toBe('<a|><|z>');
  });

  it('编号捕获与 trimStrings', () => {
    const out = runRegexScript(
      script({ findRegex: '/```\\n([\\s\\S]*?)\\n```/g', replaceString: '$1', trimStrings: ['```'] }),
      '```\nhello\n```',
    );
    expect(out).toBe('hello');
  });

  it('substituteRegex=2 只转义宏值（escape 不碰分隔符）', () => {
    const env = {
      substituteParams: (text: string) => text.replaceAll('{{x}}', 'a.b*c'),
      // ST：substituteParamsExtended(findRegex, {}, sanitizeRegexMacro)
      // escape 只作用于宏值，模式串的 `/…/` 分隔符保持原样。
      substituteParamsExtended: (
        text: string,
        _opts: { name2Override?: string } | undefined,
        escape: ((value: string) => string) | undefined,
      ) => text.replaceAll('{{x}}', escape ? escape('a.b*c') : 'a.b*c'),
    };
    const out = runRegexScript(
      script({ findRegex: '/{{x}}/g', replaceString: 'Z', substituteRegex: 2 }),
      'a.b*c|q',
      { env },
    );
    expect(out).toBe('Z|q');
    clearRegexCache();
  });
});

describe('orderRegexScripts', () => {
  it('按 GLOBAL → SCOPED → PRESET 数值序', () => {
    const g = script({ id: 'g' });
    const sc = script({ id: 's' });
    const p = script({ id: 'p' });
    expect(orderRegexScripts({ [REGEX_SCRIPT_TYPES.PRESET]: [p], [REGEX_SCRIPT_TYPES.SCOPED]: [sc], [REGEX_SCRIPT_TYPES.GLOBAL]: [g] }).map((s) => s.id)).toEqual(['g', 's', 'p']);
  });
});
