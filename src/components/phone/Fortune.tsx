/**
 * Fortune — 小手机里的运势占卜 / 塔罗。
 *
 * 搬的是“小手机”插件 fortune.html 那套逻辑，用 Rpnow 的办法重新写了一遍：
 *
 *   - 运势占卜：挑一个类别（事业 / 爱情 / 财运 / 健康），点“占卜”调一次
 *     模型（只在用户点了之后），按占星师的口吻给标题、一段解读、幸运色、
 *     1–9 的幸运数字和一句口头禅；模型失败或回空时，用每类写好的静态解读
 *     兜底，不再调第二次模型。
 *   - 塔罗：点“抽牌”从 22 张大阿卡纳里随机抽一张（50% 逆位），再调一次
 *     模型写约 100 字的解读；模型失败或回空时，用这张牌写好的静态牌义兜底。
 *   - 只存最新的一次运势和最新一次塔罗（新的来了就覆盖旧的），按聊天存
 *     IndexedDB（`rpnow:phone:fortune:<chatId>`），关掉重开还在；老聊天
 *     第一次打开是空的，不触发重新初始化；“重置”会连运势一起清掉。
 *   - 结果能复制成文本。不写世界书、不花钱、不动好感度。
 *   - 插件里“运势影响财运模拟器”那条线没搬：Rpnow 没有财富/股票模块。
 */
import * as React from 'react';
import { ChevronLeft, Copy, MoonStar, Sparkles, Wand2 } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { useLLM } from '@/hooks/useKernel.js';
import type { FortuneCategoryId, FortuneState, HoroscopeResult, TarotDraw } from '@/core/phone/types.js';
import {
  buildHoroscopeMessages,
  buildTarotDraw,
  buildTarotMessages,
  drawTarotCard,
  fallbackHoroscope,
  fallbackTarot,
  formatHoroscopeCopyText,
  formatTarotCopyText,
  fortuneCategoryLabel,
  FORTUNE_CATEGORIES,
  parseHoroscopeText,
  parseTarotText,
  tarotOrientation,
} from '@/core/phone/fortune.js';
import { emptyFortuneState, loadFortune, saveFortune } from '@/core/phone/fortuneStore.js';

