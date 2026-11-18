import { describe, expect, it, vi } from 'vitest';
import { ServiceRegistry } from './registry.js';
import type { PluginManifest, RPPlugin, RPPluginContext } from './kernel-types.js';

const manifest = (over: Partial<PluginManifest> & { id: string }): PluginManifest => ({
  name: over.id,
  version: '1.0.0',
  apiVersion: 1,
  host: 'host',
  ...over,
});

function plugin(m: PluginManifest, apply: (ctx: RPPluginContext) => unknown): RPPlugin {
  return {
    manifest: m,
    // Discard whatever the body returns: these tests exercise kernel lifecycle,
    // not cleanup-handle plumbing.
    apply: (ctx) => {
      apply(ctx);
    },
  };
}

describe('ServiceRegistry', () => {
  it('activates a plugin that satisfies its dependencies', async () => {
    const k = new ServiceRegistry();
    let activated = false;
    k.register(manifest({ id: 'a', provides: ['svc'] }), async () =>
      plugin(manifest({ id: 'a' }), (ctx) => {
        activated = true;
        ctx.provide('svc', 42);
      }),
    );
    await k.sync();
    expect(activated).toBe(true);
    expect(k.get('svc')).toBe(42);
    expect(k.record('a')?.state).toBe('active');
  });

  it('leaves a plugin pending when a dependency is missing', async () => {
    const k = new ServiceRegistry();
    k.register(manifest({ id: 'b', uses: ['nope'] }), async () =>
      plugin(manifest({ id: 'b' }), () => {}),
    );
    await k.sync();
    expect(k.record('b')?.state).toBe('pending');
    expect(k.record('b')?.error).toContain('nope');
  });

  it('activates dependents once the dependency appears', async () => {
    const k = new ServiceRegistry();
    k.register(manifest({ id: 'dep', provides: ['svc'] }), async () =>
      plugin(manifest({ id: 'dep' }), (ctx) => ctx.provide('svc', 'x')),
    );
    let got: unknown;
    k.register(manifest({ id: 'user', uses: ['svc'] }), async () =>
      plugin(manifest({ id: 'user' }), (ctx) => {
        got = ctx.get('svc');
      }),
    );
    await k.sync();
    expect(got).toBe('x');
    expect(k.record('user')?.state).toBe('active');
  });

  it('cascades deactivation to dependents before the provider', async () => {
    const k = new ServiceRegistry();
    const order: string[] = [];
    k.register(manifest({ id: 'dep', provides: ['svc'] }), async () =>
      plugin(manifest({ id: 'dep' }), (ctx) => {
        ctx.use(() => order.push('dep-disposed'));
        ctx.provide('svc', 1);
      }),
    );
    k.register(manifest({ id: 'user', uses: ['svc'] }), async () =>
      plugin(manifest({ id: 'user' }), (ctx) => {
        ctx.use(() => order.push('user-disposed'));
      }),
    );
    await k.sync();
    await k.deactivate('dep');
    // Dependents are torn down before the provider they rely on.
    expect(order).toEqual(['user-disposed', 'dep-disposed']);
    expect(k.record('user')?.state).toBe('registered');
    // The cascaded plugin is re-activatable once the dependency returns.
    await k.activate('dep');
    await k.sync();
    expect(k.record('user')?.state).toBe('active');
  });

  it('restores the displaced service when an override is disposed', async () => {
    const k = new ServiceRegistry();
    k.register(manifest({ id: 'base', provides: ['theme'] }), async () =>
      plugin(manifest({ id: 'base' }), (ctx) => ctx.provide('theme', 'default-theme')),
    );
    await k.sync();
    expect(k.get('theme')).toBe('default-theme');

    let release: (() => void) | undefined;
    k.register(manifest({ id: 'override', provides: ['theme'] }), async () =>
      plugin(manifest({ id: 'override' }), (ctx) => {
        const handle = ctx.provide('theme', 'fancy-theme');
        release = () => handle.dispose();
      }),
    );
    await k.sync();
    expect(k.get('theme')).toBe('fancy-theme');

    release!();
    expect(k.get('theme')).toBe('default-theme');
  });

  it('marks a plugin failed when apply throws and releases its services', async () => {
    const k = new ServiceRegistry();
    k.register(manifest({ id: 'bad', provides: ['thing'] }), async () =>
      plugin(manifest({ id: 'bad' }), (ctx) => {
        ctx.provide('thing', 'partial');
        throw new Error('boom');
      }),
    );
    await k.sync();
    expect(k.record('bad')?.state).toBe('failed');
    expect(k.record('bad')?.error).toContain('boom');
    expect(k.get('thing')).toBeUndefined();
  });

  it('marks a plugin failed when its factory rejects', async () => {
    const k = new ServiceRegistry();
    k.register(manifest({ id: 'nofactory' }), async () => {
      throw new Error('cannot import');
    });
    await k.sync();
    expect(k.record('nofactory')?.state).toBe('failed');
  });

  it('notifies observers when a service is provided and released', async () => {
    const k = new ServiceRegistry();
    const seen: unknown[] = [];
    k.observe('svc', (v) => seen.push(v));
    k.register(manifest({ id: 'p', provides: ['svc'] }), async () =>
      plugin(manifest({ id: 'p' }), (ctx) => ctx.provide('svc', 'v1')),
    );
    await k.sync();
    await k.deactivate('p');
    expect(seen).toEqual(['v1', undefined]);
  });

  it('respects the enabled flag', async () => {
    const k = new ServiceRegistry();
    k.register(
      manifest({ id: 'off', provides: ['x'] }),
      async () => plugin(manifest({ id: 'off' }), (ctx) => ctx.provide('x', 1)),
      'builtin',
      false,
    );
    await k.sync();
    expect(k.record('off')?.state).toBe('registered');
    expect(k.get('x')).toBeUndefined();
  });

  it('classifies builtins vs installed plugins', async () => {
    const k = new ServiceRegistry();
    k.register(manifest({ id: 'rpnow.core.llm' }), async () => plugin(manifest({ id: 'rpnow.core.llm' }), () => {}));
    k.register(manifest({ id: 'user.plugin' }), async () => plugin(manifest({ id: 'user.plugin' }), () => {}));
    expect(k.record('rpnow.core.llm')?.origin).toBe('builtin');
    expect(k.record('user.plugin')?.origin).toBe('installed');
  });

  it('rejects duplicate plugin ids', () => {
    const k = new ServiceRegistry();
    const f = async () => plugin(manifest({ id: 'dup' }), () => {});
    k.register(manifest({ id: 'dup' }), f);
    expect(() => k.register(manifest({ id: 'dup' }), f)).toThrow(/duplicate/);
  });

  it('delivers events to subscribers and isolates throwing handlers', async () => {
    const k = new ServiceRegistry();
    const log: unknown[] = [];
    k.events.on('ping', () => {
      throw new Error('handler failed');
    });
    k.events.on('ping', (p) => log.push(p));
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    k.events.emit('ping', { n: 1 });
    errSpy.mockRestore();
    expect(log).toEqual([{ n: 1 }]);
  });

  it('swaps a service implementation through swapService', async () => {
    const k = new ServiceRegistry();
    k.register(manifest({ id: 'a', provides: ['svc'] }), async () =>
      plugin(manifest({ id: 'a' }), (ctx) => ctx.provide('svc', 'a')),
    );
    let seen: unknown;
    k.register(manifest({ id: 'b', uses: ['svc'] }), async () =>
      plugin(manifest({ id: 'b' }), (ctx) => {
        seen = ctx.get('svc');
      }),
    );
    await k.sync();
    expect(seen).toBe('a');
    await k.swapService('svc', 'other', 'b2');
    expect(k.get('svc')).toBe('b2');
    expect(seen).toBe('b2');
  });

  it('unregister removes the plugin and its services', async () => {
    const k = new ServiceRegistry();
    k.register(manifest({ id: 'gone', provides: ['svc'] }), async () =>
      plugin(manifest({ id: 'gone' }), (ctx) => ctx.provide('svc', 1)),
    );
    await k.sync();
    await k.unregister('gone');
    expect(k.record('gone')).toBeUndefined();
    expect(k.get('svc')).toBeUndefined();
  });
});
