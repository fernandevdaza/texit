/** Friendly, actionable hints for common LaTeX diagnostics. */
import type { Diagnostic, TexEngine } from '@texit/core';

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

export function hintFor(d: Diagnostic, ctx: HintContext = {}): string | undefined {
  const wasm = ctx.backendId === 'busytex';
  switch (d.code) {
    case 'missing-package': {
      const name = missingName(d) ?? 'This package';
      const base = `${name} isn't available`;
      if (wasm)
        return `${base} in the in-browser TeX Live (it bundles the basic, recommended and latexextra collections). Upload the .sty/.cls into the project, set a TeX Live package endpoint or a remote compile server in Settings → Compiler, or use the desktop app with a full TeX installation.`;
      return `${base} in your TeX installation. Install it (e.g. \`tlmgr install ${name.replace(/\.(sty|cls)$/, '')}\`) or upload the file into the project.`;
    }
    case 'missing-file': {
      const name = missingName(d);
      return `${name ? `"${name}"` : 'A file'} could not be found. Paths are relative to the main file's folder — check the spelling, the folder and the extension (paths are case-sensitive).`;
    }
    case 'undefined-control-sequence': {
      const cmd = undefinedCommand(d);
      const pkg = cmd ? COMMAND_PACKAGES[cmd] : undefined;
      if (cmd && pkg) return pkg === 'core LaTeX' ? `\\${cmd} is used incorrectly here (check its arguments).` : `\\${cmd} is defined by the ${pkg} package — add \\usepackage{${pkg.split(' ')[0]}} to the preamble.`;
      return cmd ? `\\${cmd} is not defined. Check for a typo or a missing \\usepackage.` : 'A command is not defined: check for a typo or a missing \\usepackage.';
    }
    case 'undefined-environment':
      return 'This environment is not defined: check its name or load the package that provides it (e.g. amsmath for align, tikz for tikzpicture).';
    case 'missing-dollar':
      return 'Math-only syntax (^, _, \\alpha…) was used outside math mode. Wrap it in $…$ or \\(…\\).';
    case 'missing-brace':
    case 'extra-brace':
    case 'runaway-argument':
      return 'Braces are unbalanced near this line: every { needs a matching }.';
    case 'environment-mismatch':
      return 'A \\begin{…} is closed by a different \\end{…}. Check the nesting.';
    case 'missing-begin-document':
      return 'Text or commands appear before \\begin{document} (or the main file is not a full document).';
    case 'unicode-character':
      return ctx.engine === 'pdflatex'
        ? 'pdfLaTeX cannot typeset this Unicode character. Switch the engine to XeLaTeX/LuaLaTeX, or define it with \\newunicodechar.'
        : 'The current font has no glyph for this character — choose a font that covers it.';
    case 'font-not-found':
      return wasm
        ? 'This font is not part of the in-browser TeX Live. Use a TeX font (e.g. "TeX Gyre Termes", "Latin Modern Roman") or upload the font file into the project.'
        : 'The font could not be found. Install it or upload the font file into the project.';
    case 'undefined-reference':
    case 'undefined-references':
      return 'A \\ref points to a label that does not exist (or needs another compile pass).';
    case 'undefined-citation':
    case 'missing-bib-entry':
      return 'The citation key is not in your .bib file — check the key and the \\bibliography / \\addbibresource path.';
    case 'multiply-defined-label':
    case 'multiply-defined-labels':
      return 'The same \\label is used more than once.';
    case 'option-clash':
      return 'The package is loaded twice with different options (possibly by the class). Load it once, or use \\PassOptionsToPackage before \\documentclass.';
    case 'capacity-exceeded':
      return 'TeX ran out of memory — usually an infinite recursion (a macro that calls itself).';
    case 'unknown-graphics-extension':
      return ctx.engine === 'pdflatex' ? 'pdfLaTeX supports .pdf, .png and .jpg images. Convert other formats (e.g. .eps, .svg).' : 'Convert the image to .pdf, .png or .jpg.';
    case 'rerun-needed':
    case 'rerun-bibliography':
      return 'Compile again to resolve references (draft mode runs a single pass).';
    case 'overfull-hbox':
      return 'A line is too wide for the text block. Rephrase, allow hyphenation, or use \\sloppy / microtype.';
    default:
      return undefined;
  }
}

/** Prompt text for "Explain" / "Fix with AI". */
export function aiPrompt(d: Diagnostic, mode: 'fix' | 'explain'): string {
  const where = d.file ? `${d.file}${d.line ? `:${d.line}` : ''}` : 'the project';
  const excerpt = (d.raw ?? d.context ?? '').trim().slice(0, 1500);
  const intro =
    mode === 'fix'
      ? `Fix this LaTeX ${d.severity} in ${where}. Edit the source directly and keep changes minimal.`
      : `Explain this LaTeX ${d.severity} in ${where} in plain words and suggest how to fix it (don't edit files).`;
  return `${intro}\n\nMessage: ${d.message}${excerpt ? `\n\nLog excerpt:\n\`\`\`\n${excerpt}\n\`\`\`` : ''}`;
}
