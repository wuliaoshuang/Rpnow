/**
 * Phone types — the "小手机" (Mini Phone) simulation.
 *
 * The phone is a fake phone inside the app: a home screen with app icons
 * （微信、相册）. A WeChat contact is a person who appears in the current
 * chat's card — the main character plus anyone the card mentions — found
 * once by the model when the phone is first opened for that chat, then
 * cached per chat. Each contact keeps its own chat history, persisted in
 * IndexedDB so closing the phone (or the app) keeps it.
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

/** One WeChat contact — a person who appears in the current chat's card. */
export interface PhoneContact {
  /**
   * Stable id. The main character uses the card id (so the chat history
   * saved before this change keeps working); other people use `c_<uid>`.
   */
  id: string;
  name: string;
  /** 和主角的关系，如“本人”“闺蜜”“哥哥”。 */
  relation: string;
  /**
   * 它发来的第一条消息（微信口吻），由模型按剧情写的短消息；
   * 主角也一样，不再直接用卡的 first_mes。
   */
  openingMessage: string;
  /** 是否主角（卡本身）。 */
  isMain: boolean;
}

/** One WeChat conversation — one per contact. */
export interface WeChatChat {
  cardId: string;
  /** 哪个联系人的会话：主角就是 cardId，其他人是联系人 id。 */
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
