/**
 * Compile settings detection: main file, `% !TEX root`, engine (magic
 * comments → explicit setting → package heuristics), bibliography tool and
 * makeindex. Pure functions — safe to call on every keystroke.
 */
import { basename, dirname, extname, isTexPath, joinPath, normalizePath } from '@texit/core';
import type { BibTool, ProjectFile, TexEngine } from '@texit/core';
import { mergeScans, packageOptions, parseMagicComments, scanLatex, stripComments, usesPackage, type LatexScan } from './latex-scan';
import { fileText } from './util';

/** Packages that only work with LuaLaTeX. */
export const LUALATEX_ONLY_PACKAGES: ReadonlySet<string> = new Set([
  'luacode', 'luatextra', 'luatexbase', 'luaotfload', 'luacolor', 'lua-ul', 'luatexja', 'luatexja-fontspec',
  'luatexja-preset', 'luatexja-ruby', 'lualatex-math', 'luamplib', 'luapackageloader', 'selnolig', 'luavlna',
  'lua-visual-debug', 'luakeys', 'luatexko', 'chickenize', 'ctablestack', 'pdfextra', 'luaimageembed',
  'lutabulartools', 'lua-widow-control', 'luaquotes', 'luaxml', 'spelling', 'luatodonotes', 'luapstricks',
  'penlightplus', 'penlight', 'nodetree', 'interpreter', 'luatex85', 'showhyphenation', 'luacas', 'minim',
  'minim-mp', 'minim-pdf', 'linebreaker', 'lua-check-hyphen', 'luabidi', 'emoji', 'lua-physical', 'luarandom',
  'luamaths', 'luaprogtable', 'luatbls', 'unicodefonttable', 'pyluatex', 'luagcd',
]);

/** Packages that only work with XeLaTeX. */
export const XELATEX_ONLY_PACKAGES: ReadonlySet<string> = new Set([
  'xeCJK', 'xltxtra', 'xunicode', 'mathspec', 'xetexko', 'xepersian', 'xgreek', 'xeindex', 'xesearch',
  'bidi', 'ucharclasses', 'arabxetex', 'xetex-devanagari', 'xecyr', 'xetexfontinfo', 'zhspacing', 'xCJK2uni',
  'philokalia', 'xespotcolor', 'fontwrap', 'xevlna',
]);

/** Packages that need a Unicode engine (XeLaTeX or LuaLaTeX). */
export const UNICODE_ENGINE_PACKAGES: ReadonlySet<string> = new Set([
  'fontspec', 'unicode-math', 'polyglossia', 'realscripts', 'fontsetup', 'libertinus-otf', 'firamath-otf',
  'xltxtra', 'metalogo-otf', 'fontspec-luatex', 'fontspec-xetex',
]);

export const LUALATEX_ONLY_CLASSES: ReadonlySet<string> = new Set([
  'ltjsarticle', 'ltjsbook', 'ltjsreport', 'ltjskiyou', 'ltjarticle', 'ltjbook', 'ltjreport', 'ltjtarticle',
  'ltjtbook', 'ltjtreport', 'ltjspf', 'lltjext', 'jlreq',
]);

export const XELATEX_PREFERRED_CLASSES: ReadonlySet<string> = new Set([
  'ctexart', 'ctexbook', 'ctexrep', 'ctexbeamer', 'xepersian-magazine', 'fduthesis',
]);

export type EngineSource = 'magic' | 'explicit' | 'packages' | 'default';

export interface CompileSettings {
  /** Effective main file (after following `% !TEX root`). */
  mainPath: string;
  /** If `% !TEX root` redirected the requested main file, the original path. */
  requestedMainPath?: string;
  engine: TexEngine;
  engineSource: EngineSource;
  /** Human-readable reason, e.g. 'uses fontspec' or '% !TEX program = lualatex'. */
  engineReason?: string;
  /** Concrete bibliography tool. */
  bibTool: Exclude<BibTool, 'auto'>;
  bibSource: 'magic' | 'explicit' | 'detected';
  makeindex: boolean;
  /** Magic comments of the main file. */
  magic: Record<string, string>;
  /** Project paths scanned (main file + include closure + local classes/packages). */
  scannedPaths: string[];
  /** True if the main file looks like a full document (\documentclass … \begin{document}). */
  isCompilableMain: boolean;
  /** The merged scan (exposed for UI / backends). */
  scan: LatexScan;
}

