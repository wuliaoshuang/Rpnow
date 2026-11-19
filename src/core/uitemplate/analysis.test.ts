import { describe, expect, it, vi } from 'vitest';
import {
  analyseTemplate,
  analyseTemplates,
  buildAnalysisMessages,
  clampAnalysisDepth,
} from './analysis.js';
import { createTemplate } from './types.js';

const tpl = createTemplate({
  id: 'tpl_1',
  name: '状态栏',
  initialVariableState: { hp: 100, mood: '平静' },
  variableState: { hp: 100, mood: '平静' },
  variableSchema: { hp: 'number', mood: 'string' },
});

const messages = [
  { id: 'm1', role: 'user', content: '楼一', createdAt: 1 },
  { id: 'm2', role: 'assistant', content: '楼二', createdAt: 2 },
  { id: 'm3', role: 'user', content: '楼三', createdAt: 3 },
  { id: 'm4', role: 'assistant', content: '楼四', createdAt: 4 },
  { id: 'm5', role: 'user', content: '楼五', createdAt: 5 },
] as Parameters<typeof buildAnalysisMessages>[0]['messages'];

describe('clampAnalysisDepth', () => {
  it('clamps to 4–10', () => {
    expect(clampAnalysisDepth(2)).toBe(4);
    expect(clampAnalysisDepth(4)).toBe(4);
    expect(clampAnalysisDepth(7)).toBe(7);
    expect(clampAnalysisDepth(99)).toBe(10);
    expect(clampAnalysisDepth(Number.NaN)).toBe(4);
  });
});

describe('buildAnalysisMessages', () => {
  it('sends only the newest N floors', () => {
    const [sys] = buildAnalysisMessages({
      template: tpl,
      messages,
      depth: 4,
      injectContext: false,
      personaName: '霜霜',
      characterName: 'doro',
    });
    expect(sys.content).not.toContain('楼一');
    // Newest 4 floors are m2..m5.
    expect(sys.content).toContain('楼二');
    expect(sys.content).toContain('楼三');
    expect(sys.content).toContain('楼四');
    expect(sys.content).toContain('楼五');
    expect(sys.content).toContain('tpl_1');
    expect(sys.content).toContain('hp');
  });

  it('injects the variable snapshot only when asked', () => {
    const withCtx = buildAnalysisMessages({
      template: tpl,
      messages,
      depth: 4,
      injectContext: true,
    })[0].content;
    expect(withCtx).toContain('当前变量快照');
    expect(withCtx).toContain('"hp":100');
    const withoutCtx = buildAnalysisMessages({
      template: tpl,
      messages,
      depth: 4,
      injectContext: false,
    })[0].content;
    expect(withoutCtx).not.toContain('当前变量快照');
  });
});

describe('analyseTemplate', () => {
  it('parses the update block and drops other-template ids', async () => {
    const llm = {
      complete: vi.fn().mockResolvedValue({
        text: '<ui_template_updates>[{"id":"tpl_1","variables":{"hp":80}},{"id":"other","variables":{"x":1}}]</ui_template_updates>',
        toolCalls: [],
      }),
    };
    const updates = await analyseTemplate({
      llm,
      connectionId: 'c1',
      model: 'sub-model',
      template: tpl,
      messages,
      depth: 4,
      injectContext: false,
    });
    expect(updates).toEqual([{ id: 'tpl_1', variables: { hp: 80 } }]);
    const req = llm.complete.mock.calls[0][1];
    expect(req.temperature).toBe(0.4);
    expect(req.model).toBe('sub-model');
    // Only the newest 4 floors reach the model.
    expect(req.messages[0].content).not.toContain('楼一');
  });

  it('returns [] when the model reports no change or no block', async () => {
    const empty = {
      complete: vi.fn().mockResolvedValue({ text: '<ui_template_updates>[]</ui_template_updates>', toolCalls: [] }),
    };
    expect(
      await analyseTemplate({
        llm: empty,
        connectionId: 'c1',
        model: '',
        fallbackModel: 'chat-model',
        template: tpl,
        messages,
        depth: 4,
        injectContext: false,
      }),
    ).toEqual([]);
    expect(empty.complete.mock.calls[0][1].model).toBe('chat-model');

    const noBlock = {
      complete: vi.fn().mockResolvedValue({ text: '没有变化', toolCalls: [] }),
    };
    expect(
      await analyseTemplate({
        llm: noBlock,
        connectionId: 'c1',
        model: 'sub-model',
        template: tpl,
        messages,
        depth: 4,
        injectContext: false,
      }),
    ).toEqual([]);
  });

  it('analyseTemplates runs every template in turn', async () => {
    const llm = {
      complete: vi
        .fn()
        .mockResolvedValueOnce({
          text: '<ui_template_updates>[{"id":"tpl_1","variables":{"hp":90}}]</ui_template_updates>',
          toolCalls: [],
        })
        .mockResolvedValueOnce({
          text: '<ui_template_updates>[]</ui_template_updates>',
          toolCalls: [],
        }),
    };
    const tpl2 = createTemplate({ id: 'tpl_2', name: '第二栏', initialVariableState: { x: 1 } });
    const out = await analyseTemplates({
      llm,
      connectionId: 'c1',
      model: 'sub-model',
      templates: [tpl, tpl2],
      messages,
      depth: 4,
      injectContext: false,
    });
    expect(out).toEqual([{ id: 'tpl_1', variables: { hp: 90 } }]);
    expect(llm.complete).toHaveBeenCalledTimes(2);
  });
});
