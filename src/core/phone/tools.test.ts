/**
 * 小手机 Agent 工具的单元测试：工具定义、标记解析、参数解析都是纯函数。
 */
import { describe, expect, it } from 'vitest';
import {
  PHONE_TOOLS,
  parseReplyMarkers,
  parseSendImageArgs,
  parseSendStickerArgs,
  parseToolArguments,
} from './tools.js';

describe('PHONE_TOOLS', () => {
  it('两个工具，参数都是合法的 JSON Schema', () => {
    expect(PHONE_TOOLS.map((t) => t.name)).toEqual(['send_image', 'send_sticker']);
    for (const tool of PHONE_TOOLS) {
      expect(typeof tool.description).toBe('string');
      expect(tool.description.length).toBeGreaterThan(0);
      const params = tool.parameters as Record<string, unknown>;
      expect(params.type).toBe('object');
      expect(params.properties).toBeTypeOf('object');
      expect(Array.isArray(params.required)).toBe(true);
    }
    const imageParams = PHONE_TOOLS[0].parameters as {
      properties: {
        description: { type: string };
        people: { type: string; enum: string[] };
      };
      required: string[];
    };
    expect(imageParams.properties.description.type).toBe('string');
    expect(imageParams.properties.people.type).toBe('string');
    expect(imageParams.properties.people.enum).toEqual(['solo', 'duo', 'multi']);
    expect(imageParams.required).toEqual(['description', 'people']);
    const stickerParams = PHONE_TOOLS[1].parameters as {
      properties: { emotion: { type: string; enum: string[] } };
      required: string[];
    };
    expect(stickerParams.properties.emotion.type).toBe('string');
    expect(stickerParams.properties.emotion.enum).toEqual([
      'happy',
      'sad',
      'shy',
      'surprised',
      'affectionate',
      'angry',
    ]);
    expect(stickerParams.required).toEqual(['emotion']);
  });

  it('send_image 的描述要带上现在的场景和人数判断，不让模型只写“我的照片”', () => {
    const imageTool = PHONE_TOOLS.find((t) => t.name === 'send_image');
    expect(imageTool?.description).toContain('现在的场景');
    expect(imageTool?.description).toContain('在哪里');
    expect(imageTool?.description).toContain('在做什么');
    expect(imageTool?.description).toContain('有几个人');
    expect(imageTool?.description).toContain('不要默认只画一个人');
    const params = imageTool?.parameters as {
      properties: {
        description: { type: string; description: string };
        people: { type: string; description: string };
      };
    };
    expect(params.properties.description.description).toContain('现在在哪里');
    expect(params.properties.description.description).toContain('在做什么');
    expect(params.properties.people.description).toContain('solo');
    expect(params.properties.people.description).toContain('duo');
    expect(params.properties.people.description).toContain('multi');
  });

  it('send_image 只在用户明确要图时调用：不主动发图，删掉“自己提到照片就发”的触发', () => {
    const imageTool = PHONE_TOOLS.find((t) => t.name === 'send_image');
    expect(imageTool?.description).toContain('只有当用户明确让你发图的时候');
    expect(imageTool?.description).toContain('用户没让你发图，就不要调用它');
    expect(imageTool?.description).toContain('不要自己主动发图');
    expect(imageTool?.description).not.toContain('你提到自己拍了照片');
    expect(imageTool?.description).not.toContain('想分享一张图');
  });
});

describe('parseToolArguments', () => {
  it('合法 JSON 解析出来，非法 JSON 返回 null', () => {
    expect(parseToolArguments('{"description":"一张照片"}')).toEqual({
      description: '一张照片',
    });
    expect(parseToolArguments('not json')).toBeNull();
    expect(parseToolArguments('')).toBeNull();
  });
});

describe('parseSendImageArgs', () => {
  it('取到 description 和 people', () => {
    expect(parseSendImageArgs('{"description":"在树荫下排队的照片","people":"duo"}')).toEqual({
      description: '在树荫下排队的照片',
      people: 'duo',
    });
    expect(parseSendImageArgs('{"description":"在树荫下排队的照片","people":"multi"}')).toEqual({
      description: '在树荫下排队的照片',
      people: 'multi',
    });
  });

  it('模型没给 people、或给了非法值时按 solo 算', () => {
    expect(parseSendImageArgs('{"description":"在树荫下排队的照片"}')).toEqual({
      description: '在树荫下排队的照片',
      people: 'solo',
    });
    expect(parseSendImageArgs('{"description":"在树荫下排队的照片","people":"four"}')).toEqual({
      description: '在树荫下排队的照片',
      people: 'solo',
    });
  });

  it('空的或缺失的 description 返回 null', () => {
    expect(parseSendImageArgs('{"description":"  "}')).toBeNull();
    expect(parseSendImageArgs('{}')).toBeNull();
    expect(parseSendImageArgs('{bad json')).toBeNull();
  });
});

describe('parseSendStickerArgs', () => {
  it('六种情绪认得出来，其他的返回 null', () => {
    expect(parseSendStickerArgs('{"emotion":"happy"}')).toBe('happy');
    expect(parseSendStickerArgs('{"emotion":"affectionate"}')).toBe('affectionate');
    expect(parseSendStickerArgs('{"emotion":"excited"}')).toBeNull();
    expect(parseSendStickerArgs('{}')).toBeNull();
    expect(parseSendStickerArgs('not json')).toBeNull();
  });
});

describe('parseReplyMarkers', () => {
  it('没有标记时原样返回', () => {
    const out = parseReplyMarkers('哈哈，今天花店来了好多客人呢');
    expect(out.cleanText).toBe('哈哈，今天花店来了好多客人呢');
    expect(out.imageDescriptions).toEqual([]);
    expect(out.stickerEmotions).toEqual([]);
  });

  it('[发图：…] 抠出描述，标记从文字里去掉', () => {
    const out = parseReplyMarkers('好呀，给你看看[发图：在树荫下排队的照片]，人还挺多的');
    expect(out.imageDescriptions).toEqual(['在树荫下排队的照片']);
    expect(out.cleanText).toBe('好呀，给你看看，人还挺多的');
    expect(out.stickerEmotions).toEqual([]);
  });

  it('[表情：…] 中文情绪词映射到贴纸情绪，标记去掉', () => {
    const out = parseReplyMarkers('嘻嘻[表情：害羞]，今天辛苦啦[表情：开心]');
    expect(out.stickerEmotions).toEqual(['shy', 'happy']);
    expect(out.cleanText).toBe('嘻嘻，今天辛苦啦');
  });

  it('[表情：…] 也认英文情绪名，认不出的情绪词只去掉标记', () => {
    const out = parseReplyMarkers('哇[表情：surprised]，真的吗[表情：兴奋]');
    expect(out.stickerEmotions).toEqual(['surprised']);
    expect(out.cleanText).toBe('哇，真的吗');
  });

  it('发图和表情标记可以混用，顺序保留', () => {
    const out = parseReplyMarkers('[发图：我的自拍][表情：亲昵]给你看');
    expect(out.imageDescriptions).toEqual(['我的自拍']);
    expect(out.stickerEmotions).toEqual(['affectionate']);
    expect(out.cleanText).toBe('给你看');
  });

  it('半角冒号也认', () => {
    const out = parseReplyMarkers('看这个[发图:花店门口的照片]');
    expect(out.imageDescriptions).toEqual(['花店门口的照片']);
    expect(out.cleanText).toBe('看这个');
  });
});
