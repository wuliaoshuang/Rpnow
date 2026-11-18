import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseCardFile } from './parser.js';

// 1x1 红色 PNG 与 1x1 蓝色 PNG（不同字节，用于区分头像与截图）。
const RED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const BLUE_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

function cardDoc() {
  return {
    spec: 'chara_card_v2',
    spec_version: '2.0',
    name: 'doro',
    description: '粉色毛绒的神奇生物',
    personality: '温暖、爱分享',
    scenario: '冰河大陆的雪山',
    first_mes: '要一起去找曲奇吗？',
    mes_example: '',
    data: {
      name: 'doro',
      description: '粉色毛绒的神奇生物',
      personality: '温暖、爱分享',
      scenario: '冰河大陆的雪山',
      first_mes: '要一起去找曲奇吗？',
      mes_example: '',
    },
  };
}

describe('商店安装包头像', () => {
  it('解析整包时带上 avatar.png（而不是只读 card.json）', async () => {
    const zip = new JSZip();
    zip.file('publish.json', JSON.stringify({ type: 'card', id: 'card.test.doro', version: '1.0.0' }));
    zip.file('card.json', JSON.stringify(cardDoc()));
    zip.file('avatar.png', Buffer.from(RED_PNG_B64, 'base64'));
    // 包里另有一张截图：头像必须优先认 avatar.png，不能错认成截图。
    zip.file('screenshots/shot.png', Buffer.from(BLUE_PNG_B64, 'base64'));
    const blob = await zip.generateAsync({ type: 'blob' });

    const { card } = await parseCardFile(blob, 'doro.rpcard');
    expect(card.data.name).toBe('doro');
    expect(card.avatar).toBe(`data:image/png;base64,${RED_PNG_B64}`);
  });

  it('包里没有头像时不崩溃', async () => {
    const zip = new JSZip();
    zip.file('card.json', JSON.stringify(cardDoc()));
    const blob = await zip.generateAsync({ type: 'blob' });
    const { card } = await parseCardFile(blob, 'doro.rpcard');
    expect(card.data.name).toBe('doro');
    expect(card.avatar).toBeUndefined();
  });
});