export interface DetectSettingsOptions {
  /** Explicit project engine; 'auto' (default) lets packages decide. Magic comments always win. */
  engine?: TexEngine | 'auto';
  /** Explicit bibliography tool; 'auto' (default) detects. `% !BIB program` wins over 'auto' only. */
  bibTool?: BibTool;
  makeindex?: boolean | 'auto';
  /** Engine when nothing hints otherwise (default 'pdflatex'). */
  defaultEngine?: TexEngine;
}

const ENGINE_ALIASES: Record<string, TexEngine> = {
  pdflatex: 'pdflatex', pdftex: 'pdflatex', latex: 'pdflatex', 'pdflatex-dev': 'pdflatex',
  xelatex: 'xelatex', xetex: 'xelatex', 'xelatex-dev': 'xelatex',
  lualatex: 'lualatex', luatex: 'lualatex', luahblatex: 'lualatex', luahbtex: 'lualatex', 'lualatex-dev': 'lualatex',
};

/** Map a magic-comment program value (`xelatex`, `LuaLaTeX`, `latexmk -xelatex`…) to an engine. */
export function engineFromProgram(value: string | undefined): TexEngine | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (ENGINE_ALIASES[v]) return ENGINE_ALIASES[v];
  // e.g. "latexmk -xelatex", "arara: lualatex", "xelatex -shell-escape"
  if (/(^|[\s-])xe(la)?tex\b/.test(v)) return 'xelatex';
  if (/(^|[\s-])lua(hb)?(la)?tex\b/.test(v)) return 'lualatex';
  if (/(^|[\s-])pdf(la)?tex\b/.test(v) || /^latexmk(\s+-pdf)?$/.test(v)) return 'pdflatex';
  return undefined;
}

function bibToolFromProgram(value: string | undefined): Exclude<BibTool, 'auto'> | undefined {
  if (!value) return undefined;
  const v = value.trim().toLowerCase();
  if (v.startsWith('biber')) return 'biber';
  if (v.startsWith('bibtex') || v.startsWith('pbibtex') || v.startsWith('upbibtex')) return 'bibtex';
  if (v === 'none') return 'none';
  return undefined;
}

type FileMap = Map<string, ProjectFile>;

function toMap(files: ProjectFile[]): FileMap {
  const m: FileMap = new Map();
  for (const f of files) m.set(normalizePath(f.path), f);
  return m;
}

function findByBasename(map: FileMap, name: string): string | undefined {
  for (const p of map.keys()) if (basename(p) === name) return p;
  return undefined;
}

/** Resolve a referenced file the way TeX would (relative to the main dir), with sensible fallbacks. */
function resolveRef(map: FileMap, ref: string, mainDir: string, fromDir: string, defaultExt: string): string | undefined {
  const cleaned = ref.replace(/^"(.*)"$/, '$1').trim();
  if (!cleaned) return undefined;
  const hasExt = !!extname(cleaned);
  const bases = [joinPath(mainDir, cleaned), joinPath(fromDir, cleaned), normalizePath(cleaned)];
  for (const b of bases) {
    if (map.has(b) && (hasExt || !defaultExt)) return b;
    if (defaultExt && map.has(`${b}.${defaultExt}`)) return `${b}.${defaultExt}`;
    if (map.has(b)) return b;
  }
  return undefined;
}

/** The main file plus everything it (transitively) inputs, and local classes / packages it loads. */
export function includeClosure(files: ProjectFile[], mainPath: string, limit = 500): { paths: string[]; scans: Map<string, LatexScan> } {
  const map = toMap(files);
  const main = normalizePath(mainPath);
  const mainDir = dirname(main);
  const seen = new Set<string>();
  const scans = new Map<string, LatexScan>();
  const queue = [main];
  while (queue.length && seen.size < limit) {
    const path = queue.shift()!;
    if (seen.has(path)) continue;
    const file = map.get(path);
    if (!file) continue;
    seen.add(path);
    const scan = scanLatex(fileText(file.content));
    scans.set(path, scan);
    const fromDir = dirname(path);
    for (const ref of scan.inputs) {
      const r = resolveRef(map, ref, mainDir, fromDir, 'tex');
      if (r && !seen.has(r)) queue.push(r);
    }
    for (const cls of scan.classes) {
      const r = resolveRef(map, `${cls}.cls`, mainDir, fromDir, '') ?? findByBasename(map, `${cls}.cls`);
      if (r && !seen.has(r)) queue.push(r);
    }
    for (const pkg of scan.packages) {
      const r = resolveRef(map, `${pkg.name}.sty`, mainDir, fromDir, '') ?? findByBasename(map, `${pkg.name}.sty`);
      if (r && !seen.has(r)) queue.push(r);
    }
  }
  return { paths: [...seen], scans };
}

