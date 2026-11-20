/**
 * WeChat — 小手机里的微信。
 *
 * 联系人就是角色卡：点一个角色进聊天，记录按角色卡单独保存
 *（IndexedDB，见 `@/core/phone/wechatStore.js`）。
 */
import * as React from 'react';
import { ChevronLeft, Image as ImageIcon, Plus, Send, Settings } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { useImage, useLLM } from '@/hooks/useKernel.js';
import { uid } from '@/lib/utils.js';
import type { RPCard } from '@/core/types/card.js';
import type { LLMMessage } from '@/core/llm/types.js';
import type { PhoneMessage } from '@/core/phone/types.js';
import {
  ensureChat,
  greetingMessage,
  loadWeChatChat,
  saveWeChatChat,
} from '@/core/phone/wechatStore.js';
import { detectEmotion, pickSticker } from '@/core/phone/stickers.js';
import { dataUrlToBlob, mediaRef, saveMediaImage } from '@/core/media/store.js';
import { PressableImage } from '@/components/media/PressableImage.js';
import { PhoneImageConfig } from './PhoneImageConfig.js';

function makeMessage(
  msg: Omit<PhoneMessage, 'id' | 'createdAt'> & { id?: string },
): PhoneMessage {
  return { id: msg.id ?? uid('m'), createdAt: Date.now(), ...msg };
}

