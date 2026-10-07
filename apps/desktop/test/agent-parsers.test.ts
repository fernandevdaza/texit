import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CliAgentEvent } from '@texit/core';
import { createClaudeParser, createCodexParser, createGeminiParser, createOpencodeParser, createParser, LineSplitter } from '../src/main/agents/parsers';
import type { AgentStreamParser } from '../src/main/agents/parsers';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

function feed(parser: AgentStreamParser, text: string): CliAgentEvent[] {
  const splitter = new LineSplitter();
  const lines = [...splitter.push(text), ...splitter.flush()];
  return lines.flatMap((l) => parser.line(l));
}

const CWD = '/work/project';

describe('LineSplitter', () => {
  it('handles partial lines and CRLF across chunks', () => {
    const s = new LineSplitter();
    expect(s.push('{"a":1}\r\n{"b"')).toEqual(['{"a":1}']);
    expect(s.push(':2}\n\n{"c":3')).toEqual(['{"b":2}', '']);
    expect(s.flush()).toEqual(['{"c":3']);
    expect(s.flush()).toEqual([]);
  });
});

describe('codex exec --json', () => {
  it('parses a real failed run (unsupported model)', () => {
    const p = createCodexParser({ cwd: CWD });
    const events = feed(p, fixture('codex-error.real.jsonl'));
    expect(events[0]).toEqual({ type: 'session', sessionId: '01a116a3-37b8-7a10-88d9-5929d4b1b243' });
    expect(events.filter((e) => e.type === 'stderr').length).toBeGreaterThanOrEqual(3);
    expect(p.error()).toBe("The 'gpt-6-luna' model is not supported when using Codex with a ChatGPT account.");
    expect(p.sessionId()).toBe('01a116a3-37b8-7a10-88d9-5929d4b1b243');
  });

  it('parses a successful run with tools, reasoning, file changes and usage', () => {
    const lines = [
      { type: 'thread.started', thread_id: 't-1' },
      { type: 'turn.started' },
      { type: 'item.completed', item: { id: 'item_0', type: 'reasoning', text: '**Planning** the edit' } },
      { type: 'item.started', item: { id: 'item_1', type: 'command_execution', command: 'bash -lc ls', aggregated_output: '', exit_code: null, status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'bash -lc ls', aggregated_output: 'main.tex\n', exit_code: 0, status: 'completed' } },
      { type: 'item.started', item: { id: 'item_2', type: 'mcp_tool_call', server: 'texit', tool: 'read_file', arguments: { path: 'main.tex' }, status: 'in_progress' } },
      { type: 'item.completed', item: { id: 'item_2', type: 'mcp_tool_call', server: 'texit', tool: 'read_file', arguments: { path: 'main.tex' }, result: { content: [{ type: 'text', text: '\\documentclass{article}' }] }, status: 'completed' } },
      { type: 'item.completed', item: { id: 'item_3', type: 'file_change', changes: [{ path: '/work/project/main.tex', kind: 'update' }, { path: '/work/project/intro.tex', kind: 'add' }, { path: 'old.tex', kind: 'delete' }], status: 'completed' } },
      { type: 'item.completed', item: { id: 'item_4', type: 'agent_message', text: 'Done.' } },
      { type: 'turn.completed', usage: { input_tokens: 1200, cached_input_tokens: 1000, output_tokens: 80 } },
    ];
    const p = createCodexParser({ cwd: CWD });
    const events = feed(p, lines.map((l) => JSON.stringify(l)).join('\n'));
    expect(events).toEqual([
      { type: 'session', sessionId: 't-1' },
      { type: 'reasoning', text: '**Planning** the edit' },
      { type: 'tool', name: 'shell', input: { command: 'bash -lc ls' }, status: 'started' },
      { type: 'tool', name: 'shell', input: { command: 'bash -lc ls' }, output: 'main.tex\n', status: 'completed' },
      { type: 'tool', name: 'texit.read_file', input: { path: 'main.tex' }, status: 'started' },
      { type: 'tool', name: 'texit.read_file', input: { path: 'main.tex' }, output: '\\documentclass{article}', status: 'completed' },
      { type: 'file-change', path: 'main.tex', kind: 'change' },
      { type: 'file-change', path: 'intro.tex', kind: 'add' },
      { type: 'file-change', path: 'old.tex', kind: 'delete' },
      { type: 'text', text: 'Done.' },
      { type: 'usage', inputTokens: 1200, outputTokens: 80 },
    ]);
    expect(p.error()).toBeUndefined();
  });

  it('marks failed commands', () => {
    const p = createCodexParser();
    const [e] = p.line(JSON.stringify({ type: 'item.completed', item: { type: 'command_execution', command: 'false', aggregated_output: '', exit_code: 1, status: 'failed' } }));
    expect(e).toMatchObject({ type: 'tool', name: 'shell', status: 'failed' });
  });
});

