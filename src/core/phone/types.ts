/**
 * Phone types — the "小手机" (Mini Phone) simulation.
 *
 * The phone is a fake phone inside the app: a home screen with app icons
 * （微信、相册）. A WeChat contact is a person mentioned in the current
 * chat's card — found in the card's lorebook / settings (never the card's
 * own main character), once by the model when the phone is first opened
 * for that chat, then cached per chat. Each contact keeps its own chat
 * history, persisted in IndexedDB so closing the phone (or the app) keeps
 * it. Each contact also carries its own profile （人设：性格、长相、关键
 * 特点）, so the model knows exactly who it is playing and does not go OOC.
 */

/** Image shape options (same values as ImageRequest.size, minus 'auto'). */
export type PhoneImageSize = 'square' | 'portrait' | 'landscape';

/** One message inside a WeChat chat. */
export interface PhoneMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  type: 'text' | 'image' | 'sticker';
  /** Text body (text / system notes); for images this is the prompt used. */
  content: string;
  /** Image message: `media:<id>` ref (preferred) or data URL. */
  imageSrc?: string;
  /** Sticker message: public sticker image URL. */
  stickerUrl?: string;
  /**
   * 群聊里这条消息是谁说的（说话的成员名）。一对一聊天里不写——
   * 那里的 assistant 一定是当前联系人；群聊里 assistant 的每条消息
   * 都带它，界面按它显示说话人名字、回复按它算谁最后说过话。
   */
  characterName?: string;
  createdAt: number;
}

/**
 * 生图的人数：solo 角色一个人 / duo 角色和用户两个人 / multi 三人以上。
 * 回复模型按场景在 send_image 工具调用里给；模型不给时代码按 solo 算。
 */
export type ImagePeople = 'solo' | 'duo' | 'multi';

/**
 * 联系人的性别：初始化时由模型按卡的内容判断一次，存下来备用。
 * 生图时用它决定人数标记（单人 1girl / 1boy / solo，双人 2girls / 2boys，
 * 多人 multiple girls / multiple boys / group）；
 * 老缓存里没有这个字段时按 'unknown' 算。
 */
export type PhoneContactGender = 'female' | 'male' | 'unknown';

/** One WeChat contact — a person mentioned in the current chat's card. */
export interface PhoneContact {
  /**
   * Stable id. Contacts are the other people mentioned in the card's
   * lorebook / settings — the card's own main character is never a
   * contact, so ids are always `c_<uid>`.
   */
  id: string;
  name: string;
  /**
   * 和 User（在微信里和这个联系人聊天的那个人）的关系，如“闺蜜”“哥哥”。
   * 初始化时模型按卡里 / 世界书里写到的定：卡里写了这个人和 User 是
   * 什么关系就写什么；没写不要编，留空字符串。回复提示词里按这个关系
   * 写（“是用户的闺蜜”），模型才知道该怎么对 User。
   */
  relation: string;
  /**
   * 和卡的主角的关系，如“闺蜜”“哥哥”。卡里写了才有，没写不写。
   * 回复提示词里当补充信息用——主角的关系不等于和 User 的关系；
   * 和 User 的关系没写时，提示词里按这个写、并写明是主角的。
   */
  relationToMain?: string;
  /**
   * 它发来的第一条消息（微信口吻），由模型按剧情写的短消息；
   * 不再直接用卡的 first_mes。
   */
  openingMessage: string;
  /**
   * 这个人的人设（一两句）：性格、长相、关键特点，按卡里 / 世界书里
   * 写到的来。初始化时模型按卡的内容给的；老缓存里没有这个字段，
   * 读的时候按没有处理（提示词里不写这一节）。
   */
  profile?: string;
  /**
   * 性别：初始化时模型按卡的内容给的（female / male / unknown）。
   * 可选——老缓存里没有这个字段，读的时候按 'unknown' 处理。
   */
  gender?: PhoneContactGender;
  /**
   * 好感度：0–100，聊天涨上去的。新初始化的联系人从 0 开始；
   * 老缓存里没有这个字段，读的时候按 0 处理（不触发重新初始化，
   * PR #46 的规矩：缓存是权威的）。50 解锁约会请求，80 解锁私密照。
   */
  affection?: number;
  /**
   * 联系人结构版本：v2 起 relation 是和 User 的关系（v1 及更早是和
   * 主角的关系）。新解析的联系人一律写 v: 2；旧缓存没有这个字段，
   * 读到就判定过期、重新初始化（关系要按 User 重算一遍）。
   */
  v?: number;
}

/** One WeChat conversation — one per contact. */
export interface WeChatChat {
  cardId: string;
  /** 哪个联系人的会话：联系人 id（卡的主角本人不是联系人）。 */
  contactId: string;
  messages: PhoneMessage[];
  updatedAt: number;
}

/**
 * 一个微信群聊：名字 + 成员（联系人 id 列表，按建群时选的顺序）。
 * User 不在成员列表里——群是 User 和这些联系人一起聊的地方。
 * 群按聊天存（`rpnow:phone:groups:<chatId>`），老聊天第一次打开是
 * 空的（没有群，不触发重新初始化——PR #46 的规矩）。
 */
