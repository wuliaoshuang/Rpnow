import { describe, expect, it } from 'vitest';
import {
  dedupeChoices,
  formatKeywordResult,
  looksLikeUrl,
  parseToolCalls,
  pickChoice,
  randomInt,
  runRandomNumber,
  searchTranscript,
  secureRandomInt,
  toolSchemas,
  OUTPUT_REPLY_SCHEMA,
} from './engine.js';
import { executeTool, executeTools } from './provider.js';
import { DEFAULT_TOOL_SETTINGS } from './types.js';

const transcript = [
  { id: 'u1', role: 'user' as const, content: '今晚的约定，你还记得吗？' },
  { id: 'a1', role: 'assistant' as const, content: '当然记得，明晚在酒馆见面。' },
  { id: 'u2', role: 'user' as const, content: '那把剑还在吗？' },
  { id: 'a2', role: 'assistant' as const, content: '剑挂在墙上，和那天一样。' },
];

describe('searchTranscript', () => {
  it('finds case-insensitive matches with speaker and turn', () => {
    const hits = searchTranscript({
      query: '酒馆',
      messages: transcript,
      userName: '用户',
      characterName: '角色',
      maxResults: 5,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ turn: 1, role: 'assistant', speaker: '角色' });
    expect(hits[0].fragment).toContain('酒馆');
  });

  it('returns nothing for a miss', () => {
    expect(
      searchTranscript({ query: '不存在', messages: transcript, userName: 'u', characterName: 'c', maxResults: 5 }),
    ).toEqual([]);
  });

  it('respects maxResults', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: '重复 关键词 出现',
    }));
    const hits = searchTranscript({
      query: '关键词',
      messages: many,
      userName: 'u',
      characterName: 'c',
      maxResults: 3,
    });
    expect(hits.length).toBeLessThanOrEqual(3);
  });

  it('ignores system messages', () => {
    const withSystem = [
      { id: 's', role: 'system' as const, content: '关键词在系统里' },
      ...transcript,
    ];
    const hits = searchTranscript({ query: '关键词', messages: withSystem, userName: 'u', characterName: 'c', maxResults: 5 });
    // The system floor holds the only match and must not be searchable.
    expect(hits).toEqual([]);
  });

  it('formats hits for the model', () => {
    const text = formatKeywordResult([
      { turn: 2, role: 'user', speaker: '用户', fragment: '那把剑' },
    ]);
    expect(text).toContain('第 2 轮');
    expect(text).toContain('用户');
    expect(text).toContain('那把剑');
  });
});