describe('claude -p --output-format stream-json', () => {
  it('parses a real auth failure', () => {
    const p = createClaudeParser({ cwd: CWD });
    const events = feed(p, fixture('claude-error.real.jsonl'));
    expect(events[0]).toEqual({ type: 'session', sessionId: 'dd7bfc8b-e1e0-4467-8096-f9e369b6c42c' });
    expect(events.some((e) => e.type === 'text' && /Failed to authenticate/.test(e.text))).toBe(true);
    expect(events.find((e) => e.type === 'usage')).toEqual({ type: 'usage', inputTokens: 0, outputTokens: 0, costUsd: 0 });
    expect(p.error()).toBe('Failed to authenticate: OAuth session expired and could not be refreshed');
  });

  it('parses text, thinking, tool use / results, file edits and the final result', () => {
    const lines = [
      { type: 'system', subtype: 'init', session_id: 's-1', model: 'claude-sonnet', tools: ['Edit'] },
      { type: 'assistant', session_id: 's-1', message: { content: [{ type: 'thinking', thinking: 'Let me look.' }] } },
      { type: 'assistant', session_id: 's-1', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/work/project/main.tex' } }] } },
      { type: 'user', session_id: 's-1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: [{ type: 'text', text: 'file body' }] }] } },
      { type: 'assistant', session_id: 's-1', message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Write', input: { file_path: '/work/project/sec/new.tex', content: 'x' } }] } },
      { type: 'user', session_id: 's-1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'File created' }] }, tool_use_result: { type: 'create', filePath: '/work/project/sec/new.tex' } },
      { type: 'assistant', session_id: 's-1', message: { content: [{ type: 'tool_use', id: 'tu3', name: 'Edit', input: { file_path: '/work/project/main.tex' } }] } },
      { type: 'user', session_id: 's-1', message: { content: [{ type: 'tool_result', tool_use_id: 'tu3', content: 'String not found', is_error: true }] } },
      { type: 'assistant', session_id: 's-1', message: { content: [{ type: 'text', text: 'All set.' }] } },
      { type: 'result', subtype: 'success', is_error: false, session_id: 's-1', result: 'All set.', total_cost_usd: 0.0123, usage: { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 42 } },
    ];
    const p = createClaudeParser({ cwd: CWD });
    const events = feed(p, lines.map((l) => JSON.stringify(l)).join('\n'));
    expect(events).toEqual([
      { type: 'session', sessionId: 's-1' },
      { type: 'reasoning', text: 'Let me look.' },
      { type: 'tool', name: 'Read', input: { file_path: '/work/project/main.tex' }, status: 'started' },
      { type: 'tool', name: 'Read', input: { file_path: '/work/project/main.tex' }, output: 'file body', status: 'completed' },
      { type: 'tool', name: 'Write', input: { file_path: '/work/project/sec/new.tex', content: 'x' }, status: 'started' },
      { type: 'tool', name: 'Write', input: { file_path: '/work/project/sec/new.tex', content: 'x' }, output: 'File created', status: 'completed' },
      { type: 'file-change', path: 'sec/new.tex', kind: 'add' },
      { type: 'tool', name: 'Edit', input: { file_path: '/work/project/main.tex' }, status: 'started' },
      { type: 'tool', name: 'Edit', input: { file_path: '/work/project/main.tex' }, output: 'String not found', status: 'failed' },
      { type: 'text', text: 'All set.' },
      { type: 'usage', inputTokens: 115, outputTokens: 42, costUsd: 0.0123 },
    ]);
    expect(p.error()).toBeUndefined();
  });

  it('reports error results', () => {
    const p = createClaudeParser();
    p.line(JSON.stringify({ type: 'result', subtype: 'error_max_turns', is_error: true, session_id: 's', usage: {} }));
    expect(p.error()).toBe('error_max_turns');
  });
});

describe('gemini -o stream-json', () => {
  it('parses messages, tools and the result', () => {
    const lines = [
      { type: 'init', timestamp: '2026-10-07T00:00:00Z', session_id: 'g-1', model: 'gemini-2.5-pro' },
      { type: 'message', role: 'user', content: 'Fix the typo' },
      { type: 'message', role: 'assistant', content: 'Sure', delta: true },
      { type: 'tool_use', tool_name: 'replace', tool_id: 'r1', parameters: { file_path: '/work/project/main.tex', old_string: 'teh', new_string: 'the' } },
      { type: 'tool_result', tool_id: 'r1', status: 'success', output: 'Replaced 1 occurrence' },
      { type: 'tool_use', tool_name: 'run_shell_command', tool_id: 'r2', parameters: { command: 'latexmk' } },
      { type: 'tool_result', tool_id: 'r2', status: 'error', error: { type: 'denied', message: 'Tool not allowed' } },
      { type: 'error', severity: 'warning', message: 'Loop detected' },
      { type: 'message', role: 'assistant', content: ' — done.', delta: true },
      { type: 'result', status: 'success', stats: { total_tokens: 300, input_tokens: 250, output_tokens: 50, duration_ms: 1234, tool_calls: 2 } },
    ];
    const p = createGeminiParser({ cwd: CWD });
    const events = feed(p, lines.map((l) => JSON.stringify(l)).join('\n'));
    expect(events).toEqual([
      { type: 'session', sessionId: 'g-1' },
      { type: 'text', text: 'Sure' },
      { type: 'tool', name: 'replace', input: { file_path: '/work/project/main.tex', old_string: 'teh', new_string: 'the' }, status: 'started' },
      { type: 'tool', name: 'replace', input: { file_path: '/work/project/main.tex', old_string: 'teh', new_string: 'the' }, output: 'Replaced 1 occurrence', status: 'completed' },
      { type: 'file-change', path: 'main.tex', kind: 'change' },
      { type: 'tool', name: 'run_shell_command', input: { command: 'latexmk' }, status: 'started' },
      { type: 'tool', name: 'run_shell_command', input: { command: 'latexmk' }, output: 'Tool not allowed', status: 'failed' },
      { type: 'stderr', text: 'Loop detected' },
      { type: 'text', text: ' — done.' },
      { type: 'usage', inputTokens: 250, outputTokens: 50 },
    ]);
    expect(p.error()).toBeUndefined();
  });

  it('treats non-JSON lines (auth errors printed by the CLI) as stderr and error results as fatal', () => {
    const p = createGeminiParser();
    expect(p.line('Error authenticating: IneligibleTierError: This client is no longer supported')).toEqual([
      { type: 'stderr', text: 'Error authenticating: IneligibleTierError: This client is no longer supported' },
    ]);
    p.line(JSON.stringify({ type: 'result', status: 'error', error: { type: 'FatalAuthenticationError', message: 'Login required' }, stats: {} }));
    expect(p.error()).toBe('Login required');
  });
});

describe('opencode run --format json', () => {
  it('parses a real API error', () => {
    const p = createOpencodeParser({ cwd: CWD });
    const events = feed(p, fixture('opencode-error.real.jsonl'));
    expect(events[0]).toEqual({ type: 'session', sessionId: 'ses_ee95c2624ffe30cIlJ3PELKxTc' });
    expect(p.error()).toBe('Cannot connect to API: Unable to connect. Is the computer able to access the url?');
  });

  it('parses text, tools and step usage', () => {
    const lines = [
      { type: 'step_start', sessionID: 'ses_1', part: { type: 'step-start' } },
      { type: 'tool_use', sessionID: 'ses_1', part: { type: 'tool', tool: 'edit', callID: 'c1', state: { status: 'completed', input: { filePath: '/work/project/main.tex' }, output: 'ok' } } },
      { type: 'text', sessionID: 'ses_1', part: { type: 'text', text: 'Edited.' } },
      { type: 'step_finish', sessionID: 'ses_1', part: { type: 'step-finish', tokens: { input: 900, output: 30, reasoning: 0 }, cost: 0.001 } },
    ];
    const events = feed(createOpencodeParser({ cwd: CWD }), lines.map((l) => JSON.stringify(l)).join('\n'));
    expect(events).toEqual([
      { type: 'session', sessionId: 'ses_1' },
      { type: 'tool', name: 'edit', input: { filePath: '/work/project/main.tex' }, output: 'ok', status: 'completed' },
      { type: 'file-change', path: 'main.tex', kind: 'change' },
      { type: 'text', text: 'Edited.' },
      { type: 'usage', inputTokens: 900, outputTokens: 30, costUsd: 0.001 },
    ]);
  });
});

describe('createParser', () => {
  it('falls back to plain text for aider', () => {
    expect(createParser('aider').line('Applied edit to main.tex')).toEqual([{ type: 'text', text: 'Applied edit to main.tex\n' }]);
    expect(createParser('qwen').line(JSON.stringify({ type: 'init', session_id: 'q' }))).toEqual([{ type: 'session', sessionId: 'q' }]);
  });
});
