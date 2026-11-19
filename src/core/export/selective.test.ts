import { describe, expect, it } from 'vitest';
import {
  loreItemId,
  lorebookExportDoc,
  regexItemId,
  regexScriptsExportDoc,
  selectiveCard,
  uiTemplatesExportDoc,
} from './selective.js';
import type { RPCard, RPRegexScript } from '../types/card.js';
import { createTemplate } from '../uitemplate/types.js';

function makeCard(): RPCard {
  return {
    id: 'card1',
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 1,
    updatedAt: 1,
    data: {
      name: '测试卡',
      description: 'd',
      personality: 'p',
      scenario: '',
      first_mes: 'hi',
      mes_example: '',
      creator_notes: '',
      system_prompt: '',
      post_history_instructions: '',
      tags: [],
      extensions: {
        regex_scripts: [
          { id: 'r1', scriptName: '去A', findRegex: 'a', replaceString: '', placement: [2], disabled: false, markdownOnly: false, promptOnly: false },
          { id: 'r2', scriptName: '去B', findRegex: 'b', replaceString: '', placement: [1], disabled: false, markdownOnly: false, promptOnly: false },
        ] as RPRegexScript[],
      },
      character_book: {
        name: '世界书',
        entries: [
          { comment: '条目一', content: 'c1', keys: ['k1'] },
          { comment: '条目二', content: 'c2', keys: ['k2'] },
        ],
      },
    },
  } as unknown as RPCard;
}

describe('selectiveCard (P10)', () => {
  it('keeps only the selected lorebook entries and regex scripts', () => {
    const card = makeCard();
    const out = selectiveCard(card, [loreItemId(1)], [regexItemId((card.data.extensions?.regex_scripts as RPRegexScript[])[0])]);
    expect(out.data.character_book?.entries).toHaveLength(1);
    expect((out.data.character_book?.entries[0] as { comment: string }).comment).toBe('条目二');
    expect((out.data.extensions?.regex_scripts as RPRegexScript[])).toHaveLength(1);
    expect((out.data.extensions?.regex_scripts as RPRegexScript[])[0].scriptName).toBe('去A');
    // The source card is untouched.
    expect(card.data.character_book?.entries).toHaveLength(2);
  });

  it('drops the book and the regex key when nothing is selected', () => {
    const out = selectiveCard(makeCard(), [], []);
    expect(out.data.character_book).toBeUndefined();
    expect(out.data.extensions?.regex_scripts).toBeUndefined();
    expect(out.data.name).toBe('测试卡');
  });
});

describe('export docs (O07)', () => {
  it('wraps UI templates in {type, templates}', () => {
    const doc = uiTemplatesExportDoc([createTemplate({ name: '状态栏' })]);
    expect(doc.type).toBe('ui-template');
    expect((doc.templates as unknown[])).toHaveLength(1);
  });

  it('wraps a lorebook as {name, entries}', () => {
    const doc = lorebookExportDoc({ id: 'lb1', name: '书', description: '', entries: [], createdAt: 1, updatedAt: 1 } as never);
    expect(doc.name).toBe('书');
    expect(doc.entries).toEqual([]);
  });

  it('exports regex scripts as plain entries', () => {
    const docs = regexScriptsExportDoc([
      { id: 'r1', scriptName: 'A', findRegex: 'a', replaceString: '', placement: [2], disabled: false, markdownOnly: false, promptOnly: true, minDepth: null, maxDepth: null },
    ]);
    expect(docs[0].scriptName).toBe('A');
    expect(docs[0].promptOnly).toBe(true);
  });
});
