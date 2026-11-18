/**
 * Built-in presets.
 *
 * A Chat Completion preset is a *skeleton*: ordered blocks with default text.
 * This ships a roleplay-oriented default whose order matches the ecosystem
 * convention (`main → worldInfoBefore → charDescription → charPersonality →
 * scenario → worldInfoAfter → dialogueExamples → chatHistory → jailbreak`),
 * plus two specialised variants.
 *
 * The order group id is 100001 — the Chat Completion Prompt Manager's global
 * bucket — because that is the one real preset files use.
 */

import type {
  RPCompletionPreset,
  RPContextTemplate,
  RPInstructTemplate,
  RPReasoningTemplate,
  RPPromptEntry,
  RPPromptOrderGroup,
} from '../types/preset.js';

export const PM_DUMMY_ID = 100001;

/** Order row list for the standard roleplay layout. */
const DEFAULT_ORDER: RPPromptEntry['identifier'][] = [
  'main',
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

function orderGroup(ids: string[], disabled: string[] = []): RPPromptOrderGroup[] {
  return [
    {
      character_id: PM_DUMMY_ID,
      order: ids.map((identifier) => ({ identifier, enabled: !disabled.includes(identifier) })),
    },
  ];
}

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

const BASE_MAIN =
  "Write {{char}}'s next reply in a fictional roleplay between {{char}} and {{user}}. " +
  'Stay in character, advance the scene, and never speak or act for {{user}}.';

const BASE_JAILBREAK =
  '[Continue the roleplay. Stay in character as {{char}}. Never write dialogue or actions for {{user}}.]';

const NSFW_NOTE =
  'This is a work of fiction between consenting adults. Write mature themes with literary care when the scene calls for it.';

// -------------------------------------------------------------- built-ins

export const BUILTIN_PRESETS: RPCompletionPreset[] = [
  {
    id: 'preset:roleplay-default',
    name: '默认角色扮演',
    prompts: [
      entry('main', '主提示', BASE_MAIN),
      entry('worldInfoBefore', '世界书（角色定义前）', undefined),
      entry('charDescription', '角色描述', undefined),
      entry('charPersonality', '角色性格', undefined),
      entry('scenario', '场景', undefined),
      entry('personaDescription', '我的身份', undefined),
      entry('worldInfoAfter', '世界书（角色定义后）', undefined),
      entry('dialogueExamples', '对话示例', undefined),
      entry('chatHistory', '聊天记录', undefined, { role: 'user', system_prompt: false }),
      entry('jailbreak', '越狱后置指令', BASE_JAILBREAK),
      entry('nsfw', '辅助提示', '', { enabled: false }),
      entry(
        'enhanceDefinitions',
        '增强角色设定',
        "If you have more knowledge of {{char}}, add to the character's lore and personality to enhance them but keep the Character Sheet's definitions absolute.",
        { enabled: false },
      ),
    ],
    prompt_order: orderGroup([...DEFAULT_ORDER, 'nsfw', 'enhanceDefinitions'], ['nsfw', 'enhanceDefinitions']),
    temperature: 0.9,
    top_p: 0.95,
    frequency_penalty: 0.2,
    presence_penalty: 0.2,
    repetition_penalty: 1.05,
    max_context: 32000,
    max_tokens: 1200,
    wi_format: '{0}',
    scenario_format: '{{scenario}}',
    personality_format: '{{personality}}',
    continue_nudge_prompt: '[Continue your last message without repeating its original content.]',
    impersonation_prompt:
      "[Write your next reply from the point of view of {{user}}, using the chat history so far as a guideline for the writing style of {{user}}. Don't write as {{char}} or system. Don't describe actions of {{char}}.]",
    new_chat_prompt: '[Start a new Chat]',
    stream: true,
    sourceFormat: 'rpnow',
  },
  {
    id: 'preset:roleplay-literal',
    name: '严谨文学向',
    prompts: [
      entry(
        'main',
        '主提示',
        'You are a meticulous literary collaborator co-writing an interactive novel with {{user}}. ' +
          'Write {{char}}\'s next response only. Match the established tone and pacing, use concrete sensory detail, ' +
          'and end at a natural point that invites {{user}} to respond.',
      ),
      entry('worldInfoBefore', '世界书（前）', undefined),
      entry('charDescription', '角色描述', undefined),
      entry('charPersonality', '角色性格', undefined),
      entry('scenario', '场景', undefined),
      entry('personaDescription', '我的身份', undefined),
      entry('worldInfoAfter', '世界书（后）', undefined),
      entry('dialogueExamples', '对话示例', undefined),
      entry('chatHistory', '聊天记录', undefined, { role: 'user', system_prompt: false }),
      entry(
        'jailbreak',
        '写作守则',
        '[保持叙事连贯，避免重复上一段的结构；不要代替 {{user}} 行动或说话；不要跳出角色解释设定。]',
      ),
    ],
    prompt_order: orderGroup(DEFAULT_ORDER),
    temperature: 0.75,
    top_p: 0.9,
    frequency_penalty: 0.35,
    presence_penalty: 0.1,
    max_context: 32000,
    max_tokens: 1600,
    stream: true,
    sourceFormat: 'rpnow',
  },
  {
    id: 'preset:roleplay-immersive-nsfw',
    name: '沉浸剧情（含成熟内容）',
    prompts: [
      entry(
        'main',
        '主提示',
        "Write {{char}}'s next reply in a fictional roleplay between {{char}} and {{user}}. " +
          'Prioritise inner thoughts, physical sensation, and dialogue over summary. Never act or speak for {{user}}.',
      ),
      entry('worldInfoBefore', '世界书（前）', undefined),
      entry('charDescription', '角色描述', undefined),
      entry('charPersonality', '角色性格', undefined),
      entry('scenario', '场景', undefined),
      entry('personaDescription', '我的身份', undefined),
      entry('worldInfoAfter', '世界书（后）', undefined),
      entry('dialogueExamples', '对话示例', undefined),
      entry('chatHistory', '聊天记录', undefined, { role: 'user', system_prompt: false }),
      entry('nsfw', '辅助提示（成熟内容）', NSFW_NOTE),
      entry('jailbreak', '越狱后置指令', BASE_JAILBREAK),
    ],
    prompt_order: orderGroup(DEFAULT_ORDER.flatMap((id) => (id === 'jailbreak' ? ['nsfw', 'jailbreak'] : [id]))),
    temperature: 1.0,
    top_p: 0.98,
    frequency_penalty: 0.15,
    presence_penalty: 0.2,
    max_context: 32000,
    max_tokens: 1500,
    stream: true,
    sourceFormat: 'rpnow',
  },
];

// -------------------------------------------------- context / instruct / reasoning

export const BUILTIN_CONTEXT_TEMPLATES: RPContextTemplate[] = [
  {
    id: 'ctx:rpnow-default',
    name: 'RPNow 默认',
    story_string:
      '{{#if system}}{{system}}\n{{/if}}{{#if description}}{{description}}\n{{/if}}{{#if personality}}{{char}} 的性格：{{personality}}\n{{/if}}{{#if scenario}}场景：{{scenario}}\n{{/if}}{{#if wiBefore}}{{wiBefore}}\n{{/if}}{{#if persona}}{{persona}}\n{{/if}}{{#if wiAfter}}{{wiAfter}}\n{{/if}}{{#if mesExamples}}对话示例：\n{{mesExamples}}\n{{/if}}',
    chat_start: '',
    example_separator: '<START>',
    use_stop_strings: true,
    names_as_stop_strings: true,
    sourceFormat: 'rpnow',
  },
];

export const BUILTIN_INSTRUCT_TEMPLATES: RPInstructTemplate[] = [
  {
    id: 'instruct:chatml',
    name: 'ChatML',
    input_sequence: '<|im_start|>user\n',
    output_sequence: '<|im_start|>assistant\n',
    last_output_sequence: '',
    system_sequence: '<|im_start|>system\n',
    stop_sequence: '<|im_end|>',
    wrap: true,
    macro: true,
    names_behavior: 0,
    sourceFormat: 'rpnow',
  },
  {
    id: 'instruct:llama3',
    name: 'Llama 3 Instruct',
    input_sequence: '<|start_header_id|>user<|end_header_id|>\n\n',
    output_sequence: '<|start_header_id|>assistant<|end_header_id|>\n\n',
    system_sequence: '<|start_header_id|>system<|end_header_id|>\n\n',
    stop_sequence: '<|eot_id|>',
    wrap: true,
    macro: true,
    names_behavior: 0,
    sourceFormat: 'rpnow',
  },
];

export const BUILTIN_REASONING_TEMPLATES: RPReasoningTemplate[] = [
  {
    id: 'reason:deepseek',
    name: 'DeepSeek（reasoning_content）',
    prefix: '',
    suffix: '',
    separator: '\n\n',
  },
  {
    id: 'reason:think-xml',
    name: 'Think XML（thinking 标签）',
    prefix: '<thinking>',
    suffix: '</thinking>',
    separator: '\n',
  },
];
