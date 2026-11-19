import { describe, expect, it } from 'vitest';
import { describeEmptyTagResult, TAG_CONVERT_MAX_TOKENS } from './tagFailure.js';

describe('describeEmptyTagResult', () => {
  it('recognises the OpenAI content-filter code', () => {
    const d = describeEmptyTagResult(
      { text: '', finishReason: 'content_filter' },
      'gpt-5',
    );
    expect(d.cause).toContain('拦住了');
    expect(d.nextStep).toContain('不过滤的模型');
  });

  it('recognises Gemini SAFETY and Anthropic refusal as filters too', () => {
    for (const reason of ['SAFETY', 'refusal']) {
      const d = describeEmptyTagResult({ text: '', finishReason: reason }, 'm');
      expect(d.cause).toContain('拦住了');
    }
  });

  it('explains length truncation (400-token cap, thinking models)', () => {
    const d = describeEmptyTagResult({ text: '', finishReason: 'length' }, 'm');
    expect(d.cause).toContain('截断');
    expect(d.nextStep).toContain('不思考的普通模型');
  });

  it('spots a reasoning-only reply: thinking, no text, plain stop', () => {
    const d = describeEmptyTagResult(
      { text: '', reasoning: 'Let me think about the tags…', finishReason: 'stop' },
      'deepseek-reasoner',
    );
    expect(d.cause).toContain('思考过程');
    expect(d.nextStep).toContain('不思考的普通模型');
  });

  it('says so when the provider gave no finish reason at all', () => {
    const d = describeEmptyTagResult({ text: '' }, 'm');
    expect(d.cause).toContain('连结束原因都没给');
    expect(d.nextStep).toContain('重试');
  });

  it('names the model and keeps the raw code for a plain empty stop', () => {
    const d = describeEmptyTagResult({ text: '', finishReason: 'stop' }, 'my-model');
    expect(d.cause).toContain('stop');
    expect(d.nextStep).toContain('my-model');
  });

  it('raises the output cap above the old 400 tokens', () => {
    expect(TAG_CONVERT_MAX_TOKENS).toBeGreaterThan(400);
  });
});