describe('random_number', () => {
  it('stays within the inclusive bounds', () => {
    for (let i = 0; i < 200; i++) {
      const v = secureRandomInt(1, 6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('hits both endpoints over many draws', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) seen.add(secureRandomInt(1, 2));
    expect(seen).toEqual(new Set([1, 2]));
  });

  it('returns the single value when min === max', () => {
    expect(secureRandomInt(5, 5)).toBe(5);
  });

  it('rejects an inverted range', () => {
    expect(() => secureRandomInt(9, 1)).toThrow();
  });

  it('is roughly uniform across a 6-sided range', () => {
    const counts = new Array(7).fill(0);
    for (let i = 0; i < 6000; i++) counts[secureRandomInt(1, 6)]++;
    for (let face = 1; face <= 6; face++) {
      expect(counts[face]).toBeGreaterThan(800);
      expect(counts[face]).toBeLessThan(1200);
    }
  });

  it('randomInt accepts an injected source', () => {
    expect(randomInt(1, 10, () => 0)).toBe(1);
    expect(randomInt(1, 10, () => 0.999999)).toBe(10);
  });

  it('picks uniformly from deduplicated choices', () => {
    const choices = dedupeChoices([' Sword ', 'sword', '盾', '盾']);
    expect(choices).toEqual([' Sword ', '盾']);
    for (let i = 0; i < 50; i++) {
      expect([' Sword ', '盾']).toContain(pickChoice(choices, () => Math.random()));
    }
  });

  it('runRandomNumber supports both modes', () => {
    expect(runRandomNumber({ min: 1, max: 1 })).toContain('随机结果：1');
    expect(runRandomNumber({ choices: ['a', 'b', 'a'] })).toMatch(/随机结果：[ab]/);
    expect(() => runRandomNumber({})).toThrow();
  });
});

describe('tool schemas', () => {
  it('exposes only the enabled tools', () => {
    const schemas = toolSchemas(['keyword_dialogue']);
    expect(schemas).toHaveLength(1);
    expect(schemas[0].name).toBe('keyword_dialogue');
  });

  it('describes the random tool arguments', () => {
    const [schema] = toolSchemas(['random_number']);
    const props = (schema.parameters as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['min', 'max', 'choices']));
  });

  it('output_reply requires a content field', () => {
    const params = OUTPUT_REPLY_SCHEMA.function.parameters as unknown as { required: string[] };
    expect(params.required).toContain('content');
  });
});

describe('parseToolCalls', () => {
  it('parses string and object arguments', () => {
    const calls = parseToolCalls([
      { id: '1', function: { name: 'random_number', arguments: '{"min":1,"max":6}' } },
      { id: '2', function: { name: 'keyword_dialogue', arguments: { query: 'x' } } },
    ]);
    expect(calls[0].arguments).toEqual({ min: 1, max: 6 });
    expect(calls[1].arguments).toEqual({ query: 'x' });
  });

  it('survives malformed arguments', () => {
    const calls = parseToolCalls([{ id: '1', function: { name: 'x', arguments: '{oops' } }]);
    expect(calls[0].arguments).toEqual({});
  });

  it('skips entries without a name', () => {
    expect(parseToolCalls([{ id: '1', function: { arguments: '{}' } }])).toEqual([]);
  });
});

describe('url detection', () => {
  it('treats real URLs as pages to read', () => {
    expect(looksLikeUrl('https://example.com/a')).toBe(true);
    expect(looksLikeUrl('www.example.com')).toBe(true);
    expect(looksLikeUrl('今天天气怎么样')).toBe(false);
  });
});

describe('executeTool', () => {
  const base = {
    settings: DEFAULT_TOOL_SETTINGS,
    messages: transcript,
    userName: '用户',
    characterName: '角色',
  };

  it('runs keyword search without network', async () => {
    const res = await executeTool({ ...base, call: { id: 'c1', name: 'keyword_dialogue', arguments: { query: '剑' } } });
    expect(res.status).toBe('done');
    expect(res.content).toContain('第 2 轮');
  });

  it('fails cleanly when Tavily is unconfigured', async () => {
    const res = await executeTool({ ...base, call: { id: 'c2', name: 'web_search', arguments: { query: 'x' } } });
    expect(res.status).toBe('error');
    expect(res.content).toContain('Tavily');
  });

  it('calls /extract for URLs and /search otherwise', async () => {
    const seen: string[] = [];
    const fakeFetch = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ results: [{ title: 't', url: 'u', content: 'c' }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as unknown as typeof fetch;

    await executeTool({
      ...base,
      settings: { ...DEFAULT_TOOL_SETTINGS, tavilyKey: 'k' },
      call: { id: 'c3', name: 'web_search', arguments: { query: 'https://example.com' } },
      fetchImpl: fakeFetch,
    });
    expect(seen[0]).toContain('/extract');

    await executeTool({
      ...base,
      settings: { ...DEFAULT_TOOL_SETTINGS, tavilyKey: 'k' },
      call: { id: 'c4', name: 'web_search', arguments: { query: '天气' } },
      fetchImpl: fakeFetch,
    });
    expect(seen[1]).toContain('/search');
  });

  it('caps the number of executed calls', async () => {
    const calls = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, name: 'keyword_dialogue', arguments: { query: '剑' } }));
    const results = await executeTools(calls, base);
    expect(results).toHaveLength(DEFAULT_TOOL_SETTINGS.maxToolCalls);
  });

  it('reports unknown tools as errors', async () => {
    const res = await executeTool({ ...base, call: { id: 'x', name: 'nope', arguments: {} } });
    expect(res.status).toBe('error');
  });
});
