/**
 * LaTeX catalog used by editor autocompletion, hover docs and the symbol
 * palette: commands, environments, math symbols and packages.
 *
 * Snippets are CodeMirror (`@codemirror/autocomplete` `snippet()`) templates:
 * placeholders are `${1:name}` / `${2}`; the runtime strings contain single
 * LaTeX backslashes (e.g. `\centering`), never a backslash directly before a
 * brace (CodeMirror reads `\{`/`\}` as escapes). Command snippets never start
 * with a backslash (the user already typed it).
 */

export type LatexCommandCategory = 'text' | 'math' | 'structure' | 'reference' | 'formatting' | 'graphics' | 'table' | 'bibliography' | 'symbol' | 'misc';

export interface LatexCommandInfo {
  /** Name without backslash, e.g. 'frac', 'mathbb', 'section'. */
  name: string;
  /** CodeMirror snippet template WITHOUT the leading backslash, e.g. 'frac{${1:num}}{${2:den}}'. */
  snippet?: string;
  /** Short description shown in the completion list / hover. */
  detail?: string;
  /** Package providing it (omitted for the LaTeX kernel / TeX primitives). */
  package?: string;
  category?: LatexCommandCategory;
  /** Unicode preview, e.g. 'α' for alpha. */
  symbol?: string;
}

export interface LatexEnvironmentInfo {
  name: string;
  /** Body template inserted between `\begin{name}` and `\end{name}`, e.g. `\centering\n${1}\n\caption{${2}}`. */
  snippet?: string;
  /** Appended right after `\begin{name}`, e.g. '{${1:cols}}' for tabular or '[${1:htbp}]' for figure. */
  args?: string;
  detail?: string;
  package?: string;
  /** True for math environments (equation, align, matrix, cases…). */
  math?: boolean;
}

export interface MathSymbolGroup {
  group: string;
  /** `cmd` includes the backslash, e.g. '\alpha' or '\mathbb{R}'. */
  symbols: { cmd: string; char: string; name?: string; package?: string }[];
}

// ═══════════════════════════════ math symbols ═══════════════════════════════

type Sym = [cmd: string, char: string, name?: string, pkg?: string];

function group(group: string, list: Sym[], pkg?: string): MathSymbolGroup {
  return {
    group,
    symbols: list.map(([name, char, label, p]) => {
      const s: MathSymbolGroup['symbols'][number] = { cmd: name.startsWith('\\') ? name : '\\' + name, char };
      if (label) s.name = label;
      const pk = p ?? pkg;
      if (pk) s.package = pk;
      return s;
    }),
  };
}

const AMS = 'amssymb';

export const mathSymbols: MathSymbolGroup[] = [
  group('Greek (lowercase)', [
    ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['epsilon', 'ϵ'], ['zeta', 'ζ'], ['eta', 'η'],
    ['theta', 'θ'], ['iota', 'ι'], ['kappa', 'κ'], ['lambda', 'λ'], ['mu', 'μ'], ['nu', 'ν'], ['xi', 'ξ'], ['pi', 'π'],
    ['rho', 'ρ'], ['sigma', 'σ'], ['tau', 'τ'], ['upsilon', 'υ'], ['phi', 'ϕ'], ['chi', 'χ'], ['psi', 'ψ'], ['omega', 'ω'],
  ]),
  group('Greek (variants)', [
    ['varepsilon', 'ε'], ['vartheta', 'ϑ'], ['varpi', 'ϖ'], ['varrho', 'ϱ'], ['varsigma', 'ς'], ['varphi', 'φ'],
    ['varkappa', 'ϰ', undefined, AMS], ['digamma', 'ϝ', undefined, AMS],
  ]),
  group('Greek (uppercase)', [
    ['Gamma', 'Γ'], ['Delta', 'Δ'], ['Theta', 'Θ'], ['Lambda', 'Λ'], ['Xi', 'Ξ'], ['Pi', 'Π'], ['Sigma', 'Σ'],
    ['Upsilon', 'Υ'], ['Phi', 'Φ'], ['Psi', 'Ψ'], ['Omega', 'Ω'],
  ]),
  group('Relations', [
    ['leq', '≤', 'less than or equal'], ['geq', '≥', 'greater than or equal'], ['le', '≤'], ['ge', '≥'], ['neq', '≠', 'not equal'],
    ['ne', '≠'], ['equiv', '≡', 'equivalent'], ['approx', '≈', 'approximately'], ['sim', '∼'], ['simeq', '≃'], ['cong', '≅', 'congruent'],
    ['propto', '∝', 'proportional to'], ['ll', '≪'], ['gg', '≫'], ['subset', '⊂'], ['supset', '⊃'], ['subseteq', '⊆'],
    ['supseteq', '⊇'], ['in', '∈', 'element of'], ['ni', '∋'], ['notin', '∉'], ['perp', '⊥'], ['parallel', '∥'], ['mid', '∣'],
    ['models', '⊧'], ['vdash', '⊢'], ['dashv', '⊣'], ['prec', '≺'], ['succ', '≻'], ['preceq', '⪯'], ['succeq', '⪰'],
    ['asymp', '≍'], ['doteq', '≐'], ['bowtie', '⋈'], ['sqsubseteq', '⊑'], ['sqsupseteq', '⊒'], ['smile', '⌣'], ['frown', '⌢'],
    ['leqslant', '⩽', undefined, AMS], ['geqslant', '⩾', undefined, AMS], ['lesssim', '≲', undefined, AMS],
    ['gtrsim', '≳', undefined, AMS], ['approxeq', '≊', undefined, AMS], ['coloneqq', '≔', 'defined as', 'mathtools'],
    ['triangleq', '≜', undefined, AMS], ['lll', '⋘', undefined, AMS], ['ggg', '⋙', undefined, AMS],
    ['subsetneq', '⊊', undefined, AMS], ['supsetneq', '⊋', undefined, AMS], ['vDash', '⊨', undefined, AMS],
    ['Vdash', '⊩', undefined, AMS], ['simeq', '≃'], ['backsim', '∽', undefined, AMS], ['eqcirc', '≖', undefined, AMS],
    ['sqsubset', '⊏', undefined, AMS], ['sqsupset', '⊐', undefined, AMS], ['Subset', '⋐', undefined, AMS], ['Supset', '⋑', undefined, AMS],
  ].filter((s, i, a) => a.findIndex((t) => t[0] === s[0]) === i) as Sym[]),
  group('Negated relations', [
    ['nleq', '≰'], ['ngeq', '≱'], ['nless', '≮'], ['ngtr', '≯'], ['nsubseteq', '⊈'], ['nsupseteq', '⊉'], ['nmid', '∤'],
    ['nparallel', '∦'], ['nsim', '≁'], ['ncong', '≇'], ['nvdash', '⊬'], ['nvDash', '⊭'], ['nprec', '⊀'], ['nsucc', '⊁'],
    ['lneq', '⪇'], ['gneq', '⪈'],
  ], AMS),
  group('Binary operators', [
    ['pm', '±', 'plus-minus'], ['mp', '∓'], ['times', '×'], ['div', '÷'], ['cdot', '⋅'], ['ast', '∗'], ['star', '⋆'],
    ['circ', '∘', 'composition'], ['bullet', '∙'], ['oplus', '⊕'], ['ominus', '⊖'], ['otimes', '⊗'], ['oslash', '⊘'],
    ['odot', '⊙'], ['cap', '∩', 'intersection'], ['cup', '∪', 'union'], ['uplus', '⊎'], ['sqcap', '⊓'], ['sqcup', '⊔'],
    ['wedge', '∧'], ['vee', '∨'], ['land', '∧'], ['lor', '∨'], ['setminus', '∖'], ['wr', '≀'], ['diamond', '⋄'],
    ['bigtriangleup', '△'], ['bigtriangledown', '▽'], ['triangleleft', '◁'], ['triangleright', '▷'], ['dagger', '†'],
    ['ddagger', '‡'], ['amalg', '⨿'], ['ltimes', '⋉', undefined, AMS], ['rtimes', '⋊', undefined, AMS],
    ['boxplus', '⊞', undefined, AMS], ['boxtimes', '⊠', undefined, AMS], ['boxminus', '⊟', undefined, AMS],
    ['boxdot', '⊡', undefined, AMS], ['dotplus', '∔', undefined, AMS], ['intercal', '⊺', undefined, AMS],
    ['veebar', '⊻', undefined, AMS], ['barwedge', '⌅', undefined, AMS], ['curlywedge', '⋏', undefined, AMS],
    ['curlyvee', '⋎', undefined, AMS],
  ]),
  group('Arrows', [
    ['leftarrow', '←'], ['rightarrow', '→'], ['uparrow', '↑'], ['downarrow', '↓'], ['leftrightarrow', '↔'],
    ['updownarrow', '↕'], ['Leftarrow', '⇐'], ['Rightarrow', '⇒'], ['Uparrow', '⇑'], ['Downarrow', '⇓'],
    ['Leftrightarrow', '⇔'], ['Updownarrow', '⇕'], ['longleftarrow', '⟵'], ['longrightarrow', '⟶'],
    ['longleftrightarrow', '⟷'], ['Longleftarrow', '⟸'], ['Longrightarrow', '⟹'], ['Longleftrightarrow', '⟺'],
    ['mapsto', '↦'], ['longmapsto', '⟼'], ['hookleftarrow', '↩'], ['hookrightarrow', '↪'], ['leftharpoonup', '↼'],
    ['leftharpoondown', '↽'], ['rightharpoonup', '⇀'], ['rightharpoondown', '⇁'], ['rightleftharpoons', '⇌'],
    ['leftrightharpoons', '⇋', undefined, AMS], ['nearrow', '↗'], ['searrow', '↘'], ['swarrow', '↙'], ['nwarrow', '↖'],
    ['to', '→'], ['gets', '←'], ['implies', '⟹', undefined, 'amsmath'], ['impliedby', '⟸', undefined, 'amsmath'],
    ['iff', '⟺'], ['twoheadrightarrow', '↠', undefined, AMS], ['twoheadleftarrow', '↞', undefined, AMS],
    ['rightsquigarrow', '⇝', undefined, AMS], ['circlearrowleft', '↺', undefined, AMS], ['circlearrowright', '↻', undefined, AMS],
    ['curvearrowleft', '↶', undefined, AMS], ['curvearrowright', '↷', undefined, AMS], ['upuparrows', '⇈', undefined, AMS],
    ['downdownarrows', '⇊', undefined, AMS], ['leftleftarrows', '⇇', undefined, AMS], ['rightrightarrows', '⇉', undefined, AMS],
    ['leftrightarrows', '⇆', undefined, AMS], ['rightleftarrows', '⇄', undefined, AMS], ['Lsh', '↰', undefined, AMS],
    ['Rsh', '↱', undefined, AMS], ['nrightarrow', '↛', undefined, AMS], ['nleftarrow', '↚', undefined, AMS],
    ['nRightarrow', '⇏', undefined, AMS], ['nLeftarrow', '⇍', undefined, AMS], ['nleftrightarrow', '↮', undefined, AMS],
    ['nLeftrightarrow', '⇎', undefined, AMS], ['rightarrowtail', '↣', undefined, AMS], ['leftarrowtail', '↢', undefined, AMS],
  ]),
  group('Big operators', [
    ['sum', '∑', 'sum'], ['prod', '∏', 'product'], ['coprod', '∐'], ['int', '∫', 'integral'], ['iint', '∬', undefined, 'amsmath'],
    ['iiint', '∭', undefined, 'amsmath'], ['oint', '∮'], ['oiint', '∯', undefined, 'esint'], ['bigcup', '⋃'], ['bigcap', '⋂'],
    ['bigoplus', '⨁'], ['bigotimes', '⨂'], ['bigodot', '⨀'], ['biguplus', '⨄'], ['bigsqcup', '⨆'], ['bigvee', '⋁'],
    ['bigwedge', '⋀'],
  ]),
  group('Delimiters', [
    ['langle', '⟨'], ['rangle', '⟩'], ['lfloor', '⌊'], ['rfloor', '⌋'], ['lceil', '⌈'], ['rceil', '⌉'], ['lbrace', '{'],
    ['rbrace', '}'], ['vert', '|'], ['Vert', '‖'], ['lvert', '|', undefined, 'amsmath'], ['rvert', '|', undefined, 'amsmath'],
    ['lVert', '‖', undefined, 'amsmath'], ['rVert', '‖', undefined, 'amsmath'], ['backslash', '\\'], ['lbrack', '['],
    ['rbrack', ']'], ['lgroup', '⟮'], ['rgroup', '⟯'], ['ulcorner', '⌜', undefined, AMS], ['urcorner', '⌝', undefined, AMS],
    ['llcorner', '⌞', undefined, AMS], ['lrcorner', '⌟', undefined, AMS],
  ]),
  group('Accents', [
    ['\\hat{a}', 'â', 'hat'], ['\\check{a}', 'ǎ', 'check'], ['\\breve{a}', 'ă', 'breve'], ['\\acute{a}', 'á', 'acute'],
    ['\\grave{a}', 'à', 'grave'], ['\\tilde{a}', 'ã', 'tilde'], ['\\bar{a}', 'ā', 'bar'], ['\\vec{a}', 'a\u20D7', 'vector'],
    ['\\dot{a}', 'ȧ', 'dot'], ['\\ddot{a}', 'ä', 'double dot'], ['\\dddot{a}', 'a\u20DB', 'triple dot', 'amsmath'],
    ['\\mathring{a}', 'å', 'ring'], ['\\widehat{AB}', 'A\u0302B', 'wide hat'], ['\\widetilde{AB}', 'A\u0303B', 'wide tilde'],
    ['\\overline{AB}', 'A\u0305B\u0305', 'overline'], ['\\underline{AB}', 'A\u0332B\u0332', 'underline'],
    ['\\overrightarrow{AB}', 'AB\u20D7', 'vector arrow'], ['\\overleftarrow{AB}', 'AB\u20D6', 'left arrow over'],
  ]),
  group('Sets & logic', [
    ['emptyset', '∅', 'empty set'], ['varnothing', '⌀', 'empty set', AMS], ['forall', '∀', 'for all'],
    ['exists', '∃', 'exists'], ['nexists', '∄', undefined, AMS], ['neg', '¬', 'not'], ['lnot', '¬'], ['top', '⊤'],
    ['bot', '⊥'], ['therefore', '∴', undefined, AMS], ['because', '∵', undefined, AMS], ['infty', '∞', 'infinity'],
    ['complement', '∁', undefined, AMS],
  ]),
  group('Dots', [
    ['ldots', '…'], ['cdots', '⋯'], ['vdots', '⋮'], ['ddots', '⋱'], ['dots', '…', undefined, 'amsmath'],
    ['iddots', '⋰', undefined, 'mathdots'],
  ]),
  group('Misc symbols', [
    ['partial', '∂', 'partial derivative'], ['nabla', '∇', 'nabla'], ['hbar', 'ℏ', 'reduced Planck constant'],
    ['hslash', 'ℏ', undefined, AMS], ['ell', 'ℓ'], ['wp', '℘'], ['Re', 'ℜ'], ['Im', 'ℑ'], ['aleph', 'ℵ'],
    ['beth', 'ℶ', undefined, AMS], ['gimel', 'ℷ', undefined, AMS], ['daleth', 'ℸ', undefined, AMS], ['angle', '∠'],
    ['measuredangle', '∡', undefined, AMS], ['sphericalangle', '∢', undefined, AMS], ['prime', '′'],
    ['backprime', '‵', undefined, AMS], ['surd', '√'], ['triangle', '△'], ['square', '□', undefined, AMS],
    ['blacksquare', '■', undefined, AMS], ['lozenge', '◊', undefined, AMS], ['blacklozenge', '⧫', undefined, AMS],
    ['bigstar', '★', undefined, AMS], ['clubsuit', '♣'], ['diamondsuit', '♢'], ['heartsuit', '♡'], ['spadesuit', '♠'],
    ['flat', '♭'], ['natural', '♮'], ['sharp', '♯'], ['checkmark', '✓', undefined, AMS], ['maltese', '✠', undefined, AMS],
    ['imath', 'ı'], ['jmath', 'ȷ'], ['eth', 'ð', undefined, AMS], ['mho', '℧', undefined, AMS], ['Finv', 'Ⅎ', undefined, AMS],
    ['Game', '⅁', undefined, AMS], ['diagup', '╱', undefined, AMS], ['diagdown', '╲', undefined, AMS],
    ['circledS', 'Ⓢ', undefined, AMS], ['degree', '°', 'degree', 'gensymb'], ['mathsection', '§'], ['mathparagraph', '¶'],
  ]),
  group('Blackboard bold', [
    ['\\mathbb{N}', 'ℕ', 'natural numbers'], ['\\mathbb{Z}', 'ℤ', 'integers'], ['\\mathbb{Q}', 'ℚ', 'rationals'],
    ['\\mathbb{R}', 'ℝ', 'reals'], ['\\mathbb{C}', 'ℂ', 'complex numbers'], ['\\mathbb{P}', 'ℙ'], ['\\mathbb{H}', 'ℍ'],
    ['\\mathbb{F}', '\u{1D53D}'], ['\\mathbb{K}', '\u{1D542}'], ['\\mathbb{E}', '\u{1D53C}', 'expectation'],
  ], AMS),
  group('Calligraphic', [
    ['\\mathcal{A}', '\u{1D49C}'], ['\\mathcal{B}', 'ℬ'], ['\\mathcal{C}', '\u{1D49E}'], ['\\mathcal{D}', '\u{1D49F}'],
    ['\\mathcal{E}', 'ℰ'], ['\\mathcal{F}', 'ℱ'], ['\\mathcal{G}', '\u{1D4A2}'], ['\\mathcal{H}', 'ℋ'], ['\\mathcal{L}', 'ℒ'],
    ['\\mathcal{M}', 'ℳ'], ['\\mathcal{N}', '\u{1D4A9}'], ['\\mathcal{O}', '\u{1D4AA}'], ['\\mathcal{P}', '\u{1D4AB}'],
    ['\\mathcal{S}', '\u{1D4AE}'], ['\\mathcal{T}', '\u{1D4AF}'], ['\\mathcal{X}', '\u{1D4B3}'],
  ]),
  group('Fraktur', [
    ['\\mathfrak{A}', '\u{1D504}'], ['\\mathfrak{S}', '\u{1D516}'], ['\\mathfrak{a}', '\u{1D51E}'], ['\\mathfrak{g}', '\u{1D524}'],
    ['\\mathfrak{h}', '\u{1D525}'], ['\\mathfrak{m}', '\u{1D52A}'], ['\\mathfrak{p}', '\u{1D52D}'],
    ['\\mathfrak{sl}', '\u{1D530}\u{1D529}', 'special linear Lie algebra'],
  ], AMS),
];

