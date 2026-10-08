/** Friendly, actionable hints for common LaTeX diagnostics. */
import type { Diagnostic, TexEngine } from '@texit/core';
import { t as tr, type TFunction } from '@/lib/i18n';
import './i18n';

export interface HintContext {
  backendId?: string;
  engine?: TexEngine;
}

/** Commands that are undefined unless a package is loaded. */
const COMMAND_PACKAGES: Record<string, string> = {
  includegraphics: 'graphicx', graphicspath: 'graphicx', rotatebox: 'graphicx', scalebox: 'graphicx',
  url: 'url', href: 'hyperref', autoref: 'hyperref', hypersetup: 'hyperref', texorpdfstring: 'hyperref',
  toprule: 'booktabs', midrule: 'booktabs', bottomrule: 'booktabs', cmidrule: 'booktabs',
  SI: 'siunitx', si: 'siunitx', qty: 'siunitx', unit: 'siunitx', num: 'siunitx', ang: 'siunitx',
  mathbb: 'amssymb', mathfrak: 'amssymb', text: 'amsmath', operatorname: 'amsmath', DeclareMathOperator: 'amsmath', eqref: 'amsmath',
  binom: 'amsmath', dfrac: 'amsmath', tfrac: 'amsmath', boldsymbol: 'amsmath', mathscr: 'mathrsfs', bm: 'bm',
  textcolor: 'xcolor', color: 'xcolor', colorbox: 'xcolor', definecolor: 'xcolor', rowcolor: 'xcolor (with the table option)',
  cref: 'cleveref', Cref: 'cleveref', lipsum: 'lipsum', blindtext: 'blindtext', multirow: 'multirow', multicolumn: 'array',
  ce: 'mhchem', tikz: 'tikz', citep: 'natbib', citet: 'natbib', printbibliography: 'biblatex', addbibresource: 'biblatex',
  enquote: 'csquotes', sout: 'ulem', uline: 'ulem', hl: 'soul', todo: 'todonotes', xspace: 'xspace', FloatBarrier: 'placeins',
  captionof: 'caption', subcaption: 'subcaption', subfloat: 'subfig', lstinline: 'listings', lstset: 'listings', mintinline: 'minted',
  setlength: 'core LaTeX', newgeometry: 'geometry', geometry: 'geometry', fancyhead: 'fancyhdr', fancyfoot: 'fancyhdr',
  pagestyle: 'core LaTeX', titleformat: 'titlesec', setlist: 'enumitem', onehalfspacing: 'setspace', doublespacing: 'setspace',
  checkmark: 'amssymb', varnothing: 'amssymb', coloneqq: 'mathtools', mathclap: 'mathtools', DeclarePairedDelimiter: 'mathtools',
  pgfplotsset: 'pgfplots', faIcon: 'fontawesome5', euro: 'eurosym', degree: 'gensymb', celsius: 'gensymb', textdegree: 'textcomp',
  newcolumntype: 'array', makecell: 'makecell', tabularx: 'tabularx', ding: 'pifont', setmainfont: 'fontspec', setsansfont: 'fontspec',
};

/** The undefined command name from a log excerpt (`l.12 … \foo`). */
export function undefinedCommand(d: Diagnostic): string | undefined {
  const text = `${d.raw ?? ''}\n${d.context ?? ''}`;
  const m = /l\.\d+ [^\n]*?\\([A-Za-z@]+)\*?\s*$/m.exec(text) ?? /\\([A-Za-z@]+)\s*$/m.exec(text);
  return m?.[1];
}

function missingName(d: Diagnostic): string | undefined {
  return /[`'"]([^'"`]+)['"`]/.exec(d.message)?.[1];
}

export function hintFor(d: Diagnostic, ctx: HintContext = {}, t: TFunction = tr): string | undefined {
  const wasm = ctx.backendId === 'busytex';
  switch (d.code) {
    case 'missing-package': {
      const name = missingName(d) ?? t('compile.hint.thisPackage');
      if (wasm) return t('compile.hint.missingPackageWasm', { name });
      return t('compile.hint.missingPackage', { name, pkg: name.replace(/\.(sty|cls)$/, '') });
    }
    case 'missing-file': {
      const name = missingName(d);
      return name ? t('compile.hint.missingFileNamed', { name }) : t('compile.hint.missingFile');
    }
    case 'undefined-control-sequence': {
      const cmd = undefinedCommand(d);
      const pkg = cmd ? COMMAND_PACKAGES[cmd] : undefined;
      if (cmd && pkg) {
        if (pkg === 'core LaTeX') return t('compile.hint.coreMisuse', { cmd });
        const pkgName = pkg.split(' ')[0];
        const pkgLabel = pkg === 'xcolor (with the table option)' ? t('compile.hint.withTableOption', { pkg: 'xcolor' }) : pkg;
        return t('compile.hint.needsPackage', { cmd, pkg: pkgLabel, pkgName });
      }
      return cmd ? t('compile.hint.undefinedCmd', { cmd }) : t('compile.hint.undefinedAny');
    }
    case 'undefined-environment':
      return t('compile.hint.undefinedEnv');
    case 'missing-dollar':
      return t('compile.hint.missingDollar');
    case 'missing-brace':
    case 'extra-brace':
    case 'runaway-argument':
      return t('compile.hint.braces');
    case 'environment-mismatch':
      return t('compile.hint.envMismatch');
    case 'missing-begin-document':
      return t('compile.hint.missingBeginDocument');
    case 'unicode-character':
      return ctx.engine === 'pdflatex' ? t('compile.hint.unicodePdflatex') : t('compile.hint.unicodeGlyph');
    case 'font-not-found':
      return wasm ? t('compile.hint.fontWasm') : t('compile.hint.font');
    case 'undefined-reference':
    case 'undefined-references':
      return t('compile.hint.undefinedRef');
    case 'undefined-citation':
    case 'missing-bib-entry':
      return t('compile.hint.undefinedCitation');
    case 'multiply-defined-label':
    case 'multiply-defined-labels':
      return t('compile.hint.multiplyDefined');
    case 'option-clash':
      return t('compile.hint.optionClash');
    case 'capacity-exceeded':
      return t('compile.hint.capacity');
    case 'unknown-graphics-extension':
      return ctx.engine === 'pdflatex' ? t('compile.hint.graphicsPdflatex') : t('compile.hint.graphics');
    case 'rerun-needed':
    case 'rerun-bibliography':
      return t('compile.hint.rerun');
    case 'overfull-hbox':
      return t('compile.hint.overfull');
    default:
      return undefined;
  }
}

/** Prompt text for "Explain" / "Fix with AI" (in the UI language, so the answer is too). */
export function aiPrompt(d: Diagnostic, mode: 'fix' | 'explain', t: TFunction = tr): string {
  const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ''}` : t('compile.ai.theProject');
  const excerpt = (d.raw ?? d.context ?? '').trim().slice(0, 1500);
  const severity = t(`compile.ai.sev.${d.severity}`, undefined, d.severity);
  const intro = t(mode === 'fix' ? 'compile.ai.fix' : 'compile.ai.explain', { severity, where });
  return `${intro}\n\n${t('compile.ai.message')}: ${d.message}${excerpt ? `\n\n${t('compile.ai.excerpt')}:\n\`\`\`\n${excerpt}\n\`\`\`` : ''}`;
}
