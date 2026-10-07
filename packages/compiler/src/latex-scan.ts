/**
 * Lightweight, forgiving LaTeX source scanner used by the compiler for
 * engine / bibliography / data-package detection. It intentionally does not
 * depend on `@texit/core`'s `analyzeLatex` so that compilation never breaks
 * because of an editor-side analysis failure.
 */

export interface LatexPackageUse {
  name: string;
  options: string[];
  /** 'usepackage' | 'RequirePackage' | … */
  command: string;
}

export interface LatexScan {
  documentClass?: { name: string; options: string[] };
  /** \documentclass + \LoadClass targets. */
  classes: string[];
  packages: LatexPackageUse[];
  /** \bibliography{a,b} (without .bib extension, as written). */
  bibliographies: string[];
  /** \addbibresource / \addglobalbib / \addsectionbib targets. */
  bibResources: string[];
  bibliographyStyles: string[];
  /** \input / \include / \subfile / \import targets (as written, relative to the including dir). */
  inputs: string[];
  /** \includegraphics targets (as written). */
  graphics: string[];
  tikzLibraries: string[];
  /** File names of beamer themes (e.g. `beamerthemeMadrid.sty`). */
  beamerThemeFiles: string[];
  /** polyglossia languages (\setdefaultlanguage, \setotherlanguages…). */
  languages: string[];
  hasMakeindex: boolean;
  hasPrintindex: boolean;
  hasMakeglossaries: boolean;
  hasDirectLua: boolean;
  requiresLuaTeX: boolean;
  requiresXeTeX: boolean;
  hasBeginDocument: boolean;
  magic: Record<string, string>;
}

/** Remove TeX comments (unescaped `%` to end of line) but keep the line structure. */
export function stripComments(src: string): string {
  if (!src.includes('%')) return src;
  const lines = src.split('\n');
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let idx = line.indexOf('%');
    while (idx !== -1) {
      let bs = 0;
      for (let j = idx - 1; j >= 0 && line.charCodeAt(j) === 92 /* \ */; j--) bs++;
      if (bs % 2 === 0) {
        lines[li] = line.slice(0, idx);
        break;
      }
      idx = line.indexOf('%', idx + 1);
    }
  }
  return lines.join('\n');
}

const MAGIC_RE = /^\s*%+\s*!\s*(TEX|BIB)\s+([A-Za-z][\w-]*)\s*=\s*(.*?)\s*$/i;

/**
 * Parse TeXShop / TeXworks / VS Code style magic comments from the head of a
 * file. Keys are lower-cased; BIB keys are prefixed with `bib-`:
 * `% !TEX program = xelatex` → `{ program: 'xelatex' }`,
 * `% !TEX TS-program = lualatex` → `{ 'ts-program': 'lualatex' }`,
 * `% !BIB program = biber` → `{ 'bib-program': 'biber' }`.
 */
export function parseMagicComments(src: string, maxLines = 50): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  let start = 0;
  if (src.charCodeAt(0) === 0xfeff) start = 1; // BOM
  while (start <= src.length && count < maxLines) {
    let end = src.indexOf('\n', start);
    if (end === -1) end = src.length;
    const line = src.slice(start, end);
    const m = MAGIC_RE.exec(line);
    if (m) {
      const scope = m[1].toLowerCase();
      const key = (scope === 'bib' ? 'bib-' : '') + m[2].toLowerCase();
      if (!(key in out) && m[3]) out[key] = m[3];
    }
    count++;
    start = end + 1;
  }
  return out;
}

