/**
 * Inline AI: ghost-text completion, selection rewriting, and the quick-actions catalog.
 */
import { generateText, streamText, type LanguageModel } from 'ai';
import type { Diagnostic } from '@texit/core';
import { describeError } from './providers';
import { formatDiagnostics } from './tools';

const CURSOR = '<CURSOR/>';

function providerOf(model: LanguageModel): string {
  return typeof model === 'string' ? 'gateway' : (model.provider ?? '');
}

/** Claude models whose thinking cannot be turned off need room for it in the output budget. */
function alwaysThinks(model: LanguageModel): boolean {
  return typeof model !== 'string' && providerOf(model).startsWith('anthropic') && /claude-(?:opus-5-5|fable|mythos)/.test(model.modelId ?? '');
}

/** Minimise reasoning on providers whose SDK maps it per model (others may reject the field). */
function lowLatencyReasoning(model: LanguageModel): 'none' | undefined {
  const p = providerOf(model);
  return p.startsWith('anthropic') || p.startsWith('openai.') || p.startsWith('google') ? 'none' : undefined;
}

// ─────────────────────────── Ghost-text completion ───────────────────────────

export interface InlineCompleteOptions {
  model: LanguageModel;
  /** Text before the cursor (the tail is used). */
  prefix: string;
  /** Text after the cursor (the head is used). */
  suffix: string;
  path?: string;
  signal?: AbortSignal;
  /** Maximum lines of the suggestion when the cursor is at the end of a line. Default 3. */
  maxLines?: number;
  maxOutputTokens?: number;
  /** Characters of context before / after the cursor. Defaults 4000 / 1500. */
  prefixChars?: number;
  suffixChars?: number;
}

const INLINE_SYSTEM = `You are the inline autocomplete engine of a LaTeX editor. You receive a document with the cursor marked as ${CURSOR}. Output ONLY the text to insert at the cursor — no explanations, no code fences, and never repeat text that is already before or after the cursor.
- Continue naturally: finish the current word, command, line or sentence. Keep it short — usually a few words up to one sentence, at most a few lines.
- Match the document's language, tone, spelling and indentation.
- Produce valid LaTeX: close braces and environments you open, unless they are already closed after the cursor.
- Reuse only labels, citation keys and macros that appear in the document; never invent them.
- If nothing useful can be added, output nothing.`;

/** Build the user prompt for a ghost-text completion. */
export function buildInlinePrompt(opts: Pick<InlineCompleteOptions, 'prefix' | 'suffix' | 'path' | 'prefixChars' | 'suffixChars'>): string {
  const before = opts.prefix.slice(-(opts.prefixChars ?? 4000));
  const after = opts.suffix.slice(0, opts.suffixChars ?? 1500);
  return `<document${opts.path ? ` path="${opts.path}"` : ''}>\n${before}${CURSOR}${after}\n</document>\n\nWrite only the text to insert at ${CURSOR}.`;
}

