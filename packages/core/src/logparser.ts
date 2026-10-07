/**
 * TeX log parser → structured diagnostics (errors, warnings, bad boxes) with
 * file + line resolution (tracks the "(./file.tex" open/close stack).
 *
 * Handles pdfTeX / XeTeX / LuaTeX / Tectonic logs (79-column wrapped lines,
 * `-file-line-error` style, nonstop-mode help text), LaTeX/package/class
 * warnings with `(pkg)` continuation lines, bad boxes, missing files and
 * packages, runaway arguments, fatal errors, and — when present in the same
 * text — BibTeX (.blg) and Biber messages.
 */
import type { Diagnostic } from './types';
import { extname, normalizePath } from './paths';

export interface ParseLogOptions {
  /** Project-relative paths, used to map absolute/"./" paths from the log back to project files. */
  projectPaths?: string[];
  /** Main file path, used when an error has no file context. */
  mainPath?: string;
}

/** TeX's default `max_print_line`. */
const WRAP = 79;

/** Lines that always start a new logical line (never a wrapped continuation). */
const STARTS_MESSAGE =
  /^(?:! |l\.\d+ |LaTeX(?: Font)? (?:Warning|Error|Info)|Package \S+ (?:Warning|Error|Info)|Class \S+ (?:Warning|Error|Info)|(?:Over|Under)full \\[hv]box|\((?:\.{0,2}\/|[A-Za-z]:[\\/])|\[\d+\] \S+:\d+> )/;

const FILE_LINE_ERROR = /^((?:[A-Za-z]:[\\/]|\.{1,2}[\\/]|\/)?[^:\n]*?\.[A-Za-z][\w-]*):(\d+): (.*)$/;
const ERROR_BOILERPLATE =
  /^(?:See the LaTeX manual or LaTeX Companion for explanation\.|Type {1,2}H <return> {1,2}for immediate help\.|For immediate help type H <return>\.|Type X to quit or <RETURN> to proceed,|or enter new name\. \(Default extension: \w*\)|Enter file name:|<read \*>|\*\*\* \(cannot \\read from terminal in nonstop modes\)|\s*\.\.\.\s*|! Emergency stop\.|)\s*$/;

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function looksWrapped(line: string): boolean {
  if (line.length === WRAP) return !line.endsWith('...');
  if (line.length > WRAP || line.length < WRAP / 4) return false;
  // pdfTeX counts bytes, XeTeX/LuaTeX count characters.
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(line)) return false;
  return utf8Length(line) === WRAP || [...line].length === WRAP;
}

/** Split into lines and re-join lines that TeX wrapped at 79 columns. */
export function unwrapLogLines(log: string): string[] {
  const raw = log.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let prevWrapped = false;
  for (const line of raw) {
    if (prevWrapped && out.length && !STARTS_MESSAGE.test(line)) out[out.length - 1] += line;
    else out.push(line);
    prevWrapped = looksWrapped(line);
  }
  return out;
}

// ───────────────────────────── path resolution ─────────────────────────────

const SYSTEM_PATH = /(?:^|\/)(?:texmf[\w.-]*|texlive|miktex|tectonic|\.texlive\d*)(?:\/|$)|\/tex\/(?:latex|generic|plain|context|luatex|xetex|xelatex)\//i;

