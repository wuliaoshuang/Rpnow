import { describe, expect, it } from 'vitest';
import { scopeCss } from './scoped-styles.js';

const host = '[data-rp-scope="test"]';
const run = (css: string) => scopeCss(css, { pluginId: 'test', hostSelector: host });

describe('scopeCss — selector scoping', () => {
  it('appends the scope attribute to a class selector', () => {
    expect(run('.foo { color: red }')).toMatch(/\.foo\[data-rp-scope\]\s*\{\s*color: red\s*\}/);
  });

  it('rewrites html/body/:root to the scope host', () => {
    const out = run('body { padding: 3px } html { margin: 1px } :root { --x: 1 }');
    // None of the raw root selectors may survive.
    expect(out).not.toMatch(/(^|[{;])\s*body\s*\{/);
    expect(out).not.toMatch(/(^|[{;])\s*html\s*\{/);
    expect(out).not.toMatch(/:root\s*\{/);
    expect(out.match(/\[data-rp-scope="test"\]/g)?.length).toBe(3);
  });

  it('drops leading root refs but keeps the descendant part', () => {
    const out = run('html body .inner { color: red }');
    expect(out).toMatch(/\.inner\[data-rp-scope\]\s*\{\s*color: red\s*\}/);
  });

  it('scopes every selector in a list', () => {
    const out = run('.a, .b { color: red }');
    expect(out).toContain('.a[data-rp-scope]');
    expect(out).toContain('.b[data-rp-scope]');
  });

  it('does not split on commas inside :is()', () => {
    const out = run(':is(.a, .b) { color: red }');
    expect(out).toContain(':is(.a, .b)[data-rp-scope]');
  });

  it('descends into @media and scopes the inner rules', () => {
    const out = run('@media (min-width: 600px) { .wide { color: red } }');
    expect(out).toContain('@media (min-width: 600px)');
    expect(out).toContain('.wide[data-rp-scope]');
  });

  it('namespaces @keyframes and animation names', () => {
    const out = run('@keyframes pulse { from { opacity: 0 } } .x { animation: 1s pulse }');
    expect(out).toContain('@keyframes rp-test-pulse');
    expect(out).toContain('rp-test-pulse');
    expect(out).not.toMatch(/@keyframes pulse\b/);
  });

  it('leaves @font-face untouched', () => {
    const out = run('@font-face { font-family: X; src: url(a.woff2) } .y { color: red }');
    expect(out).toContain('@font-face');
    expect(out).toContain('.y[data-rp-scope]');
  });

  it('strips comments so they cannot smuggle rules', () => {
    const out = run('/* body { padding: 9px } */ .z { color: red }');
    expect(out).not.toContain('padding: 9px');
    expect(out).toContain('.z[data-rp-scope]');
  });

  it('drops @import (it would load unscoped CSS)', () => {
    const out = run('@import url("evil.css"); .q { color: red }');
    expect(out).not.toContain('evil.css');
  });

  it('scopes minified one-line sheets', () => {
    const out = run('.a{color:red}.b{color:blue}body{margin:2px}');
    expect(out).toContain('.a[data-rp-scope]{color:red}');
    expect(out).toContain('.b[data-rp-scope]{color:blue}');
    expect(out).not.toMatch(/(^|})body\{/);
  });

  it('never lets a plugin rule target the real body', () => {
    const out = run('body, html, * { padding: 3px !important }');
    // The literal `body {` / `html {` must not appear as a standalone rule.
    expect(out).not.toMatch(/(^|\})\s*body\b/);
    expect(out).not.toMatch(/(^|\})\s*html\b/);
  });
});
