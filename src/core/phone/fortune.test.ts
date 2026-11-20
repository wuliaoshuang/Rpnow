/**
 * 运势占卜 / 塔罗（fortune.ts）的单元测试。
 */
import { describe, expect, it } from 'vitest';
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
  HOROSCOPE_FALLBACKS,
  parseHoroscopeText,
  parseTarotText,
  tarotOrientation,
  TAROT_DECK,
  TAROT_MEANINGS,
} from './fortune.js';
import type { HoroscopeResult } from './types.js';

describe('FORTUNE_CATEGORIES', () => {
  it('四个类别：事业、爱情、财运、健康', () => {
    expect(FORTUNE_CATEGORIES.map((c) => c.label)).toEqual(['事业', '爱情', '财运', '健康']);
    expect(FORTUNE_CATEGORIES.map((c) => c.id)).toEqual(['career', 'love', 'wealth', 'health']);
    expect(fortuneCategoryLabel('love')).toBe('爱情');
  });
});

describe('TAROT_DECK', () => {
  it('22 张大阿卡纳，首尾是愚者和世界', () => {
    expect(TAROT_DECK).toHaveLength(22);
    expect(TAROT_DECK[0]).toBe('愚者');
    expect(TAROT_DECK[21]).toBe('世界');
    expect(new Set(TAROT_DECK).size).toBe(22);
  });

  it('每张牌都有正位和逆位的静态牌义', () => {
    for (const card of TAROT_DECK) {
      expect(TAROT_MEANINGS[card]?.upright).toBeTruthy();
      expect(TAROT_MEANINGS[card]?.reversed).toBeTruthy();
    }
  });
});

