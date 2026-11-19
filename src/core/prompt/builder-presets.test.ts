import { describe, expect, it } from 'vitest';
import { buildPrompt } from './builder.js';
import { BUILTIN_PRESETS } from '../defaults/presets.js';
import type { RPCard } from '../types/card.js';
import type { RPCompletionPreset, RPPromptEntry } from '../types/preset.js';

function makeCard(): RPCard {
  return {
    id: 'c1',
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
    data: {
      name: 'Aria',
      description: 'A bard.',
      personality: 'Cheerful',
      scenario: 'A tavern.',
      first_mes: 'Hello.',
      mes_example: '',
    },
  };
}

const history = [
  { role: 'user' as const, content: 'Hi there' },
  { role: 'assistant' as const, content: 'Welcome!' },
];

function entry(
  identifier: string,
  name: string,
  content: string | undefined,
  opts: Partial<RPPromptEntry> = {},
): RPPromptEntry {
  return {
    identifier,
    name,
    system_prompt: true,
    role: 'system',
    ...(content === undefined ? { marker: true } : { content }),
    ...opts,
  };
}

/** 基础骨架：main → 角色前导 → 聊天记录 → jailbreak。 */
function skeleton(extra: RPPromptEntry[] = [], orderExtra: string[] = []): RPCompletionPreset {
  const prompts = [
    entry('main', '主提示', "Write {{char}}'s next reply."),
    entry('worldInfoBefore', '世界书前', undefined),
    entry('charDescription', '角色描述', undefined),
    entry('charPersonality', '角色性格', undefined),
    entry('scenario', '场景', undefined),
    entry('personaDescription', '我的身份', undefined),
    entry('worldInfoAfter', '世界书后', undefined),
    entry('dialogueExamples', '对话示例', undefined),
    entry('chatHistory', '聊天记录', undefined, { role: 'user', system_prompt: false }),
    entry('jailbreak', '越狱', '[Stay in character.]'),
    ...extra,
  ];
  const order = [
    'main',
    ...orderExtra,
    'worldInfoBefore',
    'charDescription',
    'charPersonality',
    'scenario',
    'personaDescription',
    'worldInfoAfter',
    'dialogueExamples',
    'chatHistory',
    'jailbreak',
  ];
  return {
    name: 'test',
    prompts,
    prompt_order: [{ character_id: 100001, order: order.map((identifier) => ({ identifier, enabled: true })) }],
  };
}

describe('F01 预设 role 注入顺序：role 区块固定插在角色前导之前', () => {
  it('prompt_order 把预注入排在最后，builder 仍把它移到角色描述之前', () => {
    const preset = skeleton(
      [
        entry('core_preUser1', '预注入 User 1', 'PRE-USER-1', { role: 'user', system_prompt: false }),
        entry('core_preAi1', '预注入 AI 1', 'PRE-AI-1', { role: 'assistant', system_prompt: false }),
      ],
      // 故意把预注入排在 jailbreak 之后（乱序），规则应纠正它
      [],
    );
    // 把预注入行移到顺序末尾
    const group = preset.prompt_order[0];
    group.order = [
      ...group.order.filter((r) => !r.identifier.startsWith('core_')),
      { identifier: 'core_preUser1', enabled: true },
      { identifier: 'core_preAi1', enabled: true },
    ];
    const res = buildPrompt({ card: makeCard(), preset, messages: history });
    const idxUser = res.messages.findIndex((m) => m.content === 'PRE-USER-1');
    const idxAi = res.messages.findIndex((m) => m.content === 'PRE-AI-1');
    // 连续 system 消息会合并成一条，所以角色描述用 includes 找。
    const idxDesc = res.messages.findIndex((m) => m.content.includes('A bard.'));
    expect(idxUser).toBeGreaterThan(-1);
    expect(idxAi).toBe(idxUser + 1);
    expect(idxDesc).toBeGreaterThan(idxAi);
    expect(res.messages[idxUser].role).toBe('user');
    expect(res.messages[idxAi].role).toBe('assistant');
  });

  it('破限核心预设的预注入同样落在角色前导之前', () => {
    const preset = structuredClone(BUILTIN_PRESETS.find((p) => p.id === 'preset:core-jailbreak')!);
    const res = buildPrompt({ card: makeCard(), preset, messages: history });
    const idxPre = res.messages.findIndex((m) => m.content.includes('如果你理解、尊重并同意这些核心原则'));
    const idxDesc = res.messages.findIndex((m) => m.content.includes('A bard.'));
    expect(idxPre).toBeGreaterThan(-1);
    expect(idxPre).toBeLessThan(idxDesc);
  });
});

