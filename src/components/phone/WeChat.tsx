/**
 * WeChat — 小手机里的微信。
 *
 * 联系人是当前聊天卡里提到的人物：去世界书 / 设定里找提到了哪些人，
 * 转成联系人（卡的主角本人不是联系人——微信是主角的手机，联系人是
 * 主角世界里的其他人）。第一次打开时调一次模型找出来（见
 * `@/core/phone/contacts.js`），按聊天缓存进 IndexedDB，之后直接读缓存。
 * 每个联系人有自己的聊天记录，按联系人单独保存；每个联系人还带一条
 * 自己的人设（profile），回复时写进他/她自己的 system prompt，模型
 * 扮演他/她才不会 OOC。每个联系人还有好感度（0–100，从 0 开始）：
 * 用户发消息 +1，角色回一次 +1，封顶 100，存在联系人缓存里、关掉重开
 * 还在；50 解锁约会请求，80 解锁私密照；好感度也写进回复提示词，模型
 * 按亲密度回。
 *
 * 小手机是独立系统：微信是单独的聊天，不续写主线剧情；但回复时会把
 * 主线聊天（手机外面那个正常聊天）的最近进展当剧情进度放进提示词，
 * 只做了解，让角色知道剧情到了哪一步（见 `@/core/phone/reply.js`）。
 * 联系人缓存是权威的：初始化只做一次，之后不管缓存是哪个版本存的
 * （里面还留着卡的主角本人、relation 还是按主角算的 v1 旧关系），都
 * 原样保留、绝不悄悄重新初始化、绝不悄悄改动；只有用户点“重置”才
 * 会删掉缓存、重新初始化一次。角色还是个 Agent：回复时模型能自己调发图和发表
 * 情包两个工具（见 `@/core/phone/tools.js`），用户要看图就真发一张图，
 * 想表达情绪就发表情包，不只靠文字；不支持工具调用的提供商改走文字里的
 * `[发图：…]` / `[表情：…]` 标记兜底。联系人列表右上角有个“重置”：
 * 点它确认后会删掉本聊天的全部小手机记录（联系人缓存 + 每个联系人的
 * 微信记录 + 群聊 + 朋友圈），再让 AI 根据角色卡重新初始化一次；主聊天和相册不受影响。
 *
 * 群聊（PR #49，插件 v1.8.7 群聊逻辑的 Rpnow 版）：从联系人里多选
 * 成员、起个群名就能建群（同名不让建），群和一对一一起按最后一条
 * 消息的时间排在列表里，群头像是前 4 位成员首字的 2×2 格 + “群”
 * 角标。群里每条消息都写明是谁说的；用户发一句，点名提到的人先回，
 * 再按“最久没说话在前”轮 0–2 个人附和，一轮 1–3 个人回（确定性
 * 规则，不再调模型定人）。每个回的成员各调一次已有的回复流程
 * （自己的 system prompt + 群聊注脚 + 工具 + 守门 + Tag 转写 +
 * 人数强制），不是插件那种整个群一次调用。好感度只跟回的人走：
 * 用户这句 +1 只给被点到的那个人，每个回的人回一次 +1，没回的人
 * 不涨。群聊记录每轮同步进世界书“{群名}的群聊记录”，成员在之后
 * 的一对一里也能记得群里发生过的事。
 */
import * as React from 'react';
import { CalendarHeart, Camera, Check, ChevronLeft, Heart, Image as ImageIcon, Plus, RotateCcw, Send, Settings, SlidersHorizontal, Users, X } from 'lucide-react';
import { useApp } from '@/state/store.js';
import { useImage, useLLM } from '@/hooks/useKernel.js';
import { uid } from '@/lib/utils.js';
import type { RPCard } from '@/core/types/card.js';
import type { LLMMessage, LLMResult } from '@/core/llm/types.js';
import type { ImagePeople, PhoneContact, PhoneGroup, PhoneMessage, StickerEmotion } from '@/core/phone/types.js';
import {
  AFFECTION_DATE_UNLOCK,
  AFFECTION_PER_CHARACTER_REPLY,
  AFFECTION_PER_USER_MESSAGE,
  AFFECTION_PRIVATE_PHOTO_UNLOCK,
  addAffection,
  affectionOf,
  displayRelation,
  fallbackContacts,
  hasUsableCache,
  initContacts,
  isDateUnlocked,
  isPrivatePhotoUnlocked,
  resolvePhoneUser,
} from '@/core/phone/contacts.js';
import { lorebookTextForInit } from '@/core/phone/lorebook.js';
import { computeReplyExtras, historyEntries } from '@/core/phone/replyExtras.js';
import {
  addGroupMember,
  buildGroupNote,
  createGroup,
  groupAvatarNames,
  groupMembers,
  isGroupNameTaken,
  pickGroupRepliers,
  removeGroupMember,
} from '@/core/phone/groups.js';
import {
  clearPhoneGroups,
  loadGroupChat,
  loadGroups,
  removeGroupChat,
  removeGroupChatFromLorebook,
  saveGroupChat,
  saveGroups,
  syncGroupChatToLorebook,
} from '@/core/phone/groupStore.js';
import type { MomentsLorebookDeps } from '@/core/phone/momentsStore.js';
import {
  buildReplySystemPrompt,
  inferPeopleFromRequest,
  looksLikeImageRequest,
} from '@/core/phone/reply.js';
import { generatePhoneImage } from '@/core/phone/imageGen.js';
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
import { PressableImage } from '@/components/media/PressableImage.js';
import { GroupAvatar, PhoneAvatar } from './PhoneAvatar.js';
import { PhoneImageConfig } from './PhoneImageConfig.js';
import { PhonePromptViewer } from './PhonePromptViewer.js';

/** 消息往哪贴：回 1 对 1 聊天还是回群聊。runMemberReply 和生图流程共用它。 */
interface MessageSink {
  append: (added: PhoneMessage[]) => void;
  updateNote: (noteId: string, content: string) => void;
}