const MAIN_NAME_RANK = ['main', 'thesis', 'paper', 'article', 'report', 'document', 'manuscript', 'book', 'index', 'root', 'master', 'slides', 'presentation', 'cv', 'resume'];

/**
 * Pick the most likely root document of a project: a `.tex` file with
 * `\documentclass` and `\begin{document}` (preferring `main.tex`, common names,
 * shallow paths). Returns undefined if there is none.
 */
export function findMainFile(files: ProjectFile[]): string | undefined {
  const candidates: { path: string; score: number }[] = [];
  for (const f of files) {
    const path = normalizePath(f.path);
    if (!isTexPath(path)) continue;
    const text = fileText(f.content);
    const magic = parseMagicComments(text);
    if (magic.root) continue; // a child document pointing to its root
    const src = stripComments(text);
    if (!/\\documentclass\b/.test(src)) continue;
    const hasBegin = /\\begin\s*\{document\}/.test(src);
    const stem = basename(path).replace(/\.[^.]+$/, '').toLowerCase();
    const depth = path.split('/').length - 1;
    const nameRank = MAIN_NAME_RANK.indexOf(stem);
    let score = 0;
    if (hasBegin) score += 1000;
    if (nameRank !== -1) score += 200 - nameRank * 5;
    score -= depth * 50;
    if (/\b(test|example|sample|template|draft|old|backup|copy)\b/.test(stem)) score -= 100;
    candidates.push({ path, score });
  }
  candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return candidates[0]?.path;
}

/** Follow `% !TEX root = …` comments starting at `path` (max 8 hops, ignores dangling roots). */
export function followTexRoot(files: ProjectFile[], path: string): string {
  const map = toMap(files);
  let current = normalizePath(path);
  const seen = new Set<string>([current]);
  for (let hop = 0; hop < 8; hop++) {
    const file = map.get(current);
    if (!file) break;
    const root = parseMagicComments(fileText(file.content)).root;
    if (!root) break;
    const target = resolveRef(map, root, dirname(current), dirname(current), 'tex');
    if (!target || seen.has(target)) break;
    seen.add(target);
    current = target;
  }
  return current;
}

/** Decide the engine for a merged scan. */
export function detectEngine(
  scan: LatexScan,
  magic: Record<string, string>,
  opts: { engine?: TexEngine | 'auto'; defaultEngine?: TexEngine } = {},
): { engine: TexEngine; source: EngineSource; reason?: string } {
  const magicProgram = magic['program'] ?? magic['ts-program'];
  const fromMagic = engineFromProgram(magicProgram);
  if (fromMagic) return { engine: fromMagic, source: 'magic', reason: `% !TEX program = ${magicProgram}` };
  if (opts.engine && opts.engine !== 'auto') return { engine: opts.engine, source: 'explicit', reason: 'project setting' };

  const pkgs = scan.packages.map((p) => p.name);
  const luaPkg = pkgs.find((p) => LUALATEX_ONLY_PACKAGES.has(p));
  const luaCls = scan.classes.find((c) => LUALATEX_ONLY_CLASSES.has(c));
  const xePkg = pkgs.find((p) => XELATEX_ONLY_PACKAGES.has(p));
  const xeCls = scan.classes.find((c) => XELATEX_PREFERRED_CLASSES.has(c));
  const uniPkg = pkgs.find((p) => UNICODE_ENGINE_PACKAGES.has(p));

  if (scan.requiresXeTeX && !scan.requiresLuaTeX) return { engine: 'xelatex', source: 'packages', reason: '\\RequireXeTeX' };
  if (scan.requiresLuaTeX) return { engine: 'lualatex', source: 'packages', reason: '\\RequireLuaTeX' };
  if (luaPkg && !xePkg) return { engine: 'lualatex', source: 'packages', reason: `uses ${luaPkg}` };
  if (luaCls && !xePkg) return { engine: 'lualatex', source: 'packages', reason: `class ${luaCls}` };
  if (xePkg) return { engine: 'xelatex', source: 'packages', reason: `uses ${xePkg}` };
  if (scan.hasDirectLua) return { engine: 'lualatex', source: 'packages', reason: 'uses \\directlua' };
  if (xeCls) return { engine: 'xelatex', source: 'packages', reason: `class ${xeCls}` };
  if (uniPkg) return { engine: 'xelatex', source: 'packages', reason: `uses ${uniPkg}` };
  return { engine: opts.defaultEngine ?? 'pdflatex', source: 'default' };
}

