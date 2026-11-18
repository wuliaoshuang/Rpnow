/**
 * Provider token quota probe.
 *
 * RP-Hub queries `{apiRoot without /v1}/api/log/token` to show how much of the
 * user's plan is left, matching the returned record to the current window
 * (±120 s). Only some providers implement it, so a failure is silent — the UI
 * simply shows nothing.
 */

export interface TokenQuota {
  used: number;
  total: number;
  /** ISO timestamp of the record, when the provider returns one. */
  at?: string;
}

/** Strip a trailing `/v1` so the quota endpoint sits at the service root. */
export function quotaEndpoint(baseURL: string): string {
  const trimmed = baseURL.replace(/\/+$/, '').replace(/\/v1$/i, '');
  return `${trimmed}/api/log/token`;
}

/**
 * Fetch the quota. Returns `null` for any failure so callers can hide the
 * readout rather than surfacing an error for an unsupported provider.
 */
export async function fetchTokenQuota(
  baseURL: string,
  apiKey: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<TokenQuota | null> {
  try {
    const res = await fetchImpl(quotaEndpoint(baseURL), {
      method: 'GET',
      headers: { Authorization: apiKey ? `Bearer ${apiKey}` : '', 'Content-Type': 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as Record<string, unknown>;
    const data = (json.data ?? json) as Record<string, unknown>;

    const used = Number(data.used ?? data.usedTokens ?? data.prompt_tokens ?? 0);
    const total = Number(data.total ?? data.totalTokens ?? data.total_tokens ?? 0);
    if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return null;
    const atRaw = data.at ?? data.time ?? data.timestamp;
    return { used, total, at: atRaw === undefined ? undefined : String(atRaw) };
  } catch {
    return null;
  }
}
