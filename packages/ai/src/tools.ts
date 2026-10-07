/**
 * Built-in project tools for the agent (and for TexIt's own MCP server).
 *
 * Each tool is defined once (zod schema + implementation) and exposed in two shapes:
 *  - `createProjectTools()`    → AI SDK `ToolSet` for `streamText` / `runAgent`.
 *  - `createProjectToolDefs()` → transport-neutral `{ name, description, inputSchema, execute }`
 *                                used to expose the project over MCP (`host.mcp.setServerTools`).
 */
import { jsonSchema, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { normalizePath, type Diagnostic } from '@texit/core';
import type { AgentEvent, FileEditOp, ProjectToolContext } from './types';

export const PROJECT_TOOL_NAMES = [
  'list_files',
  'read_file',
  'search_project',
  'get_active_file',
  'get_diagnostics',
  'compile',
  'edit_file',
  'write_file',
  'create_file',
  'delete_file',
  'rename_file',
] as const;

export type ProjectToolName = (typeof PROJECT_TOOL_NAMES)[number];

export const READ_ONLY_PROJECT_TOOLS: readonly ProjectToolName[] = [
  'list_files',
  'read_file',
  'search_project',
  'get_active_file',
  'get_diagnostics',
];

export interface ProjectToolsOptions {
  /** Apply edits immediately; otherwise each change goes through `ctx.reviewEdit` / `ctx.confirmAction`. */
  autoApply: boolean;
  /** Receives `file-edit` events (proposed / applied / rejected). */
  onEvent?: (e: AgentEvent) => void;
  /** Restrict to a subset of tools (e.g. `READ_ONLY_PROJECT_TOOLS` for an "ask" mode). */
  include?: readonly ProjectToolName[];
}

/** Transport-neutral tool definition (MCP server, plugins, tests). */
export interface ProjectToolDef {
  name: string;
  description: string;
  /** JSON Schema (draft-07 compatible object schema). */
  inputSchema: Record<string, unknown>;
  /** Validates `args`, runs the tool and returns its text output. Throws on failure. */
  execute(args: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<string>;
}

/** Result shape of an MCP `tools/call` (what `host.mcp.respondToolCall` expects). */
export interface McpToolCallResult {
  content: { type: 'text'; text: string }[];
  isError?: boolean;
}

interface CallInfo {
  toolCallId?: string;
  signal?: AbortSignal;
}

interface ToolImpl {
  name: ProjectToolName;
  description: string;
  schema: z.ZodType<any>;
  run(input: any, call: CallInfo): Promise<string>;
}

// ─────────────────────────── Limits ───────────────────────────

const MAX_READ_LINES = 2000;
const MAX_LINE_CHARS = 2000;
const MAX_OUTPUT_CHARS = 60_000;
const MAX_LIST_ENTRIES = 1000;
const MAX_SEARCH_RESULTS = 100;
const MAX_DIAGNOSTICS = 25;
const LOG_TAIL_LINES = 40;
const LOG_TAIL_CHARS = 4000;

// ─────────────────────────── Helpers ───────────────────────────

/** Normalise a model-supplied path to a project-relative POSIX path. */
export function cleanPath(p: string): string {
  return normalizePath(String(p ?? '').trim().replace(/^\.?\//, ''));
}

function truncate(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} characters]`;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** `cat -n` style numbering: right-aligned number, then a tab. */
export function numberLines(lines: string[], firstLine: number): string {
  const width = String(firstLine + lines.length - 1).length;
  return lines
    .map((l, i) => {
      const text = l.length > MAX_LINE_CHARS ? `${l.slice(0, MAX_LINE_CHARS)}… [line truncated]` : l;
      return `${String(firstLine + i).padStart(Math.max(width, 4))}\t${text}`;
    })
    .join('\n');
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/** 1-based line number of a character offset. */
function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Non-overlapping occurrences, left to right (same semantics as split/join). */
export function findOccurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + needle.length);
  }
  return out;
}

function similarPaths(ctx: ProjectToolContext, path: string): string[] {
  const base = path.split('/').pop()!.toLowerCase();
  const stem = base.replace(/\.[^.]+$/, '');
  return ctx
    .listFiles()
    .map((f) => f.path)
    .filter((p) => {
      const b = p.split('/').pop()!.toLowerCase();
      return b === base || (stem.length > 2 && b.includes(stem));
    })
    .slice(0, 5);
}

function notFound(ctx: ProjectToolContext, path: string): Error {
  const similar = similarPaths(ctx, path);
  return new Error(
    `File not found: ${path}.` + (similar.length ? ` Did you mean: ${similar.join(', ')}?` : ' Use list_files to see the project files.'),
  );
}

function fileEntry(ctx: ProjectToolContext, path: string) {
  return ctx.listFiles().find((f) => f.path === path);
}

function exists(ctx: ProjectToolContext, path: string): boolean {
  return !!fileEntry(ctx, path);
}

async function readText(ctx: ProjectToolContext, path: string): Promise<string> {
  const entry = fileEntry(ctx, path);
  if (entry && !entry.isText) throw new Error(`${path} is a binary file (${formatSize(entry.size)}) and cannot be read or edited as text.`);
  const content = await ctx.readFile(path);
  if (content == null) throw notFound(ctx, path);
  return content;
}

/** Explain why `search` was not found, pointing at the closest candidate. */
export function explainNoMatch(content: string, search: string, path: string): string {
  const fileLines = splitLines(content);
  const searchLines = splitLines(search);
  while (searchLines.length && !searchLines[0].trim()) searchLines.shift();
  while (searchLines.length && !searchLines[searchLines.length - 1].trim()) searchLines.pop();
  const parts: string[] = [`The search text was not found in ${path}. Nothing was changed.`];

  if (searchLines.length && searchLines.every((l) => /^\s*\d+\t/.test(l) || /^\s*\d+\|/.test(l))) {
    parts.push('It looks like the search text includes line-number prefixes from read_file — remove them and use only the file content.');
  }

  const trimmed = searchLines.map((l) => l.trim());
  if (trimmed.length) {
    // 1) Whitespace-insensitive (per line) match.
    for (let i = 0; i + trimmed.length <= fileLines.length; i++) {
      let ok = true;
      for (let j = 0; j < trimmed.length; j++) {
        if (fileLines[i + j].trim() !== trimmed[j]) {
          ok = false;
          break;
        }
      }
      if (ok) {
        parts.push(
          `A passage matching except for whitespace/indentation exists at lines ${i + 1}-${i + trimmed.length}. Its exact text is:\n` +
            '```\n' +
            fileLines.slice(i, i + trimmed.length).join('\n') +
            '\n```\nRetry with that exact text as `search`.',
        );
        return parts.join('\n');
      }
    }
    // 2) First distinctive line found → show the surrounding region.
    const anchor = trimmed.find((l) => l.length >= 4);
    if (anchor) {
      const idx = fileLines.findIndex((l) => l.trim() === anchor || l.includes(anchor));
      if (idx !== -1) {
        const from = Math.max(0, idx - 2);
        const to = Math.min(fileLines.length, idx + Math.max(trimmed.length, 3) + 2);
        parts.push(
          `The line "${anchor.slice(0, 120)}" occurs at line ${idx + 1}, but the following lines differ. Current content there:\n` +
            '```\n' +
            numberLines(fileLines.slice(from, to), from + 1) +
            '\n```\n(Line numbers are for reference only — do not include them in `search`.)',
        );
        return parts.join('\n');
      }
    }
  }
  parts.push('The file may have changed. Use read_file (optionally with startLine/endLine) or search_project to get the exact current text, then retry.');
  return parts.join('\n');
}

