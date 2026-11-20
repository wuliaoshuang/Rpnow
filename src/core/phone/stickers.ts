/**
 * 表情贴纸 — 按情绪分组的公开贴纸图。
 *
 * 图片来源：Twemoji（twitter/twemoji，CC-BY 4.0 开源表情包），托管在
 * GitHub raw 上，URL 固定、无签名、无过期时间。2026-11-20 已逐条验证：
 * 全部返回 HTTP 200 + image/png，且抽查下载的 6 张均为合法 PNG 文件头。
 * image-search 搜到的 stickers.cloud / stickerly / pinimg / Firebase
 * 带 token 的链接因不稳定，已全部弃用。
 */
import type { StickerEmotion } from './types.js';

const TWEMOJI = 'https://raw.githubusercontent.com/twitter/twemoji/master/assets/72x72';

export const STICKERS: Record<Exclude<StickerEmotion, 'neutral'>, string[]> = {
  happy: [
    `${TWEMOJI}/1f600.png`, // 咧嘴笑
    `${TWEMOJI}/1f601.png`, // 露齿笑
    `${TWEMOJI}/1f604.png`, // 开怀大笑
    `${TWEMOJI}/1f606.png`, // 眯眼大笑
    `${TWEMOJI}/1f60a.png`, // 眯眯眼微笑
    `${TWEMOJI}/1f973.png`, // 派对脸
  ],
  sad: [
    `${TWEMOJI}/1f622.png`, // 哭
    `${TWEMOJI}/1f62d.png`, // 大哭
    `${TWEMOJI}/1f614.png`, // 沮丧
    `${TWEMOJI}/1f61e.png`, // 失望
    `${TWEMOJI}/1f97a.png`, // 恳求
  ],
  angry: [
    `${TWEMOJI}/1f621.png`, // 发怒
    `${TWEMOJI}/1f92c.png`, // 爆粗口
    `${TWEMOJI}/1f624.png`, // 喷气
    `${TWEMOJI}/1f620.png`, // 生气
    `${TWEMOJI}/1f4a2.png`, // 愤怒符号
    `${TWEMOJI}/1f525.png`, // 火
  ],
  shy: [
    `${TWEMOJI}/1f633.png`, // 脸红
    `${TWEMOJI}/1f648.png`, // 捂眼
    `${TWEMOJI}/1f97a.png`, // 恳求
    `${TWEMOJI}/1f60a.png`, // 眯眯眼微笑
    `${TWEMOJI}/1f917.png`, // 拥抱
  ],
  surprised: [
    `${TWEMOJI}/1f632.png`, // 惊讶
    `${TWEMOJI}/1f62e.png`, // 张嘴
    `${TWEMOJI}/1f631.png`, // 尖叫
    `${TWEMOJI}/1f635.png`, // 晕眩
    `${TWEMOJI}/1f92f.png`, // 爆炸头
    `${TWEMOJI}/1f640.png`, // 惊吓的猫
  ],
  affectionate: [
    `${TWEMOJI}/1f60d.png`, // 花痴
    `${TWEMOJI}/1f618.png`, // 飞吻
    `${TWEMOJI}/1f970.png`, // 满心爱意
    `${TWEMOJI}/1f496.png`, // 闪亮爱心
    `${TWEMOJI}/1f493.png`, // 跳动的心
    `${TWEMOJI}/1f48b.png`, // 唇印
  ],
};

/** 从指定情绪的贴纸里随机挑一张；'neutral' 没有贴纸，返回 undefined。 */
export function pickSticker(emotion: StickerEmotion): string | undefined {
  if (emotion === 'neutral') return undefined;
  const set = STICKERS[emotion];
  if (set.length === 0) return undefined;
  return set[Math.floor(Math.random() * set.length)];
}

/** 情绪关键词（按匹配优先级排列：亲昵 > 难过 > 生气 > 害羞 > 惊讶 > 开心）。 */
const EMOTION_KEYWORDS: Array<{ emotion: Exclude<StickerEmotion, 'neutral'>; keywords: string[] }> = [
  {
    emotion: 'affectionate',
    keywords: ['想你', '抱抱', '亲亲', '么么', '么么哒', '爱你', '晚安', '宝贝', '亲爱的', 'mua'],
  },
  {
    emotion: 'sad',
    keywords: ['难过', '伤心', '呜呜', '哭', '委屈', '想哭', '心疼', '好惨', '呜呜呜'],
  },
  {
    emotion: 'angry',
    keywords: ['生气', '气死', '讨厌', '哼', '烦死了', '可恶', '气人', '滚开'],
  },
  {
    emotion: 'shy',
    keywords: ['害羞', '脸红', '不好意思', '嘻嘻', '羞羞'],
  },
  {
    emotion: 'surprised',
    keywords: ['哇', '天啊', '真的吗', '不会吧', '震惊', '居然', '天哪'],
  },
  {
    emotion: 'happy',
    keywords: ['开心', '哈哈', '嘿嘿', '好耶', '太好了', '喜欢', '高兴', '太棒了', '真好'],
  },
];

/**
 * 从一段中文文本里猜情绪（纯关键词匹配，不调模型）。
 * 没有关键词命中时返回 'neutral'（例如一句普通的“好的”）。
 */
export function detectEmotion(text: string): StickerEmotion {
  for (const { emotion, keywords } of EMOTION_KEYWORDS) {
    if (keywords.some((kw) => text.includes(kw))) return emotion;
  }
  return 'neutral';
}
