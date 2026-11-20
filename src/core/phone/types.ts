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
  /** 和主角的关系，如“闺蜜”“哥哥”。 */
  relation: string;
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
}

/** One WeChat conversation — one per contact. */
export interface WeChatChat {
  cardId: string;
  /** 哪个联系人的会话：联系人 id（卡的主角本人不是联系人）。 */
  contactId: string;
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
