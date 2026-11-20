/**
 * 小手机共享预设提示词的单元测试：只测纯函数（预设条目抽取与排序），
 * 不测真的调模型——模型调用在 Playwright 里用假接口验。
 *
 * 这里的预设是测试里现写的假数据（条目内容都是测试自己编的指令文本），
 * 不是用户真实的预设文件——应用代码从 store 里读预设，测试不读文件。
 */
import { describe, expect, it } from 'vitest';
import type { RPCard } from '@/core/types/card.js';
import type { RPCompletionPreset, RPPromptEntry } from '@/core/types/preset.js';
import { extractPresetPrompts, isInjectablePresetEntry } from './preset.js';

function fakeCard(): RPCard {
  return {
    id: 'card-1',
    data: {
      name: '李淑纯',
      description: '和闺蜜小雨一起开花店。',
      personality: '温柔细心',
      scenario: '大学开学第一天',
      first_mes: '她站在宿舍楼门口。',
      mes_example: '',
    },
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
  };
}

function entry(
  identifier: string,
  content: string,
  extra: Partial<RPPromptEntry> = {},
): RPPromptEntry {
  return {
    identifier,
    name: identifier,
    system_prompt: true,
    role: 'system',
    content,
    enabled: true,
    ...extra,
  };
}

/** 假预设：main、jailbreak、自定义条目是字面指令；其余是标记位或设置包。 */
function fakePreset(): RPCompletionPreset {
  return {
    name: '测试预设',
    prompts: [
      entry('main', 'MAIN_写{{char}}的下一句回复，{{user}}是对话的另一方。'),
      entry('charDescription', ''),
      entry('charPersonality', ''),
      entry('scenario', ''),
      entry('worldInfoBefore', ''),
      entry('worldInfoAfter', ''),
      entry('chatHistory', ''),
      entry('dialogueExamples', ''),
      entry('jailbreak', 'JAILBREAK_不要提你是 AI。'),
      entry('nsfw', 'NSFW_按剧情尺度写。'),
      entry('custom-uuid-1', 'CUSTOM_回复前先想一想角色此刻的心情。'),
      entry('custom-uuid-2', 'CUSTOM_写景时多用感官细节。'),
      entry('nextResponse', 'NEXTRESPONSE_不应该被抽出来。'),
      entry('writingStyle', 'WRITINGSTYLE_不应该被抽出来。'),
      entry('SPresetSettings', 'x'.repeat(5000)),
      entry('disabled-one', 'DISABLED_未启用的条目不应该被抽出来。', { enabled: false }),
      entry('empty-one', ''),
    ],
    prompt_order: [
      {
        character_id: 100001,
        order: [
          { identifier: 'main', enabled: true },
          { identifier: 'charDescription', enabled: true },
          { identifier: 'charPersonality', enabled: true },
          { identifier: 'scenario', enabled: true },
          { identifier: 'worldInfoBefore', enabled: true },
          { identifier: 'worldInfoAfter', enabled: true },
          { identifier: 'chatHistory', enabled: true },
          { identifier: 'custom-uuid-1', enabled: true },
          { identifier: 'jailbreak', enabled: true },
          { identifier: 'custom-uuid-2', enabled: true },
          { identifier: 'nsfw', enabled: true },
        ],
      },
    ],
  };
}

