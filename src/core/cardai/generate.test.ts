import { describe, expect, it } from 'vitest';
import {
  buildCardGenMessages,
  cleanFirstMessage,
  coerceRegexScripts,
  coerceWorldInfo,
  extractJsonObject,
  cardGenMissingParts,
  cardGenProgress,
  cardGenSectionsSeen,
  extractOutputReplyContent,
  parseCardSections,
  repairJson,
  shouldRetryCardGen,
  stripCodeFence,
} from './generate.js';

const SAMPLE = `## Name
阿尔德里克

## Description
银发的流浪剑士，左手缺了两根手指。

## Personality
话少，警惕，对承诺极其认真。

## Scenario
边陲小镇的雨天。

## First Message
**雨顺着屋檐往下淌。** 他把手按在剑柄上。

## Post History Instructions
保持第三人称。

## Creator Notes
原创角色。

## Avatar Prompt
1boy, white hair, cloak

## World Info
\`\`\`json
[
  {"comment":"小镇","content":"常年下雨的边陲镇。","position":0,"order":10,"keys":["小镇"]}
]
\`\`\`

## Regex Scripts
\`\`\`json
[
  {"scriptName":"隐藏思考","findRegex":"/(<think>[\\s\\S]*?<\\/think>)/g","replaceString":"","placement":1,"markdownOnly":false,"promptOnly":true}
]
\`\`\`
`;

describe('buildCardGenMessages', () => {
  it('asks for every section', () => {
    const messages = buildCardGenMessages('一个话少的剑士');
    expect(messages[0].role).toBe('system');
    for (const label of ['Name', 'Description', 'Personality', 'First Message', 'World Info', 'Regex Scripts']) {
      expect(messages[0].content).toContain(label);
    }
    expect(messages[1].content).toContain('一个话少的剑士');
  });
});