function snippetAround(content: string, offset: number, length: number, context = 2): string {
  const lines = splitLines(content);
  const start = lineAt(content, offset);
  const end = lineAt(content, offset + Math.max(0, length - 1));
  const from = Math.max(1, start - context);
  const to = Math.min(lines.length, end + context);
  if (to - from > 30) return `(lines ${start}-${end})`;
  return numberLines(lines.slice(from - 1, to), from);
}

function severityRank(d: Diagnostic): number {
  return d.severity === 'error' ? 0 : d.severity === 'warning' ? 1 : d.severity === 'info' ? 2 : 3;
}

/** Compact, model-friendly diagnostics listing (errors first). */
export function formatDiagnostics(diags: Diagnostic[], max = MAX_DIAGNOSTICS): string {
  if (!diags.length) return 'No diagnostics.';
  const counts: Record<string, number> = {};
  for (const d of diags) counts[d.severity] = (counts[d.severity] ?? 0) + 1;
  const order = ['error', 'warning', 'info', 'badbox'];
  const summary = Object.entries(counts)
    .sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map(([k, v]) => `${v} ${k}${v === 1 ? '' : k === 'badbox' ? 'es' : 's'}`)
    .join(', ');
  const sorted = [...diags].sort((a, b) => severityRank(a) - severityRank(b));
  // Only show bad boxes when there is room.
  const shown = sorted.filter((d) => d.severity !== 'badbox' || sorted.length <= max).slice(0, max);
  const lines = shown.map((d) => {
    const loc = d.file ? `${d.file}${d.line ? `:${d.line}` : ''}` : d.line ? `line ${d.line}` : '';
    const ctx = d.context ? ` | ${d.context.replace(/\s+/g, ' ').trim().slice(0, 200)}` : '';
    return `- ${d.severity}${loc ? ` ${loc}` : ''}: ${d.message.replace(/\s+/g, ' ').trim()}${ctx}`;
  });
  const more = sorted.length - shown.length;
  return `${summary}\n${lines.join('\n')}${more > 0 ? `\n… and ${more} more` : ''}`;
}

