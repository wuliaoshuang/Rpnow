/**
 * Native transport for the desktop shell.
 *
 * The whole reason the Tauri target exists: provider APIs such as OpenAI,
 * NovelAI, Volcengine Ark and Groq send **no CORS headers**, so a browser cannot
 * call them. On desktop the requests are issued from Rust by
 * `@tauri-apps/plugin-http`, which is not subject to CORS at all.
 *
 * This module is a drop-in `fetch` replacement. Adapters never change: they
 * receive a `fetchImpl` and cannot tell which runtime they are on.
 *
 * Detection is deliberately conservative — it checks for the Tauri IPC bridge
 * rather than a build-time flag, so the same bundle behaves correctly whether it
 * is loaded in a browser or in the desktop shell.
 */

export type FetchLike = typeof fetch;

/** True when running inside the Tauri webview with the HTTP plugin available. */
export function isDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as unknown as { __TAURI_INTERNALS__?: unknown; isTauri?: boolean };
  return Boolean(w.__TAURI_INTERNALS__ || w.isTauri);
}

let cached: FetchLike | null = null;

/**
 * Resolve the fetch implementation to use.
 *
 * Desktop → native plugin (CORS-free). Browser → global fetch, optionally routed
 * through the user's configured proxy.
 */
export async function resolveFetch(proxy?: { enabled: boolean; url: string }): Promise<FetchLike> {
  if (isDesktop()) {
    if (cached) return cached;
    try {
      const mod = await import('@tauri-apps/plugin-http');
      cached = mod.fetch as unknown as FetchLike;
      return cached;
    } catch (err) {
      // Falling back silently would make every provider look "broken" with a
      // CORS error, so make the cause explicit.
      console.error('[transport] Tauri HTTP plugin unavailable, falling back to window.fetch', err);
      return fetch;
    }
  }

  if (proxy?.enabled && proxy.url.trim()) {
    const base = proxy.url.trim().replace(/\/+$/, '');
    // Rewrite only absolute URLs; the proxy is expected to accept the original
    // upstream URL as the path (a standard generic reverse proxy contract).
    return ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (/^https?:\/\//i.test(url)) {
        return fetch(`${base}/${encodeURIComponent(url)}`, init);
      }
      return fetch(input as RequestInfo, init);
    }) as FetchLike;
  }

  return fetch;
}

/** Whether a provider needs the proxy in the current runtime. */
export function needsProxy(browserCors: boolean): boolean {
  return !browserCors && !isDesktop();
}
