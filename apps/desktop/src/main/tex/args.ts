/**
 * Pure command-line builders for the native TeX drivers (unit tested).
 */
import path from 'node:path';

export type Engine = 'pdflatex' | 'xelatex' | 'lualatex';
export type BibTool = 'auto' | 'bibtex' | 'biber' | 'none';

export interface LatexmkArgsInput {
  engine: Engine;
  mainPath: string;
  synctex: boolean;
  shellEscape?: boolean;
  bibTool: BibTool;
  /** Ignore latexmkrc files (used when an untrusted project ships its own latexmkrc). */
  noRc?: boolean;
}

export function latexmkArgs(o: LatexmkArgsInput): string[] {
  const args: string[] = [];
  if (o.noRc) args.push('-norc');
  args.push(o.engine === 'xelatex' ? '-xelatex' : o.engine === 'lualatex' ? '-lualatex' : '-pdf');
  if (o.synctex) args.push('-synctex=1');
  args.push('-interaction=nonstopmode', '-file-line-error', '-f');
  if (o.bibTool === 'none') args.push('-bibtex-');
  else if (o.bibTool === 'bibtex' || o.bibTool === 'biber') args.push('-bibtex');
  args.push(o.shellEscape ? '-shell-escape' : '-no-shell-escape');
  args.push(toPosix(o.mainPath));
  return args;
}

export interface TectonicArgsInput {
  mainPath: string;
  synctex: boolean;
  shellEscape?: boolean;
  /** Absolute build directory (added to the search path so root-relative \input works for mains in subfolders). */
  buildDir: string;
}

/** `tectonic -X compile` (V2 CLI). Tectonic is XeTeX-based: engine selection is not supported. */
export function tectonicArgs(o: TectonicArgsInput): string[] {
  const args = ['-X', 'compile', toPosix(o.mainPath), '--keep-logs', '--keep-intermediates', '--outdir', o.buildDir];
  if (o.synctex) args.push('--synctex');
  args.push('-Z', 'continue-on-errors');
  if (path.posix.dirname(toPosix(o.mainPath)) !== '.') args.push('-Z', `search-path=${o.buildDir}`);
  if (o.shellEscape) args.push('-Z', 'shell-escape', '-Z', `shell-escape-cwd=${o.buildDir}`);
  return args;
}

export interface EngineArgsInput {
  mainPath: string;
  synctex: boolean;
  shellEscape?: boolean;
}

/** One raw engine pass (`pdflatex`/`xelatex`/`lualatex`). */
export function engineArgs(o: EngineArgsInput): string[] {
  const args: string[] = [];
  if (o.synctex) args.push('-synctex=1');
  args.push('-interaction=nonstopmode', '-file-line-error');
  args.push(o.shellEscape ? '-shell-escape' : '-no-shell-escape');
  args.push(toPosix(o.mainPath));
  return args;
}

/** The job name / output stem of a main file (`chapters/main.tex` → `main`). */
export function jobStem(mainPath: string): string {
  const base = path.posix.basename(toPosix(mainPath));
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Decide which bibliography tool a raw build needs after the first pass by
 * inspecting the `.aux` file and the presence of a `.bcf` (biblatex/biber).
 */
export function detectBibNeed(opts: { bibTool: BibTool; aux: string | null; hasBcf: boolean }): 'bibtex' | 'biber' | null {
  if (opts.bibTool === 'none') return null;
  if (opts.bibTool === 'biber') return opts.hasBcf ? 'biber' : null;
  if (opts.bibTool === 'bibtex') return opts.aux && /\\bibdata\{/.test(opts.aux) ? 'bibtex' : null;
  if (opts.hasBcf) return 'biber';
  if (opts.aux && /\\bibdata\{/.test(opts.aux)) return 'bibtex';
  return null;
}

/** Whether the TeX log asks for another pass. */
export function needsRerun(log: string): boolean {
  return /Rerun to get|Rerun LaTeX|Please rerun LaTeX|Label\(s\) may have changed|Table widths have changed|Please \(re\)run Biber|run Biber on the file/i.test(log);
}

/** Pretty-print a command line for the compile result / log. */
export function formatCommand(cmd: string, args: string[]): string {
  const q = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);
  return [cmd, ...args].map(q).join(' ');
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, '/');
}

/** Choose the driver for `driver: 'auto'`. */
export function pickDriver(
  requested: 'auto' | 'latexmk' | 'tectonic' | 'raw',
  available: { latexmk: boolean; tectonic: boolean; engine: boolean },
): 'latexmk' | 'tectonic' | 'raw' | null {
  if (requested === 'latexmk') return available.latexmk && available.engine ? 'latexmk' : null;
  if (requested === 'tectonic') return available.tectonic ? 'tectonic' : null;
  if (requested === 'raw') return available.engine ? 'raw' : null;
  if (available.latexmk && available.engine) return 'latexmk';
  if (available.tectonic) return 'tectonic';
  if (available.engine) return 'raw';
  return null;
}
