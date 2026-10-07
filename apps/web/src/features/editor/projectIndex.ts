/**
 * Project-wide LaTeX index shared by the editor (completion, hovers), the
 * outline and the breadcrumbs: per-file analysis (cached, invalidated on
 * content changes), labels, bibliography entries, user macros and floats.
 *
 * Core analysis functions are wrapped so a "not implemented" (or a parser bug)
 * never breaks the editor — a small regex fallback kicks in instead.
 */
import {
  analyzeLatex,
  countWords,
  dirname,
  extname,
  isTexPath,
  joinPath,
  normalizePath,
  parseBibtex,
  type BibEntry,
  type FileNode,
  type LatexAnalysis,
  type ProjectDoc,
} from '@texit/core';
import { Emitter } from '@/lib/emitter';
import { useWorkspace } from '@/state/workspace';

// ───────────────────────────── safe wrappers ─────────────────────────────

const warned = new Set<string>();
function warnOnce(key: string, err: unknown) {
  if (warned.has(key)) return;
  warned.add(key);
  if (!String((err as Error)?.message ?? err).includes('not implemented')) console.warn(`[editor] ${key} failed, using fallback`, err);
}

/** Strip a `%` comment from a line (respecting `\%`). */
export function stripComment(line: string): string {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') {
      i++;
      continue;
    }
    if (line[i] === '%') return line.slice(0, i);
  }
  return line;
}

/** Read a balanced `{…}` group starting at `start` (which must point at `{`). Returns [content, endIndexExclusive]. */
export function readGroup(src: string, start: number): [string, number] | null {
  if (src[start] !== '{') return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return [src.slice(start + 1, i), i + 1];
    }
  }
  return null;
}

const SECTION_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