function logTail(log: string): string {
  const lines = log.split(/\r?\n/);
  let tail = lines.slice(-LOG_TAIL_LINES).join('\n');
  if (tail.length > LOG_TAIL_CHARS) tail = tail.slice(-LOG_TAIL_CHARS);
  return tail.trim();
}

function rejectedMessage(path: string, op: FileEditOp): string {
  const what = op === 'delete' ? 'deletion of' : op === 'rename' ? 'rename of' : op === 'create' ? 'creation of' : 'edit to';
  return `REJECTED: the user rejected the ${what} ${path}; nothing was changed. Do not retry the same change — ask the user what they would prefer, or continue with the rest of the task.`;
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined, onAbort: T): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(onAbort);
  return new Promise<T>((resolve, reject) => {
    const listener = () => resolve(onAbort);
    signal.addEventListener('abort', listener, { once: true });
    promise.then(
      (v) => {
        signal.removeEventListener('abort', listener);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', listener);
        reject(e);
      },
    );
  });
}

// ─────────────────────────── Tool implementations ───────────────────────────

function buildImpls(ctx: ProjectToolContext, opts: ProjectToolsOptions): ToolImpl[] {
  const emit = (e: AgentEvent) => {
    try {
      opts.onEvent?.(e);
    } catch {
      /* listener errors must not break tools */
    }
  };

  /** Ask for approval if needed; emits proposed/rejected. Returns true to proceed. */
  async function approve(change: { op: FileEditOp; path: string; before?: string; after?: string; newPath?: string }, call: CallInfo): Promise<boolean> {
    if (opts.autoApply) return true;
    const event = { type: 'file-edit' as const, toolCallId: call.toolCallId, ...change };
    let decision: Promise<boolean> | undefined;
    if ((change.op === 'delete' || change.op === 'rename') && ctx.confirmAction) {
      decision = ctx.confirmAction({ kind: change.op, path: change.path, newPath: change.newPath });
    } else if (change.op !== 'rename' && ctx.reviewEdit) {
      decision = ctx.reviewEdit(change.path, change.before ?? '', change.after ?? '');
    }
    if (!decision) return true; // nothing to review with → apply
    emit({ ...event, status: 'proposed' });
    let ok = false;
    try {
      ok = await abortable(decision, call.signal, false);
    } catch {
      ok = false;
    }
    if (!ok) emit({ ...event, status: 'rejected' });
    return ok;
  }

  function applied(change: { op: FileEditOp; path: string; before?: string; after?: string; newPath?: string }, call: CallInfo) {
    emit({ type: 'file-edit', toolCallId: call.toolCallId, status: 'applied', ...change });
  }

  const pathSchema = z.string().min(1).describe('Project-relative path, e.g. "chapters/intro.tex".');

  return [
    {
      name: 'list_files',
      description:
        'List files in the project with their sizes. The main (root) document is marked [main]; binary files are marked [binary]. Optionally restrict to a folder.',
      schema: z.object({
        dir: z.string().optional().describe('Only list files under this folder (project-relative).'),
      }),
      async run({ dir }) {
        const prefix = dir ? cleanPath(dir) : '';
        const main = ctx.getMainPath();
        const files = ctx
          .listFiles()
          .filter((f) => !prefix || f.path === prefix || f.path.startsWith(`${prefix}/`))
          .sort((a, b) => a.path.localeCompare(b.path));
        if (!files.length) return prefix ? `No files under ${prefix}/.` : 'The project is empty.';
        const lines = files
          .slice(0, MAX_LIST_ENTRIES)
          .map((f) => `${f.path} (${formatSize(f.size)})${f.path === main ? ' [main]' : ''}${f.isText ? '' : ' [binary]'}`);
        const more = files.length - lines.length;
        return `${files.length} file${files.length === 1 ? '' : 's'}:\n${lines.join('\n')}${more > 0 ? `\n… and ${more} more` : ''}`;
      },
    },
    {
      name: 'read_file',
      description:
        `Read a text file. Each line is prefixed with its 1-based line number and a tab (for reference only — never copy these prefixes into edit_file). ` +
        `Use startLine/endLine for large files; at most ${MAX_READ_LINES} lines are returned per call.`,
      schema: z.object({
        path: pathSchema,
        startLine: z.number().int().min(1).optional().describe('First line to return (1-based, inclusive).'),
        endLine: z.number().int().min(1).optional().describe('Last line to return (inclusive).'),
      }),
      async run({ path, startLine, endLine }) {
        const p = cleanPath(path);
        const content = await readText(ctx, p);
        if (!content) return `${p} is empty.`;
        const lines = splitLines(content);
        const total = lines.length;
        const from = Math.min(Math.max(1, startLine ?? 1), total);
        let to = Math.min(total, endLine ?? total);
        if (to < from) to = from;
        let note = '';
        if (to - from + 1 > MAX_READ_LINES) {
          to = from + MAX_READ_LINES - 1;
          note = `\n… [showing lines ${from}-${to} of ${total}; call read_file again with startLine=${to + 1} to continue]`;
        }
        const header = from === 1 && to === total ? `${p} (${total} lines)` : `${p} (lines ${from}-${to} of ${total})`;
        return truncate(`${header}\n${numberLines(lines.slice(from - 1, to), from)}${note}`);
      },
    },
    {
      name: 'search_project',
      description:
        'Search all text files for a string (or a JavaScript regular expression with regex=true). Returns matching lines as path:line: text. Use it to find labels, citations, macros or where something is defined.',
      schema: z.object({
        query: z.string().min(1).describe('Text or regex to search for.'),
        regex: z.boolean().optional().describe('Treat query as a regular expression.'),
        caseSensitive: z.boolean().optional().describe('Case-sensitive search (default false).'),
        path: z.string().optional().describe('Only return matches in files under this path prefix.'),
        maxResults: z.number().int().min(1).max(500).optional().describe(`Maximum matches to return (default ${MAX_SEARCH_RESULTS}).`),
      }),
      async run({ query, regex, caseSensitive, path, maxResults }) {
        if (regex) {
          try {
            new RegExp(query);
          } catch (e) {
            throw new Error(`Invalid regular expression: ${(e as Error).message}`);
          }
        }
        const prefix = path ? cleanPath(path) : '';
        let results = await ctx.search(query, { regex: !!regex, caseSensitive: !!caseSensitive });
        if (prefix) results = results.filter((r) => r.path === prefix || r.path.startsWith(`${prefix}/`));
        if (!results.length) return `No matches for ${regex ? `/${query}/` : JSON.stringify(query)}.`;
        const max = maxResults ?? MAX_SEARCH_RESULTS;
        const lines = results.slice(0, max).map((r) => `${r.path}:${r.line}: ${r.text.trim().slice(0, 240)}`);
        const more = results.length - lines.length;
        return `${results.length} match${results.length === 1 ? '' : 'es'}:\n${lines.join('\n')}${more > 0 ? `\n… and ${more} more (narrow the query or use path)` : ''}`;
      },
    },
    {
      name: 'get_active_file',
      description: "Get the file currently open in the user's editor, the cursor line and the selected text (if any).",
      schema: z.object({}),
      async run() {
        const active = ctx.getActiveFile();
        if (!active) return 'No file is open in the editor.';
        const sel = active.selection;
        if (!sel) return `Active file: ${active.path}`;
        if (!sel.text) return `Active file: ${active.path}\nCursor at line ${sel.line}.`;
        const lineCount = splitLines(sel.text).length;
        return `Active file: ${active.path}\nSelection (lines ${sel.line}-${sel.line + lineCount - 1}):\n\`\`\`latex\n${truncate(sel.text, 20_000)}\n\`\`\``;
      },
    },
    {
      name: 'get_diagnostics',
      description: 'Get the errors and warnings from the most recent compilation (without recompiling).',
      schema: z.object({}),
      async run() {
        return formatDiagnostics(ctx.getDiagnostics());
      },
    },
    {
      name: 'compile',
      description:
        'Compile the project and return the status, the most important errors/warnings (file:line) and the end of the log. Use after editing to verify the document still builds.',
      schema: z.object({}),
      async run() {
        const res = await ctx.compile();
        const tail = logTail(res.logTail ?? '');
        return [
          `Status: ${res.status}`,
          `Diagnostics: ${formatDiagnostics(res.diagnostics ?? [])}`,
          tail ? `Log tail:\n\`\`\`\n${tail}\n\`\`\`` : '',
        ]
          .filter(Boolean)
          .join('\n');
      },
    },
    {
      name: 'edit_file',
      description:
        'Edit a text file by replacing an exact passage. `search` must match the current file content exactly (including whitespace and indentation) and must occur exactly once unless replaceAll=true — include a few surrounding lines to make it unique. ' +
        'Prefer several small targeted edits over rewriting files. Read the file first if you have not seen its current content.',
      schema: z.object({
        path: pathSchema,
        search: z.string().min(1).describe('Exact text to find (copied from the file, without line-number prefixes).'),
        replace: z.string().describe('Replacement text (may be empty to delete the passage).'),
        replaceAll: z.boolean().optional().describe('Replace every occurrence instead of requiring a unique match.'),
      }),
      async run({ path, search, replace, replaceAll }, call) {
        const p = cleanPath(path);
        const before = await readText(ctx, p);
        if (search === replace) throw new Error('`search` and `replace` are identical; nothing to change.');
        let s: string = search;
        let r: string = replace;
        let hits = findOccurrences(before, s);
        // Tolerate LF-vs-CRLF mismatches.
        if (!hits.length && before.includes('\r\n') && s.includes('\n') && !s.includes('\r\n')) {
          const sCrlf = s.replace(/\n/g, '\r\n');
          const crlfHits = findOccurrences(before, sCrlf);
          if (crlfHits.length) {
            s = sCrlf;
            r = r.replace(/\r?\n/g, '\r\n');
            hits = crlfHits;
          }
        }
        if (!hits.length) throw new Error(explainNoMatch(before, search, p));
        if (hits.length > 1 && !replaceAll) {
          const lines = hits.slice(0, 10).map((h) => lineAt(before, h));
          throw new Error(
            `The search text occurs ${hits.length} times in ${p} (lines ${lines.join(', ')}${hits.length > 10 ? ', …' : ''}). Nothing was changed. ` +
              'Include more surrounding context so it matches exactly once, or set replaceAll=true to change every occurrence.',
          );
        }
        const after = hits.length > 1 ? before.split(s).join(r) : before.slice(0, hits[0]) + r + before.slice(hits[0] + s.length);
        const change = { op: 'edit' as const, path: p, before, after };
        if (!(await approve(change, call))) return rejectedMessage(p, 'edit');
        try {
          await ctx.editFile(p, s, r, hits.length > 1 ? { replaceAll: true } : undefined);
        } catch (e) {
          throw new Error(`Could not apply the edit to ${p} (the file may have changed meanwhile): ${(e as Error).message}. Re-read the file and retry.`);
        }
        applied(change, call);
        const where = hits.length > 1 ? `${hits.length} occurrences` : `1 occurrence at line ${lineAt(before, hits[0])}`;
        const preview = hits.length === 1 ? `\n${snippetAround(after, hits[0], r.length)}` : '';
        return `Edited ${p}: replaced ${where}.${preview}`;
      },
    },
    {
      name: 'write_file',
      description:
        'Create a file or replace its entire content. Only use this for new files or when a complete rewrite is really intended — for changes to existing files use edit_file.',
      schema: z.object({
        path: pathSchema,
        content: z.string().describe('Full new content of the file.'),
      }),
      async run({ path, content }, call) {
        const p = cleanPath(path);
        const existed = exists(ctx, p);
        const before = existed ? await readText(ctx, p) : '';
        if (existed && before === content) return `${p} already has exactly this content; nothing changed.`;
        const change = { op: (existed ? 'edit' : 'create') as FileEditOp, path: p, before: existed ? before : undefined, after: content };
        if (!(await approve(change, call))) return rejectedMessage(p, change.op);
        await ctx.writeFile(p, content);
        applied(change, call);
        return `${existed ? 'Rewrote' : 'Created'} ${p} (${splitLines(content).length} lines).`;
      },
    },
    {
      name: 'create_file',
      description: 'Create a new text file. Fails if the file already exists (use edit_file to change existing files).',
      schema: z.object({
        path: pathSchema,
        content: z.string().describe('Content of the new file.'),
      }),
      async run({ path, content }, call) {
        const p = cleanPath(path);
        if (exists(ctx, p)) throw new Error(`${p} already exists. Use edit_file to modify it (or write_file to replace it entirely).`);
        const change = { op: 'create' as const, path: p, after: content };
        if (!(await approve(change, call))) return rejectedMessage(p, 'create');
        await ctx.writeFile(p, content);
        applied(change, call);
        return `Created ${p} (${splitLines(content).length} lines).`;
      },
    },
    {
      name: 'delete_file',
      description: 'Delete a file from the project. Only do this when the user asked for it.',
      schema: z.object({ path: pathSchema }),
      async run({ path }, call) {
        const p = cleanPath(path);
        const entry = fileEntry(ctx, p);
        if (!entry) throw notFound(ctx, p);
        const before = entry.isText ? ((await ctx.readFile(p)) ?? undefined) : undefined;
        const change = { op: 'delete' as const, path: p, before, after: '' };
        if (!(await approve(change, call))) return rejectedMessage(p, 'delete');
        await ctx.deleteFile(p);
        applied(change, call);
        return `Deleted ${p}.`;
      },
    },
    {
      name: 'rename_file',
      description: 'Rename or move a file. Remember to update \\input/\\include/\\includegraphics/\\bibliography references to it.',
      schema: z.object({
        from: pathSchema.describe('Current path.'),
        to: pathSchema.describe('New path.'),
      }),
      async run({ from, to }, call) {
        const a = cleanPath(from);
        const b = cleanPath(to);
        if (!exists(ctx, a)) throw notFound(ctx, a);
        if (a === b) return 'Source and destination are the same; nothing changed.';
        if (exists(ctx, b)) throw new Error(`${b} already exists.`);
        const change = { op: 'rename' as const, path: a, newPath: b };
        if (!(await approve(change, call))) return rejectedMessage(a, 'rename');
        await ctx.renameFile(a, b);
        applied(change, call);
        return `Renamed ${a} → ${b}.`;
      },
    },
  ];
}