describe('F02 注入顺序可表达：破限最前 / User Info 在角色前导之后', () => {
  it('jailbreakFirst 区块与 input.jailbreakFirst 都在最前', () => {
    const preset = skeleton([entry('jailbreakFirst', '破限', 'JAILBREAK-FIRST')], ['jailbreakFirst']);
    const res = buildPrompt({ card: makeCard(), preset, messages: history, jailbreakFirst: 'INPUT-JAILBREAK' });
    expect(res.messages[0].content).toContain('INPUT-JAILBREAK');
    expect(res.messages[1].content).toContain('JAILBREAK-FIRST');
    const idxMain = res.messages.findIndex((m) => m.content.includes("Write Aria's next reply"));
    expect(idxMain).toBeGreaterThan(1);
  });

  it('userInfo 区块放在角色前导之后、聊天记录之前', () => {
    const preset = skeleton([entry('userInfo', '用户信息', undefined)]);
    const res = buildPrompt({
      card: makeCard(),
      preset,
      messages: history,
      persona: { name: 'Sam', description: 'A traveler.', preferences: '喜欢短句' },
    });
    const idxInfo = res.messages.findIndex((m) => m.content.includes('[User Info]'));
    const idxHist = res.messages.findIndex((m) => m.content === 'Hi there');
    expect(idxInfo).toBeGreaterThan(-1);
    // 连续 system 消息会合并成一条，所以用同一条消息内的文本顺序断言：
    // 场景（角色前导）先于 User Info。
    const infoMsg = res.messages[idxInfo];
    expect(infoMsg.content.indexOf('A tavern.')).toBeGreaterThan(-1);
    expect(infoMsg.content.indexOf('[User Info]')).toBeGreaterThan(infoMsg.content.indexOf('A tavern.'));
    expect(idxInfo).toBeLessThan(idxHist);
    expect(res.messages[idxInfo].content).toContain('Name: Sam');
    expect(res.messages[idxInfo].content).toContain('Preferences: 喜欢短句');
  });

  it('没有 userInfo 区块时，input.userInfoAfterChar 同样放在角色前导之后', () => {
    const res = buildPrompt({
      card: makeCard(),
      preset: skeleton(),
      messages: history,
      userInfoAfterChar: '[User Info]\nName: Sam',
    });
    const idxInfo = res.messages.findIndex((m) => m.content.includes('Name: Sam'));
    const idxHist = res.messages.findIndex((m) => m.content === 'Hi there');
    expect(idxInfo).toBeGreaterThan(-1);
    // 同上：system 合并后用消息内文本顺序断言（角色描述先于 User Info）。
    const infoMsg = res.messages[idxInfo];
    expect(infoMsg.content.indexOf('[User Info]')).toBeGreaterThan(infoMsg.content.indexOf('A bard.'));
    expect(idxInfo).toBeLessThan(idxHist);
  });
});

