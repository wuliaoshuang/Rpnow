/**
 * WeChat — 小手机里的微信。
 *
 * 联系人是当前聊天卡里提到的人物：去世界书 / 设定里找提到了哪些人，
 * 转成联系人（卡的主角本人不是联系人——微信是主角的手机，联系人是
 * 主角世界里的其他人）。第一次打开时调一次模型找出来（见
 * `@/core/phone/contacts.js`），按聊天缓存进 IndexedDB，之后直接读缓存。
 * 每个联系人有自己的聊天记录，按联系人单独保存；每个联系人还带一条
 * 自己的人设（profile），回复时写进他/她自己的 system prompt，模型
 * 扮演他/她才不会 OOC。
 *
 * 小手机是独立系统：微信是单独的聊天，不续写主线剧情；但回复时会把
 * 主线聊天（手机外面那个正常聊天）的最近进展当剧情进度放进提示词，
 * 只做了解，让角色知道剧情到了哪一步（见 `@/core/phone/reply.js`）。旧逻辑存的缓存（里面还留着卡的主角本人）会在打开时丢掉、重新初始化。角色还是个 Agent：回复时模型能自己调发图和发表
 * 情包两个工具（见 `@/core/phone/tools.js`），用户要看图就真发一张图，
 * 想表达情绪就发表情包，不只靠文字；不支持工具调用的提供商改走文字里的
 * `[发图：…]` / `[表情：…]` 标记兜底。联系人列表右上角有个“重置”：
 * 点它确认后会删掉本聊天的全部小手机记录（联系人缓存 + 每个联系人的
 * 微信记录），再让 AI 根据角色卡重新初始化一次；主聊天和相册不受影响。
 */
import * as React from 'react';
import { ChevronLeft, Image as ImageIcon, Plus, RotateCcw, Send, Settings, SlidersHorizontal } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { useImage, useLLM } from '@/hooks/useKernel.js';
import { uid } from '@/lib/utils.js';
import type { RPCard } from '@/core/types/card.js';
import type { LLMMessage, LLMResult } from '@/core/llm/types.js';
import type { ImagePeople, PhoneContact, PhoneMessage, StickerEmotion } from '@/core/phone/types.js';
import {
  displayRelation,
  fallbackContacts,
  initContacts,
  isStaleContacts,
  resolvePhoneUser,
} from '@/core/phone/contacts.js';
import { lorebookTextForInit } from '@/core/phone/lorebook.js';
import { computeReplyExtras, historyEntries } from '@/core/phone/replyExtras.js';
import {
  buildImagePromptMessages,
  buildImageTagContext,
  buildReplySystemPrompt,
  enforceComposition,
  inferPeopleFromRequest,
  looksLikeImageRequest,
} from '@/core/phone/reply.js';
import {
  PHONE_TOOLS,
  parseReplyMarkers,
  parseSendImageArgs,
  parseSendStickerArgs,
} from '@/core/phone/tools.js';
import {
  clearPhoneChat,
  ensureChat,
  greetingMessage,
  loadContacts,
  loadWeChatChat,
  saveContacts,
  saveWeChatChat,
} from '@/core/phone/wechatStore.js';
import { detectEmotion, pickSticker } from '@/core/phone/stickers.js';
import { DEFAULT_TAG_PROMPT, normalizeTags } from '@/core/image/nai.js';
import { cleanRewrittenTags, rewriteTags } from '@/core/image/tagRewrite.js';
import { dataUrlToBlob, mediaRef, saveMediaImage } from '@/core/media/store.js';
import { PressableImage } from '@/components/media/PressableImage.js';
import { PhoneImageConfig } from './PhoneImageConfig.js';
import { PhonePromptViewer } from './PhonePromptViewer.js';

function makeMessage(
  msg: Omit<PhoneMessage, 'id' | 'createdAt'> & { id?: string },
): PhoneMessage {
  return { id: msg.id ?? uid('m'), createdAt: Date.now(), ...msg };
}

