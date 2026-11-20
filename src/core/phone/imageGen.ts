/**
 * 小手机生图流程（微信和朋友圈共用）。
 *
 * 原来只住在 WeChat.tsx 里的 `generateImageFromDescription`，抽出来给
 * 朋友圈也用——朋友圈点图片生图走的和微信“＋”按钮同一条线：
 *
 *   1. 先转写 Tag：把场景＋人物外貌的上下文（对话里的场景、人数、角色
 *      和他人的样子）交给 Tag 转写（设置 → 生图里配的转写模型，留空
 *      跟随当前对话），拿回 Danbooru 标签再出图；转写失败、空手而回时
 *      退回原来的做法：让模型直接写提示词，不挡生图。转写这一步替换了
 *      原来那次“模型写提示词”的调用，所以每次生图还是只调一次模型，
 *      没有额外增加。
 *   2. 按人数强制（PR #38）：不管模型写了什么提示词，代码在这里把人数
 *      标签改成这张图实际该有的人数，再去调生图。
 *   3. 调生图接口（正面提示词＋画师串、负面提示词按配置来），图存进
 *      相册（`source: 'phone'`），返回 media 引用和当时用的提示词。
 *
 * 这里只管“生一张图出来”，不管界面：调用方自己管生成中的提示、失败
 * 的提示、把图贴到聊天记录或朋友圈动态里。没配生图连接时抛错，调用方
 * 把错写成系统提示。
 */
import type { ImageService } from '@/core/image/types.js';
import type { ImageConnection } from '@/core/image/types.js';
import type { LLMConnection, LLMService } from '@/core/llm/types.js';
import type { RPCard } from '@/core/types/card.js';
import { DEFAULT_TAG_PROMPT, normalizeTags } from '@/core/image/nai.js';
import { cleanRewrittenTags, rewriteTags } from '@/core/image/tagRewrite.js';
import { dataUrlToBlob, mediaRef, saveMediaImage } from '@/core/media/store.js';
import type { ImagePeople, PhoneContact, PhoneMessage, PhoneSettings } from './types.js';
import { buildImagePromptMessages, buildImageTagContext, enforceComposition } from './reply.js';
import { historyEntries } from './replyExtras.js';

export interface PhoneImageDeps {
  llm?: LLMService;
  image?: ImageService;
  llmConnections: LLMConnection[];
  imageConnections: ImageConnection[];
  phone: PhoneSettings;
  /** 设置 → 生图里的 Tag 转写配置（连接 / 模型 / 提示词）。 */
  imageGen: { tagConnectionId?: string; tagModel?: string; tagPrompt?: string };
  defaultConnectionId?: string;
  card: RPCard;
  chatId: string;
}

export interface GeneratedPhoneImage {
  /** 帖子/消息里挂的图：`media:<id>`。 */
  imageSrc: string;
  /** 当时用的正面提示词（拼了画师串之后）。 */
  prompt: string;
}

/**
 * 按一段描述给一个联系人生一张图。
 *
 * description 是用户想画的内容（微信里是输入框的文字或工具的
 * description，朋友圈里是帖子的 imageDesc）；history 是写提示词的模型
 * 要读的最近对话（场景从这里来）；people 是这张图里有几个人；others
 * 是图里可能出现的其他联系人（只在 multi 时列出来当参考）。
 */
export async function generatePhoneImage(
  deps: PhoneImageDeps,
  contact: PhoneContact,
  description: string,
  history: PhoneMessage[],
  people: ImagePeople = 'solo',
  others: PhoneContact[] = [],
): Promise<GeneratedPhoneImage> {
  const { llm, image, card, chatId } = deps;
  const rawPrompt = description.trim() || `${contact.name}，精美插画`;
  const connectionId = deps.phone.imageConnectionId || deps.imageConnections[0]?.id || '';
  if (!image || !connectionId) {
    throw new Error('还没配置生图连接，先到「设置 → 生图」里添加一个');
  }
  const llmConnectionId = deps.phone.chatConnectionId || deps.defaultConnectionId || '';
  const llmConnection = deps.llmConnections.find((c) => c.id === llmConnectionId);
  const useAgent = Boolean(llm && llmConnection);
  let positivePrompt = rawPrompt;
  if (useAgent && llm && llmConnection) {
    const contextText = buildImageTagContext(card, contact, rawPrompt, historyEntries(history), {
      people,
      others,
    });
    const tagConnectionId = deps.imageGen.tagConnectionId || llmConnectionId;
    const tagConnection = deps.llmConnections.find((c) => c.id === tagConnectionId) ?? llmConnection;
    const tagModel =
      deps.imageGen.tagModel || deps.phone.chatModel || tagConnection.defaultModel || '';
    let rewritten = '';
    try {
      const res = await rewriteTags(llm, {
        connectionId: tagConnection.id,
        model: tagModel,
        systemPrompt: deps.imageGen.tagPrompt || DEFAULT_TAG_PROMPT,
        description: contextText,
      });
      rewritten = cleanRewrittenTags(res.text);
    } catch {
      rewritten = '';
    }
    if (rewritten) {
      positivePrompt = rewritten;
    } else {
      try {
        const model = deps.phone.chatModel || llmConnection.defaultModel || '';
        const result = await llm.complete(llmConnectionId, {
          model,
          messages: buildImagePromptMessages(card, contact, rawPrompt, historyEntries(history), {
            people,
            others,
          }),
          temperature: 0.7,
          maxTokens: 300,
        });
        const agentPrompt = result.text.trim();
        if (agentPrompt) positivePrompt = agentPrompt;
      } catch {
        // 模型写不出来就用用户原话，不挡生图。
      }
    }
  }
  // 按人数强制：不管模型写了什么提示词（哪怕写了 2girls、写了 group，
  // 或者双人图里写了 solo），代码在这里把人数标签改成这张图实际该有
  // 的人数（单人 1girl, solo / 双人 2girls / 多人 multiple girls……），
  // 再去调生图。这一步在模型返回之后由代码做，模型改不掉。
  positivePrompt = enforceComposition(positivePrompt, people, contact.gender ?? 'unknown');
  const artistTags = normalizeTags(deps.phone.imageArtistTags ?? '');
  const prompt = artistTags ? `${positivePrompt}, ${artistTags}` : positivePrompt;
  const negativePrompt = deps.phone.imageNegativePrompt?.trim() || undefined;
  const results = await image.generate(connectionId, {
    prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    size: deps.phone.imageSize ?? 'square',
    model: deps.phone.imageModel || undefined,
  });
  const first = results[0];
  if (!first) throw new Error('没有生成出图片');
  const blob = await dataUrlToBlob(first.dataUrl);
  const saved = await saveMediaImage(blob, {
    chatId,
    cardId: card.id,
    prompt,
    provider: first.provider,
    model: first.model,
    // 手机里生的图进相册留存。
    source: 'phone',
  });
  return { imageSrc: mediaRef(saved.id), prompt };
}
