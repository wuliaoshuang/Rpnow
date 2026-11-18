import { describe, expect, it } from 'vitest';
import { buildPrompt, normalizeExamples, resolveOrder, runRegex, PM_DUMMY_ID_CHAT_COMPLETION } from './builder.js';
import { substituteMacros } from './macros.js';
import type { RPCard } from '../types/card.js';
import type { RPCompletionPreset } from '../types/preset.js';
import { BUILTIN_PRESETS } from '../defaults/presets.js';

function makeCard(over: Partial<RPCard['data']> = {}): RPCard {
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
      ...over,
    },
  };
}

const basePreset = (): RPCompletionPreset => structuredClone(BUILTIN_PRESETS[0]);

const history = [
  { role: 'user' as const, content: 'Hi there' },
  { role: 'assistant' as const, content: 'Welcome!' },
];

describe('normalizeExamples', () => {
  it('splits on <START> and substitutes names', () => {
    const out = normalizeExamples('<START>\n{{user}}: hi\n{{char}}: hello', 'Aria', 'Sam');
    expect(out).toContain('Sam: hi');
    expect(out).toContain('Aria: hello');
  });
  it('returns empty string for empty input', () => {
    expect(normalizeExamples('', 'A', 'B')).toBe('');
  });
});

describe('resolveOrder', () => {
  it('prefers the 100001 group', () => {
    const preset: RPCompletionPreset = {
      name: 'x',
      prompts: [],
      prompt_order: [
        { character_id: 100000, order: [{ identifier: 'a', enabled: true }] },
        { character_id: 100001, order: [{ identifier: 'b', enabled: true }] },
      ],
    };
    expect(resolveOrder(preset).order[0].identifier).toBe('b');
    expect(PM_DUMMY_ID_CHAT_COMPLETION).toBe(100001);
  });

  it('falls back to 100000 then to the first group', () => {
    const p2: RPCompletionPreset = {
      name: 'x',
      prompts: [],
      prompt_order: [{ character_id: 100000, order: [{ identifier: 'a', enabled: true }] }],
    };
    expect(resolveOrder(p2).order[0].identifier).toBe('a');
    const p3: RPCompletionPreset = {
      name: 'x',
      prompts: [],
      prompt_order: [{ character_id: 7, order: [{ identifier: 'z', enabled: true }] }],
    };
    expect(resolveOrder(p3).order[0].identifier).toBe('z');
  });
});