// ═══════════════════════════════ commands ═══════════════════════════════

/** [name, snippet ('' = none), detail] */
type C = [name: string, snippet: string, detail: string];

const commandsOut: LatexCommandInfo[] = [];
function cmds(category: LatexCommandCategory, pkg: string | undefined, list: C[]): void {
  for (const [name, snippet, detail] of list) {
    const c: LatexCommandInfo = { name, category };
    if (snippet) c.snippet = snippet;
    if (detail) c.detail = detail;
    if (pkg) c.package = pkg;
    commandsOut.push(c);
  }
}

const sec = (n: string, d: string): C => [n, `${n}{\${1:title}}`, d];

cmds('structure', undefined, [
  sec('part', 'Part heading'), sec('chapter', 'Chapter heading (book, report)'), sec('section', 'Section heading'),
  sec('subsection', 'Subsection heading'), sec('subsubsection', 'Sub-subsection heading'), sec('paragraph', 'Run-in paragraph heading'),
  sec('subparagraph', 'Run-in subparagraph heading'),
  ['documentclass', 'documentclass[${1:11pt}]{${2:article}}', 'Choose the document class'],
  ['usepackage', 'usepackage{${1:package}}', 'Load a package'],
  ['RequirePackage', 'RequirePackage{${1:package}}', 'Load a package (in .sty/.cls files)'],
  ['title', 'title{${1:Title}}', 'Document title'], ['author', 'author{${1:Name}}', 'Document author(s)'],
  ['date', 'date{${1:\\today}}', 'Document date'], ['thanks', 'thanks{${1:note}}', 'Footnote in title/author'],
  ['and', '', 'Separate authors'], ['maketitle', '', 'Typeset the title block'],
  ['tableofcontents', '', 'Table of contents'], ['listoffigures', '', 'List of figures'], ['listoftables', '', 'List of tables'],
  ['appendix', '', 'Start the appendices'], ['frontmatter', '', 'Front matter (book)'], ['mainmatter', '', 'Main matter (book)'],
  ['backmatter', '', 'Back matter (book)'], ['input', 'input{${1:file}}', 'Insert a file'],
  ['include', 'include{${1:file}}', 'Include a file on a new page (\\includeonly aware)'],
  ['includeonly', 'includeonly{${1:files}}', 'Restrict \\include to these files'],
  ['begin', 'begin{${1:environment}}', 'Begin an environment'], ['end', 'end{${1:environment}}', 'End an environment'],
  ['item', 'item ', 'List item'], ['abstractname', '', 'Name of the abstract heading'],
  ['addcontentsline', 'addcontentsline{${1:toc}}{${2:section}}{${3:text}}', 'Add a line to the TOC/LOF/LOT'],
  ['addtocontents', 'addtocontents{${1:toc}}{${2:text}}', 'Write to the TOC file'],
  ['newpage', '', 'Start a new page'], ['clearpage', '', 'Flush floats and start a new page'],
  ['cleardoublepage', '', 'Start a new right-hand page'], ['pagebreak', '', 'Encourage a page break'],
  ['nopagebreak', '', 'Discourage a page break'], ['enlargethispage', 'enlargethispage{${1:\\baselineskip}}', 'Make this page taller'],
  ['pagestyle', 'pagestyle{${1:plain}}', 'Page style (plain, empty, headings, fancy…)'],
  ['thispagestyle', 'thispagestyle{${1:empty}}', 'Page style for the current page'],
  ['pagenumbering', 'pagenumbering{${1:arabic}}', 'Page number style'],
  ['twocolumn', '', 'Switch to two columns'], ['onecolumn', '', 'Switch to one column'],
]);

