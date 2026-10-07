/**
 * LaTeX source analysis used by the outline, autocompletion, AI context, the
 * word counter and the as-you-type linter.
 *
 * Everything here is pure TypeScript, allocation-light and linear in the size
 * of the input so it can run on every keystroke (in a worker or on the main
 * thread) for documents of several hundred KB.
 *
 * Shared approach: the source is first "masked" (`maskLatex`) — comments and
 * the bodies of verbatim-like constructs are replaced by spaces while keeping
 * every offset and newline intact — and the analysers then scan the masked
 * text, mapping offsets back to 1-based line numbers.
 */
import type { Diagnostic } from './types';

// ═══════════════════════════════ public types ═══════════════════════════════

export interface OutlineItem {
  /** 0 = part, 1 = chapter, 2 = section, 3 = subsection, 4 = subsubsection, 5 = paragraph, 6 = subparagraph; -1 = frame (beamer) */
  level: number;
  kind: string; // 'section' | 'chapter' | 'frame' | …
  title: string;
  /** 1-based line. */
  line: number;
  starred: boolean;
  /** Short title from `\section[short]{long}` (the long one is `title`). */
  shortTitle?: string;
  /** Offset (UTF-16 code units) of the command's backslash in the source. */
  offset?: number;
}

export interface LatexAnalysis {
  outline: OutlineItem[];
  /** `context` is a short human description: "section: Introduction", "figure: A caption", "equation: E = mc^2"… */
  labels: { name: string; line: number; context?: string; offset?: number }[];
  refs: { name: string; line: number; command: string; offset?: number }[];
  citations: { keys: string[]; line: number; command: string; offset?: number }[];
  /**
   * Files referenced via \input, \include, \subfile, \includegraphics, \bibliography, \addbibresource…
   * `path` is the argument as written (no extension added, not resolved).
   */
  includes: { command: string; path: string; line: number; offset?: number }[];
  /** User-defined commands (\newcommand, \renewcommand, \DeclareMathOperator, \def…). `name` has NO leading backslash. */
  commands: { name: string; args: number; line: number; offset?: number; /** First argument is optional (`[default]`). */ optionalArg?: boolean }[];
  /** User-defined environments (\newenvironment, \newtheorem…). */
  environments: { name: string; line: number; offset?: number; args?: number; /** Display title for theorem-like environments. */ title?: string }[];
  packages: { name: string; options?: string; line: number; offset?: number }[];
  documentClass?: { name: string; options?: string };
  /** `% !TEX program = xelatex` style magic comments (lower-cased keys, e.g. 'program', 'ts-program', 'root', 'spellcheck', 'bib-program'). */
  magic: Record<string, string>;
  /** Plain-text document title from `\title{…}`, if any. */
  title?: string;
  /** Folders declared with `\graphicspath{{a/}{b/}}`. */
  graphicsPath?: string[];
}

export interface BibEntry {
  key: string;
  type: string;
  fields: Record<string, string>;
  line: number;
}

export interface WordCount {
  /** Total = textWords + headerWords + captionWords. */
  words: number;
  /** Non-whitespace characters of the counted text. */
  characters: number;
  mathInline: number;
  mathDisplay: number;
  /** Words in running text. */
  textWords: number;
  /** Words in sectioning titles. */
  headerWords: number;
  /** Words in captions, footnotes and float bodies ("outside text" in texcount). */
  captionWords: number;
  /** Number of sectioning commands. */
  headers: number;
  /** Number of floats (figure, table…). */
  floats: number;
}

export type LintDiagnostic = Diagnostic & { from: number; to: number };

// ═══════════════════════════════ low-level helpers ═══════════════════════════════

const BS = 92; // \
const PCT = 37; // %
const LB = 123; // {
const RB = 125; // }
const LSQ = 91; // [
const RSQ = 93; // ]
const NL = 10;
const CR = 13;
const SP = 32;
const TAB = 9;
const STAR = 42;
const DOLLAR = 36;
const LT = 60;
const GT = 62;
const LP = 40;
const RP = 41;
const AT = 64;
const HASH = 35;

function isAlpha(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
}

function isNameChar(c: number): boolean {
  return isAlpha(c) || c === AT;
}

function isSpace(c: number): boolean {
  return c === SP || c === TAB || c === CR;
}

/** Offsets → 1-based lines. */
class LineIndex {
  readonly starts: number[] = [0];
  constructor(readonly text: string) {
    let i = -1;
    while ((i = text.indexOf('\n', i + 1)) !== -1) this.starts.push(i + 1);
  }
  line(offset: number): number {
    const s = this.starts;
    let lo = 0;
    let hi = s.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (s[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  }
  lineText(line: number): string {
    const start = this.starts[line - 1] ?? 0;
    const next = this.starts[line];
    return this.text.slice(start, next === undefined ? undefined : next - 1);
  }
}

/** Skip spaces/tabs and at most one newline (a blank line = \par stops argument scanning). */
function skipWs(s: string, i: number): number {
  let nl = false;
  const n = s.length;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (isSpace(c)) i++;
    else if (c === NL) {
      if (nl) return i;
      nl = true;
      i++;
    } else break;
  }
  return i;
}

/** Skip spaces and tabs only. */
function skipBlanks(s: string, i: number): number {
  while (i < s.length && isSpace(s.charCodeAt(i))) i++;
  return i;
}

interface Group {
  /** Offset of the opening delimiter. */
  start: number;
  /** Offset just after the closing delimiter. */
  end: number;
  content: string;
}

function isParAhead(s: string, nlPos: number): boolean {
  let k = nlPos + 1;
  while (k < s.length && isSpace(s.charCodeAt(k))) k++;
  return k < s.length && s.charCodeAt(k) === NL;
}

/**
 * Read a balanced `{…}` group starting exactly at `i`. Returns null if there is
 * no group, it is unbalanced, longer than `maxLen`, or (with `short`) spans a
 * blank line (TeX would raise "Paragraph ended before … was complete").
 */
function readBraced(s: string, i: number, short = false, maxLen = short ? 4000 : Infinity): Group | null {
  if (s.charCodeAt(i) !== LB) return null;
  let depth = 0;
  const limit = Math.min(s.length, i + maxLen);
  for (let j = i; j < limit; j++) {
    const c = s.charCodeAt(j);
    if (c === BS) j++;
    else if (c === LB) depth++;
    else if (c === RB) {
      if (--depth === 0) return { start: i, end: j + 1, content: s.slice(i + 1, j) };
    } else if (short && c === NL && isParAhead(s, j)) return null;
  }
  return null;
}

/** Read `[…]` (brackets do not nest in LaTeX optional arguments, braces protect `]`). */
function readBracket(s: string, i: number, open = LSQ, close = RSQ): Group | null {
  if (s.charCodeAt(i) !== open) return null;
  let depth = 0;
  const limit = Math.min(s.length, i + 4000);
  for (let j = i + 1; j < limit; j++) {
    const c = s.charCodeAt(j);
    if (c === BS) j++;
    else if (c === LB) depth++;
    else if (c === RB) depth = Math.max(0, depth - 1);
    else if (c === close && depth === 0) return { start: i, end: j + 1, content: s.slice(i + 1, j) };
    else if (c === NL && isParAhead(s, j)) return null;
  }
  return null;
}

/** Skip whitespace and read an optional `[…]` argument. */
function optArg(s: string, i: number): Group | null {
  return readBracket(s, skipWs(s, i));
}

/** Skip whitespace and read a mandatory `{…}` argument. */
function reqArg(s: string, i: number, short = true): Group | null {
  return readBraced(s, skipWs(s, i), short);
}

/** Skip any number of `[…]` and `<…>` (beamer overlay) arguments. */
function skipOptionals(s: string, i: number, overlays = false): number {
  for (;;) {
    const j = skipWs(s, i);
    const c = s.charCodeAt(j);
    let g: Group | null = null;
    if (c === LSQ) g = readBracket(s, j);
    else if (overlays && c === LT) g = readBracket(s, j, LT, GT);
    if (!g) return i;
    i = g.end;
  }
}

function readStar(s: string, i: number): { star: boolean; pos: number } {
  const j = skipBlanks(s, i);
  return s.charCodeAt(j) === STAR ? { star: true, pos: j + 1 } : { star: false, pos: i };
}

/** Read a control sequence name `\foo` (or `{\foo}`) at `i`; returns the name without backslash. */
function readCsName(s: string, i: number): { name: string; end: number } | null {
  let j = skipWs(s, i);
  if (s.charCodeAt(j) === LB) {
    const g = readBraced(s, j, true, 200);
    if (!g) return null;
    const inner = g.content.trim();
    if (inner.charCodeAt(0) !== BS) return null;
    const ne = nameEnd(inner, 1);
    const name = ne > 1 ? inner.slice(1, ne) : inner.slice(1, 2);
    return name ? { name, end: g.end } : null;
  }
  if (s.charCodeAt(j) !== BS) return null;
  j++;
  const ne = nameEnd(s, j);
  if (ne > j) return { name: s.slice(j, ne), end: ne };
  if (j < s.length) return { name: s[j], end: j + 1 };
  return null;
}

function nameEnd(s: string, i: number): number {
  let j = i;
  while (j < s.length && isNameChar(s.charCodeAt(j))) j++;
  return j;
}

function splitList(v: string): string[] {
  const out: string[] = [];
  for (const part of v.split(',')) {
    const t = part.trim();
    if (t) out.push(t);
  }
  return out;
}

function collapse(v: string): string {
  return v.replace(/\s+/g, ' ').trim();
}

function truncate(v: string, max: number): string {
  return v.length > max ? v.slice(0, max - 1).trimEnd() + '…' : v;
}

// ═══════════════════════════════ masking ═══════════════════════════════

/** Environments whose body is read verbatim (no comments, no commands). */
export const VERBATIM_ENVIRONMENTS: ReadonlySet<string> = new Set([
  'verbatim', 'verbatim*', 'Verbatim', 'Verbatim*', 'BVerbatim', 'BVerbatim*', 'LVerbatim', 'LVerbatim*',
  'SaveVerbatim', 'VerbatimOut', 'spverbatim', 'lstlisting', 'minted', 'comment', 'filecontents',
  'filecontents*', 'luacode', 'luacode*', 'pycode', 'pyblock', 'pyverbatim', 'pyconsole', 'sageblock',
  'sagesilent', 'sageverbatim', 'sagecommandline', 'asy', 'asydef', 'gnuplot', 'tcblisting', 'markdown',
  'codeblock', 'dot2tex', 'verbatimtab', 'listingcont', 'boxedverbatim', 'framedverbatim',
]);

const VERB_LIKE = new Set(['verb', 'Verb', 'spverb', 'lstinline', 'mintinline', 'verbatim@nolig@list']);
const URL_LIKE = new Set(['url', 'nolinkurl', 'path', 'href', 'urlstyle']);

function blank(s: string, from: number, to: number): string {
  let out = '';
  let last = from;
  for (let i = from; i < to; i++) {
    if (s.charCodeAt(i) === NL) {
      out += ' '.repeat(i - last) + '\n';
      last = i + 1;
    }
  }
  return out + ' '.repeat(to - last);
}

/**
 * Return a copy of `src` with the same length and line structure where
 * comments (`%` not preceded by an escaping `\`; the `%` itself is kept so a
 * comment-only line is not mistaken for a blank line) and the bodies of
 * verbatim-like constructs (`verbatim`, `lstlisting`, `minted`, `comment`
 * environments, `\verb|…|`, `\lstinline`, `\url{…}`, the URL of `\href`…) are
 * replaced by spaces.
 */
export function maskLatex(src: string): string {
  const n = src.length;
  const parts: string[] = [];
  let last = 0;
  const mask = (from: number, to: number) => {
    if (to <= from) return;
    parts.push(src.slice(last, from), blank(src, from, to));
    last = to;
  };
  const re = /[\\%]/g;
  let i = 0;
  while (i < n) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) break;
    i = m.index;
    if (src.charCodeAt(i) === PCT) {
      let e = src.indexOf('\n', i);
      if (e === -1) e = n;
      mask(i + 1, e);
      i = e;
      continue;
    }
    // Backslash.
    if (!isAlpha(src.charCodeAt(i + 1))) {
      i += 2;
      continue;
    }
    let j = i + 1;
    while (j < n && isAlpha(src.charCodeAt(j))) j++;
    const name = src.slice(i + 1, j);
    if (name === 'begin') {
      const k = skipBlanks(src, j);
      if (src.charCodeAt(k) === LB) {
        const close = src.indexOf('}', k);
        if (close !== -1 && close - k < 64) {
          const env = src.slice(k + 1, close);
          if (VERBATIM_ENVIRONMENTS.has(env)) {
            const endTok = `\\end{${env}}`;
            let e = src.indexOf(endTok, close + 1);
            if (e === -1) e = n;
            mask(close + 1, e);
            i = e === n ? n : e + endTok.length;
            continue;
          }
        }
      }
      i = j;
      continue;
    }
    if (VERB_LIKE.has(name)) {
      i = maskVerb(src, name, j, mask);
      continue;
    }
    if (URL_LIKE.has(name) && name !== 'urlstyle') {
      const k = skipWs(src, j);
      const c = src.charCodeAt(k);
      if (c === LB) {
        const g = readBraced(src, k, true);
        if (g) {
          mask(g.start + 1, g.end - 1);
          i = g.end;
          continue;
        }
      } else if (name !== 'href' && c && !isAlpha(c) && !isSpace(c) && c !== NL) {
        i = maskDelimited(src, k, mask);
        continue;
      }
    }
    i = j;
  }
  if (last === 0) return src;
  parts.push(src.slice(last));
  return parts.join('');
}