export interface PhoneGroup {
  /** Stable id：`g_<uid>`。 */
  id: string;
  /** 群名：同一部聊天里不能重名（建群时拦）。 */
  name: string;
  /** 成员的联系人 id（PhoneContact.id），不含 User。 */
  memberIds: string[];
  createdAt: number;
}

/** 一个群聊的聊天记录：和一对一同一个消息形状，群里每条 assistant 消息带 characterName（说话人）。 */
export interface PhoneGroupChat {
  cardId: string;
  /** 哪个群的记录：群 id。 */
  groupId: string;
  messages: PhoneMessage[];
  updatedAt: number;
}

/** Sticker emotions. `neutral` = no sticker for this reply. */
export type StickerEmotion =
  | 'happy'
  | 'sad'
  | 'angry'
  | 'shy'
  | 'surprised'
  | 'affectionate'
  | 'neutral';

/**
 * 朋友圈里的一条评论。用户和角色的评论存法一样：
 * author 是“用户”（User 的名字）或某个角色名；replyTo 是被回复的那条
 * 评论的作者（没有就是直接评这条朋友圈）；atName 是 @ 的那个人（没有
 * 就是没 @ 谁）。AI 回复的评论也是这个形状。
 */
export interface MomentComment {
  id: string;
  author: string;
  text: string;
  replyTo?: string | null;
  atName?: string | null;
  timestamp: number;
}

/**
 * 朋友圈里的一条动态。只由角色发——用户不发朋友圈（插件同款规矩）。
 *
 * text / summary / imageDesc / location / time / likers / likes 都是发帖
 * 那次模型调用写出来的；imageUrl 是用户点图片后真的生出来的图（没点
 * 之前是空的，只显示 imageDesc 的文字）；comments 是用户评论 + AI 回复，
 * 和动态存在同一个对象里、一起进 IndexedDB。
 */
export interface MomentPost {
  id: string;
  /** 发帖的联系人（名字，和 PhoneContact.name 对得上）。 */
  contactName: string;
  text: string;
  /** 一句话简介（约 30 字），供世界书记录；没有时用正文前 40 字代替。 */
  summary: string;
  /** 附图描述：模型写的画面描述，点图片后按它生图。 */
  imageDesc: string;
  location: string;
  /** 模型写的发布时间（如“2026年11月20日 星期五 18:30”），显示用。 */
  time: string;
  /** 点赞人名单（顿号分隔的字符串，模型编的，只做展示）。 */
  likers: string;
  likes: number;
  comments: MomentComment[];
  /** 排序和持久化用的时间戳（发帖那一刻）。 */
  timestamp: number;
  /** 生出来的图的 media 引用（`media:<id>`），没生图时是 ''。 */
  imageUrl: string;
}

/**
 * 一篇日记：用户手写的（characterName 为 null），或某个联系人第一人称
 * 写的一篇（characterName 是那个联系人的名字）。
 * 按聊天存（`rpnow:phone:diary:<chatId>`），最新在前；老聊天第一次打开
 * 是空的，不触发重新初始化（PR #46 的规矩）。“重置”会连日记一起清掉。
 */
export interface DiaryEntry {
  id: string;
  content: string;
  /** 显示用的时间，如“2026年11月20日 星期五 21:30”（真实时间）。 */
  displayTime: string;
  timestamp: number;
  /** 手写日记为 null；AI 代写时是代写那个联系人的名字。 */
  characterName: string | null;
}

/** 运势占卜的类别：事业 / 爱情 / 财运 / 健康。 */
export type FortuneCategoryId = 'career' | 'love' | 'wealth' | 'health';

/** 一次运势占卜的结果（只存最新的一次，新的来了就覆盖旧的）。 */
export interface HoroscopeResult {
  category: FortuneCategoryId;
  title: string;
  reading: string;
  luckyColor: string;
  luckyNumber: number;
  mantra: string;
  timestamp: number;
}

/** 一次塔罗抽牌的结果（只存最新的一次）。 */
export interface TarotDraw {
  cardName: string;
  reversed: boolean;
  reading: string;
  timestamp: number;
}

/** 一个聊天的运势数据：最新一次运势 + 最新一次塔罗。 */
export interface FortuneState {
  horoscope: HoroscopeResult | null;
  tarot: TarotDraw | null;
}

/** The phone's own settings (lives under `settings.phone`). */
export interface PhoneSettings {
  /** Chat model connection id (empty = main chat default). */
  chatConnectionId?: string;
  /** Chat model id (empty = the connection's default model). */
  chatModel?: string;
  /** Image connection id (empty = first image connection). */
  imageConnectionId?: string;
  /** Image model id (empty = the connection's default model). */
  imageModel?: string;
  /** Image shape. */
  imageSize?: PhoneImageSize;
  /** 画师串：画师/画风标签，生图时加到正面提示词后面（空着不加）。 */
  imageArtistTags?: string;
  /** 负面提示词：不想出现的东西，生图时传给生图接口（空着不传）。 */
  imageNegativePrompt?: string;
}

/** Image size options the phone's image config offers. */
export const PHONE_IMAGE_SIZES: Array<{ value: PhoneImageSize; label: string }> = [
  { value: 'square', label: '方形' },
  { value: 'portrait', label: '竖版' },
  { value: 'landscape', label: '横版' },
];