cmds('reference', undefined, [
  ['label', 'label{${1:key}}', 'Define a cross-reference label'], ['ref', 'ref{${1:key}}', 'Reference a label (number)'],
  ['pageref', 'pageref{${1:key}}', 'Page of a label'], ['footnote', 'footnote{${1:text}}', 'Footnote'],
  ['footnotemark', '', 'Footnote mark only'], ['footnotetext', 'footnotetext{${1:text}}', 'Footnote text only'],
  ['caption', 'caption{${1:text}}', 'Caption of a float'], ['marginpar', 'marginpar{${1:note}}', 'Margin note'],
  ['index', 'index{${1:entry}}', 'Index entry'], ['printindex', '', 'Print the index'], ['makeindex', '', 'Enable index generation'],
  ['eqref', 'eqref{${1:key}}', 'Reference an equation, with parentheses'],
  ['tag', 'tag{${1:label}}', 'Custom equation tag'], ['notag', '', 'Suppress the equation number'],
  ['nonumber', '', 'Suppress the equation number'],
]);

cmds('formatting', undefined, [
  ['textbf', 'textbf{${1:text}}', 'Bold'], ['textit', 'textit{${1:text}}', 'Italic'], ['emph', 'emph{${1:text}}', 'Emphasis'],
  ['texttt', 'texttt{${1:text}}', 'Monospace'], ['textsc', 'textsc{${1:text}}', 'Small caps'], ['textsf', 'textsf{${1:text}}', 'Sans serif'],
  ['textrm', 'textrm{${1:text}}', 'Roman (serif)'], ['textup', 'textup{${1:text}}', 'Upright'], ['textsl', 'textsl{${1:text}}', 'Slanted'],
  ['textmd', 'textmd{${1:text}}', 'Medium weight'], ['textnormal', 'textnormal{${1:text}}', 'Document default font'],
  ['underline', 'underline{${1:text}}', 'Underline'], ['textsuperscript', 'textsuperscript{${1:text}}', 'Superscript text'],
  ['textsubscript', 'textsubscript{${1:text}}', 'Subscript text'],
  ['bfseries', '', 'Bold (declaration)'], ['itshape', '', 'Italic (declaration)'], ['ttfamily', '', 'Monospace (declaration)'],
  ['scshape', '', 'Small caps (declaration)'], ['sffamily', '', 'Sans serif (declaration)'], ['rmfamily', '', 'Roman (declaration)'],
  ['mdseries', '', 'Medium weight (declaration)'], ['upshape', '', 'Upright (declaration)'], ['slshape', '', 'Slanted (declaration)'],
  ['normalfont', '', 'Reset to the default font'], ['tiny', '', 'Font size: tiny'], ['scriptsize', '', 'Font size: script'],
  ['footnotesize', '', 'Font size: footnote'], ['small', '', 'Font size: small'], ['normalsize', '', 'Font size: normal'],
  ['large', '', 'Font size: large'], ['Large', '', 'Font size: Large'], ['LARGE', '', 'Font size: LARGE'],
  ['huge', '', 'Font size: huge'], ['Huge', '', 'Font size: Huge'],
  ['fontsize', 'fontsize{${1:12pt}}{${2:14pt}}\\selectfont', 'Font size and baseline skip'], ['selectfont', '', 'Apply font changes'],
  ['centering', '', 'Center (declaration)'], ['raggedright', '', 'Left-align (declaration)'], ['raggedleft', '', 'Right-align (declaration)'],
  ['noindent', '', 'No paragraph indent'], ['indent', '', 'Paragraph indent'], ['par', '', 'End paragraph'],
  ['newline', '', 'Line break'], ['linebreak', '', 'Encourage a line break'], ['nolinebreak', '', 'Discourage a line break'],
  ['hfill', '', 'Horizontal fill'], ['vfill', '', 'Vertical fill'], ['hrulefill', '', 'Fill with a rule'], ['dotfill', '', 'Fill with dots'],
  ['hspace', 'hspace{${1:1em}}', 'Horizontal space'], ['vspace', 'vspace{${1:1em}}', 'Vertical space'],
  ['smallskip', '', 'Small vertical space'], ['medskip', '', 'Medium vertical space'], ['bigskip', '', 'Big vertical space'],
  ['quad', '', 'Space of 1em'], ['qquad', '', 'Space of 2em'], ['enspace', '', 'Space of 0.5em'], ['thinspace', '', 'Thin space'],
  ['mbox', 'mbox{${1:text}}', 'Unbreakable box'], ['fbox', 'fbox{${1:text}}', 'Framed box'],
  ['makebox', 'makebox[${1:width}][${2:c}]{${3:text}}', 'Box with given width'],
  ['framebox', 'framebox[${1:width}][${2:c}]{${3:text}}', 'Framed box with given width'],
  ['parbox', 'parbox{${1:width}}{${2:text}}', 'Paragraph box'], ['raisebox', 'raisebox{${1:1ex}}{${2:text}}', 'Raise a box'],
  ['rule', 'rule{${1:width}}{${2:height}}', 'Solid rule'], ['strut', '', 'Invisible strut'],
  ['setlength', 'setlength{${1:\\parindent}}{${2:0pt}}', 'Set a length'], ['addtolength', 'addtolength{${1:\\textwidth}}{${2:1cm}}', 'Add to a length'],
  ['newlength', 'newlength{${1:\\mylength}}', 'Declare a length'], ['settowidth', 'settowidth{${1:\\len}}{${2:text}}', 'Set a length to text width'],
  ['linewidth', '', 'Current line width'], ['textwidth', '', 'Text block width'], ['textheight', '', 'Text block height'],
  ['columnwidth', '', 'Column width'], ['paperwidth', '', 'Paper width'], ['paperheight', '', 'Paper height'],
  ['baselineskip', '', 'Distance between baselines'], ['parindent', '', 'Paragraph indent length'], ['parskip', '', 'Space between paragraphs'],
  ['linespread', 'linespread{${1:1.3}}', 'Line spacing factor'],
]);

cmds('text', undefined, [
  ['LaTeX', '', 'The LaTeX logo'], ['TeX', '', 'The TeX logo'], ['LaTeXe', '', 'The LaTeX2ε logo'], ['today', '', "Today's date"],
  ['ldots', '', 'Ellipsis …'], ['textbackslash', '', 'Backslash \\'], ['textasciitilde', '', 'Tilde ~'], ['textasciicircum', '', 'Circumflex ^'],
  ['textbar', '', 'Vertical bar |'], ['textbullet', '', 'Bullet •'], ['textdegree', '', 'Degree sign °'], ['textcopyright', '', 'Copyright ©'],
  ['textregistered', '', 'Registered ®'], ['texttrademark', '', 'Trademark ™'], ['textendash', '', 'En dash –'], ['textemdash', '', 'Em dash —'],
  ['S', '', 'Section sign §'], ['P', '', 'Pilcrow ¶'], ['dag', '', 'Dagger †'], ['ddag', '', 'Double dagger ‡'],
  ['verb', 'verb|${1:code}|', 'Inline verbatim'], ['protect', '', 'Protect a fragile command'],
  ['newcommand', 'newcommand{\\${1:name}}[${2:0}]{${3:definition}}', 'Define a new command'],
  ['renewcommand', 'renewcommand{\\${1:name}}{${2:definition}}', 'Redefine a command'],
  ['providecommand', 'providecommand{\\${1:name}}{${2:definition}}', 'Define a command if undefined'],
  ['newenvironment', 'newenvironment{${1:name}}{${2:begin}}{${3:end}}', 'Define a new environment'],
  ['renewenvironment', 'renewenvironment{${1:name}}{${2:begin}}{${3:end}}', 'Redefine an environment'],
  ['newcounter', 'newcounter{${1:name}}', 'Declare a counter'], ['setcounter', 'setcounter{${1:counter}}{${2:0}}', 'Set a counter'],
  ['addtocounter', 'addtocounter{${1:counter}}{${2:1}}', 'Add to a counter'], ['stepcounter', 'stepcounter{${1:counter}}', 'Increment a counter'],
  ['refstepcounter', 'refstepcounter{${1:counter}}', 'Increment a counter (referenceable)'], ['value', 'value{${1:counter}}', 'Counter value'],
  ['arabic', 'arabic{${1:counter}}', 'Counter as 1, 2, 3'], ['roman', 'roman{${1:counter}}', 'Counter as i, ii, iii'],
  ['Roman', 'Roman{${1:counter}}', 'Counter as I, II, III'], ['alph', 'alph{${1:counter}}', 'Counter as a, b, c'],
  ['Alph', 'Alph{${1:counter}}', 'Counter as A, B, C'], ['fnsymbol', 'fnsymbol{${1:counter}}', 'Counter as footnote symbols'],
  ['ensuremath', 'ensuremath{${1:math}}', 'Math mode in any mode'], ['AtBeginDocument', 'AtBeginDocument{${1:code}}', 'Run code at \\begin{document}'],
  ['AtEndDocument', 'AtEndDocument{${1:code}}', 'Run code at \\end{document}'], ['makeatletter', '', 'Treat @ as a letter'],
  ['makeatother', '', 'Treat @ as other'], ['hyphenation', 'hyphenation{${1:hy-phen-ation}}', 'Hyphenation exceptions'],
  ['IfFileExists', 'IfFileExists{${1:file}}{${2:true}}{${3:false}}', 'Test for a file'],
  ['newtheorem', 'newtheorem{${1:theorem}}{${2:Theorem}}', 'Declare a theorem-like environment'],
  ['theoremstyle', 'theoremstyle{${1:definition}}', 'Theorem style (plain, definition, remark)', ],
  ['qed', '', 'End-of-proof symbol'], ['qedhere', '', 'Place the QED symbol here'],
  ['bibliography', 'bibliography{${1:references}}', 'BibTeX database(s)'],
  ['bibliographystyle', 'bibliographystyle{${1:plain}}', 'BibTeX style'], ['bibitem', 'bibitem{${1:key}}', 'Bibliography entry'],
  ['cite', 'cite{${1:key}}', 'Citation'], ['nocite', 'nocite{${1:key}}', 'Add to bibliography without citing'],
  ['numberwithin', 'numberwithin{${1:equation}}{${2:section}}', 'Reset a counter within another'],
]);
// Fix categories of the kernel bibliography commands.
for (const c of commandsOut) if (['bibliography', 'bibliographystyle', 'bibitem', 'cite', 'nocite'].includes(c.name)) c.category = 'bibliography';
for (const c of commandsOut) if (c.name === 'theoremstyle') c.package = 'amsthm';
for (const c of commandsOut) if (c.name === 'qed' || c.name === 'qedhere') c.package = 'amsthm';
for (const c of commandsOut) if (c.name === 'numberwithin' || c.name === 'eqref' || c.name === 'tag' || c.name === 'notag') c.package = 'amsmath';