describe('drawTarotCard', () => {
  it('固定 rng 抽到确定的牌和正逆位', () => {
    // rng 第一次 0 → 第 0 张（愚者），第二次 0.9 → 正位。
    const seq = [0, 0.9];
    expect(drawTarotCard(() => seq.shift()!)).toEqual({ cardName: '愚者', reversed: false });
    // rng 第一次 0.99 → 最后一张（世界），第二次 0.1 → 逆位。
    const seq2 = [0.99, 0.1];
    expect(drawTarotCard(() => seq2.shift()!)).toEqual({ cardName: '世界', reversed: true });
  });

  it('大量抽牌里正位和逆位都有，牌都在牌堆里', () => {
    const seen = new Set<string>();
    let reversedCount = 0;
    for (let i = 0; i < 200; i++) {
      const { cardName, reversed } = drawTarotCard();
      seen.add(cardName);
      if (reversed) reversedCount++;
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(reversedCount).toBeGreaterThan(50);
    expect(reversedCount).toBeLessThan(150);
  });
});

describe('tarotOrientation', () => {
  it('正位 / 逆位', () => {
    expect(tarotOrientation(false)).toBe('正位');
    expect(tarotOrientation(true)).toBe('逆位');
  });
});

describe('buildHoroscopeMessages', () => {
  it('提示词里有类别、占星师、标签格式和幸运数字范围', () => {
    const msgs = buildHoroscopeMessages('love');
    expect(msgs).toHaveLength(1);
    const text = msgs[0].content;
    expect(text).toContain('占星师');
    expect(text).toContain('爱情');
    expect(text).toContain('标题：');
    expect(text).toContain('解读：');
    expect(text).toContain('幸运色：');
    expect(text).toContain('幸运数字：');
    expect(text).toContain('口头禅：');
    expect(text).toContain('1–9');
  });
});

describe('parseHoroscopeText', () => {
  const raw = [
    '标题：心意会传到的日子',
    '解读：今天适合把心里的话说出口，真诚本身就够动人。',
    '幸运色：粉色',
    '幸运数字：2',
    '口头禅：真诚一点点就好。',
  ].join('\n');

  it('按标签解析出标题、解读、幸运色、幸运数字、口头禅', () => {
    const result = parseHoroscopeText(raw, 'love');
    expect(result).not.toBeNull();
    expect(result?.title).toBe('心意会传到的日子');
    expect(result?.reading).toContain('真诚本身就够动人');
    expect(result?.luckyColor).toBe('粉色');
    expect(result?.luckyNumber).toBe(2);
    expect(result?.mantra).toBe('真诚一点点就好。');
    expect(result?.category).toBe('love');
  });

  it('解读缺失时返回 null（调用方用静态兜底）', () => {
    expect(parseHoroscopeText('', 'career')).toBeNull();
    expect(parseHoroscopeText('标题：只有标题', 'career')).toBeNull();
  });

  it('幸运数字越界时落在 1–9 之间', () => {
    const out = parseHoroscopeText(raw.replace('幸运数字：2', '幸运数字：99'), 'love');
    expect(out?.luckyNumber).toBeGreaterThanOrEqual(1);
    expect(out?.luckyNumber).toBeLessThanOrEqual(9);
  });
});

describe('fallbackHoroscope', () => {
  it('每类都有 3 条静态兜底，挑出来的那条属于这类的池子', () => {
    for (const c of FORTUNE_CATEGORIES) {
      expect(HOROSCOPE_FALLBACKS[c.id]).toHaveLength(3);
      const picked = fallbackHoroscope(c.id, () => 1);
      expect(picked.category).toBe(c.id);
      expect(picked).toEqual({ ...HOROSCOPE_FALLBACKS[c.id][1], category: c.id, timestamp: picked.timestamp });
      expect(picked.reading.length).toBeGreaterThan(20);
      expect(picked.luckyNumber).toBeGreaterThanOrEqual(1);
      expect(picked.luckyNumber).toBeLessThanOrEqual(9);
    }
  });
});

describe('buildTarotMessages / parseTarotText / fallbackTarot', () => {
  it('塔罗提示词里有牌名和正逆位', () => {
    const msgs = buildTarotMessages('星星', false);
    expect(msgs[0].content).toContain('星星');
    expect(msgs[0].content).toContain('正位');
    expect(msgs[0].content).toContain('塔罗');
    const reversed = buildTarotMessages('月亮', true);
    expect(reversed[0].content).toContain('月亮');
    expect(reversed[0].content).toContain('逆位');
  });

  it('解析塔罗解读：去空白，空的返回空字符串', () => {
    expect(parseTarotText('  希望回来了。  ')).toBe('希望回来了。');
    expect(parseTarotText('')).toBe('');
  });

  it('静态牌义兜底：正位和逆位不一样', () => {
    const up = fallbackTarot('星星', false);
    const down = fallbackTarot('星星', true);
    expect(up).toBe(TAROT_MEANINGS['星星'].upright);
    expect(down).toBe(TAROT_MEANINGS['星星'].reversed);
    expect(up).not.toBe(down);
  });
});

describe('buildTarotDraw', () => {
  it('拼出一次抽牌结果', () => {
    const draw = buildTarotDraw('太阳', false, '阳光灿烂的一天。');
    expect(draw.cardName).toBe('太阳');
    expect(draw.reversed).toBe(false);
    expect(draw.reading).toBe('阳光灿烂的一天。');
    expect(draw.timestamp).toBeGreaterThan(0);
  });
});

describe('formatHoroscopeCopyText / formatTarotCopyText', () => {
  it('运势复制文本里有标题、解读、幸运色、幸运数字、口头禅', () => {
    const result: HoroscopeResult = {
      category: 'wealth',
      title: '小财在路上的日子',
      reading: '今天有小小的好运气。',
      luckyColor: '金色',
      luckyNumber: 8,
      mantra: '小确幸也是财运。',
      timestamp: 1,
    };
    const text = formatHoroscopeCopyText(result);
    expect(text).toContain('财运运势');
    expect(text).toContain('小财在路上的日子');
    expect(text).toContain('幸运色：金色');
    expect(text).toContain('幸运数字：8');
    expect(text).toContain('口头禅：小确幸也是财运。');
  });

  it('塔罗复制文本里有牌名、正逆位和解读', () => {
    const text = formatTarotCopyText({ cardName: '月亮', reversed: true, reading: '雾快散了。', timestamp: 1 });
    expect(text).toContain('月亮');
    expect(text).toContain('逆位');
    expect(text).toContain('雾快散了。');
  });
});