describe('isInjectablePresetEntry', () => {
  it('字面指令条目可以抽（main / jailbreak / 自定义）', () => {
    expect(isInjectablePresetEntry(entry('main', 'MAIN_xxx'))).toBe(true);
    expect(isInjectablePresetEntry(entry('jailbreak', 'JAIL_xxx'))).toBe(true);
    expect(isInjectablePresetEntry(entry('custom-uuid-1', 'CUSTOM_xxx'))).toBe(true);
  });

  it('标记位不抽（charDescription / scenario / chatHistory / 世界书）', () => {
    for (const id of [
      'chatHistory',
      'dialogueExamples',
      'worldInfoBefore',
      'worldInfoAfter',
      'charDescription',
      'charPersonality',
      'scenario',
      'personaDescription',
    ]) {
      expect(isInjectablePresetEntry(entry(id, 'SOME_xxx'))).toBe(false);
    }
  });

  it('builder 特殊标识符不抽（nextResponse / writingStyle / cotPreset / userInfo / jailbreakFirst）', () => {
    for (const id of ['nextResponse', 'writingStyle', 'cotPreset', 'userInfo', 'jailbreakFirst']) {
      expect(isInjectablePresetEntry(entry(id, 'SOME_xxx'))).toBe(false);
    }
  });

  it('SPresetSettings 设置包不抽，未启用的不抽，空内容不抽', () => {
    expect(isInjectablePresetEntry(entry('SPresetSettings', 'x'.repeat(100)))).toBe(false);
    expect(isInjectablePresetEntry(entry('main', 'MAIN_xxx', { enabled: false }))).toBe(false);
    expect(isInjectablePresetEntry(entry('main', '   '))).toBe(false);
    expect(isInjectablePresetEntry(entry('main', ''))).toBe(false);
  });
});

describe('extractPresetPrompts', () => {
  it('抽出字面指令，按 prompt_order 排，标记位和设置包都不在', () => {
    const text = extractPresetPrompts(fakePreset(), fakeCard());
    expect(text).toContain('MAIN_写李淑纯的下一句回复');
    expect(text).toContain('CUSTOM_回复前先想一想角色此刻的心情');
    expect(text).toContain('JAILBREAK_不要提你是 AI');
    expect(text).toContain('NSFW_按剧情尺度写');
    expect(text).not.toContain('NEXTRESPONSE_');
    expect(text).not.toContain('WRITINGSTYLE_');
    expect(text).not.toContain('DISABLED_');
    expect(text).not.toContain('xxxx');
    // 顺序：按 prompt_order——main 在前，custom-uuid-1 在 jailbreak 之前。
    expect(text.indexOf('MAIN_')).toBeLessThan(text.indexOf('CUSTOM_回复前'));
    expect(text.indexOf('CUSTOM_回复前')).toBeLessThan(text.indexOf('JAILBREAK_'));
    expect(text.indexOf('JAILBREAK_')).toBeLessThan(text.indexOf('NSFW_'));
  });

  it('{{char}} / {{user}} 宏按主聊天的做法替换', () => {
    const text = extractPresetPrompts(fakePreset(), fakeCard(), '霜霜');
    expect(text).toContain('李淑纯');
    expect(text).toContain('霜霜');
    expect(text).not.toContain('{{char}}');
    expect(text).not.toContain('{{user}}');
  });

  it('没进 prompt_order 的条目按 prompts[] 原顺序补在后面', () => {
    const preset = fakePreset();
    preset.prompts.push(entry('late-custom', 'LATE_最后补上的条目。'));
    const text = extractPresetPrompts(preset, fakeCard());
    expect(text).toContain('LATE_最后补上的条目');
    expect(text.indexOf('LATE_')).toBeGreaterThan(text.indexOf('NSFW_'));
  });

  it('没有预设时返回空字符串', () => {
    expect(extractPresetPrompts(null, fakeCard())).toBe('');
    expect(extractPresetPrompts(undefined, fakeCard())).toBe('');
  });

  it('预设里没有能抽的条目时返回空字符串', () => {
    const preset = fakePreset();
    preset.prompts = [entry('charDescription', ''), entry('chatHistory', '')];
    expect(extractPresetPrompts(preset, fakeCard())).toBe('');
  });

  it('整段超预算时截断（排前面的优先保留）', () => {
    const text = extractPresetPrompts(fakePreset(), fakeCard(), 'User', 20);
    expect([...text].length).toBeLessThanOrEqual(20);
    expect(text).toContain('MAIN_');
  });
});