/** 列表里的一行：一对一或群聊，按最后一条消息的时间排在一起。 */
interface ConversationListItem {
  kind: 'contact' | 'group';
  key: string;
  name: string;
  sub: string;
  preview: string;
  updatedAt: number;
  contact?: PhoneContact;
  group?: PhoneGroup;
}

function makeMessage(
  msg: Omit<PhoneMessage, 'id' | 'createdAt'> & { id?: string },
): PhoneMessage {
  return { id: msg.id ?? uid('m'), createdAt: Date.now(), ...msg };
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
  /** 群列表：null = 还没读出来；[] = 这部聊天没有群（老聊天第一次打开就是这样，不触发重新初始化）。 */
  const [groups, setGroups] = React.useState<PhoneGroup[] | null>(null);
  const [selected, setSelected] = React.useState<PhoneContact | null>(null);
  /** 打开的群聊（和 selected 二选一）。 */
  const [selectedGroup, setSelectedGroup] = React.useState<PhoneGroup | null>(null);
  const [messages, setMessages] = React.useState<PhoneMessage[]>([]);
  /** 一对一和群聊混排的列表（按最后一条消息的时间排），null = 还没算出来。 */
  const [listItems, setListItems] = React.useState<ConversationListItem[] | null>(null);
  const [input, setInput] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  /** 群聊里正在回话的那个成员的名字（“小雨正在输入…”）。一对一里不用。 */
  const [groupTypingName, setGroupTypingName] = React.useState<string | null>(null);
  /** 群聊里最后回话的成员 id：提示词查看器看的就是他/她的提示词。 */
  const [lastGroupReplierId, setLastGroupReplierId] = React.useState<string | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [imageRowOpen, setImageRowOpen] = React.useState(false);
  const [imagePrompt, setImagePrompt] = React.useState('');
  const [configOpen, setConfigOpen] = React.useState(false);
  /** 是否正在看提示词构成（小手机里的内嵌视图）。 */
  const [promptOpen, setPromptOpen] = React.useState(false);
  /** 是否正在弹建群面板。 */
  const [createGroupOpen, setCreateGroupOpen] = React.useState(false);
  /** 建群面板里的群名、已选成员、校验错误。 */
  const [createGroupName, setCreateGroupName] = React.useState('');
  const [createGroupMembers, setCreateGroupMembers] = React.useState<string[]>([]);
  const [createGroupError, setCreateGroupError] = React.useState('');
  /** 是否正在看群成员管理（群聊窗口里的内嵌面板）。 */
  const [manageGroupOpen, setManageGroupOpen] = React.useState(false);
  /** 正在二次确认踢出的成员 id（点一下“移出”变“确认移出”，再点才真踢）。 */
  const [kickConfirmId, setKickConfirmId] = React.useState<string | null>(null);
  /** 踢最后一个人会解散群：解散也要二次确认。 */
  const [disbandConfirmOpen, setDisbandConfirmOpen] = React.useState(false);
  /** 重置计数：每次确认重置就 +1，让联系人加载 effect 重新跑一遍。 */
  const [resetNonce, setResetNonce] = React.useState(0);
  /** 是否正在弹“清空并重置”确认框。 */
  const [resetConfirmOpen, setResetConfirmOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  const phone = settings.phone ?? {};

  // 联系人：先读缓存；有缓存就直接用——缓存是权威的，初始化只做一次。
  // 哪怕缓存是旧逻辑存的（里面还留着卡的主角本人，或 relation 还是按
  // 主角算的、没按 User 算过），也原样保留，绝不悄悄丢掉重算、绝不悄悄
  // 改动；想用新规则的旧聊天，点“重置”重新初始化。
  // 只有没缓存（第一次打开）、缓存是空列表或读出来的不是列表时，才调
  // 一次模型初始化。初始化成功就存下来；缓存写失败也不影响本次使用——
  // 内存里的联系人照常用，下次打开再试一次初始化（这是首次打开的重试，
  // 不是重算已有数据）。初始化失败才用兜底（空列表，不存，下次打开再试一次）。
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cached = await loadContacts(chatId);
        if (cancelled) return;
        if (hasUsableCache(cached)) {
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
              initUser,
            );
            if (cancelled) return;
            if (initialized !== null) {
              setContacts(initialized);
              try {
                await saveContacts(chatId, initialized);
              } catch {
                // 缓存写失败：本次照常用内存里的联系人，下次打开再试一次初始化。
              }
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

  // 群列表：只读缓存。老聊天第一次打开是空的（没有群），不触发任何
  // 重新初始化——群是用户后来建的，建群时才写缓存。
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cached = await loadGroups(chatId);
        if (!cancelled) setGroups(cached ?? []);
      } catch {
        if (!cancelled) setGroups([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chatId, resetNonce]);

  /**
   * 清空并重置：删掉本聊天的全部小手机记录（联系人缓存 + 每个联系人的
   * 微信记录 + 群列表和群聊记录 + 朋友圈动态），再把联系人置空、让加载 effect 重新跑一遍——
   * 缓存已经删了，所以会真的再调一次模型重新初始化。主聊天、相册、
   * 其他聊天不动。朋友圈清掉之后从空开始（动态只在用户点“发朋友圈”
   * 时才生成，不会自动回来）。群也一样：清掉之后从空开始，不会自动回来。
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
      try {
        await clearPhoneGroups(chatId, groups ?? []);
      } catch {
        // 同上。
      }
      setSelected(null);
      setSelectedGroup(null);
      setGroups(null);
      setListItems(null);
      setContacts(null);
      setResetNonce((n) => n + 1);
    })();
  };

  // 列表：一对一和群聊混排，按最后一条消息的时间从新到旧。
  // 没聊过的一对一按开场白排最后（updatedAt 0），没聊过的群按建群
  // 时间排。只在列表页算；进了聊天窗口就不用重新算。
  React.useEffect(() => {
    if (selected || selectedGroup || !contacts || !groups) return;
    let cancelled = false;
    void (async () => {
      const items: ConversationListItem[] = [];
      for (const contact of contacts) {
        let preview = contact.openingMessage;
        let updatedAt = 0;
        try {
          const chat = await loadWeChatChat(contact.id);
          const last = chat?.messages[chat.messages.length - 1];
          if (last) {
            preview =
              last.type === 'image' ? '[图片]' : last.type === 'sticker' ? '[表情]' : last.content;
            updatedAt = chat.updatedAt;
          }
        } catch {
          // 读不到就用开场白。
        }
        if (cancelled) return;
        items.push({
          kind: 'contact',
          key: contact.id,
          name: contact.name,
          sub: displayRelation(contact),
          preview,
          updatedAt,
          contact,
        });
      }
      for (const group of groups) {
        let preview = '暂无消息';
        let updatedAt = group.createdAt;
        try {
          const chat = await loadGroupChat(group.id);
          const last = chat?.messages[chat.messages.length - 1];
          if (last) {
            const body =
              last.type === 'image' ? '[图片]' : last.type === 'sticker' ? '[表情]' : last.content;
            preview =
              last.role === 'assistant' && last.characterName
                ? `${last.characterName}：${body}`
                : body;
            updatedAt = chat.updatedAt;
          }
        } catch {
          // 读不到就用“暂无消息”。
        }
        if (cancelled) return;
        items.push({
          kind: 'group',
          key: group.id,
          name: group.name,
          sub: groupMembers(group, contacts)
            .map((c) => c.name)
            .join('、'),
          preview,
          updatedAt,
          group,
        });
      }
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      if (!cancelled) setListItems(items);
    })();
    return () => {
      cancelled = true;
    };
  }, [contacts, groups, selected, selectedGroup]);

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

  /** 群聊记录的持久化：按群存（`rpnow:phone:groupchat:<groupId>`）。 */
  const persistGroup = React.useCallback(
    async (group: PhoneGroup, next: PhoneMessage[]) => {
      await saveGroupChat({
        cardId: card.id,
        groupId: group.id,
        messages: next,
        updatedAt: Date.now(),
      });
    },
    [card.id],
  );

  /** 群聊窗口里往消息列表后贴消息（说话人已经在 sink 里标好了）。 */
  const appendGroupMessages = React.useCallback(
    (group: PhoneGroup, added: PhoneMessage[]) => {
      setMessages((prev) => {
        const next = [...prev, ...added];
        void persistGroup(group, next);
        return next;
      });
    },
    [persistGroup],
  );

  /** 群聊里就地改一条系统提示的内容（生图的两段状态共用同一条提示）。 */
  const updateGroupNote = React.useCallback(
    (group: PhoneGroup, noteId: string, content: string) => {
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === noteId ? { ...m, content } : m));
        void persistGroup(group, next);
        return next;
      });
    },
    [persistGroup],
  );

  /** 某个回话成员在群聊里的 sink：贴消息时给 assistant 消息标上说话人。 */
  const groupSinkFor = React.useCallback(
    (group: PhoneGroup, replier: PhoneContact): MessageSink => ({
      append: (added) =>
        appendGroupMessages(
          group,
          added.map((m) =>
            m.role === 'assistant' ? { ...m, characterName: replier.name } : m,
          ),
        ),
      updateNote: (noteId, content) => updateGroupNote(group, noteId, content),
    }),
    [appendGroupMessages, updateGroupNote],
  );

  /**
   * 好感度 +N：更新联系人列表、当前打开的联系人，并写回联系人缓存。
   * 用户发消息 +1、角色回一次 +1，都走这里。返回加完后的联系人
   * （调用方拿它去调 requestReply，提示词里的好感度就是最新的）。
   * 用 ref 读最新的联系人列表——sendText 里加完、requestReply 里再加，
   * 两次都在同一个事件链里，不能用闭包里的旧 contacts，不然第二次会
   * 把第一次的 +1 盖掉。缓存写失败不挡路：内存里是对的，下次打开读
   * 旧缓存（好感度会回退一次，但不影响本次使用——PR #46 的规矩）。
   */
  const contactsRef = React.useRef<PhoneContact[] | null>(null);
  React.useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  /** 群列表的 ref：回群消息时要读最新的成员（踢人/加人后群会变）。 */
  const groupsRef = React.useRef<PhoneGroup[] | null>(null);
  React.useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);

  /** 世界书同步要的依赖（朋友圈同款）：读最新的 lorebooks / chat，写回 store。 */
  const lorebookDeps = React.useCallback((): MomentsLorebookDeps | null => {
    const state = useApp.getState();
    const chat = state.chats.find((c) => c.id === chatId);
    if (!chat) return null;
    return {
      lorebooks: state.lorebooks,
      saveLorebook: (book) => state.saveLorebook(book),
      chat,
      saveChat: (c) => state.saveChat(c),
    };
  }, [chatId]);

  const bumpAffection = React.useCallback(
    (contactId: string, amount: number): PhoneContact | null => {
      const list = contactsRef.current;
      if (!list) return null;
      const target = list.find((c) => c.id === contactId);
      if (!target) return null;
      const bumped = addAffection(target, amount);
      if (bumped.affection === affectionOf(target)) return target;
      const next = list.map((c) => (c.id === contactId ? bumped : c));
      contactsRef.current = next;
      setContacts(next);
      setSelected((prev) => (prev && prev.id === contactId ? bumped : prev));
      void saveContacts(chatId, next).catch(() => {
        // 缓存写失败：内存里还是对的，本次照常用。
      });
      return bumped;
    },
    [chatId],
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
   * 按一段描述生成一张图发给用户（流程在 `@/core/phone/imageGen.js`，
   * 朋友圈点图片生图走同一条线：先转写 Tag，再按人数强制，最后调生图
   * 接口、图存进相册）。
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
      sink?: MessageSink,
    ) => {
      if (generating) return;
      const connectionId = phone.imageConnectionId || imageConnections[0]?.id || '';
      // sink 没给就是一对一：贴到这个联系人的聊天里；群聊里调用方传
      // 群的 sink（贴到群聊里、标上说话人）。
      const s: MessageSink = sink ?? {
        append: (added) => appendMessages(contact, added),
        updateNote: (noteId, content) => updateNote(contact, noteId, content),
      };
      if (!image || !connectionId) {
        s.append([
          makeMessage({
            role: 'system',
            type: 'text',
            content: '还没配置生图连接，先到「设置 → 生图」里添加一个',
          }),
        ]);
        return;
      }
      setGenerating(true);
      const note = makeMessage({
        role: 'system',
        type: 'text',
        content: '正在生成图片…',
      });
      s.append([note]);
      try {
        const { imageSrc, prompt } = await generatePhoneImage(
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
          description,
          history,
          people,
          others,
        );
        s.updateNote(note.id, '图片生成好了');
        s.append([
          makeMessage({
            role: 'assistant',
            type: 'image',
            content: prompt,
            imageSrc,
          }),
        ]);
      } catch (err) {
        s.append([
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
      phone,
      settings.defaultConnectionId,
      settings.imageGen,
      updateNote,
    ],
  );

  /**
   * 一个成员回一次话：Agent 回复的核心（1 对 1 和群聊共用）。
   *
   * 流程：带 tools 调一次模型 → 文字照常发；工具调用按顺序执行
   * （发图先走 PR #33 的 Agent 生图流程，表情包挑一张现成的贴纸）；
   * 有的提供商不支持工具调用会直接拒绝请求，那就去掉 tools 再试一次，
   * 模型改用文字里的 `[发图：…]` / `[表情：…]` 标记也能达到同样效果
   * （标记从显示的文字里去掉）。工具调用优先：有工具调用时，同类标记
   * 只当没写过。最后，没有通过工具或标记发过表情包、且文字情绪明显
   * 时，照旧按情绪补一张。发送顺序：文字 → 图片 → 表情包。
   *
   * sink 没给就是一对一：贴到这个联系人的聊天里；群聊里调用方传群的
   * sink（贴到群聊里、标上说话人）。groupNote 只在群聊里有：拼进
   * system prompt 的“独立系统”那一节，告诉模型这是在群聊里回话、
   * 以及记忆归属的规矩。返回这次贴出去的消息（群聊里调用方拿它续
   * 上聊天记录，给下一个回话的成员当上下文）。
   */
  const runMemberReply = React.useCallback(
    async (
      contact: PhoneContact,
      history: PhoneMessage[],
      opts: { sink?: MessageSink; groupNote?: string } = {},
    ): Promise<PhoneMessage[]> => {
      const connectionId = phone.chatConnectionId || settings.defaultConnectionId || '';
      const connection = llmConnections.find((c) => c.id === connectionId);
      // sink 包一层：贴出去的消息都记下来，调用方（群聊）拿它续上下文。
      const appended: PhoneMessage[] = [];
      const sink: MessageSink = opts.sink ?? {
        append: (added) => appendMessages(contact, added),
        updateNote: (noteId, content) => updateNote(contact, noteId, content),
      };
      const append = (added: PhoneMessage[]) => {
        appended.push(...added);
        sink.append(added);
      };
      const updateNoteText = (noteId: string, content: string) => {
        const i = appended.findIndex((m) => m.id === noteId);
        if (i >= 0) appended[i] = { ...appended[i], content };
        sink.updateNote(noteId, content);
      };
      if (!llm || !connection) {
        append([
          makeMessage({
            role: 'system',
            type: 'text',
            content: '还没配置模型连接，先到「设置 → 模型」里添加一个',
          }),
        ]);
        return appended;
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
      // 都是读现成的数据，不多调模型。群聊里再加一句群聊注脚（在哪个群、
      // 和谁一起聊、记忆归属），拼进“独立系统”那一节。
      const state = useApp.getState();
      const extras = computeReplyExtras({
        card,
        mainChat: state.chats.find((c) => c.id === chatId),
        presets: state.presets,
        lorebooks: state.lorebooks,
        lorebookDefaults: settings.lorebook,
        defaultPresetId: settings.defaultPresetId,
        history,
        groupNote: opts.groupNote,
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
        // 群聊里也一样：守门按用户在群里那句算，每个回话的成员各守各的门。
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
          append([
            makeMessage({ role: 'assistant', type: 'text', content: text }),
          ]);
        }
        const otherContacts = (contacts ?? []).filter((c) => c.id !== contact.id);
        for (const req of imageRequestsToSend) {
          // 生图要带着最近的对话：模型得知道现在是什么场景，才能把角色画进场景里；
          // 人数是回复模型按场景定的，其他联系人一并给写提示词的模型当参考。
          // 群聊里 history 就是群聊记录（带说话人），场景从群聊里来。
          await generateImageFromDescription(
            contact,
            req.description,
            recent,
            req.people,
            otherContacts,
            {
              append: (added) => append(added),
              updateNote: updateNoteText,
            },
          );
        }
        for (const emotion of stickerEmotions) {
          const stickerUrl = pickSticker(emotion);
          if (stickerUrl) {
            append([
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
              append([
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
        // 角色回了，好感度 +1（用户发消息那 +1 在 sendText / 约会请求里已经加了；
        // 群聊里用户那句 +1 只给被点到的主回的人，见 requestGroupReply）。
        bumpAffection(contact.id, AFFECTION_PER_CHARACTER_REPLY);
      } catch (err) {
        append([
          makeMessage({
            role: 'system',
            type: 'text',
            content: `发送失败：${err instanceof Error ? err.message : String(err)}`,
          }),
        ]);
      }
      return appended;
    },
    [
      appendMessages,
      bumpAffection,
      card,
      chatId,
      contacts,
      generateImageFromDescription,
      llm,
      llmConnections,
      phone.chatConnectionId,
      phone.chatModel,
      settings.defaultConnectionId,
      settings.lorebook,
      updateNote,
    ],
  );

  /**
   * 一对一回复：runMemberReply 的薄壳，只管 busy 状态（群聊那轮是
   * requestGroupReply 管 busy，一轮多个人回，busy 不能每人闪一次）。
   */
  const requestReply = React.useCallback(
    async (contact: PhoneContact, history: PhoneMessage[]) => {
      setBusy(true);
      try {
        await runMemberReply(contact, history);
      } finally {
        setBusy(false);
      }
    },
    [runMemberReply],
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
    // 用户发消息，好感度 +1；拿加完后的联系人去要回复，提示词里的
    // 好感度就是最新的（角色回了再 +1，一轮完整对话 +2）。
    const bumped = bumpAffection(contact.id, AFFECTION_PER_USER_MESSAGE);
    void requestReply(bumped ?? contact, next);
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

  /**
   * 约会请求（好感度 50 解锁）：给角色发一条约TA出去的邀请，角色走
   * 正常回复流程回——模型按提示词里的好感度决定怎么回。和发消息一样：
   * 用户这句 +1，角色回了 +1。
   */
  const requestDate = () => {
    const contact = selected;
    if (!contact || busy || !isDateUnlocked(contact)) return;
    const text = '这个周末有空吗？想约你出去约会';
    const userMsg = makeMessage({ role: 'user', type: 'text', content: text });
    const next = [...messages, userMsg];
    setMessages(next);
    void persist(contact, next);
    const bumped = bumpAffection(contact.id, AFFECTION_PER_USER_MESSAGE);
    void requestReply(bumped ?? contact, next);
  };

  const openGroupChat = React.useCallback(
    async (group: PhoneGroup) => {
      setSelectedGroup(group);
      setMessages([]);
      setLastGroupReplierId(null);
      try {
        const chat = await loadGroupChat(group.id);
        setMessages(chat?.messages ?? []);
      } catch {
        setMessages([]);
      }
    },
    [],
  );

  /**
   * 群聊里发一句：先贴用户这句，再让群里的人回。
   *
   * 好感度（PR #49 定下的规矩）：用户这句 +1 只给被点到的主回的人——
   * 不是全群都涨（不然在群里说一句话，所有成员的好感度一起涨，
   * 一对一里辛辛苦苦聊出来的数就贬值了）；每个回的人回一次 +1，
   * 和一对一一样；没回的人这轮不涨。主回的人是谁由
   * pickGroupRepliers 定（点名提到的人先回）。
   */
  const sendGroupText = (group: PhoneGroup) => {
    const text = input.trim();
    if (!text || busy) return;
    const userMsg = makeMessage({ role: 'user', type: 'text', content: text });
    const next = [...messages, userMsg];
    setMessages(next);
    void persistGroup(group, next);
    setInput('');
    void requestGroupReply(group, next, text);
  };

  /**
   * 群聊一轮：谁回、每人各回一次、回完同步世界书。
   *
   * 谁回是确定性规则（pickGroupRepliers）：点名提到的人先回，再按
   * “最久没说话在前”轮 0–2 个人附和，一轮 1–3 个人——不调模型定人。
   * 每个回的人各调一次已有的回复流程（runMemberReply）：自己的
   * system prompt + 群聊注脚（在哪个群、和谁一起聊、记忆归属）+ 工具
   * + PR #40 守门 + Tag 转写 + 人数强制；回完一个再回下一个（中间
   * 不用刻意等，模型调用本身就有间隔，和一对一的节奏一样），后回的
   * 人能看到先回的人说了什么。回完一整轮，把群聊记录同步进世界书
   * “{群名}的群聊记录”，成员在之后的一对一里也能记得群里发生过的事。
   */
  const requestGroupReply = React.useCallback(
    async (group: PhoneGroup, history: PhoneMessage[], userText: string) => {
      const list = contacts ?? [];
      const repliers = pickGroupRepliers({ group, contacts: list, history, userText });
      if (repliers.length === 0) return;
      const primary = repliers[0];
      // 用户这句 +1 只给主回的人（见 sendGroupText 上面的注释）。
      const bumpedPrimary = bumpAffection(primary.id, AFFECTION_PER_USER_MESSAGE);
      const liveRepliers = bumpedPrimary
        ? repliers.map((r) => (r.id === primary.id ? bumpedPrimary : r))
        : repliers;
      const memberNames = groupMembers(group, list).map((c) => c.name);
      setBusy(true);
      let running = history;
      try {
        for (const replier of liveRepliers) {
          setGroupTypingName(replier.name);
          setLastGroupReplierId(replier.id);
          const note = buildGroupNote(group.name, memberNames, replier.name);
          const appended = await runMemberReply(replier, running, {
            sink: groupSinkFor(group, replier),
            groupNote: note,
          });
          // 续上聊天记录给下一个人当上下文：说话人标好（appended 里是
          // 贴出去之前的样子，assistant 消息还没标 characterName）。
          running = [
            ...running,
            ...appended.map((m) =>
              m.role === 'assistant' ? { ...m, characterName: replier.name } : m,
            ),
          ];
        }
      } finally {
        setGroupTypingName(null);
        setBusy(false);
      }
      // 一轮回完，同步世界书（只留最近 40 行）。
      const deps = lorebookDeps();
      if (deps) {
        try {
          await syncGroupChatToLorebook(chatId, group, memberNames, running, deps);
        } catch {
          // 同步失败不挡聊天：群聊记录还在手机里，下次回话再同步。
        }
      }
    },
    [
      bumpAffection,
      chatId,
      contacts,
      groupSinkFor,
      lorebookDeps,
      runMemberReply,
    ],
  );

  /** 建群：名字 + 至少两个人，同名不让建。建好就打开这个群。 */
  const confirmCreateGroup = () => {
    const current = groups ?? [];
    const name = createGroupName.trim();
    if (!name) {
      setCreateGroupError('先给群起个名字');
      return;
    }
    if (isGroupNameTaken(current, name)) {
      setCreateGroupError('已经有个同名的群了，换个名字吧');
      return;
    }
    const created = createGroup(name, createGroupMembers);
    if (!created) {
      setCreateGroupError('至少选两个人才能建群');
      return;
    }
    const next = [...current, created];
    setGroups(next);
    groupsRef.current = next;
    void saveGroups(chatId, next).catch(() => {
      // 写缓存失败：内存里是对的，本次照常用，下次打开读旧缓存。
    });
    setCreateGroupOpen(false);
    setCreateGroupName('');
    setCreateGroupMembers([]);
    setCreateGroupError('');
    void openGroupChat(created);
  };

  /** 群成员管理：加人（从联系人里选没在群里的）。 */
  const addMemberToGroup = (group: PhoneGroup, contactId: string) => {
    const list = groups ?? [];
    const target = list.find((g) => g.id === group.id);
    if (!target) return;
    const updated = addGroupMember(target, contactId);
    if (updated === target) return;
    const next = list.map((g) => (g.id === group.id ? updated : g));
    setGroups(next);
    groupsRef.current = next;
    setSelectedGroup(updated);
    void saveGroups(chatId, next).catch(() => {
      // 写缓存失败：内存里是对的，本次照常用。
    });
  };

  /**
   * 群成员管理：踢人。踢掉最后一个人就解散群——删掉群、群聊记录和
   * 世界书里的群聊记录条目，退回列表。踢人要二次确认（点一下“移出”
   * 变“确认移出”，再点才真踢；最后一个人走解散确认框）。
   */
  const kickMemberFromGroup = (group: PhoneGroup, contactId: string) => {
    const list = groups ?? [];
    const target = list.find((g) => g.id === group.id);
    if (!target) return;
    if (target.memberIds.length <= 1) {
      setDisbandConfirmOpen(true);
      return;
    }
    const updated = removeGroupMember(target, contactId);
    if (!updated) return;
    const next = list.map((g) => (g.id === group.id ? updated : g));
    setGroups(next);
    groupsRef.current = next;
    setSelectedGroup(updated);
    setKickConfirmId(null);
    void saveGroups(chatId, next).catch(() => {
      // 写缓存失败：内存里是对的，本次照常用。
    });
  };

  /** 解散群（踢最后一个人时确认）：删群、删记录、删世界书条目，退回列表。 */
  const confirmDisbandGroup = (group: PhoneGroup) => {
    const list = groups ?? [];
    const next = list.filter((g) => g.id !== group.id);
    setGroups(next);
    groupsRef.current = next;
    setDisbandConfirmOpen(false);
    setManageGroupOpen(false);
    setSelectedGroup(null);
    setMessages([]);
    void saveGroups(chatId, next).catch(() => {
      // 写缓存失败：内存里是对的，本次照常用。
    });
    void removeGroupChat(group.id).catch(() => {
      // 同上。
    });
    const deps = lorebookDeps();
    if (deps) {
      void removeGroupChatFromLorebook(chatId, group.name, deps).catch(() => {
        // 同步失败不挡路。
      });
    }
  };

  /**
   * 私密照（好感度 80 解锁）：让角色发一张只给你看的私密照。
   * 用户主动点的，走“＋”按钮同一条生图流程（Tag 转写 + 人数强制 +
   * 画师串/负面提示词），不是模型自己主动发图——不受 PR #40 守门的限制。
   * 图是单人（solo）：角色自己在房间里拍的自拍，只发给你。
   * 用户这句 +1；图本身是角色的回应，不再单独 +1。
   */
  const requestPrivatePhoto = () => {
    const contact = selected;
    if (!contact || generating || !isPrivatePhotoUnlocked(contact)) return;
    const text = '发一张你的私密照给我看看';
    const userMsg = makeMessage({ role: 'user', type: 'text', content: text });
    const next = [...messages, userMsg];
    setMessages(next);
    void persist(contact, next);
    bumpAffection(contact.id, AFFECTION_PER_USER_MESSAGE);
    const otherContacts = (contacts ?? []).filter((c) => c.id !== contact.id);
    void generateImageFromDescription(
      contact,
      `${contact.name}的私密自拍，在自己房间里拍的、只发给用户看的照片`,
      next,
      'solo',
      otherContacts,
    );
  };

  // ---------------- 联系人列表 ----------------
  if (!selected && !selectedGroup) {
    const loading = contacts === null || groups === null || listItems === null;
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
            aria-label="新建群聊"
            onClick={() => {
              setCreateGroupName('');
              setCreateGroupMembers([]);
              setCreateGroupError('');
              setCreateGroupOpen(true);
            }}
            disabled={contacts === null}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] text-neutral-500 transition-colors hover:bg-neutral-100 disabled:cursor-default disabled:opacity-40"
          >
            <Users className="size-4" />
            建群
          </button>
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
          {loading ? (
            <p className="animate-pulse px-4 py-8 text-center text-sm text-neutral-500">
              正在认识卡里的人…
            </p>
          ) : (listItems?.length ?? 0) === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-neutral-500">
              卡里没有提到其他人，微信里暂时没有联系人。
            </p>
          ) : (
            (listItems ?? []).map((item) =>
              item.kind === 'group' && item.group ? (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => void openGroupChat(item.group!)}
                  className="flex w-full cursor-pointer items-center gap-3 border-b border-neutral-100 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
                >
                  <GroupAvatar
                    names={groupAvatarNames(item.group, contacts ?? [])}
                    size="size-12"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5">
                      <span className="truncate text-[15px] font-medium">{item.name}</span>
                      <span className="shrink-0 text-xs text-neutral-400">{item.sub}</span>
                    </span>
                    <span className="block truncate text-[13px] text-neutral-500">
                      {item.preview}
                    </span>
                  </span>
                </button>
              ) : (
                item.contact && (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => void openChat(item.contact!)}
                    className="flex w-full cursor-pointer items-center gap-3 border-b border-neutral-100 px-4 py-3 text-left transition-colors hover:bg-neutral-50"
                  >
                    <PhoneAvatar name={item.contact.name} size="size-12" />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-1.5">
                        <span className="truncate text-[15px] font-medium">{item.name}</span>
                        <span className="shrink-0 text-xs text-neutral-400">{item.sub}</span>
                      </span>
                      <span className="block truncate text-[13px] text-neutral-500">
                        {item.preview}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-[12px] tabular-nums text-neutral-500">
                      <Heart className="size-3.5 fill-red-400 text-red-400" />
                      {affectionOf(item.contact)}
                    </span>
                  </button>
                )
              ),
            )
          )}
        </div>
        {createGroupOpen && (
          <div className="absolute inset-0 z-20 flex flex-col bg-white">
            <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 px-2 py-2">
              <button
                type="button"
                aria-label="取消建群"
                onClick={() => setCreateGroupOpen(false)}
                className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
              >
                <X className="size-5" />
              </button>
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold">新建群聊</h2>
              <button
                type="button"
                onClick={confirmCreateGroup}
                className="shrink-0 cursor-pointer rounded-full bg-[#07C160] px-3.5 py-1.5 text-[13px] font-medium text-white transition-opacity hover:opacity-90"
              >
                创建
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <input
                value={createGroupName}
                onChange={(e) => setCreateGroupName(e.target.value)}
                placeholder="群名（比如：宿舍小分队）"
                className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#07C160]"
              />
              {createGroupError && (
                <p className="mt-2 text-[13px] text-red-500">{createGroupError}</p>
              )}
              <p className="mt-4 mb-2 text-[13px] font-medium text-neutral-500">
                选择成员（至少两个人）
              </p>
              <div className="flex flex-col gap-1">
                {(contacts ?? []).map((contact) => {
                  const checked = createGroupMembers.includes(contact.id);
                  return (
                    <button
                      key={contact.id}
                      type="button"
                      onClick={() =>
                        setCreateGroupMembers((prev) =>
                          checked
                            ? prev.filter((id) => id !== contact.id)
                            : [...prev, contact.id],
                        )
                      }
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-neutral-50"
                    >
                      <span
                        className={`flex size-5 shrink-0 items-center justify-center rounded-md border ${
                          checked
                            ? 'border-[#07C160] bg-[#07C160] text-white'
                            : 'border-neutral-300 bg-white text-transparent'
                        }`}
                      >
                        <Check className="size-3.5" />
                      </span>
                      <PhoneAvatar name={contact.name} size="size-9" />
                      <span className="min-w-0 flex-1 truncate text-[15px]">
                        {contact.name}
                        <span className="ml-1.5 text-xs text-neutral-400">
                          {displayRelation(contact)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {(contacts ?? []).length === 0 && (
                <p className="py-4 text-center text-sm text-neutral-500">
                  卡里没有提到其他人，建不了群。
                </p>
              )}
            </div>
          </div>
        )}
        {resetConfirmOpen && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/40 px-6">
            <div className="w-full max-w-[280px] rounded-2xl bg-white p-4 shadow-xl">
              <h3 className="text-[15px] font-semibold text-neutral-900">清空并重置？</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-600">
                会删掉这个聊天的全部小手机记录（联系人、聊天记录、群聊和朋友圈），然后让 AI
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
  const group = selectedGroup;
  // 群聊里提示词查看器看的是最后回话的那个成员（还没人回过时看第一个成员）。
  const viewerContact: PhoneContact | null = group
    ? (contacts ?? []).find((c) => c.id === lastGroupReplierId) ??
      groupMembers(group, contacts ?? [])[0] ??
      null
    : contact;
  const viewerGroupNote: string | undefined = group
    ? buildGroupNote(
        group.name,
        groupMembers(group, contacts ?? []).map((c) => c.name),
        viewerContact?.name ?? '',
      )
    : undefined;
  const backToList = () => {
    setSelected(null);
    setSelectedGroup(null);
  };
  const sendCurrent = () => {
    if (group) sendGroupText(group);
    else sendText();
  };
  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-[#ededed] text-neutral-900">
      <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 bg-white px-2 py-2">
        <button
          type="button"
          aria-label="返回联系人"
          onClick={backToList}
          className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
        >
          <ChevronLeft className="size-6" />
        </button>
        {group ? (
          <>
            <GroupAvatar
              names={groupAvatarNames(group, contacts ?? [])}
              size="size-9"
            />
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
              {group.name}
              <span className="ml-1.5 text-xs font-normal text-neutral-400">
                {groupMembers(group, contacts ?? [])
                  .map((c) => c.name)
                  .join('、')}
              </span>
            </h2>
            <button
              type="button"
              aria-label="群成员"
              onClick={() => {
                setKickConfirmId(null);
                setManageGroupOpen(true);
              }}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
            >
              <Users className="size-5 text-neutral-600" />
            </button>
          </>
        ) : (
          contact && (
            <>
              <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
                {contact.name}
                <span className="ml-1.5 text-xs font-normal text-neutral-400">
                  {displayRelation(contact)}
                </span>
              </h2>
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[12px] font-medium tabular-nums text-red-500">
                <Heart className="size-3.5 fill-red-400 text-red-400" />
                {affectionOf(contact)}
              </span>
            </>
          )
        )}
        {viewerContact && (
          <button
            type="button"
            aria-label="提示词构成"
            onClick={() => setPromptOpen(true)}
            className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
          >
            <SlidersHorizontal className="size-5 text-neutral-600" />
          </button>
        )}
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
            // 群聊里每条消息都写明是谁说的（characterName）；一对一里
            // assistant 一定是当前联系人。
            const speakerName = m.characterName ?? contact?.name ?? '';
            return (
              <React.Fragment key={m.id}>
                {group && !isOwn && speakerName && (
                  <span className="-mb-1.5 ml-11 text-xs text-neutral-500">
                    {speakerName}
                  </span>
                )}
                <div className={`flex items-start gap-2 ${isOwn ? 'flex-row-reverse' : ''}`}>
                  {!isOwn && (
                    <PhoneAvatar
                      name={speakerName}
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
              </React.Fragment>
            );
          })}
          {busy && (
            <div className="flex items-start gap-2">
              <PhoneAvatar
                name={group ? (groupTypingName ?? '') : (contact?.name ?? '')}
                size="size-9"
              />
              <div className="rounded-xl bg-white px-3 py-2 text-[15px] text-neutral-500 shadow-sm">
                {group && groupTypingName ? `${groupTypingName}正在输入…` : '对方正在输入…'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 生图行（一对一才有：群聊里没有“给谁画”这个主角，生图只走 Agent——用户在群里让谁发图，谁就发）。 */}
      {imageRowOpen && !group && contact && (
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

      {/* 约会 / 私密照：好感度解锁。一对一才有，群聊里没有（约会和私密照都是两个人之间的事）。 */}
      <div className="shrink-0 border-t border-neutral-200 bg-white px-3 pb-2">
        {!group && contact && (
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              aria-label="约会"
              onClick={requestDate}
              disabled={!isDateUnlocked(contact) || busy}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                isDateUnlocked(contact)
                  ? 'cursor-pointer bg-[#07C160] font-medium text-white hover:opacity-90'
                  : 'cursor-default bg-neutral-100 text-neutral-400'
              } disabled:opacity-60`}
            >
              <CalendarHeart className="size-4" />
              约会
              {!isDateUnlocked(contact) && (
                <span className="text-xs">· 好感度 {AFFECTION_DATE_UNLOCK} 解锁</span>
              )}
            </button>
            <button
              type="button"
              aria-label="要一张私密照"
              onClick={requestPrivatePhoto}
              disabled={!isPrivatePhotoUnlocked(contact) || generating}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                isPrivatePhotoUnlocked(contact)
                  ? 'cursor-pointer bg-[#07C160] font-medium text-white hover:opacity-90'
                  : 'cursor-default bg-neutral-100 text-neutral-400'
              } disabled:opacity-60`}
            >
              <Camera className="size-4" />
              私密照
              {!isPrivatePhotoUnlocked(contact) && (
                <span className="text-xs">· 好感度 {AFFECTION_PRIVATE_PHOTO_UNLOCK} 解锁</span>
              )}
            </button>
          </div>
        )}
        {/* 输入栏 */}
        <div className="flex items-center gap-2 pt-2">
          {!group && (
            <button
              type="button"
              aria-label="更多"
              onClick={() => setImageRowOpen((v) => !v)}
              className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-neutral-300 text-neutral-600 transition-colors hover:bg-neutral-100"
            >
              <Plus className="size-5" />
            </button>
          )}
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') sendCurrent();
            }}
            placeholder="发消息…"
            className="min-w-0 flex-1 rounded-lg border border-neutral-200 px-3 py-2 text-sm outline-none focus:border-[#07C160]"
          />
          <button
            type="button"
            aria-label="发送"
            onClick={sendCurrent}
            disabled={busy || !input.trim()}
            className="flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#07C160] text-white transition-opacity disabled:opacity-40"
          >
            <Send className="size-4" />
          </button>
        </div>
      </div>

      <PhoneImageConfig open={configOpen} onOpenChange={setConfigOpen} />
      {promptOpen && viewerContact && (
        <div className="absolute inset-0 z-20 flex flex-col bg-white">
          <PhonePromptViewer
            chatId={chatId}
            card={card}
            contact={viewerContact}
            history={messages}
            groupNote={viewerGroupNote}
            onBack={() => setPromptOpen(false)}
          />
        </div>
      )}
      {manageGroupOpen && group && (
        <div className="absolute inset-0 z-20 flex flex-col bg-white">
          <div className="flex shrink-0 items-center gap-1 border-b border-neutral-200 px-2 py-2">
            <button
              type="button"
              aria-label="返回群聊"
              onClick={() => setManageGroupOpen(false)}
              className="flex size-9 cursor-pointer items-center justify-center rounded-full transition-colors hover:bg-neutral-100"
            >
              <ChevronLeft className="size-6" />
            </button>
            <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
              群成员（{group.memberIds.length} 人）
            </h2>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="flex flex-col gap-1">
              {groupMembers(group, contacts ?? []).map((member) => (
                <div
                  key={member.id}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2"
                >
                  <PhoneAvatar name={member.name} size="size-9" />
                  <span className="min-w-0 flex-1 truncate text-[15px]">
                    {member.name}
                    <span className="ml-1.5 text-xs text-neutral-400">
                      {displayRelation(member)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      if (kickConfirmId === member.id) kickMemberFromGroup(group, member.id);
                      else setKickConfirmId(member.id);
                    }}
                    className={`shrink-0 cursor-pointer rounded-full px-2.5 py-1.5 text-[13px] transition-colors ${
                      kickConfirmId === member.id
                        ? 'bg-red-500 font-medium text-white'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    {kickConfirmId === member.id ? '确认移出' : '移出'}
                  </button>
                </div>
              ))}
            </div>
            {(contacts ?? []).filter((c) => !group.memberIds.includes(c.id)).length > 0 && (
              <>
                <p className="mt-4 mb-2 text-[13px] font-medium text-neutral-500">
                  添加成员
                </p>
                <div className="flex flex-col gap-1">
                  {(contacts ?? [])
                    .filter((c) => !group.memberIds.includes(c.id))
                    .map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => addMemberToGroup(group, c.id)}
                        className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-neutral-50"
                      >
                        <PhoneAvatar name={c.name} size="size-9" />
                        <span className="min-w-0 flex-1 truncate text-[15px]">
                          {c.name}
                          <span className="ml-1.5 text-xs text-neutral-400">
                            {displayRelation(c)}
                          </span>
                        </span>
                        <Plus className="size-4 shrink-0 text-neutral-400" />
                      </button>
                    ))}
                </div>
              </>
            )}
            <p className="mt-4 text-[12px] leading-relaxed text-neutral-400">
              移出最后一位成员时，群聊会解散，群和群聊记录都会被删掉。
            </p>
          </div>
        </div>
      )}
      {disbandConfirmOpen && group && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 px-6">
          <div className="w-full max-w-[280px] rounded-2xl bg-white p-4 shadow-xl">
            <h3 className="text-[15px] font-semibold text-neutral-900">解散这个群？</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-neutral-600">
              这是群里最后一位成员，移出后群聊「{group.name}」会解散，群和群聊记录都会被删掉。
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => setDisbandConfirmOpen(false)}
                className="flex-1 cursor-pointer rounded-lg bg-neutral-100 px-3 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => confirmDisbandGroup(group)}
                className="flex-1 cursor-pointer rounded-lg bg-red-500 px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
              >
                确认解散
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
