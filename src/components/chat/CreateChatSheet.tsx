/**
 * Create-chat sheet — opened by the ＋ menu's "创建聊天" (Tavo layout).
 *
 * Bottom sheet: title "选择角色", one row per character card with a radio
 * circle on the left, avatar in the middle, name on the right. Tapping a row
 * creates the chat immediately (same greeting flow as the card library's
 * "开始新聊天") and hands the new chat id to the caller.
 */

import { createPortal } from 'react-dom';
import { useApp } from '@/state/store.js';
import { buildGreetings } from '@/features/chat/orchestrator.js';
import { uid } from '@/lib/utils.js';
import { vibrate } from '@/lib/haptics';
import type { RPCard } from '@/core/types/card.js';
import type { RPChat } from '@/core/types/chat.js';

export function CreateChatSheet({
  open,
  onClose,
  onCreated,
  onOpenCards,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the new chat id so the caller can switch to it. */
  onCreated: (chatId: string) => void;
  /** Empty state: go to the card library to import a card first. */
  onOpenCards: () => void;
}) {
  const cards = useApp((s) => s.cards);
  const personas = useApp((s) => s.personas);
  const settings = useApp((s) => s.settings);
  const saveChat = useApp((s) => s.saveChat);
  const setActiveChat = useApp((s) => s.setActiveChat);

  function startChat(card: RPCard) {
    const chat: RPChat = {
      id: uid('chat'),
      title: card.data.name,
      cardId: card.id,
      lorebookIds: [],
      useCardLorebook: true,
      personaId: personas[0]?.id,
      connectionId: settings.defaultConnectionId,
      model: undefined,
      messages: buildGreetings(card),
      variables: {},
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    void saveChat(chat);
    setActiveChat(chat.id);
    onClose();
    onCreated(chat.id);
  }

  if (!open) return null;

  // Portal 到 body：sheet 在左侧栏里打开，栏本身在页面层（z-10）之下，
  // 不 portal 的话遮罩和面板会被推开的页面盖住一半。
  return createPortal(
    <div className="fixed inset-0 z-50" role="dialog" aria-label="选择角色">
      <button
        type="button"
        aria-label="关闭"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/50 backdrop-blur-[2px]"
      />
      <div className="rp-anim-pop absolute inset-x-0 bottom-0 max-h-[70dvh] rounded-t-2xl border-t border-[var(--rp-border)] bg-[var(--rp-bg-elevated)] pb-[calc(env(safe-area-inset-bottom,0px)+0.75rem)] shadow-rp">
        <div className="mx-auto mb-1 mt-2.5 h-1 w-10 rounded-full bg-[var(--rp-border-strong)]" />
        <p className="pb-2 pt-1 text-center text-[15px] font-semibold">选择角色</p>
        <div className="rp-scroll min-h-0 overflow-y-auto px-2">
          {cards.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-[12.5px] text-[var(--rp-fg-subtle)]">还没有角色卡，先导入一张吧。</p>
              <button
                type="button"
                onClick={() => {
                  vibrate('tap');
                  onClose();
                  onOpenCards();
                }}
                className="mt-3 cursor-pointer rounded-full bg-[var(--rp-accent)] px-4 py-2 text-[12.5px] font-medium text-[var(--rp-accent-fg)]"
              >
                去角色卡页
              </button>
            </div>
          ) : (
            cards.map((card) => (
              <button
                key={card.id}
                type="button"
                onClick={() => {
                  vibrate('tap');
                  startChat(card);
                }}
                className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-[var(--rp-bg-sunken)]"
                aria-label={`和 ${card.data.name} 开始聊天`}
              >
                {/* Radio circle, Tavo style: empty until the moment of the tap. */}
                <span
                  aria-hidden="true"
                  className="size-5 shrink-0 rounded-full border-2 border-[var(--rp-border-strong)]"
                />
                <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--rp-bg-sunken)] text-[13px] font-semibold text-[var(--rp-fg-muted)]">
                  {card.avatar ? (
                    <img src={card.avatar} alt="" className="size-full object-cover" />
                  ) : (
                    card.data.name.slice(0, 1)
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{card.data.name}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
