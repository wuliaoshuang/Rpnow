import { describe, expect, it } from 'vitest';
import {
  CORE_PRESETS,
  MANAGED_PRESETS,
  buildCorePreset,
  findManagedPreset,
  managedPresetIdentifier,
  managedPresetOrder,
  managedPresetToEntry,
} from './managed.js';
import {
  buildNextResponsePrompt,
  injectWritingStyleIntoNextResponse,
  parseNextResponse,
  parseWritingStyle,
  stripNextResponse,
} from './writing-style.js';
import { buildCotPreset, cotTagForPreset } from './cot-preset.js';
import { BUILTIN_PRESETS } from '../defaults/presets.js';

describe('F04 核心预设', () => {
  it('有破限 + 预注入 User 1/2、AI 1/2 五条', () => {
    expect(CORE_PRESETS.map((p) => p.name)).toEqual([
      '破限',
      '破限预注入 · User 1',
      '破限预注入 · AI 1',
      '破限预注入 · User 2',
      '破限预注入 · AI 2',
    ]);
    const byKey = new Map(CORE_PRESETS.map((p) => [p.key, p]));
    expect(byKey.get('jailbreak')?.role).toBe('system');
    expect(byKey.get('preUser1')?.role).toBe('user');
    expect(byKey.get('preAi1')?.role).toBe('assistant');
    expect(byKey.get('preUser2')?.role).toBe('user');
    expect(byKey.get('preAi2')?.role).toBe('assistant');
  });

  it('破限核心预设是内置预设之一', () => {
    const core = BUILTIN_PRESETS.find((p) => p.id === 'preset:core-jailbreak');
    expect(core).toBeDefined();
    expect(core!.name).toBe('破限核心');
    expect(core!.prompts.some((p) => p.identifier === 'jailbreakFirst')).toBe(true);
  });

  it('buildCorePreset 把破限放最前、预注入放进顺序', () => {
    const preset = buildCorePreset();
    const order = preset.prompt_order[0].order.map((r) => r.identifier);
    expect(order[0]).toBe('jailbreakFirst');
    expect(order).toContain('core_preUser1');
    expect(order).toContain('core_preAi1');
    expect(order).toContain('core_preUser2');
    expect(order).toContain('core_preAi2');
    expect(order.indexOf('chatHistory')).toBeGreaterThan(order.indexOf('core_preAi2'));
  });
});

describe('F05 托管预设库', () => {
  it('包含差距清单要求的全部命名预设', () => {
    const names = MANAGED_PRESETS.map((p) => p.name);
    for (const name of [
      '防抢话',
      '防神化',
      '防重复',
      '人格内核',
      '去User中心化',
      '活人感',
      '剧情面板',
      '时间戳',
      '第二人称',
      '第三人称',
      '禁止规则',
    ]) {
      expect(names).toContain(name);
    }
    expect(names).toContain('文风（抗八股）');
    expect(names).toContain('NSFW增强');
  });

  it('每条都有说明与正文，文风条带 writing_style 标签', () => {
    for (const p of MANAGED_PRESETS) {
      expect(p.description.trim().length).toBeGreaterThan(0);
      expect(p.content.trim().length).toBeGreaterThan(20);
    }
    expect(findManagedPreset('writingStyle')?.content).toContain('<writing_style>');
    expect(findManagedPreset('writingStyle')?.content).toContain('</writing_style>');
  });

  it('managedPresetOrder 按 after 链排，不丢不重', () => {
    const ordered = managedPresetOrder();
    expect(ordered.map((p) => p.key).sort()).toEqual(MANAGED_PRESETS.map((p) => p.key).sort());
    const idx = new Map(ordered.map((p, i) => [p.name, i]));
    // 防抢话在 NSFW增强之后，人格内核在防重复之后
    expect(idx.get('防抢话')!).toBeGreaterThan(idx.get('NSFW增强')!);
    expect(idx.get('人格内核')!).toBeGreaterThan(idx.get('防重复')!);
  });

  it('转成预设区块时文风用 writingStyle 标识符、其余用 managed_ 前缀', () => {
    expect(managedPresetIdentifier(findManagedPreset('writingStyle')!)).toBe('writingStyle');
    expect(managedPresetIdentifier(findManagedPreset('antiRobbery')!)).toBe('managed_antiRobbery');
    const entry = managedPresetToEntry(findManagedPreset('antiRobbery')!);
    expect(entry.role).toBe('system');
    expect(entry.content).toContain('<anti_robbery>');
  });
});

