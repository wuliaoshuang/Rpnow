import { describe, expect, it } from 'vitest';
import { fetchTokenQuota, quotaEndpoint } from './quota.js';

describe('quotaEndpoint', () => {
  it('strips a trailing /v1', () => {
    expect(quotaEndpoint('https://sta1n.ai/v1')).toBe('https://sta1n.ai/api/log/token');
  });

  it('leaves a root without /v1 alone', () => {
    expect(quotaEndpoint('https://example.com')).toBe('https://example.com/api/log/token');
  });

  it('tolerates trailing slashes', () => {
    expect(quotaEndpoint('https://example.com/v1///')).toBe('https://example.com/api/log/token');
  });
});

describe('fetchTokenQuota', () => {
  it('parses a nested payload', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ data: { used: 120, total: 1000 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
    await expect(fetchTokenQuota('https://x/v1', 'k', fake)).resolves.toEqual({ used: 120, total: 1000 });
  });

  it('parses a flat payload', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ usedTokens: 5, totalTokens: 50 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })) as unknown as typeof fetch;
    await expect(fetchTokenQuota('https://x/v1', 'k', fake)).resolves.toEqual({ used: 5, total: 50 });
  });

  it('returns null on an unsupported provider', async () => {
    const fake = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchTokenQuota('https://x/v1', 'k', fake)).resolves.toBeNull();
  });

  it('returns null on a network failure', async () => {
    const fake = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    await expect(fetchTokenQuota('https://x/v1', 'k', fake)).resolves.toBeNull();
  });

  it('returns null when the payload has no usable numbers', async () => {
    const fake = (async () =>
      new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'Content-Type': 'application/json' } })) as unknown as typeof fetch;
    await expect(fetchTokenQuota('https://x/v1', 'k', fake)).resolves.toBeNull();
  });
});