function maskDelimited(src: string, k: number, mask: (a: number, b: number) => void): number {
  const d = src[k];
  const nl = src.indexOf('\n', k + 1);
  let e = src.indexOf(d, k + 1);
  if (e === -1 || (nl !== -1 && e > nl)) e = nl === -1 ? src.length : nl;
  mask(k + 1, e);
  return Math.min(src.length, e + 1);
}

function maskVerb(src: string, name: string, j: number, mask: (a: number, b: number) => void): number {
  let k = j;
  if (name === 'verb' || name === 'Verb' || name === 'spverb') {
    if (src.charCodeAt(k) === STAR) k++;
  }
  if (name === 'lstinline' || name === 'mintinline' || name === 'Verb') {
    const o = readBracket(src, skipBlanks(src, k));
    if (o) k = o.end;
  }
  if (name === 'mintinline') {
    const lang = readBraced(src, skipBlanks(src, k), true);
    if (lang) k = lang.end;
  }
  if (name !== 'verb' && name !== 'spverb') k = skipBlanks(src, k);
  const c = src.charCodeAt(k);
  if (Number.isNaN(c) || c === NL || isAlpha(c)) return j;
  if (c === LB && name !== 'verb' && name !== 'spverb') {
    const g = readBraced(src, k, true);
    if (g) {
      mask(g.start + 1, g.end - 1);
      return g.end;
    }
    return j;
  }
  return maskDelimited(src, k, mask);
}

// ═══════════════════════════════ magic comments ═══════════════════════════════

/**
 * Parse `% !TEX program = xelatex`, `% !TeX TS-program = lualatex`,
 * `% !TEX root = ../main.tex`, `% !TeX spellcheck = en_US`, `% !BIB program = biber`…
 * Keys are lower-cased with spaces replaced by '-'; `ts-program` is also
 * exposed as `program`, BIB keys are prefixed with `bib-`. First occurrence wins.
 */
export function parseMagicComments(source: string): Record<string, string> {
  const magic: Record<string, string> = {};
  if (!source.includes('!')) return magic;
  const re = /^[ \t]*%+[ \t]*!(TEX|BIB)[ \t]+([^=\n]+?)[ \t]*=[ \t]*([^\n]*?)[ \t]*$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const prefix = m[1].toUpperCase() === 'BIB' ? 'bib-' : '';
    const key = prefix + m[2].toLowerCase().replace(/\s+/g, '-');
    const value = m[3].replace(/\r$/, '');
    if (!(key in magic)) magic[key] = value;
    const alias = key.replace(/(^|-)ts-program$/, '$1program');
    if (alias !== key && !(alias in magic)) magic[alias] = value;
  }
  return magic;
}

// ═══════════════════════════════ plain-text conversion ═══════════════════════════════

const DROP_WITH_ARGS = new Set([
  'label', 'index', 'footnote', 'footnotetext', 'thanks', 'glossary', 'marginpar', 'tag', 'hspace', 'vspace',
  'cite', 'citep', 'citet', 'nocite', 'parencite', 'textcite', 'autocite', 'footcite', 'ref', 'eqref', 'cref',
  'Cref', 'autoref', 'pageref', 'color', 'pagecolor', 'fontsize', 'setlength', 'includegraphics', 'todo',
  'hypertarget', 'phantom', 'hphantom', 'vphantom', 'rule',
]);
const DROP_NO_ARGS = new Set([
  'protect', 'newline', 'linebreak', 'nolinebreak', 'pagebreak', 'nopagebreak', 'nonumber', 'notag',
  'phantomsection', 'selectfont', 'centering', 'raggedright', 'raggedleft', 'noindent', 'footnotemark',
  'bfseries', 'itshape', 'mdseries', 'normalfont', 'rmfamily', 'sffamily', 'ttfamily', 'scshape', 'upshape',
  'slshape', 'em', 'bf', 'it', 'tt', 'sc', 'sf', 'rm', 'tiny', 'scriptsize', 'footnotesize', 'small',
  'normalsize', 'large', 'Large', 'LARGE', 'huge', 'Huge', 'relax', 'strut', 'leavevmode', 'smallskip',
  'medskip', 'bigskip', 'hfill', 'vfill', 'break', 'par', 'item',
]);
/** First mandatory argument dropped, the rest kept (`\textcolor{red}{Text}` → Text). */
const DROP_FIRST_ARG = new Set(['textcolor', 'href', 'texorpdfstring', 'foreignlanguage', 'colorbox', 'hyperlink', 'hyperref', 'textls']);
const SYMBOL_TEXT: Record<string, string> = {
  LaTeX: 'LaTeX', TeX: 'TeX', LaTeXe: 'LaTeX2ε', BibTeX: 'BibTeX', XeLaTeX: 'XeLaTeX', LuaLaTeX: 'LuaLaTeX',
  ldots: '…', dots: '…', textellipsis: '…', textendash: '–', textemdash: '—', S: '§', P: '¶',
  copyright: '©', textcopyright: '©', textregistered: '®', texttrademark: '™', textbackslash: '\\',
  textasciitilde: '~', textasciicircum: '^', textbar: '|', textless: '<', textgreater: '>', textbullet: '•',
  textdegree: '°', euro: '€', pounds: '£', textquoteleft: '‘', textquoteright: '’', textquotedblleft: '“',
  textquotedblright: '”', quad: ' ', qquad: ' ', enspace: ' ', today: '', ss: 'ß', ae: 'æ', AE: 'Æ',
  oe: 'œ', OE: 'Œ', aa: 'å', AA: 'Å', o: 'ø', O: 'Ø', l: 'ł', L: 'Ł', i: 'ı', j: 'ȷ', dag: '†', ddag: '‡',
  textdagger: '†', guillemotleft: '«', guillemotright: '»', S_: '§',
};
const ACCENT_MARKS: Record<string, string> = {
  "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', '=': '̄', '.': '̇',
  u: '̆', v: '̌', H: '̋', c: '̧', k: '̨', r: '̊', d: '̣', b: '̱',
};

/**
 * Convert a short LaTeX snippet (a title, a caption, a BibTeX field…) into
 * readable plain text: formatting commands are unwrapped, labels/footnotes
 * dropped, accents composed (`Erd\H{o}s` → Erdős), braces removed, inline
 * math kept verbatim, whitespace collapsed.
 */
export function latexToPlainText(raw: string): string {
  if (!/[\\{}~$%]/.test(raw)) return collapse(raw);
  const s = raw;
  const n = s.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === BS) {
      const c1 = s.charCodeAt(i + 1);
      if (isAlpha(c1)) {
        let j = i + 1;
        while (j < n && isAlpha(s.charCodeAt(j))) j++;
        const name = s.slice(i + 1, j);
        if (DROP_WITH_ARGS.has(name)) {
          let k = readStar(s, j).pos;
          k = skipOptionals(s, k);
          const g = reqArg(s, k, false);
          i = g ? g.end : k;
          if (name === 'rule') {
            const g2 = reqArg(s, i, false);
            if (g2) i = g2.end;
          }
          continue;
        }
        if (DROP_FIRST_ARG.has(name)) {
          let k = skipOptionals(s, j);
          const g = reqArg(s, k, false);
          i = g ? g.end : k;
          continue;
        }
        if (name.length === 1 && ACCENT_MARKS[name]) {
          const r = accentBase(s, j);
          if (r) {
            out += r.base + ACCENT_MARKS[name];
            i = r.end;
            continue;
          }
        }
        if (name in SYMBOL_TEXT) {
          out += SYMBOL_TEXT[name];
          i = j;
          // TeX swallows the space after a control word; `{}` is the usual separator.
          if (s.startsWith('{}', i)) i += 2;
          continue;
        }
        i = j;
        if (DROP_NO_ARGS.has(name)) continue;
        continue; // unknown command: drop the name, keep its arguments' text
      }
      if (i + 1 >= n) break;
      const sym = s[i + 1];
      if (ACCENT_MARKS[sym]) {
        const r = accentBase(s, i + 2);
        if (r) {
          out += r.base + ACCENT_MARKS[sym];
          i = r.end;
          continue;
        }
        i += 2;
        continue;
      }
      if (sym === '\\') {
        out += ' ';
        i += 2;
        const o = readBracket(s, skipBlanks(s, i));
        if (o) i = o.end;
        continue;
      }
      if ('&%$#_{}'.includes(sym)) out += sym;
      else if (',;: >'.includes(sym)) out += ' ';
      i += 2;
      continue;
    }
    if (c === DOLLAR) {
      const dbl = s.charCodeAt(i + 1) === DOLLAR;
      const close = findMathClose(s, i + (dbl ? 2 : 1), dbl);
      if (close !== -1) {
        out += s.slice(i, close);
        i = close;
        continue;
      }
      out += '$';
      i++;
      continue;
    }
    if (c === LB || c === RB) {
      i++;
      continue;
    }
    if (c === PCT) {
      const e = s.indexOf('\n', i);
      i = e === -1 ? n : e;
      continue;
    }
    if (c === 126 /* ~ */) {
      out += ' ';
      i++;
      continue;
    }
    if (c === 45 /* - */ && s.charCodeAt(i + 1) === 45) {
      if (s.charCodeAt(i + 2) === 45) {
        out += '—';
        i += 3;
      } else {
        out += '–';
        i += 2;
      }
      continue;
    }
    out += s[i];
    i++;
  }
  return collapse(out).normalize('NFC');
}

function accentBase(s: string, j: number): { base: string; end: number } | null {
  let k = j;
  while (k < s.length && s.charCodeAt(k) === SP) k++;
  if (s.charCodeAt(k) === LB) {
    const g = readBraced(s, k, true, 20);
    if (!g) return null;
    let inner = g.content.trim();
    if (inner === '\\i') inner = 'i';
    else if (inner === '\\j') inner = 'j';
    return { base: inner, end: g.end };
  }
  if (s.startsWith('\\i', k) && !isAlpha(s.charCodeAt(k + 2))) return { base: 'i', end: k + 2 };
  if (s.startsWith('\\j', k) && !isAlpha(s.charCodeAt(k + 2))) return { base: 'j', end: k + 2 };
  if (k < s.length && s.charCodeAt(k) !== BS) return { base: s[k], end: k + 1 };
  return null;
}

/** Index just after the closing `$`/`$$`, or -1 (stops at a blank line). */
function findMathClose(s: string, from: number, display: boolean): number {
  for (let j = from; j < s.length; j++) {
    const c = s.charCodeAt(j);
    if (c === BS) {
      j++;
      continue;
    }
    if (c === DOLLAR) {
      if (!display) return j + 1;
      if (s.charCodeAt(j + 1) === DOLLAR) return j + 2;
      return -1;
    }
    if (c === NL && isParAhead(s, j)) return -1;
  }
  return -1;
}

// ═══════════════════════════════ analyzeLatex ═══════════════════════════════

const SECTION_LEVELS: Record<string, number> = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6,
  addpart: 0, addchap: 1, addsec: 2,
};

const REF_COMMANDS = new Set([
  'ref', 'Ref', 'eqref', 'autoref', 'Autoref', 'pageref', 'nameref', 'Nameref', 'vref', 'Vref', 'vpageref',
  'fref', 'Fref', 'subref', 'autopageref', 'cref', 'Cref', 'cpageref', 'Cpageref', 'labelcref', 'labelcpageref',
  'namecref', 'nameCref', 'lcnamecref', 'namecrefs', 'nameCrefs', 'lcnamecrefs', 'zref', 'zcref',
]);
const REF_LIST_COMMANDS = new Set(['cref', 'Cref', 'cpageref', 'Cpageref', 'labelcref', 'labelcpageref', 'zcref']);
const REF_RANGE_COMMANDS = new Set(['crefrange', 'Crefrange', 'cpagerefrange', 'Cpagerefrange', 'vrefrange', 'vpagerefrange']);