function fallbackAnalyze(source: string): LatexAnalysis {
  const out: LatexAnalysis = {
    outline: [],
    labels: [],
    refs: [],
    citations: [],
    includes: [],
    commands: [],
    environments: [],
    packages: [],
    magic: {},
  };
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const magic = /^\s*%\s*!TE?X\s+([\w-]+)\s*=\s*(.+?)\s*$/i.exec(raw);
    if (magic) out.magic[magic[1].toLowerCase()] = magic[2];
    const line = stripComment(raw);
    if (!line.includes('\\')) continue;
    let m: RegExpExecArray | null;
    const sec = /\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{/g;
    while ((m = sec.exec(line))) {
      const g = readGroup(line, m.index + m[0].length - 1);
      out.outline.push({ level: SECTION_LEVELS[m[1]], kind: m[1], title: (g?.[0] ?? '').trim(), line: lineNo, starred: m[2] === '*' });
    }
    const frame = /\\begin\{frame\}(?:\[[^\]]*\])?(?:\{([^}]*)\})?|\\frametitle\{([^}]*)\}/g;
    while ((m = frame.exec(line))) {
      const title = (m[1] ?? m[2] ?? '').trim();
      if (m[2] !== undefined) {
        const last = out.outline[out.outline.length - 1];
        if (last && last.kind === 'frame' && !last.title) {
          last.title = title;
          continue;
        }
      }
      if (m[1] !== undefined || m[0].startsWith('\\begin')) out.outline.push({ level: -1, kind: 'frame', title, line: lineNo, starred: false });
    }
    const label = /\\label\s*\{([^}]*)\}/g;
    while ((m = label.exec(line))) out.labels.push({ name: m[1].trim(), line: lineNo, context: raw.trim() });
    const ref = /\\(ref|eqref|pageref|autoref|nameref|cref|Cref|vref|labelcref)\*?\s*\{([^}]*)\}/g;
    while ((m = ref.exec(line))) for (const name of m[2].split(',')) if (name.trim()) out.refs.push({ name: name.trim(), line: lineNo, command: m[1] });
    const cite = /\\(\w*cite\w*|nocite)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}/g;
    while ((m = cite.exec(line))) out.citations.push({ keys: m[2].split(',').map((k) => k.trim()).filter(Boolean), line: lineNo, command: m[1] });
    const inc = /\\(input|include|subfile|includegraphics|includesvg|bibliography|addbibresource|lstinputlisting|includepdf)\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
    while ((m = inc.exec(line))) {
      for (const p of m[1] === 'bibliography' ? m[2].split(',') : [m[2]]) if (p.trim()) out.includes.push({ command: m[1], path: p.trim(), line: lineNo });
    }
    const nc = /\\(?:newcommand|renewcommand|providecommand|DeclareMathOperator|DeclareRobustCommand)\*?\s*\{?\s*\\([a-zA-Z@]+)\s*\}?\s*(?:\[(\d)\])?/g;
    while ((m = nc.exec(line))) out.commands.push({ name: m[1], args: m[2] ? Number(m[2]) : 0, line: lineNo });
    const def = /\\def\s*\\([a-zA-Z@]+)((?:#\d)*)/g;
    while ((m = def.exec(line))) out.commands.push({ name: m[1], args: (m[2].match(/#/g) ?? []).length, line: lineNo });
    const ne = /\\(?:newenvironment|renewenvironment|newtheorem|declaretheorem|newtcolorbox)\*?\s*\{([^}]+)\}/g;
    while ((m = ne.exec(line))) out.environments.push({ name: m[1].trim(), line: lineNo });
    const pkg = /\\(?:usepackage|RequirePackage)\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
    while ((m = pkg.exec(line))) for (const name of m[2].split(',')) if (name.trim()) out.packages.push({ name: name.trim(), options: m[1], line: lineNo });
    const dc = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(line);
    if (dc) out.documentClass = { name: dc[2].trim(), options: dc[1] };
  }
  return out;
}

export function safeAnalyze(source: string): LatexAnalysis {
  try {
    const a = analyzeLatex(source);
    if (a && Array.isArray(a.outline)) return a;
  } catch (err) {
    warnOnce('analyzeLatex', err);
  }
  return fallbackAnalyze(source);
}

function fallbackParseBib(source: string): BibEntry[] {
  const out: BibEntry[] = [];
  const re = /@(\w+)\s*[{(]\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    const line = source.slice(0, m.index).split('\n').length;
    const fields: Record<string, string> = {};
    let i = m.index + m[0].length;
    // Parse `name = {value}` / "value" / bare pairs until the entry closes.
    let depthGuard = 0;
    while (i < source.length && depthGuard++ < 200) {
      const fm = /^\s*([\w-]+)\s*=\s*/.exec(source.slice(i, i + 200));
      if (!fm) break;
      i += fm[0].length;
      let value = '';
      if (source[i] === '{') {
        const g = readGroup(source, i);
        if (!g) break;
        value = g[0];
        i = g[1];
      } else if (source[i] === '"') {
        const end = source.indexOf('"', i + 1);
        if (end < 0) break;
        value = source.slice(i + 1, end);
        i = end + 1;
      } else {
        const vm = /^[^,}\n]+/.exec(source.slice(i));
        value = vm ? vm[0].trim() : '';
        i += vm ? vm[0].length : 0;
      }
      fields[fm[1].toLowerCase()] = value.replace(/\s+/g, ' ').trim();
      const sep = /^\s*,?/.exec(source.slice(i));
      i += sep ? sep[0].length : 0;
      if (/^\s*[})]/.test(source.slice(i, i + 50))) break;
    }
    out.push({ key: m[2], type, fields, line });
  }
  return out;
}

export function safeParseBib(source: string): BibEntry[] {
  try {
    const r = parseBibtex(source);
    if (Array.isArray(r)) return r;
  } catch (err) {
    warnOnce('parseBibtex', err);
  }
  return fallbackParseBib(source);
}

export function safeCountWords(source: string): number {
  try {
    return countWords(source).words;
  } catch (err) {
    warnOnce('countWords', err);
  }
  const body = /\\begin\{document\}([\s\S]*?)(\\end\{document\}|$)/.exec(source)?.[1] ?? source;
  const text = body
    .split('\n')
    .map(stripComment)
    .join('\n')
    .replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g, ' ')
    .replace(/\\begin\{(equation|align|gather|multline|eqnarray|displaymath|math)\*?\}[\s\S]*?\\end\{\1\*?\}/g, ' ')
    .replace(/\\(label|ref|eqref|cite\w*|includegraphics|input|include|usepackage|begin|end|documentclass|bibliography\w*)\*?(\[[^\]]*\])?\{[^}]*\}/g, ' ')
    .replace(/\\[a-zA-Z@]+\*?/g, ' ')
    .replace(/[{}[\]~&\\#^_]/g, ' ');
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

// ───────────────────────────── extra extractors ─────────────────────────────

export interface UserMacro {
  name: string;
  args: number;
  /** Optional default for the first argument. */
  defaultArg?: string;
  body: string;
}

/** Parse \newcommand / \renewcommand / \def / \DeclareMathOperator definitions (for KaTeX). */
export function extractMacros(source: string): UserMacro[] {
  const out: UserMacro[] = [];
  const clean = source
    .split('\n')
    .map(stripComment)
    .join('\n');
  const re = /\\(newcommand|renewcommand|providecommand|DeclareMathOperator|DeclareRobustCommand)(\*?)\s*(\{\s*\\([a-zA-Z@]+)\s*\}|\\([a-zA-Z@]+))\s*(?:\[(\d)\])?\s*(?:\[([^\]]*)\])?\s*/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) {
    const name = m[4] ?? m[5];
    const g = readGroup(clean, m.index + m[0].length);
    if (!g) continue;
    const isOp = m[1] === 'DeclareMathOperator';
    out.push({
      name,
      args: m[6] ? Number(m[6]) : 0,
      defaultArg: m[7],
      body: isOp ? `\\operatorname${m[2] ? '*' : ''}{${g[0]}}` : g[0],
    });
  }
  const def = /\\def\s*\\([a-zA-Z@]+)((?:#\d)*)\s*\{/g;
  while ((m = def.exec(clean))) {
    const g = readGroup(clean, m.index + m[0].length - 1);
    if (g) out.push({ name: m[1], args: (m[2].match(/#/g) ?? []).length, body: g[0] });
  }
  return out;
}

export interface FloatInfo {
  kind: 'figure' | 'table' | 'listing' | 'algorithm';
  caption: string;
  label?: string;
  line: number;
}

/** Figures / tables with their captions and labels. */
export function extractFloats(source: string): FloatInfo[] {
  const out: FloatInfo[] = [];
  const re = /\\begin\{(figure|table|listing|algorithm|wrapfigure|sidewaysfigure|sidewaystable|wraptable)(\*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const env = m[1];
    const end = source.indexOf(`\\end{${env}${m[2]}}`, m.index);
    const body = source.slice(m.index, end < 0 ? Math.min(source.length, m.index + 4000) : end);
    const before = source.slice(0, m.index);
    const lineStart = before.lastIndexOf('\n') + 1;
    if (stripComment(source.slice(lineStart, m.index + 1)).length <= m.index - lineStart) continue; // commented out
    const capIdx = body.search(/\\caption\s*(\[[^\]]*\])?\s*\{/);
    let caption = '';
    if (capIdx >= 0) {
      const brace = body.indexOf('{', capIdx + 8 + (body.slice(capIdx + 8).match(/^\s*\[[^\]]*\]/)?.[0].length ?? 0));
      const g = readGroup(body, brace);
      caption = (g?.[0] ?? '').replace(/\\label\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim();
    }
    const label = /\\label\s*\{([^}]*)\}/.exec(body)?.[1];
    const kind = env.includes('table') ? 'table' : env === 'listing' ? 'listing' : env === 'algorithm' ? 'algorithm' : 'figure';
    out.push({ kind, caption, label, line: before.split('\n').length });
    if (end > 0) re.lastIndex = end;
  }
  return out;
}

// ───────────────────────────── the index ─────────────────────────────

interface FileEntry {
  analysis?: LatexAnalysis;
  bib?: BibEntry[];
  macros?: UserMacro[];
  floats?: FloatInfo[];
}

export interface IndexedLabel {
  name: string;
  fileId: string;
  path: string;
  line: number;
  context?: string;
}

export interface IndexedBibEntry extends BibEntry {
  fileId: string;
  path: string;
}

export class ProjectIndex {
  private cache = new Map<string, FileEntry>();
  private offContent: () => void;
  private offTree: () => void;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Debounced: fires after file contents or the tree changed. */
  readonly changed = new Emitter<void>();
  version = 0;

  constructor(readonly project: ProjectDoc) {
    this.offContent = project.onContentChange((ids) => {
      ids.forEach((id) => this.cache.delete(id));
      this.bump();
    });
    this.offTree = project.onTreeChange(() => this.bump());
  }

  private bump() {
    this.version++;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.changed.emit(), 250);
  }

  dispose() {
    this.offContent();
    this.offTree();
    clearTimeout(this.timer);
    this.changed.clear();
  }

  private entry(id: string): FileEntry {
    let e = this.cache.get(id);
    if (!e) {
      e = {};
      this.cache.set(id, e);
    }
    return e;
  }

  files(): FileNode[] {
    return useWorkspace.getState().files.filter((f) => f.kind === 'file');
  }

  texFiles(): FileNode[] {
    return this.files().filter((f) => f.isText && (isTexPath(f.path) || ['sty', 'cls'].includes(extname(f.path))));
  }

  bibFiles(): FileNode[] {
    return this.files().filter((f) => extname(f.path) === 'bib');
  }

  analysis(id: string): LatexAnalysis {
    const e = this.entry(id);
    e.analysis ??= safeAnalyze(this.project.readText(id));
    return e.analysis;
  }

  bib(id: string): BibEntry[] {
    const e = this.entry(id);
    e.bib ??= safeParseBib(this.project.readText(id));
    return e.bib;
  }

  macros(id: string): UserMacro[] {
    const e = this.entry(id);
    e.macros ??= extractMacros(this.project.readText(id));
    return e.macros;
  }

  floats(id: string): FloatInfo[] {
    const e = this.entry(id);
    e.floats ??= extractFloats(this.project.readText(id));
    return e.floats;
  }

  labels(): IndexedLabel[] {
    const out: IndexedLabel[] = [];
    for (const f of this.texFiles()) {
      for (const l of this.analysis(f.id).labels) out.push({ ...l, fileId: f.id, path: f.path });
    }
    return out;
  }

  bibEntries(): IndexedBibEntry[] {
    const out: IndexedBibEntry[] = [];
    for (const f of this.bibFiles()) for (const b of this.bib(f.id)) out.push({ ...b, fileId: f.id, path: f.path });
    // \bibitem entries in thebibliography environments.
    for (const f of this.texFiles()) {
      const text = this.project.readText(f.id);
      if (!text.includes('\\bibitem')) continue;
      const re = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}([^\n]*)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        out.push({ key: m[1].trim(), type: 'bibitem', fields: { title: m[2].trim() }, line: text.slice(0, m.index).split('\n').length, fileId: f.id, path: f.path });
      }
    }
    return out;
  }

  userCommands(): { name: string; args: number; path: string }[] {
    const out: { name: string; args: number; path: string }[] = [];
    const seen = new Set<string>();
    for (const f of this.texFiles()) {
      for (const c of this.analysis(f.id).commands) {
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        out.push({ name: c.name, args: c.args, path: f.path });
      }
    }
    return out;
  }

  userEnvironments(): { name: string; path: string }[] {
    const out: { name: string; path: string }[] = [];
    const seen = new Set<string>();
    for (const f of this.texFiles()) {
      for (const e of this.analysis(f.id).environments) {
        if (seen.has(e.name)) continue;
        seen.add(e.name);
        out.push({ name: e.name, path: f.path });
      }
    }
    return out;
  }

  /** KaTeX `macros` object built from every \newcommand in the project. */
  katexMacros(): Record<string, string> {
    const macros: Record<string, string> = {};
    for (const f of this.texFiles()) {
      for (const m of this.macros(f.id)) {
        if (m.defaultArg !== undefined) continue; // optional args are not supported by KaTeX macros
        macros[`\\${m.name}`] = m.body;
      }
    }
    return macros;
  }

  mainFileId(): string | null {
    try {
      return this.project.getMainFileId();
    } catch {
      return null;
    }
  }

  /** Resolve an \input/\include/\subfile argument to a file id (relative to the main file's folder, then to `fromPath`). */
  resolveInclude(ref: string, fromPath?: string, exts: string[] = ['tex']): string | null {
    const mainId = this.mainFileId();
    const mainDir = mainId ? dirname(this.project.getPath(mainId)) : '';
    const bases = [mainDir, fromPath ? dirname(fromPath) : '', ''];
    const clean = normalizePath(ref.trim());
    for (const base of bases) {
      const p = joinPath(base, clean);
      const direct = this.project.findByPath(p);
      if (direct) return direct;
      for (const ext of exts) {
        const id = this.project.findByPath(`${p}.${ext}`);
        if (id) return id;
      }
    }
    return null;
  }
}

let current: ProjectIndex | null = null;

/** The index for the currently open project (or null). */
export function getProjectIndex(): ProjectIndex | null {
  const project = useWorkspace.getState().project;
  if (!project) {
    current?.dispose();
    current = null;
    return null;
  }
  if (current?.project !== project) {
    current?.dispose();
    current = new ProjectIndex(project);
  }
  return current;
}
