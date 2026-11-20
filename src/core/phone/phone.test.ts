/**
 * 小手机贴纸与问候语的单元测试。
 *
 * 注意：微信聊天记录的存取走 IndexedDB（idbStorage），测试环境里没有
 * IndexedDB，所以这里只测纯函数（贴纸、情绪识别、开场白），不测 store。
 */
import { describe, expect, it } from 'vitest';
import { STICKERS, detectEmotion, pickSticker } from './stickers.js';
import { greetingMessage } from './wechatStore.js';
import type { StickerEmotion } from './types.js';

describe('detectEmotion', () => {
  it.each([
    ['哈哈，今天太开心了', 'happy'],
    ['呜呜，好难过', 'sad'],
    ['气死我了，讨厌！', 'angry'],
    ['哎呀，好害羞，不好意思', 'shy'],
    ['哇，真的吗？居然是这样！', 'surprised'],
    ['想你了，抱抱，晚安', 'affectionate'],
  ] as Array<[string, StickerEmotion]>)('%s → %s', (text, emotion) => {
    expect(detectEmotion(text)).toBe(emotion);
  });

  it('普通的“好的”不带情绪，返回 neutral', () => {
    expect(detectEmotion('好的')).toBe('neutral');
    expect(detectEmotion('嗯，知道了')).toBe('neutral');
    expect(detectEmotion('')).toBe('neutral');
  });
});

describe('pickSticker', () => {
  it.each(['happy', 'sad', 'angry', 'shy', 'surprised', 'affectionate'] as const)(
    '%s 返回该情绪贴纸集里的一张',
    (emotion) => {
      const url = pickSticker(emotion);
      expect(url).toBeDefined();
      expect(STICKERS[emotion]).toContain(url);
    },
  );

  it('neutral 没有贴纸，返回 undefined', () => {
    expect(pickSticker('neutral')).toBeUndefined();
  });

  it('每个情绪至少有 4 张贴纸，且全是直接图片链接', () => {
    for (const urls of Object.values(STICKERS)) {
      expect(urls.length).toBeGreaterThanOrEqual(4);
      for (const url of urls) {
        expect(url).toMatch(/^https:\/\/[^?#]+\.(png|jpg|jpeg|webp|gif)$/);
      }
    }
  });
});

describe('greetingMessage', () => {
  it('用联系人的开场白当第一条消息', () => {
    const msg = greetingMessage({
      id: 'card-1',
      name: '小橘',
      relation: '本人',
      openingMessage: '你好呀，今天想聊点什么？',
      isMain: true,
    });
    expect(msg.role).toBe('assistant');
    expect(msg.type).toBe('text');
    expect(msg.content).toBe('你好呀，今天想聊点什么？');
    expect(msg.id).toMatch(/^m/);
    expect(msg.createdAt).toBeGreaterThan(0);
  });
});
