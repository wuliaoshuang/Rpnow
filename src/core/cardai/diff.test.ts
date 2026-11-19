import { describe, expect, it } from 'vitest';
import {
  describeCardForEdit,
  diffCard,
  EDIT_TEXT_FIELDS,
  isTruncatedFinishReason,
  parseCardDiff,
  snapshotCardForEdit,
} from './diff.js';
import type { RPCard } from '../types/card.js';

function card(over: Partial<RPCard['data']> = {}): RPCard {
  return {
    id: 'c1',
    spec: 'v2',
    specVersion: '2.0',
    createdAt: 0,
    updatedAt: 0,
    data: {
      name: '阿尔',
      description: '剑士',
      personality: '冷',
      scenario: '',
      first_mes: '你好',
      mes_example: '',
      character_book: {
        name: '世界书',
        entries: [
          {
            id: 'w1',
            comment: '小镇',
            content: '边陲小镇',
            enabled: true,
            position: 0,
            order: 10,
            depth: 4,
            keys: ['小镇'],
            constant: false,
            useRegex: false,
            probability: 100,
          } as never,
        ],
      },
      extensions: {
        regex_scripts: [
          {
            scriptName: '隐藏',
            findRegex: '/(x)/g',
            replaceString: '',
            placement: 1,
            markdownOnly: false,
            promptOnly: false,
            enabled: true,
          },
        ],
      },
      ...over,
    },
  };
}

describe('parseCardDiff', () => {
  it('parses all three groups', () => {
    const { diff, error } = parseCardDiff({
      fields: [{ id: '1', text: '新名字' }],
      world_info: [{ id: 'W1', content: '新内容' }],
      regex_scripts: [{ id: 'R+', name: '新脚本', regex: '/(y)/' }],
    });
    expect(error).toBeUndefined();
    expect(diff!.fields).toHaveLength(1);
    expect(diff!.worldInfo).toHaveLength(1);
    expect(diff!.regex).toHaveLength(1);
  });

  it('rejects duplicate ids', () => {
    expect(parseCardDiff({ fields: [{ id: '1', text: 'a' }, { id: '1', text: 'b' }] }).error).toContain('重复提交');
  });

  it('rejects out-of-range text field ids', () => {
    expect(parseCardDiff({ fields: [{ id: '9', text: 'a' }] }).error).toContain('不存在');
  });

  it('rejects an empty payload', () => {
    expect(parseCardDiff({}).error).toContain('格式错误');
    expect(parseCardDiff(null).error).toContain('格式错误');
  });

  it('allows additions with W+/R+', () => {
    const { diff, error } = parseCardDiff({
      world_info: [{ id: 'W+', comment: '新', content: '内容' }],
      regex_scripts: [{ id: 'R+', name: 'n', regex: '/z/' }],
    });
    expect(error).toBeUndefined();
    expect(diff!.worldInfo[0].id).toBe('W+');
    expect(diff!.regex[0].id).toBe('R+');
  });
});