const CITE_COMMANDS = new Set([
  'cite', 'Cite', 'citep', 'citet', 'Citep', 'Citet', 'citealt', 'citealp', 'Citealt', 'Citealp', 'citeauthor',
  'Citeauthor', 'citeyear', 'citeyearpar', 'citetitle', 'Citetitle', 'citeurl', 'citedate', 'citenum', 'citetext',
  'parencite', 'Parencite', 'textcite', 'Textcite', 'autocite', 'Autocite', 'footcite', 'Footcite', 'footcitetext',
  'smartcite', 'Smartcite', 'supercite', 'fullcite', 'footfullcite', 'nocite', 'notecite', 'Notecite', 'pnotecite',
  'Pnotecite', 'fnotecite', 'citeA', 'citeNP', 'citeANP', 'shortcite', 'shortciteA', 'shortciteNP', 'citeyearNP',
  'citeurl', 'cites', 'Cites', 'parencites', 'Parencites', 'textcites', 'Textcites', 'autocites', 'Autocites',
  'footcites', 'footcitetexts', 'smartcites', 'Smartcites', 'supercites', 'citelist',
]);
const MULTI_CITE = new Set([
  'cites', 'Cites', 'parencites', 'Parencites', 'textcites', 'Textcites', 'autocites', 'Autocites', 'footcites',
  'footcitetexts', 'smartcites', 'Smartcites', 'supercites',
]);
const VOL_CITE = new Set(['volcite', 'Volcite', 'pvolcite', 'Pvolcite', 'fvolcite', 'ftvolcite', 'svolcite', 'Svolcite', 'tvolcite', 'Tvolcite', 'avolcite', 'Avolcite']);

/** `\cmd[opts]{file}` style includes. */
const SIMPLE_INCLUDES = new Set([
  'input', 'include', 'subfile', 'includegraphics', 'addbibresource', 'addglobalbib', 'addsectionbib',
  'includepdf', 'lstinputlisting', 'verbatiminput', 'VerbatimInput', 'BVerbatimInput', 'LVerbatimInput',
  'includesvg', 'includestandalone', 'includeinkscape', 'loadglsentries', 'externaldocument', 'tikzfig',
  'inputtikz', 'includetikz', 'subfileinclude',
]);
const IMPORT_INCLUDES = new Set(['import', 'subimport', 'inputfrom', 'subinputfrom', 'includefrom', 'subincludefrom']);

const DEF_COMMANDS = new Set(['newcommand', 'renewcommand', 'providecommand', 'DeclareRobustCommand', 'newrobustcmd', 'renewrobustcmd', 'providerobustcmd']);
const DOC_COMMANDS = new Set([
  'NewDocumentCommand', 'RenewDocumentCommand', 'ProvideDocumentCommand', 'DeclareDocumentCommand',
  'NewExpandableDocumentCommand', 'RenewExpandableDocumentCommand', 'ProvideExpandableDocumentCommand',
  'DeclareExpandableDocumentCommand', 'NewCommandCopy', 'RenewCommandCopy', 'DeclareCommandCopy',
]);
const TEX_DEFS = new Set(['def', 'gdef', 'edef', 'xdef']);
const ENV_DEFS = new Set(['newenvironment', 'renewenvironment', 'provideenvironment']);
const DOC_ENV_DEFS = new Set(['NewDocumentEnvironment', 'RenewDocumentEnvironment', 'ProvideDocumentEnvironment', 'DeclareDocumentEnvironment']);

/** Environments whose `\label`s get a "row" context and are math. */
const MATH_ENVIRONMENTS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'flalign', 'flalign*', 'gather', 'gather*',
  'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'math', 'dmath', 'dmath*', 'subequations',
  'IEEEeqnarray', 'IEEEeqnarray*', 'xalignat', 'xxalignat',
]);
/** Environments that just wrap content; labels inside belong to the enclosing environment. */
const TRANSPARENT_ENVIRONMENTS = new Set([
  'center', 'flushleft', 'flushright', 'minipage', 'small', 'footnotesize', 'scriptsize', 'tiny', 'large',
  'Large', 'adjustbox', 'scope', 'tikzpicture', 'resizebox', 'scriptsize', 'normalsize', 'document', 'frame',
  'columns', 'column', 'split', 'aligned', 'gathered', 'cases', 'tabular', 'tabular*', 'tabularx', 'array',
  'threeparttable', 'tablenotes', 'landscape', 'sidewaystable', 'spacing', 'singlespace', 'onehalfspace',
  'doublespace',
]);
const LIST_ENVIRONMENTS = new Set(['itemize', 'enumerate', 'description', 'list', 'compactitem', 'compactenum', 'inparaenum', 'tasks']);
/** Environments whose optional argument is NOT a title. */
const NON_TITLE_OPT_ENVS = new Set([
  'figure', 'figure*', 'table', 'table*', 'wrapfigure', 'wraptable', 'subfigure', 'subtable', 'minipage',
  'itemize', 'enumerate', 'description', 'lstlisting', 'minted', 'tcolorbox', 'multicols', 'tabular',
  'tabular*', 'tabularx', 'longtable', 'algorithm', 'algorithmic', 'frame', 'columns', 'column', 'block',
  'tikzpicture', 'axis', 'adjustbox', 'mdframed', 'framed', 'subequations', 'alignat', 'alignat*', 'IEEEeqnarray',
]);

interface LabelRec {
  name: string;
  line: number;
  context?: string;
  offset?: number;
}

interface EnvFrame {
  name: string;
  begin: number;
  bodyStart: number;
  caption?: string;
  optTitle?: string;
  labels: LabelRec[];
  frameItem?: OutlineItem;
}

class Analyzer {
  readonly out: LatexAnalysis;
  readonly lines: LineIndex;
  readonly envs: EnvFrame[] = [];
  private lastSectionEnd = -1;
  private lastSectionContext = '';
  private openFrames: OutlineItem[] = [];

  constructor(readonly source: string, readonly s: string) {
    this.lines = new LineIndex(source);
    this.out = {
      outline: [],
      labels: [],
      refs: [],
      citations: [],
      includes: [],
      commands: [],
      environments: [],
      packages: [],
      magic: parseMagicComments(source),
    };
  }

