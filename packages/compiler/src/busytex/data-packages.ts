/**
 * Smart TeX Live data-package selection for BusyTeX.
 *
 * The BusyTeX release ships three *nested* TeX Live trees, each a complete,
 * self-contained data package mounted at `/texlive`:
 *
 *   texlive-basic        (~88 MB)  scheme-basic + latex, xetex, luatex
 *   texlive-recommended  (~192 MB) + fontsrecommended + latexrecommended
 *   texlive-extra        (~326 MB) + latexextra
 *
 * Because they are supersets of each other (and collide on file paths) exactly
 * one of them must be loaded per engine instance. We pick the smallest tier that
 * contains every file the project needs.
 *
 * Index sources, best first:
 *   1. `texlive-<tier>.txt` — full file listing of the tier (authoritative).
 *   2. `texlive-<tier>.js.providespackage.txt` — lines of the form
 *      `// \ProvidesPackage{name}[date version]` grepped from the tier's
 *      `.sty` files. Incomplete: packages declared with `\ProvidesExplPackage`
 *      (fontspec, siunitx, xparse…) or `\ProvidesFile` (tikz) and every class are
 *      missing, so it is only used as a fallback.
 */
import { basename, extname, normalizePath } from '@texit/core';
import type { ProjectFile } from '@texit/core';
import { packageOptions, scanLatex, type LatexScan } from '../latex-scan';
import { fileText } from '../util';

export const DEFAULT_DATA_PACKAGES = ['texlive-basic', 'texlive-recommended', 'texlive-extra'] as const;

export interface DataPackageIndex {
  /** Data package names in ascending size order (each a superset of the previous). */
  readonly tiers: readonly string[];
  /** True when built from full file listings: a miss means "not available in any tier". */
  readonly complete: boolean;
  readonly source: 'file-lists' | 'providespackage';
  /** Index of the smallest tier containing `fileName` (a basename such as `tikz.sty`). */
  lookup(fileName: string): number | undefined;
  readonly size: number;
}

class MapIndex implements DataPackageIndex {
  private readonly lower = new Map<string, number>();
  constructor(
    readonly tiers: readonly string[],
    private readonly exact: Map<string, number>,
    readonly complete: boolean,
    readonly source: DataPackageIndex['source'],
  ) {
    for (const [k, v] of exact) {
      const lk = k.toLowerCase();
      const prev = this.lower.get(lk);
      if (prev === undefined || v < prev) this.lower.set(lk, v);
    }
  }
  lookup(fileName: string): number | undefined {
    const name = basename(fileName);
    return this.exact.get(name) ?? this.lower.get(name.toLowerCase());
  }
  get size(): number {
    return this.exact.size;
  }
}

/** Basenames (with an extension) listed in a `texlive-<tier>.txt` file listing. */
export function parseFileList(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const slash = line.lastIndexOf('/');
    const name = slash === -1 ? line : line.slice(slash + 1);
    if (name.lastIndexOf('.') > 0) out.push(name);
  }
  return out;
}

const PROVIDES_RE = /\\ProvidesPackage\s*\{([^{}]+?)\}/g;

/** Package names declared in a `*.js.providespackage.txt` index. */
export function parseProvidesPackageIndex(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PROVIDES_RE)) {
    const name = m[1].trim();
    // Skip macro-generated names such as `Package` or `#1`.
    if (/^[A-Za-z0-9][\w.-]*$/.test(name) && name !== 'Package') out.add(name);
  }
  return [...out];
}

function buildIndex(tiers: readonly string[], names: (string[] | null)[], complete: boolean, source: DataPackageIndex['source']): DataPackageIndex {
  const exact = new Map<string, number>();
  names.forEach((list, tier) => {
    if (!list) return;
    for (const n of list) if (!exact.has(n)) exact.set(n, tier);
  });
  return new MapIndex(tiers, exact, complete, source);
}

/** Build an authoritative index from the `texlive-<tier>.txt` listings (one per tier, ascending). */
export function buildIndexFromFileLists(tiers: readonly string[], lists: string[]): DataPackageIndex {
  return buildIndex(tiers, lists.map(parseFileList), true, 'file-lists');
}