cmds('math', undefined, [
  ['frac', 'frac{${1:num}}{${2:den}}', 'Fraction'], ['sqrt', 'sqrt{${1:x}}', 'Square root ([n] for nth root)'],
  ['left', 'left( ${1} \\right)', 'Auto-sized left delimiter'], ['right', 'right', 'Auto-sized right delimiter'],
  ['big', '', 'Bigger delimiter'], ['Big', '', 'Bigger delimiter'], ['bigg', '', 'Bigger delimiter'], ['Bigg', '', 'Biggest delimiter'],
  ['bigl', '', 'Big left delimiter'], ['bigr', '', 'Big right delimiter'], ['Bigl', '', 'Big left delimiter'], ['Bigr', '', 'Big right delimiter'],
  ['biggl', '', 'Bigger left delimiter'], ['biggr', '', 'Bigger right delimiter'], ['Biggl', '', 'Biggest left delimiter'],
  ['Biggr', '', 'Biggest right delimiter'],
  ['lim', 'lim_{${1:n \\to \\infty}}', 'Limit'], ['limsup', 'limsup_{${1:n \\to \\infty}}', 'Limit superior'],
  ['liminf', 'liminf_{${1:n \\to \\infty}}', 'Limit inferior'],
  ['sin', '', 'Sine'], ['cos', '', 'Cosine'], ['tan', '', 'Tangent'], ['cot', '', 'Cotangent'], ['sec', '', 'Secant'], ['csc', '', 'Cosecant'],
  ['arcsin', '', 'Arc sine'], ['arccos', '', 'Arc cosine'], ['arctan', '', 'Arc tangent'], ['sinh', '', 'Hyperbolic sine'],
  ['cosh', '', 'Hyperbolic cosine'], ['tanh', '', 'Hyperbolic tangent'], ['log', '', 'Logarithm'], ['ln', '', 'Natural logarithm'],
  ['lg', '', 'Binary logarithm'], ['exp', '', 'Exponential'], ['max', 'max_{${1}}', 'Maximum'], ['min', 'min_{${1}}', 'Minimum'],
  ['sup', 'sup_{${1}}', 'Supremum'], ['inf', 'inf_{${1}}', 'Infimum'], ['det', '', 'Determinant'], ['gcd', '', 'Greatest common divisor'],
  ['deg', '', 'Degree'], ['dim', '', 'Dimension'], ['ker', '', 'Kernel'], ['arg', '', 'Argument'], ['Pr', '', 'Probability'], ['hom', '', 'Hom'],
  ['bmod', '', 'Binary mod'], ['pmod', 'pmod{${1:n}}', 'Parenthesised mod'],
  ['hat', 'hat{${1:x}}', 'Hat accent'], ['check', 'check{${1:x}}', 'Check accent'], ['breve', 'breve{${1:x}}', 'Breve accent'],
  ['acute', 'acute{${1:x}}', 'Acute accent'], ['grave', 'grave{${1:x}}', 'Grave accent'], ['tilde', 'tilde{${1:x}}', 'Tilde accent'],
  ['bar', 'bar{${1:x}}', 'Bar accent'], ['vec', 'vec{${1:x}}', 'Vector arrow'], ['dot', 'dot{${1:x}}', 'Dot accent'],
  ['ddot', 'ddot{${1:x}}', 'Double dot accent'], ['mathring', 'mathring{${1:x}}', 'Ring accent'],
  ['overline', 'overline{${1:x}}', 'Overline'], ['widehat', 'widehat{${1:xy}}', 'Wide hat'], ['widetilde', 'widetilde{${1:xy}}', 'Wide tilde'],
  ['overrightarrow', 'overrightarrow{${1:AB}}', 'Arrow over'], ['overleftarrow', 'overleftarrow{${1:AB}}', 'Left arrow over'],
  ['overbrace', 'overbrace{${1:expr}}^{${2:label}}', 'Brace over'], ['underbrace', 'underbrace{${1:expr}}_{${2:label}}', 'Brace under'],
  ['stackrel', 'stackrel{${1:above}}{${2:rel}}', 'Stack over a relation'],
  ['mathrm', 'mathrm{${1:text}}', 'Roman math'], ['mathbf', 'mathbf{${1:x}}', 'Bold math'], ['mathit', 'mathit{${1:x}}', 'Italic math'],
  ['mathsf', 'mathsf{${1:x}}', 'Sans-serif math'], ['mathtt', 'mathtt{${1:x}}', 'Monospace math'], ['mathnormal', 'mathnormal{${1:x}}', 'Normal math italic'],
  ['mathcal', 'mathcal{${1:A}}', 'Calligraphic'], ['displaystyle', '', 'Display-size math'], ['textstyle', '', 'Text-size math'],
  ['scriptstyle', '', 'Script-size math'], ['phantom', 'phantom{${1:x}}', 'Invisible box with content size'],
  ['hphantom', 'hphantom{${1:x}}', 'Invisible box (width only)'], ['vphantom', 'vphantom{${1:x}}', 'Invisible box (height only)'],
  ['smash', 'smash{${1:x}}', 'Zero height/depth'], ['limits', '', 'Limits above/below'], ['nolimits', '', 'Limits beside'],
  ['cdotp', '', 'Centered dot punctuation'], ['colon', '', 'Colon punctuation'], ['not', '', 'Negate the following relation'],
]);

cmds('math', 'amsmath', [
  ['dfrac', 'dfrac{${1:num}}{${2:den}}', 'Display-style fraction'], ['tfrac', 'tfrac{${1:num}}{${2:den}}', 'Text-style fraction'],
  ['cfrac', 'cfrac{${1:num}}{${2:den}}', 'Continued fraction'], ['binom', 'binom{${1:n}}{${2:k}}', 'Binomial coefficient'],
  ['dbinom', 'dbinom{${1:n}}{${2:k}}', 'Display binomial'], ['tbinom', 'tbinom{${1:n}}{${2:k}}', 'Text binomial'],
  ['text', 'text{${1:text}}', 'Text inside math'], ['operatorname', 'operatorname{${1:op}}', 'Upright operator name'],
  ['DeclareMathOperator', 'DeclareMathOperator{\\${1:name}}{${2:text}}', 'Define a math operator'],
  ['boldsymbol', 'boldsymbol{${1:x}}', 'Bold math symbol'], ['overset', 'overset{${1:above}}{${2:x}}', 'Place above'],
  ['underset', 'underset{${1:below}}{${2:x}}', 'Place below'], ['xrightarrow', 'xrightarrow{${1:text}}', 'Extensible right arrow'],
  ['xleftarrow', 'xleftarrow{${1:text}}', 'Extensible left arrow'], ['substack', 'substack{${1:a} \\\\ ${2:b}}', 'Multi-line subscript'],
  ['intertext', 'intertext{${1:text}}', 'Text between aligned lines'], ['dddot', 'dddot{${1:x}}', 'Triple dot accent'],
  ['boxed', 'boxed{${1:formula}}', 'Framed formula'], ['sideset', 'sideset{${1}}{${2}}', 'Side sub/superscripts on big operators'],
  ['genfrac', 'genfrac{${1:(}}{${2:)}}{${3:0pt}}{${4:0}}{${5:a}}{${6:b}}', 'Generalised fraction'],
  ['allowdisplaybreaks', '', 'Allow page breaks in displays'],
]);

cmds('math', 'mathtools', [
  ['mathclap', 'mathclap{${1:x}}', 'Zero-width centered'], ['mathllap', 'mathllap{${1:x}}', 'Zero-width left overlap'],
  ['mathrlap', 'mathrlap{${1:x}}', 'Zero-width right overlap'], ['shortintertext', 'shortintertext{${1:text}}', 'Compact intertext'],
  ['DeclarePairedDelimiter', 'DeclarePairedDelimiter{\\${1:abs}}{${2:\\lvert}}{${3:\\rvert}}', 'Define a paired delimiter command'],
  ['prescript', 'prescript{${1:sup}}{${2:sub}}{${3:x}}', 'Pre-sub/superscripts'],
]);
cmds('math', AMS, [['mathbb', 'mathbb{${1:R}}', 'Blackboard bold'], ['mathfrak', 'mathfrak{${1:g}}', 'Fraktur']]);
cmds('math', 'mathrsfs', [['mathscr', 'mathscr{${1:L}}', 'Script letters']]);
cmds('math', 'bm', [['bm', 'bm{${1:x}}', 'Bold math (better than \\boldsymbol)']]);
cmds('math', 'cancel', [['cancel', 'cancel{${1:x}}', 'Strike out (diagonal)'], ['cancelto', 'cancelto{${1:0}}{${2:x}}', 'Strike out with arrow to value']]);
cmds('math', 'physics', [
  ['dv', 'dv{${1:f}}{${2:x}}', 'Derivative'], ['pdv', 'pdv{${1:f}}{${2:x}}', 'Partial derivative'],
  ['bra', 'bra{${1:\\psi}}', 'Bra ⟨ψ|'], ['ket', 'ket{${1:\\psi}}', 'Ket |ψ⟩'], ['braket', 'braket{${1:\\phi}}{${2:\\psi}}', 'Braket ⟨φ|ψ⟩'],
]);

cmds('graphics', 'graphicx', [
  ['includegraphics', 'includegraphics[width=${1:\\linewidth}]{${2:file}}', 'Insert an image'],
  ['graphicspath', 'graphicspath{{${1:figures/}}}', 'Folders searched for images'],
  ['rotatebox', 'rotatebox{${1:90}}{${2:content}}', 'Rotate content'], ['scalebox', 'scalebox{${1:0.8}}{${2:content}}', 'Scale content'],
  ['resizebox', 'resizebox{${1:\\linewidth}}{!}{${2:content}}', 'Resize content'], ['reflectbox', 'reflectbox{${1:content}}', 'Mirror content'],
  ['DeclareGraphicsExtensions', 'DeclareGraphicsExtensions{${1:.pdf,.png,.jpg}}', 'Image extensions to try'],
]);
cmds('graphics', 'xcolor', [
  ['color', 'color{${1:red}}', 'Switch text colour'], ['textcolor', 'textcolor{${1:red}}{${2:text}}', 'Coloured text'],
  ['colorbox', 'colorbox{${1:yellow}}{${2:text}}', 'Coloured background box'],
  ['fcolorbox', 'fcolorbox{${1:black}}{${2:yellow}}{${3:text}}', 'Framed coloured box'],
  ['definecolor', 'definecolor{${1:name}}{${2:HTML}}{${3:1E88E5}}', 'Define a colour'], ['colorlet', 'colorlet{${1:name}}{${2:blue!50}}', 'Define a colour from an expression'],
  ['pagecolor', 'pagecolor{${1:white}}', 'Page background colour'],
]);
cmds('graphics', 'tikz', [
  ['tikz', 'tikz ${1:\\draw (0,0) -- (1,1);}', 'Inline TikZ picture'], ['draw', 'draw ${1:(0,0) -- (1,1)};', 'Draw a path'],
  ['node', 'node[${1}] (${2:name}) at (${3:0,0}) {${4:text}};', 'Place a node'], ['fill', 'fill[${1:gray}] ${2:(0,0) rectangle (1,1)};', 'Fill a path'],
  ['filldraw', 'filldraw[${1:fill=gray}] ${2:(0,0) circle (1)};', 'Fill and draw a path'], ['path', 'path ${1};', 'Path without drawing'],
  ['coordinate', 'coordinate (${1:name}) at (${2:0,0});', 'Named coordinate'], ['usetikzlibrary', 'usetikzlibrary{${1:arrows.meta,positioning}}', 'Load TikZ libraries'],
  ['tikzset', 'tikzset{${1:mystyle}/.style={${2:draw}}}', 'Define TikZ styles'], ['foreach', 'foreach \\${1:x} in {${2:1,...,5}} {${3}}', 'Loop'],
  ['shade', 'shade ${1};', 'Shade a path'], ['clip', 'clip ${1};', 'Clip to a path'], ['pgfmathsetmacro', 'pgfmathsetmacro{\\${1:x}}{${2:1+1}}', 'Compute a value'],
]);
cmds('graphics', 'pgfplots', [
  ['addplot', 'addplot[${1}] coordinates {${2:(0,0) (1,1)}};', 'Add a plot'], ['addlegendentry', 'addlegendentry{${1:label}}', 'Legend entry'],
  ['pgfplotsset', 'pgfplotsset{${1:compat=1.18}}', 'pgfplots options'],
]);

