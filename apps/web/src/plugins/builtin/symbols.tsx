/**
 * Symbol palette — searchable grid of math symbols (from `api.latex.symbols()`)
 * rendered with KaTeX; click inserts the command at the cursor.
 */
import { memo, useEffect, useMemo, useState } from 'react';
import katex from 'katex';
import { Search, X } from 'lucide-react';
import { definePlugin, type MathSymbolInfo, type PluginAPI } from '@texit/plugin-api';
import { EmptyState, Input, PanelHeader, Tooltip } from '@/ui';
import { mountReact } from './mount';

interface PaletteSymbol extends MathSymbolInfo {
  /** For structures: wrap the selection with before/after instead of inserting `command`. */
  before?: string;
  after?: string;
  /** KaTeX source used for the preview. */
  preview?: string;
}

/** Constructs with arguments — inserted around the selection. */
const STRUCTURES: PaletteSymbol[] = [
  { command: '\\frac{a}{b}', before: '\\frac{', after: '}{}', preview: '\\frac{a}{b}', category: 'Structures', name: 'fraction' },
  { command: '\\dfrac{a}{b}', before: '\\dfrac{', after: '}{}', preview: '\\dfrac{a}{b}', category: 'Structures', name: 'display fraction', package: 'amsmath' },
  { command: '\\sqrt{x}', before: '\\sqrt{', after: '}', preview: '\\sqrt{x}', category: 'Structures', name: 'square root' },
  { command: '\\sqrt[n]{x}', before: '\\sqrt[n]{', after: '}', preview: '\\sqrt[n]{x}', category: 'Structures', name: 'nth root' },
  { command: 'x^{n}', before: '^{', after: '}', preview: 'x^{n}', category: 'Structures', name: 'superscript power' },
  { command: 'x_{i}', before: '_{', after: '}', preview: 'x_{i}', category: 'Structures', name: 'subscript index' },
  { command: '\\binom{n}{k}', before: '\\binom{', after: '}{}', preview: '\\binom{n}{k}', category: 'Structures', name: 'binomial', package: 'amsmath' },
  { command: '\\hat{a}', before: '\\hat{', after: '}', preview: '\\hat{a}', category: 'Accents', name: 'hat' },
  { command: '\\widehat{ab}', before: '\\widehat{', after: '}', preview: '\\widehat{ab}', category: 'Accents', name: 'wide hat' },
  { command: '\\bar{a}', before: '\\bar{', after: '}', preview: '\\bar{a}', category: 'Accents', name: 'bar' },
  { command: '\\overline{ab}', before: '\\overline{', after: '}', preview: '\\overline{ab}', category: 'Accents', name: 'overline' },
  { command: '\\underline{ab}', before: '\\underline{', after: '}', preview: '\\underline{ab}', category: 'Accents', name: 'underline' },
  { command: '\\vec{a}', before: '\\vec{', after: '}', preview: '\\vec{a}', category: 'Accents', name: 'vector arrow' },
  { command: '\\dot{a}', before: '\\dot{', after: '}', preview: '\\dot{a}', category: 'Accents', name: 'dot derivative' },
  { command: '\\ddot{a}', before: '\\ddot{', after: '}', preview: '\\ddot{a}', category: 'Accents', name: 'double dot' },
  { command: '\\tilde{a}', before: '\\tilde{', after: '}', preview: '\\tilde{a}', category: 'Accents', name: 'tilde' },
  { command: '\\widetilde{ab}', before: '\\widetilde{', after: '}', preview: '\\widetilde{ab}', category: 'Accents', name: 'wide tilde' },
  { command: '\\overbrace{ab}^{n}', before: '\\overbrace{', after: '}^{}', preview: '\\overbrace{ab}^{n}', category: 'Accents', name: 'overbrace' },
  { command: '\\underbrace{ab}_{n}', before: '\\underbrace{', after: '}_{}', preview: '\\underbrace{ab}_{n}', category: 'Accents', name: 'underbrace' },
  ...['R', 'N', 'Z', 'Q', 'C', 'P', 'E'].map<PaletteSymbol>((l) => ({
    command: `\\mathbb{${l}}`,
    preview: `\\mathbb{${l}}`,
    category: 'Letters',
    name: `blackboard ${l}`,
    package: 'amssymb',
  })),
  ...['A', 'B', 'F', 'L', 'O'].map<PaletteSymbol>((l) => ({ command: `\\mathcal{${l}}`, preview: `\\mathcal{${l}}`, category: 'Letters', name: `calligraphic ${l}` })),
  { command: '\\mathfrak{g}', preview: '\\mathfrak{g}', category: 'Letters', name: 'fraktur', package: 'amssymb' },
  { command: '\\mathrm{d}', preview: '\\mathrm{d}', category: 'Letters', name: 'upright d differential' },
];

const CATEGORY_ORDER = ['Recent', 'Greek', 'Operators', 'Relations', 'Arrows', 'Big operators', 'Structures', 'Accents', 'Letters', 'Delimiters', 'Dots', 'Functions', 'Misc'];

const renderCache = new Map<string, string>();
function renderGlyph(s: PaletteSymbol): string | null {
  const src = s.preview ?? s.command;
  if (renderCache.has(src)) return renderCache.get(src)!;
  let html: string | null = null;
  try {
    html = katex.renderToString(src, { throwOnError: true, displayMode: false, strict: false });
  } catch {
    html = null;
  }
  renderCache.set(src, html ?? '');
  return html;
}