describe('stripCodeFence', () => {
  it('unwraps a fenced block', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it('removes leading ### markers', () => {
    expect(stripCodeFence('### Name\n阿尔')).toBe('Name\n阿尔');
  });
});

describe('repairJson', () => {
  it('escapes quotes inside string values', () => {
    const broken = '{"content":"他说 "你好"，然后走了"}';
    const repaired = repairJson(broken);
    expect(() => JSON.parse(repaired)).not.toThrow();
    expect(JSON.parse(repaired).content).toBe('他说 "你好"，然后走了');
  });

  it('leaves valid JSON alone', () => {
    expect(repairJson('{"a":"b"}')).toBe('{"a":"b"}');
  });

  it('keeps escaped quotes intact', () => {
    expect(repairJson('{"a":"b\\"c"}')).toBe('{"a":"b\\"c"}');
  });
});

describe('extractJsonObject', () => {
  it('pulls JSON out of surrounding prose', () => {
    expect(extractJsonObject('这是数据：[{"a":1}] 完毕')).toEqual([{ a: 1 }]);
  });

  it('recovers from an unescaped quote', () => {
    expect(extractJsonObject('{"content":"他说 "嗨""}')).toEqual({ content: '他说 "嗨"' });
  });

  it('returns null when there is no JSON', () => {
    expect(extractJsonObject('没有数据')).toBeNull();
  });
});

describe('parseCardSections', () => {
  it('maps every section', () => {
    const s = parseCardSections(SAMPLE);
    expect(s.name).toBe('阿尔德里克');
    expect(s.description).toContain('银发');
    expect(s.personality).toContain('话少');
    expect(s.scenario).toBe('边陲小镇的雨天。');
    expect(s.firstMessage).toContain('雨顺着屋檐');
    expect(s.postHistoryInstructions).toBe('保持第三人称。');
    expect(s.creatorNotes).toBe('原创角色。');
    expect(s.avatarPrompt).toBe('1boy, white hair, cloak');
    expect(coerceWorldInfo(s.worldInfo)).toHaveLength(1);
    expect(coerceRegexScripts(s.regexScripts)).toHaveLength(1);
  });

  it('accepts hashes from # to ###### and optional colons', () => {
    const text = '# Name：一\n### Description:\n二\n###### Personality\n三';
    const s = parseCardSections(text);
    expect(s.name).toBe('一');
    expect(s.description).toBe('二');
    expect(s.personality).toBe('三');
  });

  it('treats missing sections as empty', () => {
    const s = parseCardSections('## Name\n只有名字');
    expect(s.name).toBe('只有名字');
    expect(s.description).toBe('');
    expect(s.worldInfo).toEqual([]);
  });

  it('reads an <image> avatar block', () => {
    const s = parseCardSections('## Avatar Prompt\n<image>1girl, smile###</image>');
    expect(s.avatarPrompt).toBe('1girl, smile');
  });
});

describe('cleanFirstMessage', () => {
  it('strips bold markers', () => {
    expect(cleanFirstMessage('**他笑了。**')).toBe('他笑了。');
  });

  it('keeps inner text intact', () => {
    expect(cleanFirstMessage('**a** b **c**')).toBe('a b c');
  });
});

describe('coercers', () => {
  it('accepts an array, a wrapper, or a single object', () => {
    expect(coerceWorldInfo([{ a: 1 }])).toHaveLength(1);
    expect(coerceWorldInfo({ entries: [{ a: 1 }] })).toHaveLength(1);
    expect(coerceWorldInfo({ a: 1 })).toHaveLength(1);
    expect(coerceWorldInfo(null)).toEqual([]);
  });

  it('drops non-object entries', () => {
    expect(coerceRegexScripts([{ a: 1 }, null, 'x', 3])).toEqual([{ a: 1 }]);
  });
});

describe('cardGenProgress (P02)', () => {
  it('starts at 0 with no sections', () => {
    expect(cardGenProgress('')).toBe(0);
  });

  it('counts the 7 base sections toward 60%', () => {
    const text = ['## Name\nA', '## Description\nB', '## Personality\nC'].join('\n\n');
    // 3 of 7 base sections -> round(60*3/7) = 26
    expect(cardGenProgress(text)).toBe(26);
    const seen = cardGenSectionsSeen(text);
    expect(seen.baseDone).toBe(3);
    expect(seen.totalDone).toBe(3);
  });

  it('adds 20% once Regex Scripts appears, capped at 80% while streaming', () => {
    const base = ['## Name\nA', '## Description\nB', '## Personality\nC', '## Scenario\nD', '## First Message\nE', '## Post History Instructions\nF', '## Creator Notes\nG'].join('\n\n');
    expect(cardGenProgress(base)).toBe(60);
    expect(cardGenProgress(`${base}\n\n## Regex Scripts\n[]`)).toBe(80);
  });

  it('reaches 100% only when done', () => {
    expect(cardGenProgress('## Name\nA', true)).toBe(100);
    expect(cardGenProgress('', true)).toBe(100);
  });
});

describe('shouldRetryCardGen (P03)', () => {
  const full = SAMPLE;
  it('does not retry a complete Gemini reply', () => {
    expect(shouldRetryCardGen(full, 'gemini-2.5-flash')).toBe(false);
  });

  it('retries a Gemini reply missing the regex section', () => {
    const cut = full.split('## Regex Scripts')[0];
    expect(cardGenMissingParts(cut).missingRegex).toBe(true);
    expect(shouldRetryCardGen(cut, 'gemini-2.5-flash')).toBe(true);
  });

  it('retries a Gemini reply missing the avatar prompt', () => {
    const cut = full.replace('1boy, white hair, cloak', '');
    expect(cardGenMissingParts(cut).missingImage).toBe(true);
    expect(shouldRetryCardGen(cut, 'gemini-2.5-flash')).toBe(true);
  });

  it('never retries a non-Gemini model', () => {
    const cut = full.split('## Regex Scripts')[0];
    expect(shouldRetryCardGen(cut, 'gpt-4o')).toBe(false);
  });

  it('extracts output_reply tool content', () => {
    expect(extractOutputReplyContent({ name: 'output_reply', arguments: JSON.stringify({ content: '## Name\nA' }) })).toBe('## Name\nA');
    expect(extractOutputReplyContent({ name: 'other', arguments: '{}' })).toBeNull();
    expect(extractOutputReplyContent({ name: 'output_reply', arguments: 'not json' })).toBeNull();
  });
});
