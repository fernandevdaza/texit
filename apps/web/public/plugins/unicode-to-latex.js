// Unicode → LaTeX converter.
// Replaces accented letters, typographic punctuation, Greek letters and math
// symbols pasted from Word/PDFs with portable LaTeX (safe with pdflatex).

const { definePlugin } = window.TexIt;

const TEXT = {
  // Typography
  '“': '``', '”': "''", '‘': '`', '’': "'", '„': ',,', '«': '\\guillemotleft{}', '»': '\\guillemotright{}',
  '–': '--', '—': '---', '…': '\\ldots{}', '\u00a0': '~', '\u2009': '\\,', '•': '\\textbullet{}',
  '§': '\\S{}', '¶': '\\P{}', '©': '\\copyright{}', '®': '\\textregistered{}', '™': '\\texttrademark{}',
  '°': '\\textdegree{}', '€': '\\euro{}', '£': '\\pounds{}', '†': '\\dag{}', '‡': '\\ddag{}',
  '¿': '?`', '¡': '!`', 'ß': '\\ss{}', 'æ': '\\ae{}', 'Æ': '\\AE{}', 'œ': '\\oe{}', 'Œ': '\\OE{}',
  'ø': '\\o{}', 'Ø': '\\O{}', 'å': '\\aa{}', 'Å': '\\AA{}', 'ł': '\\l{}', 'Ł': '\\L{}', 'ı': '\\i{}',
  '&': '\\&', '%': '\\%', '#': '\\#', '_': '\\_',
};

const MATH = {
  α: '\\alpha', β: '\\beta', γ: '\\gamma', δ: '\\delta', ε: '\\varepsilon', ζ: '\\zeta', η: '\\eta', θ: '\\theta',
  ι: '\\iota', κ: '\\kappa', λ: '\\lambda', μ: '\\mu', ν: '\\nu', ξ: '\\xi', π: '\\pi', ρ: '\\rho', σ: '\\sigma',
  τ: '\\tau', υ: '\\upsilon', φ: '\\varphi', χ: '\\chi', ψ: '\\psi', ω: '\\omega',
  Γ: '\\Gamma', Δ: '\\Delta', Θ: '\\Theta', Λ: '\\Lambda', Ξ: '\\Xi', Π: '\\Pi', Σ: '\\Sigma', Φ: '\\Phi', Ψ: '\\Psi', Ω: '\\Omega',
  '≤': '\\leq', '≥': '\\geq', '≠': '\\neq', '≈': '\\approx', '≡': '\\equiv', '±': '\\pm', '∓': '\\mp', '×': '\\times',
  '÷': '\\div', '·': '\\cdot', '∞': '\\infty', '∑': '\\sum', '∏': '\\prod', '∫': '\\int', '∂': '\\partial', '∇': '\\nabla',
  '√': '\\sqrt{}', '∈': '\\in', '∉': '\\notin', '⊂': '\\subset', '⊆': '\\subseteq', '∪': '\\cup', '∩': '\\cap', '∅': '\\emptyset',
  '∀': '\\forall', '∃': '\\exists', '¬': '\\neg', '∧': '\\land', '∨': '\\lor', '→': '\\to', '←': '\\leftarrow',
  '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇔': '\\Leftrightarrow', '∝': '\\propto', '′': "'", 'ℝ': '\\mathbb{R}',
  'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}', '²': '^{2}', '³': '^{3}', '¹': '^{1}',
  '½': '\\frac{1}{2}', '¼': '\\frac{1}{4}', '¾': '\\frac{3}{4}',
};

const ACCENTS = { '\u0301': "\\'", '\u0300': '\\`', '\u0302': '\\^', '\u0308': '\\"', '\u0303': '\\~', '\u0327': '\\c', '\u030c': '\\v', '\u0304': '\\=', '\u0306': '\\u', '\u030a': '\\r', '\u030b': '\\H', '\u0328': '\\k' };

export function convert(input, { escapeSpecials = false } = {}) {
  let out = '';
  // Decompose accented letters: é → e + U+0301.
  const chars = Array.from(input.normalize('NFD'));
  let changes = 0;
  let mathEnd = -1;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const next = chars[i + 1];
    if (next && ACCENTS[next] && /[A-Za-z]/.test(c)) {
      const cmd = ACCENTS[next];
      const base = c === 'i' ? '\\i' : c === 'j' ? '\\j' : c;
      out += /^\\[a-zA-Z]$/.test(cmd) ? `${cmd}{${base}}` : `{${cmd}${base.length > 1 ? `{${base}}` : base}}`;
      i++;
      changes++;
    } else if (MATH[c]) {
      // Merge runs of symbols into one math span: αβ → $\alpha\beta$
      out = out.length && out.length === mathEnd ? `${out.slice(0, -1)}${MATH[c]}$` : `${out}$${MATH[c]}$`;
      mathEnd = out.length;
      changes++;
    } else if (TEXT[c] && (escapeSpecials || !'&%#_'.includes(c))) {
      out += TEXT[c];
      changes++;
    } else out += c;
  }
  return { text: out.normalize('NFC'), changes };
}

export default definePlugin({
  id: 'org.texit.examples.unicode2latex',
  name: 'Unicode → LaTeX',
  version: '1.0.0',
  author: 'TexIt examples',
  icon: 'languages',
  description: 'Convert accented letters, smart quotes, dashes, Greek letters and math symbols (e.g. from pasted Word/PDF text) into portable LaTeX.',
  apiVersion: '1.1.0',
  permissions: ['editor', 'project:read', 'project:write'],
  tags: ['unicode', 'cleanup', 'example'],
  settings: [{ key: 'escapeSpecials', title: 'Also escape & % # _', type: 'boolean', default: false }],

  activate(api) {
    const opts = () => ({ escapeSpecials: api.settings.get('escapeSpecials', false) });

    api.commands.register({
      id: 'selection',
      title: 'Convert selection to LaTeX',
      category: 'Edit',
      when: 'editor',
      run: () => {
        const sel = api.editor.getSelection();
        if (!sel || !sel.text) return api.ui.toast('Select some text first', { type: 'warning' });
        const { text, changes } = convert(sel.text, opts());
        api.editor.replaceSelection(text);
        api.ui.toast(`${changes} character${changes === 1 ? '' : 's'} converted`, { type: 'success' });
      },
    });

    api.commands.register({
      id: 'file',
      title: 'Convert whole file to LaTeX',
      category: 'Edit',
      when: 'editor',
      run: async () => {
        const path = api.editor.getActivePath();
        if (!path) return;
        const src = await api.project.readFile(path);
        if (typeof src !== 'string') return;
        const { text, changes } = convert(src, opts());
        if (!changes) return api.ui.toast('Nothing to convert', { type: 'info' });
        const ok = await api.ui.confirm({ title: `Convert ${changes} characters in ${path}?`, message: 'Accents become \\\'{e}-style commands, symbols become math.' });
        if (ok) await api.project.writeFile(path, text);
      },
    });
  },
});