const Glyph = memo(function Glyph({ s }: { s: PaletteSymbol }) {
  const html = renderGlyph(s);
  if (html) return <span className="pointer-events-none text-[17px] leading-none [&_.katex]:text-[1em]" dangerouslySetInnerHTML={{ __html: html }} />;
  return <span className="pointer-events-none text-[17px] leading-none">{s.glyph ?? s.command.replace(/^\\/, '')}</span>;
});

function SymbolPalette({ api }: { api: PluginAPI }) {
  const all = useMemo<PaletteSymbol[]>(() => {
    const seen = new Set<string>();
    return [...api.latex.symbols(), ...STRUCTURES].filter((s) => (seen.has(s.command) ? false : (seen.add(s.command), true)));
  }, [api]);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    void api.storage.get<string[]>('recent').then((r) => Array.isArray(r) && setRecent(r));
  }, [api]);

  const categories = useMemo(() => {
    const present = new Set(all.map((s) => s.category));
    const ordered = CATEGORY_ORDER.filter((c) => c === 'Recent' || present.has(c));
    for (const c of present) if (!ordered.includes(c)) ordered.push(c);
    return ['All', ...ordered.filter((c) => c !== 'Recent' || recent.length)];
  }, [all, recent.length]);

  const byCommand = useMemo(() => new Map(all.map((s) => [s.command, s])), [all]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\\/, '');
    const match = (s: PaletteSymbol) =>
      !q || s.command.toLowerCase().includes(q) || (s.name ?? '').toLowerCase().includes(q) || s.glyph === query.trim() || s.category.toLowerCase().includes(q);
    const out: { name: string; items: PaletteSymbol[] }[] = [];
    if (!q && (category === 'All' || category === 'Recent') && recent.length) {
      out.push({ name: 'Recent', items: recent.map((c) => byCommand.get(c)).filter(Boolean) as PaletteSymbol[] });
    }
    if (category === 'Recent') return out;
    const cats = category === 'All' ? categories.filter((c) => c !== 'All' && c !== 'Recent') : [category];
    for (const c of cats) {
      const items = all.filter((s) => s.category === c && match(s));
      if (items.length) out.push({ name: c, items });
    }
    return out;
  }, [all, byCommand, categories, category, query, recent]);

  const insert = (s: PaletteSymbol) => {
    const wrap = api.settings.get<boolean>('wrapInMath', false);
    if (s.before != null) {
      api.editor.wrapSelection((wrap ? '$' : '') + s.before, (s.after ?? '') + (wrap ? '$' : ''));
    } else {
      const sel = api.editor.getSelection();
      // Commands without arguments: add a space if the next typed letter would merge into the name.
      const text = /[a-zA-Z]$/.test(s.command) ? `${s.command}${sel?.text ? '' : ' '}` : s.command;
      api.editor.replaceSelection(wrap ? `$${text.trim()}$` : text);
    }
    api.editor.focus();
    const next = [s.command, ...recent.filter((c) => c !== s.command)].slice(0, 24);
    setRecent(next);
    void api.storage.set('recent', next);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title="Symbols" />
      <div className="space-y-2 px-3 pb-2">
        <div className="relative">
          <Input
            inputSize="sm"
            icon={<Search />}
            value={query}
            placeholder="Search symbols (e.g. alpha, ≤, arrow)"
            onChange={(e) => setQuery(e.target.value)}
            className="pr-7"
          />
          {query && (
            <button className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-subtle hover:text-fg" onClick={() => setQuery('')} aria-label="Clear search">
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`h-6 rounded-full px-2 text-[11px] font-medium transition-colors ${
                category === c ? 'bg-accent text-accent-fg' : 'bg-surface-2 text-fg-muted ring-1 ring-inset ring-border hover:text-fg'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {!groups.length && <EmptyState title="No symbols found" description={`Nothing matches “${query}”.`} />}
        {groups.map((g) => (
          <section key={g.name} className="mb-3">
            <h3 className="sticky top-0 z-10 bg-surface py-1 text-[10.5px] font-semibold uppercase tracking-wider text-fg-subtle">{g.name}</h3>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(38px,1fr))] gap-1">
              {g.items.map((s) => (
                <Tooltip
                  key={s.command}
                  side="bottom"
                  content={
                    <span className="font-mono">
                      {s.command}
                      {s.package && <span className="ml-1.5 font-sans opacity-60">({s.package})</span>}
                    </span>
                  }
                >
                  <button
                    onClick={() => insert(s)}
                    aria-label={s.command}
                    className="flex h-[38px] items-center justify-center overflow-hidden rounded-md bg-surface text-fg ring-1 ring-inset ring-border transition-[background,box-shadow,transform] hover:bg-accent-soft hover:ring-accent/40 active:scale-95"
                  >
                    <Glyph s={s} />
                  </button>
                </Tooltip>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

export default definePlugin({
  id: 'org.texit.symbols',
  name: 'Symbol palette',
  version: '1.0.0',
  author: 'TexIt',
  icon: 'sigma',
  description: 'Searchable palette of math symbols, accents and constructs. Click to insert at the cursor.',
  permissions: ['editor', 'ui', 'storage'],
  tags: ['math', 'symbols'],
  settings: [{ key: 'wrapInMath', title: 'Wrap in $…$', description: 'Insert symbols wrapped in inline math delimiters.', type: 'boolean', default: false }],
  activate(api) {
    api.ui.registerPanel({
      id: 'panel',
      title: 'Symbols',
      icon: 'sigma',
      location: 'sidebar',
      render: (el) => mountReact(el, <SymbolPalette api={api} />),
    });
    api.commands.register({ id: 'show', title: 'Show symbol palette', category: 'Insert', icon: 'sigma', run: () => api.ui.showPanel('panel') });
  },
});