/** 名字定一个头像底色（没头像的联系人用首字 + 底色）。 */
function colorFor(name: string): string {
  const palette = ['#7c6aae', '#5b8c5a', '#c07a5a', '#5a7fa6', '#a65a7a', '#8a7a3a'];
  let h = 0;
  for (const ch of name) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return palette[h % palette.length];
}

function Avatar({
  name,
  avatarUrl,
  size,
}: {
  name: string;
  avatarUrl?: string;
  size: string;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        className={`${size} shrink-0 rounded-lg object-cover`}
      />
    );
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-lg text-lg font-semibold text-white`}
      style={{ backgroundColor: colorFor(name) }}
    >
      {name.charAt(0) || '？'}
    </span>
  );
}

export function WeChat({
  chatId,
  card,
  onBack,
}: {
  chatId: string;
  card: RPCard;
  onBack: () => void;
}) {
  const settings = useApp((s) => s.settings);
  const llmConnections = useApp((s) => s.llmConnections);
  const imageConnections = useApp((s) => s.imageConnections);
  const llm = useLLM();
  const image = useImage();

  /** null = 还在认识卡里的人（只在第一次打开这个聊天时出现）。 */
  const [contacts, setContacts] = React.useState<PhoneContact[] | null>(null);
  const [selected, setSelected] = React.useState<PhoneContact | null>(null);
  const [messages, setMessages] = React.useState<PhoneMessage[]>([]);
  const [previews, setPreviews] = React.useState<Record<string, string>>({});
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [imageRowOpen, setImageRowOpen] = React.useState(false);
  const [imagePrompt, setImagePrompt] = React.useState('');
  const [configOpen, setConfigOpen] = React.useState(false);
  /** 是否正在看提示词构成（小手机里的内嵌视图）。 */
  const [promptOpen, setPromptOpen] = React.useState(false);
  /** 重置计数：每次确认重置就 +1，让联系人加载 effect 重新跑一遍。 */
  const [resetNonce, setResetNonce] = React.useState(0);
  /** 是否正在弹“清空并重置”确认框。 */
  const [resetConfirmOpen, setResetConfirmOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const phone = settings.phone ?? {};

  // 联系人：先读缓存；没缓存、或缓存是旧逻辑存的（里面还留着卡的主角
  // 本人，或 relation 还是按主角算的、没按 User 算过），才调一次模型
  // 初始化。初始化成功就存下来——哪怕一个人都没提到（空列表也存，下次
  // 打开直接用，不用每次都再调一次模型）；初始化失败才用兜底（空列表，
  // 不存，下次打开再试一次）。
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cached = await loadContacts(chatId);
        if (cancelled) return;
        const stale = !!cached && isStaleContacts(cached, card);
        if (cached && !stale) {
          setContacts(cached);
          return;
        }
        const connectionId = phone.chatConnectionId || settings.defaultConnectionId || '';
        const connection = llmConnections.find((c) => c.id === connectionId);
        if (llm && connection) {
          try {
            const model = phone.chatModel || connection.defaultModel || '';
            // 初始化找人也要看世界书：只在世界书里出现的人物不能漏。
            // 初始化时还没对话可匹配，key 匹配会漏人，所以直接把世界书
            // 条目内容交给模型（lorebookTextForInit 按预算截断过）。
            const state = useApp.getState();
            const chatForInit = state.chats.find((c) => c.id === chatId);
            const initLorebookText = chatForInit
              ? lorebookTextForInit(card, chatForInit, state.lorebooks)
              : '';
            // User 的身份：主聊天里 {{user}} 就是这么定的（聊天的 persona，
            // 没有就第一个人设）。初始化要告诉模型 User 是谁，联系人的
            // relation 才能按 User 来算，而不是只按主角来算、搞不清关系。
            const initUser = chatForInit
              ? resolvePhoneUser(chatForInit, state.personas)
              : undefined;
            const initialized = await initContacts(
              card,
              llm,
              connectionId,
              model,
              initLorebookText,
              // 旧缓存判定为过期要重算时，把旧列表传进去：名字对得上的
              // 联系人沿用以前的 id，微信记录不断档。
              cached ?? undefined,
              initUser,
            );
            if (cancelled) return;
            if (initialized !== null) {
              setContacts(initialized);
              await saveContacts(chatId, initialized);
              return;
            }
            // 初始化失败（解析不出来），掉到下面的兜底，不存——下次打开再试。
          } catch {
            // 初始化失败，掉到下面的兜底。
          }
        }
        if (!cancelled) setContacts(fallbackContacts(card));
      } catch {
        if (!cancelled) setContacts(fallbackContacts(card));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    chatId,
    card,
    llm,
    llmConnections,
    phone.chatConnectionId,
    phone.chatModel,
    settings.defaultConnectionId,
    resetNonce,
  ]);

  /**
   * 清空并重置：删掉本聊天的全部小手机记录（联系人缓存 + 每个联系人的
   * 微信记录），再把联系人置空、让加载 effect 重新跑一遍——缓存已经删
   * 了，所以会真的再调一次模型重新初始化。主聊天、相册、其他聊天不动。
   * 先等删完再触发 effect，不然 effect 可能读到还没删掉的旧缓存。
   */
  const confirmReset = () => {
    const list = contacts;
    if (!list) return;
    setResetConfirmOpen(false);
    void (async () => {
      try {
        await clearPhoneChat(chatId, list);
      } catch {
        // 清理失败也不挡路：缓存读不到时初始化一样会重跑。
      }
      setSelected(null);
      setPreviews({});
      setContacts(null);
      setResetNonce((n) => n + 1);
    })();
  };

  // 联系人列表：懒加载每个联系人的最后一条消息做预览。
  React.useEffect(() => {
    if (selected || !contacts) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const contact of contacts) {
        try {
          const chat = await loadWeChatChat(contact.id);
          const last = chat?.messages[chat.messages.length - 1];
          next[contact.id] = last
            ? last.type === 'image'
              ? '[图片]'
              : last.type === 'sticker'
                ? '[表情]'
                : last.content
            : contact.openingMessage;
        } catch {
          next[contact.id] = contact.openingMessage;
        }
        if (cancelled) return;
      }
      if (!cancelled) setPreviews(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [contacts, selected]);

  // 新消息到底部。
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, generating, selected]);

  const persist = React.useCallback(
    async (contact: PhoneContact, next: PhoneMessage[]) => {
      await saveWeChatChat({
        cardId: card.id,
        contactId: contact.id,
        messages: next,
        updatedAt: Date.now(),
      });
    },
    [card.id],
  );

  const appendMessages = React.useCallback(
    (contact: PhoneContact, added: PhoneMessage[]) => {
      setMessages((prev) => {
        const next = [...prev, ...added];
        void persist(contact, next);
        return next;
      });
    },
    [persist],
  );

  /** 就地改一条系统提示的内容（生图的两段状态共用同一条提示）。 */
  const updateNote = React.useCallback(
    (contact: PhoneContact, noteId: string, content: string) => {
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === noteId ? { ...m, content } : m));
        void persist(contact, next);
        return next;
      });
    },
    [persist],
  );

  const openChat = React.useCallback(
    async (contact: PhoneContact) => {
      setSelected(contact);
      setMessages([]);
      setImagePrompt(`${contact.name}，精美插画`);
      try {
        const chat = await ensureChat(card, contact);
        setMessages(chat.messages);
      } catch (err) {
        // 兜底：存取失败也先把开场白摆出来，不让聊天开天窗。
        setMessages([greetingMessage(contact)]);
        setMessages((prev) => {
          void persist(contact, prev);
          return prev;
        });
        void err;
      }
    },
    [card, persist],
  );

  /**
   * 按一段描述生成一张图发给用户：先让模型按角色形象写正面提示词，
   * 再调生图工具（正面提示词＋画师串、负面提示词按配置来），存进相册。
   *
   * “＋”按钮（用输入框的文字）和 Agent 的 send_image 工具调用
   * （用工具的 description）都走这里。生成中的状态提示同一条，就地更新。
   *
   * history 是这个联系人的微信聊天记录：写提示词的模型要先读它，弄清楚
   * 现在的场景（在哪、在做什么、周围有什么），才能把角色画进场景里，
   * 而不是只画一张白底人像。
   *
   * people 是这张图里有几个人（回复模型按场景在 send_image 里定的；
   * “＋”按钮按输入框的文字简单判断，默认 solo）：写提示词的模型按这个
   * 人数写出画面里每个人的外貌，others 是图里可能出现的其他联系人
   * （名字、关系），模型按他们和聊天记录写样子，不编场景外的人。
   */
  const generateImageFromDescription = React.useCallback(
    async (
      contact: PhoneContact,
      description: string,
      history: PhoneMessage[],
      people: ImagePeople = 'solo',
      others: PhoneContact[] = [],
    ) => {
      if (generating) return;
      const rawPrompt = description.trim() || `${contact.name}，精美插画`;
      const connectionId = phone.imageConnectionId || imageConnections[0]?.id || '';
      if (!image || !connectionId) {
        appendMessages(contact, [
          makeMessage({
            role: 'system',
            type: 'text',
            content: '还没配置生图连接，先到「设置 → 生图」里添加一个',
          }),
        ]);
        return;
      }
      setGenerating(true);
      // 生图前先转写 Tag：把场景＋人物外貌的上下文（对话里的场景、人数、
      // 角色和他人的样子）交给 Tag 转写（设置 → 生图里配的转写模型，留空
      // 跟随当前对话），拿回 Danbooru 标签再出图——直接让模型写 Tag 的图
      // 全都不能看，转写这一步就是用来修这个的。
      // 转写失败、空手而回时，退回原来的做法：让模型直接写提示词，不挡生图。
      // 转写这一步替换了原来那次“模型写提示词”的调用，所以每次生图还是只
      // 调一次模型（转写），没有额外增加；画师串和负面提示词是用户在设置里
      // 配好的，模型不管，只拼进去。
      const llmConnectionId = phone.chatConnectionId || settings.defaultConnectionId || '';
      const llmConnection = llmConnections.find((c) => c.id === llmConnectionId);
      const useAgent = Boolean(llm && llmConnection);
      const note = makeMessage({
        role: 'system',
        type: 'text',
        content: useAgent ? '正在想要画什么…' : '正在生成图片…',
      });
      appendMessages(contact, [note]);
      let positivePrompt = rawPrompt;
      if (useAgent && llm && llmConnection) {
        const contextText = buildImageTagContext(card, contact, rawPrompt, historyEntries(history), {
          people,
          others,
        });
        const tagConnectionId = settings.imageGen.tagConnectionId || llmConnectionId;
        const tagConnection = llmConnections.find((c) => c.id === tagConnectionId) ?? llmConnection;
        const tagModel =
          settings.imageGen.tagModel || phone.chatModel || tagConnection.defaultModel || '';
        let rewritten = '';
        try {
          const res = await rewriteTags(llm, {
            connectionId: tagConnection.id,
            model: tagModel,
            systemPrompt: settings.imageGen.tagPrompt || DEFAULT_TAG_PROMPT,
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
            const model = phone.chatModel || llmConnection.defaultModel || '';
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
      // 性别是初始化时按卡存下来的；老缓存没有这个字段时按 unknown，
      // 单人只加 solo，双人/多人按默认标记。
      positivePrompt = enforceComposition(positivePrompt, people, contact.gender ?? 'unknown');
      const artistTags = normalizeTags(phone.imageArtistTags ?? '');
      const prompt = artistTags ? `${positivePrompt}, ${artistTags}` : positivePrompt;
      const negativePrompt = phone.imageNegativePrompt?.trim() || undefined;
      updateNote(contact, note.id, '正在生成图片…');
      try {
        const results = await image.generate(connectionId, {
          prompt,
          ...(negativePrompt ? { negativePrompt } : {}),
          size: phone.imageSize ?? 'square',
          model: phone.imageModel || undefined,
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
        appendMessages(contact, [
          makeMessage({
            role: 'assistant',
            type: 'image',
            content: prompt,
            imageSrc: mediaRef(saved.id),
          }),
        ]);
      } catch (err) {
        appendMessages(contact, [
          makeMessage({
            role: 'system',
            type: 'text',
            content: `生成图片失败：${err instanceof Error ? err.message : String(err)}`,
          }),
        ]);
      } finally {
        setGenerating(false);
      }
    },
    [
      appendMessages,
      card,
      chatId,
      generating,
      image,
      imageConnections,
      llm,
      llmConnections,
      phone.chatConnectionId,
      phone.chatModel,
      phone.imageArtistTags,
      phone.imageConnectionId,
      phone.imageModel,
      phone.imageNegativePrompt,
      phone.imageSize,
      settings.defaultConnectionId,
      settings.imageGen.tagConnectionId,
      settings.imageGen.tagModel,
      settings.imageGen.tagPrompt,
      updateNote,
    ],
  );

  /**
   * Agent 回复：把发图和发表情包两个工具交给模型，让它自己决定用不用。
   *
   * 流程：带 tools 调一次模型 → 文字照常发；工具调用按顺序执行
   * （发图先走 PR #33 的 Agent 生图流程，表情包挑一张现成的贴纸）；
   * 有的提供商不支持工具调用会直接拒绝请求，那就去掉 tools 再试一次，
   * 模型改用文字里的 `[发图：…]` / `[表情：…]` 标记也能达到同样效果
   * （标记从显示的文字里去掉）。工具调用优先：有工具调用时，同类标记
   * 只当没写过。最后，没有通过工具或标记发过表情包、且文字情绪明显
   * 时，照旧按情绪补一张。发送顺序：文字 → 图片 → 表情包。
   */
  const requestReply = React.useCallback(
    async (contact: PhoneContact, history: PhoneMessage[]) => {
      const connectionId = phone.chatConnectionId || settings.defaultConnectionId || '';
      const connection = llmConnections.find((c) => c.id === connectionId);
      if (!llm || !connection) {
        appendMessages(contact, [
          makeMessage({
            role: 'system',
            type: 'text',
            content: '还没配置模型连接，先到「设置 → 模型」里添加一个',
          }),
        ]);
        return;
      }
      const model = phone.chatModel || connection.defaultModel || '';
      const recent = history.filter((m) => m.role !== 'system').slice(-10);
      // 小手机是独立系统：微信是单独的聊天，不续写主线剧情。
      // 但角色得知道主线剧情到了哪一步（比如现在是报到日、自己在 3 栋、
      // 用户在 4 栋），不然微信里会说出和主线矛盾的话——所以每次回复都
      // 读当前主聊天（手机外面那个正常聊天）的最新消息，当场压成剧情
      // 进度放进提示词里“只做了解”，主线推进了，这里的感知也跟着推进。
      // 小手机共享主聊天的素材，拼进回复提示词（和提示词查看器共用
      // computeReplyExtras 算，查看器里看到的就是这里发出去的东西）：
      //   世界书——走主聊天同一套 activate()，按最近的微信对话 + 主线聊天
      //     最近消息匹配，命中的条目才进提示词；
      //   预设——按主聊天同一个办法取（chat.presetId，没有就用默认预设），
      //     抽出来的提示词按最高注入深度放在 system prompt 最后。
      // 都是读现成的数据，不多调模型。
      const state = useApp.getState();
      const extras = computeReplyExtras({
        card,
        mainChat: state.chats.find((c) => c.id === chatId),
        presets: state.presets,
        lorebooks: state.lorebooks,
        lorebookDefaults: settings.lorebook,
        defaultPresetId: settings.defaultPresetId,
        history,
      });
      const systemPrompt = buildReplySystemPrompt(card, contact, extras);
      const llmMessages: LLMMessage[] = [
        { role: 'system', content: systemPrompt },
        ...historyEntries(recent),
      ];
      const baseRequest = {
        model,
        messages: llmMessages,
        temperature: 0.8,
        maxTokens: 300,
      };
      setBusy(true);
      try {
        let result: LLMResult;
        try {
          result = await llm.complete(connectionId, {
            ...baseRequest,
            tools: PHONE_TOOLS,
            toolChoice: 'auto',
          });
        } catch {
          // 提供商可能不支持工具调用：去掉 tools 再试一次，纯文字
          // 回复一定能回来；模型改用标记也能发图/发表情包。
          result = await llm.complete(connectionId, baseRequest);
        }
        const toolCalls = result.toolCalls ?? [];
        const markers = parseReplyMarkers(result.text ?? '');
        const hasImageTool = toolCalls.some((tc) => tc.name === 'send_image');
        const hasStickerTool = toolCalls.some((tc) => tc.name === 'send_sticker');
        const imageRequests: Array<{ description: string; people: ImagePeople }> = [];
        for (const tc of toolCalls) {
          if (tc.name === 'send_image') {
            const parsed = parseSendImageArgs(tc.arguments);
            if (parsed) imageRequests.push(parsed);
          }
        }
        // 标记兜底没有人数：按 solo 算（角色自己的一张照片）。
        if (!hasImageTool)
          imageRequests.push(
            ...markers.imageDescriptions.map((description) => ({
              description,
              people: 'solo' as ImagePeople,
            })),
          );
        // 自动生图守门：只有用户这句明确要图时才发图。模型自己想发图
        // （工具调用或 [发图：…] 标记）不算数——用户没要图就不生图，
        // 不调生图接口，聊天里也不出现图；文字和表情包不受影响，照常发。
        // “＋”按钮是用户自己点的，不走这里，不受这个守门限制。
        const lastUserMessage = [...history]
          .reverse()
          .find((m) => m.role === 'user' && m.type === 'text');
        const userAskedForImage = lastUserMessage
          ? looksLikeImageRequest(lastUserMessage.content)
          : false;
        const imageRequestsToSend = userAskedForImage ? imageRequests : [];
        const stickerEmotions: StickerEmotion[] = [];
        for (const tc of toolCalls) {
          if (tc.name === 'send_sticker') {
            const emotion = parseSendStickerArgs(tc.arguments);
            if (emotion) stickerEmotions.push(emotion);
          }
        }
        if (!hasStickerTool) stickerEmotions.push(...markers.stickerEmotions);

        const text = markers.cleanText;
        let sentSticker = false;
        if (text) {
          appendMessages(contact, [
            makeMessage({ role: 'assistant', type: 'text', content: text }),
          ]);
        }
        const otherContacts = (contacts ?? []).filter((c) => c.id !== contact.id);
        for (const req of imageRequestsToSend) {
          // 生图要带着最近的对话：模型得知道现在是什么场景，才能把角色画进场景里；
          // 人数是回复模型按场景定的，其他联系人一并给写提示词的模型当参考。
          await generateImageFromDescription(
            contact,
            req.description,
            recent,
            req.people,
            otherContacts,
          );
        }
        for (const emotion of stickerEmotions) {
          const stickerUrl = pickSticker(emotion);
          if (stickerUrl) {
            appendMessages(contact, [
              makeMessage({
                role: 'assistant',
                type: 'sticker',
                content: '',
                stickerUrl,
              }),
            ]);
            sentSticker = true;
          }
        }
        // 情绪贴纸兜底：没有通过工具或标记发过表情包、且文字情绪明显时照旧发一张。
        if (!sentSticker && text) {
          const emotion = detectEmotion(text);
          if (emotion !== 'neutral') {
            const stickerUrl = pickSticker(emotion);
            if (stickerUrl) {
              appendMessages(contact, [
                makeMessage({
                  role: 'assistant',
                  type: 'sticker',
                  content: '',
                  stickerUrl,
                }),
              ]);
            }
          }
        }
      } catch (err) {
        appendMessages(contact, [
          makeMessage({
            role: 'system',
            type: 'text',
            content: `发送失败：${err instanceof Error ? err.message : String(err)}`,
          }),
        ]);
      } finally {
        setBusy(false);
      }
    },
    [
      appendMessages,
      card,
      chatId,
      contacts,
      generateImageFromDescription,
      llm,
      llmConnections,
      phone.chatConnectionId,
      phone.chatModel,
      settings.defaultConnectionId,
    ],
  );

  const sendText = () => {
    const contact = selected;
    const text = input.trim();
    if (!contact || !text || busy) return;
    const userMsg = makeMessage({ role: 'user', type: 'text', content: text });
    const next = [...messages, userMsg];
    setMessages(next);
    void persist(contact, next);
    setInput('');
    void requestReply(contact, next);
  };

  /**
   * “＋”里的生图按钮：用输入框的文字调同一条 Agent 生图流程，带着当前聊天的记录当场景。
   * 没有回复模型给人数，就按输入框的文字简单判断（明确提到用户也在画面里就是双人、
   * 提到一群人就是多人，否则默认单人——角色自己的一张照片），其他联系人一并给参考。
   */
  const generateImage = () => {
    const contact = selected;
    if (!contact) return;
    const otherContacts = (contacts ?? []).filter((c) => c.id !== contact.id);
    void generateImageFromDescription(
      contact,
      imagePrompt,
      messages,
      inferPeopleFromRequest(imagePrompt),
      otherContacts,
    );
  };

  // ---------------- 联系人列表 ----------------
  if (!selected) {
    return (
      <div className="relative flex min-h-0 flex-1 flex-col bg-white text-neutral-900">
        <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 px-2 py-2.5">
          <button
            type="button"
            aria-label="返回主屏幕"
            onClick={onBack}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
          >
            <ChevronLeft className="size-6" />
          </button>
          <h2 className="flex-1 text-base font-semibold">微信</h2>
          <button
            type="button"
            aria-label="清空并重置"
            onClick={() => setResetConfirmOpen(true)}
            disabled={contacts === null}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] text-neutral-500 transition-colors hover:bg-neutral-100 disabled:cursor-default disabled:opacity-40"
          >
            <RotateCcw className="size-4" />
            重置
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {contacts === null ? (
            <p className="animate-pulse px-4 py-8 text-center text-sm text-neutral-500">
              正在认识卡里的人…
            </p>
          ) : contacts.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-500">
              卡里没有提到其他人，微信里暂时没有联系人。
            </p>
          ) : (
            contacts.map((contact) => (
              <button
                key={contact.id}
                type="button"
                onClick={() => void openChat(contact)}
                className="flex w-full cursor-pointer items-center gap-3 border-b border-neutral-100 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
              >
                <Avatar
                  name={contact.name}
                  size="size-12"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5">
                    <span className="truncate text-[15px] font-medium">{contact.name}</span>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {displayRelation(contact)}
                    </span>
                  </span>
                  <span className="block truncate text-[13px] text-neutral-500">
                    {previews[contact.id] ?? contact.openingMessage}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
        {resetConfirmOpen && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 px-6">
            <div className="w-full max-w-[280px] rounded-2xl bg-white p-4 shadow-xl">
              <h3 className="text-[15px] font-semibold text-neutral-900">清空并重置？</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-600">
                会删掉这个聊天的全部小手机记录（联系人和聊天记录），然后让 AI
                根据角色卡重新初始化。主聊天和相册不受影响。
              </p>
              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  onClick={() => setResetConfirmOpen(false)}
                  className="flex-1 cursor-pointer rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-200"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={confirmReset}
                  className="flex-1 cursor-pointer rounded-lg bg-[#07C160] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
                >
                  确定重置
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---------------- 聊天窗口 ----------------
  const contact = selected;
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#ededed] text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 bg-white px-2 py-2">
        <button
          type="button"
          aria-label="返回联系人"
          onClick={() => setSelected(null)}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
        >
          <ChevronLeft className="size-6" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
          {contact.name}
          <span className="ml-1.5 text-xs font-normal text-neutral-400">
            {displayRelation(contact)}
          </span>
        </h2>
        <button
          type="button"
          aria-label="提示词构成"
          onClick={() => setPromptOpen(true)}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
        >
          <SlidersHorizontal className="size-5 text-neutral-600" />
        </button>
        <button
          type="button"
          aria-label="小手机生图设置"
          onClick={() => setConfigOpen(true)}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
        >
          <Settings className="size-5 text-neutral-600" />
        </button>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="flex flex-col gap-2.5">
          {messages.map((m) => {
            if (m.role === 'system') {
              return (
                <p
                  key={m.id}
                  className="mx-auto max-w-[85%] rounded-md bg-black/5 px-2.5 py-1 text-center text-xs text-neutral-500"
                >
                  {m.content}
                </p>
              );
            }
            const isOwn = m.role === 'user';
            return (
              <div key={m.id} className={`flex items-start gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                {!isOwn && (
                  <Avatar
                    name={contact.name}
                    size="size-9"
                  />
                )}
                {m.type === 'sticker' && m.stickerUrl ? (
                  <img
                    src={m.stickerUrl}
                    alt="表情"
                    className="w-[120px] rounded-lg object-contain"
                  />
                ) : m.type === 'image' && m.imageSrc ? (
                  <PressableImage
                    src={m.imageSrc}
                    alt={m.content || '图片'}
                    className="max-w-[200px] rounded-xl object-cover"
                  />
                ) : (
                  <div
                    className={`max-w-[70%] whitespace-pre-wrap break-words rounded-xl px-3 py-2 text-[15px] leading-relaxed ${
                      isOwn ? 'bg-[#07C160] text-white' : 'bg-white text-neutral-900 shadow-sm'
                    }`}
                  >
                    {m.content}
                  </div>
                )}
              </div>
            );
          })}
          {busy && (
            <div className="flex items-start gap-2">
              <Avatar
                name={contact.name}
                size="size-9"
              />
              <div className="rounded-xl bg-white px-3 py-2 text-[15px] text-neutral-500 shadow-sm">
                对方正在输入…
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 生图行 */}
      {imageRowOpen && (
        <div className="flex shrink-0 items-center gap-2 border-t border-neutral-200 bg-white px-3 py-2">
          <input
            value={imagePrompt}
            onChange={(e) => setImagePrompt(e.target.value)}
            placeholder={`${contact.name}，精美插画`}
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#07C160]"
          />
          <button
            type="button"
            onClick={() => void generateImage()}
            disabled={generating}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-lg bg-[#07C160] px-3 py-2 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            <ImageIcon className="size-4" />
            {generating ? '生成中…' : '生成图片'}
          </button>
        </div>
      )}

      {/* 输入栏 */}
      <div className="flex shrink-0 items-center gap-2 border-t border-neutral-200 bg-white px-3 py-2 pb-2">
        <button
          type="button"
          aria-label="更多"
          onClick={() => setImageRowOpen((v) => !v)}
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition-colors hover:bg-neutral-100"
        >
          <Plus className="size-5" />
        </button>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') sendText();
          }}
          placeholder="发消息…"
          className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#07C160]"
        />
        <button
          type="button"
          aria-label="发送"
          onClick={sendText}
          disabled={busy || !input.trim()}
          className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#07C160] text-white transition-opacity disabled:opacity-40"
        >
          <Send className="size-4" />
        </button>
      </div>

      <PhoneImageConfig open={configOpen} onOpenChange={setConfigOpen} />
      {promptOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-white">
          <PhonePromptViewer
            chatId={chatId}
            card={card}
            contact={contact}
            history={messages}
            onBack={() => setPromptOpen(false)}
          />
        </div>
      )}
    </div>
  );
}
