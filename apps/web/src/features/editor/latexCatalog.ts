/**
 * Normalised LaTeX catalog (commands, environments, symbols, packages) used by
 * autocompletion and hovers.
 *
 * Prefers the catalog from `@texit/core` (`latex-data.ts`) and falls back to the
 * tables shipped with `codemirror-lang-latex` while the core one is not
 * available. Shapes are normalised defensively so either source works.
 */
import * as core from '@texit/core';
import {
  latexCommands as cmCommands,
  latexEnvironments as cmEnvironments,
  latexPackages as cmPackages,
  mathSymbols as cmSymbols,
} from 'codemirror-lang-latex';

export interface CatalogCommand {
  /** Without the leading backslash. */
  name: string;
  /** CodeMirror snippet template (with `${}` fields), including the backslash. */
  snippet?: string;
  detail?: string;
  info?: string;
  package?: string;
  math?: boolean;
  /** Unicode glyph for math symbols. */
  glyph?: string;
}

export interface CatalogEnvironment {
  name: string;
  /** Snippet for the environment body (inserted between \begin and \end). */
  body?: string;
  /** Snippet for arguments right after \begin{name} (e.g. `{${cols}}`). */
  args?: string;
  detail?: string;
  package?: string;
  math?: boolean;
}

export interface CatalogPackage {
  name: string;
  detail?: string;
}

export interface LatexCatalog {
  commands: CatalogCommand[];
  environments: CatalogEnvironment[];
  packages: CatalogPackage[];
  commandIndex: Map<string, CatalogCommand>;
  environmentIndex: Map<string, CatalogEnvironment>;
}

const stripSlash = (s: string) => (s.startsWith('\\') ? s.slice(1) : s);

