/**
 * Math helpers: locating math regions in the syntax tree, a subtle background
 * tint for inline/display math, and KaTeX rendering (with project macros).
 */
import { syntaxTree } from '@codemirror/language';
import type { EditorState, Range } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';
import katex from 'katex';
import { getProjectIndex } from '../projectIndex';

export interface MathRegion {
  from: number;
  to: number;
  /** Range of the math source (without delimiters / \begin…\end). */
  contentFrom: number;
  contentTo: number;
  display: boolean;
  /** Environment name for environment-based math. */
  env?: string;
}

const INLINE = new Set(['DollarMath', 'ParenMath']);
const DISPLAY = new Set(['BracketMath', 'EquationEnvironment', 'EquationArrayEnvironment']);

function envNameOf(state: EditorState, node: SyntaxNode): string | undefined {
  const begin = node.getChild('BeginEnv');
  const group = begin?.getChild('EnvNameGroup');
  if (!group) return undefined;
  return state.doc.sliceString(group.from + 1, group.to - 1).trim();
}

function regionOf(state: EditorState, node: SyntaxNode): MathRegion | null {
  const name = node.name;
  if (name === 'DollarMath') {
    const text = state.doc.sliceString(node.from, Math.min(node.to, node.from + 2));
    const display = text === '$$';
    const d = display ? 2 : 1;
    return { from: node.from, to: node.to, contentFrom: node.from + d, contentTo: Math.max(node.from + d, node.to - d), display };
  }
  if (name === 'ParenMath' || name === 'BracketMath') {
    return { from: node.from, to: node.to, contentFrom: node.from + 2, contentTo: Math.max(node.from + 2, node.to - 2), display: name === 'BracketMath' };
  }
  if (name === 'EquationEnvironment' || name === 'EquationArrayEnvironment') {
    const content = node.getChild('Content');
    const begin = node.getChild('BeginEnv');
    const end = node.getChild('EndEnv');
    const env = envNameOf(state, node);
    const cf = content?.from ?? begin?.to ?? node.from;
    const ct = content?.to ?? end?.from ?? node.to;
    return { from: node.from, to: node.to, contentFrom: cf, contentTo: ct, display: true, env };
  }
  return null;
}

/** The outermost math region containing `pos` (or null). */
export function mathRegionAt(state: EditorState, pos: number, side: -1 | 0 | 1 = 0): MathRegion | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side);
  let found: SyntaxNode | null = null;
  for (; node; node = node.parent) {
    if (INLINE.has(node.name) || DISPLAY.has(node.name)) found = node;
  }
  return found ? regionOf(state, found) : null;
}

export function isInMath(state: EditorState, pos: number): boolean {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
  for (; node; node = node.parent) {
    if (node.name === 'Math' || INLINE.has(node.name) || DISPLAY.has(node.name)) {
      // Text inside \text{…} is not math.
      return true;
    }
    if (node.name === 'MathTextCommand') return false;
  }
  return false;
}

/** Background tint for math regions (inline: mark, display: whole lines). */
export const mathHighlighter = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const ranges: Range<Decoration>[] = [];
      const { state } = view;
      const seenLines = new Set<number>();
      for (const { from, to } of view.visibleRanges) {
        syntaxTree(state).iterate({
          from,
          to,
          enter: (node) => {
            const isInline = INLINE.has(node.name);
            const isDisplay = DISPLAY.has(node.name);
            if (!isInline && !isDisplay) return;
            const region = regionOf(state, node.node);
            if (!region) return false;
            if (!region.display) {
              if (region.to > region.from) ranges.push(inlineMark.range(region.from, region.to));
              return false;
            }
            const first = state.doc.lineAt(region.from);
            const last = state.doc.lineAt(region.to);
            // Inline-looking display math on a line with other text: just mark it.
            if (first.number === last.number && (first.text.trim().length > region.to - region.from + 2)) {
              ranges.push(inlineMark.range(region.from, region.to));
              return false;
            }
            for (let n = first.number; n <= last.number; n++) {
              if (seenLines.has(n)) continue;
              seenLines.add(n);
              const line = state.doc.line(n);
              ranges.push(blockLine.range(line.from));
            }
            return false;
          },
        });
      }
      return Decoration.set(ranges, true);
    }
  },
  { decorations: (v) => v.decorations },
);

const inlineMark = Decoration.mark({ class: 'cm-math-inline' });
const blockLine = Decoration.line({ class: 'cm-math-block' });

// ───────────────────────────── KaTeX ─────────────────────────────

/** Remove commands KaTeX doesn't understand (labels, numbering tweaks…). */
export function cleanMath(src: string): string {
  return src
    .replace(/(^|[^\\])%.*$/gm, '$1')
    .replace(/\\label\s*\{[^}]*\}/g, '')
    .replace(/\\(nonumber|notag|displaybreak(\[\d\])?|allowdisplaybreaks|intertext\{[^}]*\})/g, '')
    .replace(/\\(?:qedhere|centering)\b/g, '')
    .trim();
}

const ALIGN_LIKE = /^(align|flalign|alignat|eqnarray|IEEEeqnarray|split|gather|multline)\*?$/;

let macroCache: { version: number; macros: Record<string, string> } | null = null;

export function projectMacros(): Record<string, string> {
  const idx = getProjectIndex();
  if (!idx) return {};
  if (macroCache?.version === idx.version) return { ...macroCache.macros };
  let macros: Record<string, string> = {};
  try {
    macros = idx.katexMacros();
  } catch {
    macros = {};
  }
  macroCache = { version: idx.version, macros };
  return { ...macros };
}

/** Render LaTeX math into `el`. Returns false when KaTeX could not render it. */
export function renderMath(el: HTMLElement, tex: string, display: boolean, env?: string): boolean {
  const body = cleanMath(tex);
  const attempts: string[] = [];
  if (env && !/^(equation|displaymath|math)\*?$/.test(env)) {
    // Unnumbered forms first: previews shouldn't show (misleading) equation numbers.
    if (/^(gather|multline)\*?$/.test(env)) attempts.push(`\\begin{gathered}${body}\\end{gathered}`);
    else if (ALIGN_LIKE.test(env)) attempts.push(`\\begin{aligned}${body}\\end{aligned}`);
    attempts.push(`\\begin{${env}}${body}\\end{${env}}`);
  }
  attempts.push(body);
  const macros = projectMacros();
  for (const src of attempts) {
    try {
      katex.render(src || '\\,', el, {
        displayMode: display,
        throwOnError: true,
        strict: 'ignore',
        trust: false,
        macros: { ...macros },
        maxExpand: 500,
        output: 'html',
      });
      return true;
    } catch {
      // try the next form
    }
  }
  try {
    katex.render(body, el, { displayMode: display, throwOnError: false, strict: 'ignore', macros: { ...macros }, output: 'html' });
  } catch {
    el.textContent = body;
  }
  return false;
}

export function mathSource(state: EditorState, region: MathRegion): string {
  return state.doc.sliceString(region.contentFrom, region.contentTo);
}