/** Build a partial index from `*.js.providespackage.txt` files (one per tier, ascending). */
export function buildIndexFromProvides(tiers: readonly string[], lists: string[]): DataPackageIndex {
  return buildIndex(
    tiers,
    lists.map((t) => parseProvidesPackageIndex(t).map((n) => `${n}.sty`)),
    false,
    'providespackage',
  );
}

function looksLikeHtml(text: string): boolean {
  return /^\s*<(?:!doctype|html|head|body)/i.test(text.slice(0, 256));
}

async function fetchText(url: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetchFn(url, { signal });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html')) return null; // SPA fallback page
    const text = await res.text();
    return looksLikeHtml(text) ? null : text;
  } catch {
    return null;
  }
}

/**
 * Load the best available index from a BusyTeX asset directory (`baseUrl` must
 * end with a slash). Returns null if no index is available.
 */
export async function loadDataPackageIndex(
  baseUrl: string,
  tiers: readonly string[] = DEFAULT_DATA_PACKAGES,
  fetchFn: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<DataPackageIndex | null> {
  const lists = await Promise.all(tiers.map((t) => fetchText(`${baseUrl}${t}.txt`, fetchFn, signal)));
  if (lists.every((l): l is string => l !== null && l.includes('/'))) return buildIndexFromFileLists(tiers, lists);
  const provides = await Promise.all(tiers.map((t) => fetchText(`${baseUrl}${t}.js.providespackage.txt`, fetchFn, signal)));
  if (provides.some((p) => p !== null)) return buildIndexFromProvides(tiers, provides.map((p) => p ?? ''));
  return null;
}

// ───────────────────────────── requirements ─────────────────────────────

const SCANNED_EXTENSIONS = new Set(['tex', 'ltx', 'latex', 'sty', 'cls', 'dtx', 'bbx', 'cbx']);
const PLAIN_OPTION_RE = /^[A-Za-z][A-Za-z-]*$/;
const BABEL_NON_LANGUAGE_RE =
  /^(?:[a-z]{2}-[a-z]+|activeacute|activegrave|KeepShorthandsActive|noconfigs|showlanguages|silent|safe|math|shorthands|base|nocase|hyphenmap|bidi|layout|provide|import|main|headfoot|config|strings|debug)$/;

function requirementsOfScan(scan: LatexScan, out: Set<string>): void {
  for (const c of scan.classes) out.add(`${c}.cls`);
  for (const p of scan.packages) out.add(`${p.name}.sty`);
  for (const s of scan.bibliographyStyles) out.add(`${basename(s)}.bst`);
  // TikZ falls back to the pgf-level library of the same name.
  for (const l of scan.tikzLibraries) out.add(`tikzlibrary${l}.code.tex|pgflibrary${l}.code.tex`);
  for (const f of scan.beamerThemeFiles) out.add(f);
  for (const l of scan.languages) out.add(`gloss-${l}.ldf`);
  for (const opt of packageOptions(scan, 'babel')) {
    const main = /^main\s*=\s*([A-Za-z-]+)$/.exec(opt)?.[1];
    if (main) out.add(`${main}.ldf`);
    // Language-specific modifiers (`es-tabla`, `es-noquoting`, `fr-…`) and babel's own options are not languages.
    else if (PLAIN_OPTION_RE.test(opt) && !BABEL_NON_LANGUAGE_RE.test(opt)) out.add(`${opt}.ldf`);
  }
  for (const opt of packageOptions(scan, 'biblatex')) {
    const m = /^(style|bibstyle|citestyle)\s*=\s*([\w-]+)$/.exec(opt);
    if (!m) continue;
    if (m[1] !== 'citestyle') out.add(`${m[2]}.bbx`);
    if (m[1] !== 'bibstyle') out.add(`${m[2]}.cbx`);
  }
  for (const input of scan.inputs) {
    const name = basename(input.replace(/^"(.*)"$/, '$1'));
    if (!name || name.includes('#') || name.includes('\\')) continue;
    out.add(extname(name) ? name : `${name}.tex`);
  }
}

/**
 * Packages that replace Computer Modern for T1-encoded text. Without one of them,
 * `\usepackage[T1]{fontenc}` uses the EC fonts, whose Type 1 versions (cm-super)
 * only ship in the larger data packages.
 */
const T1_FONT_PACKAGES = new Set([
  'lmodern', 'cm-super', 'fontspec', 'mathptmx', 'times', 'newtxtext', 'newpxtext', 'tgtermes', 'tgpagella', 'tgheros',
  'tgschola', 'tgbonum', 'tgcursor', 'tgadventor', 'tgchorus', 'palatino', 'mathpazo', 'libertine', 'libertinus',
  'libertinust1math', 'fourier', 'kpfonts', 'charter', 'XCharter', 'bookman', 'helvet', 'courier', 'avant', 'utopia',
  'erewhon', 'garamondx', 'ebgaramond', 'baskervillef', 'Alegreya', 'sourceserifpro', 'sourcesanspro', 'roboto',
  'opensans', 'fira', 'FiraSans', 'noto', 'merriweather', 'crimson', 'cochineal', 'stix', 'stix2', 'step', 'mlmodern',
  'anyfontsize', 'ae', 'aecompl', 'pslatex', 'concrete', 'ccfonts', 'eulervm', 'arev', 'iwona', 'kurier', 'antpolt',
]);

function needsCmSuper(scans: LatexScan[]): boolean {
  let t1 = false;
  for (const scan of scans) {
    if (scan.packages.some((p) => T1_FONT_PACKAGES.has(p.name))) return false;
    if (packageOptions(scan, 'fontenc').some((o) => /^T1$/i.test(o.trim()))) t1 = true;
  }
  return t1;
}

/**
 * File names (basenames such as `tikz.sty`, `beamer.cls`, `plainnat.bst`) the
 * project needs from TeX Live, from every `.tex`/`.sty`/`.cls` file in it.
 * Alternatives are joined with `|` (any of them satisfies the requirement).
 * Files that the project itself provides are excluded.
 */
export function collectRequirements(files: ProjectFile[]): string[] {
  const out = new Set<string>();
  const local = new Set<string>();
  const scans: LatexScan[] = [];
  for (const f of files) {
    const path = normalizePath(f.path);
    local.add(basename(path));
    if (!SCANNED_EXTENSIONS.has(extname(path))) continue;
    const scan = scanLatex(fileText(f.content));
    scans.push(scan);
    requirementsOfScan(scan, out);
  }
  if (needsCmSuper(scans)) out.add('cm-super-t1.enc');
  return [...out].filter((n) => !n.split('|').some((alt) => local.has(alt))).sort();
}

export interface TierSelection {
  /** Chosen tier index into `index.tiers` (or `minTier` without an index). */
  tier: number;
  /** Requirements that forced the chosen tier (empty when the minimum tier suffices). */
  drivers: string[];
  /** Requirements not found in any data package (resolved remotely, from the project, or missing). */
  unknown: string[];
  /** True if the (partial) index forced the largest tier because of unknown packages. */
  escalatedForUnknown: boolean;
}

export interface SelectTierOptions {
  /** Lowest tier allowed (e.g. per engine). */
  minTier?: number;
  /** A TeX Live remote endpoint is configured: unknown files will be fetched on demand. */
  hasRemoteEndpoint?: boolean;
}

/** Smallest tier providing any of the `|`-separated alternatives. */
function lookupAny(index: DataPackageIndex, requirement: string): number | undefined {
  let best: number | undefined;
  for (const alt of requirement.split('|')) {
    const t = index.lookup(alt);
    if (t !== undefined && (best === undefined || t < best)) best = t;
  }
  return best;
}

/** Choose the smallest data package that contains every required file. */
export function selectDataPackageTier(required: string[], index: DataPackageIndex | null, opts: SelectTierOptions = {}): TierSelection {
  const minTier = Math.max(0, opts.minTier ?? 0);
  let tier = minTier;
  let drivers: string[] = [];
  const unknown: string[] = [];
  if (!index) return { tier, drivers, unknown: [...required], escalatedForUnknown: false };
  for (const f of required) {
    const t = lookupAny(index, f);
    if (t === undefined) {
      unknown.push(f);
      continue;
    }
    if (t > tier) {
      tier = t;
      drivers = [f];
    } else if (t === tier && t > minTier) {
      drivers.push(f);
    }
  }
  const top = index.tiers.length - 1;
  // A partial index only knows \ProvidesPackage names, so an unknown *package* may well live in a bigger tier.
  if (!index.complete && !opts.hasRemoteEndpoint && tier < top && unknown.some((f) => f.endsWith('.sty'))) {
    return { tier: top, drivers: unknown.filter((f) => f.endsWith('.sty')), unknown, escalatedForUnknown: true };
  }
  return { tier, drivers, unknown, escalatedForUnknown: false };
}

// ───────────────────────────── missing-file detection ─────────────────────────────

function fontCandidates(name: string): string[] {
  return [`${name}.tfm`, `${name}.vf`, `${name}.pfb`, `${name}.otf`, `${name}.ttf`];
}

/**
 * File names a failed compilation could not find, extracted from the TeX /
 * kpathsea / bibtex / xdvipdfmx output. Font errors expand to candidate font
 * files (`.tfm`, `.vf`, `.pfb`, `.otf`, `.ttf`).
 */
export function findMissingFiles(log: string): string[] {
  const out = new Set<string>();
  const add = (n: string | undefined) => {
    const name = n?.trim();
    if (name && name.length < 200) out.add(basename(name));
  };
  for (const m of log.matchAll(/! LaTeX Error: File `([^']+)' not found/g)) add(m[1]);
  for (const m of log.matchAll(/! I can't find file `([^']+)'/g)) {
    const n = m[1].trim();
    add(extname(n) ? n : `${n}.tex`);
  }
  for (const m of log.matchAll(/language definition file (\S+?\.ldf) was not found/g)) add(m[1]);
  // pdfTeX: "!pdfTeX error: … (file cm-super-t1.enc): cannot open encoding file" / "… Type 1 font file".
  for (const m of log.matchAll(/\(file ([^)\s]+)\): cannot open (?:encoding|Type 1 font|font)/g)) add(m[1]);
  // babel ≥ 3.x: `\usepackage[spanish]{babel}` without spanish.ldf → "Unknown option 'spanish'".
  for (const m of log.matchAll(/Package babel Error: Unknown option [`']([A-Za-z-]+)'/g)) add(`${m[1]}.ldf`);
  for (const m of log.matchAll(/I couldn't open style file (\S+)/g)) add(m[1].endsWith('.bst') ? m[1] : `${m[1]}.bst`);
  for (const m of log.matchAll(/! Font [^=\n]*=([^\s]+?)(?: at [^\n]*?| scaled [^\n]*?)? not loadable: Metric \(TFM\) file/g)) add(`${m[1]}.tfm`);
  for (const m of log.matchAll(/kpathsea: Running mktextfm (\S+)/g)) add(`${m[1]}.tfm`);
  for (const m of log.matchAll(/kpathsea: Running mktexpk [^\n]*?(\S+)\s*$/gm)) fontCandidates(m[1]).forEach(add);
  for (const m of log.matchAll(/Could not locate a virtual\/physical font for TFM "([^"]+)"/g)) fontCandidates(m[1]).forEach(add);
  for (const m of log.matchAll(/The font "([^"]+)" cannot be found/g)) {
    const font = m[1].trim();
    if (extname(font)) add(font);
    else {
      const slug = font.toLowerCase().replace(/\s+/g, '');
      [`${slug}-regular.otf`, `${slug}.otf`, `${slug}-regular.ttf`, `${slug}.ttf`].forEach(add);
    }
  }
  return [...out];
}

/**
 * Tier to retry with after a failure caused by missing files, or undefined if
 * a bigger data package would not help.
 */
export function escalationTier(missing: string[], index: DataPackageIndex | null, currentTier: number, tierCount: number): number | undefined {
  if (!missing.length) return undefined;
  const top = tierCount - 1;
  if (currentTier >= top) return undefined;
  if (!index) return top;
  let target = -1;
  for (const f of missing) {
    const t = index.lookup(f);
    if (t !== undefined && t > target) target = t;
  }
  if (target > currentTier) return target;
  if (!index.complete) return top;
  return undefined;
}