  run(): LatexAnalysis {
    const s = this.s;
    const re = /\\(?:([A-Za-z@]+)|[^])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const name = m[1];
      if (!name) continue;
      const next = this.command(name, m.index, m.index + 1 + name.length);
      if (next > re.lastIndex) re.lastIndex = next;
    }
    while (this.envs.length) this.popEnv(s.length);
    for (const f of this.openFrames) if (!f.title) f.title = 'Untitled frame';
    return this.out;
  }

  private line(offset: number): number {
    return this.lines.line(offset);
  }

  /** Handle a control word; returns the offset to continue scanning from. */
  private command(name: string, start: number, after: number): number {
    const s = this.s;
    if (name in SECTION_LEVELS) return this.section(name, start, after);
    if (REF_COMMANDS.has(name)) return this.ref(name, start, after);
    if (CITE_COMMANDS.has(name)) return this.cite(name, start, after);
    if (SIMPLE_INCLUDES.has(name)) return this.include(name, start, after);
    switch (name) {
      case 'begin':
        return this.begin(start, after);
      case 'end':
        return this.end(start, after);
      case 'label':
        return this.label(start, after);
      case 'caption':
      case 'captionof':
      case 'subcaption':
      case 'subcaptionbox':
        return this.caption(name, after);
      case 'frametitle':
        return this.frametitle(start, after);
      case 'usepackage':
      case 'RequirePackage':
        return this.usepackage(start, after);
      case 'documentclass':
      case 'documentstyle':
        return this.documentclass(after);
      case 'title': {
        const o = optArg(s, after);
        const g = reqArg(s, o ? o.end : after);
        if (g && this.out.title === undefined) this.out.title = latexToPlainText(g.content);
        return after;
      }
      case 'graphicspath': {
        const g = reqArg(s, after);
        if (!g) return after;
        const paths: string[] = [];
        let k = 0;
        for (;;) {
          k = skipWs(g.content, k);
          const inner = readBraced(g.content, k, true);
          if (!inner) break;
          if (inner.content.trim()) paths.push(inner.content.trim());
          k = inner.end;
        }
        this.out.graphicsPath = [...(this.out.graphicsPath ?? []), ...paths];
        return g.end;
      }
      case 'bibliography': {
        const g = reqArg(s, after);
        if (!g) return after;
        for (const p of splitList(g.content)) this.addInclude('bibliography', p, start);
        return g.end;
      }
      case 'inputminted': {
        const o = optArg(s, after);
        const lang = reqArg(s, o ? o.end : after);
        if (!lang) return after;
        const f = reqArg(s, lang.end);
        if (f && f.content.trim()) this.addInclude(name, f.content.trim(), start);
        return f ? f.end : lang.end;
      }
      case 'hyperref': {
        const o = optArg(s, after);
        if (o) {
          const n = o.content.trim();
          if (n && !n.includes('#')) this.out.refs.push({ name: n, line: this.line(start), command: name, offset: start });
          return o.end;
        }
        return after;
      }
      case 'DeclareMathOperator':
        return this.mathOperator(start, after);
      case 'DeclarePairedDelimiter':
      case 'DeclarePairedDelimiterX':
      case 'DeclarePairedDelimiterXPP':
        return this.pairedDelimiter(name, start, after);
      case 'let':
        return this.letDef(start, after);
      case 'newtheorem':
        return this.newtheorem(start, after);
      case 'declaretheorem':
        return this.declaretheorem(start, after);
      case 'newtcolorbox':
      case 'renewtcolorbox':
      case 'DeclareTColorBox':
      case 'NewTColorBox':
      case 'RenewTColorBox':
      case 'ProvideTColorBox':
      case 'newtcbtheorem':
      case 'renewtcbtheorem':
      case 'newmdenv':
      case 'newmdtheoremenv':
      case 'lstnewenvironment':
      case 'newfloat':
      case 'DeclareFloatingEnvironment':
      case 'newlist':
      case 'newminted':
        return this.packageEnv(name, start, after);
    }
    if (DEF_COMMANDS.has(name)) return this.newcommand(start, after);
    if (DOC_COMMANDS.has(name)) return this.documentCommand(name, start, after);
    if (TEX_DEFS.has(name)) return this.texDef(start, after);
    if (ENV_DEFS.has(name)) return this.newenvironment(start, after);
    if (DOC_ENV_DEFS.has(name)) return this.documentEnvironment(start, after);
    if (IMPORT_INCLUDES.has(name)) return this.importInclude(name, start, after);
    if (VOL_CITE.has(name)) return this.volcite(name, start, after);
    if (REF_RANGE_COMMANDS.has(name)) return this.refRange(name, start, after);
    return after;
  }

  // ─────────────── structure ───────────────

  private section(name: string, start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    let k = st.pos;
    const short = optArg(s, k);
    if (short) k = short.end;
    const g = reqArg(s, k);
    if (!g) return k;
    const title = latexToPlainText(g.content);
    if (title.includes('#')) return g.end; // inside a macro definition
    const item: OutlineItem = {
      level: SECTION_LEVELS[name],
      kind: name,
      title,
      line: this.line(start),
      starred: st.star || name.startsWith('add'),
      offset: start,
    };
    if (short) item.shortTitle = latexToPlainText(short.content);
    this.out.outline.push(item);
    this.lastSectionEnd = g.end;
    this.lastSectionContext = `${name}: ${title}`;
    // Scan inside the title too (labels/refs in titles), so return the brace start.
    return g.start + 1;
  }

  private begin(start: number, after: number): number {
    const s = this.s;
    const g = readBraced(s, skipBlanks(s, after), true, 100);
    if (!g) return after;
    const name = g.content.trim();
    if (!name) return g.end;
    const frame: EnvFrame = { name, begin: start, bodyStart: g.end, labels: [] };
    this.envs.push(frame);
    if (name === 'frame') {
      let k = skipOptionals(s, g.end, true);
      const t = readBraced(s, skipWs(s, k), true);
      const item: OutlineItem = {
        level: -1,
        kind: 'frame',
        title: t ? latexToPlainText(t.content) : '',
        line: this.line(start),
        starred: false,
        offset: start,
      };
      if (item.title.includes('#')) return g.end;
      frame.frameItem = item;
      this.out.outline.push(item);
      this.openFrames.push(item);
      return g.end;
    }
    if (!NON_TITLE_OPT_ENVS.has(name) && !MATH_ENVIRONMENTS.has(name)) {
      const o = readBracket(s, skipBlanks(s, g.end));
      if (o && !o.content.includes('=')) frame.optTitle = latexToPlainText(o.content);
    }
    return g.end;
  }

  private end(start: number, after: number): number {
    const g = readBraced(this.s, skipBlanks(this.s, after), true, 100);
    if (!g) return after;
    const name = g.content.trim();
    for (let i = this.envs.length - 1; i >= 0; i--) {
      if (this.envs[i].name === name) {
        while (this.envs.length > i) this.popEnv(start);
        break;
      }
    }
    return g.end;
  }

  private popEnv(endOffset: number): void {
    const f = this.envs.pop()!;
    if (f.frameItem && !f.frameItem.title) f.frameItem.title = 'Untitled frame';
    for (const l of f.labels) l.context = this.envContext(f, l, endOffset);
  }

  private envContext(f: EnvFrame, l: LabelRec, endOffset: number): string {
    const s = this.s;
    const name = f.name;
    if (MATH_ENVIRONMENTS.has(name)) {
      const body = s.slice(f.bodyStart, Math.max(f.bodyStart, endOffset));
      const rel = (l.offset ?? f.bodyStart) - f.bodyStart;
      let a = body.lastIndexOf('\\\\', rel);
      a = a === -1 ? 0 : a + 2;
      let b = body.indexOf('\\\\', rel);
      if (b === -1) b = body.length;
      const row = collapse(
        body
          .slice(a, b)
          .replace(/\\label\s*\{[^}]*\}/g, ' ')
          .replace(/\\(?:nonumber|notag)\b/g, ' ')
          .replace(/&/g, ' '),
      );
      return row ? `${name}: ${truncate(row, 60)}` : name;
    }
    if (f.caption) return `${name}: ${truncate(f.caption, 80)}`;
    if (f.optTitle) return `${name}: ${truncate(f.optTitle, 80)}`;
    if (LIST_ENVIRONMENTS.has(name)) {
      const text = this.lineContext(l);
      return text ? `${name}: ${text}` : name;
    }
    const body = latexToPlainText(
      s.slice(f.bodyStart, Math.min(Math.max(f.bodyStart, endOffset), f.bodyStart + 600)).replace(/\\label\s*\{[^}]*\}/g, ' '),
    );
    return body ? `${name}: ${truncate(body, 60)}` : name;
  }

  private lineContext(l: LabelRec): string {
    const text = this.lines.lineText(l.line);
    const cleaned = latexToPlainText(maskLatex(text).replace(/\\label\s*\{[^}]*\}/g, ' ').replace(/^\s*\\item\b/, ''));
    return truncate(cleaned, 80);
  }

  private label(start: number, after: number): number {
    const g = reqArg(this.s, after);
    if (!g) return after;
    const name = g.content.trim();
    if (!name || name.includes('#')) return g.end;
    const rec: LabelRec = { name, line: this.line(start), offset: start };
    this.out.labels.push(rec);
    if (this.lastSectionEnd >= 0 && start - this.lastSectionEnd <= 256 && /^[\s%]*$/.test(this.s.slice(this.lastSectionEnd, start))) {
      rec.context = this.lastSectionContext;
      return g.end;
    }
    for (let i = this.envs.length - 1; i >= 0; i--) {
      const f = this.envs[i];
      if (TRANSPARENT_ENVIRONMENTS.has(f.name)) continue;
      f.labels.push(rec);
      return g.end;
    }
    const ctx = this.lineContext(rec);
    if (ctx) rec.context = ctx;
    return g.end;
  }

  private caption(name: string, after: number): number {
    const s = this.s;
    let k = after;
    if (name === 'captionof') {
      const st = readStar(s, k);
      const type = reqArg(s, st.pos);
      if (!type) return after;
      k = type.end;
    } else {
      k = readStar(s, k).pos;
    }
    const o = optArg(s, k);
    if (o) k = o.end;
    const g = reqArg(s, k, false);
    if (!g) return k;
    const text = latexToPlainText(g.content);
    for (let i = this.envs.length - 1; i >= 0; i--) {
      const f = this.envs[i];
      if (TRANSPARENT_ENVIRONMENTS.has(f.name) && i > 0) continue;
      if (!f.caption) f.caption = text;
      break;
    }
    return g.start + 1;
  }

  private frametitle(start: number, after: number): number {
    const s = this.s;
    const k = skipOptionals(s, after, true);
    const g = reqArg(s, k);
    if (!g) return k;
    const title = latexToPlainText(g.content);
    if (title.includes('#')) return g.end;
    for (let i = this.envs.length - 1; i >= 0; i--) {
      const f = this.envs[i];
      if (f.name !== 'frame') continue;
      if (f.frameItem && !f.frameItem.title) f.frameItem.title = title;
      return g.end;
    }
    // `\frame{\frametitle{…} …}` syntax.
    this.out.outline.push({ level: -1, kind: 'frame', title, line: this.line(start), starred: false, offset: start });
    return g.end;
  }

  // ─────────────── references & citations ───────────────

  private ref(name: string, start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    const k = skipOptionals(s, st.pos);
    const g = reqArg(s, k);
    if (!g) return k;
    const command = st.star ? name + '*' : name;
    const names = REF_LIST_COMMANDS.has(name) ? splitList(g.content) : [g.content.trim()];
    const line = this.line(start);
    for (const n of names) if (n && !n.includes('#')) this.out.refs.push({ name: n, line, command, offset: start });
    return g.end;
  }

  private refRange(name: string, start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    const a = reqArg(s, st.pos);
    if (!a) return after;
    const b = reqArg(s, a.end);
    const line = this.line(start);
    for (const g of b ? [a, b] : [a]) {
      const n = g.content.trim();
      if (n && !n.includes('#')) this.out.refs.push({ name: n, line, command: name, offset: start });
    }
    return (b ?? a).end;
  }

  private cite(name: string, start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    const command = st.star ? name + '*' : name;
    let k = st.pos;
    const keys: string[] = [];
    if (MULTI_CITE.has(name)) {
      // (pre)(post) global notes
      for (let n = 0; n < 2; n++) {
        const p = readBracket(s, skipWs(s, k), LP, RP);
        if (!p) break;
        k = p.end;
      }
      for (;;) {
        const kk = skipOptionals(s, k);
        const g = reqArg(s, kk);
        if (!g) break;
        keys.push(...splitList(g.content));
        k = g.end;
      }
    } else {
      k = skipOptionals(s, k);
      const g = reqArg(s, k);
      if (!g) return k;
      keys.push(...splitList(g.content));
      k = g.end;
    }
    const clean = keys.filter((x) => !x.includes('#'));
    if (clean.length) this.out.citations.push({ keys: clean, line: this.line(start), command, offset: start });
    return k;
  }

  private volcite(name: string, start: number, after: number): number {
    const s = this.s;
    let k = skipOptionals(s, after);
    const vol = reqArg(s, k);
    if (!vol) return after;
    k = skipOptionals(s, vol.end);
    const key = reqArg(s, k);
    if (!key) return vol.end;
    const keys = splitList(key.content).filter((x) => !x.includes('#'));
    if (keys.length) this.out.citations.push({ keys, line: this.line(start), command: name, offset: start });
    return key.end;
  }

  // ─────────────── includes ───────────────

  private addInclude(command: string, path: string, start: number) {
    if (!path || path.includes('#')) return;
    this.out.includes.push({ command, path, line: this.line(start), offset: start });
  }

  private include(name: string, start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    let k = skipOptionals(s, st.pos);
    const j = skipWs(s, k);
    if (s.charCodeAt(j) === LB) {
      const g = readBraced(s, j, true);
      if (!g) return k;
      this.addInclude(name, g.content.trim(), start);
      return g.end;
    }
    if (name === 'input') {
      // TeX primitive syntax: `\input chapters/intro`
      const m = /^[ \t]+([A-Za-z0-9_.\/-]+)/.exec(s.slice(after, after + 300));
      if (m) {
        this.addInclude(name, m[1], start);
        return after + m[0].length;
      }
    }
    return k;
  }

  private importInclude(name: string, start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    const dir = reqArg(s, st.pos);
    if (!dir) return after;
    const file = reqArg(s, dir.end);
    if (!file) return dir.end;
    const d = dir.content.trim();
    const f = file.content.trim();
    const path = !d ? f : d.endsWith('/') ? d + f : `${d}/${f}`;
    this.addInclude(name, path, start);
    return file.end;
  }

  // ─────────────── packages ───────────────

  private usepackage(start: number, after: number): number {
    const s = this.s;
    const o = optArg(s, after);
    const g = reqArg(s, o ? o.end : after);
    if (!g) return after;
    const options = o ? collapse(o.content) : undefined;
    const line = this.line(start);
    for (const p of splitList(g.content)) {
      if (p.includes('#')) continue;
      const rec: LatexAnalysis['packages'][number] = { name: p, line, offset: start };
      if (options) rec.options = options;
      this.out.packages.push(rec);
    }
    return g.end;
  }

  private documentclass(after: number): number {
    const s = this.s;
    const o = optArg(s, after);
    const g = reqArg(s, o ? o.end : after);
    if (!g) return after;
    if (!this.out.documentClass) {
      const dc: { name: string; options?: string } = { name: g.content.trim() };
      if (o && collapse(o.content)) dc.options = collapse(o.content);
      this.out.documentClass = dc;
    }
    return g.end;
  }

  // ─────────────── definitions ───────────────

  private addCommand(name: string, args: number, start: number, optionalArg = false) {
    const rec: LatexAnalysis['commands'][number] = { name, args, line: this.line(start), offset: start };
    if (optionalArg) rec.optionalArg = true;
    this.out.commands.push(rec);
  }

  private addEnvironment(name: string, start: number, extra: { args?: number; title?: string } = {}) {
    if (!name || name.includes('#') || name.includes('\\')) return;
    const rec: LatexAnalysis['environments'][number] = { name, line: this.line(start), offset: start };
    if (extra.args !== undefined) rec.args = extra.args;
    if (extra.title) rec.title = extra.title;
    this.out.environments.push(rec);
  }

  /** Skip `n` brace groups (bodies), returning the position after the last one found. */
  private skipBodies(k: number, n: number): number {
    for (let i = 0; i < n; i++) {
      const g = readBraced(this.s, skipWs(this.s, k));
      if (!g) return k;
      k = g.end;
    }
    return k;
  }

  private newcommand(start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    const cs = readCsName(s, st.pos);
    if (!cs) return after;
    let k = cs.end;
    let args = 0;
    let optional = false;
    const n = optArg(s, k);
    if (n) {
      args = Math.max(0, Math.min(9, parseInt(n.content.trim(), 10) || 0));
      k = n.end;
      const d = optArg(s, k);
      if (d) {
        optional = true;
        k = d.end;
      }
    }
    this.addCommand(cs.name, args, start, optional);
    return this.skipBodies(k, 1);
  }

  private documentCommand(name: string, start: number, after: number): number {
    const s = this.s;
    const cs = readCsName(s, after);
    if (!cs) return after;
    if (name.endsWith('CommandCopy')) {
      this.addCommand(cs.name, 0, start);
      return cs.end;
    }
    const spec = reqArg(s, cs.end, false);
    if (!spec) return cs.end;
    const { args, optionalFirst } = countXparseArgs(spec.content);
    this.addCommand(cs.name, args, start, optionalFirst);
    return this.skipBodies(spec.end, 1);
  }

  private texDef(start: number, after: number): number {
    const s = this.s;
    let k = skipWs(s, after);
    let name: string;
    if (s.charCodeAt(k) === BS) {
      const ne = nameEnd(s, k + 1);
      name = ne > k + 1 ? s.slice(k + 1, ne) : s.slice(k + 1, k + 2);
      k = ne > k + 1 ? ne : k + 2;
    } else if (s[k] === '~') {
      name = '~';
      k++;
    } else return after;
    // Parameter text up to the body's `{`.
    let args = 0;
    const limit = Math.min(s.length, k + 300);
    let j = k;
    for (; j < limit; j++) {
      const c = s.charCodeAt(j);
      if (c === LB) break;
      if (c === HASH) {
        const d = s.charCodeAt(j + 1) - 48;
        if (d >= 1 && d <= 9) args = Math.max(args, d);
      }
      if (c === BS) j++;
    }
    if (s.charCodeAt(j) !== LB) return k;
    if (name && name !== '~' && !name.includes('@')) this.addCommand(name, args, start);
    const body = readBraced(s, j);
    return body ? body.end : j + 1;
  }

  private letDef(start: number, after: number): number {
    const s = this.s;
    const k = skipWs(s, after);
    if (s.charCodeAt(k) !== BS) return after;
    const ne = nameEnd(s, k + 1);
    if (ne === k + 1) return after;
    const name = s.slice(k + 1, ne);
    if (!name.includes('@')) this.addCommand(name, 0, start);
    // Skip the target so `\let\a\b` doesn't register `\b` as anything.
    let j = skipBlanks(s, ne);
    if (s[j] === '=') j = skipBlanks(s, j + 1);
    if (s.charCodeAt(j) === BS) {
      const e = nameEnd(s, j + 1);
      return e > j + 1 ? e : j + 2;
    }
    return ne;
  }

  private mathOperator(start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    const cs = readCsName(s, st.pos);
    if (!cs) return after;
    this.addCommand(cs.name, 0, start);
    return this.skipBodies(cs.end, 1);
  }

  private pairedDelimiter(name: string, start: number, after: number): number {
    const s = this.s;
    const cs = readCsName(s, after);
    if (!cs) return after;
    let k = cs.end;
    let args = 1;
    if (name !== 'DeclarePairedDelimiter') {
      const n = optArg(s, k);
      if (n) {
        args = parseInt(n.content.trim(), 10) || 0;
        k = n.end;
      }
    }
    this.addCommand(cs.name, args, start);
    const bodies = name === 'DeclarePairedDelimiter' ? 2 : name === 'DeclarePairedDelimiterX' ? 3 : 5;
    return this.skipBodies(k, bodies);
  }

  private newenvironment(start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    const g = reqArg(s, st.pos);
    if (!g) return after;
    let k = g.end;
    let args = 0;
    const n = optArg(s, k);
    if (n) {
      args = parseInt(n.content.trim(), 10) || 0;
      k = n.end;
      const d = optArg(s, k);
      if (d) k = d.end;
    }
    this.addEnvironment(g.content.trim(), start, { args });
    return this.skipBodies(k, 2);
  }

  private documentEnvironment(start: number, after: number): number {
    const s = this.s;
    const g = reqArg(s, after);
    if (!g) return after;
    const spec = reqArg(s, g.end, false);
    if (!spec) return g.end;
    this.addEnvironment(g.content.trim(), start, { args: countXparseArgs(spec.content).args });
    return this.skipBodies(spec.end, 2);
  }

  private newtheorem(start: number, after: number): number {
    const s = this.s;
    const st = readStar(s, after);
    const g = reqArg(s, st.pos);
    if (!g) return after;
    let k = g.end;
    const counter = optArg(s, k);
    if (counter) k = counter.end;
    const t = reqArg(s, k);
    if (!t) return k;
    k = t.end;
    const within = optArg(s, k);
    if (within) k = within.end;
    this.addEnvironment(g.content.trim(), start, { title: latexToPlainText(t.content) });
    return k;
  }

  private declaretheorem(start: number, after: number): number {
    const s = this.s;
    let k = after;
    let opts = optArg(s, k);
    if (opts) k = opts.end;
    const g = reqArg(s, k);
    if (!g) return k;
    k = g.end;
    if (!opts) {
      opts = optArg(s, k);
      if (opts) k = opts.end;
    }
    for (const name of splitList(g.content)) {
      const m = opts && /(?:^|,)\s*(?:name|title)\s*=\s*(\{[^}]*\}|[^,]*)/.exec(opts.content);
      const title = m ? latexToPlainText(m[1]) : name.charAt(0).toUpperCase() + name.slice(1);
      this.addEnvironment(name, start, { title });
    }
    return k;
  }

  private packageEnv(cmd: string, start: number, after: number): number {
    const s = this.s;
    let k = after;
    if (cmd !== 'newminted' && cmd !== 'newlist' && cmd !== 'newfloat') {
      const o = optArg(s, k); // [init options]
      if (o) k = o.end;
    }
    const g = reqArg(s, k);
    if (!g) return k;
    k = g.end;
    const name = g.content.trim();
    switch (cmd) {
      case 'newtcbtheorem':
      case 'renewtcbtheorem': {
        const t = reqArg(s, k);
        this.addEnvironment(name, start, { args: 2, title: t ? latexToPlainText(t.content) : undefined });
        return t ? this.skipBodies(t.end, 2) : k;
      }
      case 'newtcolorbox':
      case 'renewtcolorbox': {
        let args = 0;
        const n = optArg(s, k);
        if (n) {
          args = parseInt(n.content.trim(), 10) || 0;
          k = n.end;
          const d = optArg(s, k);
          if (d) k = d.end;
        }
        this.addEnvironment(name, start, { args });
        return this.skipBodies(k, 1);
      }
      case 'DeclareTColorBox':
      case 'NewTColorBox':
      case 'RenewTColorBox':
      case 'ProvideTColorBox': {
        const spec = reqArg(s, k, false);
        this.addEnvironment(name, start, { args: spec ? countXparseArgs(spec.content).args : 0 });
        return spec ? this.skipBodies(spec.end, 1) : k;
      }
      case 'newmdtheoremenv': {
        const counter = optArg(s, k);
        if (counter) k = counter.end;
        const t = reqArg(s, k);
        this.addEnvironment(name, start, { title: t ? latexToPlainText(t.content) : undefined });
        return t ? t.end : k;
      }
      case 'lstnewenvironment': {
        let args = 0;
        const n = optArg(s, k);
        if (n) {
          args = parseInt(n.content.trim(), 10) || 0;
          k = n.end;
          const d = optArg(s, k);
          if (d) k = d.end;
        }
        this.addEnvironment(name, start, { args });
        return this.skipBodies(k, 2);
      }
      case 'newminted': {
        // \newminted{python}{opts} → environment `pythoncode`; \newminted[name]{lang}{opts}
        this.addEnvironment(`${name}code`, start);
        return this.skipBodies(k, 1);
      }
      default:
        this.addEnvironment(name, start);
        return k;
    }
  }
}