describe('diffCard', () => {
  it('changes a text field and reports it', () => {
    const { diff } = parseCardDiff({ fields: [{ id: '1', text: '新名字' }] })!;
    const { card: next, changes } = diffCard(card(), diff!);
    expect(next.data.name).toBe('新名字');
    expect(changes).toHaveLength(1);
    expect(changes[0].original).toBe('阿尔');
    expect(changes[0].modified).toBe('新名字');
  });

  it('ignores no-op changes', () => {
    const { diff } = parseCardDiff({ fields: [{ id: '1', text: '阿尔' }] })!;
    expect(diffCard(card(), diff!).changes).toEqual([]);
  });

  it('renames a world-info entry and keeps name in sync', () => {
    const { diff } = parseCardDiff({ world_info: [{ id: 'W1', comment: '雨镇' }] })!;
    const { card: next, changes } = diffCard(card(), diff!);
    expect(next.data.character_book?.entries?.[0].comment).toBe('雨镇');
    expect(next.data.character_book?.entries?.[0].name).toBe('雨镇');
    expect(changes.length).toBeGreaterThan(0);
  });

  it('deletes a world-info entry', () => {
    const { diff } = parseCardDiff({ world_info: [{ id: 'W1', delete: true }] })!;
    expect(diffCard(card(), diff!).card.data.character_book?.entries).toHaveLength(0);
  });

  it('adds a world-info entry', () => {
    const { diff } = parseCardDiff({
      world_info: [{ id: 'W+', comment: '新', content: '内容', keys: 'a, b' }],
    })!;
    const entries = diffCard(card(), diff!).card.data.character_book?.entries ?? [];
    expect(entries).toHaveLength(2);
    expect(entries[1].comment).toBe('新');
    expect(entries[1].keys).toEqual(['a', 'b']);
  });

  it('adds a regex script', () => {
    const { diff } = parseCardDiff({ regex_scripts: [{ id: 'R+', name: 'n', regex: '/z/' }] })!;
    expect(diffCard(card(), diff!).card.data.extensions?.regex_scripts).toHaveLength(2);
  });

  it('deletes a regex script', () => {
    const { diff } = parseCardDiff({ regex_scripts: [{ id: 'R1', delete: true }] })!;
    expect(diffCard(card(), diff!).card.data.extensions?.regex_scripts ?? []).toHaveLength(0);
  });

  it('updates first_mes through field 4', () => {
    const { diff } = parseCardDiff({ fields: [{ id: '4', text: '新的开场白' }] })!;
    expect(diffCard(card(), diff!).card.data.first_mes).toBe('新的开场白');
  });

  it('maps every text field id', () => {
    EDIT_TEXT_FIELDS.forEach((key, i) => {
      const { diff } = parseCardDiff({ fields: [{ id: String(i + 1), text: `v${i}` }] })!;
      const { card: next } = diffCard(card(), diff!);
      expect((next.data as unknown as Record<string, unknown>)[key]).toBe(`v${i}`);
    });
  });
});

describe('diffCard change shape', () => {
  it('tags text-field changes with kind and field', () => {
    const { diff } = parseCardDiff({ fields: [{ id: '4', text: '新的开场白' }] })!;
    const { changes } = diffCard(card(), diff!);
    expect(changes).toHaveLength(1);
    expect(changes[0].kind).toBe('field');
    expect(changes[0].field).toBe('first_mes');
  });

  it('tags world-info and regex changes with kind', () => {
    const { diff } = parseCardDiff({
      world_info: [{ id: 'W1', content: '新内容' }],
      regex_scripts: [{ id: 'R1', name: '新名' }],
    })!;
    const { changes } = diffCard(card(), diff!);
    expect(changes.map((c) => c.kind)).toEqual(['worldInfo', 'regex']);
    expect(changes.every((c) => c.field === undefined)).toBe(true);
  });
});

describe('isTruncatedFinishReason', () => {
  it('treats length and max_tokens as truncated', () => {
    expect(isTruncatedFinishReason('length')).toBe(true);
    expect(isTruncatedFinishReason('max_tokens')).toBe(true);
  });

  it('treats stop / tool_calls / undefined as fine', () => {
    expect(isTruncatedFinishReason('stop')).toBe(false);
    expect(isTruncatedFinishReason('tool_calls')).toBe(false);
    expect(isTruncatedFinishReason(undefined)).toBe(false);
  });
});

describe('snapshotCardForEdit', () => {
  it('is stable for the same card', () => {
    const c = card();
    expect(snapshotCardForEdit(c, c)).toBe(snapshotCardForEdit(card(), card()));
  });

  it('moves when the live draft changes', () => {
    const c = card();
    const edited = card({ personality: '温柔' });
    expect(snapshotCardForEdit(edited, c)).not.toBe(snapshotCardForEdit(c, c));
  });

  it('moves when the saved card changes even if the draft did not', () => {
    const c = card();
    const savedMoved = card({ personality: '温柔' });
    expect(snapshotCardForEdit(c, savedMoved)).not.toBe(snapshotCardForEdit(c, c));
  });

  it('ignores updatedAt / favorite, which change without content changing', () => {
    const c = card();
    const touched = { ...card(), updatedAt: 99999, favorite: true };
    expect(snapshotCardForEdit(touched, touched)).toBe(snapshotCardForEdit(c, c));
  });

  it('moves when a world-info entry changes', () => {
    const c = card();
    const edited = card();
    (edited.data.character_book!.entries![0] as unknown as Record<string, unknown>).content = '雨镇';
    expect(snapshotCardForEdit(edited, c)).not.toBe(snapshotCardForEdit(c, c));
  });
});

describe('describeCardForEdit', () => {
  it('numbers fields, entries and scripts', () => {
    const text = describeCardForEdit(card());
    expect(text).toContain('1. 角色卡名称');
    expect(text).toContain('W1.');
    expect(text).toContain('R1.');
  });
});