describe('buildPrompt — card/preset/worldbook relationship', () => {
  it('orders blocks per the preset and fills card content', () => {
    const res = buildPrompt({ card: makeCard(), preset: basePreset(), messages: history });
    const text = res.messages.map((m) => m.content).join('\n');
    expect(text).toContain('A bard.'); // description
    expect(text).toContain('Cheerful'); // personality
    expect(text).toContain('A tavern.'); // scenario
    expect(text).toContain('Write Aria\'s next reply'); // main prompt with macro
  });

  it('places chat history as real messages in order', () => {
    const res = buildPrompt({ card: makeCard(), preset: basePreset(), messages: history });
    const idxUser = res.messages.findIndex((m) => m.content === 'Hi there');
    const idxAsst = res.messages.findIndex((m) => m.content === 'Welcome!');
    expect(idxUser).toBeGreaterThan(-1);
    expect(idxAsst).toBe(idxUser + 1);
    expect(res.messages[idxUser].role).toBe('user');
    expect(res.messages[idxAsst].role).toBe('assistant');
  });

  it('lets the card system_prompt override the main block with {{original}}', () => {
    const card = makeCard({
      system_prompt: 'RULES. ORIGINAL: {{original}}',
    });
    const res = buildPrompt({ card, preset: basePreset(), messages: history });
    // Consecutive system blocks are merged into one message, so the override
    // shows up as part of a combined source label.
    const mainBlock = res.messages.find((m) => m.source?.includes('card:system_prompt'));
    expect(mainBlock).toBeDefined();
    expect(mainBlock!.content).toContain('RULES.');
    // {{original}} expands to the preset's own main text, macros already resolved.
    expect(mainBlock!.content).toContain('Write Aria\'s next reply');
  });

  it('ignores the card system_prompt when the user disabled the preference', () => {
    const card = makeCard({ system_prompt: 'RULES {{original}}' });
    const res = buildPrompt({
      card,
      preset: basePreset(),
      messages: history,
      preferCharacterPrompt: false,
    });
    expect(res.messages.some((m) => m.content.startsWith('RULES'))).toBe(false);
  });

  it('overrides the jailbreak block with post_history_instructions', () => {
    const card = makeCard({ post_history_instructions: 'BE TERSE.' });
    const res = buildPrompt({ card, preset: basePreset(), messages: history });
    const block = res.messages.find((m) => m.source === 'card:post_history_instructions');
    expect(block?.content).toBe('BE TERSE.');
  });

  it('injects world info before/after into their dedicated blocks', () => {
    const res = buildPrompt({
      card: makeCard(),
      preset: basePreset(),
      messages: history,
      worldInfo: { byPosition: new Map(), before: 'LORE-BEFORE', after: 'LORE-AFTER' },
    });
    const text = res.messages.map((m) => m.content).join('\n');
    expect(text).toContain('LORE-BEFORE');
    expect(text).toContain('LORE-AFTER');
  });

  it('injects atDepth world info at the requested depth from the end', () => {
    const res = buildPrompt({
      card: makeCard(),
      preset: basePreset(),
      messages: history,
      worldInfo: {
        byPosition: new Map([
          [4, [{ content: 'DEEP-LORE', comment: 'deep' }]],
        ]),
      },
    });
    const idx = res.messages.findIndex((m) => m.content.includes('DEEP-LORE'));
    expect(idx).toBeGreaterThan(-1);
    // Inserted near the end of the message array, not appended to the front.
    expect(idx).toBeGreaterThan(res.messages.length - 6);
  });

  it('resolves outlets via the provided lookup', () => {
    const res = buildPrompt({
      card: makeCard({ mes_example: '' }),
      preset: {
        ...basePreset(),
        prompts: [
          {
            identifier: 'main',
            name: 'main',
            system_prompt: true,
            role: 'system',
            content: 'OUTLET: {{outlet::Lore}}',
          },
          { identifier: 'chatHistory', name: 'h', system_prompt: false, role: 'user', marker: true },
        ],
        prompt_order: [
          {
            character_id: 100001,
            order: [
              { identifier: 'main', enabled: true },
              { identifier: 'chatHistory', enabled: true },
            ],
          },
        ],
      },
      messages: history,
      worldInfo: { byPosition: new Map(), outlets: (n) => (n === 'Lore' ? 'OUTLET-CONTENT' : '') },
    });
    expect(res.messages.map((m) => m.content).join('\n')).toContain('OUTLET-CONTENT');
  });

  it('drops the oldest history when over budget', () => {
    const long = Array.from({ length: 10 }, (_, i) => ({ role: 'user' as const, content: `m${i}-` + 'x'.repeat(50) }));
    const res = buildPrompt({
      card: makeCard(),
      preset: basePreset(),
      messages: long,
      historyBudgetChars: 200,
    });
    expect(res.droppedHistory).toBeGreaterThan(0);
    const text = res.messages.map((m) => m.content).join('\n');
    expect(text).not.toContain('m0-');
  });

  it('excludes hidden messages from the prompt', () => {
    const res = buildPrompt({
      card: makeCard(),
      preset: basePreset(),
      messages: [
        { role: 'user', content: 'visible-one' },
        { role: 'assistant', content: 'hidden-one', hidden: true },
      ],
    });
    const text = res.messages.map((m) => m.content).join('\n');
    expect(text).toContain('visible-one');
    expect(text).not.toContain('hidden-one');
  });

  it('reports a block breakdown for the inspector', () => {
    const res = buildPrompt({ card: makeCard(), preset: basePreset(), messages: history });
    expect(res.blocks.length).toBeGreaterThan(3);
    expect(res.blocks.some((b) => b.identifier === 'main' && b.enabled)).toBe(true);
    expect(res.totalChars).toBeGreaterThan(0);
  });

  it('discovers prompt entries missing from prompt_order', () => {
    const preset = basePreset();
    preset.prompt_order = [
      {
        character_id: 100001,
        order: [{ identifier: 'main', enabled: true }],
      },
    ];
    const res = buildPrompt({ card: makeCard(), preset, messages: history });
    // History still reaches the model even though the order omitted it.
    expect(res.messages.some((m) => m.content === 'Hi there')).toBe(true);
  });

  it('appends card dsh depth_prompt near the end', () => {
    const card = makeCard({
      extensions: { depth_prompt: { prompt: 'PERSISTENT-NOTE', depth: 1, role: 'system' } },
    });
    const res = buildPrompt({ card, preset: basePreset(), messages: history });
    expect(res.messages.some((m) => m.content.includes('PERSISTENT-NOTE'))).toBe(true);
  });
});

