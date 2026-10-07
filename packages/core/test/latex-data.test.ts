import { describe, expect, it } from 'vitest';
import {
  findMathSymbol,
  getLatexCommand,
  getLatexEnvironment,
  getLatexPackage,
  latexCommands,
  latexEnvironments,
  latexPackages,
  mathSymbols,
} from '../src/latex-data';

/** Validate a CodeMirror snippet template: balanced braces, well-formed consecutively numbered placeholders. */
function checkSnippet(snippet: string, consecutive = true): string | null {
  if (/\\[{}]/.test(snippet)) return 'backslash before a brace';
  const nums = new Set<number>();
  // Placeholders must not contain braces.
  const re = /\$\{(\d+)(?::([^{}]*))?\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(snippet))) nums.add(+m[1]);
  const withoutPlaceholders = snippet.replace(re, 'X');
  if (/\$\{/.test(withoutPlaceholders)) return 'malformed placeholder';
  let depth = 0;
  for (const ch of withoutPlaceholders) {
    if (ch === '{') depth++;
    else if (ch === '}' && --depth < 0) return 'unbalanced }';
  }
  if (depth !== 0) return 'unbalanced {';
  if (!consecutive) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) if (sorted[i] !== i + 1) return `placeholders not consecutive: ${sorted.join(',')}`;
  return null;
}

describe('latex-data catalog', () => {
  it('meets the size requirements', () => {
    expect(latexCommands.length).toBeGreaterThanOrEqual(400);
    expect(latexEnvironments.length).toBeGreaterThanOrEqual(70);
    expect(mathSymbols.reduce((n, g) => n + g.symbols.length, 0)).toBeGreaterThanOrEqual(250);
    expect(latexPackages.length).toBeGreaterThanOrEqual(150);
  });

  it('has unique names', () => {
    const uniq = (xs: string[]) => expect(new Set(xs).size).toBe(xs.length);
    uniq(latexCommands.map((c) => c.name));
    uniq(latexEnvironments.map((e) => e.name));
    uniq(latexPackages.map((p) => p.name));
    uniq(mathSymbols.flatMap((g) => g.symbols.map((s) => s.cmd)));
  });

  it('has well-formed command entries and snippets', () => {
    for (const c of latexCommands) {
      expect(c.name, c.name).toMatch(/^[A-Za-z@]+\*?$|^.$/);
      if (c.snippet) {
        expect(c.snippet.startsWith('\\'), c.name).toBe(false);
        expect(checkSnippet(c.snippet), `${c.name}: ${c.snippet}`).toBeNull();
      }
    }
  });

  it('has well-formed environment snippets', () => {
    for (const e of latexEnvironments) {
      for (const part of [e.snippet, e.args]) if (part) expect(checkSnippet(part, false), `${e.name}: ${part}`).toBeNull();
      // args and body share the numbering space when inserted together
      const all = `${e.args ?? ''}${e.snippet ?? ''}`;
      expect(checkSnippet(all), `${e.name} combined`).toBeNull();
    }
  });

  it('has valid math symbols', () => {
    for (const g of mathSymbols) {
      expect(g.symbols.length).toBeGreaterThan(0);
      for (const s of g.symbols) {
        expect(s.cmd.startsWith('\\'), s.cmd).toBe(true);
        expect(s.char.length, s.cmd).toBeGreaterThan(0);
      }
    }
  });

  it('uses correct Unicode for well-known symbols', () => {
    const ch = (c: string) => findMathSymbol(c)?.char;
    expect(ch('\\alpha')).toBe('α');
    expect(ch('epsilon')).toBe('\u03F5');
    expect(ch('\\varepsilon')).toBe('\u03B5');
    expect(ch('\\phi')).toBe('\u03D5');
    expect(ch('\\varphi')).toBe('\u03C6');
    expect(ch('\\infty')).toBe('∞');
    expect(ch('\\rightarrow')).toBe('→');
    expect(ch('\\Leftrightarrow')).toBe('⇔');
    expect(ch('\\leq')).toBe('≤');
    expect(ch('\\sum')).toBe('∑');
    expect(ch('\\hbar')).toBe('ℏ');
    expect(ch('\\nabla')).toBe('∇');
    expect(ch('\\mathbb{R}')).toBe('ℝ');
    expect(ch('\\mathcal{A}')).toBe('\u{1D49C}');
    expect(findMathSymbol('\\mathbb{R}')?.package).toBe('amssymb');
  });

  it('provides lookups with or without backslash', () => {
    expect(getLatexCommand('frac')?.snippet).toBe('frac{${1:num}}{${2:den}}');
    expect(getLatexCommand('\\frac')?.name).toBe('frac');
    expect(getLatexCommand('includegraphics')?.package).toBe('graphicx');
    expect(getLatexCommand('includegraphics')?.snippet).toBe('includegraphics[width=${1:\\linewidth}]{${2:file}}');
    expect(getLatexCommand('alpha')).toMatchObject({ category: 'symbol', symbol: 'α' });
    expect(getLatexCommand('sum')?.symbol).toBe('∑');
    expect(getLatexCommand('cref')?.package).toBe('cleveref');
    expect(getLatexCommand('nope')).toBeUndefined();
    expect(getLatexEnvironment('align')).toMatchObject({ math: true, package: 'amsmath' });
    expect(getLatexEnvironment('figure')?.snippet).toContain('\\centering');
    expect(getLatexEnvironment('tabular')?.args).toBe('{${1:lcr}}');
    expect(getLatexPackage('booktabs')?.detail).toBeTruthy();
  });
});
