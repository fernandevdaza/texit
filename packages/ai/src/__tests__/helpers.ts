import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import type { AgentEvent } from '../types';

export const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 5, text: 5, reasoning: undefined },
};

type Chunk = Record<string, unknown> & { type: string };

export function textStep(text: string, reasoning?: string): Chunk[] {
  return [
    { type: 'stream-start', warnings: [] },
    ...(reasoning
      ? [
          { type: 'reasoning-start', id: 'r' },
          { type: 'reasoning-delta', id: 'r', delta: reasoning },
          { type: 'reasoning-end', id: 'r' },
        ]
      : []),
    { type: 'text-start', id: 't' },
    { type: 'text-delta', id: 't', delta: text },
    { type: 'text-end', id: 't' },
    { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
  ];
}

export function toolStep(calls: { id: string; name: string; input: unknown }[], text?: string): Chunk[] {
  return [
    { type: 'stream-start', warnings: [] },
    ...(text
      ? [
          { type: 'text-start', id: 't0' },
          { type: 'text-delta', id: 't0', delta: text },
          { type: 'text-end', id: 't0' },
        ]
      : []),
    ...calls.map((c) => ({ type: 'tool-call', toolCallId: c.id, toolName: c.name, input: JSON.stringify(c.input) })),
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool_use' }, usage },
  ];
}

/** A mock model that plays one scripted stream per step. */
export function scriptedModel(steps: Chunk[][]) {
  let i = 0;
  return new MockLanguageModelV4({
    provider: 'mock',
    modelId: 'mock-model',
    doStream: async () => ({ stream: convertArrayToReadableStream((steps[i++] ?? textStep('')) as any) }),
  });
}

export function collect() {
  const events: AgentEvent[] = [];
  return { events, onEvent: (e: AgentEvent) => events.push(e), types: () => events.map((e) => e.type) };
}

/** Find the text of the tool-result parts sent back to the model in a prompt. */
export function toolResultsInPrompt(prompt: any[]): string[] {
  const out: string[] = [];
  for (const m of prompt) {
    if (m.role !== 'tool') continue;
    for (const p of m.content) {
      const o = p.output;
      out.push(typeof o?.value === 'string' ? o.value : JSON.stringify(o));
    }
  }
  return out;
}
