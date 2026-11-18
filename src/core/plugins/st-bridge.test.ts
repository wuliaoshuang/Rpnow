import { describe, expect, it } from 'vitest';
import {
  looksLikeSTExtension,
  resolveEntryPath,
  resolveStylePath,
  stDisplayName,
  stPluginId,
} from './st-manifest.js';

describe('looksLikeSTExtension', () => {
  it('accepts a manifest that declares js', () => {
    expect(looksLikeSTExtension({ display_name: '酒馆助手', js: 'index.js' })).toBe(true);
  });

  it('accepts css-only and main-style manifests', () => {
    expect(looksLikeSTExtension({ css: 'style.css' })).toBe(true);
    expect(looksLikeSTExtension({ main: 'src/index.js' })).toBe(true);
  });

  it('rejects an .rpnx manifest (id + entry)', () => {
    expect(looksLikeSTExtension({ id: 'x.y', entry: 'plugin.js' })).toBe(false);
  });

  it('rejects non-objects', () => {
    expect(looksLikeSTExtension(null)).toBe(false);
    expect(looksLikeSTExtension('nope')).toBe(false);
  });
});

describe('resolveEntryPath', () => {
  it('prefers js over main and entry', () => {
    expect(resolveEntryPath({ js: 'a.js', main: 'b.js', entry: 'c.js' })).toBe('a.js');
  });

  it('strips a leading ./', () => {
    expect(resolveEntryPath({ js: './dist/index.js' })).toBe('dist/index.js');
  });

  it('falls back to index.js', () => {
    expect(resolveEntryPath({ css: 'x.css' })).toBe('index.js');
  });
});

describe('resolveStylePath', () => {
  it('returns null when absent', () => {
    expect(resolveStylePath({ js: 'index.js' })).toBeNull();
  });

  it('takes the first entry of an array', () => {
    expect(resolveStylePath({ css: ['a.css', 'b.css'] })).toBe('a.css');
  });

  it('strips ./', () => {
    expect(resolveStylePath({ css: './style.css' })).toBe('style.css');
  });
});

describe('stDisplayName', () => {
  it('prefers display_name', () => {
    expect(stDisplayName({ display_name: '酒馆助手', name: 'tavern-helper' })).toBe('酒馆助手');
  });

  it('falls back to a placeholder', () => {
    expect(stDisplayName({})).toBe('未命名扩展');
  });
});

describe('stPluginId', () => {
  it('slugifies the name', () => {
    expect(stPluginId({ name: 'Tavern Helper' })).toBe('st.tavern-helper');
  });

  it('is stable for the same input', () => {
    const a = stPluginId({ name: 'tavern_helper' });
    const b = stPluginId({ name: 'tavern_helper' });
    expect(a).toBe(b);
    expect(a.startsWith('st.tavern-helper')).toBe(true);
  });
});
