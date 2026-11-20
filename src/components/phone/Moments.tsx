/**
 * Moments — 小手机里的朋友圈。
 *
 * 搬的是“小手机”插件 wechat.html 里朋友圈那套逻辑，用 Rpnow 的办法
 * 重新写了一遍：
 *
 *   - 只由角色发帖：用户不发朋友圈。点右上角“发朋友圈”挑一个联系人，
 *     调一次模型生成一条动态（提示词见 `@/core/phone/moments.js`），
 *     帖子按时间倒序排。没有定时、没有后台调用——只在用户点的时候发。
 *   - 图片不跟着帖子一起生：帖子里只有 imageDesc（画面描述），点图片
 *     那块地方才真的走生图流程（和微信“＋”按钮同一条线：Tag 转写 +
 *     人数强制 solo + 画师串/负面提示词），图存进相册、也挂到帖子上。
 *     模型不会自己给帖子配图。
 *   - 点赞只做展示：likers + likes 都是模型编的，显示成
 *     “X、Y 等 N 人觉得很赞”；这个版本没有点赞按钮。
 *   - 评论：用户能评（直接评 / 点一条评论回复它 / @ 某个人），评完调
 *     一次模型让角色回（replier 优先级：@ 的人 > 被回复的人 > 发帖人；
 *     新评论的作者就是 replier 时换别人回；最多再让 1 个其他角色附和
 *     一句；回的内容按 `作者:内容` 去重）。
 *   - 世界书同步（只同步简介）：每个角色一条常驻条目“{名字}的朋友圈”
 *     （一行一条动态的简介），互动另外一条“{名字}的朋友圈互动”
 *     （用户评论和 AI 回复追加，只留最近 60 条）；角色没动态了就删掉
 *     他的“朋友圈”条目。同步写进每个聊天专属的“小手机·朋友圈”世界书，
 *     并挂到这个聊天的 lorebookIds 上（见 `@/core/phone/momentsStore.js`）。
 *   - 动态按聊天存 IndexedDB（`rpnow:phone:moments:<chatId>`），关掉
 *     重开还在；老聊天第一次打开是空的，不触发重新初始化；“重置”会连
 *     朋友圈一起清掉（朋友圈属于这个聊天的手机）。
 *   - 联系人和微信共用同一份缓存（`rpnow:phone:contacts:<chatId>`）：
 *     这里只读缓存，不初始化；联系人是空的（用户先点的朋友圈、主聊天
 *     还没产出隐藏数据块）就提示主聊天里聊出新人物后再来。
 */
import * as React from 'react';
import { AtSign, Camera, ChevronLeft, MapPin, Plus, Send, Trash2 } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { useImage, useLLM } from '@/hooks/useKernel.js';
import { uid } from '@/lib/utils.js';
import type { RPCard } from '@/core/types/card.js';
import type { MomentComment, MomentPost, PhoneContact, PhoneMessage } from '@/core/phone/types.js';
import { resolvePhoneUser } from '@/core/phone/contacts.js';
import { generatePhoneImage } from '@/core/phone/imageGen.js';
import {
  buildCommentReplyMessages,
  buildMomentPost,
  buildMomentsPostMessages,
  dedupeMomentComments,
  formatLikesLine,
  formatMomentsCommentsText,
  parseMomentCommentLines,
  parseMomentsPostText,
  pickCommentReplier,
} from '@/core/phone/moments.js';
import {
  loadMoments,
  saveMoments,
  syncMomentsInteraction,
  syncMomentsToLorebook,
  type MomentsLorebookDeps,
} from '@/core/phone/momentsStore.js';
import { computeReplyExtras, historyEntries } from '@/core/phone/replyExtras.js';
import { loadContacts, loadWeChatChat } from '@/core/phone/wechatStore.js';
import { PressableImage } from '@/components/media/PressableImage.js';
import { PhoneAvatar } from './PhoneAvatar.js';

function sortNewestFirst(posts: MomentPost[]): MomentPost[] {
  return [...posts].sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
}