describe('regex scripts', () => {
  it('parses /pattern/flags form', () => {
    const out = runRegex(
      {
        id: 'r',
        scriptName: 'r',
        findRegex: '/<status>(.*?)<\\/status>/g',
        replaceString: '<div class="s">$1</div>',
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
      },
      'a <status>HP 5</status> b',
    );
    expect(out).toContain('<div class="s">HP 5</div>');
  });

  it('is a no-op on invalid regex', () => {
    const out = runRegex(
      {
        id: 'r',
        scriptName: 'r',
        findRegex: '/(/g',
        replaceString: 'x',
        placement: [2],
        disabled: false,
        markdownOnly: true,
        promptOnly: false,
      },
      'unchanged',
    );
    expect(out).toBe('unchanged');
  });
});

describe('macros', () => {
  const ctx = { char: 'Aria', user: 'Sam', charIfNotGroup: 'Aria' };

  it('substitutes identity macros', () => {
    expect(substituteMacros('{{char}} loves {{user}}', ctx)).toBe('Aria loves Sam');
  });

  it('leaves unknown macros intact instead of deleting them', () => {
    expect(substituteMacros('keep {{unknownMacro}} here', ctx)).toContain('{{unknownMacro}}');
  });

  it('handles random/pick/roll', () => {
    expect(['a', 'b']).toContain(substituteMacros('{{random::a::b}}', ctx));
    expect(substituteMacros('{{pick::a::b}}', ctx)).toBe(substituteMacros('{{pick::a::b}}', ctx));
    expect(Number(substituteMacros('{{roll:1d1}}', ctx))).toBe(1);
  });

  it('resolves variables and setvar produces nothing', () => {
    const vars: Record<string, string> = { hp: '10' };
    const out = substituteMacros('{{getvar::hp}}{{setvar::hp::9}}', {
      ...ctx,
      getvar: (k) => vars[k],
      setvar: (k, v) => {
        vars[k] = v;
      },
    });
    expect(out).toBe('10');
    expect(vars.hp).toBe('9');
  });

  it('strips comments and noop', () => {
    expect(substituteMacros('a{{// hidden}}b{{noop}}', ctx)).toBe('ab');
  });

  it('treats charIfNotGroup as an alias of group', () => {
    expect(substituteMacros('{{charIfNotGroup}}', { char: 'Aria', user: 'S', charIfNotGroup: '' })).toBe('Aria');
    expect(substituteMacros('{{group}}', { char: 'Aria', user: 'S', charIfNotGroup: '', group: 'A, B' })).toBe('A, B');
  });

  it('replaces legacy <USER>/<BOT> tags', () => {
    expect(substituteMacros('<USER> meets <BOT>', ctx)).toBe('Sam meets Aria');
  });
});
