/**
 * Tool providers: turn a `ToolCall` into a `ToolResult`.
 *
 * Tavily is the only network dependency; its key lives in settings. Everything
 * else (transcript search, randomness) is local and deterministic.
 */

import type { ToolCall, ToolResult, ToolSettings, TavilyResult } from './types.js';
import {
  formatKeywordResult,
  looksLikeUrl,
  runRandomNumber,
  searchTranscript,
  type TranscriptMessage,
} from './engine.js';

export interface ExecuteParams {
  call: ToolCall;
  settings: ToolSettings;
  messages: TranscriptMessage[];
  userName: string;
  characterName: string;
  fetchImpl?: typeof fetch;
}

const TAVILY_SEARCH = 'https://api.tavily.com/search';
const TAVILY_EXTRACT = 'https://api.tavily.com/extract';

async function tavilySearch(
  query: string,
  key: string,
  maxResults: number,
  fetchImpl: typeof fetch,
): Promise<string> {
  const res = await fetchImpl(TAVILY_SEARCH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      api_key: key,
      search_depth: 'advanced',
      max_results: maxResults,
      topic: 'general',
      include_favicon: true,
    }),
  });
  if (!res.ok) throw new Error(`Tavily 搜索失败（${res.status}）`);
  const json = (await res.json()) as { results?: TavilyResult[] };
  const results = json.results ?? [];
  if (!results.length) return '联网搜索没有返回结果。';
  return results
    .map((r, i) => `${i + 1}. ${r.title}\n${r.url}\n${(r.content ?? '').slice(0, 600)}`)
    .join('\n\n');
}

async function tavilyExtract(query: string, key: string, fetchImpl: typeof fetch): Promise<string> {
  const urls = (query.match(/https?:\/\/[^\s，,。]+/gi) ?? []).slice(0, 5);
  if (!urls.length) {
    const www = query.match(/www\.[^\s，,。]+/gi) ?? [];
    urls.push(...www.slice(0, 5).map((u) => `https://${u}`));
  }
  if (!urls.length) throw new Error('没有解析到可读取的网址');

  const res = await fetchImpl(TAVILY_EXTRACT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      urls,
      api_key: key,
      extract_depth: 'advanced',
      format: 'markdown',
      timeout: 30,
    }),
  });
  if (!res.ok) throw new Error(`Tavily 读取失败（${res.status}）`);
  const json = (await res.json()) as { results?: Array<{ url: string; raw_content?: string }> };
  const results = json.results ?? [];
  if (!results.length) return '网页读取没有返回内容。';
  return results.map((r) => `${r.url}\n${(r.raw_content ?? '').slice(0, 2000)}`).join('\n\n---\n\n');
}

/** Execute one tool call. Never throws: failures become `error` results. */
export async function executeTool(params: ExecuteParams): Promise<ToolResult> {
  const { call, settings, messages, userName, characterName } = params;
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  const query = String(call.arguments.query ?? '').trim();

  try {
    switch (call.name) {
      case 'keyword_dialogue': {
        const hits = searchTranscript({
          query,
          messages,
          userName,
          characterName,
          maxResults: settings.resultCount,
        });
        return {
          callId: call.id,
          name: call.name,
          content: formatKeywordResult(hits),
          status: 'done',
          summary: `检索「${query}」命中 ${hits.length} 条`,
        };
      }
      case 'web_search': {
        if (!settings.tavilyKey) throw new Error('未配置 Tavily API Key');
        const content = looksLikeUrl(query)
          ? await tavilyExtract(query, settings.tavilyKey, fetchImpl)
          : await tavilySearch(query, settings.tavilyKey, settings.resultCount, fetchImpl);
        return { callId: call.id, name: call.name, content, status: 'done', summary: `联网：${query}` };
      }
      case 'random_number': {
        const content = runRandomNumber(call.arguments);
        return { callId: call.id, name: call.name, content, status: 'done', summary: content };
      }
      default:
        throw new Error(`未知工具：${call.name}`);
    }
  } catch (err) {
    return {
      callId: call.id,
      name: call.name,
      content: `工具执行失败：${err instanceof Error ? err.message : String(err)}`,
      status: 'error',
    };
  }
}

/** Execute several calls, capped at `maxToolCalls`, preserving request order. */
export async function executeTools(
  calls: ToolCall[],
  params: Omit<ExecuteParams, 'call'>,
): Promise<ToolResult[]> {
  const limited = calls.slice(0, params.settings.maxToolCalls);
  const results: ToolResult[] = [];
  for (const call of limited) {
    results.push(await executeTool({ ...params, call }));
  }
  return results;
}
