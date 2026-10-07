import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4 } from 'ai/test';
import { runAgent, toModelMessages } from '../agent';
import { createInMemoryProjectContext } from '../memory-context';
import { buildProjectContext, buildSystemPrompt } from '../prompt';
import { createProjectTools } from '../tools';
import type { ChatMessage } from '../types';
import { collect, scriptedModel, textStep, toolResultsInPrompt, toolStep } from './helpers';

const user = (text: string, extra: Partial<ChatMessage> = {}): ChatMessage => ({
  id: Math.random().toString(36),
  role: 'user',
  parts: [{ type: 'text', text }],
  createdAt: 0,
  ...extra,
});

const MAIN = '\\documentclass{article}\n\\begin{document}\nHello wrold.\n\\end{document}\n';

describe('runAgent', () => {
  it('runs a multi-step tool loop and emits ordered events', async () => {
    const ctx = createInMemoryProjectContext({ 'main.tex': MAIN });
    const { events, onEvent, types } = collect();
    const model = scriptedModel([
      toolStep([{ id: 'c1', name: 'read_file', input: { path: 'main.tex' } }], 'Let me look.'),
      toolStep([{ id: 'c2', name: 'edit_file', input: { path: 'main.tex', search: 'Hello wrold.', replace: 'Hello world.' } }]),
      textStep('Fixed the typo.', 'thinking about it'),
    ]);
    const tools = createProjectTools(ctx, { autoApply: true, onEvent });
    const res = await runAgent({ model, messages: [user('fix the typo')], tools, system: buildSystemPrompt(), onEvent });

    expect(ctx.files.get('main.tex')).toContain('Hello world.');
    expect(res.finishReason).toBe('stop');
    expect(res.steps).toBe(3);
    expect(res.text).toBe('Let me look.Fixed the typo.');

    const t = types();
    expect(t[t.length - 1]).toBe('done');
    expect(t.filter((x) => x === 'done')).toHaveLength(1);
    expect(t).toContain('reasoning-delta');

    // tool-call precedes its file-edit, which precedes its tool-result.
    const iCall = events.findIndex((e) => e.type === 'tool-call' && e.id === 'c2');
    const iEdit = events.findIndex((e) => e.type === 'file-edit');
    const iResult = events.findIndex((e) => e.type === 'tool-result' && e.id === 'c2');
    expect(iCall).toBeGreaterThanOrEqual(0);
    expect(iCall).toBeLessThan(iEdit);
    expect(iEdit).toBeLessThan(iResult);
    expect(events[iEdit]).toMatchObject({ type: 'file-edit', path: 'main.tex', status: 'applied', toolCallId: 'c2', op: 'edit' });
    expect(events.filter((e) => e.type === 'tool-call' && e.id === 'c1')).toHaveLength(1);

    const read = events.find((e) => e.type === 'tool-result' && e.id === 'c1');
    expect(read && 'output' in read && read.output).toContain('Hello wrold.');

    const usage = events.find((e) => e.type === 'usage');
    expect(usage).toMatchObject({ inputTokens: 30, outputTokens: 15 });

    // The second model call received the read_file result.
    expect(toolResultsInPrompt(model.doStreamCalls[1].prompt as any[]).join('\n')).toContain('3\tHello wrold.');
    // The system prompt was sent as instructions.
    expect((model.doStreamCalls[0].prompt as any[])[0]).toMatchObject({ role: 'system' });
  });

  it('reports tool errors to the model and the UI', async () => {
    const ctx = createInMemoryProjectContext({ 'main.tex': MAIN });
    const { events, onEvent } = collect();
    const model = scriptedModel([
      toolStep([{ id: 'c1', name: 'edit_file', input: { path: 'main.tex', search: 'nope', replace: 'x' } }]),
      textStep('Could not edit.'),
    ]);
    await runAgent({ model, messages: [user('edit')], tools: createProjectTools(ctx, { autoApply: true }), onEvent });
    const result = events.find((e) => e.type === 'tool-result');
    expect(result).toMatchObject({ isError: true });
    expect(toolResultsInPrompt(model.doStreamCalls[1].prompt as any[]).join('')).toContain('not found');
  });

  it('stops at maxSteps', async () => {
    const ctx = createInMemoryProjectContext({ 'main.tex': MAIN });
    const { onEvent, events } = collect();
    const steps = Array.from({ length: 5 }, (_, i) => toolStep([{ id: `c${i}`, name: 'list_files', input: {} }]));
    const res = await runAgent({ model: scriptedModel(steps), messages: [user('loop')], tools: createProjectTools(ctx, { autoApply: true }), maxSteps: 2, onEvent });
    expect(res.finishReason).toBe('max-steps');
    expect(res.steps).toBe(2);
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'max-steps' });
  });

  it('turns provider errors into an error event and finishes with done', async () => {
    const { events, onEvent } = collect();
    const model = new MockLanguageModelV4({
      doStream: async () => {
        throw Object.assign(new Error('Unauthorized'), { statusCode: 401, responseBody: '{"error":{"message":"invalid x-api-key"}}' });
      },
    });
    const res = await runAgent({ model, messages: [user('hi')], onEvent, maxRetries: 0 });
    expect(res.finishReason).toBe('error');
    const err = events.find((e) => e.type === 'error');
    expect(err && 'message' in err && err.message).toContain('invalid x-api-key');
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'error' });
  });

  it('handles abort without an error event', async () => {
    const { events, onEvent } = collect();
    const ac = new AbortController();
    ac.abort();
    const res = await runAgent({ model: scriptedModel([textStep('never')]), messages: [user('hi')], onEvent, signal: ac.signal });
    expect(res.finishReason).toBe('aborted');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'aborted' });
  });

  it('prepends the project context to the last user message', async () => {
    const model = scriptedModel([textStep('ok')]);
    const projectContext = buildProjectContext({ mainPath: 'main.tex', files: [{ path: 'main.tex' }], diagnostics: [] });
    await runAgent({ model, messages: [user('first'), { id: 'a', role: 'assistant', parts: [{ type: 'text', text: 'hi' }], createdAt: 0 }, user('second')], projectContext, onEvent: () => {} });
    const prompt = model.doStreamCalls[0].prompt as any[];
    const users = prompt.filter((m) => m.role === 'user');
    expect(JSON.stringify(users[0])).not.toContain('project_context');
    expect(users[1].content[0].text).toContain('<project_context>');
    expect(users[1].content[0].text).toContain('Main document: main.tex');
  });
});

