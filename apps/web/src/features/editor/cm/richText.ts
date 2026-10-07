/**
 * Rich text mode (Texifier-like, never hides source): headings rendered larger
 * and bolder, \textbf/\emph/… styled, formatting command names dimmed, list
 * bullets accented.
 */
import { syntaxTree } from '@codemirror/language';
import type { Range } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
import type { SyntaxNodeRef } from '@lezer/common';

const headingLevel: Record<string, number> = {
  BookCtrlSeq: 0,
  PartCtrlSeq: 0,
  ChapterCtrlSeq: 1,
  SectionCtrlSeq: 2,
  SubSectionCtrlSeq: 3,
  SubSubSectionCtrlSeq: 4,
  ParagraphCtrlSeq: 5,
  SubParagraphCtrlSeq: 6,
};

const styled: Record<string, string> = {
  TextBoldCommand: 'cm-rich-bold',
  TextItalicCommand: 'cm-rich-italic',
  EmphasisCommand: 'cm-rich-italic',
  UnderlineCommand: 'cm-rich-underline',
  StrikeOutCommand: 'cm-rich-strike',
  TextSmallCapsCommand: 'cm-rich-sc',
  TextTeletypeCommand: 'cm-rich-mono',
};

const dim = Decoration.mark({ class: 'cm-rich-dim' });
const marks: Record<string, Decoration> = Object.fromEntries(Object.values(styled).map((c) => [c, Decoration.mark({ class: c })]));
const lines = Array.from({ length: 7 }, (_, i) => Decoration.line({ class: `cm-rich-h${i}` }));
const item = Decoration.mark({ class: 'cm-rich-item' });
const link = Decoration.mark({ class: 'cm-rich-link' });
const title = Decoration.mark({ class: 'cm-rich-title' });

function argRange(node: SyntaxNodeRef): { from: number; to: number } | null {
  const n = node.node;
  const arg = n.getChild('TextArgument') ?? n.getChild('SectioningArgument') ?? n.getChild('ShortTextArgument');
  if (!arg) return null;
  const from = arg.from + 1;
  const to = arg.lastChild?.name === 'CloseBrace' ? arg.to - 1 : arg.to;
  return to > from ? { from, to } : null;
}

function build(view: EditorView): DecorationSet {
  const out: Range<Decoration>[] = [];
  const { state } = view;
  const headingLines = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter(node) {
        const name = node.name;
        if (name in headingLevel) {
          const line = state.doc.lineAt(node.from);
          if (!headingLines.has(line.from) && state.doc.sliceString(line.from, node.from).trim() === '') {
            headingLines.add(line.from);
            out.push(lines[headingLevel[name]].range(line.from));
          }
          out.push(dim.range(node.from, node.to));
          return;
        }
        const cls = styled[name];
        if (cls) {
          const n = node.node;
          const ctrl = n.firstChild;
          if (ctrl && ctrl.to > ctrl.from) out.push(dim.range(ctrl.from, ctrl.to));
          const arg = argRange(node);
          if (arg) out.push(marks[cls].range(arg.from, arg.to));
          return;
        }
        if (name === 'ItemCtrlSeq') {
          out.push(item.range(node.from, node.to));
          return;
        }
        if (name === 'HrefCommand' || name === 'UrlCommand') {
          const n = node.node;
          const ctrl = n.firstChild;
          if (ctrl) out.push(dim.range(ctrl.from, ctrl.to));
          return;
        }
        if (name === 'UrlArgument') {
          if (node.to - node.from > 2) out.push(link.range(node.from + 1, node.to - 1));
          return false;
        }
        if (name === 'Title') {
          const arg = argRange(node);
          if (arg) out.push(title.range(arg.from, arg.to));
          return;
        }
        return;
      },
    });
  }
  return Decoration.set(out, true);
}

export const richText = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState)) this.decorations = build(u.view);
    }
  },
  { decorations: (v) => v.decorations },
);
