import { useApp } from '@/state/store.js';
import { CardLibrary } from '@/components/cards/CardLibrary.js';

/** Cards page: the library plus import/drop handling. */
export function CardsPage({ onStartChat }: { onStartChat: () => void }) {
  const setActiveChat = useApp((s) => s.setActiveChat);
  return (
    <CardLibrary
      onStartChat={(chatId) => {
        setActiveChat(chatId);
        onStartChat();
      }}
    />
  );
}
