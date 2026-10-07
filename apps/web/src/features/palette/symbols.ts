/** Outline symbols (sections, frames, labels) for the palette's `@` mode. */
import { analyzeLatex } from '@texit/core';

export interface PaletteSymbol {
  kind: 'part' | 'chapter' | 'section' | 'subsection' | 'subsubsection' | 'paragraph' | 'frame' | 'label' | string;
  title: string;
  line: number;
  /** 0 = top level; used for indentation. */
  depth: number;
}

const levelKinds: Record<string, number> = { part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5, subparagraph: 6 };

function cleanTitle(s: string): string {
  return s
    .replace(/\\(?:textbf|textit|emph|texttt|textsc|mathrm|mathbf|text)\s*\{([^{}]*)\}/g, '$1')
    .replace(/\\[a-zA-Z]+\*?/g, '')
    .replace(/[{}~]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Regex fallback used while `analyzeLatex` is unavailable or throws. */
function scan(source: string): PaletteSymbol[] {
  const out: PaletteSymbol[] = [];
  const lines = source.split('\n');
  const sec = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  const frame = /\\begin\{frame\}(?:<[^>]*>)?(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}|\\frametitle\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  const label = /\\label\s*\{([^}]*)\}/g;
  lines.forEach((raw, i) => {
    const line = raw.replace(/(^|[^\\])%.*$/, '$1');
    for (const m of line.matchAll(sec)) out.push({ kind: m[1]!, title: cleanTitle(m[2]!), line: i + 1, depth: levelKinds[m[1]!] ?? 2 });
    for (const m of line.matchAll(frame)) out.push({ kind: 'frame', title: cleanTitle(m[1] ?? m[2] ?? ''), line: i + 1, depth: 2 });
    for (const m of line.matchAll(label)) out.push({ kind: 'label', title: m[1]!, line: i + 1, depth: 9 });
  });
  return out;
}

export function extractSymbols(source: string): PaletteSymbol[] {
  let symbols: PaletteSymbol[] | null = null;
  try {
    const a = analyzeLatex(source);
    symbols = [
      ...a.outline.map((o) => ({
        kind: o.kind,
        title: cleanTitle(o.title) || o.title,
        line: o.line,
        depth: o.level < 0 ? 2 : o.level,
      })),
      ...a.labels.map((l) => ({ kind: 'label', title: l.name, line: l.line, depth: 9 })),
    ];
  } catch {
    symbols = null;
  }
  const list = symbols ?? scan(source);
  list.sort((a, b) => a.line - b.line || (a.kind === 'label' ? 1 : -1));
  // Normalise depth so the shallowest heading is 0.
  const headings = list.filter((s) => s.kind !== 'label');
  const min = headings.length ? Math.min(...headings.map((s) => s.depth)) : 0;
  return list.map((s) => ({ ...s, depth: s.kind === 'label' ? 0 : Math.max(0, s.depth - min) }));
}