/** Convert a template like `\frac{}{}` or `\frac{#1}{#2}` into a snippet with fields. */
export function templateToSnippet(tpl: string): string {
  if (/\$\{|#\{/.test(tpl)) return tpl.replace(/#\{/g, '${');
  let n = 0;
  let out = tpl.replace(/#(\d)/g, (_m, d) => `\${${d}}`);
  if (out !== tpl) return out;
  out = tpl.replace(/\{\}/g, () => `{\${${++n}}}`).replace(/\[\]/g, () => `[\${${++n}}]`);
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}

function normCommand(raw: any): CatalogCommand | null {
  if (!raw) return null;
  if (typeof raw === 'string') return { name: stripSlash(raw) };
  const name = str(raw.name) ?? str(raw.command) ?? str(raw.label);
  if (!name) return null;
  const tpl = str(raw.snippet) ?? str(raw.template) ?? str(raw.insert);
  let snippet: string | undefined;
  if (tpl) {
    const withSlash = tpl.startsWith('\\') ? tpl : `\\${tpl}`;
    snippet = templateToSnippet(withSlash);
  }
  return {
    name: stripSlash(name),
    snippet,
    detail: str(raw.detail) ?? str(raw.signature),
    info: str(raw.info) ?? str(raw.description) ?? str(raw.doc),
    package: str(raw.package) ?? str(raw.pkg),
    math: !!(raw.math ?? raw.mathOnly ?? (raw.mode === 'math' || raw.category === 'math' || raw.category === 'symbol')),
    glyph: str(raw.glyph) ?? str(raw.symbol) ?? str(raw.unicode),
  };
}

function normEnv(raw: any): CatalogEnvironment | null {
  if (!raw) return null;
  if (typeof raw === 'string') return { name: raw };
  const name = str(raw.name);
  if (!name) return null;
  return {
    name,
    body: str(raw.body) ?? str(raw.snippet) ?? str(raw.content),
    args: str(raw.args) ?? str(raw.arguments),
    detail: str(raw.detail) ?? str(raw.description),
    package: str(raw.package),
    math: !!(raw.math ?? raw.mathOnly),
  };
}

function normPackage(raw: any): CatalogPackage | null {
  if (!raw) return null;
  if (typeof raw === 'string') return { name: raw };
  const name = str(raw.name);
  if (!name) return null;
  return { name, detail: str(raw.detail) ?? str(raw.description) };
}

/** Bodies for common environments (used when the catalog has none). */
const defaultBodies: Record<string, { body?: string; args?: string }> = {
  itemize: { body: '\\item ${}' },
  enumerate: { body: '\\item ${}' },
  description: { body: '\\item[${1:term}] ${2}' },
  figure: { args: '[${1:htbp}]', body: '\\centering\n\\includegraphics[width=0.8\\linewidth]{${2}}\n\\caption{${3}}\n\\label{fig:${4}}' },
  'figure*': { args: '[${1:htbp}]', body: '\\centering\n\\includegraphics[width=\\linewidth]{${2}}\n\\caption{${3}}\n\\label{fig:${4}}' },
  table: {
    args: '[${1:htbp}]',
    body: '\\centering\n\\caption{${2}}\n\\label{tab:${3}}\n\\begin{tabular}{${4:lll}}\n\t\\toprule\n\t${5} \\\\\n\t\\midrule\n\t\\bottomrule\n\\end{tabular}',
  },
  tabular: { args: '{${1:lll}}', body: '${2}' },
  'tabular*': { args: '{${1:\\linewidth}}{${2:lll}}', body: '${3}' },
  tabularx: { args: '{${1:\\linewidth}}{${2:lX}}', body: '${3}' },
  equation: { body: '${}' },
  'equation*': { body: '${}' },
  align: { body: '${1} &= ${2}' },
  'align*': { body: '${1} &= ${2}' },
  gather: { body: '${}' },
  multline: { body: '${}' },
  cases: { body: '${1} & ${2} \\\\\n${3} & ${4}' },
  matrix: { body: '${}' },
  pmatrix: { body: '${}' },
  bmatrix: { body: '${}' },
  frame: { args: '{${1:Title}}', body: '${2}' },
  minipage: { args: '{${1:0.45\\linewidth}}', body: '${2}' },
  thebibliography: { args: '{${1:99}}', body: '\\bibitem{${2}} ${3}' },
  tikzpicture: { body: '${}' },
  lstlisting: { args: '[language=${1:Python}]', body: '${2}' },
  verbatim: { body: '${}' },
  theorem: { body: '${}' },
  proof: { body: '${}' },
  abstract: { body: '${}' },
  center: { body: '${}' },
  quote: { body: '${}' },
  columns: { body: '\\column{0.5\\textwidth}\n${1}\n\\column{0.5\\textwidth}\n${2}' },
  subfigure: { args: '{${1:0.48\\linewidth}}', body: '\\centering\n\\includegraphics[width=\\linewidth]{${2}}\n\\caption{${3}}' },
};

const extraPackageInfo: Record<string, string> = {
  amsmath: 'AMS mathematical facilities',
  amssymb: 'AMS symbol fonts',
  amsthm: 'Theorem environments',
  graphicx: 'Include graphics (\\includegraphics)',
  hyperref: 'Hyperlinks & PDF metadata',
  cleveref: 'Smart cross-references (\\cref)',
  biblatex: 'Modern bibliographies (biber)',
  natbib: 'Author–year citations',
  geometry: 'Page layout & margins',
  xcolor: 'Colors',
  tikz: 'Programmatic graphics',
  booktabs: 'Professional tables',
  siunitx: 'SI units & number formatting',
  listings: 'Source code listings',
  minted: 'Highlighted code (needs -shell-escape)',
  babel: 'Multilingual typesetting',
  fontenc: 'Font encodings',
  inputenc: 'Input encodings',
  microtype: 'Micro-typography',
  enumitem: 'Customise lists',
  caption: 'Customise captions',
  subcaption: 'Sub-figures & sub-captions',
  fancyhdr: 'Headers & footers',
  csquotes: 'Context-sensitive quotes',
  mathtools: 'amsmath extensions & fixes',
  physics: 'Physics notation shortcuts',
  algorithm2e: 'Algorithms',
  float: 'Improved floats ([H])',
  url: 'Typeset URLs',
  tabularx: 'Auto-width table columns',
  multirow: 'Multi-row table cells',
  pgfplots: 'Plots with TikZ',
  fontspec: 'System fonts (XeLaTeX/LuaLaTeX)',
  lipsum: 'Dummy text',
};

let cached: LatexCatalog | null = null;
let cachedSource: unknown = null;

/** The current catalog (rebuilt automatically once the core catalog lands). */
export function getCatalog(): LatexCatalog {
  const c = core as any;
  const source = c.latexCommands ?? null;
  if (cached && cachedSource === source) return cached;

  let commands: CatalogCommand[] = [];
  let environments: CatalogEnvironment[] = [];
  let packages: CatalogPackage[] = [];
  try {
    if (Array.isArray(c.latexCommands) && c.latexCommands.length) commands = c.latexCommands.map(normCommand).filter(Boolean);
    if (Array.isArray(c.mathSymbols)) {
      for (const entry of c.mathSymbols as any[]) {
        // Either flat symbols or `{ group, symbols: [{ cmd, char, name, package }] }`.
        const list: any[] = Array.isArray(entry?.symbols) ? entry.symbols : [entry];
        for (const sym of list) {
          const cmd = str(sym?.cmd) ?? str(sym?.name);
          if (!cmd) continue;
          const name = stripSlash(cmd);
          commands.push({
            name,
            glyph: str(sym.char) ?? str(sym.glyph) ?? str(sym.symbol),
            detail: Array.isArray(entry?.symbols) ? str(sym.name) : undefined,
            package: str(sym.package),
            math: true,
            snippet: name.includes("{") ? `\\${name}` : undefined,
          });
        }
      }
    }
    if (Array.isArray(c.latexEnvironments) && c.latexEnvironments.length) environments = c.latexEnvironments.map(normEnv).filter(Boolean);
    if (Array.isArray(c.latexPackages) && c.latexPackages.length) packages = c.latexPackages.map(normPackage).filter(Boolean);
  } catch (err) {
    console.warn('[editor] could not read the core LaTeX catalog', err);
  }
  if (!commands.length) {
    commands = [
      ...cmCommands.map(normCommand).filter((x): x is CatalogCommand => !!x),
      ...cmSymbols.map((s) => ({ name: stripSlash(s.name), glyph: s.glyph, package: s.package, math: true })),
    ];
  }
  if (!environments.length) environments = cmEnvironments.map(normEnv).filter((x): x is CatalogEnvironment => !!x);
  if (!packages.length) packages = cmPackages.map((p) => ({ name: p }));

  // Merge in default bodies / package descriptions.
  for (const env of environments) {
    const d = defaultBodies[env.name];
    if (d) {
      env.body ??= d.body;
      env.args ??= d.args;
    }
  }
  for (const name of Object.keys(defaultBodies)) {
    if (!environments.some((e) => e.name === name)) environments.push({ name, ...defaultBodies[name] });
  }
  for (const p of packages) p.detail ??= extraPackageInfo[p.name];
  for (const name of Object.keys(extraPackageInfo)) {
    if (!packages.some((p) => p.name === name)) packages.push({ name, detail: extraPackageInfo[name] });
  }

  const commandIndex = new Map<string, CatalogCommand>();
  for (const cmd of commands) {
    const prev = commandIndex.get(cmd.name);
    // Prefer entries with richer information.
    if (!prev || (!prev.snippet && cmd.snippet) || (!prev.glyph && cmd.glyph)) commandIndex.set(cmd.name, { ...prev, ...cmd });
  }
  const environmentIndex = new Map<string, CatalogEnvironment>();
  for (const env of environments) environmentIndex.set(env.name, { ...environmentIndex.get(env.name), ...env });

  cached = {
    commands: Array.from(commandIndex.values()),
    environments: Array.from(environmentIndex.values()),
    packages,
    commandIndex,
    environmentIndex,
  };
  cachedSource = source;
  return cached;
}

export const documentClasses = [
  'article', 'report', 'book', 'letter', 'beamer', 'memoir', 'scrartcl', 'scrreprt', 'scrbook', 'amsart', 'amsbook',
  'IEEEtran', 'acmart', 'llncs', 'revtex4-2', 'elsarticle', 'moderncv', 'standalone', 'tufte-book', 'tufte-handout',
];