function cleanRecordedPath(recorded: string): string {
  let p = recorded.trim();
  if (p.length >= 2 && p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  p = p.replace(/^file:\/\//, '').replace(/\\/g, '/');
  return p;
}

/** Map a path that appears in a log / synctex file to a project-relative path (longest suffix match). */
export function resolveProjectPath(recorded: string, projectPaths: string[]): string | undefined {
  const cleaned = cleanRecordedPath(recorded);
  const norm = normalizePath(cleaned);
  if (!norm || !projectPaths.length) return undefined;
  const isAbsolute = /^(?:\/|[A-Za-z]:\/)/.test(cleaned);
  let best: string | undefined;
  let bestLen = -1;
  let ciBest: string | undefined;
  let ciBestLen = -1;
  const lower = norm.toLowerCase();
  for (const pp of projectPaths) {
    const q = normalizePath(pp);
    if (!q) continue;
    if (q === norm) return pp;
    if (q.length > bestLen && norm.endsWith(q) && norm.charCodeAt(norm.length - q.length - 1) === 47 /* / */) {
      best = pp;
      bestLen = q.length;
    }
    const ql = q.toLowerCase();
    if (ql.length > ciBestLen && (ql === lower || (lower.endsWith(ql) && lower.charCodeAt(lower.length - ql.length - 1) === 47))) {
      ciBest = pp;
      ciBestLen = ql.length;
    }
  }
  if (best !== undefined) {
    // A distribution file (…/texmf-dist/tex/latex/…/foo.sty) only matches a project file with the same relative dir.
    if (isAbsolute && SYSTEM_PATH.test(cleaned) && !normalizePath(best).includes('/')) return undefined;
    return best;
  }
  if (ciBest !== undefined && !(isAbsolute && SYSTEM_PATH.test(cleaned))) return ciBest;
  // `\input{chapters/intro}` may be recorded without its extension.
  if (!extname(norm)) return resolveProjectPath(cleaned + '.tex', projectPaths);
  return undefined;
}

/** Heuristic used when no project paths are known: relative, non-distribution files are project files. */
function guessProjectPath(recorded: string): string | undefined {
  const cleaned = cleanRecordedPath(recorded);
  if (/^(?:\/|[A-Za-z]:\/)/.test(cleaned) || SYSTEM_PATH.test(cleaned)) return undefined;
  const ext = extname(cleaned);
  // Bare `article.cls` (Tectonic) is a distribution file; `./mystyle.sty` is local.
  if (/^(?:sty|cls|clo|def|fd|cfg|ldf|dfu|bbx|cbx|lbx|map|enc|code\.tex)$/.test(ext) && !cleaned.startsWith('./')) return undefined;
  return normalizePath(cleaned) || undefined;
}

// ───────────────────────────── classification ─────────────────────────────

function errorCode(msg: string): string {
  const f = /File [`'"]([^'"`]+)['"`] not found/.exec(msg);
  if (f) return /\.(?:sty|cls)$/i.test(f[1]) ? 'missing-package' : 'missing-file';
  if (/^Undefined control sequence/.test(msg)) return 'undefined-control-sequence';
  if (/^I can't find file|^I couldn't open file name|Cannot find file|not found: using draft setting/.test(msg)) return 'missing-file';
  if (/Unknown graphics extension/.test(msg)) return 'unknown-graphics-extension';
  if (/Environment \S+ undefined/.test(msg)) return 'undefined-environment';
  if (/\\begin\{[^}]*\} (?:on input line \d+ )?ended by \\end/.test(msg)) return 'environment-mismatch';
  if (/^Missing \$ inserted|^Display math should end with \$\$|^Bad math environment delimiter/.test(msg)) return 'missing-dollar';
  if (/^Extra \}, or forgotten|^Too many \}'s|^Argument of \S+ has an extra \}/.test(msg)) return 'extra-brace';
  if (/^Missing [{}] inserted/.test(msg)) return 'missing-brace';
  if (/^Extra alignment tab/.test(msg)) return 'extra-alignment-tab';
  if (/^Misplaced alignment tab/.test(msg)) return 'misplaced-alignment-tab';
  if (/Missing \\begin\{document\}/.test(msg)) return 'missing-begin-document';
  if (/There's no line here to end/.test(msg)) return 'no-line-to-end';
  if (/Something's wrong--perhaps a missing \\item/.test(msg)) return 'missing-item';
  if (/Lonely \\item--perhaps a missing list environment/.test(msg)) return 'missing-list-environment';
  if (/^Emergency stop/.test(msg)) return 'emergency-stop';
  if (/Fatal error occurred/.test(msg)) return 'fatal-error';
  if (/^Paragraph ended before|^File ended while scanning|^Forbidden control sequence found/.test(msg)) return 'runaway-argument';
  if (/^TeX capacity exceeded/.test(msg)) return 'capacity-exceeded';
  if (/^Double (?:superscript|subscript)/.test(msg)) return 'double-script';
  if (/^Missing number/.test(msg)) return 'missing-number';
  if (/^Illegal unit of measure/.test(msg)) return 'illegal-unit';
  if (/Command \\\S+ already defined/.test(msg)) return 'command-already-defined';
  if (/Unicode character|Invalid UTF-8|Invalid UTF-8 byte/.test(msg)) return 'unicode-character';
  if (/Option clash for package/.test(msg)) return 'option-clash';
  if (/Can be used only in preamble/.test(msg)) return 'preamble-only';
  if (/Undefined color/.test(msg)) return 'undefined-color';
  if (/not loadable|cannot be found|Font \S+ not found|font not found/i.test(msg)) return 'font-not-found';
  if (/^Undefined (?:index|tag)|Not in outer par mode/.test(msg)) return 'latex-error';
  if (/^LaTeX(?:3)? Error:/.test(msg)) return 'latex-error';
  if (/^Package \S+ Error:/.test(msg)) return 'package-error';
  if (/^Class \S+ Error:/.test(msg)) return 'class-error';
  return 'tex-error';
}

function warningCode(body: string, source: string): { code: string; severity: Diagnostic['severity'] } {
  const w = (code: string) => ({ code, severity: 'warning' as const });
  if (/^(?:Hyper )?[Rr]eference [`'"].*?['"`] on page .* undefined/.test(body)) return w('undefined-reference');
  if (/^Citation [`'"].*?['"`](?: on page .*)? undefined/.test(body)) return w('undefined-citation');
  if (/There were undefined (?:references|citations)/.test(body)) return w('undefined-references');
  if (/Label [`'"].*?['"`] multiply defined/.test(body)) return w('multiply-defined-label');
  if (/There were multiply[- ]defined labels/.test(body)) return w('multiply-defined-labels');
  if (/Please \(?re\)?run (?:Biber|BibTeX)/i.test(body)) return { code: 'rerun-bibliography', severity: 'info' };
  if (/Rerun to get|may have changed\. Rerun|Please rerun LaTeX|has changed\.\s*Rerun|Rerun LaTeX/i.test(body)) return { code: 'rerun-needed', severity: 'info' };
  if (source === 'LaTeX Font') return w('font-warning');
  if (/float specifier changed/.test(body)) return w('float-specifier');
  if (/Float too large/.test(body)) return w('float-too-large');
  if (/Unused global option/.test(body)) return w('unused-option');
  if (/Token not allowed in a PDF string/.test(body)) return w('pdf-string');
  if (/Empty bibliography|Empty [`']thebibliography'/.test(body)) return w('empty-bibliography');
  if (/No \\author given/.test(body)) return w('missing-author');
  if (/Marginpar on page/.test(body)) return w('marginpar-moved');
  if (/Font shape .* undefined|Some font shapes were not available|Size substitutions/.test(body)) return w('font-warning');
  if (/^Package/.test(source)) return w('package-warning');
  if (/^Class/.test(source)) return w('class-warning');
  return w('latex-warning');
}

// ───────────────────────────── parser ─────────────────────────────

interface Located {
  file?: string;
  /** False when the error happened inside a non-project file (line numbers would point into it). */
  exact: boolean;
}

export function parseLatexLog(log: string, opts: ParseLogOptions = {}): Diagnostic[] {
  const lines = unwrapLogLines(log);
  const projectPaths = opts.projectPaths ?? [];
  const cache = new Map<string, string | undefined>();
  const resolve = (raw: string): string | undefined => {
    if (cache.has(raw)) return cache.get(raw);
    const r = projectPaths.length ? resolveProjectPath(raw, projectPaths) : guessProjectPath(raw);
    cache.set(raw, r);
    return r;
  };

  /** Tectonic prints `\input{intro}` as "(intro": accept bare names that are project files. */
  const isProjectToken = (tok: string): boolean => projectPaths.length > 0 && resolveProjectPath(tok, projectPaths) !== undefined;

  /** File stack: recorded path for "(file", null for other parentheses. */
  const stack: (string | null)[] = [];
  const topFile = (): string | undefined => {
    for (let k = stack.length - 1; k >= 0; k--) {
      const f = stack[k];
      if (f !== null) return f;
    }
    return undefined;
  };
  const locate = (explicit?: string): Located => {
    const raw = explicit ?? topFile();
    if (raw === undefined) return { file: opts.mainPath, exact: true };
    const r = resolve(raw);
    if (r) return { file: r, exact: true };
    for (let k = stack.length - 1; k >= 0; k--) {
      const f = stack[k];
      if (f === null || f === raw) continue;
      const rf = resolve(f);
      if (rf) return { file: rf, exact: false };
    }
    return { file: opts.mainPath, exact: false };
  };

  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  let errors = 0;
  const push = (d: Diagnostic) => {
    const key = `${d.severity}|${d.file ?? ''}|${d.line ?? ''}|${d.code ?? ''}|${d.message}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (d.severity === 'error') errors++;
    out.push(d);
  };
  const make = (
    severity: Diagnostic['severity'],
    message: string,
    code: string,
    loc: Located,
    line: number | undefined,
    raw: string,
    context?: string,
  ): Diagnostic => {
    const d: Diagnostic = { severity, message: message.trim(), code };
    if (loc.file) d.file = loc.file;
    if (line !== undefined && line > 0 && loc.exact) d.line = line;
    if (context && context.trim()) d.context = context.replace(/\s+$/, '');
    d.raw = raw.length > 2000 ? raw.slice(0, 2000) + '…' : raw;
    return d;
  };

  let runaway: string | undefined;

  /** Parse an error starting at line `i`; returns the index of the last consumed line. */
  const handleError = (i: number, message: string, explicitFile?: string, explicitLine?: number): number => {
    let msg = message;
    let j = i + 1;
    const pkg = /^(?:Package|Class|Module) (\S+) Error:/.exec(msg)?.[1];
    // Continuation lines: "(pkg)   more text" for packages, indented lines for LaTeX errors.
    while (j < lines.length) {
      const l = lines[j];
      if (pkg && l.startsWith(`(${pkg})`)) msg += ' ' + l.slice(pkg.length + 2).trim();
      else if (/^LaTeX(?:3)? Error:/.test(message) && /^ {2,}\S/.test(l)) msg += ' ' + l.trim();
      else break;
      j++;
    }
    msg = msg.replace(/\s+/g, ' ').trim();
    const code = runaway ? 'runaway-argument' : errorCode(msg);
    if ((code === 'emergency-stop' || code === 'fatal-error') && errors > 0) {
      runaway = undefined;
      return i;
    }
    // Context: up to the "l.<n>" line (TeX's input-stack display).
    const ctx: string[] = [];
    let lineNo = explicitLine;
    let last = j - 1;
    let found = false;
    const limit = Math.min(lines.length, j + 40);
    for (let k = j; k < limit; k++) {
      const l = lines[k];
      const lm = /^l\.(\d+)( .*)?$/.exec(l);
      if (lm) {
        if (lineNo === undefined) lineNo = parseInt(lm[1], 10);
        ctx.push(l);
        last = k;
        if (k + 1 < lines.length && !/^(?:! |l\.\d)/.test(lines[k + 1])) {
          ctx.push(lines[k + 1]);
          last = k + 1;
        }
        found = true;
        break;
      }
      if (l.startsWith('! ') && !/^! Emergency stop/.test(l)) break;
      if (FILE_LINE_ERROR.test(l) && !/Emergency stop/.test(l)) break;
      if (/^(?:LaTeX|Package \S+|Class \S+) Warning:|^(?:Over|Under)full \\/.test(l)) break;
      if (!ERROR_BOILERPLATE.test(l)) ctx.push(l);
    }
    if (found) {
      // Help text (printed in nonstop/batch mode) runs until the next blank line.
      let k = last + 1;
      const helpLimit = Math.min(lines.length, k + 12);
      while (k < helpLimit && lines[k].trim() !== '' && !/^(?:! |\((?:\.{0,2}\/|\/|[A-Za-z]:)|(?:LaTeX|Package \S+|Class \S+) Warning:|(?:Over|Under)full \\)/.test(lines[k])) k++;
      if (k < helpLimit && lines[k].trim() === '') last = k;
      else last = k - 1;
    } else {
      // Keep just a few lines of context and don't consume them (they may contain file parens).
      ctx.length = Math.min(ctx.length, 3);
      last = j - 1;
    }
    const context = (runaway ? runaway + '\n' : '') + ctx.join('\n');
    runaway = undefined;
    const loc = locate(explicitFile);
    push(make('error', msg, code, loc, lineNo, lines.slice(i, last + 1).join('\n'), context));
    return last;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    let m: RegExpExecArray | null;

    // ── TeX errors ──
    if (line.startsWith('! ')) {
      i = handleError(i, line.slice(2));
      continue;
    }
    if ((m = FILE_LINE_ERROR.exec(line))) {
      i = handleError(i, m[3], m[1], parseInt(m[2], 10));
      continue;
    }
    if (/^Runaway (?:argument|definition|preamble|text)\?/.test(line)) {
      runaway = line + (i + 1 < lines.length && !lines[i + 1].startsWith('! ') ? '\n' + lines[i + 1] : '');
      if (i + 1 < lines.length && !lines[i + 1].startsWith('! ')) i++;
      continue;
    }

    // ── Tectonic / latexmk-style "error: file:line: message" ──
    if ((m = /^(error|warning): (?:([^\s:]+(?:\/[^\s:]+)*):(\d+): )?(.+)$/.exec(line)) && !/^warning: accessing absolute path/.test(line)) {
      const severity = m[1] === 'error' ? 'error' : 'warning';
      const loc = locate(m[2] ?? undefined);
      const code = severity === 'error' ? errorCode(m[4]) : warningCode(m[4].replace(/^(?:LaTeX|Package \S+|Class \S+) Warning: /, ''), 'LaTeX').code;
      push(make(severity, m[4], code, m[2] ? loc : { file: loc.file, exact: false }, m[3] ? parseInt(m[3], 10) : undefined, line));
      continue;
    }

    // ── Bad boxes ──
    if ((m = /^(Over|Under)full \\([hv])box \(([^)]*)\) (.*)$/.exec(line))) {
      const lm = /lines? (\d+)/.exec(m[4]);
      const ctx: string[] = [];
      let k = i + 1;
      const limit = Math.min(lines.length, k + 8);
      while (k < limit && lines[k].trim() !== '' && !/^(?:! |LaTeX |Package |Class |(?:Over|Under)full |\[\d)/.test(lines[k])) {
        ctx.push(lines[k]);
        k++;
      }
      const consumedTo = k < lines.length && lines[k].trim() === '' ? k : k - 1;
      const code = `${m[1].toLowerCase()}full-${m[2]}box`;
      push(make('badbox', line, code, locate(), lm ? parseInt(lm[1], 10) : undefined, lines.slice(i, consumedTo + 1).join('\n'), ctx.join('\n')));
      i = consumedTo;
      continue;
    }

    // ── LaTeX / package / class warnings ──
    if ((m = /^(LaTeX(?: Font)?|LaTeX3|Package (\S+)|Class (\S+)|Module (\S+)) Warning: (.*)$/.exec(line))) {
      const source = m[1];
      const name = m[2] ?? m[3] ?? m[4] ?? (source === 'LaTeX Font' ? 'Font' : undefined);
      let body = m[5];
      let k = i + 1;
      while (k < lines.length) {
        const l = lines[k];
        if (name && l.startsWith(`(${name})`)) body += ' ' + l.slice(name.length + 2).trim();
        else if (!name && /^ {2,}\S/.test(l)) body += ' ' + l.trim();
        else break;
        k++;
      }
      body = body.replace(/\s+/g, ' ').trim();
      const lm = /on input line (\d+)/.exec(body) ?? /\bat lines? (\d+)/.exec(body) ?? /\bline (\d+)\b/.exec(body);
      const { code, severity } = warningCode(body, source);
      push(make(severity, `${source} Warning: ${body}`, code, locate(), lm ? parseInt(lm[1], 10) : undefined, lines.slice(i, k).join('\n')));
      i = k - 1;
      continue;
    }

    // ── pdfTeX / engine warnings ──
    if ((m = /^(pdfTeX|XeTeX|LuaTeX|xdvipdfmx)(?: warning| Warning|:warning)(?: \(([^)]*)\))?: ?(.*)$/.exec(line))) {
      let lineNo: number | undefined;
      let k = i + 1;
      const ctx: string[] = [];
      const limit = Math.min(lines.length, k + 6);
      for (; k < limit; k++) {
        const l = lines[k];
        const lm = /^l\.(\d+)/.exec(l);
        if (lm) {
          lineNo = parseInt(lm[1], 10);
          ctx.push(l);
          break;
        }
        if (!/^(?:<[^>]*>|\s)/.test(l) || l.trim() === '') {
          k = i; // nothing structured follows
          break;
        }
        ctx.push(l);
      }
      if (lineNo === undefined) k = i;
      const code = /destination with the same identifier/.test(m[3]) ? 'duplicate-destination' : 'engine-warning';
      push(make('warning', line, code, locate(), lineNo, lines.slice(i, k + 1).join('\n'), lineNo !== undefined ? ctx.join('\n') : undefined));
      i = k;
      continue;
    }
    if ((m = /^Missing character: There is no (.+?) in font (.+?)!?$/.exec(line))) {
      push(make('warning', line, 'missing-character', locate(), undefined, line));
      continue;
    }
    if ((m = /^\(\\end occurred (inside a group at level \d+|when \\\w+ on line \d+ was incomplete)\)/.exec(line))) {
      const code = m[1].startsWith('inside') ? 'unclosed-group' : 'incomplete-conditional';
      push(make('warning', line.slice(1, line.indexOf(')') > 0 ? line.lastIndexOf(')') : undefined), code, { file: opts.mainPath, exact: false }, undefined, line));
      continue;
    }
    if (/^No pages of output\./.test(line)) {
      push(make('warning', line, 'no-output', locate(), undefined, line));
      continue;
    }

    // ── Biber ──
    if ((m = /^\[\d+\] [^>]*> (WARN|ERROR|FATAL) - (.*)$/.exec(line))) {
      const text = m[2].trim();
      const severity = m[1] === 'WARN' ? 'warning' : 'error';
      const fm = /([^\s,'"]+?\.bib)(?:_\d+(?:\.utf8)?)?['"]?,? line (\d+)/.exec(text);
      let code = severity === 'error' ? 'biber-error' : 'biber-warning';
      if (/I didn't find a database entry for/.test(text)) code = 'missing-bib-entry';
      else if (/Cannot find|not found/i.test(text) && /\.bib/.test(text)) code = 'missing-file';
      const loc: Located = fm ? { file: resolve(fm[1]) ?? undefined, exact: true } : { file: undefined, exact: false };
      push(make(severity, text, code, loc, fm ? parseInt(fm[2], 10) : undefined, line));
      continue;
    }

    // ── BibTeX (.blg) ──
    if ((m = /^Warning--(.*)$/.exec(line))) {
      let lineNo: number | undefined;
      let file: string | undefined;
      let k = i;
      const next = lines[i + 1];
      const lm = next !== undefined ? /^--line (\d+) of file (.+)$/.exec(next) : null;
      if (lm) {
        lineNo = parseInt(lm[1], 10);
        file = lm[2].trim();
        k = i + 1;
      }
      const code = /I didn't find a database entry/.test(m[1]) ? 'missing-bib-entry' : 'bibtex-warning';
      const loc: Located = file ? { file: resolve(file), exact: true } : { file: undefined, exact: false };
      push(make('warning', m[1], code, loc, lineNo, lines.slice(i, k + 1).join('\n')));
      i = k;
      continue;
    }
    if ((m = /^(.*)---line (\d+) of file (.+)$/.exec(line))) {
      const ctx: string[] = [];
      let k = i + 1;
      while (k < lines.length && /^ : /.test(lines[k])) ctx.push(lines[k++]);
      if (k < lines.length && /^I'm skipping whatever remains/.test(lines[k])) k++;
      push(make('error', m[1].trim(), 'bibtex-error', { file: resolve(m[3].trim()), exact: true }, parseInt(m[2], 10), lines.slice(i, k).join('\n'), ctx.join('\n')));
      i = k - 1;
      continue;
    }
    if ((m = /^I couldn't open (?:database|style|auxiliary) file (.+)$/.exec(line)) || (m = /^I found no (\\\w+) (?:command|commands)---while reading file (.+)$/.exec(line))) {
      const code = /couldn't open/.test(line) ? 'missing-file' : 'bibtex-error';
      push(make('error', line.trim(), code, { file: undefined, exact: false }, undefined, line));
      continue;
    }

    // ── Everything else: track "(file" and ")" ──
    parseParens(line, stack, isProjectToken);
  }
  return out;
}

const FILE_TOKEN = /^[^\s()"<>[\]{}]+/;

/** Update the file stack with the parentheses on a log line. */
function parseParens(line: string, stack: (string | null)[], isProjectToken: (tok: string) => boolean): void {
  let k = 0;
  const n = line.length;
  while (k < n) {
    const open = line.indexOf('(', k);
    const close = line.indexOf(')', k);
    if (open === -1 && close === -1) return;
    if (close !== -1 && (open === -1 || close < open)) {
      if (stack.length) stack.pop();
      k = close + 1;
      continue;
    }
    // "(" at `open`
    const rest = line.slice(open + 1);
    let path: string | null = null;
    let consumed = 0;
    if (rest.startsWith('"')) {
      const q = rest.indexOf('"', 1);
      if (q > 1) {
        path = rest.slice(1, q);
        consumed = q + 1;
      }
    } else {
      const m = FILE_TOKEN.exec(rest);
      if (m && (looksLikeFile(m[0]) || (/^[\w.+-]{2,}$/.test(m[0]) && isProjectToken(m[0])))) {
        path = m[0];
        consumed = m[0].length;
      }
    }
    stack.push(path);
    k = open + 1 + consumed;
  }
}

function looksLikeFile(tok: string): boolean {
  if (tok.includes('/')) return /[A-Za-z]/.test(tok) && !/^https?:/.test(tok) && !/^\d+\/\d+$/.test(tok);
  if (/^[A-Za-z]:\\/.test(tok)) return true;
  // A bare file name with an extension (Tectonic prints "(article.cls", "(main.tex").
  return /^[\w.+-]*[A-Za-z_][\w.+-]*\.[A-Za-z][\w-]*$/.test(tok) && !/^(?:e\.g|i\.e|cf|etc|vs)\.?$/i.test(tok);
}
