/**
 * Diary — 小手机里的日记。
 *
 * 搬的是“小手机”插件 diary.html 那套逻辑，用 Rpnow 的办法重新写了一遍：
 *
 *   - 手写日记：用户自己打字，没有角色归属，存在列表最前面。
 *   - AI 日记：点“让 TA 写日记”挑一个联系人，调一次模型（只在用户点了
 *     之后），用那个联系人的 profile + 主线剧情最近进展 + 这个联系人
 *     最近的微信聊天记录，以 TA 的第一人称写一篇 100–150 字的日记。
 *   - 每篇都能删。时间戳用真实时间（Rpnow 没有世界时钟，插件的世界内
 *     时间没搬）。
 *   - 日记按聊天存 IndexedDB（`rpnow:phone:diary:<chatId>`），最新在前，
 *     关掉重开还在；老聊天第一次打开是空的，不触发重新初始化；“重置”
 *     会连日记一起清掉。联系人和微信共用同一份缓存：只读，不初始化——
 *     联系人是空的（主聊天还没产出隐藏数据块）就提示主聊天里聊出新人物后再来。
 *   - 不写世界书、不花钱、不动好感度；输入用真实输入框，不用插件的
 *     prompt() 弹窗。
 */
import * as React from 'react';
import { BookOpenText, ChevronLeft, PenLine, Sparkles, Trash2 } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { useLLM } from '@/hooks/useKernel.js';
import type { RPCard } from '@/core/types/card.js';
import type { DiaryEntry, PhoneContact, PhoneMessage } from '@/core/phone/types.js';
import { resolvePhoneUser } from '@/core/phone/contacts.js';
import { buildDiaryMessages, createDiaryEntry, parseDiaryText, sortDiaryNewestFirst } from '@/core/phone/diary.js';
import { loadDiary, saveDiary } from '@/core/phone/diaryStore.js';
import { computeReplyExtras, historyEntries } from '@/core/phone/replyExtras.js';
import { loadContacts, loadWeChatChat } from '@/core/phone/wechatStore.js';
import { PhoneAvatar } from './PhoneAvatar.js';