cmds('reference', 'hyperref', [
  ['href', 'href{${1:url}}{${2:text}}', 'Hyperlink'], ['url', 'url{${1:url}}', 'Typeset a URL'], ['nolinkurl', 'nolinkurl{${1:url}}', 'URL without link'],
  ['hyperref', 'hyperref[${1:label}]{${2:text}}', 'Link to a label'], ['autoref', 'autoref{${1:key}}', 'Reference with automatic name'],
  ['nameref', 'nameref{${1:key}}', 'Reference by title'], ['hypersetup', 'hypersetup{${1:colorlinks=true}}', 'hyperref options'],
  ['phantomsection', '', 'Anchor for links'], ['hyperlink', 'hyperlink{${1:target}}{${2:text}}', 'Link to a target'],
  ['hypertarget', 'hypertarget{${1:name}}{${2:text}}', 'Link target'], ['texorpdfstring', 'texorpdfstring{${1:tex}}{${2:pdf}}', 'Alternative text for PDF bookmarks'],
]);
cmds('reference', 'cleveref', [
  ['cref', 'cref{${1:key}}', 'Clever reference'], ['Cref', 'Cref{${1:key}}', 'Clever reference (capitalised)'],
  ['crefrange', 'crefrange{${1:a}}{${2:b}}', 'Reference range'], ['Crefrange', 'Crefrange{${1:a}}{${2:b}}', 'Reference range (capitalised)'],
  ['cpageref', 'cpageref{${1:key}}', 'Clever page reference'], ['Cpageref', 'Cpageref{${1:key}}', 'Clever page reference (capitalised)'],
  ['labelcref', 'labelcref{${1:key}}', 'Number only'], ['crefname', 'crefname{${1:type}}{${2:singular}}{${3:plural}}', 'Name used by \\cref'],
  ['Crefname', 'Crefname{${1:type}}{${2:Singular}}{${3:Plural}}', 'Name used by \\Cref'],
]);
cmds('reference', 'varioref', [['vref', 'vref{${1:key}}', 'Reference with page'], ['vpageref', 'vpageref{${1:key}}', 'Page reference with text']]);

cmds('table', undefined, [
  ['hline', '', 'Horizontal rule'], ['cline', 'cline{${1:1-2}}', 'Partial horizontal rule'],
  ['multicolumn', 'multicolumn{${1:2}}{${2:c}}{${3:text}}', 'Span columns'], ['tabularnewline', '', 'End a table row'],
  ['arraystretch', '', 'Row height factor (redefine with \\renewcommand)'], ['tabcolsep', '', 'Column separation length'],
]);
cmds('table', 'booktabs', [
  ['toprule', '', 'Top rule'], ['midrule', '', 'Middle rule'], ['bottomrule', '', 'Bottom rule'],
  ['cmidrule', 'cmidrule(${1:lr}){${2:1-2}}', 'Partial rule'], ['addlinespace', '', 'Extra space between rows'],
]);
cmds('table', 'multirow', [['multirow', 'multirow{${1:2}}{${2:*}}{${3:text}}', 'Span rows']]);
cmds('table', 'siunitx', [
  ['SI', 'SI{${1:10}}{${2:\\metre}}', 'Number with unit (v2)'], ['si', 'si{${1:\\metre}}', 'Unit (v2)'],
  ['num', 'num{${1:12345.678}}', 'Formatted number'], ['qty', 'qty{${1:10}}{${2:\\metre}}', 'Quantity with unit'],
  ['unit', 'unit{${1:\\metre\\per\\second}}', 'Unit'], ['ang', 'ang{${1:45}}', 'Angle'],
  ['SIrange', 'SIrange{${1:1}}{${2:10}}{${3:\\metre}}', 'Range with unit (v2)'], ['qtyrange', 'qtyrange{${1:1}}{${2:10}}{${3:\\metre}}', 'Quantity range'],
  ['numrange', 'numrange{${1:1}}{${2:10}}', 'Number range'], ['tablenum', 'tablenum{${1:1.23}}', 'Number aligned in a table'],
  ['sisetup', 'sisetup{${1:per-mode=symbol}}', 'siunitx options'],
]);

cmds('bibliography', 'biblatex', [
  ['addbibresource', 'addbibresource{${1:references.bib}}', 'Add a .bib file'], ['printbibliography', '', 'Print the bibliography'],
  ['parencite', 'parencite{${1:key}}', 'Citation in parentheses'], ['Parencite', 'Parencite{${1:key}}', 'Capitalised parenthetical citation'],
  ['textcite', 'textcite{${1:key}}', 'Textual citation'], ['Textcite', 'Textcite{${1:key}}', 'Capitalised textual citation'],
  ['autocite', 'autocite{${1:key}}', 'Style-dependent citation'], ['Autocite', 'Autocite{${1:key}}', 'Capitalised autocite'],
  ['footcite', 'footcite{${1:key}}', 'Citation in a footnote'], ['smartcite', 'smartcite{${1:key}}', 'Footnote or parenthetical citation'],
  ['supercite', 'supercite{${1:key}}', 'Superscript citation'], ['cites', 'cites{${1:key1}}{${2:key2}}', 'Multiple citations'],
  ['citetitle', 'citetitle{${1:key}}', 'Cite the title'], ['fullcite', 'fullcite{${1:key}}', 'Full bibliography entry inline'],
  ['printbibheading', '', 'Bibliography heading'], ['DeclareFieldFormat', 'DeclareFieldFormat{${1:field}}{${2:#1}}', 'Field format'],
  ['ExecuteBibliographyOptions', 'ExecuteBibliographyOptions{${1:options}}', 'Set biblatex options'],
]);
cmds('bibliography', 'natbib', [
  ['citep', 'citep{${1:key}}', 'Parenthetical citation'], ['citet', 'citet{${1:key}}', 'Textual citation'],
  ['citealt', 'citealt{${1:key}}', 'Textual citation without parentheses'], ['citealp', 'citealp{${1:key}}', 'Parenthetical citation without parentheses'],
  ['citeauthor', 'citeauthor{${1:key}}', 'Author names only'], ['citeyear', 'citeyear{${1:key}}', 'Year only'],
  ['citeyearpar', 'citeyearpar{${1:key}}', 'Year in parentheses'], ['Citep', 'Citep{${1:key}}', 'Capitalised \\citep'],
  ['Citet', 'Citet{${1:key}}', 'Capitalised \\citet'], ['setcitestyle', 'setcitestyle{${1:authoryear}}', 'natbib citation style'],
]);