describe('toModelMessages', () => {
  const history: ChatMessage[] = [
    { id: '0', role: 'assistant', parts: [{ type: 'text', text: 'Welcome!' }], createdAt: 0 },
    { id: 's', role: 'system', parts: [{ type: 'text', text: 'Be brief.' }], createdAt: 0 },
    user('Fix this', {
      attachments: [
        { kind: 'selection', path: 'main.tex', line: 3, text: 'Hello wrold.' },
        { kind: 'image', dataUrl: 'data:image/png;base64,iVBORw0KGgo=' },
        { kind: 'diagnostics', diagnostics: [{ severity: 'error', message: 'Undefined control sequence', file: 'main.tex', line: 3 }] },
      ],
    }),
    {
      id: 'a1',
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'hmm' },
        { type: 'text', text: 'Reading.' },
        { type: 'tool-call', id: 'call:1', name: 'read_file', input: { path: 'main.tex' }, status: 'done', output: 'content' },
        { type: 'tool-call', id: 'c2', name: 'mcp__gone__x', input: {}, status: 'done', output: 'x' },
        { type: 'file-edit', path: 'main.tex', status: 'applied' },
        { type: 'text', text: 'Done.' },
      ],
      createdAt: 0,
    },
    user('thanks'),
    { id: 'p', role: 'assistant', parts: [], createdAt: 0 },
  ];

  it('converts attachments, structured tool history and system notes', () => {
    const { messages, systemNotes } = toModelMessages(history, { toolNames: new Set(['read_file']) });
    expect(systemNotes).toEqual(['Be brief.']);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user']);
    const first = messages[0] as any;
    expect(first.content[0].text).toContain('<selection path="main.tex" line="3">');
    expect(first.content[1]).toMatchObject({ type: 'file', mediaType: 'image/png', data: { type: 'data', data: 'iVBORw0KGgo=' } });
    expect(first.content[2].text).toContain('Undefined control sequence');
    expect(first.content[3].text).toBe('Fix this');
    const assistant = messages[1] as any;
    expect(assistant.content).toEqual([
      { type: 'text', text: 'Reading.' },
      { type: 'tool-call', toolCallId: 'call_1', toolName: 'read_file', input: { path: 'main.tex' } },
    ]);
    expect((messages[2] as any).content[0]).toMatchObject({ toolCallId: 'call_1', output: { type: 'text', value: 'content' } });
    expect((messages[3] as any).content).toEqual([{ type: 'text', text: 'Done.' }]);
  });

  it('drops tool history when no tools are available and notes edited files', () => {
    const { messages } = toModelMessages(history);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(messages[1])).toContain('Files changed in this turn: main.tex');
  });

  it('replays stored per-message context verbatim (stable prefix)', () => {
    const msgs = [user('one', { context: 'CTX-1' }), { id: 'a', role: 'assistant' as const, parts: [{ type: 'text' as const, text: 'ok' }], createdAt: 0 }, user('two')];
    const { messages } = toModelMessages(msgs, { projectContext: 'CTX-2' });
    expect((messages[0] as any).content[0].text).toContain('CTX-1');
    expect((messages[2] as any).content[0].text).toContain('CTX-2');
  });

  it('never ends with an assistant turn', () => {
    const { messages } = toModelMessages([user('a'), { id: 'x', role: 'assistant', parts: [{ type: 'text', text: 'partial' }], createdAt: 0 }]);
    expect(messages[messages.length - 1]).toEqual({ role: 'user', content: 'Continue.' });
  });
});

describe('buildSystemPrompt', () => {
  it('includes the key rules and optional state', () => {
    const p = buildSystemPrompt({
      projectName: 'Thesis',
      customInstructions: 'Use British spelling.',
      mainPath: 'main.tex',
      activeFile: { path: 'ch1.tex', selection: { text: 'x', line: 4 } },
      diagnostics: [{ severity: 'error', message: 'Missing $ inserted', file: 'ch1.tex', line: 9 }],
    });
    expect(p).toContain('"Thesis"');
    expect(p).toContain('edit_file');
    expect(p).toMatch(/Never invent packages/);
    expect(p).toMatch(/language of the user's latest message/);
    expect(p).toContain('Use British spelling.');
    expect(p).toContain('ch1.tex:9');
    expect(buildSystemPrompt({ toolMode: 'none' })).not.toContain('edit_file');
  });
});