/** Count arguments of an xparse/ltcmd argument specification such as `s o m O{x} D<>{}`. */
export function countXparseArgs(spec: string): { args: number; optionalFirst: boolean } {
  let args = 0;
  let optionalFirst = false;
  const n = spec.length;
  let i = 0;
  const skipToken = () => {
    i = skipWs(spec, i);
    if (spec.charCodeAt(i) === BS) {
      const e = nameEnd(spec, i + 1);
      i = e > i + 1 ? e : i + 2;
    } else if (spec.charCodeAt(i) === LB) {
      const g = readBraced(spec, i);
      i = g ? g.end : i + 1;
    } else i++;
  };
  const group = (): string => {
    i = skipWs(spec, i);
    const g = readBraced(spec, i);
    if (g) {
      i = g.end;
      return g.content;
    }
    return '';
  };
  const count = (optional: boolean, k = 1) => {
    if (args === 0 && optional) optionalFirst = true;
    args += k;
  };
  while (i < n) {
    const c = spec[i++];
    switch (c) {
      case '+':
      case '!':
      case ' ':
      case '\t':
      case '\n':
        break;
      case '>':
      case '=':
        group();
        break;
      case 'm':
      case 'v':
      case 'b':
      case 'l':
        count(false);
        break;
      case 'o':
      case 'g':
      case 's':
        count(true);
        break;
      case 't':
        skipToken();
        count(true);
        break;
      case 'r':
        skipToken();
        skipToken();
        count(false);
        break;
      case 'd':
        skipToken();
        skipToken();
        count(true);
        break;
      case 'R':
        skipToken();
        skipToken();
        group();
        count(false);
        break;
      case 'D':
        skipToken();
        skipToken();
        group();
        count(true);
        break;
      case 'O':
      case 'G':
        group();
        count(true);
        break;
      case 'u':
        if (spec.charCodeAt(skipWs(spec, i)) === LB) group();
        else skipToken();
        count(false);
        break;
      case 'e': {
        const toks = group();
        count(true, Math.max(1, countTokens(toks)));
        break;
      }
      case 'E': {
        const toks = group();
        group();
        count(true, Math.max(1, countTokens(toks)));
        break;
      }
      default:
        break;
    }
  }
  return { args: Math.min(args, 9), optionalFirst };
}

function countTokens(t: string): number {
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (isSpace(c) || c === NL) continue;
    if (c === BS) {
      const e = nameEnd(t, i + 1);
      i = e > i + 1 ? e - 1 : i + 1;
    }
    n++;
  }
  return n;
}

/**
 * Analyse a LaTeX source file: outline, labels (with context), references,
 * citations, includes, user-defined commands/environments, packages, document
 * class and magic comments. Commented-out text and verbatim content are ignored;
 * the bodies of macro definitions are not scanned.
 */
export function analyzeLatex(source: string): LatexAnalysis {
  return new Analyzer(source, maskLatex(source)).run();
}

// ═══════════════════════════════ BibTeX ═══════════════════════════════

const MONTHS: Record<string, string> = {
  jan: 'January', feb: 'February', mar: 'March', apr: 'April', may: 'May', jun: 'June',
  jul: 'July', aug: 'August', sep: 'September', oct: 'October', nov: 'November', dec: 'December',
};

/** Fields not inherited through `crossref` (BibTeX copies everything else that is missing). */
const NON_INHERITED = new Set(['crossref', 'xref', 'ids', 'entryset', 'related', 'relatedtype', 'label', 'shorthand', 'sortkey', 'xdata', 'options', 'keywords']);
const PARENT_TITLE_TO_BOOKTITLE = new Set(['book', 'mvbook', 'collection', 'mvcollection', 'proceedings', 'mvproceedings', 'reference', 'mvreference', 'periodical']);

/**
 * Robust BibTeX/BibLaTeX parser. Supports `@string` macros (with `#`
 * concatenation and the predefined month macros), `@comment`, `@preamble`,
 * `{…}`/`(…)` entry delimiters, nested braces, quoted values, numbers, bare
 * macros, `crossref` inheritance and recovers from malformed entries by
 * resynchronising at the next `@type{` on a new line. Field names and entry
 * types are lower-cased; values have outer delimiters removed and whitespace
 * collapsed (inner braces and LaTeX are preserved). `line` is 1-based.
 */
export function parseBibtex(source: string): BibEntry[] {
  const entries: BibEntry[] = [];
  const macros = new Map<string, string>(Object.entries(MONTHS));
  const s = source;
  const n = s.length;
  let lineCursor = 0;
  let lineNo = 1;
  const lineOf = (pos: number) => {
    if (pos < lineCursor) {
      lineCursor = 0;
      lineNo = 1;
    }
    for (let i = s.indexOf('\n', lineCursor); i !== -1 && i < pos; i = s.indexOf('\n', i + 1)) lineNo++;
    lineCursor = pos;
    return lineNo;
  };

  let i = 0;
  while (i < n) {
    const at = s.indexOf('@', i);
    if (at === -1) break;
    let j = skipAllWs(s, at + 1);
    const typeStart = j;
    while (j < n && /[A-Za-z0-9_\-:]/.test(s[j])) j++;
    if (j === typeStart) {
      i = at + 1;
      continue;
    }
    const type = s.slice(typeStart, j).toLowerCase();
    j = skipAllWs(s, j);
    const open = s[j];
    if (open !== '{' && open !== '(') {
      i = j;
      continue;
    }
    const close = open === '{' ? '}' : ')';
    const line = lineOf(at);
    if (type === 'comment') {
      const g = open === '{' ? readBraced(s, j) : readBracket(s, j, LP, RP);
      i = g ? g.end : j + 1;
      continue;
    }
    const p = new BibValueParser(s, j + 1, close, macros);
    if (type === 'preamble') {
      p.value();
      i = p.finish();
      continue;
    }
    if (type === 'string') {
      p.ws();
      const name = p.ident();
      p.ws();
      if (name && p.peek() === '=') {
        p.pos++;
        const v = p.value();
        if (v !== null) macros.set(name.toLowerCase(), v);
      }
      i = p.finish();
      continue;
    }
    // Regular entry: key, then fields.
    p.ws();
    const key = p.key();
    const fields: Record<string, string> = {};
    let ok = true;
    for (;;) {
      p.ws();
      const c = p.peek();
      if (c === ',') {
        p.pos++;
        continue;
      }
      if (c === close || c === '') break;
      const fname = p.ident();
      if (!fname) {
        ok = false;
        break;
      }
      p.ws();
      if (p.peek() !== '=') {
        // `@misc{key, flag}`-style junk: skip the token.
        if (p.peek() === close) break;
        ok = false;
        break;
      }
      p.pos++;
      const v = p.value();
      if (v === null) {
        ok = false;
        break;
      }
      fields[fname.toLowerCase()] = v;
    }
    if (key) entries.push({ key, type, fields, line });
    i = ok && !p.aborted ? p.finish() : p.resync(at + 1);
  }

  // crossref inheritance
  const byKey = new Map<string, BibEntry>();
  for (const e of entries) if (!byKey.has(e.key.toLowerCase())) byKey.set(e.key.toLowerCase(), e);
  for (const e of entries) {
    const ref = e.fields.crossref;
    if (!ref) continue;
    const parent = byKey.get(ref.trim().toLowerCase());
    if (!parent || parent === e) continue;
    if (PARENT_TITLE_TO_BOOKTITLE.has(parent.type) && parent.fields.title && !e.fields.booktitle) {
      e.fields.booktitle = parent.fields.title;
    }
    for (const [k, v] of Object.entries(parent.fields)) {
      if (NON_INHERITED.has(k) || k in e.fields) continue;
      if (k === 'title' && PARENT_TITLE_TO_BOOKTITLE.has(parent.type)) continue;
      e.fields[k] = v;
    }
  }
  return entries;
}

function skipAllWs(s: string, i: number): number {
  while (i < s.length) {
    const c = s.charCodeAt(i);
    if (c === SP || c === TAB || c === NL || c === CR) i++;
    else break;
  }
  return i;
}

