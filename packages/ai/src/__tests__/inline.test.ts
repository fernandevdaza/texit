import { describe, expect, it } from 'vitest';
import { MockLanguageModelV4, convertArrayToReadableStream } from 'ai/test';
import {
  cleanInlineCompletion,
  createFenceStripper,
  getQuickAction,
  inlineComplete,
  matchSelectionWhitespace,
  quickActions,
  rewriteSelection,
  stripCodeFences,
} from '../inline';
import { usage } from './helpers';

function generateModel(text: string) {
  return new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage,
      warnings: [],
    }),
  });
}

function streamModel(deltas: string[]) {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: convertArrayToReadableStream([
        { type: 'stream-start', warnings: [] },
        { type: 'text-start', id: 't' },
        ...deltas.map((delta) => ({ type: 'text-delta', id: 't', delta })),
        { type: 'text-end', id: 't' },
        { type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage },
      ] as any),
    }),
  });
}

describe('cleanInlineCompletion', () => {
  it('strips fences and an echoed current line', () => {
    const prefix = 'Intro\nThe results show that';
    expect(cleanInlineCompletion('```latex\nThe results show that the model converges.\n```', { prefix, suffix: '\n' })).toBe(' the model converges.');
  });

  it('keeps one line when the cursor is mid-line and trims overlap with the suffix', () => {
    expect(cleanInlineCompletion('bold}\nmore', { prefix: '\\textbf{', suffix: '} rest of line' })).toBe('bold');
  });

  it('stops at paragraph boundaries and maxLines', () => {
    const raw = 'line one\nline two\n\nNew paragraph';
    expect(cleanInlineCompletion(raw, { prefix: 'x\n', suffix: '' })).toBe('line one\nline two');
    expect(cleanInlineCompletion('a\nb\nc\nd', { prefix: '', suffix: '', maxLines: 2 })).toBe('a\nb');
  });

  it('avoids double spaces and empty suggestions', () => {
    expect(cleanInlineCompletion(' world', { prefix: 'hello ', suffix: '' })).toBe('world');
    expect(cleanInlineCompletion('   \n', { prefix: 'a', suffix: '' })).toBe('');
  });

  it('stripCodeFences handles unterminated fences', () => {
    expect(stripCodeFences('```tex\n\\alpha')).toBe('\\alpha');
    expect(stripCodeFences('plain')).toBe('plain');
  });
});

describe('inlineComplete', () => {
  it('sends the cursor-marked document and returns cleaned text', async () => {
    const model = generateModel('```\nequation}\n```');
    const out = await inlineComplete({ model, prefix: '\\begin{', suffix: '\n\\end{equation}', path: 'main.tex' });
    expect(out).toBe('equation}');
    const call = model.doGenerateCalls[0];
    expect(JSON.stringify(call.prompt)).toContain('\\\\begin{<CURSOR/>\\n\\\\end{equation}');
    expect(call.prompt[0]).toMatchObject({ role: 'system' });
  });

  it('returns empty on abort', async () => {
    const ac = new AbortController();
    ac.abort();
    expect(await inlineComplete({ model: generateModel('x'), prefix: 'a', suffix: '', signal: ac.signal })).toBe('');
  });
});

describe('rewriteSelection', () => {
  it('streams the replacement without code fences', async () => {
    const deltas: string[] = [];
    const out = await rewriteSelection({
      model: streamModel(['```la', 'tex\nHello', ' world.\n``', '`\nThis rewrite fixes…']),
      instruction: 'Fix grammar',
      selection: 'Helo wrld.',
      before: 'Intro: ',
      after: '\n',
      onDelta: (d) => deltas.push(d),
    });
    expect(out).toBe('Hello world.');
    expect(deltas.join('')).toBe('Hello world.');
  });

  it('keeps the selection’s surrounding whitespace', async () => {
    const out = await rewriteSelection({ model: streamModel(['New text']), instruction: 'x', selection: '  Old text\n' });
    expect(out).toBe('  New text\n');
  });

  it('includes context and instruction in the prompt', async () => {
    const model = streamModel(['ok']);
    await rewriteSelection({ model, instruction: 'Translate to German', selection: 'Hello', before: 'BEFORE', after: 'AFTER', path: 'a.tex' });
    const prompt = JSON.stringify(model.doStreamCalls[0].prompt);
    expect(prompt).toContain('<selection>\\nHello\\n</selection>');
    expect(prompt).toContain('BEFORE');
    expect(prompt).toContain('AFTER');
    expect(prompt).toContain('Instruction: Translate to German');
  });
});

describe('createFenceStripper / matchSelectionWhitespace', () => {
  it('passes plain text straight through', () => {
    const s = createFenceStripper();
    expect(s.push('Hello ') + s.push('world') + s.flush()).toBe('Hello world');
  });

  it('removes a closing fence at the end of the stream', () => {
    const s = createFenceStripper();
    expect(s.push('```\na\nb\n') + s.push('```') + s.flush()).toBe('a\nb');
  });

  it('matches whitespace', () => {
    expect(matchSelectionWhitespace('x\n\n', 'y')).toBe('y\n\n');
    expect(matchSelectionWhitespace('', 'inserted\n')).toBe('inserted');
  });
});

describe('quickActions', () => {
  it('every action builds a prompt', () => {
    for (const a of quickActions) {
      const prompt = a.buildPrompt({ selection: 'text', params: { language: 'German', description: 'a circle' }, diagnostics: [{ severity: 'error', message: 'Undefined control sequence', file: 'main.tex', line: 2 }] });
      expect(prompt.length).toBeGreaterThan(20);
    }
    expect(new Set(quickActions.map((a) => a.id)).size).toBe(quickActions.length);
    expect(getQuickAction('translate')!.buildPrompt({ params: { language: 'Spanish' } })).toContain('Spanish');
    expect(getQuickAction('fix-error')!.buildPrompt({ diagnostics: [{ severity: 'error', message: 'Missing $', line: 4, file: 'a.tex' }] })).toContain('a.tex:4');
    expect(getQuickAction('tikz')!.mode).toBe('insert');
  });
});