/** Decide bibtex vs biber vs none for a merged scan. */
export function detectBibTool(scan: LatexScan, magic: Record<string, string> = {}): Exclude<BibTool, 'auto'> {
  const fromMagic = bibToolFromProgram(magic['bib-program'] ?? magic['bib-ts-program']);
  if (fromMagic) return fromMagic;
  if (usesPackage(scan, 'biblatex') || usesPackage(scan, 'biblatex-chicago')) {
    const backend = packageOptions(scan, 'biblatex')
      .map((o) => /^backend\s*=\s*(\S+)$/.exec(o)?.[1])
      .find(Boolean);
    return backend && backend.startsWith('bibtex') ? 'bibtex' : 'biber';
  }
  if (scan.bibResources.length > 0) return 'biber';
  if (scan.bibliographies.length > 0) return 'bibtex';
  return 'none';
}

export function detectMakeindex(scan: LatexScan): boolean {
  return scan.hasMakeindex || usesPackage(scan, 'imakeidx') || (usesPackage(scan, 'makeidx') && scan.hasPrintindex);
}

/**
 * Detect the compile settings of a project.
 *
 * - `mainPath` defaults to {@link findMainFile}; `% !TEX root` comments are followed.
 * - engine: `% !TEX program` / `TS-program` → explicit `opts.engine` → packages
 *   (fontspec / unicode-math / polyglossia → xelatex unless LuaLaTeX-only
 *   packages such as luacode are used) → `opts.defaultEngine` (pdflatex).
 * - bibTool 'auto': `% !BIB program` → biblatex/`\addbibresource` → biber
 *   (unless `backend=bibtex`), `\bibliography{}` → bibtex, else none.
 * - makeindex 'auto': `\makeindex`, imakeidx, or makeidx + `\printindex`.
 */
export function detectCompileSettings(files: ProjectFile[], mainPath?: string, opts: DetectSettingsOptions = {}): CompileSettings {
  const requested = mainPath ? normalizePath(mainPath) : findMainFile(files);
  if (!requested) {
    const empty = scanLatex('');
    return {
      mainPath: '',
      engine: opts.engine && opts.engine !== 'auto' ? opts.engine : (opts.defaultEngine ?? 'pdflatex'),
      engineSource: opts.engine && opts.engine !== 'auto' ? 'explicit' : 'default',
      bibTool: opts.bibTool && opts.bibTool !== 'auto' ? opts.bibTool : 'none',
      bibSource: opts.bibTool && opts.bibTool !== 'auto' ? 'explicit' : 'detected',
      makeindex: opts.makeindex === true,
      magic: {},
      scannedPaths: [],
      isCompilableMain: false,
      scan: empty,
    };
  }
  const main = followTexRoot(files, requested);
  const { paths, scans } = includeClosure(files, main);
  const scan = mergeScans([...scans.values()]);
  const mainScan = scans.get(main);
  const magic = { ...(mainScan?.magic ?? {}) };
  // A magic program comment in the originally requested child file also counts.
  if (main !== requested) {
    const child = files.find((f) => normalizePath(f.path) === requested);
    if (child) for (const [k, v] of Object.entries(parseMagicComments(fileText(child.content)))) if (!(k in magic) && k !== 'root') magic[k] = v;
  }

  const engine = detectEngine(scan, magic, opts);
  let bibTool: Exclude<BibTool, 'auto'>;
  let bibSource: CompileSettings['bibSource'];
  if (opts.bibTool && opts.bibTool !== 'auto') {
    bibTool = opts.bibTool;
    bibSource = 'explicit';
  } else {
    bibTool = detectBibTool(scan, magic);
    bibSource = bibToolFromProgram(magic['bib-program'] ?? magic['bib-ts-program']) ? 'magic' : 'detected';
  }
  const makeindex = typeof opts.makeindex === 'boolean' ? opts.makeindex : detectMakeindex(scan);

  return {
    mainPath: main,
    requestedMainPath: main !== requested ? requested : undefined,
    engine: engine.engine,
    engineSource: engine.source,
    engineReason: engine.reason,
    bibTool,
    bibSource,
    makeindex,
    magic,
    scannedPaths: paths,
    isCompilableMain: !!mainScan?.documentClass && !!mainScan?.hasBeginDocument,
    scan,
  };
}
