/**
 * Tag 转写：把画面描述转成 Danbooru 风格的英文 Tag——生图工作室和小手机共用。
 *
 * 工作室的 ImageStudio.enhance() 原来把这段调用内联在组件里；抽出来，
 * 小手机生图前也走同一套：同一个转写提示词（设置 → 生图 → Tag 转写，
 * 留空用 DEFAULT_TAG_PROMPT）、同一个字数上限（TAG_CONVERT_MAX_TOKENS）、
 * 同一个 temperature。转写模型不听话、空手而回、调用失败时，调用方自己
 * 兜底（工作室报原因，小手机退回让模型直接写提示词），这里不替它决定。
 */
import { TAG_CONVERT_MAX_TOKENS } from './tagFailure.js';
import { DEFAULT_TAG_PROMPT } from './nai.js';
import type { LLMResult, LLMService } from '../llm/types.js';

/**
 * 转写一次：调转写模型，把画面描述（正文）转成 Danbooru Tag。
 * 返回原始结果，调用方读 `.text`（再用 cleanRewrittenTags 清理）。
 * 调用本身失败时直接抛错，由调用方 catch 后兜底。
 */
export async function rewriteTags(
  llm: Pick<LLMService, 'complete'>,
  input: {
    connectionId: string;
    model: string;
    /** 转写用的 system prompt；留空用 DEFAULT_TAG_PROMPT。 */
    systemPrompt?: string;
    /** 要转写的画面描述（正文）。 */
    description: string;
  },
): Promise<LLMResult> {
  return llm.complete(input.connectionId, {
    model: input.model,
    maxTokens: TAG_CONVERT_MAX_TOKENS,
    temperature: 0.7,
    messages: [
      { role: 'system', content: input.systemPrompt?.trim() || DEFAULT_TAG_PROMPT },
      { role: 'user', content: input.description },
    ],
  });
}

/**
 * 把转写模型的回复清理成 Tag 串：去首尾空白，再去包着的一层引号。
 * 拿不到可用内容（空、只有空白、只有一个引号）时返回 ''。
 */
export function cleanRewrittenTags(text: string): string {
  return text.trim().replace(/^["']|["']$/g, '');
}
