/**
 * Why a tag conversion came back empty, in plain Chinese.
 *
 * Context: `ImageStudio.enhance()` calls `llm.complete()` and only checks
 * `res.text`. When the model returns no text, the old toast just said
 * "模型没有返回内容，请重试" — no reason at all. A later patch started
 * showing the raw `finishReason`, but codes like `stop`, `SAFETY` or
 * `length` mean nothing to the user, and only the exact string
 * `content_filter` was recognised as a filter refusal — Gemini reports
 * `SAFETY`, Anthropic reports `refusal`, and a thinking model can burn
 * the whole reply on reasoning and leave `text` empty with a plain
 * `stop`.
 *
 * This helper turns the raw result into a cause + a next step the user
 * can actually act on. It is deliberately pure (no UI imports) so it can
 * be unit-tested and reused by any other caller of `llm.complete()`.
 */

import type { LLMResult } from '../llm/types.js';

/** Tag conversion output cap. 400 tokens is too small once a thinking model
 *  spends most of it on reasoning; the tag list itself is only ~15-40 tags. */
export const TAG_CONVERT_MAX_TOKENS = 1000;

export interface EmptyTagDiagnosis {
  /** One-line cause, plain Chinese. */
  cause: string;
  /** What to try next, plain Chinese. */
  nextStep: string;
}

type EmptyResult = Pick<LLMResult, 'text' | 'reasoning' | 'finishReason' | 'usage'>;

/** Normalised finish reasons that mean "the provider refused the content". */
const FILTER_REASONS = new Set([
  'content_filter',
  'content_filtered',
  'safety',
  'refusal',
  'refused',
  'blocked',
  'policy',
  'policy_violation',
]);

/** Finish reasons that mean "the reply was cut off by the token cap". */
const TRUNCATED_REASONS = new Set(['length', 'max_tokens', 'max_tokens_exceeded']);

export function describeEmptyTagResult(res: EmptyResult, modelLabel: string): EmptyTagDiagnosis {
  const reason = (res.finishReason ?? '').trim().toLowerCase();
  const model = modelLabel.trim() || '当前模型';
  const code = res.finishReason ? `（结束原因：${res.finishReason}）` : '（连结束原因都没给）';

  if (FILTER_REASONS.has(reason)) {
    return {
      cause: `模型把这段内容拦住了${code}。转写提示词里现在带了世界书和预设里的 NSFW 设定，过滤严的模型会直接拒绝。`,
      nextStep: `换一个不过滤的模型再转（设置 → 生图 → Tag 转写里改「${model}」），或者先把画面描述里的 NSFW 那段拿掉再试一次。`,
    };
  }

  if (TRUNCATED_REASONS.has(reason)) {
    return {
      cause: `模型写到一半被字数上限截断了${code}，正文一个字都没留下来。思考模型会把额度先花在思考上，更容易撞上这个上限。`,
      nextStep: '换一个不思考的普通模型再转；如果还想用这个模型，把转写用的字数上限调大再试。',
    };
  }

  if (res.reasoning?.trim()) {
    return {
      cause: `模型只返回了思考过程，没有返回正文${code}。${model}可能是思考模型，它的回答都进了思考频道，正文频道是空的。`,
      nextStep: '换一个不思考的普通模型来转写 Tag；思考模型不适合干这个活。',
    };
  }

  if (!res.finishReason) {
    return {
      cause: '模型一句话没回，连结束原因都没给，数据流可能是中途断了。',
      nextStep: '先点一次重试；如果每次都这样，检查一下网络或代理，再把这次用的模型名字告诉小塔塔。',
    };
  }

  return {
    cause: `模型正常结束了，却一个字都没给${code}。`,
    nextStep: `先点一次重试；如果还是空的，换个模型再试，并把「${model}」这个名字告诉小塔塔，好定位是哪个模型的问题。`,
  };
}
