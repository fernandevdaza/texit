/**
 * A self-contained, in-memory `ProjectToolContext` — handy for tests, demos, headless
 * agents and plugin development. The real app implements the context against its Y.Doc.
 */
import type { Diagnostic } from '@texit/core';
import type { ProjectToolContext } from './types';

export interface InMemoryProjectOptions {
  mainPath?: string;
  activeFile?: ReturnType<ProjectToolContext['getActiveFile']>;
  diagnostics?: Diagnostic[];
  compile?: (files: Map<string, string>) => Promise<{ status: string; diagnostics: Diagnostic[]; logTail: string }>;
  reviewEdit?: ProjectToolContext['reviewEdit'];
  confirmAction?: ProjectToolContext['confirmAction'];
}

export interface InMemoryProjectContext extends ProjectToolContext {
  /** Live file map (path → text). */
  readonly files: Map<string, string>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function createInMemoryProjectContext(
  initial: Record<string, string> = {},
  opts: InMemoryProjectOptions = {},
): InMemoryProjectContext {
  const files = new Map(Object.entries(initial));
  let diagnostics = opts.diagnostics ?? [];
  return {
    files,
    listFiles: () => [...files.entries()].map(([path, text]) => ({ path, isText: true, size: text.length })),
    readFile: async (path) => files.get(path) ?? null,
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    deleteFile: async (path) => {
      if (!files.delete(path)) throw new Error(`No such file: ${path}`);
    },
    renameFile: async (from, to) => {
      const text = files.get(from);
      if (text == null) throw new Error(`No such file: ${from}`);
      files.delete(from);
      files.set(to, text);
    },
    editFile: async (path, search, replace, o) => {
      const text = files.get(path);
      if (text == null) throw new Error(`No such file: ${path}`);
      const count = search ? text.split(search).length - 1 : 0;
      if (count === 0) throw new Error('search text not found');
      if (count > 1 && !o?.replaceAll) throw new Error(`search text found ${count} times`);
      const i = text.indexOf(search);
      files.set(path, o?.replaceAll ? text.split(search).join(replace) : text.slice(0, i) + replace + text.slice(i + search.length));
    },
    search: async (query, o) => {
      const re = new RegExp(o?.regex ? query : escapeRegExp(query), o?.caseSensitive ? '' : 'i');
      const out: { path: string; line: number; text: string }[] = [];
      for (const [path, text] of files) {
        text.split(/\r?\n/).forEach((line, i) => {
          if (re.test(line)) out.push({ path, line: i + 1, text: line });
        });
      }
      return out;
    },
    compile: async () => {
      if (!opts.compile) return { status: 'success', diagnostics: [], logTail: '' };
      const res = await opts.compile(files);
      diagnostics = res.diagnostics;
      return res;
    },
    getDiagnostics: () => diagnostics,
    getMainPath: () => opts.mainPath ?? (files.has('main.tex') ? 'main.tex' : null),
    getActiveFile: () => opts.activeFile ?? null,
    reviewEdit: opts.reviewEdit,
    confirmAction: opts.confirmAction,
  };
}
