import { describe, expect, it, vi } from 'vitest';
import type { ToolSet } from 'ai';
import { runAgent } from '../agent';
import { createInMemoryProjectContext } from '../memory-context';
import { callProjectToolDef, createProjectToolDefs, createProjectTools, pluginToolsToAiTools, sanitizeToolName } from '../tools';
import type { AgentEvent } from '../types';
import { collect, scriptedModel, textStep, toolResultsInPrompt, toolStep } from './helpers';

const MAIN = ['\\documentclass{article}', '\\begin{document}', '\\section{Intro}', '  Some text.', 'Repeat me.', 'Repeat me.', '\\end{document}', ''].join('\n');

async function exec(tools: ToolSet, name: string, input: unknown, toolCallId = 'call-1'): Promise<string> {
  return (tools[name] as any).execute(input, { toolCallId, messages: [], context: undefined });
}

function setup(files: Record<string, string> = { 'main.tex': MAIN }, extra: Parameters<typeof createInMemoryProjectContext>[1] = {}) {
  const ctx = createInMemoryProjectContext(files, extra);
  const events: AgentEvent[] = [];
  const tools = createProjectTools(ctx, { autoApply: true, onEvent: (e) => events.push(e) });
  return { ctx, tools, events };
}

describe('edit_file', () => {
  it('replaces a unique exact match and reports the location', async () => {
    const { ctx, tools, events } = setup();
    const out = await exec(tools, 'edit_file', { path: 'main.tex', search: '\\section{Intro}', replace: '\\section{Introduction}' });
    expect(out).toContain('replaced 1 occurrence at line 3');
    expect(out).toContain('\\section{Introduction}');
    expect(ctx.files.get('main.tex')).toContain('\\section{Introduction}');
    expect(events).toEqual([
      expect.objectContaining({ type: 'file-edit', status: 'applied', path: 'main.tex', op: 'edit', toolCallId: 'call-1', before: MAIN }),
    ]);
  });

  it('normalises paths', async () => {
    const { ctx, tools } = setup();
    await exec(tools, 'edit_file', { path: './main.tex', search: 'Some text.', replace: 'More text.' });
    expect(ctx.files.get('main.tex')).toContain('More text.');
  });

  it('rejects ambiguous matches with line numbers', async () => {
    const { ctx, tools } = setup();
    await expect(exec(tools, 'edit_file', { path: 'main.tex', search: 'Repeat me.', replace: 'x' })).rejects.toThrow(/occurs 2 times.*lines 5, 6/);
    expect(ctx.files.get('main.tex')).toBe(MAIN);
  });

  it('supports replaceAll', async () => {
    const { ctx, tools } = setup();
    const out = await exec(tools, 'edit_file', { path: 'main.tex', search: 'Repeat me.', replace: 'Done.', replaceAll: true });
    expect(out).toContain('2 occurrences');
    expect(ctx.files.get('main.tex')!.match(/Done\./g)).toHaveLength(2);
  });

  it('explains whitespace-only mismatches', async () => {
    const { tools } = setup();
    const err = await exec(tools, 'edit_file', { path: 'main.tex', search: 'Some text.\n  Repeat me.', replace: 'x' }).catch((e) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain('not found');
    expect((err as Error).message).toContain('except for whitespace/indentation exists at lines 4-5');
    expect((err as Error).message).toContain('  Some text.\nRepeat me.');
  });

  it('points at a near match when later lines differ', async () => {
    const { tools } = setup();
    await expect(exec(tools, 'edit_file', { path: 'main.tex', search: '\\section{Intro}\nOther text.', replace: 'x' })).rejects.toThrow(/occurs at line 3, but the following lines differ/);
  });

  it('detects copied line-number prefixes', async () => {
    const { tools } = setup();
    await expect(exec(tools, 'edit_file', { path: 'main.tex', search: '   3\t\\section{Intro}', replace: 'x' })).rejects.toThrow(/line-number prefixes/);
  });

  it('tolerates CRLF files', async () => {
    const { ctx, tools } = setup({ 'a.tex': 'one\r\ntwo\r\nthree\r\n' });
    await exec(tools, 'edit_file', { path: 'a.tex', search: 'one\ntwo', replace: 'uno\ndos' });
    expect(ctx.files.get('a.tex')).toBe('uno\r\ndos\r\nthree\r\n');
  });

  it('suggests similar paths for missing files', async () => {
    const { tools } = setup({ 'chapters/intro.tex': 'x' });
    await expect(exec(tools, 'edit_file', { path: 'intro.tex', search: 'x', replace: 'y' })).rejects.toThrow(/File not found: intro\.tex\. Did you mean: chapters\/intro\.tex/);
  });

  it('refuses no-op edits', async () => {
    const { tools } = setup();
    await expect(exec(tools, 'edit_file', { path: 'main.tex', search: 'Some', replace: 'Some' })).rejects.toThrow(/identical/);
  });
});

describe('other project tools', () => {
  it('read_file numbers lines and supports ranges', async () => {
    const { tools } = setup();
    const all = await exec(tools, 'read_file', { path: 'main.tex' });
    expect(all).toContain('main.tex (8 lines)');
    expect(all).toContain('   3\t\\section{Intro}');
    const part = await exec(tools, 'read_file', { path: 'main.tex', startLine: 4, endLine: 5 });
    expect(part).toContain('(lines 4-5 of 8)');
    expect(part).not.toContain('\\section');
  });

  it('list_files marks the main file; search_project finds lines', async () => {
    const { tools } = setup({ 'main.tex': MAIN, 'refs.bib': '@book{knuth84,}' });
    expect(await exec(tools, 'list_files', {})).toMatch(/main\.tex \(.*\) \[main\]/);
    expect(await exec(tools, 'search_project', { query: 'knuth' })).toContain('refs.bib:1: @book{knuth84,}');
    expect(await exec(tools, 'search_project', { query: 'zzz' })).toContain('No matches');
    await expect(exec(tools, 'search_project', { query: '(', regex: true })).rejects.toThrow(/Invalid regular expression/);
  });

  it('create/write/rename/delete', async () => {
    const { ctx, tools, events } = setup();
    await expect(exec(tools, 'create_file', { path: 'main.tex', content: 'x' })).rejects.toThrow(/already exists/);
    await exec(tools, 'create_file', { path: 'ch1.tex', content: 'Chapter' });
    await exec(tools, 'write_file', { path: 'ch1.tex', content: 'Chapter 1' });
    await exec(tools, 'rename_file', { from: 'ch1.tex', to: 'chapters/ch1.tex' });
    expect(ctx.files.get('chapters/ch1.tex')).toBe('Chapter 1');
    await exec(tools, 'delete_file', { path: 'chapters/ch1.tex' });
    expect(ctx.files.has('chapters/ch1.tex')).toBe(false);
    expect(events.map((e) => (e.type === 'file-edit' ? e.op : ''))).toEqual(['create', 'edit', 'rename', 'delete']);
  });

  it('compile and diagnostics are summarised', async () => {
    const { tools } = setup(
      { 'main.tex': MAIN },
      {
        compile: async () => ({
          status: 'error',
          diagnostics: [
            { severity: 'warning', message: 'Citation undefined', file: 'main.tex', line: 2 },
            { severity: 'error', message: 'Undefined control sequence', file: 'main.tex', line: 4, context: 'l.4 \\foo' },
          ],
          logTail: 'line a\nline b\n! Emergency stop.',
        }),
      },
    );
    const out = await exec(tools, 'compile', {});
    expect(out).toContain('Status: error');
    expect(out.indexOf('Undefined control sequence')).toBeLessThan(out.indexOf('Citation undefined'));
    expect(out).toContain('error main.tex:4');
    expect(out).toContain('! Emergency stop.');
    expect(await exec(tools, 'get_diagnostics', {})).toContain('1 error, 1 warning');
  });

  it('include restricts the tool set', () => {
    const ctx = createInMemoryProjectContext({});
    const tools = createProjectTools(ctx, { autoApply: true, include: ['read_file', 'list_files'] });
    expect(Object.keys(tools).sort()).toEqual(['list_files', 'read_file']);
  });
});

describe('review flow (autoApply: false)', () => {
  it('rejected edits leave the file untouched and tell the model', async () => {
    const reviewEdit = vi.fn(async () => false);
    const ctx = createInMemoryProjectContext({ 'main.tex': MAIN }, { reviewEdit });
    const events: AgentEvent[] = [];
    const tools = createProjectTools(ctx, { autoApply: false, onEvent: (e) => events.push(e) });
    const out = await exec(tools, 'edit_file', { path: 'main.tex', search: 'Some text.', replace: 'Other text.' });
    expect(out).toMatch(/^REJECTED/);
    expect(ctx.files.get('main.tex')).toBe(MAIN);
    expect(reviewEdit).toHaveBeenCalledWith('main.tex', MAIN, MAIN.replace('Some text.', 'Other text.'));
    expect(events.map((e) => (e.type === 'file-edit' ? e.status : e.type))).toEqual(['proposed', 'rejected']);
  });

  it('accepted edits are applied after review', async () => {
    const ctx = createInMemoryProjectContext({ 'main.tex': MAIN }, { reviewEdit: async () => true });
    const events: AgentEvent[] = [];
    const tools = createProjectTools(ctx, { autoApply: false, onEvent: (e) => events.push(e) });
    await exec(tools, 'edit_file', { path: 'main.tex', search: 'Some text.', replace: 'Other text.' });
    expect(ctx.files.get('main.tex')).toContain('Other text.');
    expect(events.map((e) => (e.type === 'file-edit' ? e.status : e.type))).toEqual(['proposed', 'applied']);
  });

  it('delete uses confirmAction when provided', async () => {
    const confirmAction = vi.fn(async () => false);
    const ctx = createInMemoryProjectContext({ 'a.tex': 'x' }, { confirmAction, reviewEdit: async () => true });
    const tools = createProjectTools(ctx, { autoApply: false });
    expect(await exec(tools, 'delete_file', { path: 'a.tex' })).toMatch(/^REJECTED/);
    expect(confirmAction).toHaveBeenCalledWith({ kind: 'delete', path: 'a.tex', newPath: undefined });
    expect(ctx.files.has('a.tex')).toBe(true);
  });

  it('a pending review resolves as rejected when the run is aborted', async () => {
    const ctx = createInMemoryProjectContext({ 'main.tex': MAIN }, { reviewEdit: () => new Promise<boolean>(() => {}) });
    const tools = createProjectTools(ctx, { autoApply: false });
    const ac = new AbortController();
    const p = (tools.edit_file as any).execute({ path: 'main.tex', search: 'Some', replace: 'Any' }, { toolCallId: 'x', messages: [], abortSignal: ac.signal });
    ac.abort();
    expect(await p).toMatch(/^REJECTED/);
    expect(ctx.files.get('main.tex')).toBe(MAIN);
  });

  it('the rejection reaches the model inside the agent loop', async () => {
    const ctx = createInMemoryProjectContext({ 'main.tex': MAIN }, { reviewEdit: async () => false });
    const { events, onEvent } = collect();
    const model = scriptedModel([
      toolStep([{ id: 'c1', name: 'edit_file', input: { path: 'main.tex', search: 'Some text.', replace: 'Better text.' } }]),
      textStep('Okay, what would you prefer?'),
    ]);
    await runAgent({ model, messages: [{ id: 'u', role: 'user', parts: [{ type: 'text', text: 'improve' }], createdAt: 0 }], tools: createProjectTools(ctx, { autoApply: false, onEvent }), onEvent });
    expect(toolResultsInPrompt(model.doStreamCalls[1].prompt as any[])[0]).toMatch(/^REJECTED/);
    const statuses = events.filter((e) => e.type === 'file-edit').map((e) => (e as { status: string }).status);
    expect(statuses).toEqual(['proposed', 'rejected']);
    expect(ctx.files.get('main.tex')).toBe(MAIN);
  });
});

describe('transport-neutral tool defs', () => {
  it('exposes JSON schemas and validates arguments', async () => {
    const ctx = createInMemoryProjectContext({ 'main.tex': MAIN });
    const defs = createProjectToolDefs(ctx);
    const edit = defs.find((d) => d.name === 'edit_file')!;
    expect(edit.inputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['path', 'search', 'replace']) });
    expect(edit.inputSchema.$schema).toBeUndefined();
    expect(defs.find((d) => d.name === 'list_files')!.inputSchema).toMatchObject({ type: 'object', properties: expect.any(Object) });
    await expect(edit.execute({ search: 'x' })).rejects.toThrow(/Invalid arguments for edit_file: path/);

    const ok = await callProjectToolDef(defs, 'edit_file', { path: 'main.tex', search: 'Some text.', replace: 'Via MCP.' });
    expect(ok.isError).toBeUndefined();
    expect(ctx.files.get('main.tex')).toContain('Via MCP.');
    const bad = await callProjectToolDef(defs, 'read_file', { path: 'missing.tex' });
    expect(bad).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('File not found') }] });
    expect(await callProjectToolDef(defs, 'nope', {})).toMatchObject({ isError: true });
  });
});

describe('plugin tools', () => {
  it('converts AIToolDef into AI SDK tools', async () => {
    const tools = pluginToolsToAiTools([
      { name: 'word count', description: 'Count words', inputSchema: { type: 'object', properties: { text: { type: 'string' } } }, execute: ({ text }) => ({ words: String(text).split(/\s+/).length }) },
      { name: 'ping', description: 'Ping', inputSchema: {}, execute: () => 'pong' },
    ]);
    expect(Object.keys(tools)).toEqual(['word_count', 'ping']);
    expect(await exec(tools, 'word_count', { text: 'a b c' })).toContain('"words": 3');
    expect(await exec(tools, 'ping', {})).toBe('pong');
  });

  it('sanitizes long names', () => {
    const n = sanitizeToolName('x'.repeat(100));
    expect(n.length).toBeLessThanOrEqual(64);
    expect(sanitizeToolName('a.b/c')).toBe('a_b_c');
  });
});