cmds('structure', 'beamer', [
  ['frametitle', 'frametitle{${1:Title}}', 'Frame title'], ['framesubtitle', 'framesubtitle{${1:Subtitle}}', 'Frame subtitle'],
  ['pause', '', 'Reveal step by step'], ['onslide', 'onslide<${1:2-}>{${2:content}}', 'Content on given slides'],
  ['only', 'only<${1:2}>{${2:content}}', 'Content only on given slides'], ['uncover', 'uncover<${1:2-}>{${2:content}}', 'Uncover on given slides'],
  ['visible', 'visible<${1:2-}>{${2:content}}', 'Visible on given slides'], ['invisible', 'invisible<${1:1}>{${2:content}}', 'Invisible on given slides'],
  ['alert', 'alert{${1:text}}', 'Highlighted text'], ['structure', 'structure{${1:text}}', 'Structure-coloured text'],
  ['usetheme', 'usetheme{${1:Madrid}}', 'Presentation theme'], ['usecolortheme', 'usecolortheme{${1:beaver}}', 'Colour theme'],
  ['usefonttheme', 'usefonttheme{${1:professionalfonts}}', 'Font theme'], ['useinnertheme', 'useinnertheme{${1:circles}}', 'Inner theme'],
  ['useoutertheme', 'useoutertheme{${1:infolines}}', 'Outer theme'], ['titlepage', '', 'Title page frame content'],
  ['subtitle', 'subtitle{${1:Subtitle}}', 'Presentation subtitle'], ['institute', 'institute{${1:Institution}}', 'Author institution'],
  ['logo', 'logo{\\includegraphics[height=${1:1cm}]{${2:logo}}}', 'Logo on every frame'], ['titlegraphic', 'titlegraphic{${1}}', 'Graphic on the title page'],
  ['setbeamertemplate', 'setbeamertemplate{${1:navigation symbols}}{${2}}', 'Set a beamer template'],
  ['setbeamercolor', 'setbeamercolor{${1:frametitle}}{fg=${2:white},bg=${3:black}}', 'Set a beamer colour'],
  ['setbeamerfont', 'setbeamerfont{${1:title}}{${2:size=\\Large}}', 'Set a beamer font'],
  ['insertframenumber', '', 'Current frame number'], ['inserttotalframenumber', '', 'Total frames'],
  ['AtBeginSection', 'AtBeginSection[]{\n\\begin{frame}\n\\tableofcontents[currentsection]\n\\end{frame}\n}', 'Code at each section start'],
  ['againframe', 'againframe{${1:label}}', 'Resume a labelled frame'], ['note', 'note{${1:speaker note}}', 'Speaker note'],
]);
cmds('formatting', 'geometry', [
  ['geometry', 'geometry{${1:margin=2.5cm}}', 'Page layout'], ['newgeometry', 'newgeometry{${1:margin=1cm}}', 'Change layout mid-document'],
  ['restoregeometry', '', 'Restore the original layout'],
]);
cmds('text', 'babel', [
  ['selectlanguage', 'selectlanguage{${1:english}}', 'Switch language'], ['foreignlanguage', 'foreignlanguage{${1:french}}{${2:text}}', 'Text in another language'],
]);
cmds('formatting', 'fontspec', [
  ['setmainfont', 'setmainfont{${1:TeX Gyre Pagella}}', 'Main (serif) font'], ['setsansfont', 'setsansfont{${1:TeX Gyre Heros}}', 'Sans-serif font'],
  ['setmonofont', 'setmonofont{${1:Latin Modern Mono}}', 'Monospace font'], ['newfontfamily', 'newfontfamily\\${1:myfont}{${2:Font Name}}', 'Define a font family'],
  ['fontspec', 'fontspec{${1:Font Name}}', 'Switch font'], ['defaultfontfeatures', 'defaultfontfeatures{${1:Ligatures=TeX}}', 'Default font features'],
]);
cmds('math', 'unicode-math', [['setmathfont', 'setmathfont{${1:Latin Modern Math}}', 'Math font']]);
cmds('formatting', 'enumitem', [
  ['setlist', 'setlist{${1:nosep}}', 'List options'], ['newlist', 'newlist{${1:name}}{${2:enumerate}}{${3:3}}', 'Define a list'],
  ['setlistdepth', 'setlistdepth{${1:9}}', 'Maximum list depth'],
]);
cmds('misc', 'listings', [
  ['lstinline', 'lstinline|${1:code}|', 'Inline code'], ['lstinputlisting', 'lstinputlisting[language=${1:Python}]{${2:file}}', 'Code from a file'],
  ['lstset', 'lstset{${1:basicstyle=\\ttfamily}}', 'listings options'], ['lstdefinestyle', 'lstdefinestyle{${1:name}}{${2}}', 'Define a listings style'],
  ['lstdefinelanguage', 'lstdefinelanguage{${1:name}}{${2}}', 'Define a language'],
]);
cmds('misc', 'minted', [
  ['mintinline', 'mintinline{${1:python}}{${2:code}}', 'Inline highlighted code'], ['inputminted', 'inputminted{${1:python}}{${2:file}}', 'Highlighted code from a file'],
  ['setminted', 'setminted{${1:fontsize=\\small}}', 'minted options'], ['usemintedstyle', 'usemintedstyle{${1:friendly}}', 'Pygments style'],
  ['newminted', 'newminted{${1:python}}{${2:options}}', 'Shortcut environment for a language'],
]);
cmds('misc', 'algpseudocode', [
  ['State', 'State ${1}', 'Statement'], ['If', 'If{${1:condition}}', 'If'], ['ElsIf', 'ElsIf{${1:condition}}', 'Else if'], ['Else', '', 'Else'],
  ['EndIf', '', 'End if'], ['For', 'For{${1:i = 1, n}}', 'For loop'], ['ForAll', 'ForAll{${1:x \\in S}}', 'For all loop'], ['EndFor', '', 'End for'],
  ['While', 'While{${1:condition}}', 'While loop'], ['EndWhile', '', 'End while'], ['Repeat', '', 'Repeat'], ['Until', 'Until{${1:condition}}', 'Until'],
  ['Function', 'Function{${1:Name}}{${2:args}}', 'Function'], ['EndFunction', '', 'End function'],
  ['Procedure', 'Procedure{${1:Name}}{${2:args}}', 'Procedure'], ['EndProcedure', '', 'End procedure'], ['Return', 'Return ${1}', 'Return'],
  ['Require', 'Require ${1}', 'Precondition'], ['Ensure', 'Ensure ${1}', 'Postcondition'], ['Comment', 'Comment{${1:text}}', 'Comment'],
  ['Call', 'Call{${1:Name}}{${2:args}}', 'Procedure call'],
]);
cmds('misc', 'algorithm2e', [
  ['KwIn', 'KwIn{${1:input}}', 'Input'], ['KwOut', 'KwOut{${1:output}}', 'Output'], ['KwData', 'KwData{${1:data}}', 'Data'],
  ['KwResult', 'KwResult{${1:result}}', 'Result'], ['KwRet', 'KwRet{${1:value}}', 'Return'], ['SetAlgoLined', '', 'Vertical lines on blocks'],
  ['DontPrintSemicolon', '', 'No semicolons'], ['SetKwInOut', 'SetKwInOut{${1:Input}}{${2:Input}}', 'Define an input/output keyword'],
]);
cmds('formatting', 'fancyhdr', [
  ['fancyhf', 'fancyhf{${1}}', 'Clear headers and footers'], ['fancyhead', 'fancyhead[${1:L}]{${2:text}}', 'Header'],
  ['fancyfoot', 'fancyfoot[${1:C}]{${2:\\thepage}}', 'Footer'], ['lhead', 'lhead{${1}}', 'Left header'], ['chead', 'chead{${1}}', 'Center header'],
  ['rhead', 'rhead{${1}}', 'Right header'], ['lfoot', 'lfoot{${1}}', 'Left footer'], ['cfoot', 'cfoot{${1}}', 'Center footer'], ['rfoot', 'rfoot{${1}}', 'Right footer'],
]);
cmds('formatting', 'titlesec', [
  ['titleformat', 'titleformat{${1:\\section}}{${2:\\Large\\bfseries}}{${3:\\thesection}}{${4:1em}}{${5}}', 'Heading format'],
  ['titlespacing', 'titlespacing*{${1:\\section}}{${2:0pt}}{${3:2ex}}{${4:1ex}}', 'Heading spacing'],
]);
cmds('graphics', 'caption', [
  ['captionof', 'captionof{${1:figure}}{${2:text}}', 'Caption outside a float'], ['captionsetup', 'captionsetup{${1:font=small}}', 'Caption options'],
]);
cmds('graphics', 'subcaption', [
  ['subcaption', 'subcaption{${1:text}}', 'Sub-caption'], ['subcaptionbox', 'subcaptionbox{${1:caption}}{${2:content}}', 'Sub-float with caption'],
  ['subref', 'subref{${1:key}}', 'Reference a sub-float'],
]);
cmds('reference', 'imakeidx', [['indexsetup', 'indexsetup{${1:othercode=\\small}}', 'Index layout']]);
cmds('reference', 'glossaries', [
  ['gls', 'gls{${1:term}}', 'Glossary term'], ['Gls', 'Gls{${1:term}}', 'Capitalised term'], ['glspl', 'glspl{${1:term}}', 'Plural term'],
  ['Glspl', 'Glspl{${1:term}}', 'Capitalised plural term'], ['newglossaryentry', 'newglossaryentry{${1:key}}{name=${2:name}, description={${3:description}}}', 'Define a glossary entry'],
  ['newacronym', 'newacronym{${1:key}}{${2:ABC}}{${3:Long Form}}', 'Define an acronym'], ['printglossaries', '', 'Print all glossaries'],
  ['makeglossaries', '', 'Enable glossaries'], ['acrshort', 'acrshort{${1:key}}', 'Short acronym'], ['acrlong', 'acrlong{${1:key}}', 'Long acronym'],
  ['acrfull', 'acrfull{${1:key}}', 'Full acronym'],
]);
cmds('misc', 'todonotes', [
  ['todo', 'todo{${1:note}}', 'To-do note'], ['missingfigure', 'missingfigure{${1:description}}', 'Placeholder figure'], ['listoftodos', '', 'List of to-dos'],
]);
cmds('text', 'csquotes', [
  ['enquote', 'enquote{${1:text}}', 'Language-aware quotes'], ['textquote', 'textquote{${1:text}}', 'Inline quotation'],
  ['blockquote', 'blockquote{${1:text}}', 'Block quotation'],
]);
cmds('text', 'xspace', [['xspace', '', 'Smart space after macros']]);
cmds('formatting', 'setspace', [
  ['singlespacing', '', 'Single line spacing'], ['onehalfspacing', '', '1.5 line spacing'], ['doublespacing', '', 'Double line spacing'],
  ['setstretch', 'setstretch{${1:1.25}}', 'Custom line spacing'],
]);
cmds('text', 'lipsum', [['lipsum', 'lipsum[${1:1-2}]', 'Dummy text']]);
cmds('text', 'blindtext', [['blindtext', '', 'Dummy text'], ['Blindtext', '', 'Long dummy text']]);
cmds('graphics', 'pdfpages', [['includepdf', 'includepdf[pages=${1:-}]{${2:file.pdf}}', 'Insert PDF pages']]);
cmds('structure', 'standalone', [['includestandalone', 'includestandalone[width=${1:\\linewidth}]{${2:file}}', 'Include a standalone figure']]);
cmds('structure', 'subfiles', [['subfile', 'subfile{${1:file}}', 'Include a compilable sub-file']]);
cmds('structure', 'import', [
  ['import', 'import{${1:dir/}}{${2:file}}', 'Input a file from a folder'], ['subimport', 'subimport{${1:dir/}}{${2:file}}', 'Relative import'],
]);
cmds('text', 'mhchem', [['ce', 'ce{${1:H2O}}', 'Chemical formula']]);
cmds('graphics', 'chemfig', [['chemfig', 'chemfig{${1:A-B}}', 'Structural formula']]);
cmds('formatting', 'soul', [['hl', 'hl{${1:text}}', 'Highlight'], ['st', 'st{${1:text}}', 'Strike through'], ['so', 'so{${1:text}}', 'Letter-space']]);
cmds('formatting', 'ulem', [['uline', 'uline{${1:text}}', 'Underline (breakable)'], ['sout', 'sout{${1:text}}', 'Strike out'], ['uwave', 'uwave{${1:text}}', 'Wavy underline']]);
cmds('formatting', 'multicol', [['columnbreak', '', 'Break to the next column']]);
cmds('reference', 'url', [['urlstyle', 'urlstyle{${1:same}}', 'URL font style']]);
cmds('misc', 'etoolbox', [
  ['AtBeginEnvironment', 'AtBeginEnvironment{${1:env}}{${2:code}}', 'Hook at environment start'],
  ['AtEndEnvironment', 'AtEndEnvironment{${1:env}}{${2:code}}', 'Hook at environment end'],
  ['newtoggle', 'newtoggle{${1:name}}', 'Boolean toggle'], ['toggletrue', 'toggletrue{${1:name}}', 'Set toggle true'],
  ['togglefalse', 'togglefalse{${1:name}}', 'Set toggle false'], ['iftoggle', 'iftoggle{${1:name}}{${2:true}}{${3:false}}', 'Branch on a toggle'],
  ['newrobustcmd', 'newrobustcmd{\\${1:name}}{${2:definition}}', 'Robust command'],
]);
cmds('misc', 'ifthen', [['ifthenelse', 'ifthenelse{${1:test}}{${2:true}}{${3:false}}', 'Conditional'], ['equal', 'equal{${1:a}}{${2:b}}', 'String equality test']]);
cmds('misc', 'xparse', [
  ['NewDocumentCommand', 'NewDocumentCommand{\\${1:name}}{${2:m}}{${3:definition}}', 'Define a command (xparse)'],
  ['RenewDocumentCommand', 'RenewDocumentCommand{\\${1:name}}{${2:m}}{${3:definition}}', 'Redefine a command (xparse)'],
  ['NewDocumentEnvironment', 'NewDocumentEnvironment{${1:name}}{${2:m}}{${3:begin}}{${4:end}}', 'Define an environment (xparse)'],
]);
cmds('formatting', 'tcolorbox', [
  ['tcbuselibrary', 'tcbuselibrary{${1:skins,theorems}}', 'Load tcolorbox libraries'], ['newtcolorbox', 'newtcolorbox{${1:name}}{${2:options}}', 'Define a box environment'],
  ['newtcbtheorem', 'newtcbtheorem{${1:name}}{${2:Title}}{${3:options}}{${4:prefix}}', 'Theorem-like box'], ['tcbset', 'tcbset{${1:options}}', 'tcolorbox defaults'],
]);
cmds('reference', 'nameref', [['Nameref', 'Nameref{${1:key}}', 'Title reference with page']]);
cmds('misc', 'xr', [['externaldocument', 'externaldocument{${1:other}}', 'References from another document']]);

// Math symbols as commands (Greek, operators, arrows…), unless already defined above.
for (const g of mathSymbols) {
  for (const s of g.symbols) {
    const m = /^\\([A-Za-z]+)$/.exec(s.cmd);
    if (!m) continue;
    const c: LatexCommandInfo = { name: m[1], category: 'symbol', symbol: s.char, detail: s.name ?? g.group };
    if (s.package) c.package = s.package;
    commandsOut.push(c);
  }
}

/** Every command once (first definition wins). */
export const latexCommands: LatexCommandInfo[] = (() => {
  const seen = new Set<string>();
  const out: LatexCommandInfo[] = [];
  for (const c of commandsOut) {
    if (seen.has(c.name)) {
      // Merge a symbol preview into an earlier definition (e.g. \sum with a snippet).
      if (c.symbol) {
        const prev = out.find((p) => p.name === c.name)!;
        prev.symbol ??= c.symbol;
      }
      continue;
    }
    seen.add(c.name);
    out.push(c);
  }
  return out;
})();

// ═══════════════════════════════ environments ═══════════════════════════════

type E = [name: string, args: string, snippet: string, detail: string, pkg?: string, math?: boolean];

