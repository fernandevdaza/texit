/**
 * Lossless-enough BibTeX parser + pretty printer (used by the BibTeX tools
 * plugin and as a fallback for `api.latex.parseBibtex`).
 */
import type { BibEntry } from '@texit/core';

export interface BibField {
  name: string;
  /** Raw value expression as written: `{...}`, `"..."`, `2024`, `jan`, `a # " and " # b`. */
  value: string;
}

export type BibNode =
  | { kind: 'entry'; type: string; key: string; fields: BibField[]; line: number; raw: string }
  | { kind: 'string'; name: string; value: string; line: number; raw: string }
  | { kind: 'preamble'; value: string; line: number; raw: string }
  | { kind: 'comment'; raw: string; line: number }
  | { kind: 'text'; raw: string; line: number };

class Scanner {
  pos = 0;
  constructor(readonly src: string) {}
  get done() {
    return this.pos >= this.src.length;
  }
  peek() {
    return this.src[this.pos];
  }
  ws() {
    while (!this.done && /\s/.test(this.src[this.pos])) this.pos++;
  }
  lineAt(pos: number) {
    let n = 1;
    for (let i = 0; i < pos && i < this.src.length; i++) if (this.src.charCodeAt(i) === 10) n++;
    return n;
  }
  /** Read a balanced {...} group starting at `{`; returns the inner text. */
  braced(): string {
    const start = this.pos;
    let depth = 0;
    for (; this.pos < this.src.length; this.pos++) {
      const c = this.src[this.pos];
      if (c === '\\') {
        this.pos++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          this.pos++;
          return this.src.slice(start + 1, this.pos - 1);
        }
      }
    }
    throw new Error(`Unbalanced braces starting at line ${this.lineAt(start)}`);
  }
  quoted(): string {
    const start = this.pos;
    this.pos++;
    let depth = 0;
    for (; this.pos < this.src.length; this.pos++) {
      const c = this.src[this.pos];
      if (c === '\\') {
        this.pos++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '"' && depth === 0) {
        this.pos++;
        return this.src.slice(start + 1, this.pos - 1);
      }
    }
    throw new Error(`Unterminated string starting at line ${this.lineAt(start)}`);
  }
  ident(): string {
    const m = /^[^\s,={}()"#%]+/.exec(this.src.slice(this.pos, this.pos + 400));
    if (!m) return '';
    this.pos += m[0].length;
    return m[0];
  }
  /** Value expression: parts joined by `#`. Returns the raw text. */
  value(close: string): string {
    const parts: string[] = [];
    for (;;) {
      this.ws();
      const c = this.peek();
      if (c === '{') parts.push(`{${this.braced()}}`);
      else if (c === '"') parts.push(`"${this.quoted()}"`);
      else {
        const id = this.ident();
        if (!id) break;
        parts.push(id);
      }
      this.ws();
      if (this.peek() === '#') {
        this.pos++;
        continue;
      }
      break;
    }
    void close;
    return parts.join(' # ');
  }
}

export function parseBib(src: string): BibNode[] {
  const s = new Scanner(src);
  const nodes: BibNode[] = [];
  while (!s.done) {
    const at = src.indexOf('@', s.pos);
    const textEnd = at < 0 ? src.length : at;
    const text = src.slice(s.pos, textEnd);
    if (text.trim()) nodes.push({ kind: 'text', raw: text.trim(), line: s.lineAt(s.pos + text.search(/\S/)) });
    if (at < 0) break;
    s.pos = at + 1;
    const start = at;
    const type = s.ident().toLowerCase();
    s.ws();
    const open = s.peek();
    if (!type || (open !== '{' && open !== '(')) {
      nodes.push({ kind: 'text', raw: '@' + type, line: s.lineAt(start) });
      continue;
    }
    const close = open === '{' ? '}' : ')';
    const line = s.lineAt(start);
    if (type === 'comment') {
      if (open === '{') s.braced();
      else {
        const end = src.indexOf(')', s.pos);
        s.pos = end < 0 ? src.length : end + 1;
      }
      nodes.push({ kind: 'comment', raw: src.slice(start, s.pos), line });
      continue;
    }
    s.pos++; // consume open
    if (type === 'preamble') {
      const value = s.value(close);
      s.ws();
      if (s.peek() === close) s.pos++;
      nodes.push({ kind: 'preamble', value, line, raw: src.slice(start, s.pos) });
      continue;
    }
    if (type === 'string') {
      s.ws();
      const name = s.ident();
      s.ws();
      if (s.peek() === '=') s.pos++;
      const value = s.value(close);
      s.ws();
      if (s.peek() === close) s.pos++;
      nodes.push({ kind: 'string', name, value, line, raw: src.slice(start, s.pos) });
      continue;
    }
    s.ws();
    // Citation key: everything up to the first comma (keys may contain : / - . etc).
    const keyEnd = src.slice(s.pos).search(/[,\s}\)]/);
    const key = src.slice(s.pos, keyEnd < 0 ? src.length : s.pos + keyEnd).trim();
    s.pos += keyEnd < 0 ? src.length : keyEnd;
    const fields: BibField[] = [];
    for (;;) {
      s.ws();
      if (s.peek() === ',') {
        s.pos++;
        continue;
      }
      if (s.done || s.peek() === close) {
        s.pos++;
        break;
      }
      const name = s.ident();
      if (!name) {
        // Malformed: skip to the next line to make progress.
        const nl = src.indexOf('\n', s.pos);
        s.pos = nl < 0 ? src.length : nl + 1;
        if (s.peek() === '@') break;
        continue;
      }
      s.ws();
      if (s.peek() !== '=') continue;
      s.pos++;
      const value = s.value(close);
      fields.push({ name: name.toLowerCase(), value });
    }
    nodes.push({ kind: 'entry', type, key, fields, line, raw: src.slice(start, s.pos) });
  }
  return nodes;
}

