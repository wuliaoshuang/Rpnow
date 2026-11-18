/**
 * Chat page: picks the active chat (or creates one from the most recent card)
 * and renders the chat view.
 */

import { useEffect, useMemo } from 'react';
import { MessageSquarePlus, Menu, SlidersHorizontal, UserRound } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { ChatView } from '@/components/chat/ChatView.js';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/misc.js';
import { buildGreetings } from '@/features/chat/orchestrator.js';
import { uid, formatRelativeTime } from '@/lib/utils.js';
import { SessionRail } from '@/components/chat/SessionRail.js';

export function ChatPage({
  onOpenCards,
  onOpenDrawer,
  onOpenSettings,
  branchesOpen,
  onBranchesOpenChange,
  inspectorOpen,
  onInspectorOpenChange,
  onNavigate,
}: {
  onOpenCards: () => void;
  /** Opens the left panel (chat list). */
  onOpenDrawer: () => void;
  /** Opens the right panel (conversation settings). */
  onOpenSettings: () => void;
  /** Branch panel + prompt inspector are owned by the app so the right panel
   *  can open them after it closes. */
  branchesOpen?: boolean;
  onBranchesOpenChange?: (v: boolean) => void;
  inspectorOpen?: boolean;
  onInspectorOpenChange?: (v: boolean) => void;
  /** Generic navigation used by the side panels (optionally to a settings tab). */
  onNavigate: (route: import('@/components/layout/AppShell.js').Route, tab?: string) => void;
}) {
  const chats = useApp((s) => s.chats);
  const cards = useApp((s) => s.cards);
  const personas = useApp((s) => s.personas);
  const activeChatId = useApp((s) => s.activeChatId);
  const setActiveChat = useApp((s) => s.setActiveChat);
  const saveChat = useApp((s) => s.saveChat);
  const settings = useApp((s) => s.settings);

  const sorted = useMemo(() => [...chats].sort((a, b) => b.updatedAt - a.updatedAt), [chats]);
  const active = chats.find((c) => c.id === activeChatId) ?? sorted[0];
  const card = cards.find((c) => c.id === active?.cardId);

  // Auto-select the newest chat once data is available.
  useEffect(() => {
    if (!activeChatId && sorted[0]) setActiveChat(sorted[0].id);
  }, [activeChatId, setActiveChat, sorted]);

  if (!active || !card) {
    // Empty states still live inside the standard chrome so the global drawer
    // (and its chat list) is reachable — otherwise a first-time user with no
    // chats has no navigation at all.
    const empty = (
      <>
        {cards.length === 0 ? (
          <EmptyState
            icon={<MessageSquarePlus className="size-6" aria-hidden="true" />}
            title="欢迎使用 RPNow"
            description="先导入或创建一个角色卡，然后就能开始对话了。"
            action={
              <Button size="sm" onClick={onOpenCards}>
                去角色卡页面
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<UserRound className="size-6" aria-hidden="true" />}
            title="开始你的第一段对话"
            description="从下面选一个角色，或打开左上角 ☰ 浏览全部角色卡。"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {cards.slice(0, 3).map((c) => (
                  <Button
                    key={c.id}
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const chat = {
                        id: uid('chat'),
                        title: c.data.name,
                        cardId: c.id,
                        lorebookIds: [],
                        useCardLorebook: true,
                        personaId: personas[0]?.id,
                        connectionId: settings.defaultConnectionId,
                        messages: buildGreetings(c),
                        variables: {},
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                      };
                      void saveChat(chat);
                      setActiveChat(chat.id);
                    }}
                  >
                    {c.data.name}
                  </Button>
                ))}
              </div>
            }
          />
        )}
      </>
    );
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--rp-border)] px-2 pt-[calc(env(safe-area-inset-top,0px)+0.4rem)] pb-1.5 sm:px-3">
          <button
            type="button"
            aria-label="打开聊天列表"
            onClick={onOpenDrawer}
            className="flex size-10 cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--rp-bg-sunken)]"
          >
            <Menu className="size-5" aria-hidden="true" />
          </button>
          <p className="flex-1 text-center text-[15px] font-semibold">RPNow</p>
          <button
            type="button"
            aria-label="打开对话设置"
            onClick={onOpenSettings}
            className="flex size-10 cursor-pointer items-center justify-center rounded-lg hover:bg-[var(--rp-bg-sunken)]"
          >
            <SlidersHorizontal className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1">{empty}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      <SessionRail
        chats={sorted}
        cards={cards}
        activeId={active.id}
        onSelect={setActiveChat}
        onNew={onOpenCards}
      />
      <div className="min-w-0 flex-1">
        <ChatView
          key={active.id}
          chat={active}
          card={card}
          onUpdate={(next) => void saveChat(next)}
          onOpenCards={onOpenCards}
          onOpenSettings={onOpenSettings}
          onOpenList={onOpenDrawer}
          onNavigate={onNavigate}
          branchesOpen={branchesOpen}
          onBranchesOpenChange={onBranchesOpenChange}
          inspectorOpen={inspectorOpen}
          onInspectorOpenChange={onInspectorOpenChange}
        />
      </div>
    </div>
  );
}

export { formatRelativeTime };