const ITEMS = '\\item ${1}';
const envList: E[] = [
  ['document', '', '${1}', 'Document body'],
  ['figure', '[${1:htbp}]', '\\centering\n\\includegraphics[width=${2:0.8\\linewidth}]{${3:file}}\n\\caption{${4:Caption}}\n\\label{fig:${5:label}}', 'Floating figure'],
  ['figure*', '[${1:t}]', '\\centering\n\\includegraphics[width=${2:\\textwidth}]{${3:file}}\n\\caption{${4:Caption}}\n\\label{fig:${5:label}}', 'Full-width figure (two-column)'],
  ['table', '[${1:htbp}]', '\\centering\n\\caption{${2:Caption}}\n\\label{tab:${3:label}}\n\\begin{tabular}{${4:lcr}}\n\\toprule\n${5:A} & ${6:B} & ${7:C} \\\\\n\\midrule\n${8}\n\\bottomrule\n\\end{tabular}', 'Floating table'],
  ['table*', '[${1:t}]', '\\centering\n\\caption{${2:Caption}}\n\\begin{tabular}{${3:lcr}}\n${4}\n\\end{tabular}', 'Full-width table (two-column)'],
  ['tabular', '{${1:lcr}}', '${2:a} & ${3:b} & ${4:c} \\\\', 'Table'],
  ['tabular*', '{${1:\\linewidth}}{@{\\extracolsep{\\fill}}${2:lcr}}', '${3}', 'Table with given width'],
  ['tabularx', '{${1:\\linewidth}}{${2:X X}}', '${3:a} & ${4:b} \\\\', 'Table with stretchable X columns', 'tabularx'],
  ['longtable', '{${1:lcr}}', '${2}', 'Multi-page table', 'longtable'],
  ['array', '{${1:cc}}', '${2:a} & ${3:b} \\\\', 'Math array', undefined, true],
  ['itemize', '', ITEMS, 'Bulleted list'], ['enumerate', '', ITEMS, 'Numbered list'],
  ['description', '', '\\item[${1:term}] ${2:description}', 'Description list'],
  ['equation', '', '${1}\n\\label{eq:${2:label}}', 'Numbered equation', undefined, true],
  ['equation*', '', '${1}', 'Unnumbered equation', 'amsmath', true],
  ['align', '', '${1:a} &= ${2:b} \\\\\n${3:c} &= ${4:d}', 'Aligned equations', 'amsmath', true],
  ['align*', '', '${1:a} &= ${2:b} \\\\\n${3:c} &= ${4:d}', 'Aligned equations (unnumbered)', 'amsmath', true],
  ['alignat', '{${1:2}}', '${2}', 'Aligned at several points', 'amsmath', true],
  ['alignat*', '{${1:2}}', '${2}', 'Aligned at several points (unnumbered)', 'amsmath', true],
  ['flalign', '', '${1}', 'Full-width alignment', 'amsmath', true], ['flalign*', '', '${1}', 'Full-width alignment (unnumbered)', 'amsmath', true],
  ['gather', '', '${1} \\\\\n${2}', 'Centered equations', 'amsmath', true], ['gather*', '', '${1} \\\\\n${2}', 'Centered equations (unnumbered)', 'amsmath', true],
  ['multline', '', '${1} \\\\\n${2}', 'Multi-line equation', 'amsmath', true], ['multline*', '', '${1} \\\\\n${2}', 'Multi-line equation (unnumbered)', 'amsmath', true],
  ['split', '', '${1} &= ${2} \\\\\n&= ${3}', 'Split inside an equation', 'amsmath', true],
  ['aligned', '', '${1} &= ${2}', 'Aligned block inside math', 'amsmath', true], ['gathered', '', '${1}', 'Gathered block inside math', 'amsmath', true],
  ['cases', '', '${1:value} & \\text{if } ${2:condition} \\\\\n${3:value} & \\text{otherwise}', 'Piecewise definition', 'amsmath', true],
  ['dcases', '', '${1:value} & ${2:condition}', 'Display-style cases', 'mathtools', true],
  ['matrix', '', '${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}', 'Matrix without delimiters', 'amsmath', true],
  ['pmatrix', '', '${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}', 'Matrix with ( )', 'amsmath', true],
  ['bmatrix', '', '${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}', 'Matrix with [ ]', 'amsmath', true],
  ['Bmatrix', '', '${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}', 'Matrix with braces', 'amsmath', true],
  ['vmatrix', '', '${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}', 'Determinant | |', 'amsmath', true],
  ['Vmatrix', '', '${1:a} & ${2:b} \\\\\n${3:c} & ${4:d}', 'Norm ‖ ‖', 'amsmath', true],
  ['smallmatrix', '', '${1:a} & ${2:b} \\\\ ${3:c} & ${4:d}', 'Inline-size matrix', 'amsmath', true],
  ['subequations', '', '\\begin{align}\n${1}\n\\end{align}', 'Sub-numbered equations', 'amsmath'],
  ['displaymath', '', '${1}', 'Unnumbered display math', undefined, true], ['math', '', '${1}', 'Inline math', undefined, true],
  ['eqnarray', '', '${1} & = & ${2}', 'Legacy aligned equations (prefer align)', undefined, true],
  ['theorem', '[${1:name}]', '${2}', 'Theorem (define with \\newtheorem)', 'amsthm'],
  ['lemma', '', '${1}', 'Lemma (define with \\newtheorem)', 'amsthm'], ['proposition', '', '${1}', 'Proposition', 'amsthm'],
  ['corollary', '', '${1}', 'Corollary', 'amsthm'], ['definition', '', '${1}', 'Definition', 'amsthm'], ['example', '', '${1}', 'Example', 'amsthm'],
  ['remark', '', '${1}', 'Remark', 'amsthm'], ['proof', '', '${1}', 'Proof with QED symbol', 'amsthm'],
  ['abstract', '', '${1}', 'Abstract'], ['quote', '', '${1}', 'Short quotation'], ['quotation', '', '${1}', 'Long quotation'],
  ['verse', '', '${1}', 'Poetry'], ['center', '', '${1}', 'Centered content'], ['flushleft', '', '${1}', 'Left-aligned content'],
  ['flushright', '', '${1}', 'Right-aligned content'], ['minipage', '{${1:0.45\\linewidth}}', '${2}', 'Mini page'],
  ['verbatim', '', '${1}', 'Verbatim text'], ['verbatim*', '', '${1}', 'Verbatim with visible spaces'],
  ['lstlisting', '[language=${1:Python}]', '${2}', 'Code listing', 'listings'], ['minted', '{${1:python}}', '${2}', 'Highlighted code', 'minted'],
  ['algorithm', '[${1:htbp}]', '\\caption{${2:Algorithm}}\n\\label{alg:${3:label}}\n\\begin{algorithmic}[1]\n\\State ${4}\n\\end{algorithmic}', 'Algorithm float', 'algorithm'],
  ['algorithmic', '[1]', '\\State ${1}', 'Pseudo-code', 'algpseudocode'],
  ['frame', '{${1:Title}}', '${2}', 'Beamer slide', 'beamer'], ['block', '{${1:Title}}', '${2}', 'Beamer block', 'beamer'],
  ['alertblock', '{${1:Title}}', '${2}', 'Beamer alert block', 'beamer'], ['exampleblock', '{${1:Title}}', '${2}', 'Beamer example block', 'beamer'],
  ['columns', '', '\\begin{column}{${1:0.5\\textwidth}}\n${2}\n\\end{column}\n\\begin{column}{${3:0.5\\textwidth}}\n${4}\n\\end{column}', 'Beamer columns', 'beamer'],
  ['column', '{${1:0.5\\textwidth}}', '${2}', 'Beamer column', 'beamer'], ['onlyenv', '<${1:2}>', '${2}', 'Content only on given slides', 'beamer'],
  ['overprint', '', '\\onslide<${1:1}> ${2}', 'Overlapping overlay content', 'beamer'],
  ['tikzpicture', '', '\\draw ${1:(0,0) -- (1,1)};', 'TikZ drawing', 'tikz'], ['scope', '[${1}]', '${2}', 'TikZ scope', 'tikz'],
  ['axis', '[xlabel={${1:$x$}}, ylabel={${2:$y$}}]', '\\addplot {${3:x^2}};', 'pgfplots axis', 'pgfplots'],
  ['subfigure', '{${1:0.48\\linewidth}}', '\\centering\n\\includegraphics[width=\\linewidth]{${2:file}}\n\\caption{${3:Caption}}', 'Sub-figure', 'subcaption'],
  ['wrapfigure', '{${1:r}}{${2:0.4\\linewidth}}', '\\centering\n\\includegraphics[width=\\linewidth]{${3:file}}\n\\caption{${4:Caption}}', 'Text-wrapped figure', 'wrapfig'],
  ['multicols', '{${1:2}}', '${2}', 'Multiple columns', 'multicol'],
  ['thebibliography', '{${1:99}}', '\\bibitem{${2:key}} ${3:Reference}', 'Manual bibliography'],
  ['titlepage', '', '${1}', 'Title page'], ['appendices', '', '${1}', 'Appendices', 'appendix'],
  ['tcolorbox', '[title=${1:Title}]', '${2}', 'Coloured box', 'tcolorbox'],
  ['filecontents', '{${1:file.bib}}', '${2}', 'Write a file from the document'], ['comment', '', '${1}', 'Commented-out block', 'comment'],
  ['landscape', '', '${1}', 'Landscape pages', 'pdflscape'], ['singlespace', '', '${1}', 'Single spacing', 'setspace'],
  ['onehalfspace', '', '${1}', '1.5 spacing', 'setspace'], ['doublespace', '', '${1}', 'Double spacing', 'setspace'],
  ['letter', '{${1:Recipient}}', '\\opening{${2:Dear Sir or Madam,}}\n${3}\n\\closing{${4:Yours faithfully,}}', 'Letter (letter class)'],
  ['refsection', '', '${1}', 'Bibliography section', 'biblatex'], ['otherlanguage', '{${1:french}}', '${2}', 'Text in another language', 'babel'],
  ['list', '{${1:label}}{${2:settings}}', '\\item ${3}', 'Generic list'], ['trivlist', '', '\\item ${1}', 'Trivial list'],
  ['tabbing', '', '${1} \\= ${2} \\\\', 'Tab stops'], ['spacing', '{${1:1.5}}', '${2}', 'Custom spacing', 'setspace'],
  ['threeparttable', '', '\\begin{tabular}{${1:lc}}\n${2}\n\\end{tabular}\n\\begin{tablenotes}\n\\item ${3}\n\\end{tablenotes}', 'Table with notes', 'threeparttable'],
  ['mdframed', '[${1}]', '${2}', 'Framed box', 'mdframed'], ['framed', '', '${1}', 'Framed block', 'framed'],
  ['adjustbox', '{${1:max width=\\linewidth}}', '${2}', 'Adjusted box', 'adjustbox'], ['sidewaystable', '', '${1}', 'Rotated table', 'rotating'],
  ['sidewaysfigure', '', '${1}', 'Rotated figure', 'rotating'], ['Verbatim', '[${1:frame=single}]', '${2}', 'fancyvrb verbatim', 'fancyvrb'],
  ['tikzcd', '', '${1:A} \\arrow[r] & ${2:B}', 'Commutative diagram', 'tikz-cd'],
];

export const latexEnvironments: LatexEnvironmentInfo[] = envList.map(([name, args, snippet, detail, pkg, math]) => {
  const e: LatexEnvironmentInfo = { name };
  if (snippet) e.snippet = snippet;
  if (args) e.args = args;
  if (detail) e.detail = detail;
  if (pkg) e.package = pkg;
  if (math) e.math = true;
  return e;
});

// ═══════════════════════════════ packages ═══════════════════════════════