class BibValueParser {
  aborted = false;
  constructor(
    readonly s: string,
    public pos: number,
    readonly close: string,
    readonly macros: Map<string, string>,
  ) {}

  peek(): string {
    return this.pos < this.s.length ? this.s[this.pos] : '';
  }

  /** Skip whitespace and `%` line comments (accepted by biber). */
  ws(): void {
    const s = this.s;
    for (;;) {
      this.pos = skipAllWs(s, this.pos);
      if (s.charCodeAt(this.pos) === PCT) {
        const e = s.indexOf('\n', this.pos);
        this.pos = e === -1 ? s.length : e + 1;
      } else return;
    }
  }

  ident(): string {
    const s = this.s;
    const start = this.pos;
    while (this.pos < s.length && !/[\s=,{}()"#%]/.test(s[this.pos])) this.pos++;
    return s.slice(start, this.pos);
  }

  key(): string {
    const s = this.s;
    const start = this.pos;
    while (this.pos < s.length) {
      const c = s[this.pos];
      if (c === ',' || c === this.close || c === '\n' || c === '\r' || c === '}' || c === '{') break;
      this.pos++;
    }
    return s.slice(start, this.pos).trim();
  }

  /** value := part ('#' part)* ; returns null on syntax error. */
  value(): string | null {
    let out = '';
    for (;;) {
      this.ws();
      const part = this.part();
      if (part === null) return null;
      out += part;
      this.ws();
      if (this.peek() === '#') {
        this.pos++;
        continue;
      }
      return collapse(out);
    }
  }

  private part(): string | null {
    const s = this.s;
    const c = this.peek();
    if (c === '{' || c === '"') {
      const quoted = c === '"';
      let depth = 0;
      const start = this.pos + 1;
      for (let j = this.pos + (quoted ? 1 : 0); j < s.length; j++) {
        const ch = s.charCodeAt(j);
        if (ch === BS) {
          // `\"u` inside a quoted value is an accent, not the end of the string.
          // (Braces are always counted, backslash or not, like BibTeX does.)
          if (quoted && depth === 0 && s.charCodeAt(j + 1) === 34 && isAlpha(s.charCodeAt(j + 2))) j++;
          continue;
        }
        if (ch === LB) depth++;
        else if (ch === RB) {
          depth--;
          if (!quoted && depth === 0) {
            this.pos = j + 1;
            return s.slice(start, j);
          }
          if (depth < 0) return null;
        } else if (quoted && ch === 34 && depth === 0) {
          this.pos = j + 1;
          return s.slice(start, j);
        } else if (ch === NL && looksLikeEntryStart(s, j + 1)) {
          // Unbalanced value swallowing the next entry: abort here.
          this.pos = j + 1;
          this.aborted = true;
          return null;
        }
      }
      this.pos = s.length;
      this.aborted = true;
      return null;
    }
    if (/[0-9]/.test(c)) {
      const start = this.pos;
      while (this.pos < s.length && /[0-9]/.test(s[this.pos])) this.pos++;
      return s.slice(start, this.pos);
    }
    const name = this.ident();
    if (!name) return null;
    const v = this.macros.get(name.toLowerCase());
    return v ?? name;
  }

  /** Position after the entry's closing delimiter (balanced). */
  finish(): number {
    const s = this.s;
    let depth = 0;
    for (let j = this.pos; j < s.length; j++) {
      const c = s[j];
      if (c === '\\') {
        j++;
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}' && depth > 0) depth--;
      else if (c === this.close && depth === 0) return j + 1;
      else if (c === '\n' && looksLikeEntryStart(s, j + 1)) return j + 1;
    }
    return s.length;
  }

  /** After an error: continue at the next line that starts a new entry. */
  resync(from: number): number {
    const s = this.s;
    let j = this.aborted ? Math.max(from, this.pos) : from;
    if (this.aborted && j > 0 && s.charCodeAt(j - 1) === NL && looksLikeEntryStart(s, j)) return j;
    for (;;) {
      const nl = s.indexOf('\n', j);
      if (nl === -1) return s.length;
      if (looksLikeEntryStart(s, nl + 1)) return nl + 1;
      j = nl + 1;
    }
  }
}

function looksLikeEntryStart(s: string, i: number): boolean {
  let k = i;
  while (k < s.length && (s.charCodeAt(k) === SP || s.charCodeAt(k) === TAB)) k++;
  if (s.charCodeAt(k) !== AT) return false;
  const m = /^@[ \t]*[A-Za-z]+[ \t]*[{(]/.exec(s.slice(k, k + 40));
  return !!m;
}

// ═══════════════════════════════ word count ═══════════════════════════════

type Cat = 0 | 1 | 2; // text | header | caption/other
const CAT_TEXT: Cat = 0;
const CAT_HEADER: Cat = 1;
const CAT_OTHER: Cat = 2;

const WC_HEADERS = new Set(['part', 'chapter', 'section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'addpart', 'addchap', 'addsec', 'frametitle', 'framesubtitle']);
const WC_OTHER = new Set(['caption', 'footnote', 'footnotetext', 'marginpar', 'thanks', 'subcaption', 'captionof', 'tablefootnote', 'sidenote', 'todo']);
/** Commands whose output glues to neighbouring text (`\textbf{bold}face` is one word). */
const WC_TRANSPARENT = new Set([
  'textbf', 'textit', 'emph', 'texttt', 'textsc', 'textsf', 'textrm', 'textup', 'textsl', 'textmd', 'textnormal',
  'underline', 'uline', 'mbox', 'hbox', 'text', 'textsuperscript', 'textsubscript', 'enquote', 'MakeUppercase',
  'MakeLowercase', 'uppercase', 'lowercase', 'textls', 'sout', 'xout', 'hl', 'so', 'st', 'ul', 'caps', 'emphasis',
  'u', 'v', 'H', 'c', 'k', 'r', 'd', 'b', 't', 'textcolor', 'colorbox', 'fcolorbox', 'foreignlanguage', 'href',
  'hyperlink', 'texorpdfstring', 'Verb', 'textquote', 'mintinline', 'lstinline', 'verb', 'url',
]);
const WC_LETTERS: Record<string, string> = {
  ss: 'ss', ae: 'ae', AE: 'AE', oe: 'oe', OE: 'OE', aa: 'a', AA: 'A', o: 'o', O: 'O', l: 'l', L: 'L', i: 'i', j: 'j',
};
/**
 * Argument specs of commands whose arguments are not text: o = optional
 * (skipped), m = mandatory (skipped), t = following mandatory arg is text
 * (scan stops skipping there).
 */
const WC_SKIP: Record<string, string> = {
  label: 'm', ref: 'm', eqref: 'm', pageref: 'm', autoref: 'm', cref: 'm', Cref: 'm', cpageref: 'm', nameref: 'm',
  vref: 'm', crefrange: 'mm', Crefrange: 'mm', cite: 'oom', citep: 'oom', citet: 'oom', Citep: 'oom', Citet: 'oom',
  citealt: 'oom', citealp: 'oom', citeauthor: 'oom', citeyear: 'oom', parencite: 'oom', textcite: 'oom',
  autocite: 'oom', footcite: 'oom', Parencite: 'oom', Textcite: 'oom', Autocite: 'oom', nocite: 'm', fullcite: 'oom',
  usepackage: 'om', RequirePackage: 'om', documentclass: 'om', includegraphics: 'om', input: 'm', include: 'm',
  subfile: 'm', includeonly: 'm', import: 'mm', subimport: 'mm', bibliography: 'm', bibliographystyle: 'm',
  addbibresource: 'om', printbibliography: 'o', hspace: 'm', vspace: 'm', setlength: 'mm', addtolength: 'mm',
  setcounter: 'mm', addtocounter: 'mm', stepcounter: 'm', refstepcounter: 'm', newcounter: 'mo', pagestyle: 'm',
  thispagestyle: 'm', pagenumbering: 'm', color: 'om', pagecolor: 'om', definecolor: 'mmm', colorlet: 'mm',
  textcolor: 'om', colorbox: 'om', fcolorbox: 'omm', rule: 'omm', raisebox: 'moo', parbox: 'ooom', makebox: 'oo',
  framebox: 'oo', scalebox: 'mo', resizebox: 'mm', rotatebox: 'om', href: 'm', url: 'm', nolinkurl: 'm',
  hyperlink: 'm', hypertarget: 'm', hypersetup: 'm', usetikzlibrary: 'm', tikzset: 'm', pgfplotsset: 'm',
  captionsetup: 'om', setlist: 'om', geometry: 'm', newgeometry: 'm', selectlanguage: 'm', foreignlanguage: 'om',
  includepdf: 'om', lstinputlisting: 'om', inputminted: 'omm', lstset: 'm', setminted: 'om', theoremstyle: 'm',
  numberwithin: 'mm', index: 'm', glossary: 'm', gls: 'om', Gls: 'om', glspl: 'om', Glspl: 'om', acrshort: 'om',
  acrlong: 'om', acrfull: 'om', ac: 'm', acp: 'm', newacronym: 'omm', newglossaryentry: 'mm', fontsize: 'mm',
  linespread: 'm', graphicspath: 'm', DeclareGraphicsExtensions: 'm', mintinline: 'om', texorpdfstring: 'm',
  addcontentsline: 'mmm', addtocontents: 'mm', markboth: 'mm', markright: 'm', vskip: '', hskip: '',
  titleformat: 'momommo', titlespacing: 'mmmm', fancyhead: 'om', fancyfoot: 'om', lhead: 'm', chead: 'm',
  rhead: 'm', lfoot: 'm', cfoot: 'm', rfoot: 'm', setbeamertemplate: 'mo', setbeamercolor: 'mm',
  setbeamerfont: 'mm', usetheme: 'om', usecolortheme: 'om', usefonttheme: 'om', useinnertheme: 'om',
  useoutertheme: 'om', title: 'om', author: 'om', date: 'm', institute: 'om', subtitle: 'om', logo: 'm',
  newtheorem: 'momo', bibitem: 'om', ensuremath: 'm', si: 'om', SI: 'omom', num: 'om', qty: 'omm', unit: 'om',
  ang: 'om', SIrange: 'ommm', numrange: 'omm', qtyrange: 'ommm', tablenum: 'om', todo: 'o', missingfigure: 'om',
  multicolumn: 'mm', multirow: 'mom', cline: 'm', cmidrule: 'm', arraystretch: '', phantom: 'm', hphantom: 'm',
  vphantom: 'm', settowidth: 'mm', settoheight: 'mm', setmainfont: 'om', setsansfont: 'om', setmonofont: 'om',
  newfontfamily: 'mom', AtBeginDocument: 'm', AtEndDocument: 'm', providecommand: '', tag: 'm',
  frame: '', pause: 'o', onslide: 'o', only: 'o', uncover: 'o', visible: 'o', alert: 'o', item: '',
};
const WC_DEFINITIONS = new Set([...DEF_COMMANDS, ...DOC_COMMANDS, ...ENV_DEFS, ...DOC_ENV_DEFS, 'DeclareMathOperator', 'newtheorem', 'DeclarePairedDelimiter']);
const WC_MATH_DISPLAY_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'flalign', 'flalign*', 'gather', 'gather*',
  'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'dmath', 'dmath*', 'IEEEeqnarray', 'IEEEeqnarray*',
]);
const WC_SKIP_ENVS = new Set([
  ...VERBATIM_ENVIRONMENTS, 'tikzpicture', 'picture', 'pspicture', 'tikzcd', 'thebibliography', 'circuitikz',
  'forest', 'axis', 'algorithmic', 'algorithmic*', 'algpseudocode', 'comment',
]);
const WC_FLOAT_ENVS = new Set([
  'figure', 'figure*', 'table', 'table*', 'wrapfigure', 'wraptable', 'sidewaysfigure', 'sidewaystable', 'SCfigure',
  'SCtable', 'algorithm', 'algorithm*', 'listing', 'marginfigure', 'margintable',
]);
/** Argument specs for `\begin{env}` (o/m skipped). */
const WC_ENV_ARGS: Record<string, string> = {
  tabular: 'om', 'tabular*': 'mom', tabularx: 'mom', tabulary: 'mom', longtable: 'om', array: 'om', minipage: 'ooom',
  multicols: 'm', 'multicols*': 'm', figure: 'o', 'figure*': 'o', table: 'o', 'table*': 'o', wrapfigure: 'omom',
  wraptable: 'omom', subfigure: 'om', subtable: 'om', list: 'mm', itemize: 'o', enumerate: 'o', description: 'o',
  tcolorbox: 'o', mdframed: 'o', columns: 'o', column: 'om', thebibliography: 'm', adjustbox: 'm', otherlanguage: 'm',
  'otherlanguage*': 'm', spacing: 'm', block: '', frame: '', letter: 'm', abstract: '', center: '', quote: '',
};

const WORD_RE = /\p{N}+(?:[.,]\p{N}+)+|[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

function countWordsIn(text: string): number {
  if (!text) return 0;
  let n = 0;
  let t = text;
  if (CJK_RE.test(t)) {
    CJK_RE.lastIndex = 0;
    t = t.replace(CJK_RE, () => {
      n++;
      return ' ';
    });
  }
  CJK_RE.lastIndex = 0;
  WORD_RE.lastIndex = 0;
  while (WORD_RE.exec(t)) n++;
  return n;
}

function countNonSpace(t: string): number {
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (c <= 32 || c === 0xa0) continue;
    if (c >= 0xdc00 && c <= 0xdfff) continue; // low surrogate → counted with its high surrogate
    n++;
  }
  return n;
}

/**
 * Approximate texcount-style word count of LaTeX source: only the document body
 * (between `\begin{document}` and `\end{document}`, or the whole text for
 * included fragments without a preamble) is counted; comments, command names,
 * non-text arguments (labels, refs, citations, lengths, file names…), math,
 * verbatim and drawings are skipped; text inside `\section{}`, `\emph{}`,
 * `\textbf{}`, captions and footnotes is counted.
 */
export function countWords(source: string): WordCount {
  const s = maskLatex(source);
  const res: WordCount = {
    words: 0, characters: 0, mathInline: 0, mathDisplay: 0, textWords: 0, headerWords: 0, captionWords: 0, headers: 0, floats: 0,
  };
  let start = 0;
  let end = s.length;
  const beginDoc = /\\begin\s*\{document\}/.exec(s);
  if (beginDoc) {
    start = beginDoc.index + beginDoc[0].length;
    const endRe = /\\end\s*\{document\}/g;
    endRe.lastIndex = start;
    const e = endRe.exec(s);
    if (e) end = e.index;
  } else if (/\\documentclass\b/.test(s)) {
    return res; // only a preamble so far
  }

  const buf: string[][] = [[], [], []];
  // Stack of categories: braces and environments.
  const stack: { env?: string; cat: Cat }[] = [];
  let cat: Cat = CAT_TEXT;
  let pending: Cat | null = null;
  const emit = (t: string) => {
    buf[cat].push(t);
  };
  const sep = () => buf[cat].push(' ');
  /** Category switches are word boundaries in both buffers. */
  const switchCat = (next: Cat) => {
    if (next === cat) return;
    buf[cat].push(' ');
    cat = next;
    buf[cat].push(' ');
  };

  /** Skip args according to spec starting at k; returns new position. */
  const skipArgs = (spec: string, k: number): number => {
    for (const a of spec) {
      if (a === 'o') {
        const o = optArg(s, k);
        if (o) k = o.end;
      } else if (a === 'm') {
        const j = skipWs(s, k);
        if (s.charCodeAt(j) === LB) {
          const g = readBraced(s, j);
          if (!g) return k;
          k = g.end;
        } else if (s.charCodeAt(j) === BS) {
          const ne = nameEnd(s, j + 1);
          k = ne > j + 1 ? ne : j + 2;
        } else return k;
      }
    }
    return k;
  };

  let i = start;
  let runStart = i;
  const flush = (to: number) => {
    if (to > runStart) emit(s.slice(runStart, to));
  };
  while (i < end) {
    const c = s.charCodeAt(i);
    if (c !== BS && c !== LB && c !== RB && c !== DOLLAR && c !== PCT && c !== 126 && c !== 38 && c !== HASH && c !== 94 && c !== 95) {
      i++;
      continue;
    }
    flush(i);
    if (c === BS) {
      const c1 = s.charCodeAt(i + 1);
      if (!isAlpha(c1)) {
        // Control symbol.
        const sym = s[i + 1];
        i += 2;
        if (sym === '(') {
          const e = s.indexOf('\\)', i);
          res.mathInline++;
          i = e === -1 || e > end ? end : e + 2;
          sep();
        } else if (sym === '[') {
          const e = s.indexOf('\\]', i);
          res.mathDisplay++;
          i = e === -1 || e > end ? end : e + 2;
          sep();
        } else if (sym === '\\') {
          sep();
          const k = readStar(s, i).pos;
          const o = readBracket(s, skipBlanks(s, k));
          i = o ? o.end : k;
        } else if (sym && '&%$#_{}'.includes(sym)) {
          emit(sym);
        } else if (sym && ',;: >\n\t'.includes(sym)) {
          sep();
        }
        // accents (\' \" \^ …), \- and \/ : nothing, the word continues.
        runStart = i;
        continue;
      }
      let j = i + 1;
      while (j < end && isNameChar(s.charCodeAt(j))) j++;
      const name = s.slice(i + 1, j);
      i = j;
      if (name === 'begin' || name === 'end') {
        const g = readBraced(s, skipBlanks(s, i), true, 100);
        if (!g) {
          runStart = i;
          continue;
        }
        const env = g.content.trim();
        i = g.end;
        if (name === 'end') {
          for (let k = stack.length - 1; k >= 0; k--) {
            if (stack[k].env === env) {
              stack.length = k;
              switchCat(stack.length ? stack[stack.length - 1].cat : CAT_TEXT);
              break;
            }
          }
          sep();
          runStart = i;
          continue;
        }
        if (WC_MATH_DISPLAY_ENVS.has(env) || env === 'math' || WC_SKIP_ENVS.has(env)) {
          i = findEnvEnd(s, env, i, end);
          if (env === 'math') res.mathInline++;
          else if (WC_MATH_DISPLAY_ENVS.has(env)) res.mathDisplay++;
          sep();
          runStart = i;
          continue;
        }
        let envCat = cat;
        if (WC_FLOAT_ENVS.has(env)) {
          res.floats++;
          envCat = CAT_OTHER;
        }
        const spec = WC_ENV_ARGS[env];
        if (spec !== undefined) i = skipArgs(spec, i);
        else {
          // Unknown env: skip key=value / placement options, keep titles (`\begin{theorem}[Pythagoras]`).
          const o = optArg(s, i);
          if (o && (o.content.includes('=') || /^\s*[htbpH!]+\s*$/.test(o.content))) i = o.end;
        }
        if (env === 'frame') {
          i = skipOptionals(s, i, true);
          const t = skipWs(s, i);
          if (s.charCodeAt(t) === LB) {
            res.headers++;
            pending = CAT_HEADER;
          }
        }
        stack.push({ env, cat: envCat });
        switchCat(envCat);
        sep();
        runStart = i;
        continue;
      }
      if (name === 'verb' || name === 'Verb' || name === 'lstinline' || name === 'spverb') {
        // Content already masked; skip the delimiters.
        let k = i;
        if (s.charCodeAt(k) === STAR) k++;
        const o = name === 'lstinline' || name === 'Verb' ? readBracket(s, k) : null;
        if (o) k = o.end;
        const d = s[k];
        if (d === '{') {
          const g = readBraced(s, k, true);
          k = g ? g.end : k + 1;
        } else if (d && d !== '\n') {
          const e = s.indexOf(d, k + 1);
          k = e === -1 ? k + 1 : e + 1;
        }
        i = k;
        sep();
        runStart = i;
        continue;
      }
      if (WC_DEFINITIONS.has(name) || TEX_DEFS.has(name)) {
        i = skipDefinition(s, name, i);
        runStart = i;
        continue;
      }
      if (WC_HEADERS.has(name)) {
        const st = readStar(s, i);
        let k = st.pos;
        if (name === 'frametitle' || name === 'framesubtitle') k = skipOptionals(s, k, true);
        else {
          const o = optArg(s, k);
          if (o) k = o.end;
        }
        res.headers++;
        sep();
        i = k;
        pending = s.charCodeAt(skipWs(s, k)) === LB ? CAT_HEADER : null;
        runStart = i;
        continue;
      }
      if (WC_OTHER.has(name)) {
        let k = readStar(s, i).pos;
        if (name === 'captionof') k = skipArgs('m', k);
        const o = optArg(s, k);
        if (o) k = o.end;
        sep();
        i = k;
        pending = s.charCodeAt(skipWs(s, k)) === LB ? CAT_OTHER : null;
        runStart = i;
        continue;
      }
      const letters = WC_LETTERS[name];
      if (letters !== undefined && !isAlpha(s.charCodeAt(i))) {
        emit(letters);
        if (s.startsWith('{}', i)) i += 2;
        runStart = i;
        continue;
      }
      if (CITE_COMMANDS.has(name) || VOL_CITE.has(name) || REF_COMMANDS.has(name) || REF_RANGE_COMMANDS.has(name) || SIMPLE_INCLUDES.has(name) || IMPORT_INCLUDES.has(name)) {
        i = skipCitationLike(s, name, i);
        sep();
        runStart = i;
        continue;
      }
      const spec = WC_SKIP[name];
      if (spec !== undefined) {
        i = skipArgs(spec, readStar(s, i).pos);
        if (!WC_TRANSPARENT.has(name)) sep();
        runStart = i;
        continue;
      }
      if (WC_TRANSPARENT.has(name)) {
        runStart = i;
        continue;
      }
      // Unknown command: acts as a word separator; skip a following key=value optional argument.
      sep();
      const o = readBracket(s, i);
      if (o && o.content.includes('=')) i = o.end;
      runStart = i;
      continue;
    }
    if (c === LB) {
      const next: Cat = pending ?? cat;
      pending = null;
      stack.push({ cat: next });
      switchCat(next);
      i++;
      runStart = i;
      continue;
    }
    if (c === RB) {
      if (stack.length && stack[stack.length - 1].env === undefined) {
        stack.pop();
        switchCat(stack.length ? stack[stack.length - 1].cat : CAT_TEXT);
      }
      i++;
      runStart = i;
      continue;
    }
    if (c === DOLLAR) {
      const dbl = s.charCodeAt(i + 1) === DOLLAR;
      const close = findMathClose(s, i + (dbl ? 2 : 1), dbl);
      if (dbl) res.mathDisplay++;
      else res.mathInline++;
      i = close === -1 ? i + (dbl ? 2 : 1) : Math.min(close, end);
      sep();
      runStart = i;
      continue;
    }
    if (c === PCT) {
      // Comment (already masked): TeX also eats the newline and the next line's indentation.
      let e = s.indexOf('\n', i);
      if (e === -1 || e >= end) e = end;
      else {
        e++;
        while (e < end && isSpace(s.charCodeAt(e))) e++;
      }
      i = e;
      runStart = i;
      continue;
    }
    // ~ & # ^ _
    sep();
    i++;
    runStart = i;
  }
  flush(end);

  const texts = buf.map((b) => b.join(''));
  res.textWords = countWordsIn(texts[CAT_TEXT]);
  res.headerWords = countWordsIn(texts[CAT_HEADER]);
  res.captionWords = countWordsIn(texts[CAT_OTHER]);
  res.words = res.textWords + res.headerWords + res.captionWords;
  res.characters = countNonSpace(texts[0]) + countNonSpace(texts[1]) + countNonSpace(texts[2]);
  return res;
}

/** Skip the arguments of citation/reference/include commands (not text). */
function skipCitationLike(s: string, name: string, i: number): number {
  let k = readStar(s, i).pos;
  if (MULTI_CITE.has(name)) {
    for (let n = 0; n < 2; n++) {
      const p = readBracket(s, skipWs(s, k), LP, RP);
      if (!p) break;
      k = p.end;
    }
  }
  const groups = MULTI_CITE.has(name) ? Infinity : VOL_CITE.has(name) || REF_RANGE_COMMANDS.has(name) || IMPORT_INCLUDES.has(name) ? 2 : 1;
  for (let n = 0; n < groups; n++) {
    const kk = skipOptionals(s, k);
    const j = skipWs(s, kk);
    if (s.charCodeAt(j) !== LB) {
      if (n === 0 && name === 'input') {
        const m = /^[ \t]+[A-Za-z0-9_.\/-]+/.exec(s.slice(k, k + 300));
        if (m) return k + m[0].length;
      }
      return n === 0 ? kk : k;
    }
    const g = readBraced(s, j);
    if (!g) return kk;
    k = g.end;
  }
  return k;
}

/** Offset after the `\end{env}` matching an already-opened `\begin{env}` (handles nesting). */
function findEnvEnd(s: string, env: string, from: number, limit: number): number {
  const re = /\\(begin|end)\s*\{([^}]*)\}/g;
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    if (m.index >= limit) break;
    if (m[2].trim() !== env) continue;
    if (m[1] === 'begin') depth++;
    else if (--depth === 0) return m.index + m[0].length;
  }
  return limit;
}

/** Skip a macro/environment definition (name, arg spec and bodies). */
function skipDefinition(s: string, name: string, i: number): number {
  let k = readStar(s, i).pos;
  if (TEX_DEFS.has(name)) {
    k = skipWs(s, k);
    const b = s.indexOf('{', k);
    if (b === -1 || b - k > 300) return k;
    const g = readBraced(s, b);
    return g ? g.end : b + 1;
  }
  // name / env name
  const first = readCsName(s, k);
  if (first) k = first.end;
  else {
    const g = reqArg(s, k);
    if (!g) return k;
    k = g.end;
  }
  // Optional args [n][default] and up to 3 mandatory groups (spec/bodies).
  k = skipOptionals(s, k);
  const groups = ENV_DEFS.has(name) || DOC_ENV_DEFS.has(name) ? (DOC_ENV_DEFS.has(name) ? 3 : 2) : DOC_COMMANDS.has(name) ? 2 : name === 'newtheorem' ? 1 : name === 'DeclarePairedDelimiter' ? 2 : 1;
  for (let n = 0; n < groups; n++) {
    const g = readBraced(s, skipWs(s, k));
    if (!g) break;
    k = g.end;
    if (name === 'newtheorem') k = skipOptionals(s, k);
  }
  return k;
}

// ═══════════════════════════════ lint ═══════════════════════════════

const LINT_MATH_ENVS = new Set([
  'equation', 'equation*', 'align', 'align*', 'alignat', 'alignat*', 'flalign', 'flalign*', 'gather', 'gather*',
  'multline', 'multline*', 'eqnarray', 'eqnarray*', 'displaymath', 'math', 'dmath', 'dmath*', 'IEEEeqnarray',
  'IEEEeqnarray*', 'xalignat', 'xxalignat',
]);
/** Commands whose braced argument is in text mode even inside math. */
const TEXT_IN_MATH = new Set([
  'text', 'mbox', 'textrm', 'textbf', 'textit', 'textsf', 'texttt', 'textnormal', 'textup', 'textsl', 'textsc',
  'emph', 'intertext', 'shortintertext', 'hbox', 'fbox', 'makebox', 'framebox', 'parbox', 'raisebox', 'tag',
  'textcolor', 'colorbox', 'label', 'footnote', 'marginpar', 'vbox', 'textmd',
]);

interface MathState {
  kind: '$' | '$$' | '\\(' | '\\[' | 'env';
  from: number;
  to: number;
  env?: string;
}

const MAX_LINT = 200;

/**
 * Lightweight syntax checks run while typing: unbalanced braces,
 * `\begin`/`\end` mismatches, `\end` without `\begin`, unclosed `$`, `$$`,
 * `\(`, `\[`, blank lines inside math, `$` inside math environments, a stray
 * backslash at the end of the file, duplicate labels and a missing
 * `\begin{document}`. Offsets `from`/`to` are UTF-16 offsets into `source`.
 */
export function lintLatex(source: string): LintDiagnostic[] {
  const s = maskLatex(source);
  const lines = new LineIndex(source);
  const out: LintDiagnostic[] = [];
  const add = (severity: 'error' | 'warning', code: string, message: string, from: number, to: number) => {
    if (out.length >= MAX_LINT) return;
    out.push({ severity, code, message, from, to: Math.max(to, from + 1), line: lines.line(from) });
  };

  const braces: { at: number; saved?: MathState | null; textGroup?: boolean }[] = [];
  const envs: { name: string; from: number; to: number }[] = [];
  const labels = new Map<string, number>();
  let math: MathState | null = null;
  let pendingTextGroup = false;
  let hasDocumentclass = false;
  let hasBeginDocument = false;

  const closeMathAtPar = (pos: number) => {
    if (!math) return;
    if (math.kind === '$' || math.kind === '\\(') {
      add('error', 'unclosed-math', `Inline math opened with ${math.kind} is not closed before the end of the paragraph`, math.from, math.to);
      math = null;
    } else if (math.kind === '$$' || math.kind === '\\[') {
      add('error', 'unclosed-math', `Display math opened with ${math.kind} is not closed before the end of the paragraph`, math.from, math.to);
      math = null;
    } else {
      add('error', 'blank-line-in-math', `Blank line inside math environment {${math.env}}`, pos, pos + 1);
    }
  };

  const n = s.length;
  let i = 0;
  while (i < n) {
    const c = s.charCodeAt(i);
    if (c === NL) {
      if (math && isParAhead(s, i)) {
        // advance to the second newline so the paragraph break is reported once
        let k = i + 1;
        while (k < n && isSpace(s.charCodeAt(k))) k++;
        closeMathAtPar(k);
        i = k + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === PCT) {
      const e = s.indexOf('\n', i);
      i = e === -1 ? n : e;
      continue;
    }
    if (c === LB) {
      if (pendingTextGroup) {
        braces.push({ at: i, saved: math, textGroup: true });
        math = null;
        pendingTextGroup = false;
      } else braces.push({ at: i });
      i++;
      continue;
    }
    if (c === RB) {
      const b = braces.pop();
      if (!b) add('error', 'unmatched-brace', 'Unmatched closing brace }', i, i + 1);
      else if (b.textGroup) {
        if (math) add('error', 'unclosed-math', `Math opened with ${math.kind} is not closed inside this group`, math.from, math.to);
        math = b.saved ?? null;
      }
      i++;
      continue;
    }
    if (c === DOLLAR) {
      const dbl = s.charCodeAt(i + 1) === DOLLAR;
      const len = dbl ? 2 : 1;
      if (!math) math = { kind: dbl ? '$$' : '$', from: i, to: i + len };
      else if (math.kind === '$') {
        if (dbl) {
          // `$x$$y$`: close and reopen.
          math = { kind: '$', from: i + 1, to: i + 2 };
        } else math = null;
      } else if (math.kind === '$$') {
        if (dbl) math = null;
        else {
          add('error', 'unmatched-math', 'Display math should end with $$', i, i + 1);
          math = null;
        }
      } else {
        add('error', 'math-in-math', `${dbl ? '$$' : '$'} inside ${math.kind === 'env' ? `math environment {${math.env}}` : `math opened with ${math.kind}`}`, i, i + len);
      }
      i += len;
      continue;
    }
    if (c !== BS) {
      i++;
      continue;
    }
    // Backslash.
    if (i + 1 >= n) break;
    const c1 = s.charCodeAt(i + 1);
    if (!isAlpha(c1)) {
      const sym = s[i + 1];
      if (sym === '(' || sym === '[') {
        if (math) add('error', 'math-in-math', `\\${sym} inside ${math.kind === 'env' ? `math environment {${math.env}}` : `math opened with ${math.kind}`}`, i, i + 2);
        else math = { kind: sym === '(' ? '\\(' : '\\[', from: i, to: i + 2 };
      } else if (sym === ')' || sym === ']') {
        const want = sym === ')' ? '\\(' : '\\[';
        if (!math) add('error', 'unmatched-math', `\\${sym} without matching ${want}`, i, i + 2);
        else if (math.kind === want) math = null;
        else {
          add('error', 'unmatched-math', `\\${sym} does not match ${math.kind === 'env' ? `math environment {${math.env}}` : `math opened with ${math.kind}`}`, i, i + 2);
          if (math.kind !== 'env') math = null;
        }
      }
      i += 2;
      continue;
    }
    let j = i + 1;
    while (j < n && isNameChar(s.charCodeAt(j))) j++;
    const name = s.slice(i + 1, j);
    if (name === 'begin' || name === 'end') {
      const g = readBraced(s, skipBlanks(s, j), true, 120);
      if (!g) {
        add('error', 'malformed-environment', `\\${name} without an environment name`, i, j);
        i = j;
        continue;
      }
      const env = g.content.trim();
      if (name === 'begin') {
        if (env === 'document') hasBeginDocument = true;
        envs.push({ name: env, from: i, to: g.end });
        if (LINT_MATH_ENVS.has(env)) {
          if (math) add('error', 'math-in-math', `Environment {${env}} inside math opened with ${math.kind === 'env' ? `{${math.env}}` : math.kind}`, i, g.end);
          else math = { kind: 'env', from: i, to: g.end, env };
        }
      } else {
        let k = envs.length - 1;
        while (k >= 0 && envs[k].name !== env) k--;
        if (k < 0) {
          add('error', 'end-without-begin', `\\end{${env}} without matching \\begin{${env}}`, i, g.end);
        } else {
          for (let m = envs.length - 1; m > k; m--) {
            const open = envs[m];
            add('error', 'environment-mismatch', `\\begin{${open.name}} on line ${lines.line(open.from)} ended by \\end{${env}}`, i, g.end);
            add('error', 'unclosed-environment', `\\begin{${open.name}} is not closed (\\end{${env}} on line ${lines.line(i)} closes an outer environment)`, open.from, open.to);
            if (math && math.kind === 'env' && math.env === open.name) math = null;
          }
          envs.length = k;
          if (LINT_MATH_ENVS.has(env)) {
            if (math && math.kind !== 'env') {
              add('error', 'unclosed-math', `Math opened with ${math.kind} is not closed before \\end{${env}}`, math.from, math.to);
            }
            math = null;
          }
        }
      }
      i = g.end;
      continue;
    }
    if (name === 'documentclass') hasDocumentclass = true;
    if (name === 'label') {
      const g = reqArg(s, j);
      if (g) {
        const l = g.content.trim();
        if (l && !l.includes('#')) {
          if (labels.has(l)) add('warning', 'duplicate-label', `Label '${l}' is already defined on line ${lines.line(labels.get(l)!)}`, i, g.end);
          else labels.set(l, i);
        }
        i = g.end;
        continue;
      }
    }
    if (WC_DEFINITIONS.has(name) || TEX_DEFS.has(name)) {
      // Check the definition's braces are balanced, but don't lint its body as document content.
      const end = skipDefinitionChecked(s, name, j);
      if (end === -1) {
        // Unbalanced body: fall through so the brace stack reports it.
        i = j;
      } else i = end;
      continue;
    }
    if (math && TEXT_IN_MATH.has(name)) {
      // Next `{` after optional args opens a text-mode group.
      let k = readStar(s, j).pos;
      k = skipOptionals(s, k);
      if (name === 'textcolor' || name === 'colorbox') {
        const g = reqArg(s, k);
        if (g) k = g.end;
      }
      if (name === 'parbox' || name === 'raisebox') {
        const g = reqArg(s, k);
        if (g) k = skipOptionals(s, g.end);
      }
      const b = skipWs(s, k);
      if (s.charCodeAt(b) === LB) {
        pendingTextGroup = true;
        i = b;
        continue;
      }
    }
    i = j;
  }

  if (math) {
    const m = math as MathState;
    if (m.kind === 'env') {
      // reported as unclosed environment below
    } else add('error', 'unclosed-math', `Math opened with ${m.kind} is never closed`, m.from, m.to);
  }
  for (const e of envs) add('error', 'unclosed-environment', `\\begin{${e.name}} is never closed`, e.from, e.to);
  for (const b of braces) add('error', 'unclosed-brace', 'Unclosed brace {', b.at, b.at + 1);
  // A lone backslash at the very end (only whitespace after it).
  let e = n;
  while (e > 0 && (isSpace(s.charCodeAt(e - 1)) || s.charCodeAt(e - 1) === NL)) e--;
  let backslashes = 0;
  while (e - backslashes > 0 && s.charCodeAt(e - backslashes - 1) === BS) backslashes++;
  if (backslashes % 2 === 1) add('error', 'trailing-backslash', 'Backslash at end of file', e - 1, e);
  if (hasDocumentclass && !hasBeginDocument) {
    const m = /\\documentclass\b/.exec(s);
    const at = m ? m.index : 0;
    add('warning', 'missing-begin-document', 'Missing \\begin{document}', at, at + 14);
  }
  out.sort((a, b) => a.from - b.from || a.to - b.to);
  return out;
}

/** Like skipDefinition but returns -1 if a body is unbalanced. */
function skipDefinitionChecked(s: string, name: string, i: number): number {
  let k = readStar(s, i).pos;
  if (TEX_DEFS.has(name)) {
    k = skipWs(s, k);
    // parameter text up to `{`
    let j = k;
    const limit = Math.min(s.length, k + 300);
    while (j < limit && s.charCodeAt(j) !== LB) {
      if (s.charCodeAt(j) === BS) j++;
      j++;
    }
    if (s.charCodeAt(j) !== LB) return k;
    const g = readBraced(s, j);
    return g ? g.end : -1;
  }
  const first = readCsName(s, k);
  if (first) k = first.end;
  else {
    const j = skipWs(s, k);
    if (s.charCodeAt(j) !== LB) return k;
    const g = readBraced(s, j, true);
    if (!g) return -1;
    k = g.end;
  }
  k = skipOptionals(s, k);
  const groups = ENV_DEFS.has(name) ? 2 : DOC_ENV_DEFS.has(name) ? 3 : DOC_COMMANDS.has(name) ? 2 : name === 'DeclarePairedDelimiter' ? 2 : 1;
  for (let n = 0; n < groups; n++) {
    const j = skipWs(s, k);
    if (s.charCodeAt(j) !== LB) break;
    const g = readBraced(s, j);
    if (!g) return -1;
    k = g.end;
    if (name === 'newtheorem') k = skipOptionals(s, k);
  }
  return k;
}