export function Moments({
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
  const imageConnections = useApp((s) => s.imageConnections);
  const llm = useLLM();
  const image = useImage();

  const [contacts, setContacts] = React.useState<PhoneContact[] | null>(null);
  const [posts, setPosts] = React.useState<MomentPost[] | null>(null);
  /** 正在挑“让谁发一条朋友圈”。 */
  const [pickerOpen, setPickerOpen] = React.useState(false);
  /** 正在给谁生成朋友圈（联系人 id）。 */
  const [generatingFor, setGeneratingFor] = React.useState<string | null>(null);
  const [generateError, setGenerateError] = React.useState('');
  /** 正在给哪条动态生图（动态 id）。 */
  const [generatingImageFor, setGeneratingImageFor] = React.useState<string | null>(null);
  const [imageError, setImageError] = React.useState('');
  /** 正在给哪条动态写评论（动态 id）。 */
  const [commentingPostId, setCommentingPostId] = React.useState<string | null>(null);
  const [commentInput, setCommentInput] = React.useState('');
  /** 回复某条评论时，这里是那条评论的作者；@ 某个人时，这里是那个人的名字。 */
  const [commentReplyTo, setCommentReplyTo] = React.useState<string | null>(null);
  const [commentAtName, setCommentAtName] = React.useState<string | null>(null);
  const [commentBusy, setCommentBusy] = React.useState(false);

  const phone = settings.phone ?? {};

  // 打开朋友圈时重新读：联系人缓存（和微信同一份）和动态。
  // 联系人只读缓存、不初始化——初始化是微信第一次打开时做的事；
  // 用户先点的朋友圈、缓存还是空的，就提示先去微信。
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
        const stored = await loadMoments(chatId);
        if (!cancelled) setPosts(sortNewestFirst(stored ?? []));
      } catch {
        if (!cancelled) setPosts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, chatId]);

  const lorebookDeps = React.useCallback((): MomentsLorebookDeps | null => {
    const state = useApp.getState();
    const chat = state.chats.find((c) => c.id === chatId);
    if (!chat) return null;
    return {
      lorebooks: state.lorebooks,
      saveLorebook: state.saveLorebook,
      chat,
      saveChat: state.saveChat,
    };
  }, [chatId]);

  const persistPosts = React.useCallback(
    async (next: MomentPost[]) => {
      const sorted = sortNewestFirst(next);
      setPosts(sorted);
      try {
        await saveMoments(chatId, sorted);
      } catch {
        // 存失败不挡路：内存里还是对的，下次打开读旧的。
      }
    },
    [chatId],
  );

  const syncPosts = React.useCallback(
    async (next: MomentPost[]) => {
      const deps = lorebookDeps();
      if (!deps) return;
      try {
        await syncMomentsToLorebook(chatId, next, deps);
      } catch {
        // 世界书同步失败不挡发帖：动态已经存下来了。
      }
    },
    [chatId, lorebookDeps],
  );

  const syncInteraction = React.useCallback(
    async (post: MomentPost, comment: MomentComment) => {
      const deps = lorebookDeps();
      if (!deps) return;
      try {
        await syncMomentsInteraction(chatId, post, comment, deps);
      } catch {
        // 互动同步失败不挡评论：评论已经存下来了。
      }
    },
    [chatId, lorebookDeps],
  );

  /** 这个角色最近的微信聊天记录，拼成提示词里用的文字行。 */
  const wechatHistoryText = React.useCallback(async (contact: PhoneContact): Promise<PhoneMessage[]> => {
    try {
      const chat = await loadWeChatChat(contact.id);
      return chat?.messages ?? [];
    } catch {
      return [];
    }
  }, []);

  const userName = React.useCallback((): string => {
    const state = useApp.getState();
    const chat = state.chats.find((c) => c.id === chatId);
    if (!chat) return '用户';
    return resolvePhoneUser(chat, state.personas)?.name ?? '用户';
  }, [chatId]);

  /**
   * 让一个联系人发一条朋友圈：调一次模型（只在用户点了之后）。
   * 记忆的来源和小手机回复提示词同一套：这个角色的微信聊天记录（线上
   * 聊天）、主线剧情进度、世界书（里面已经含之前同步进去的朋友圈简介
   * 和互动）；人设用联系人自己的 profile。
   */
  const generatePost = (contact: PhoneContact) => {
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
        const history = await wechatHistoryText(contact);
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
          .map((m) => `${m.role === 'assistant' ? contact.name : userName()}：${m.content}`)
          .join('\n');
        const model = phone.chatModel || connection.defaultModel || '';
        const result = await llm.complete(connectionId, {
          model,
          messages: buildMomentsPostMessages({
            contact,
            userName: userName(),
            wechatHistoryText: historyText,
            plotProgress: extras.plotProgress ?? '',
            lorebookText: extras.lorebookText ?? '',
          }),
          temperature: 0.8,
          maxTokens: 600,
          signal: AbortSignal.timeout(30_000),
        });
        const parsed = parseMomentsPostText(result.text ?? '', contact.name);
        const post = buildMomentPost(parsed, contact.name);
        const next = sortNewestFirst([post, ...(posts ?? [])]);
        await persistPosts(next);
        await syncPosts(next);
      } catch (err) {
        setGenerateError(`生成失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setGeneratingFor(null);
      }
    })();
  };

  /**
   * 点图片生图：用户主动点的，走微信“＋”按钮同一条生图流程
   * （Tag 转写 + 人数强制 solo + 画师串/负面提示词），图存进相册、
   * 也挂到这条动态上。模型不会自己给帖子配图——没点之前只有
   * imageDesc 的文字。
   */
  const generatePostImage = (post: MomentPost) => {
    const contact = (contacts ?? []).find((c) => c.name === post.contactName);
    if (!contact || generatingImageFor) return;
    setImageError('');
    setGeneratingImageFor(post.id);
    void (async () => {
      try {
        const { imageSrc } = await generatePhoneImage(
          {
            llm,
            image,
            llmConnections,
            imageConnections,
            phone,
            imageGen: settings.imageGen,
            defaultConnectionId: settings.defaultConnectionId,
            card,
            chatId,
          },
          contact,
          post.imageDesc || post.text,
          [],
          'solo',
          [],
        );
        const next = (posts ?? []).map((p) => (p.id === post.id ? { ...p, imageUrl: imageSrc } : p));
        await persistPosts(next);
      } catch (err) {
        setImageError(`生成图片失败：${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setGeneratingImageFor(null);
      }
    })();
  };

  /** 删一条动态：删掉之后同步世界书（这个角色没动态了，他的条目也删掉）。 */
  const deletePost = (post: MomentPost) => {
    const next = (posts ?? []).filter((p) => p.id !== post.id);
    void (async () => {
      await persistPosts(next);
      await syncPosts(next);
    })();
  };

  /** 用户评完一条评论后，让角色回（一次模型调用）。 */
  const requestCommentReply = React.useCallback(
    async (post: MomentPost, newComment: MomentComment) => {
      const connectionId = phone.chatConnectionId || settings.defaultConnectionId || '';
      const connection = llmConnections.find((c) => c.id === connectionId);
      if (!llm || !connection) return;
      const replierName = pickCommentReplier(post, newComment);
      const replier = (contacts ?? []).find((c) => c.name === replierName);
      const state = useApp.getState();
      const mainChat = state.chats.find((c) => c.id === chatId);
      const replierHistory = replier ? await wechatHistoryText(replier) : [];
      const extras = computeReplyExtras({
        card,
        mainChat,
        presets: state.presets,
        lorebooks: state.lorebooks,
        lorebookDefaults: settings.lorebook,
        defaultPresetId: settings.defaultPresetId,
        history: replierHistory,
      });
      const memoryText = [
        historyEntries(replierHistory)
          .map((m) => `${m.role === 'assistant' ? replierName : userName()}：${m.content}`)
          .join('\n'),
        extras.lorebookText ?? '',
      ]
        .filter(Boolean)
        .join('\n');
      try {
        const model = phone.chatModel || connection.defaultModel || '';
        const result = await llm.complete(connectionId, {
          model,
          messages: buildCommentReplyMessages({
            post,
            replierName,
            replierProfile: replier?.profile ?? '',
            replierMemory: memoryText,
            newComment,
            commentsText: formatMomentsCommentsText(post),
          }),
          temperature: 0.8,
          maxTokens: 300,
          signal: AbortSignal.timeout(30_000),
        });
        const parsed = parseMomentCommentLines(result.text ?? '', post.contactName);
        const added = dedupeMomentComments(post.comments, parsed);
        if (added.length === 0) return;
        const nextPost = { ...post, comments: [...post.comments, ...added] };
        const next = (posts ?? []).map((p) => (p.id === post.id ? nextPost : p));
        await persistPosts(next);
        for (const c of added) await syncInteraction(nextPost, c);
      } catch {
        // AI 回复失败不挡路：用户的评论已经发出去了。
      }
    },
    [
      card,
      chatId,
      contacts,
      llm,
      llmConnections,
      phone.chatConnectionId,
      phone.chatModel,
      persistPosts,
      posts,
      settings.defaultConnectionId,
      settings.defaultPresetId,
      settings.lorebook,
      syncInteraction,
      userName,
      wechatHistoryText,
    ],
  );

  const sendComment = (post: MomentPost) => {
    const text = commentInput.trim();
    if (!text || commentBusy) return;
    const comment: MomentComment = {
      id: uid('mc'),
      author: userName(),
      text,
      replyTo: commentReplyTo,
      atName: commentAtName,
      timestamp: Date.now(),
    };
    const nextPost = { ...post, comments: [...post.comments, comment] };
    const next = (posts ?? []).map((p) => (p.id === post.id ? nextPost : p));
    setCommentInput('');
    setCommentReplyTo(null);
    setCommentAtName(null);
    setCommentingPostId(null);
    setCommentBusy(true);
    void (async () => {
      await persistPosts(next);
      await syncInteraction(nextPost, comment);
      await requestCommentReply(nextPost, comment);
      setCommentBusy(false);
    })();
  };

  const openCommentInput = (post: MomentPost, replyTo: string | null = null) => {
    setCommentingPostId(post.id);
    setCommentReplyTo(replyTo);
    setCommentAtName(null);
    setCommentInput('');
  };

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
        <h2 className="flex-1 text-base font-semibold">朋友圈</h2>
        <button
          type="button"
          aria-label="发朋友圈"
          onClick={() => {
            setGenerateError('');
            setPickerOpen(true);
          }}
          disabled={generatingFor !== null}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full bg-[#07C160] px-3 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="size-4" />
          发朋友圈
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {generateError && (
          <p className="mx-3 mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
            {generateError}
          </p>
        )}
        {posts === null ? (
          <p className="animate-pulse px-4 py-8 text-center text-sm text-neutral-500">
            正在打开朋友圈…
          </p>
        ) : posts.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Camera className="mx-auto size-10 text-neutral-300" />
            <p className="mt-3 text-sm text-neutral-500">
              还没有朋友圈。
              <br />
              点右上角“发朋友圈”，让一位联系人发一条。
            </p>
            {contacts !== null && contacts.length === 0 && (
              <p className="mt-2 text-[13px] text-neutral-400">
                还没有联系人：主聊天里聊出新人物后，回来再发。
              </p>
            )}
          </div>
        ) : (
          posts.map((post) => {
            const likesLine = formatLikesLine(post);
            const isGeneratingImage = generatingImageFor === post.id;
            return (
              <article key={post.id} className="border-b border-neutral-100 px-3 py-3">
                <div className="flex items-start gap-2.5">
                  <PhoneAvatar name={post.contactName} size="size-10" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="truncate text-[15px] font-semibold text-[#576B95]">
                        {post.contactName}
                      </span>
                      <span className="shrink-0 text-xs text-neutral-400">{post.time}</span>
                      <button
                        type="button"
                        aria-label={`删除${post.contactName}的朋友圈`}
                        onClick={() => deletePost(post)}
                        className="ml-auto flex shrink-0 cursor-pointer items-center gap-0.5 rounded-full px-1.5 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600"
                      >
                        <Trash2 className="size-3.5" />
                        删除
                      </button>
                    </div>
                    {post.location && (
                      <p className="mt-0.5 flex items-center gap-0.5 text-xs text-neutral-400">
                        <MapPin className="size-3" />
                        {post.location}
                      </p>
                    )}
                    <p className="mt-1.5 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-neutral-800">
                      {post.text}
                    </p>
                    {/* 图片：没生出来之前只显示画面描述，点一下才生图。 */}
                    {post.imageUrl ? (
                      <PressableImage
                        src={post.imageUrl}
                        alt={post.imageDesc || post.text}
                        className="mt-2 max-w-[220px] rounded-lg object-cover"
                      />
                    ) : post.imageDesc ? (
                      <button
                        type="button"
                        onClick={() => generatePostImage(post)}
                        disabled={isGeneratingImage}
                        className="mt-2 block w-full cursor-pointer rounded-lg bg-neutral-100 px-3 py-2.5 text-left text-[13px] leading-relaxed text-neutral-500 transition-colors hover:bg-neutral-200/70 disabled:opacity-60"
                      >
                        <span className="flex items-center gap-1.5 font-medium text-neutral-600">
                          <Camera className="size-4" />
                          {isGeneratingImage ? '正在生成图片…' : '点一下生成图片'}
                        </span>
                        <span className="mt-1 block">{post.imageDesc}</span>
                      </button>
                    ) : null}
                    {imageError && isGeneratingImage && (
                      <p className="mt-1.5 text-xs text-red-500">{imageError}</p>
                    )}
                    {/* 点赞只做展示：模型编的名单 + 数量，没有点赞按钮。 */}
                    {likesLine && (
                      <p className="mt-2 rounded bg-neutral-50 px-2.5 py-1.5 text-[13px] text-[#576B95]">
                        {likesLine}
                      </p>
                    )}
                    {/* 评论 */}
                    {post.comments.length > 0 && (
                      <div className="mt-1.5 rounded bg-neutral-50 px-2.5 py-1.5">
                        {post.comments.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => openCommentInput(post, c.author)}
                            className="block w-full cursor-pointer py-0.5 text-left text-[13px] leading-relaxed text-neutral-700"
                          >
                            <span className="font-semibold text-[#576B95]">{c.author}</span>
                            {c.replyTo && (
                              <span className="text-neutral-500"> 回复 </span>
                            )}
                            {c.replyTo && (
                              <span className="font-semibold text-[#576B95]">{c.replyTo}</span>
                            )}
                            {c.atName && (
                              <span className="text-neutral-500"> @{c.atName} </span>
                            )}
                            <span>：{c.text}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openCommentInput(post)}
                        className="cursor-pointer rounded-full bg-neutral-100 px-3 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-200"
                      >
                        评论
                      </button>
                    </div>
                    {commentingPostId === post.id && (
                      <div className="mt-2">
                        {commentAtName && (
                          <p className="mb-1 text-xs text-[#576B95]">@{commentAtName}</p>
                        )}
                        {commentReplyTo && !commentAtName && (
                          <p className="mb-1 text-xs text-neutral-500">回复 {commentReplyTo}</p>
                        )}
                        <div className="flex items-center gap-2">
                          <input
                            value={commentInput}
                            onChange={(e) => setCommentInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') sendComment(post);
                            }}
                            placeholder={
                              commentAtName
                                ? `对 ${commentAtName} 说点什么…`
                                : commentReplyTo
                                  ? `回复 ${commentReplyTo}…`
                                  : '评论…'
                            }
                            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#07C160]"
                          />
                          <button
                            type="button"
                            aria-label="发送评论"
                            onClick={() => sendComment(post)}
                            disabled={commentBusy || !commentInput.trim()}
                            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#07C160] text-white transition-opacity disabled:opacity-40"
                          >
                            <Send className="size-4" />
                          </button>
                        </div>
                        <div className="mt-1.5 flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label="选择要@的人"
                            onClick={() => setCommentAtName((v) => (v ? null : ''))}
                            className="flex cursor-pointer items-center gap-0.5 rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-200"
                          >
                            <AtSign className="size-3.5" />@
                          </button>
                          {commentAtName === '' &&
                            (contacts ?? []).map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                onClick={() => setCommentAtName(c.name)}
                                className="cursor-pointer rounded-full bg-neutral-100 px-2 py-1 text-xs text-neutral-600 transition-colors hover:bg-neutral-200"
                              >
                                {c.name}
                              </button>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </article>
            );
          })
        )}
        {generatingFor && (
          <p className="animate-pulse px-4 py-4 text-center text-sm text-neutral-500">
            正在发布朋友圈…
          </p>
        )}
      </div>

      {/* 挑“让谁发一条朋友圈” */}
      {pickerOpen && (
        <div className="absolute inset-0 z-20 flex items-end justify-center bg-black/40">
          <div className="w-full rounded-t-2xl bg-white p-4 shadow-xl">
            <h3 className="text-[15px] font-semibold text-neutral-900">让谁发一条朋友圈？</h3>
            <p className="mt-1 text-[13px] text-neutral-500">
              只有角色会发朋友圈，用户不发。
            </p>
            <div className="mt-3 flex max-h-64 flex-col gap-1 overflow-y-auto">
              {(contacts ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => generatePost(c)}
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
                  还没有联系人：主聊天里聊出新人物后，回来再发。
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
