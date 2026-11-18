import { describe, expect, it } from 'vitest';
import {
  diffVariables,
  escapeHtml,
  parseTemplate,
  parseUpdates,
  renderTemplate,
  resolvePath,
  stripUpdateBlocks,
  validateVariables,
} from './engine.js';

describe('interpolation', () => {
  it('renders a dotted path', () => {
    expect(renderTemplate('{{user.name}}', { user: { name: '阿尔' } })).toBe('阿尔');
  });

  it('escapes HTML in values', () => {
    expect(renderTemplate('{{x}}', { x: '<script>"&\'' })).toBe(
      '&lt;script&gt;&quot;&amp;&#39;',
    );
  });

  it('escapes the same set escapeHtml covers', () => {
    expect(escapeHtml('<b>=`')).toBe('&lt;b&gt;&#61;&#96;');
  });

  it('renders missing values as empty by default', () => {
    expect(renderTemplate('a{{missing}}b', {})).toBe('ab');
  });

  it('supports bracket access and $root', () => {
    expect(renderTemplate("{{a['b c']}}", { a: { 'b c': 1 } })).toBe('1');
    expect(renderTemplate('{{#each items as i}}{{$root.suffix}}{{/each}}', {
      suffix: '!',
      items: [1],
    })).toBe('!');
  });

  it('renders arrays as a comma list', () => {
    expect(renderTemplate('{{list}}', { list: [1, 2, 3] })).toBe('1, 2, 3');
  });

  it('renders numbers and booleans', () => {
    expect(renderTemplate('{{n}}/{{b}}', { n: 3, b: false })).toBe('3/false');
  });
});

describe('#each', () => {
  it('iterates with an alias', () => {
    const html = renderTemplate('{{#each items as item}}{{item.name}},{{/each}}', {
      items: [{ name: 'a' }, { name: 'b' }],
    });
    expect(html).toBe('a,b,');
  });

  it('exposes loop locals', () => {
    const html = renderTemplate(
      '{{#each items as i}}{{@index}}{{@first}}{{@last}}{{/each}}',
      { items: ['a', 'b', 'c'] },
    );
    expect(html).toBe('0truefalse1falsefalse2falsetrue');
  });

  it('supports @number (1-based)', () => {
    expect(renderTemplate('{{#each items as i}}{{@number}}{{/each}}', { items: ['a', 'b'] })).toBe('12');
  });

  it('renders the else branch for an empty list', () => {
    expect(renderTemplate('{{#each items as i}}{{i}}{{else}}没有{{/each}}', { items: [] })).toBe('没有');
  });

  it('treats a missing list as empty', () => {
    expect(renderTemplate('{{#each nope as i}}{{i}}{{else}}空{{/each}}', {})).toBe('空');
  });

  it('nests loops', () => {
    const html = renderTemplate(
      '{{#each rows as row}}{{#each row as cell}}{{cell}};{{/each}}{{/each}}',
      { rows: [[1, 2], [3]] },
    );
    expect(html).toBe('1;2;3;');
  });

  it('resolves bare keys against the item first', () => {
    const html = renderTemplate('{{#each items as i}}{{name}}{{/each}}', {
      name: 'outer',
      items: [{ name: 'inner' }, {}],
    });
    expect(html).toBe('innerouter');
  });

  it('climbs scopes with ../', () => {
    const html = renderTemplate('{{#each rows as r}}{{#each r as c}}{{../@index}}{{/each}}{{/each}}', {
      rows: [[1, 2], [3]],
    });
    expect(html).toBe('001');
  });

  it('refuses to exceed the nesting limit', () => {
    let template = '';
    for (let i = 0; i < 60; i++) template += '{{#each a as x}}';
    template += 'x';
    for (let i = 0; i < 60; i++) template += '{{/each}}';
    // Should terminate rather than throw or hang.
    expect(() => renderTemplate(template, { a: [1] })).not.toThrow();
  });

  it('keeps malformed blocks visible', () => {
    expect(renderTemplate('{{#each items}}', { items: [1] })).toBe('{{#each items}}');
  });
});

describe('parseTemplate', () => {
  it('produces text and interp nodes', () => {
    const nodes = parseTemplate('a{{x}}b');
    expect(nodes).toHaveLength(3);
    expect(nodes[0]).toEqual({ type: 'text', text: 'a' });
    expect(nodes[1]).toEqual({ type: 'interp', path: 'x' });
  });
});

describe('resolvePath', () => {
  it('handles this', () => {
    expect(resolvePath('this', [{ a: 1 }])).toEqual({ found: true, value: { a: 1 } });
  });

  it('reports a miss for null intermediates', () => {
    expect(resolvePath('a.b', [{ a: null }]).found).toBe(false);
  });
});

describe('model updates', () => {
  it('parses a single object', () => {
    const out = parseUpdates('正文<ui_template_updates>{"id":"t1","variables":{"hp":5}}</ui_template_updates>');
    expect(out).toEqual([{ id: 't1', variables: { hp: 5 } }]);
  });

  it('parses an array (required for multiple templates)', () => {
    const out = parseUpdates(
      '<ui_template_updates>[{"id":"a","variables":{"x":1}},{"id":"b","variables":{"y":2}}]</ui_template_updates>',
    );
    expect(out).toHaveLength(2);
    expect(out![1]).toEqual({ id: 'b', variables: { y: 2 } });
  });

  it('returns null when there is no block', () => {
    expect(parseUpdates('普通回复')).toBeNull();
  });

  it('ignores malformed JSON blocks', () => {
    expect(parseUpdates('<ui_template_updates>{oops</ui_template_updates>')).toBeNull();
  });

  it('requires an id', () => {
    expect(parseUpdates('<ui_template_updates>{"variables":{"x":1}}</ui_template_updates>')).toBeNull();
  });

  it('strips blocks from the stored reply', () => {
    const text = '正文<ui_template_updates>{"id":"t","variables":{}}</ui_template_updates>结尾';
    expect(stripUpdateBlocks(text)).toBe('正文结尾');
  });
});

describe('validation', () => {
  it('rejects undeclared keys', () => {
    const errors = validateVariables({ nope: 1 }, { known: 1 }, {});
    expect(errors[0].message).toContain('nope');
  });

  it('accepts keys from the initial state', () => {
    expect(validateVariables({ known: 2 }, { known: 1 }, {})).toEqual([]);
  });

  it('checks declared types', () => {
    const errors = validateVariables({ hp: '5' }, {}, { hp: 'number' });
    expect(errors[0].message).toContain('number');
  });

  it('treats arrays as array type', () => {
    expect(validateVariables({ list: [] }, {}, { list: 'array' })).toEqual([]);
    expect(validateVariables({ list: 'x' }, {}, { list: 'array' })).toHaveLength(1);
  });
});

describe('diffVariables', () => {
  it('records changed, added and removed keys', () => {
    const diff = diffVariables({ a: 1, b: 2, c: 3 }, { a: 1, b: 9, d: 4 });
    expect(diff.b).toEqual({ from: 2, to: 9 });
    expect(diff.c).toEqual({ from: 3, to: undefined });
    expect(diff.d).toEqual({ from: undefined, to: 4 });
    expect(diff.a).toBeUndefined();
  });
});