/** Strip a surrounding ``` fence (with optional language) from a model answer. */
export function stripCodeFences(text: string): string {
  const m = /^\s*```[\w+-]*[^\S\n]*\n([\s\S]*?)\n?```\s*$/.exec(text);
  if (m) return m[1];
  // Opening fence without a closing one (truncated output).
  const open = /^\s*```[\w+-]*[^\S\n]*\n([\s\S]*)$/.exec(text);
  return open ? open[1] : text;
}

/**
 * Clean a raw ghost-text answer: strip fences / cursor markers, remove echoed text before the
 * cursor and overlap with the text after it, and stop at sensible boundaries.
 */
export function cleanInlineCompletion(raw: string, ctx: { prefix: string; suffix: string; maxLines?: number }): string {
  let text = stripCodeFences(raw).replace(CURSOR, '');
  const linePrefix = ctx.prefix.slice(ctx.prefix.lastIndexOf('\n') + 1);
  const nl = ctx.suffix.indexOf('\n');
  const lineSuffix = nl === -1 ? ctx.suffix : ctx.suffix.slice(0, nl);

  // Echo of the current line (or of a longer tail of the prefix).
  if (linePrefix.trim().length >= 3) {
    if (text.startsWith(linePrefix)) text = text.slice(linePrefix.length);
    else if (text.startsWith(linePrefix.trimStart()) && linePrefix.trimStart() !== linePrefix) text = text.slice(linePrefix.trimStart().length);
  }
  const tail = ctx.prefix.slice(-200);
  for (let k = Math.min(tail.length, text.length); k >= 12; k--) {
    if (text.startsWith(tail.slice(-k))) {
      text = text.slice(k);
      break;
    }
  }
  // Avoid doubled spaces at the junction.
  if (/[ \t]$/.test(ctx.prefix) && /^[ \t]/.test(text)) text = text.replace(/^[ \t]+/, '');

  // Boundaries.
  const midLine = lineSuffix.trim().length > 0;
  if (midLine) {
    text = text.split('\n')[0];
  } else {
    const leadingNl = /^\n?/.exec(text)![0];
    let body = text.slice(leadingNl.length);
    const para = body.search(/\n[ \t]*\n/);
    if (para !== -1) body = body.slice(0, para);
    const maxLines = Math.max(1, ctx.maxLines ?? 3);
    body = body.split('\n').slice(0, maxLines).join('\n');
    text = leadingNl + body;
  }
  const endDoc = text.indexOf('\\end{document}');
  if (endDoc !== -1 && ctx.suffix.includes('\\end{document}')) text = text.slice(0, endDoc);

  // Overlap with the text right after the cursor (e.g. a closing brace that already exists).
  const head = ctx.suffix.slice(0, 200);
  for (let k = Math.min(head.length, text.length); k >= 1; k--) {
    const overlap = head.slice(0, k);
    if (overlap.trim() && text.endsWith(overlap)) {
      text = text.slice(0, text.length - k);
      break;
    }
  }
  text = text.replace(/[ \t]+$/g, '').replace(/\n+$/, '');
  return text.trim() ? text : '';
}

/**
 * Ghost-text completion at the cursor. Returns '' when there is nothing useful (or on abort).
 * Throws on provider errors (the caller usually ignores them silently).
 */
export async function inlineComplete(opts: InlineCompleteOptions): Promise<string> {
  if (opts.signal?.aborted) return '';
  try {
    const { text } = await generateText({
      model: opts.model,
      instructions: INLINE_SYSTEM,
      prompt: buildInlinePrompt(opts),
      maxOutputTokens: opts.maxOutputTokens ?? (alwaysThinks(opts.model) ? 2048 : 160),
      temperature: 0.2,
      reasoning: lowLatencyReasoning(opts.model),
      abortSignal: opts.signal,
      maxRetries: 0,
    });
    return cleanInlineCompletion(text, { prefix: opts.prefix, suffix: opts.suffix, maxLines: opts.maxLines });
  } catch (err) {
    if (opts.signal?.aborted || (err as Error)?.name === 'AbortError') return '';
    throw new Error(describeError(err).message);
  }
}

// ─────────────────────────── One-shot completion ───────────────────────────

/** Plain one-shot text generation (plugins' `ai.complete`, titles, summaries). */
export async function completeText(opts: {
  model: LanguageModel;
  prompt: string;
  system?: string;
  signal?: AbortSignal;
  maxOutputTokens?: number;
}): Promise<string> {
  try {
    const { text } = await generateText({
      model: opts.model,
      instructions: opts.system,
      prompt: opts.prompt,
      maxOutputTokens: opts.maxOutputTokens,
      abortSignal: opts.signal,
    });
    return text;
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw err;
    throw new Error(describeError(err).message);
  }
}

// ─────────────────────────── Selection rewriting ───────────────────────────

export interface RewriteSelectionOptions {
  model: LanguageModel;
  /** What to do (see `quickActions` for ready-made instructions). */
  instruction: string;
  /** Selected text; empty string → generate text to insert at the cursor. */
  selection: string;
  /** Text before / after the selection (context only). */
  before?: string;
  after?: string;
  path?: string;
  signal?: AbortSignal;
  /** Streaming preview: called with each cleaned delta and the text so far. */
  onDelta?: (delta: string, textSoFar: string) => void;
  maxOutputTokens?: number;
}

const REWRITE_SYSTEM = `You are the editing engine of TexIt, a LaTeX editor. You rewrite the user's selected text (or write text to insert at the cursor) according to an instruction.
Output ONLY the replacement text — no explanations, no code fences, no text from before or after the selection.
- Keep valid LaTeX. Preserve commands, labels, references, citations, math and environments unless the instruction asks to change them.
- Keep the document's language unless asked to translate; match the surrounding style, tone and indentation.
- Never invent citation keys, labels, packages, data or facts.`;

export function buildRewritePrompt(opts: Pick<RewriteSelectionOptions, 'instruction' | 'selection' | 'before' | 'after' | 'path'>): string {
  const before = (opts.before ?? '').slice(-2500);
  const after = (opts.after ?? '').slice(0, 1500);
  const parts = [opts.path ? `File: ${opts.path}` : ''];
  if (before) parts.push(`Text before (context only, do not repeat):\n<before>\n${before}\n</before>`);
  parts.push(
    opts.selection
      ? `Selected text to rewrite:\n<selection>\n${opts.selection}\n</selection>`
      : 'There is no selection: write the text to insert at the cursor (between <before> and <after>).',
  );
  if (after) parts.push(`Text after (context only, do not repeat):\n<after>\n${after}\n</after>`);
  parts.push(`Instruction: ${opts.instruction.trim()}`);
  return parts.filter(Boolean).join('\n\n');
}

/** Incremental remover of a surrounding ``` fence for streamed output. */
export function createFenceStripper(): { push(chunk: string): string; flush(): string } {
  let decided = false;
  let opened = false;
  let closed = false;
  let pending = '';
  return {
    push(chunk) {
      if (closed) return '';
      pending += chunk;
      if (!decided) {
        const t = pending.replace(/^\s+/, '');
        if (t.length < 3 && '```'.startsWith(t)) return '';
        if (t.startsWith('```')) {
          const nl = t.indexOf('\n');
          if (nl === -1) return '';
          pending = t.slice(nl + 1);
          opened = true;
        }
        decided = true;
      }
      if (!opened) {
        const out = pending;
        pending = '';
        return out;
      }
      const close = /(^|\n)```[^\S\n]*(\n|$)/.exec(pending);
      if (close && close[2] === '\n') {
        const out = pending.slice(0, close.index);
        pending = '';
        closed = true;
        return out;
      }
      // Hold back a trailing line that might become the closing fence.
      const lastNl = pending.lastIndexOf('\n');
      const tailLine = pending.slice(lastNl + 1);
      const hold = '```'.startsWith(tailLine.trim()) || /^```[^\S\n]*$/.test(tailLine);
      const cut = hold ? Math.max(0, lastNl) : pending.length;
      const out = pending.slice(0, cut);
      pending = pending.slice(cut);
      return out;
    },
    flush() {
      if (closed) return '';
      let out = pending;
      pending = '';
      if (opened) out = out.replace(/\n?```[^\S\n]*$/, '');
      if (!decided) out = out.trim().startsWith('```') ? '' : out;
      return out;
    },
  };
}

/** Make the replacement's leading/trailing whitespace match the original selection. */
export function matchSelectionWhitespace(selection: string, text: string): string {
  if (!selection) return text.replace(/\n+$/, '');
  let out = text;
  const lead = /^\s*/.exec(selection)![0];
  if (lead && !out.startsWith(lead)) out = lead + out.replace(/^\s+/, '');
  const trailNl = /\n*$/.exec(selection)![0];
  out = out.replace(/\n+$/, '') + trailNl;
  return out;
}

/**
 * Rewrite the selection (or generate an insertion) and stream the replacement text.
 * Resolves with the final cleaned replacement (authoritative; deltas are for preview).
 * Rejects on provider errors; resolves with the partial text on abort.
 */
export async function rewriteSelection(opts: RewriteSelectionOptions): Promise<string> {
  const stripper = createFenceStripper();
  let shown = '';
  const push = (delta: string) => {
    if (!delta) return;
    shown += delta;
    try {
      opts.onDelta?.(delta, shown);
    } catch {
      /* ignore */
    }
  };
  let streamError: unknown;
  try {
    const result = streamText({
      model: opts.model,
      instructions: REWRITE_SYSTEM,
      prompt: buildRewritePrompt(opts),
      maxOutputTokens: opts.maxOutputTokens,
      reasoning: lowLatencyReasoning(opts.model),
      abortSignal: opts.signal,
      onError: () => {},
    });
    for await (const part of result.stream) {
      if (part.type === 'text-delta') push(stripper.push(part.text));
      else if (part.type === 'error' && !streamError) streamError = part.error;
    }
  } catch (err) {
    if (!(opts.signal?.aborted || (err as Error)?.name === 'AbortError')) streamError = err;
  }
  push(stripper.flush());
  if (streamError && !opts.signal?.aborted) throw new Error(describeError(streamError).message);
  return matchSelectionWhitespace(opts.selection, shown);
}

// ─────────────────────────── Quick actions ───────────────────────────

export interface QuickActionParam {
  name: string;
  label: string;
  placeholder?: string;
  /** Preset choices (free text allowed when absent). */
  options?: string[];
  default?: string;
}

export interface QuickActionInput {
  selection?: string;
  path?: string;
  /** Values for the action's params (e.g. `{ language: 'German' }`). */
  params?: Record<string, string>;
  diagnostics?: Diagnostic[];
}

export interface QuickAction {
  id: string;
  label: string;
  description: string;
  group: 'edit' | 'transform' | 'generate' | 'explain';
  /**
   * 'rewrite': replace the selection via `rewriteSelection(buildPrompt(...))`.
   * 'insert': insert at the cursor via `rewriteSelection({ selection: '' })`.
   * 'chat': send `buildPrompt(...)` as a chat message to the agent (attach selection/diagnostics).
   */
  mode: 'rewrite' | 'insert' | 'chat';
  needsSelection: boolean;
  /** True when the action is about compile diagnostics. */
  usesDiagnostics?: boolean;
  params?: QuickActionParam[];
  buildPrompt(input: QuickActionInput): string;
}

const LANGUAGES = ['English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Chinese', 'Japanese', 'Korean', 'Russian', 'Arabic'];

function diagText(d?: Diagnostic[]): string {
  return d?.length ? `\n\nDiagnostics:\n${formatDiagnostics(d, 10)}` : '';
}

export const quickActions: readonly QuickAction[] = [
  {
    id: 'fix-grammar',
    label: 'Fix grammar & spelling',
    description: 'Correct grammar, spelling and punctuation without changing meaning or LaTeX markup.',
    group: 'edit',
    mode: 'rewrite',
    needsSelection: true,
    buildPrompt: () =>
      'Fix grammar, spelling and punctuation. Keep the meaning, wording, language and all LaTeX markup; change as little as possible.',
  },
  {
    id: 'more-formal',
    label: 'Make more formal',
    description: 'Rewrite in a formal, academic register.',
    group: 'edit',
    mode: 'rewrite',
    needsSelection: true,
    buildPrompt: () =>
      'Rewrite in a more formal, academic register suitable for a scientific publication. Keep the meaning, language, citations, references and math unchanged.',
  },
  {
    id: 'more-concise',
    label: 'Make more concise',
    description: 'Shorten while keeping all the content.',
    group: 'edit',
    mode: 'rewrite',
    needsSelection: true,
    buildPrompt: () =>
      'Make this more concise: remove redundancy and wordiness while keeping every idea, citation, reference and formula. Keep the language.',
  },
  {
    id: 'improve-clarity',
    label: 'Improve clarity',
    description: 'Make the text easier to read.',
    group: 'edit',
    mode: 'rewrite',
    needsSelection: true,
    buildPrompt: () =>
      'Improve clarity and flow: simplify convoluted sentences and improve transitions without changing the meaning, the language or the LaTeX markup.',
  },
  {
    id: 'translate',
    label: 'Translate to…',
    description: 'Translate the selection, keeping LaTeX intact.',
    group: 'transform',
    mode: 'rewrite',
    needsSelection: true,
    params: [{ name: 'language', label: 'Target language', options: LANGUAGES, default: 'English' }],
    buildPrompt: ({ params }) =>
      `Translate the text into ${params?.language || 'English'}. Translate only natural-language text: keep LaTeX commands, environments, labels, citation keys, math and code unchanged. Use the conventional academic terminology of the target language.`,
  },
  {
    id: 'to-table',
    label: 'Convert to table',
    description: 'Turn the selected data or list into a LaTeX table.',
    group: 'transform',
    mode: 'rewrite',
    needsSelection: true,
    buildPrompt: () =>
      'Convert this content into a LaTeX table: a table environment with [htbp], \\centering, a \\caption and a \\label, and a tabular with booktabs rules (\\toprule, \\midrule, \\bottomrule) and no vertical lines. Choose sensible column alignment. Output only the LaTeX (the user will add \\usepackage{booktabs} if missing).',
  },
  {
    id: 'to-itemize',
    label: 'Convert to list',
    description: 'Turn the selection into an itemize (or enumerate) list.',
    group: 'transform',
    mode: 'rewrite',
    needsSelection: true,
    params: [{ name: 'style', label: 'List type', options: ['itemize', 'enumerate', 'description'], default: 'itemize' }],
    buildPrompt: ({ params }) =>
      `Convert this content into a LaTeX ${params?.style || 'itemize'} environment, one \\item per idea. Keep the wording and the language.`,
  },
  {
    id: 'equation',
    label: 'Equation from description',
    description: 'Write a LaTeX equation from a natural-language description (or convert the selected description).',
    group: 'generate',
    mode: 'insert',
    needsSelection: false,
    params: [{ name: 'description', label: 'Describe the equation', placeholder: 'e.g. the Gaussian integral equals the square root of pi' }],
    buildPrompt: ({ params, selection }) =>
      `Write the LaTeX for this equation: ${params?.description || selection || ''}\nUse amsmath: an equation environment for a single display equation (align for multi-line derivations), or inline $…$ if the cursor is in the middle of a sentence. Use standard notation and \\mathrm/\\operatorname where appropriate. Output only the LaTeX.`,
  },
  {
    id: 'tikz',
    label: 'TikZ figure from description',
    description: 'Generate a TikZ picture from a description.',
    group: 'generate',
    mode: 'insert',
    needsSelection: false,
    params: [{ name: 'description', label: 'Describe the figure', placeholder: 'e.g. a flowchart with three boxes: input, process, output' }],
    buildPrompt: ({ params, selection }) =>
      `Create a TikZ figure: ${params?.description || selection || ''}\nOutput a complete figure environment with \\centering, a tikzpicture, a \\caption and a \\label. Use only standard TikZ libraries and declare any needed ones in a comment on the first line (e.g. % requires: \\usetikzlibrary{arrows.meta,positioning}). Keep the code clean and readable.`,
  },
  {
    id: 'continue-writing',
    label: 'Continue writing',
    description: 'Write the next sentences at the cursor.',
    group: 'generate',
    mode: 'insert',
    needsSelection: false,
    buildPrompt: () =>
      'Continue the text naturally from the cursor with one or two sentences in the same language and style. Do not invent citations or results.',
  },
  {
    id: 'explain-selection',
    label: 'Explain this',
    description: 'Explain what the selected LaTeX does.',
    group: 'explain',
    mode: 'chat',
    needsSelection: true,
    buildPrompt: ({ selection, path }) =>
      `Explain what this LaTeX${path ? ` from ${path}` : ''} does, briefly:\n\n\`\`\`latex\n${selection ?? ''}\n\`\`\``,
  },
  {
    id: 'explain-error',
    label: 'Explain this error',
    description: 'Explain the compile error in plain language.',
    group: 'explain',
    mode: 'chat',
    needsSelection: false,
    usesDiagnostics: true,
    buildPrompt: ({ diagnostics, selection }) =>
      `Explain this LaTeX compile error in plain language: what causes it and how to fix it. Don't change any files.${diagText(diagnostics)}${selection ? `\n\nRelevant code:\n\`\`\`latex\n${selection}\n\`\`\`` : ''}`,
  },
  {
    id: 'fix-error',
    label: 'Fix this compile error',
    description: 'Let the agent fix the error and recompile.',
    group: 'explain',
    mode: 'chat',
    needsSelection: false,
    usesDiagnostics: true,
    buildPrompt: ({ diagnostics }) =>
      `Fix this compile error with a minimal change, then compile to verify.${diagText(diagnostics)}`,
  },
];

export function getQuickAction(id: string): QuickAction | undefined {
  return quickActions.find((a) => a.id === id);
}