const pkgList: [string, string][] = [
  ['amsmath', 'AMS mathematical facilities: align, gather, \\text, \\dfrac…'], ['amssymb', 'AMS symbol fonts (\\mathbb, extra relations and arrows)'],
  ['amsthm', 'Theorem environments and proofs'], ['amsfonts', 'AMS fonts (\\mathbb, \\mathfrak)'], ['mathtools', 'Extensions and fixes for amsmath'],
  ['graphicx', 'Include and transform images'], ['xcolor', 'Colours for text, boxes and pages'], ['color', 'Basic colour support'],
  ['hyperref', 'Hyperlinks, PDF bookmarks and metadata'], ['cleveref', 'Clever cross-references with automatic names'],
  ['varioref', 'References with page information'], ['nameref', 'References to section titles'], ['geometry', 'Page dimensions and margins'],
  ['babel', 'Multilingual typesetting'], ['polyglossia', 'Multilingual typesetting for XeLaTeX/LuaLaTeX'], ['fontspec', 'OpenType/TrueType fonts (XeLaTeX/LuaLaTeX)'],
  ['unicode-math', 'Unicode math fonts (XeLaTeX/LuaLaTeX)'], ['inputenc', 'Input encoding (utf8 is the default in recent LaTeX)'],
  ['fontenc', 'Font encoding (T1 for accented characters)'], ['lmodern', 'Latin Modern fonts'], ['microtype', 'Micro-typographic refinements'],
  ['booktabs', 'Publication-quality table rules'], ['tabularx', 'Tables with stretchable columns'], ['tabulary', 'Tables with balanced column widths'],
  ['longtable', 'Tables spanning several pages'], ['multirow', 'Cells spanning several rows'], ['array', 'Extended column types for tabular'],
  ['colortbl', 'Coloured table cells'], ['makecell', 'Multi-line cells and headers'], ['diagbox', 'Diagonal lines in table cells'],
  ['threeparttable', 'Tables with notes'], ['dcolumn', 'Decimal-aligned columns'], ['siunitx', 'SI units and number formatting'],
  ['biblatex', 'Modern bibliographies (with biber)'], ['natbib', 'Author-year and numeric citations (with BibTeX)'], ['csquotes', 'Context-sensitive quotation marks'],
  ['cite', 'Compressed numeric citations'], ['apacite', 'APA citations with BibTeX'], ['tikz', 'Programmatic graphics (PGF/TikZ)'],
  ['pgfplots', 'Plots based on TikZ'], ['tikz-cd', 'Commutative diagrams'], ['circuitikz', 'Electrical circuits'],
  ['forest', 'Trees with TikZ'], ['tikzposter', 'Posters with TikZ'], ['beamerposter', 'Posters with beamer'], ['listings', 'Source code listings'],
  ['minted', 'Highlighted code with Pygments (needs shell escape)'], ['fancyvrb', 'Enhanced verbatim'], ['verbatim', 'Improved verbatim and comment environment'],
  ['algorithm', 'Algorithm float'], ['algpseudocode', 'Pseudo-code layout (algorithmicx)'], ['algorithmicx', 'Customizable pseudo-code'],
  ['algorithm2e', 'Algorithms with a rich syntax'], ['fancyhdr', 'Custom headers and footers'], ['titlesec', 'Custom section headings'],
  ['titletoc', 'Custom table of contents'], ['tocloft', 'Customise TOC, LOF and LOT'], ['enumitem', 'Customisable lists'],
  ['caption', 'Customise captions'], ['subcaption', 'Sub-figures and sub-tables'], ['float', 'Improved floats and the [H] placement'],
  ['wrapfig', 'Figures wrapped by text'], ['placeins', 'Keep floats in their section (\\FloatBarrier)'], ['afterpage', 'Execute commands after the page'],
  ['setspace', 'Line spacing'], ['parskip', 'Paragraph spacing instead of indentation'], ['multicol', 'Multiple columns'],
  ['tcolorbox', 'Coloured and framed boxes'], ['mdframed', 'Framed environments across pages'], ['framed', 'Framed and shaded regions'],
  ['todonotes', 'To-do notes in the margin'], ['glossaries', 'Glossaries and acronyms'], ['acronym', 'Acronyms'], ['nomencl', 'Nomenclature lists'],
  ['imakeidx', 'Indexes'], ['makeidx', 'Index support'], ['url', 'Typeset URLs'], ['xspace', 'Smart spaces after macros'],
  ['etoolbox', 'Programming tools for LaTeX authors'], ['ifthen', 'Conditionals'], ['xparse', 'Document command definitions'],
  ['calc', 'Arithmetic in lengths and counters'], ['lipsum', 'Lorem ipsum dummy text'], ['blindtext', 'Blind text'], ['appendix', 'Extra appendix control'],
  ['pdfpages', 'Include PDF pages'], ['standalone', 'Compile figures standalone and include them'], ['subfiles', 'Compilable sub-files'],
  ['import', 'Relative file imports'], ['chngcntr', 'Change counter resetting'], ['physics', 'Physics notation shortcuts'], ['bm', 'Bold math symbols'],
  ['upgreek', 'Upright Greek letters'], ['stmaryrd', 'St Mary Road symbols'], ['mathrsfs', 'Script math letters (\\mathscr)'], ['esint', 'Extended integrals'],
  ['cancel', 'Strike-outs in math'], ['gensymb', 'Generic symbols (\\degree, \\celsius)'], ['mathdots', 'Extra dots (\\iddots)'],
  ['chemfig', 'Chemical structures'], ['mhchem', 'Chemical equations'], ['chemformula', 'Chemical formulas'], ['pgfgantt', 'Gantt charts'],
  ['qtree', 'Linguistic trees'], ['dirtree', 'Directory trees'], ['comment', 'Comment environments'], ['soul', 'Highlighting and letter spacing'],
  ['ulem', 'Underlining and striking out'], ['xr', 'Cross-references to other documents'], ['footmisc', 'Footnote styles'],
  ['rotating', 'Rotated figures and tables'], ['pdflscape', 'Landscape pages in PDF'], ['textcomp', 'Text companion symbols'],
  ['eurosym', 'Euro symbol'], ['marvosym', 'Martin Vogel symbols'], ['fontawesome5', 'Font Awesome 5 icons'], ['academicons', 'Academic icons'],
  ['newtxtext', 'Times-like text font'], ['newtxmath', 'Times-like math font'], ['mathpazo', 'Palatino math (legacy)'], ['libertine', 'Linux Libertine fonts'],
  ['libertinus', 'Libertinus fonts'], ['sourcesanspro', 'Source Sans Pro font'], ['roboto', 'Roboto fonts'], ['tgpagella', 'TeX Gyre Pagella font'],
  ['tgheros', 'TeX Gyre Heros font'], ['tgtermes', 'TeX Gyre Termes font'], ['charter', 'Charter font'], ['inconsolata', 'Inconsolata monospace font'],
  ['beramono', 'Bera Mono monospace font'], ['mathptmx', 'Times math (legacy)'], ['fourier', 'Utopia with Fourier math'], ['kpfonts', 'Kp-Fonts'],
  ['dsfont', 'Double-stroke font'], ['bbm', 'Blackboard bold variants'], ['tipa', 'Phonetic alphabet'], ['pifont', 'Dingbat symbols'],
  ['epigraph', 'Epigraphs'], ['lettrine', 'Drop caps'], ['changepage', 'Change page layout locally'], ['adjustbox', 'Adjust and scale boxes'],
  ['fancybox', 'Fancy boxes'], ['shadow', 'Shadowed boxes'], ['background', 'Page backgrounds'], ['eso-pic', 'Pictures in the page background'],
  ['draftwatermark', 'Watermarks'], ['lastpage', 'Reference to the last page'], ['totcount', 'Total counter values'], ['hyphenat', 'Hyphenation control'],
  ['ragged2e', 'Better ragged text'], ['microtype', 'Microtypography'], ['luacode', 'Lua code in LuaLaTeX'], ['pythontex', 'Run Python code'],
  ['datetime2', 'Date and time formatting'], ['fmtcount', 'Counters as words'], ['numprint', 'Number formatting'], ['units', 'Units and nice fractions'],
  ['tabto', 'Tab stops'], ['moderncvstyle', 'moderncv styles'], ['geometry', 'Page layout'], ['bookmark', 'Better PDF bookmarks'],
  ['pdfcomment', 'PDF annotations'], ['animate', 'PDF animations'], ['media9', 'Embedded media'], ['attachfile', 'File attachments in PDF'],
  ['showframe', 'Show page layout frames'], ['layout', 'Show the page layout'], ['emptypage', 'Empty pages without headers'],
  ['nowidow', 'Avoid widows and orphans'], ['needspace', 'Reserve vertical space'], ['indentfirst', 'Indent the first paragraph'],
  ['sectsty', 'Section heading styles'], ['minitoc', 'Mini tables of contents'], ['etoc', 'Flexible tables of contents'],
  ['thmtools', 'Theorem definitions made easy'], ['ntheorem', 'Enhanced theorem environments'], ['cases', 'Numbered cases'],
  ['empheq', 'Emphasised equations'], ['breqn', 'Automatic equation line breaking'], ['nicematrix', 'Matrices with extra features'],
  ['easytable', 'Easy tables'], ['pgfplotstable', 'Tables from data files'], ['csvsimple', 'Tables from CSV files'], ['datatool', 'Databases in LaTeX'],
  ['svg', 'Include SVG images (needs Inkscape)'], ['epstopdf', 'Convert EPS to PDF'], ['grffile', 'Extended file names for graphics'],
  ['xstring', 'String manipulation'], ['pgfopts', 'Key-value options'], ['kvoptions', 'Key-value package options'],
];

export const latexPackages: { name: string; detail: string }[] = (() => {
  const seen = new Set<string>();
  const out: { name: string; detail: string }[] = [];
  for (const [name, detail] of pkgList) {
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({ name, detail });
  }
  return out;
})();

// ═══════════════════════════════ lookups ═══════════════════════════════

let commandMap: Map<string, LatexCommandInfo> | undefined;
let environmentMap: Map<string, LatexEnvironmentInfo> | undefined;
let packageMap: Map<string, { name: string; detail: string }> | undefined;
let symbolMap: Map<string, MathSymbolGroup['symbols'][number] & { group: string }> | undefined;

/** Look up a command by name (with or without the leading backslash). */
export function getLatexCommand(name: string): LatexCommandInfo | undefined {
  commandMap ??= new Map(latexCommands.map((c) => [c.name, c]));
  return commandMap.get(name.startsWith('\\') ? name.slice(1) : name);
}

export function getLatexEnvironment(name: string): LatexEnvironmentInfo | undefined {
  environmentMap ??= new Map(latexEnvironments.map((e) => [e.name, e]));
  return environmentMap.get(name);
}

export function getLatexPackage(name: string): { name: string; detail: string } | undefined {
  packageMap ??= new Map(latexPackages.map((p) => [p.name, p]));
  return packageMap.get(name);
}

/** Look up a math symbol by command (`\alpha`, `alpha`, `\mathbb{R}`). */
export function findMathSymbol(cmd: string): (MathSymbolGroup['symbols'][number] & { group: string }) | undefined {
  if (!symbolMap) {
    symbolMap = new Map();
    for (const g of mathSymbols) for (const s of g.symbols) if (!symbolMap.has(s.cmd)) symbolMap.set(s.cmd, { ...s, group: g.group });
  }
  return symbolMap.get(cmd.startsWith('\\') ? cmd : '\\' + cmd);
}
