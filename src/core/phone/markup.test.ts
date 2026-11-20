import { describe, expect, it } from 'vitest';
import { parseReplyMarkup } from './markup.js';

describe('parseReplyMarkup', () => {
  it('没有标记：整段回复就是一段聊天', () => {
    expect(parseReplyMarkup('哈哈，今天花店来了好多客人呢')).toEqual([
      { type: 'chat', text: '哈哈，今天花店来了好多客人呢' },
    ]);
  });

  it('空回复：什么都没有', () => {
    expect(parseReplyMarkup('')).toEqual([]);
    expect(parseReplyMarkup('   ')).toEqual([]);
  });

  it('{chat:…} 按顺序成段，每条单独一个气泡', () => {
    expect(parseReplyMarkup('{chat:在吗}{chat:今天花店好忙}')).toEqual([
      { type: 'chat', text: '在吗' },
      { type: 'chat', text: '今天花店好忙' },
    ]);
  });

  it('{image:描述 ||| 标签}：描述和标签按第一个 ||| 切开', () => {
    expect(
      parseReplyMarkup('{image:在老街法桐树下买凉皮 ||| 1girl, solo, street, sunlight}'),
    ).toEqual([
      {
        type: 'image',
        description: '在老街法桐树下买凉皮',
        tags: '1girl, solo, street, sunlight',
      },
    ]);
  });

  it('{image:描述} 没有 |||：整段都是描述，没有标签', () => {
    expect(parseReplyMarkup('{image:在宿舍楼下拍的照片}')).toEqual([
      { type: 'image', description: '在宿舍楼下拍的照片' },
    ]);
  });

  it('{image:…} 描述里有第二个 |||：只按第一个切', () => {
    expect(parseReplyMarkup('{image:蛋糕 ||| 上的蜡烛 ||| cake, candle}')).toEqual([
      { type: 'image', description: '蛋糕', tags: '上的蜡烛 ||| cake, candle' },
    ]);
  });

  it('{image:} 空描述：这段丢掉', () => {
    expect(parseReplyMarkup('{chat:给你看}{image:   }')).toEqual([
      { type: 'chat', text: '给你看' },
    ]);
  });

  it('{sticker:情绪}：英文情绪名认得出', () => {
    expect(parseReplyMarkup('{chat:嘻嘻}{sticker:happy}')).toEqual([
      { type: 'chat', text: '嘻嘻' },
      { type: 'sticker', emotion: 'happy' },
    ]);
    expect(parseReplyMarkup('{sticker:affectionate}')).toEqual([
      { type: 'sticker', emotion: 'affectionate' },
    ]);
  });

  it('{sticker:情绪}：中文情绪词也认得出', () => {
    expect(parseReplyMarkup('{sticker:害羞}')).toEqual([
      { type: 'sticker', emotion: 'shy' },
    ]);
    expect(parseReplyMarkup('{sticker:开心}{sticker:生气}')).toEqual([
      { type: 'sticker', emotion: 'happy' },
      { type: 'sticker', emotion: 'angry' },
    ]);
  });

  it('{sticker:情绪}：认不出的情绪词丢掉这段，不显示', () => {
    expect(parseReplyMarkup('{chat:哇}{sticker:兴奋}')).toEqual([
      { type: 'chat', text: '哇' },
    ]);
  });

  it('混合：普通文字 + 标记按顺序出段', () => {
    expect(
      parseReplyMarkup(
        '好呀，给你看看{image:在树荫下排队的照片 ||| 1girl, solo, tree shade}，人还挺多的{sticker:开心}',
      ),
    ).toEqual([
      { type: 'chat', text: '好呀，给你看看' },
      { type: 'image', description: '在树荫下排队的照片', tags: '1girl, solo, tree shade' },
      { type: 'chat', text: '，人还挺多的' },
      { type: 'sticker', emotion: 'happy' },
    ]);
  });

  it('标记外的普通文字拼成一段，空白的不要', () => {
    expect(parseReplyMarkup('你好呀{chat:在吗}   嗯嗯')).toEqual([
      { type: 'chat', text: '你好呀' },
      { type: 'chat', text: '在吗' },
      { type: 'chat', text: '嗯嗯' },
    ]);
  });

  it('不支持的标记（voice、money……）直接丢掉，不显示、不报错', () => {
    expect(parseReplyMarkup('{chat:听我说}{voice:一段语音}{chat:就这样}')).toEqual([
      { type: 'chat', text: '听我说' },
      { type: 'chat', text: '就这样' },
    ]);
    expect(parseReplyMarkup('{money:100}')).toEqual([]);
  });

  it('没有冒号的 {…} 也丢掉', () => {
    expect(parseReplyMarkup('{chat}你好')).toEqual([{ type: 'chat', text: '你好' }]);
  });

  it('括号没闭合：剩下的当普通文字，标记开头去掉，不崩', () => {
    expect(parseReplyMarkup('{chat:在吗}{chat:没说完')).toEqual([
      { type: 'chat', text: '在吗' },
      { type: 'chat', text: '没说完' },
    ]);
    expect(parseReplyMarkup('你好{image:一半')).toEqual([
      { type: 'chat', text: '你好一半' },
    ]);
  });

  it('标记名大小写不敏感，描述里的冒号不影响', () => {
    expect(parseReplyMarkup('{Chat:在吗}{IMAGE:照片：傍晚的花店}')).toEqual([
      { type: 'chat', text: '在吗' },
      { type: 'image', description: '照片：傍晚的花店' },
    ]);
  });

  it('完整的回复：文字 + 图 + 表情包按顺序', () => {
    expect(
      parseReplyMarkup(
        '{chat:好呀，给你看看}{image:在宿舍楼下拍的照片 ||| 1girl, solo, dorm building}{chat:今天天气可好了}{sticker:happy}',
      ),
    ).toEqual([
      { type: 'chat', text: '好呀，给你看看' },
      { type: 'image', description: '在宿舍楼下拍的照片', tags: '1girl, solo, dorm building' },
      { type: 'chat', text: '今天天气可好了' },
      { type: 'sticker', emotion: 'happy' },
    ]);
  });
});