describe('F03 文风协议', () => {
  it('parseWritingStyle 剥掉 <writing_style> 包裹', () => {
    expect(parseWritingStyle('<writing_style>\n用白描写法。\n</writing_style>')).toBe('用白描写法。');
    expect(parseWritingStyle('没有标签的文风')).toBe('没有标签的文风');
    expect(parseWritingStyle('<writing_style>只有开标签')).toBe('只有开标签');
  });

  it('parseNextResponse / stripNextResponse', () => {
    const text = '前面\n<next_response>\n续写正文。\n</next_response>\n后面';
    expect(parseNextResponse(text)).toBe('续写正文。');
    expect(stripNextResponse(text)).toContain('前面');
    expect(stripNextResponse(text)).not.toContain('续写正文');
  });

  it('buildNextResponsePrompt 把文风放进 <next_response> 风格位', () => {
    const out = buildNextResponsePrompt({ writingStyle: '用白描写法。' });
    expect(out.startsWith('<next_response>')).toBe(true);
    expect(out.endsWith('</next_response>')).toBe(true);
    expect(out).toContain('用白描写法。');
    expect(out).toContain('完整承接最新用户输入');
  });

  it('injectWritingStyleIntoNextResponse 替换占位或插到闭标签前', () => {
    expect(injectWritingStyleIntoNextResponse('<next_response>\n{{writing_style}}\n</next_response>', '白描。')).toContain('白描。');
    const injected = injectWritingStyleIntoNextResponse('<next_response>\n承接。\n</next_response>', '白描。');
    expect(injected).toContain('白描。');
    expect(injected.indexOf('白描。')).toBeLessThan(injected.indexOf('</next_response>'));
    expect(injectWritingStyleIntoNextResponse('模板', '')).toBe('模板');
  });
});

describe('F06 COT 预设动态生成', () => {
  it('默认生成 thinking_protocol，含七个分析节', () => {
    const out = buildCotPreset({ memoryEnabled: true, uiTemplateEnabled: true });
    expect(out).toContain('<thinking_protocol>');
    for (const section of ['[记忆整理]', '[情景意图分析]', '[设定分析]', '[信息边界]', '[剧情规划]', '[变量更新分析]', '[最终检查]']) {
      expect(out).toContain(section);
    }
  });

  it('不启用记忆/UI 模板时对应小节不出现', () => {
    const out = buildCotPreset({});
    expect(out).not.toContain('[记忆整理]');
    expect(out).not.toContain('[变量更新分析]');
    expect(out).toContain('[最终检查]');
  });

  it('按模型选思考标签：DeepSeek 用 thinking，其余用 cot', () => {
    expect(cotTagForPreset('deepseek-chat')).toBe('thinking');
    expect(cotTagForPreset('gpt-4o')).toBe('cot');
    expect(cotTagForPreset('gpt-4o', true)).toBe('thinking');
    expect(buildCotPreset({ model: 'deepseek-chat' })).toContain('<thinking>');
    expect(buildCotPreset({ model: 'gpt-4o' })).toContain('<cot>');
  });

  it('剧情面板启用时剧情规划里有面板判断', () => {
    expect(buildCotPreset({ storyPanelsEnabled: true })).toContain('面板');
    expect(buildCotPreset({})).not.toContain('面板：判断');
  });

  it('预注入阶段 1/2 生成阶段裁剪的分析，prefillEnabled 为 false 时只剩正文', () => {
    const phase1 = buildCotPreset({ prefillPhase: 1, prefillEnabled: true, prefillBaseContent: '正文。' });
    expect(phase1).toContain('先分析续写难点');
    expect(phase1.endsWith('正文。')).toBe(true);
    expect(buildCotPreset({ prefillPhase: 1, prefillBaseContent: '正文。' })).toBe('正文。');
  });
});
