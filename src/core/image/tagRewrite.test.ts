/**
 * Tag 转写的单元测试：只测转写调用本身（提示词、上限、清理），
 * 不调任何真实模型——llm.complete 用假对象。
 */
import { describe, expect, it, vi } from 'vitest';
import { rewriteTags, cleanRewrittenTags } from './tagRewrite.js';
import { DEFAULT_TAG_PROMPT } from './nai.js';
import { TAG_CONVERT_MAX_TOKENS } from './tagFailure.js';
import type { LLMRequest, LLMResult } from '../llm/types.js';

function fakeResult(text: string): LLMResult {
  return { text, toolCalls: [], finishReason: 'stop' };
}

describe('rewriteTags', () => {
  it('用转写提示词＋画面描述调一次 llm.complete，字数上限和 temperature 和工作室一致', async () => {
    const complete = vi.fn(
      async (_connectionId: string, _req: LLMRequest) => fakeResult('1girl, long hair, school uniform'),
    );
    const res = await rewriteTags(
      { complete },
      {
        connectionId: 'conn-1',
        model: 'mock-model',
        systemPrompt: '自定义转写提示词',
        description: '李淑纯在老街法桐树下买凉皮',
      },
    );
    expect(complete).toHaveBeenCalledTimes(1);
    const [connectionId, req] = complete.mock.calls[0];
    expect(connectionId).toBe('conn-1');
    expect(req.model).toBe('mock-model');
    expect(req.maxTokens).toBe(TAG_CONVERT_MAX_TOKENS);
    expect(req.temperature).toBe(0.7);
    expect(req.messages).toEqual([
      { role: 'system', content: '自定义转写提示词' },
      { role: 'user', content: '李淑纯在老街法桐树下买凉皮' },
    ]);
    expect(res.text).toBe('1girl, long hair, school uniform');
  });

  it('转写提示词留空时用 DEFAULT_TAG_PROMPT', async () => {
    const complete = vi.fn(
      async (_connectionId: string, _req: LLMRequest) => fakeResult('1girl, solo'),
    );
    await rewriteTags({ complete }, { connectionId: 'c', model: 'm', description: '一个女生' });
    const [, req] = complete.mock.calls[0];
    const messages = req.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toBe(DEFAULT_TAG_PROMPT);
  });

  it('调用失败时抛错，由调用方 catch 后兜底', async () => {
    const complete = vi.fn(async () => {
      throw new Error('网络断了');
    });
    await expect(
      rewriteTags({ complete }, { connectionId: 'c', model: 'm', description: '一个女生' }),
    ).rejects.toThrow('网络断了');
  });
});

describe('cleanRewrittenTags', () => {
  it('去首尾空白和包着的一层引号', () => {
    expect(cleanRewrittenTags('  "1girl, long hair"  ')).toBe('1girl, long hair');
    expect(cleanRewrittenTags("  '1girl, solo' ")).toBe('1girl, solo');
    expect(cleanRewrittenTags('1girl, long hair')).toBe('1girl, long hair');
  });

  it('拿不到可用内容时返回空串', () => {
    expect(cleanRewrittenTags('')).toBe('');
    expect(cleanRewrittenTags('   \n  ')).toBe('');
  });
});
