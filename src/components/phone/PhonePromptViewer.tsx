/**
 * PhonePromptViewer — 小手机里的提示词构成查看器。
 *
 * 跟主聊天的 PromptInspector 一个思路：展示真正会发出去的东西。
 * 打开时按 requestReply 的同一套办法现算 extras（computeReplyExtras），
 * 再走 buildReplySystemPromptSections 分节，所以这里看到的每一节，
 * 就是下一次回复 system prompt 里那一节——不会漂移。
 *
 * 它住在手机里面：是小手机对话框里的一层内嵌视图（不是盖在整个
 * 屏幕上的大 Dialog），按手机内宽排、可滚动、只读，不改提示词。
 * 区块页按顺序列出 13 节（没写进提示词的节标“未包含”，不藏起来），
 * 原始页是 buildReplySystemPrompt 拼出来的完整文本，可以复制。
 */
import * as React from 'react';
import { Check, ChevronLeft, Copy } from 'lucide-react';
import { useApp } from '@/state/store.js';
import type { RPCard } from '@/core/types/card.js';
import type { PhoneContact, PhoneMessage } from '@/core/phone/types.js';
import {
  buildReplySystemPrompt,
  buildReplySystemPromptSections,
} from '@/core/phone/reply.js';
import { computeReplyExtras } from '@/core/phone/replyExtras.js';

export function PhonePromptViewer({
  chatId,
  card,
  contact,
  history,
  onBack,
}: {
  chatId: string;
  card: RPCard;
  contact: PhoneContact;
  history: PhoneMessage[];
  onBack: () => void;
}) {
  const [tab, setTab] = React.useState<'sections' | 'raw'>('sections');
  const [copied, setCopied] = React.useState(false);

  // 打开时现算：和 requestReply 同一份输入（主聊天最新消息 + 当前
  // 微信记录），所以没发过回复的联系人也能看。
  const { sections, raw } = React.useMemo(() => {
    const state = useApp.getState();
    const extras = computeReplyExtras({
      card,
      mainChat: state.chats.find((c) => c.id === chatId),
      presets: state.presets,
      lorebooks: state.lorebooks,
      lorebookDefaults: state.settings.lorebook,
      defaultPresetId: state.settings.defaultPresetId,
      history,
    });
    return {
      sections: buildReplySystemPromptSections(card, contact, extras),
      raw: buildReplySystemPrompt(card, contact, extras),
    };
  }, [chatId, card, contact, history]);

  const includedCount = sections.filter((s) => s.content).length;

  const copyRaw = () => {
    const done = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(raw).then(done, done);
    } else {
      done();
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 px-2 py-2">
        <button
          type="button"
          aria-label="返回聊天"
          onClick={onBack}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
        >
          <ChevronLeft className="size-6" />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">提示词构成</h2>
        <button
          type="button"
          aria-label="复制完整提示词"
          onClick={copyRaw}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] text-neutral-500 transition-colors hover:bg-neutral-100"
        >
          {copied ? (
            <>
              <Check className="size-4 text-[#07C160]" />
              已复制
            </>
          ) : (
            <>
              <Copy className="size-4" />
              复制
            </>
          )}
        </button>
      </div>

      <p className="shrink-0 px-4 pt-2.5 text-[12px] leading-relaxed text-neutral-500">
        这就是{contact.name}下一次回复会发送给模型的全部内容：预设决定「顺序」，
        角色卡提供「内容」，世界书决定「插入什么」。只读，不改提示词。
      </p>
      <p className="shrink-0 px-4 pt-1 text-[12px] text-neutral-400">
        共 {sections.length} 节 · 已包含 {includedCount} 节 · {raw.length} 字
      </p>

      <div className="flex shrink-0 gap-2 px-4 pt-2.5">
        <button
          type="button"
          onClick={() => setTab('sections')}
          className={`cursor-pointer rounded-full px-3 py-1.5 text-[13px] transition-colors ${
            tab === 'sections'
              ? 'bg-[#07C160] font-medium text-white'
              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
          }`}
        >
          区块
        </button>
        <button
          type="button"
          onClick={() => setTab('raw')}
          className={`cursor-pointer rounded-full px-3 py-1.5 text-[13px] transition-colors ${
            tab === 'raw'
              ? 'bg-[#07C160] font-medium text-white'
              : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
          }`}
        >
          原始
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {tab === 'sections' ? (
          <div className="flex flex-col gap-2">
            {sections.map((section, i) => {
              const included = section.content.length > 0;
              return (
                <section
                  key={section.key}
                  className={`rounded-xl border px-3 py-2.5 ${
                    included
                      ? 'border-neutral-200 bg-neutral-50'
                      : 'border-dashed border-neutral-200 bg-white opacity-60'
                  }`}
                >
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-xs text-neutral-400">{i + 1}</span>
                    <h3 className="flex-1 text-[14px] font-semibold">{section.label}</h3>
                    {included ? (
                      <span className="text-[11px] tabular-nums text-neutral-400">
                        {section.content.length} 字
                      </span>
                    ) : (
                      <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-400">
                        未包含
                      </span>
                    )}
                  </div>
                  {included ? (
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-neutral-700">
                      {section.content}
                    </p>
                  ) : (
                    <p className="text-[12px] text-neutral-400">
                      这一节没有内容，所以没放进提示词。
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        ) : (
          <pre className="whitespace-pre-wrap break-words rounded-xl border border-neutral-200 bg-neutral-50 p-3 font-mono text-[12px] leading-relaxed text-neutral-700">
            {raw}
          </pre>
        )}
      </div>
    </div>
  );
}
