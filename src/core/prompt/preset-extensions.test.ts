import { describe, expect, it } from 'vitest';
import {
  getPath,
  getPresetHelperScripts,
  getPresetRegexScripts,
  readPresetExtensionField,
  setPath,
  writePresetExtensionField,
} from './preset-extensions.js';

describe('getPath/setPath', () => {
  const doc = { a: { b: [{ c: 1 }, { c: 2 }] } };

  it('解析点号与数组下标路径', () => {
    expect(getPath(doc, 'a.b[0].c')).toBe(1);
    expect(getPath(doc, 'a.b[1].c')).toBe(2);
    expect(getPath(doc, 'a.b[9]')).toBeUndefined();
    expect(getPath(doc, 'nope.deep')).toBeUndefined();
  });

  it('setPath 不可变并补齐缺失层级', () => {
    const next = setPath({ a: { keep: 1 } } as Record<string, unknown>, 'a.b.c', 9);
    expect(getPath(next, 'a.b.c')).toBe(9);
    expect(getPath(next, 'a.keep')).toBe(1);
    // 入参未被修改
    expect((doc.a.b as unknown[]).length).toBe(2);
  });
});

describe('readPresetExtensionField', () => {
  const preset = {
    extensions: {
      regex_scripts: [{ id: 'r1' }],
      tavern_helper: { scripts: [{ name: '菜单', content: '...' }], variables: {} },
      SPreset: { RegexBinding: { regexes: [{ id: 'r2' }] } },
    },
  };

  it('空 path 取整块 extensions', () => {
    expect(readPresetExtensionField(preset)).toBe(preset.extensions);
  });

  it('任意点号路径可读写（不可白名单）', () => {
    expect(readPresetExtensionField(preset, 'tavern_helper.scripts[0].name')).toBe('菜单');
    expect(readPresetExtensionField(preset, 'SPreset.RegexBinding.regexes[0].id')).toBe('r2');
    expect(readPresetExtensionField(preset, 'nothing.here')).toBeNull();
  });

  it('运行时份优先于文件份', () => {
    expect(readPresetExtensionField(preset, 'regex_scripts', { regex_scripts: [] })).toEqual([]);
  });

  it('无 extensions 时返回 null', () => {
    expect(readPresetExtensionField({}, 'a.b')).toBeNull();
    expect(readPresetExtensionField(undefined, '')).toBeNull();
  });
});

describe('getPresetRegexScripts', () => {
  const preset = {
    prompts: [
      {
        identifier: 'SPresetSettings',
        content: JSON.stringify({ RegexBinding: { regexes: [{ id: 'A', findRegex: '/x/', replaceString: 'y' }] } }),
      },
      { identifier: 'main', content: '普通提示词不是 JSON' },
    ],
    extensions: {
      regex_scripts: [
        { id: 'B', scriptName: '卡片层', findRegex: '/a/', replaceString: '<b>', markdownOnly: true, placement: [2] },
        // 与 RegexBinding 重复携带（同一 find/replace），必须去重
        { id: 'A', scriptName: '数据通道', findRegex: '/x/', replaceString: 'y', markdownOnly: true },
      ],
      SPreset: { RegexBinding: { regexes: [{ id: 'A', findRegex: '/x/', replaceString: 'y' }] } },
    },
  };

  it('取三载体并集并按 find/replace 去重', () => {
    const scripts = getPresetRegexScripts(preset);
    expect(scripts).toHaveLength(2);
    expect(scripts.map((s) => s.id).sort()).toEqual(['A', 'B']);
  });

  it('保留 ST 的脚本字段', () => {
    const b = getPresetRegexScripts(preset).find((s) => s.id === 'B')!;
    expect(b.scriptName).toBe('卡片层');
    expect(b.markdownOnly).toBe(true);
    expect(b.placement).toEqual([2]);
    expect(b.disabled).toBe(false);
  });

  it('缺字段有安全默认值', () => {
    const a = getPresetRegexScripts(preset).find((s) => s.id === 'A')!;
    expect(a.replaceString).toBe('y');
    expect(a.placement).toEqual([2]);
    expect(a.minDepth).toBeNull();
  });
});

describe('getPresetHelperScripts', () => {
  it('透传 tavern_helper.scripts', () => {
    const scripts = getPresetHelperScripts({
      extensions: { tavern_helper: { scripts: [{ type: 'script', enabled: true, name: 'SPreset', content: 'x' }] } },
    });
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toMatchObject({ type: 'script', enabled: true, name: 'SPreset' });
  });

  it('缺失时返回空数组', () => {
    expect(getPresetHelperScripts({})).toEqual([]);
    expect(getPresetHelperScripts(undefined)).toEqual([]);
  });
});

describe('writePresetExtensionField', () => {
  it('写入深层路径且不改原对象', () => {
    const base = { tavern_helper: { variables: {} } } as Record<string, unknown>;
    const next = writePresetExtensionField(base, 'tavern_helper.scripts', [{ id: 's1' }]);
    expect(getPath(next, 'tavern_helper.scripts[0].id')).toBe('s1');
    expect(getPath(base, 'tavern_helper.scripts')).toBeUndefined();
  });
});

/**
 * 真实预设保真校验（非 CI 用例）。
 *
 * 用法：`RPNOW_PRESET_FIXTURE="C:/…/Meowssiah-2.1.6.json" pnpm test`
 * 未设置路径时整组跳过，因此常规单测与 CI 不受影响。
 */
const FIXTURE = process.env.RPNOW_PRESET_FIXTURE;
describe.skipIf(!FIXTURE)('真实预设保真（Meowssiah）', () => {
  it('导入后 extensions 命名空间完整、正则与内嵌脚本可读', async () => {
    const { readFileSync } = await import('node:fs');
    const doc = JSON.parse(readFileSync(FIXTURE!, 'utf8')) as Record<string, unknown>;
    const extensions = doc.extensions as Record<string, unknown>;
    expect(extensions).toBeTruthy();

    // 命名空间可点号访问（不可白名单）
    expect(Array.isArray(readPresetExtensionField({ extensions }, 'regex_scripts'))).toBe(true);
    expect(readPresetExtensionField({ extensions }, 'SPreset.RegexBinding.regexes')).toBeTruthy();
    expect(readPresetExtensionField({ extensions }, 'tavern_helper.variables')).toEqual({});

    // 正则三份快照是包含关系：并集去重后等于标准载体的 8 条
    const scripts = getPresetRegexScripts({
      extensions,
      prompts: doc.prompts as Array<{ identifier?: string; content?: string }>,
    });
    expect(scripts).toHaveLength(8);

    // 内嵌插件脚本透传（不为空、含两条）
    const helpers = getPresetHelperScripts({ extensions });
    expect(helpers).toHaveLength(2);
    expect(helpers.map((h) => h.name)).toContain('菜单');
  });
});