function splitList(s: string): string[] {
  return s
    .split(',')
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function splitOptions(s: string | undefined): string[] {
  if (!s) return [];
  return splitList(s);
}

const OPT = String.raw`(?:\s*\[([^\]]*)\])?`;
const ARG = String.raw`\s*\{([^{}]*)\}`;

const RE = {
  pkg: new RegExp(String.raw`\\(usepackage|RequirePackage|RequirePackageWithOptions)(?![A-Za-z@])${OPT}${ARG}`, 'g'),
  docclass: new RegExp(String.raw`\\documentclass(?![A-Za-z@])${OPT}${ARG}`, 'g'),
  loadclass: new RegExp(String.raw`\\LoadClass(?:WithOptions)?(?![A-Za-z@])${OPT}${ARG}`, 'g'),
  bibliography: new RegExp(String.raw`\\(?:bibliography|nobibliography)(?![A-Za-z@])${ARG}`, 'g'),
  bibresource: new RegExp(String.raw`\\(?:addbibresource|addglobalbib|addsectionbib)(?![A-Za-z@])${OPT}${ARG}`, 'g'),
  bibstyle: new RegExp(String.raw`\\bibliographystyle(?![A-Za-z@])${ARG}`, 'g'),
  input: new RegExp(String.raw`\\(?:input|include|subfile|subfileinclude|InputIfFileExists|includeonly)(?![A-Za-z@])${ARG}`, 'g'),
  inputBare: /\\input(?![A-Za-z@])[ \t]+([^\s{}\\%]+)/g,
  importCmd: new RegExp(String.raw`\\(?:sub)?(?:import|inputfrom|includefrom)\*?(?![A-Za-z@])${ARG}${ARG}`, 'g'),
  graphics: new RegExp(String.raw`\\includegraphics\*?(?![A-Za-z@])${OPT}${ARG}`, 'g'),
  tikzlib: new RegExp(String.raw`\\usetikzlibrary(?![A-Za-z@])${ARG}`, 'g'),
  beamertheme: new RegExp(String.raw`\\use(color|font|inner|outer)?theme(?![A-Za-z@])${OPT}${ARG}`, 'g'),
  language: new RegExp(String.raw`\\set(?:default|main|other)languages?(?![A-Za-z@])${OPT}${ARG}`, 'g'),
  makeindex: /\\makeindex(?![A-Za-z@])/,
  printindex: /\\printindex(?![A-Za-z@])/,
  makeglossaries: /\\(?:makeglossaries|makenoidxglossaries)(?![A-Za-z@])/,
  directlua: /\\(?:directlua|luaexec|luadirect)(?![A-Za-z@])|\\begin\s*\{luacode\*?\}/,
  requireLua: /\\RequireLuaTeX(?![A-Za-z@])/,
  requireXe: /\\RequireXeTeX(?![A-Za-z@])/,
  beginDocument: /\\begin\s*\{document\}/,
};

/** Scan a LaTeX source (`.tex`, `.sty`, `.cls`) for the commands the compiler cares about. */
export function scanLatex(source: string): LatexScan {
  const magic = parseMagicComments(source);
  const src = stripComments(source);
  const scan: LatexScan = {
    classes: [],
    packages: [],
    bibliographies: [],
    bibResources: [],
    bibliographyStyles: [],
    inputs: [],
    graphics: [],
    tikzLibraries: [],
    beamerThemeFiles: [],
    languages: [],
    hasMakeindex: RE.makeindex.test(src),
    hasPrintindex: RE.printindex.test(src),
    hasMakeglossaries: RE.makeglossaries.test(src),
    hasDirectLua: RE.directlua.test(src),
    requiresLuaTeX: RE.requireLua.test(src),
    requiresXeTeX: RE.requireXe.test(src),
    hasBeginDocument: RE.beginDocument.test(src),
    magic,
  };

  for (const m of src.matchAll(RE.docclass)) {
    const name = m[2].trim();
    if (!name) continue;
    if (!scan.documentClass) scan.documentClass = { name, options: splitOptions(m[1]) };
    scan.classes.push(name);
  }
  for (const m of src.matchAll(RE.loadclass)) {
    const name = m[2].trim();
    if (name) scan.classes.push(name);
  }
  for (const m of src.matchAll(RE.pkg)) {
    const options = splitOptions(m[2]);
    for (const name of splitList(m[3])) scan.packages.push({ name, options, command: m[1] });
  }
  for (const m of src.matchAll(RE.bibliography)) scan.bibliographies.push(...splitList(m[1]));
  for (const m of src.matchAll(RE.bibresource)) scan.bibResources.push(...splitList(m[2]));
  for (const m of src.matchAll(RE.bibstyle)) scan.bibliographyStyles.push(...splitList(m[1]));
  for (const m of src.matchAll(RE.input)) {
    // \includeonly takes a list; the others a single file (which may itself contain commas only in odd cases).
    scan.inputs.push(...(m[0].startsWith('\\includeonly') ? splitList(m[1]) : [m[1].trim()]).filter(Boolean));
  }
  for (const m of src.matchAll(RE.inputBare)) scan.inputs.push(m[1].trim());
  for (const m of src.matchAll(RE.importCmd)) {
    const dir = m[1].trim();
    const file = m[2].trim();
    if (file) scan.inputs.push(dir ? `${dir.replace(/\/?$/, '/')}${file}` : file);
  }
  for (const m of src.matchAll(RE.graphics)) if (m[2].trim()) scan.graphics.push(m[2].trim());
  for (const m of src.matchAll(RE.tikzlib)) scan.tikzLibraries.push(...splitList(m[1]));
  for (const m of src.matchAll(RE.beamertheme)) {
    const kind = m[1] ?? '';
    for (const name of splitList(m[3])) scan.beamerThemeFiles.push(`beamer${kind}theme${name}.sty`);
  }
  for (const m of src.matchAll(RE.language)) scan.languages.push(...splitList(m[2]));
  return scan;
}

/** Merge several scans (e.g. of every file in the main file's include closure). */
export function mergeScans(scans: LatexScan[]): LatexScan {
  const out = scanLatex('');
  for (const s of scans) {
    if (!out.documentClass && s.documentClass) out.documentClass = s.documentClass;
    out.classes.push(...s.classes);
    out.packages.push(...s.packages);
    out.bibliographies.push(...s.bibliographies);
    out.bibResources.push(...s.bibResources);
    out.bibliographyStyles.push(...s.bibliographyStyles);
    out.inputs.push(...s.inputs);
    out.graphics.push(...s.graphics);
    out.tikzLibraries.push(...s.tikzLibraries);
    out.beamerThemeFiles.push(...s.beamerThemeFiles);
    out.languages.push(...s.languages);
    out.hasMakeindex ||= s.hasMakeindex;
    out.hasPrintindex ||= s.hasPrintindex;
    out.hasMakeglossaries ||= s.hasMakeglossaries;
    out.hasDirectLua ||= s.hasDirectLua;
    out.requiresLuaTeX ||= s.requiresLuaTeX;
    out.requiresXeTeX ||= s.requiresXeTeX;
    out.hasBeginDocument ||= s.hasBeginDocument;
    for (const [k, v] of Object.entries(s.magic)) if (!(k in out.magic)) out.magic[k] = v;
  }
  return out;
}

/** True if the scan loads `name` via \usepackage / \RequirePackage. */
export function usesPackage(scan: LatexScan, name: string): boolean {
  return scan.packages.some((p) => p.name === name);
}

export function packageOptions(scan: LatexScan, name: string): string[] {
  return scan.packages.filter((p) => p.name === name).flatMap((p) => p.options);
}