function selectImpls(ctx: ProjectToolContext, opts: ProjectToolsOptions): ToolImpl[] {
  const impls = buildImpls(ctx, opts);
  return opts.include ? impls.filter((t) => opts.include!.includes(t.name)) : impls;
}

/** AI SDK tools operating on the project. */
export function createProjectTools(ctx: ProjectToolContext, opts: ProjectToolsOptions): ToolSet {
  const set: ToolSet = {};
  for (const impl of selectImpls(ctx, opts)) {
    set[impl.name] = tool({
      description: impl.description,
      inputSchema: impl.schema,
      execute: (input: unknown, options) => impl.run(input, { toolCallId: options.toolCallId, signal: options.abortSignal }),
    });
  }
  return set;
}

/** Convert a zod schema to a plain JSON Schema object usable by MCP clients. */
function toJsonSchema(schema: z.ZodType<any>): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: 'input', target: 'draft-7' }) as Record<string, unknown>;
  delete json.$schema;
  if (json.type === 'object' && !json.properties) json.properties = {};
  return json;
}

/**
 * The same tools in a transport-neutral shape (used to expose TexIt as an MCP server).
 * Defaults to `autoApply: true` — pass `autoApply: false` to route external agents' edits through review.
 */
export function createProjectToolDefs(
  ctx: ProjectToolContext,
  opts: Partial<ProjectToolsOptions> = {},
): ProjectToolDef[] {
  const full: ProjectToolsOptions = { autoApply: opts.autoApply ?? true, onEvent: opts.onEvent, include: opts.include };
  return selectImpls(ctx, full).map((impl) => ({
    name: impl.name,
    description: impl.description,
    inputSchema: toJsonSchema(impl.schema),
    async execute(args, execOpts) {
      const parsed = impl.schema.safeParse(args ?? {});
      if (!parsed.success) {
        const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`).join('; ');
        throw new Error(`Invalid arguments for ${impl.name}: ${issues}`);
      }
      return impl.run(parsed.data, { signal: execOpts?.signal });
    },
  }));
}

/** Run a tool def by name and wrap the outcome as an MCP `tools/call` result (never throws). */
export async function callProjectToolDef(
  defs: readonly ProjectToolDef[],
  name: string,
  args: Record<string, unknown> | undefined,
  opts?: { signal?: AbortSignal },
): Promise<McpToolCallResult> {
  const def = defs.find((d) => d.name === name);
  if (!def) return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  try {
    const text = await def.execute(args ?? {}, opts);
    return { content: [{ type: 'text', text }] };
  } catch (e) {
    return { content: [{ type: 'text', text: (e as Error)?.message ?? String(e) }], isError: true };
  }
}

// ─────────────────────────── Plugin tools ───────────────────────────

/** Structural copy of `@texit/plugin-api`'s `AIToolDef` (kept local to avoid a package cycle). */
export interface AIToolDefLike {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute(input: any): Promise<unknown> | unknown;
}

/** Tool names accepted by every major provider: [a-zA-Z0-9_-]{1,64}. */
export function sanitizeToolName(name: string, maxLength = 64): string {
  let n = name.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'tool';
  if (n.length > maxLength) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const suffix = `_${h.toString(36).slice(0, 6)}`;
    n = n.slice(0, maxLength - suffix.length) + suffix;
  }
  return n;
}

function stringifyOutput(out: unknown): string {
  if (typeof out === 'string') return out;
  if (out === undefined) return 'OK';
  try {
    return truncate(JSON.stringify(out, null, 2));
  } catch {
    return String(out);
  }
}

/** Convert plugin-registered tools (JSON-schema based) into AI SDK tools. */
export function pluginToolsToAiTools(defs: readonly AIToolDefLike[], opts: { prefix?: string } = {}): ToolSet {
  const set: ToolSet = {};
  for (const def of defs) {
    const name = sanitizeToolName(`${opts.prefix ?? ''}${def.name}`);
    const schema = { type: 'object', properties: {}, ...def.inputSchema } as Parameters<typeof jsonSchema>[0];
    set[name] = tool({
      description: def.description,
      inputSchema: jsonSchema(schema),
      execute: async (input: unknown) => stringifyOutput(await def.execute(input)),
    });
  }
  return set;
}