function Avatar({ card, size }: { card: RPCard; size: string }) {
  const name = card.data.name || '？';
  if (card.avatar) {
    return (
      <img
        src={card.avatar}
        alt={name}
        className={`${size} shrink-0 rounded-lg object-cover`}
      />
    );
  }
  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-lg bg-neutral-400 text-lg font-semibold text-white`}
    >
      {name.charAt(0)}
    </span>
  );
}

export function WeChat({ onBack }: { onBack: () => void }) {
  const cards = useApp((s) => s.cards);
  const settings = useApp((s) => s.settings);
  const llmConnections = useApp((s) => s.llmConnections);
  const imageConnections = useApp((s) => s.imageConnections);
  const llm = useLLM();
  const image = useImage();

  const [selectedCard, setSelectedCard] = React.useState<RPCard | null>(null);
  const [messages, setMessages] = React.useState<PhoneMessage[]>([]);
  const [previews, setPreviews] = React.useState<Record<string, string>>({});
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const [imageRowOpen, setImageRowOpen] = React.useState(false);
  const [imagePrompt, setImagePrompt] = React.useState('');
  const [configOpen, setConfigOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const phone = settings.phone ?? {};

  // 联系人列表：懒加载每个聊天的最后一条消息做预览。
  React.useEffect(() => {
    if (selectedCard) return;
    let cancelled = false;
    void (async () => {
      const next: Record<string, string> = {};
      for (const card of cards) {
        try {
          const chat = await loadWeChatChat(card.id);
          const last = chat?.messages[chat.messages.length - 1];
          next[card.id] = last
            ? last.type === 'image'
              ? '[图片]'
              : last.type === 'sticker'
                ? '[表情]'
                : last.content
            : card.data.description || '';
        } catch {
          next[card.id] = card.data.description || '';
        }
        if (cancelled) return;
      }
      if (!cancelled) setPreviews(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [cards, selectedCard]);

  // 新消息到底部。
  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, generating, selectedCard]);

  const persist = React.useCallback(
    async (card: RPCard, next: PhoneMessage[]) => {
      await saveWeChatChat({ cardId: card.id, messages: next, updatedAt: Date.now() });
    },
    [],
  );

  const appendMessages = React.useCallback(
    (card: RPCard, added: PhoneMessage[]) => {
      setMessages((prev) => {
        const next = [...prev, ...added];
        void persist(card, next);
        return next;
      });
    },
    [persist],
  );

  const openChat = React.useCallback(
    async (card: RPCard) => {
      setSelectedCard(card);
      setMessages([]);
      setImagePrompt(`${card.data.name}，精美插画`);
      try {
        const chat = await ensureChat(card);
        setMessages(chat.messages);
      } catch (err) {
        // 兜底：存取失败也先把开场白摆出来，不让聊天开天窗。
        setMessages([greetingMessage(card)]);
        setMessages((prev) => {
          void persist(card, prev);
          return prev;
        });
        void err;
      }
    },
    [persist],
  );

  const requestReply = React.useCallback(
    async (card: RPCard, history: PhoneMessage[]) => {
      const connectionId = phone.chatConnectionId || settings.defaultConnectionId || '';
      const connection = llmConnections.find((c) => c.id === connectionId);
      if (!llm || !connection) {
        appendMessages(card, [
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
      const llmMessages: LLMMessage[] = [
        {
          role: 'system',
          content: [
            `你是「${card.data.name}」，正在微信上和用户聊天。`,
            card.data.description ? `角色介绍：${card.data.description}` : '',
            card.data.personality ? `性格：${card.data.personality}` : '',
            card.data.scenario ? `场景：${card.data.scenario}` : '',
            card.data.first_mes ? `开场白：${card.data.first_mes}` : '',
            '请用角色的口吻简短回复，像在微信上发消息：1–3 句短句，口语化、亲切。不要写长段角色扮演，不要加舞台提示、括号说明或动作描写。',
          ]
            .filter(Boolean)
            .join('\n'),
        },
        ...recent.map((m): LLMMessage => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content:
            m.type === 'text'
              ? m.content
              : m.type === 'image'
                ? '[对方发来一张图片]'
                : '[表情]',
        })),
      ];
      setBusy(true);
      try {
        const result = await llm.complete(connectionId, {
          model,
          messages: llmMessages,
          temperature: 0.8,
          maxTokens: 300,
        });
        const replyText = result.text.trim();
        if (!replyText) return;
        const reply = makeMessage({ role: 'assistant', type: 'text', content: replyText });
        appendMessages(card, [reply]);
        // 情绪贴纸：中性不贴。
        const emotion = detectEmotion(replyText);
        if (emotion !== 'neutral') {
          const stickerUrl = pickSticker(emotion);
          if (stickerUrl) {
            appendMessages(card, [
              makeMessage({
                role: 'assistant',
                type: 'sticker',
                content: '',
                stickerUrl,
              }),
            ]);
          }
        }
      } catch (err) {
        appendMessages(card, [
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
    [appendMessages, llm, llmConnections, phone.chatConnectionId, phone.chatModel, settings.defaultConnectionId],
  );

  const sendText = () => {
    const card = selectedCard;
    const text = input.trim();
    if (!card || !text || busy) return;
    const userMsg = makeMessage({ role: 'user', type: 'text', content: text });
    const next = [...messages, userMsg];
    setMessages(next);
    void persist(card, next);
    setInput('');
    void requestReply(card, next);
  };

  const generateImage = async () => {
    const card = selectedCard;
    if (!card || generating) return;
    const prompt = imagePrompt.trim() || `${card.data.name}，精美插画`;
    const connectionId = phone.imageConnectionId || imageConnections[0]?.id || '';
    if (!image || !connectionId) {
      appendMessages(card, [
        makeMessage({
          role: 'system',
          type: 'text',
          content: '还没配置生图连接，先到「设置 → 生图」里添加一个',
        }),
      ]);
      return;
    }
    setGenerating(true);
    const note = makeMessage({ role: 'system', type: 'text', content: '正在生成图片…' });
    appendMessages(card, [note]);
    try {
      const results = await image.generate(connectionId, {
        prompt,
        size: phone.imageSize ?? 'square',
        model: phone.imageModel || undefined,
      });
      const first = results[0];
      if (!first) throw new Error('没有生成出图片');
      const blob = await dataUrlToBlob(first.dataUrl);
      const saved = await saveMediaImage(blob, {
        chatId: card.id,
        cardId: card.id,
        prompt,
        provider: first.provider,
        model: first.model,
      });
      appendMessages(card, [
        makeMessage({
          role: 'assistant',
          type: 'image',
          content: prompt,
          imageSrc: mediaRef(saved.id),
        }),
      ]);
    } catch (err) {
      appendMessages(card, [
        makeMessage({
          role: 'system',
          type: 'text',
          content: `生成图片失败：${err instanceof Error ? err.message : String(err)}`,
        }),
      ]);
    } finally {
      setGenerating(false);
    }
  };

  // ---------------- 联系人列表 ----------------
  if (!selectedCard) {
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-white text-neutral-900">
        <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 px-2 py-2.5">
          <button
            type="button"
            aria-label="返回主屏幕"
            onClick={onBack}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
          >
            <ChevronLeft className="size-6" />
          </button>
          <h2 className="text-base font-semibold">微信</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {cards.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-500">
              还没有角色卡，先去创建一张角色卡吧
            </p>
          ) : (
            cards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => void openChat(card)}
                className="flex w-full cursor-pointer items-center gap-3 border-b border-neutral-100 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
              >
                <Avatar card={card} size="size-12" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {card.data.name}
                  </span>
                  <span className="block truncate text-[13px] text-neutral-500">
                    {previews[card.id] ?? card.data.description ?? ''}
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    );
  }

  // ---------------- 聊天窗口 ----------------
  const card = selectedCard;
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-[#ededed] text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 bg-white px-2 py-2">
        <button
          type="button"
          aria-label="返回联系人"
          onClick={() => setSelectedCard(null)}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
        >
          <ChevronLeft className="size-6" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{card.data.name}</h2>
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
                {!isOwn && <Avatar card={card} size="size-9" />}
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
              <Avatar card={card} size="size-9" />
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
            placeholder={`${card.data.name}，精美插画`}
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
      <div className="flex shrink-0 items-center gap-2 border-t border-neutral-200 bg-white px-3 py-2 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]">
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
    </div>
  );
}
