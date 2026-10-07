import { describe, expect, it, vi } from 'vitest';
import type { CliAgentEvent, CliAgentRunRequest, HostAgents } from '@texit/core';
import { buildCliPrompt, createCliEventAdapter, runCliAgent } from '../cli';
import type { AgentEvent } from '../types';

function fakeHost(script: (req: CliAgentRunRequest, emit: (e: CliAgentEvent) => void) => Promise<{ exitCode: number }>) {
  const agents: HostAgents = {
    detect: vi.fn(async () => []),
    run: vi.fn((req, onEvent) => script(req, onEvent)),
    cancel: vi.fn(async () => {}),
  };
  return { agents };
}

describe('CLI event adaptation', () => {
  it('maps host events to AgentEvents', () => {
    const events: AgentEvent[] = [];
    const a = createCliEventAdapter((e) => events.push(e));
    a.handle({ type: 'session', sessionId: 's-1' });
    a.handle({ type: 'reasoning', text: 'planning' });
    a.handle({ type: 'text', text: 'I will edit' });
    a.handle({ type: 'tool', name: 'Edit', input: { file: 'main.tex' }, status: 'started' });
    a.handle({ type: 'file-change', path: 'main.tex', kind: 'change' });
    a.handle({ type: 'tool', name: 'Edit', output: 'ok', status: 'completed' });
    a.handle({ type: 'tool', name: 'Bash', output: 'boom', status: 'failed' }); // no matching start
    a.handle({ type: 'text', text: 'Done.' });
    a.handle({ type: 'file-change', path: 'new.tex', kind: 'add' });
    a.handle({ type: 'stderr', text: 'warning: x' });
    a.handle({ type: 'usage', inputTokens: 100, outputTokens: 20, costUsd: 0.01 });
    a.handle({ type: 'tool', name: 'Read', status: 'started' }); // never completes
    a.handle({ type: 'done', exitCode: 0 });
    const seen = a.finish();

    expect(events).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'reasoning-delta', text: 'planning' },
      { type: 'text-delta', text: 'I will edit' },
      { type: 'tool-call', id: 'cli-tool-1', name: 'Edit', input: { file: 'main.tex' } },
      { type: 'file-edit', path: 'main.tex', status: 'applied', op: 'edit' },
      { type: 'tool-result', id: 'cli-tool-1', name: 'Edit', output: 'ok' },
      { type: 'tool-call', id: 'cli-tool-2', name: 'Bash', input: {} },
      { type: 'tool-result', id: 'cli-tool-2', name: 'Bash', output: 'boom', isError: true },
      { type: 'text-delta', text: '\n\nDone.' },
      { type: 'file-edit', path: 'new.tex', status: 'applied', op: 'create' },
      { type: 'log', text: 'warning: x' },
      { type: 'usage', inputTokens: 100, outputTokens: 20, costUsd: 0.01 },
      { type: 'tool-call', id: 'cli-tool-3', name: 'Read', input: {} },
      { type: 'tool-result', id: 'cli-tool-3', name: 'Read', output: 'Interrupted before completion.', isError: true },
    ]);
    expect(seen).toMatchObject({ sessionId: 's-1', exitCode: 0, text: 'I will edit\n\nDone.', changedFiles: ['main.tex', 'new.tex'] });
  });

  it('does not split streamed text deltas', () => {
    const events: AgentEvent[] = [];
    const a = createCliEventAdapter((e) => events.push(e));
    a.handle({ type: 'text', text: 'Hel' });
    a.handle({ type: 'text', text: 'lo' });
    expect(a.finish().text).toBe('Hello');
  });
});

describe('runCliAgent', () => {
  it('runs through the host and finishes with done', async () => {
    const host = fakeHost(async (req, emit) => {
      emit({ type: 'session', sessionId: 'abc' });
      emit({ type: 'text', text: 'ok' });
      emit({ type: 'done', exitCode: 0 });
      return { exitCode: 0 };
    });
    const events: AgentEvent[] = [];
    const res = await runCliAgent(host, { agent: 'claude', prompt: 'p', cwd: '/tmp/proj', model: 'sonnet', autoApprove: true, runId: 'r1', onEvent: (e) => events.push(e) });
    expect(host.agents.run).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'r1', agent: 'claude', prompt: 'p', cwd: '/tmp/proj', model: 'sonnet', autoApprove: true }),
      expect.any(Function),
    );
    expect(res).toMatchObject({ exitCode: 0, finishReason: 'stop', sessionId: 'abc', text: 'ok' });
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'stop' });
  });

  it('reports non-zero exits and host failures as errors', async () => {
    const events: AgentEvent[] = [];
    const res = await runCliAgent(
      fakeHost(async (_r, emit) => {
        emit({ type: 'done', exitCode: 2, error: 'not logged in' });
        return { exitCode: 2 };
      }),
      { agent: 'codex', prompt: 'p', cwd: '/x', onEvent: (e) => events.push(e) },
    );
    expect(res.finishReason).toBe('error');
    expect(events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', message: 'not logged in' }]);

    const events2: AgentEvent[] = [];
    const res2 = await runCliAgent(fakeHost(async () => { throw new Error('codex: command not found'); }), { agent: 'codex', prompt: 'p', cwd: '/x', onEvent: (e) => events2.push(e) });
    expect(res2.error).toContain('command not found');
    expect(events2.map((e) => e.type)).toEqual(['error', 'done']);

    const res3 = await runCliAgent(fakeHost(async () => ({ exitCode: 1 })), { agent: 'gemini', prompt: 'p', cwd: '/x', onEvent: () => {} });
    expect(res3.error).toBe('Gemini CLI exited with code 1.');
  });

  it('cancels the host run on abort', async () => {
    const ac = new AbortController();
    let finish!: (v: { exitCode: number }) => void;
    const host = fakeHost((_req, emit) => {
      emit({ type: 'text', text: 'working' });
      return new Promise((r) => (finish = r));
    });
    host.agents.cancel = vi.fn(async () => finish({ exitCode: 130 }));
    const events: AgentEvent[] = [];
    const p = runCliAgent(host, { agent: 'claude', prompt: 'p', cwd: '/x', runId: 'run-9', signal: ac.signal, onEvent: (e) => events.push(e) });
    await Promise.resolve();
    ac.abort();
    const res = await p;
    expect(host.agents.cancel).toHaveBeenCalledWith('run-9');
    expect(res.finishReason).toBe('aborted');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events[events.length - 1]).toEqual({ type: 'done', reason: 'aborted' });
  });
});

describe('buildCliPrompt', () => {
  it('injects guidelines, context and the request', () => {
    const p = buildCliPrompt({
      request: 'Shorten the abstract',
      projectName: 'Paper',
      mainPath: 'main.tex',
      activeFile: { path: 'abstract.tex', selection: { text: 'We present…', line: 3 } },
      diagnostics: [{ severity: 'error', message: 'Missing } inserted', file: 'abstract.tex', line: 7 }],
      texitMcpServerName: 'texit',
      customInstructions: 'American spelling.',
    });
    expect(p).toContain('"Paper"');
    expect(p).toContain('`main.tex`');
    expect(p).toMatch(/no `rm -rf`/);
    expect(p).toContain('"texit" MCP server');
    expect(p).toContain('We present…');
    expect(p).toContain('abstract.tex:7');
    expect(p).toContain('American spelling.');
    expect(p.trim().endsWith('## Request\nShorten the abstract')).toBe(true);
    const cont = buildCliPrompt({ request: 'and the intro', includeGuidelines: false });
    expect(cont).toBe('## Request\nand the intro');
  });
});