describe('F03 文风 <next_response> / <writing_style> 协议', () => {
  it('writingStyle 区块剥掉标签、拼进聊天记录之后的 next_response', () => {
    const preset = skeleton([
      entry('writingStyle', '文风', '<writing_style>\n用白描写法。\n</writing_style>'),
    ]);
    const res = buildPrompt({ card: makeCard(), preset, messages: history });
    const last = res.messages[res.messages.length - 1];
    expect(last.source).toBe('preset:nextResponse');
    expect(last.content).toContain('<next_response>');
    expect(last.content).toContain('用白描写法。');
    expect(last.content).not.toContain('<writing_style>');
    const idxHist = res.messages.findIndex((m) => m.content === 'Welcome!');
    expect(res.messages.indexOf(last)).toBeGreaterThan(idxHist);
  });

  it('nextResponse 模板里的 {{writing_style}} 占位被文风替换', () => {
    const preset = skeleton([
      entry('writingStyle', '文风', '<writing_style>白描。</writing_style>'),
      entry('nextResponse', '下条回复', '<next_response>\n承接。\n{{writing_style}}\n</next_response>'),
    ]);
    const res = buildPrompt({ card: makeCard(), preset, messages: history });
    const last = res.messages[res.messages.length - 1];
    expect(last.content).toContain('白描。');
    expect(last.content).not.toContain('{{writing_style}}');
    expect(last.content).toContain('<next_response>');
  });
});

describe('F06 COT 预设动态生成', () => {
  it('cotPreset 区块按需生成 thinking_protocol，放在 next_response 之前', () => {
    const preset = skeleton([entry('cotPreset', 'COT 预设', undefined, { marker: true })]);
    const res = buildPrompt({
      card: makeCard(),
      preset,
      messages: history,
      cot: { memoryEnabled: true, model: 'deepseek-chat' },
    });
    const idxCot = res.messages.findIndex((m) => m.source === 'preset:cotPreset');
    expect(idxCot).toBeGreaterThan(-1);
    expect(res.messages[idxCot].content).toContain('<thinking_protocol>');
    expect(res.messages[idxCot].content).toContain('[记忆整理]');
    expect(res.messages[idxCot].content).toContain('<thinking>');
    const idxHist = res.messages.findIndex((m) => m.content === 'Welcome!');
    expect(idxCot).toBeGreaterThan(idxHist);
  });

  it('extraSystem 里有 UI 模板痕迹时自动带上变量更新分析', () => {
    const preset = skeleton([entry('cotPreset', 'COT 预设', undefined, { marker: true })]);
    const res = buildPrompt({
      card: makeCard(),
      preset,
      messages: history,
      extraSystem: '<ui_template_updates>…</ui_template_updates>',
    });
    const cot = res.messages.find((m) => m.source === 'preset:cotPreset');
    expect(cot?.content).toContain('[变量更新分析]');
  });

  it('没有 cotPreset 区块时不生成 COT 文本', () => {
    const res = buildPrompt({ card: makeCard(), preset: skeleton(), messages: history });
    expect(res.messages.some((m) => m.source === 'preset:cotPreset')).toBe(false);
  });
});

describe('C11 抗截断禁用 COT 预设', () => {
  it('disableCot 时动态生成的 COT 文本整段跳过', () => {
    const preset = skeleton([entry('cotPreset', 'COT 预设', undefined, { marker: true })]);
    const res = buildPrompt({
      card: makeCard(),
      preset,
      messages: history,
      cot: { memoryEnabled: true, model: 'deepseek-chat' },
      disableCot: true,
    });
    expect(res.messages.some((m) => m.source === 'preset:cotPreset')).toBe(false);
    const block = res.blocks.find((b) => b.identifier === 'cotPreset');
    expect(block?.enabled).toBe(false);
    expect(block?.source).toContain('disabled-anti-truncation');
  });

  it('disableCot 时静态 COT 文本也不注入', () => {
    const preset = skeleton([entry('cotPreset', 'COT 预设', '静态 COT 文本')]);
    const res = buildPrompt({ card: makeCard(), preset, messages: history, disableCot: true });
    expect(res.messages.some((m) => m.content.includes('静态 COT 文本'))).toBe(false);
  });

  it('disableCot 为 false 时 COT 正常注入', () => {
    const preset = skeleton([entry('cotPreset', 'COT 预设', undefined, { marker: true })]);
    const res = buildPrompt({
      card: makeCard(),
      preset,
      messages: history,
      cot: { memoryEnabled: true, model: 'deepseek-chat' },
      disableCot: false,
    });
    expect(res.messages.some((m) => m.source === 'preset:cotPreset')).toBe(true);
  });
});