export function Fortune({
  chatId,
  onBack,
  active,
}: {
  chatId: string;
  onBack: () => void;
  /** 这个应用当前是不是显示在屏幕上（切回来时重新读缓存）。 */
  active: boolean;
}) {
  const settings = useApp((s) => s.settings);
  const llmConnections = useApp((s) => s.llmConnections);
  const llm = useLLM();

  const [state, setState] = React.useState<FortuneState | null>(null);
  const [category, setCategory] = React.useState<FortuneCategoryId>('career');
  /** 正在占卜哪个类别（null = 没在占卜）。 */
  const [drawingHoroscope, setDrawingHoroscope] = React.useState(false);
  /** 正在抽塔罗。 */
  const [drawingTarot, setDrawingTarot] = React.useState(false);
  const [error, setError] = React.useState('');
  /** 复制后显示“已复制”的小提示（horoscope / tarot / null）。 */
  const [copied, setCopied] = React.useState<'horoscope' | 'tarot' | null>(null);

  const phone = settings.phone ?? {};

  // 打开运势时重新读缓存（只留最新的一次运势和最新一次塔罗）。
  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      try {
        const stored = await loadFortune(chatId);
        if (!cancelled) setState(stored ?? emptyFortuneState());
      } catch {
        if (!cancelled) setState(emptyFortuneState());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, chatId]);

  const persistState = React.useCallback(
    async (next: FortuneState) => {
      setState(next);
      try {
        await saveFortune(chatId, next);
      } catch {
        // 存失败不挡路：内存里还是对的，下次打开读旧的。
      }
    },
    [chatId],
  );

  const llmConnection = React.useCallback(() => {
    const connectionId = phone.chatConnectionId || settings.defaultConnectionId || '';
    const connection = llmConnections.find((c) => c.id === connectionId);
    if (!llm || !connection) return null;
    return { llm, connection, connectionId, model: phone.chatModel || connection.defaultModel || '' };
  }, [llm, llmConnections, phone.chatConnectionId, phone.chatModel, settings.defaultConnectionId]);

  const copyText = (text: string, which: 'horoscope' | 'tarot') => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // 剪贴板写不进（比如没权限）时也不报错：用户还能手动选中复制。
      }
      setCopied(which);
      window.setTimeout(() => setCopied((v) => (v === which ? null : v)), 2000);
    })();
  };

  /** 占卜一次运势：调一次模型；失败或回空时用静态解读兜底。 */
  const drawHoroscope = (cat: FortuneCategoryId) => {
    const conn = llmConnection();
    if (!conn) {
      setError('还没配置模型连接，先到「设置 → 模型」里添加一个');
      return;
    }
    setError('');
    setDrawingHoroscope(true);
    void (async () => {
      let result: HoroscopeResult;
      try {
        const res = await conn.llm.complete(conn.connectionId, {
          model: conn.model,
          messages: buildHoroscopeMessages(cat),
          temperature: 0.8,
          maxTokens: 500,
          signal: AbortSignal.timeout(30_000),
        });
        result = parseHoroscopeText(res.text ?? '', cat) ?? fallbackHoroscope(cat);
      } catch {
        // 模型失败：静态兜底，不再调第二次模型。
        result = fallbackHoroscope(cat);
      }
      await persistState({ ...(state ?? emptyFortuneState()), horoscope: result });
      setDrawingHoroscope(false);
    })();
  };

  /** 抽一张塔罗：先抽牌（50% 逆位），再调一次模型写解读；失败用静态牌义兜底。 */
  const drawTarot = () => {
    const conn = llmConnection();
    if (!conn) {
      setError('还没配置模型连接，先到「设置 → 模型」里添加一个');
      return;
    }
    setError('');
    setDrawingTarot(true);
    void (async () => {
      const { cardName, reversed } = drawTarotCard();
      let reading: string;
      try {
        const res = await conn.llm.complete(conn.connectionId, {
          model: conn.model,
          messages: buildTarotMessages(cardName, reversed),
          temperature: 0.8,
          maxTokens: 400,
          signal: AbortSignal.timeout(30_000),
        });
        reading = parseTarotText(res.text ?? '') || fallbackTarot(cardName, reversed);
      } catch {
        // 模型失败：静态牌义兜底，不再调第二次模型。
        reading = fallbackTarot(cardName, reversed);
      }
      const draw: TarotDraw = buildTarotDraw(cardName, reversed, reading);
      await persistState({ ...(state ?? emptyFortuneState()), tarot: draw });
      setDrawingTarot(false);
    })();
  };

  const horoscope = state?.horoscope ?? null;
  const tarot = state?.tarot ?? null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#FDF8FF] text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 border-b border-violet-100 px-2 py-2.5">
        <button
          type="button"
          aria-label="返回主屏幕"
          onClick={onBack}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-violet-100/60"
        >
          <ChevronLeft className="size-6" />
        </button>
        <h2 className="flex-1 text-base font-semibold">运势</h2>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error && (
          <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">{error}</p>
        )}

        {/* 运势占卜 */}
        <section aria-label="运势占卜">
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold">
            <Sparkles className="size-4 text-violet-500" />
            今日运势
          </h3>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {FORTUNE_CATEGORIES.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategory(c.id)}
                aria-pressed={category === c.id}
                className={
                  category === c.id
                    ? 'cursor-pointer rounded-lg bg-violet-500 px-2 py-2 text-sm font-medium text-white'
                    : 'cursor-pointer rounded-lg bg-violet-100/70 px-2 py-2 text-sm text-violet-700 transition-colors hover:bg-violet-100'
                }
              >
                {c.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => drawHoroscope(category)}
            disabled={drawingHoroscope}
            className="mt-2 w-full cursor-pointer rounded-lg bg-violet-500 px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {drawingHoroscope ? '正在占卜…' : `占卜今天的${fortuneCategoryLabel(category)}运势`}
          </button>

          {horoscope && (
            <div className="mt-3 rounded-xl border border-violet-100 bg-white p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-neutral-900">{horoscope.title}</p>
                  <p className="mt-0.5 text-xs text-neutral-400">
                    {fortuneCategoryLabel(horoscope.category)}运势
                  </p>
                </div>
                <button
                  type="button"
                  aria-label="复制运势结果"
                  onClick={() => copyText(formatHoroscopeCopyText(horoscope), 'horoscope')}
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1.5 text-xs text-violet-600 transition-colors hover:bg-violet-100"
                >
                  <Copy className="size-3.5" />
                  {copied === 'horoscope' ? '已复制' : '复制'}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-neutral-800">
                {horoscope.reading}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">
                  幸运色：{horoscope.luckyColor}
                </span>
                <span className="rounded-full bg-violet-50 px-2.5 py-1 text-violet-700">
                  幸运数字：{horoscope.luckyNumber}
                </span>
              </div>
              {horoscope.mantra && (
                <p className="mt-2 text-[13px] text-neutral-500">口头禅：{horoscope.mantra}</p>
              )}
            </div>
          )}
        </section>

        {/* 塔罗 */}
        <section aria-label="塔罗占卜" className="mt-6">
          <h3 className="flex items-center gap-1.5 text-[15px] font-semibold">
            <MoonStar className="size-4 text-violet-500" />
            塔罗抽牌
          </h3>
          <p className="mt-1 text-[13px] text-neutral-500">
            从 22 张大阿卡纳里抽一张牌，看看今天的提示。
          </p>
          <button
            type="button"
            onClick={drawTarot}
            disabled={drawingTarot}
            className="mt-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-violet-500 px-3 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Wand2 className="size-4" />
            {drawingTarot ? '正在抽牌…' : '抽一张塔罗牌'}
          </button>

          {tarot && (
            <div className="mt-3 rounded-xl border border-violet-100 bg-white p-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-neutral-900">
                    {tarot.cardName}（{tarotOrientation(tarot.reversed)}）
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-400">大阿卡纳 · 最新一次抽牌</p>
                </div>
                <button
                  type="button"
                  aria-label="复制塔罗结果"
                  onClick={() => copyText(formatTarotCopyText(tarot), 'tarot')}
                  className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1.5 text-xs text-violet-600 transition-colors hover:bg-violet-100"
                >
                  <Copy className="size-3.5" />
                  {copied === 'tarot' ? '已复制' : '复制'}
                </button>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-neutral-800">
                {tarot.reading}
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
