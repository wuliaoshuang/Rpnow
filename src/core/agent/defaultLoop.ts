/**
 * The default agent loop: one completion, streamed.
 *
 * Kept deliberately small so that "replace the agent loop" is a realistic
 * operation for plugin authors. If tools are declared, the loop does a bounded
 * tool-calling cycle (max {@link MAX_TOOL_ROUNDS}); otherwise it is a single
 * upstream request.
 */

import type { LLMMessage, LLMService, LLMToolCall } from '../llm/types.js';
import type { AgentLoop, AgentResult, AgentRunOptions } from './types.js';

const MAX_TOOL_ROUNDS = 4;

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export const defaultAgentLoop: AgentLoop = {
  label: '单轮生成（默认）',

  async run(opts: AgentRunOptions, llm: LLMService): Promise<AgentResult> {
    const messages: LLMMessage[] = [...opts.context.messages];
    let fullText = '';
    let reasoning = '';
    let steps = 0;
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let cachedTokens: number | undefined;
    let reasoningTokens: number | undefined;
    const toolTrace: AgentResult['toolTrace'] = [];
    // Calls the model asked for in the current round, before any of them
    // have run — on abort these are the "unfinished tool queue" (C08).
    let currentRoundCalls: LLMToolCall[] = [];
    let executedInRound = 0;

    try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      steps++;
      let roundText = '';
      let roundReasoning = '';
      const toolCalls: LLMToolCall[] = [];
      currentRoundCalls = [];
      executedInRound = 0;

      const stream = llm.stream(opts.connectionId, {
        model: opts.model,
        messages,
        stream: opts.context.stream !== false,
        temperature: opts.context.temperature,
        maxTokens: opts.context.maxTokens,
        tools: opts.context.tools,
        signal: opts.signal,
        ...opts.params,
      });

      for await (const ev of stream) {
        switch (ev.type) {
          case 'text':
            roundText += ev.delta;
            opts.onEvent?.(ev);
            break;
          case 'reasoning':
            roundReasoning += ev.delta;
            opts.onEvent?.(ev);
            break;
          case 'tool_call':
            toolCalls.push(ev.call);
            currentRoundCalls.push(ev.call);
            opts.onEvent?.(ev);
            break;
          case 'usage':
            inputTokens = ev.inputTokens ?? inputTokens;
            outputTokens = ev.outputTokens ?? outputTokens;
            cachedTokens = ev.cachedTokens ?? cachedTokens;
            reasoningTokens = ev.reasoningTokens ?? reasoningTokens;
            opts.onEvent?.(ev);
            break;
          case 'finish':
            opts.onEvent?.(ev);
            break;
          case 'error':
            throw new Error(ev.message);
        }
      }

      fullText += roundText;
      reasoning += roundReasoning;

      // The tool always runs — even in stop-after mode, where its result is the
      // reply itself rather than input for another round.
      const canTool = Boolean(opts.executeTool && toolCalls.length && round < MAX_TOOL_ROUNDS);
      if (!canTool) break;

      // Append the assistant's tool-call turn, then each result, then loop.
      messages.push({ role: 'assistant', content: roundText, toolCalls });
      for (const call of toolCalls) {
        const args = parseArgs(call.arguments);
        let result: unknown;
        try {
          result = await opts.executeTool!(call.name, args);
        } catch (err) {
          result = { error: err instanceof Error ? err.message : String(err) };
        }
        toolTrace.push({ name: call.name, args, result });
        executedInRound++;
        messages.push({
          role: 'tool',
          toolCallId: call.id,
          content: typeof result === 'string' ? result : JSON.stringify(result),
        });
      }
      // Anything the model asked for via tools belongs to the next round only.
      fullText = fullText.slice(0, fullText.length - roundText.length);
      if (opts.context.stopOnToolResult) break;
    }
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        // C08: mark the calls that never ran (still queued when the user hit
        // stop, or cut off mid-stream) so the timeline can show them instead
        // of silently dropping the queue. Completed calls are already traced.
        for (const call of currentRoundCalls.slice(executedInRound)) {
          toolTrace.push({ name: call.name, args: parseArgs(call.arguments), result: { error: '生成已中止' } });
        }
        if (toolTrace.length) {
          (err as Error & { toolTrace?: AgentResult['toolTrace'] }).toolTrace = toolTrace;
        }
      }
      throw err;
    }

    return {
      text: fullText,
      reasoning: reasoning || undefined,
      steps,
      usage: { inputTokens, outputTokens, cachedTokens, reasoningTokens },
      toolTrace: toolTrace.length ? toolTrace : undefined,
    };
  },
};
