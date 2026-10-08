/**
 * Project-wide search & replace over the Y.Text of every text file.
 * Replacements are applied as minimal Y.Text edits (one transaction per file)
 * so collaborators merge cleanly and each file's undo manager can undo them.
 */
import type { FileNode, ProjectDoc } from '@texit/core';

export interface SearchOptions {
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  include: string;
  exclude: string;
}

export interface SearchMatch {
  from: number;
  to: number;
  line: number;
  column: number;
  /** Preview text around the match and the match range within it. */
  preview: string;
  pStart: number;
  pEnd: number;
  /** Matched text (for regex replacement). */
  text: string;
}

export interface FileResult {
  file: FileNode;
  matches: SearchMatch[];
}

export interface SearchResult {
  files: FileResult[];
  total: number;
  truncated: boolean;
  error?: string;
}

export const MAX_MATCHES = 5000;
/** Error returned by `buildRegex` when the pattern matches the empty string (translated by the UI). */
export const EMPTY_MATCH_ERROR = 'Pattern matches empty text';
const MAX_PER_FILE = 1000;

export function buildRegex(o: Pick<SearchOptions, 'query' | 'caseSensitive' | 'wholeWord' | 'regex'>): RegExp | string {
  if (!o.query) return 'empty';
  let src = o.regex ? o.query : o.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (o.wholeWord) src = `(?<![\\p{L}\\p{N}_])(?:${src})(?![\\p{L}\\p{N}_])`;
  try {
    const re = new RegExp(src, `g${o.caseSensitive ? '' : 'i'}m${o.wholeWord ? 'u' : ''}`);
    if (re.test('')) return EMPTY_MATCH_ERROR;
    return re;
  } catch (err) {
    return String((err as Error).message ?? err).replace(/^Invalid regular expression: /, '');
  }
}

function globToRegex(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end > i) {
        re += `(?:${glob
          .slice(i + 1, end)
          .split(',')
          .map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&'))
          .join('|')})`;
        i = end;
      } else re += '\\{';
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

/** Comma-separated globs. Patterns without `/` match the file name or any folder. */
export function makePathFilter(patterns: string): ((path: string) => boolean) | null {
  const list = patterns
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!list.length) return null;
  const tests = list.map((p) => {
    const clean = p.replace(/^\.?\//, '').replace(/\/$/, '/**');
    if (!clean.includes('/')) {
      const re = globToRegex(clean.includes('*') || clean.includes('.') ? clean : `${clean}`);
      return (path: string) => path.split('/').some((seg) => re.test(seg));
    }
    const re = globToRegex(clean);
    const reDeep = globToRegex(`**/${clean}`);
    return (path: string) => re.test(path) || reDeep.test(path);
  });
  return (path) => tests.some((t) => t(path));
}

export function findInText(text: string, re: RegExp, limit = MAX_PER_FILE): SearchMatch[] {
  const out: SearchMatch[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  // Precompute line starts lazily.
  const lineStarts: number[] = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };
  while ((m = re.exec(text)) && out.length < limit) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const from = m.index;
    const to = from + m[0].length;
    const li = lineOf(from);
    const ls = lineStarts[li];
    const le = li + 1 < lineStarts.length ? lineStarts[li + 1] - 1 : text.length;
    // Preview: trim long lines around the match.
    let pFrom = ls;
    const lead = text.slice(ls, from).match(/^\s*/)?.[0].length ?? 0;
    pFrom = ls + lead;
    if (from - pFrom > 24) pFrom = from - 14;
    const pTo = Math.min(le, Math.max(to, pFrom + 160));
    out.push({
      from,
      to,
      line: li + 1,
      column: from - ls + 1,
      preview: (pFrom > ls + lead ? '…' : '') + text.slice(pFrom, pTo),
      pStart: from - pFrom + (pFrom > ls + lead ? 1 : 0),
      pEnd: Math.min(to, pTo) - pFrom + (pFrom > ls + lead ? 1 : 0),
      text: m[0],
    });
  }
  return out;
}

export function searchProject(project: ProjectDoc, files: FileNode[], o: SearchOptions): SearchResult {
  const re = buildRegex(o);
  if (typeof re === 'string') return { files: [], total: 0, truncated: false, error: re === 'empty' ? undefined : re };
  const inc = makePathFilter(o.include);
  const exc = makePathFilter(o.exclude);
  const out: FileResult[] = [];
  let total = 0;
  let truncated = false;
  const candidates = files
    .filter((f) => f.kind === 'file' && f.isText)
    .filter((f) => (!inc || inc(f.path)) && (!exc || !exc(f.path)))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  for (const f of candidates) {
    const text = project.readText(f.id);
    const matches = findInText(text, re, Math.min(MAX_PER_FILE, MAX_MATCHES - total));
    if (matches.length) {
      out.push({ file: f, matches });
      total += matches.length;
    }
    if (total >= MAX_MATCHES) {
      truncated = true;
      break;
    }
  }
  return { files: out, total, truncated };
}

/** Replacement text for one match (supports $1, $<name>, $& in regex mode). */
export function replacementFor(match: string, re: RegExp, replace: string, regex: boolean): string {
  if (!regex) return replace;
  const single = new RegExp(re.source, re.flags.replace('g', ''));
  return match.replace(single, replace);
}

/**
 * Replace matches in a file in ONE Y.Text transaction. `only` restricts to a
 * single match (by offsets); matches are recomputed on the current text so
 * concurrent edits never corrupt the document.
 */
export function replaceInFile(project: ProjectDoc, fileId: string, o: SearchOptions, replace: string, only?: { from: number; to: number; text: string }): number {
  const ytext = project.getYText(fileId);
  const re = buildRegex(o);
  if (!ytext || typeof re === 'string') return 0;
  const text = ytext.toString();
  let matches = findInText(text, re, Number.MAX_SAFE_INTEGER);
  if (only) matches = matches.filter((m) => m.from === only.from && m.to === only.to && m.text === only.text);
  if (!matches.length) return 0;
  project.doc.transact(() => {
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const repl = replacementFor(m.text, re, replace, o.regex);
      if (repl === m.text) continue;
      ytext.delete(m.from, m.to - m.from);
      if (repl) ytext.insert(m.from, repl);
    }
  });
  return matches.length;
}