/** Strip the outer delimiters of a single-part value. */
export function unwrapValue(v: string): string {
  const t = v.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('"') && t.endsWith('"'))) return t.slice(1, -1);
  return t;
}

export function parseBibtexFallback(src: string): BibEntry[] {
  return parseBib(src)
    .filter((n): n is Extract<BibNode, { kind: 'entry' }> => n.kind === 'entry')
    .map((e) => ({
      key: e.key,
      type: e.type,
      line: e.line,
      fields: Object.fromEntries(e.fields.map((f) => [f.name, unwrapValue(f.value).replace(/\s+/g, ' ')])),
    }));
}

const FIELD_ORDER = [
  'author', 'editor', 'title', 'subtitle', 'booktitle', 'journal', 'journaltitle', 'series', 'volume', 'number', 'issue', 'pages',
  'chapter', 'edition', 'publisher', 'organization', 'institution', 'school', 'address', 'location', 'month', 'year', 'date',
  'doi', 'isbn', 'issn', 'url', 'urldate', 'eprint', 'archiveprefix', 'primaryclass', 'eprinttype', 'note', 'abstract', 'keywords',
];

export interface BibFormatOptions {
  indent?: string;
  sortEntries?: boolean;
  sortFields?: boolean;
  alignEquals?: boolean;
  /** Convert "quoted" values to {braced}. */
  braces?: boolean;
}

function normalizeValue(v: string, braces: boolean): string {
  const t = v.trim().replace(/\s*\n\s*/g, ' ');
  if (!braces || t.includes(' # ')) return t;
  if (t.startsWith('"') && t.endsWith('"')) return `{${t.slice(1, -1)}}`;
  return t;
}

export function formatEntry(e: Extract<BibNode, { kind: 'entry' }>, o: BibFormatOptions = {}): string {
  const indent = o.indent ?? '  ';
  let fields = [...e.fields];
  if (o.sortFields ?? true) {
    const rank = (n: string) => {
      const i = FIELD_ORDER.indexOf(n);
      return i < 0 ? FIELD_ORDER.length : i;
    };
    fields = fields.map((f, i) => ({ f, i })).sort((a, b) => rank(a.f.name) - rank(b.f.name) || a.i - b.i).map((x) => x.f);
  }
  const width = (o.alignEquals ?? true) ? Math.max(0, ...fields.map((f) => f.name.length)) : 0;
  const body = fields.map((f) => `${indent}${f.name.padEnd(width)} = ${normalizeValue(f.value, o.braces ?? true)},`).join('\n');
  return `@${e.type}{${e.key},\n${body}${body ? '\n' : ''}}`;
}

export function formatBib(src: string, o: BibFormatOptions = {}): string {
  const nodes = parseBib(src);
  const head: string[] = [];
  const entries: Extract<BibNode, { kind: 'entry' }>[] = [];
  const out: string[] = [];
  for (const n of nodes) {
    if (n.kind === 'entry') {
      if (o.sortEntries) entries.push(n);
      else out.push(formatEntry(n, o));
    } else if (n.kind === 'string') head.push(`@string{${n.name} = ${normalizeValue(n.value, o.braces ?? true)}}`);
    else if (n.kind === 'preamble') head.push(`@preamble{${n.value}}`);
    else (o.sortEntries ? head : out).push(n.raw.trim());
  }
  if (o.sortEntries) {
    entries.sort((a, b) => a.key.localeCompare(b.key, undefined, { sensitivity: 'base', numeric: true }));
    out.push(...entries.map((e) => formatEntry(e, o)));
  }
  return [...head, ...out].join('\n\n') + '\n';
}

/** Make a citation key unique against `existing` by appending a, b, c… */
export function uniqueKey(key: string, existing: Set<string>): string {
  if (!existing.has(key)) return key;
  for (let i = 0; i < 26 * 27; i++) {
    const suffix = i < 26 ? String.fromCharCode(97 + i) : String.fromCharCode(97 + Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26));
    if (!existing.has(key + suffix)) return key + suffix;
  }
  return `${key}-${Date.now()}`;
}