export function Diary({
  chatId,
  card,
  onBack,
  active,
}: {
  chatId: string;
  card: RPCard;
  onBack: () => void;
  /** 这个应用当前是不是显示在屏幕上（切回来时重新读缓存）。 */
  active: boolean;
}) {
  const settings = useApp((s) => s.settings);
  const llmConnections = useApp((s) => s.llmConnections);
  const llm = useLLM();

  const [contacts, setContacts] = React.useState<PhoneContact[] | null>(null);
  const [entries, setEntries] = React.useState<DiaryEntry[] | null>(null);
  const [manualInput, setManualInput] = React.useState('');
  /** 正在挑“让谁写一篇日记”。 */
  const [pickerOpen, setPickerOpen] = React.useState(false);
  /** 正在为谁代写日记（联系人 id）。 */
  const [generatingFor, setGeneratingFor] = React.useState<string | null>(null);
  const [generateError, setGenerateError] = React.useState('');

  const phone = settings.phone ?? {};

  // 打开日记时重新读：联系人缓存（和微信同一份）和日记。
  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const cached = await loadContacts(chatId);
        if (!cancelled) setContacts(cached ?? []);
      } catch {
        if (!cancelled) setContacts([]);
      }
      try {
        const stored = await loadDiary(chatId);
        if (!cancelled) setEntries(sortDiaryNewestFirst(stored ?? []));
      } catch {
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, chatId]);

  const persistEntries = React.useCallback(
    async (next: DiaryEntry[]) => {
      const sorted = sortDiaryNewestFirst(next);
      setEntries(sorted);
      try {
        await saveDiary(chatId, sorted);
      } catch {
        // 存失败不挡路：内存里还是对的，下次打开读旧的。
      }
    },
    [chatId],
  );

  /** 写一篇手写日记：用户自己打字，没有角色归属。 */
  const addManualEntry = () => {
    const entry = createDiaryEntry(manualInput, null);
    if (!entry) return;
    setManualInput('');
    void persistEntries([entry, ...(entries ?? [])]);
  };

  /** 让一个联系人写一篇日记：调一次模型（只在用户点了之后）。 */
  const generateEntry = (contact: PhoneContact) => {
    const connectionId = phone.chatConnectionId || settings.defaultConnectionId || '';
    const connection = llmConnections.find((c) => c.id === connectionId);
    if (!llm || !connection) {
      setGenerateError('还没配置模型连接，先到「设置 → 模型」里添加一个');
      return;
    }
    setPickerOpen(false);
    setGenerateError('');
    setGeneratingFor(contact.id);
    void (async () => {
      try {
        const state = useApp.getState();
        const mainChat = state.chats.find((c) => c.id === chatId);
        const userName = mainChat
          ? (resolvePhoneUser(mainChat, state.personas)?.name ?? '用户')
          : '用户';
        let history: PhoneMessage[] = [];
        try {
          history = (await loadWeChatChat(contact.id))?.messages ?? [];
        } catch {
          history = [];
        }
        const extras = computeReplyExtras({
          card,
          mainChat,
          presets: state.presets,
          lorebooks: state.lorebooks,
          lorebookDefaults: settings.lorebook,
          defaultPresetId: settings.defaultPresetId,
          history,
        });
        const historyText = historyEntries(history)
          .map((m) => `${m.role === 'assistant' ? contact.name : userName}：${m.content}`)
          .join('\n');
        const model = phone.chatModel || connection.defaultModel || '';
        const result = await llm.complete(connectionId, {
          model,
          messages: buildDiaryMessages({
            contact,
            userName,
            wechatHistoryText: historyText,
            plotProgress: extras.plotProgress ?? '',
            lorebookText: extras.lorebookText ?? '',
          }),
          temperature: 0.8,
          maxTokens: 500,
          signal: AbortSignal.timeout(30_000),
        });
        const text = parseDiaryText(result.text ?? '');
        if (!text) {
          setGenerateError('模型这次没写出日记，再试一次吧');
          return;
        }
        const entry = createDiaryEntry(text, contact.name);
        if (!entry) return;
        await persistEntries([entry, ...(entries ?? [])]);
      } catch (err) {
        setGenerateError(`生成失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setGeneratingFor(null);
      }
    })();
  };

  /** 删一篇日记。 */
  const deleteEntry = (entry: DiaryEntry) => {
    void persistEntries((entries ?? []).filter((e) => e.id !== entry.id));
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#FFFDF5] text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 border-b border-amber-100 px-2 py-2.5">
        <button
          type="button"
          aria-label="返回主屏幕"
          onClick={onBack}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-amber-100/60"
        >
          <ChevronLeft className="size-6" />
        </button>
        <h2 className="flex-1 text-base font-semibold">日记</h2>
        <button
          type="button"
          aria-label="让角色写日记"
          onClick={() => {
            setGenerateError('');
            setPickerOpen(true);
          }}
          disabled={generatingFor !== null}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-amber-500 px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Sparkles className="size-4" />
          让 TA 写日记
        </button>
      </div>

      {/* 手写日记的输入框 */}
      <div className="shrink-0 border-b border-amber-100 px-3 py-2.5">
        <div className="flex items-start gap-2">
          <textarea
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            placeholder="写点今天的事…"
            rows={2}
            aria-label="写日记"
            className="min-w-0 flex-1 resize-none rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm leading-relaxed outline-none focus:border-amber-400"
          />
          <button
            type="button"
            aria-label="保存日记"
            onClick={addManualEntry}
            disabled={!manualInput.trim()}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-amber-500 px-3 py-2 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <PenLine className="size-4" />
            保存
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {generateError && (
          <p className="mx-3 mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
            {generateError}
          </p>
        )}
        {entries === null ? (
          <p className="animate-pulse px-4 py-8 text-center text-sm text-neutral-500">
            正在打开日记…
          </p>
        ) : entries.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <BookOpenText className="mx-auto size-10 text-amber-200" />
            <p className="mt-3 text-sm text-neutral-500">
              还没有日记。
              <br />
              上面写一篇，或者让一位联系人替你写一篇。
            </p>
            {contacts !== null && contacts.length === 0 && (
              <p className="mt-2 text-[13px] text-neutral-400">
                还没有联系人：主聊天里聊出新人物后，回来再让 TA 写。
              </p>
            )}
          </div>
        ) : (
          entries.map((entry) => (
            <article key={entry.id} className="border-b border-amber-100 px-4 py-3">
              <div className="flex items-center gap-2">
                {entry.characterName ? (
                  <>
                    <PhoneAvatar name={entry.characterName} size="size-7" />
                    <span className="text-[13px] font-semibold text-amber-700">
                      {entry.characterName}的日记
                    </span>
                  </>
                ) : (
                  <span className="text-[13px] font-semibold text-neutral-600">我的日记</span>
                )}
                <span className="text-xs text-neutral-400">{entry.displayTime}</span>
                <button
                  type="button"
                  aria-label="删除这篇日记"
                  onClick={() => deleteEntry(entry)}
                  className="ml-auto flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full px-1.5 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                >
                  <Trash2 className="size-3.5" />
                  删除
                </button>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-neutral-800">
                {entry.content}
              </p>
            </article>
          ))
        )}
        {generatingFor && (
          <p className="animate-pulse px-4 py-4 text-center text-sm text-neutral-500">
            正在写日记…
          </p>
        )}
      </div>

      {/* 挑“让谁写一篇日记” */}
      {pickerOpen && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/40">
          <div className="w-full rounded-t-2xl bg-white p-4 shadow-xl">
            <h3 className="text-[15px] font-semibold text-neutral-900">让谁写一篇日记？</h3>
            <p className="mt-1 text-[13px] text-neutral-500">
              TA 会以第一人称，写一篇今天的日记。
            </p>
            <div className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {(contacts ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => generateEntry(c)}
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-neutral-50"
                >
                  <PhoneAvatar name={c.name} size="size-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{c.name}</span>
                    {c.profile && (
                      <span className="block truncate text-[13px] text-neutral-500">{c.profile}</span>
                    )}
                  </span>
                </button>
              ))}
              {(contacts ?? []).length === 0 && (
                <p className="py-4 text-center text-sm text-neutral-500">
                  还没有联系人：主聊天里聊出新人物后，回来再让 TA 写。
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => setPickerOpen(false)}
              className="mt-3 w-full cursor-pointer rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-200"
            >
              取消
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
