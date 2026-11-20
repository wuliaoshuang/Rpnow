/**
 * Phone types — the "小手机" (Mini Phone) simulation.
 *
 * The phone is a fake phone inside the app: a home screen with app icons,
 * currently only 微信 (WeChat). A WeChat contact is one of the user's
 * character cards; each contact keeps its own chat history, persisted in
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

/** One WeChat conversation — one per character card. */
export interface WeChatChat {
  cardId: string;
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
}

/** Image size options the phone's image config offers. */
export const PHONE_IMAGE_SIZES: Array<{ value: PhoneImageSize; label: string }> = [
  { value: 'square', label: '方形' },
  { value: 'portrait', label: '竖版' },
  { value: 'landscape', label: '横版' },
];
