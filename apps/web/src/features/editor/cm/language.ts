/**
 * Languages per file type. LaTeX uses the Overleaf-derived Lezer grammar from
 * `codemirror-lang-latex` (excellent structure: sectioning, math, refs, cites,
 * file arguments…) with our own style tags and fold services on top.
 */
import { foldService, indentNodeProp, StreamLanguage, syntaxTree, type StreamParser, type LRLanguage } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import { styleTags, Tag, tags as t } from '@lezer/highlight';
import type { SyntaxNode } from '@lezer/common';
import { latexLanguage } from 'codemirror-lang-latex';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/legacy-modes/mode/python';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { javascript, json } from '@codemirror/legacy-modes/mode/javascript';
import { css } from '@codemirror/legacy-modes/mode/css';
import { r } from '@codemirror/legacy-modes/mode/r';
import { extname, isTexPath } from '@texit/core';

export const latexTags = {
  sectionTitle: Tag.define(t.heading),
  envKeyword: Tag.define(t.keyword),
  optional: Tag.define(),
  path: Tag.define(t.string),
  label: Tag.define(t.labelName),
  cite: Tag.define(),
  math: Tag.define(),
  mathCmd: Tag.define(),
  mathDelim: Tag.define(),
};

const MATH_PARENTS =
  'DollarMath/... ParenMath/... BracketMath/... EquationEnvironment/Content/... EquationArrayEnvironment/Content/...';

export const texLanguage: LRLanguage = latexLanguage.configure({
  props: [
    // Like Overleaf: indent environment bodies, but not section bodies or the document body.
    indentNodeProp.add({
      Content: (cx) => {
        const parent = cx.node.parent?.name ?? '';
        if (parent === 'DocumentEnvironment' || !/Environment$/.test(parent)) return cx.baseIndentFor(cx.node.parent ?? cx.node);
        return cx.baseIndentFor(cx.node.parent!) + cx.unit;
      },
      'Book Part Chapter Section SubSection SubSubSection Paragraph SubParagraph': (cx) => cx.baseIndent,
      DocumentEnvironment: (cx) => cx.baseIndent,
    }),
    styleTags({
      'Begin End': latexTags.envKeyword,
      'LabelCtrlSeq RefCtrlSeq RefStarrableCtrlSeq CiteCtrlSeq CiteStarrableCtrlSeq': t.keyword,
      'TextBoldCtrlSeq TextItalicCtrlSeq EmphasisCtrlSeq UnderlineCtrlSeq TextSmallCapsCtrlSeq TextTeletypeCtrlSeq': t.keyword,
      'TitleCtrlSeq AuthorCtrlSeq DateCtrlSeq BibliographyCtrlSeq BibliographyStyleCtrlSeq': t.keyword,
      'DocumentClassCtrlSeq UsePackageCtrlSeq': t.definitionKeyword,
      'SectioningArgument/...': latexTags.sectionTitle,
      'LabelArgument/... RefArgument/...': latexTags.label,
      'BibKeyArgument/...': latexTags.cite,
      'FilePathArgument/... BareFilePathArgument/... PackageArgument/... DocumentClassArgument/... BibliographyArgument/... BibliographyStyleArgument/... UrlArgument/...':
        latexTags.path,
      'OptionalArgument/...': latexTags.optional,
      [MATH_PARENTS]: latexTags.math,
      Dollar: latexTags.mathDelim,
      'OpenParenCtrlSym CloseParenCtrlSym OpenBracketCtrlSym CloseBracketCtrlSym': latexTags.mathDelim,
      'MathUnknownCommand/CtrlSeq': latexTags.mathCmd,
      MathChar: latexTags.math,
      MathSpecialChar: latexTags.math,
      'Ampersand Tilde': t.operator,
      LineBreak: t.operator,
    }),
  ],
});

// ───────────────────────────── folding ─────────────────────────────

const SECTION_RANK: Record<string, number> = {
  Book: 0,
  Part: 1,
  Chapter: 2,
  Section: 3,
  SubSection: 4,
  SubSubSection: 5,
  Paragraph: 6,
  SubParagraph: 7,
};

/** Fold a sectioning command up to the next heading of the same or higher rank. */
function sectionFold(state: EditorState, lineStart: number, lineEnd: number) {
  const tree = syntaxTree(state);
  let node: SyntaxNode | null = tree.resolveInner(lineStart, 1);
  // The heading line may start with whitespace.
  const text = state.doc.sliceString(lineStart, lineEnd);
  const lead = text.length - text.trimStart().length;
  if (lead) node = tree.resolveInner(lineStart + lead, 1);
  while (node && !(node.name in SECTION_RANK)) node = node.parent;
  if (!node) return null;
  const headingLine = state.doc.lineAt(node.from);
  if (headingLine.from !== lineStart) return null;
  const rank = SECTION_RANK[node.name];
  let end = node.to;
  let walker: SyntaxNode | null = node;
  let found = false;
  while (walker && !found) {
    let sib: SyntaxNode | null = walker.nextSibling;
    while (sib) {
      const r = SECTION_RANK[sib.name];
      if (r !== undefined && r <= rank) {
        end = state.doc.lineAt(sib.from).from - 1;
        found = true;
        break;
      }
      end = sib.to;
      sib = sib.nextSibling;
    }
    if (!found) {
      walker = walker.parent;
      if (walker && (walker.name === 'Content' || walker.name in SECTION_RANK)) continue;
      // Stop at \end{document}.
      if (walker && /Environment$/.test(walker.name)) {
        const endEnv = walker.lastChild;
        if (endEnv?.name === 'EndEnv') end = Math.min(end, state.doc.lineAt(endEnv.from).from - 1);
        break;
      }
    }
  }
  // Don't swallow trailing blank lines.
  while (end > headingLine.to && /\s/.test(state.doc.sliceString(end - 1, end))) end--;
  if (end <= headingLine.to) return null;
  return { from: headingLine.to, to: Math.min(end, state.doc.length) };
}

/** Fold the preamble (\documentclass … \begin{document}). */
function preambleFold(state: EditorState, lineStart: number, lineEnd: number) {
  const line = state.doc.sliceString(lineStart, lineEnd);
  if (!/^\s*\\documentclass\b/.test(line)) return null;
  const text = state.doc.toString();
  const idx = text.indexOf('\\begin{document}', lineEnd);
  if (idx < 0) return null;
  const to = state.doc.lineAt(idx).from - 1;
  return to > lineEnd ? { from: lineEnd, to } : null;
}

/** Fold `% region` … `% endregion` and `% {` … `% }` comment blocks. */
function regionFold(state: EditorState, lineStart: number, lineEnd: number) {
  const line = state.doc.sliceString(lineStart, lineEnd).trim();
  const isRegion = /^%+\s*(#?region\b|\{\s*$)/.test(line);
  if (!isRegion) return null;
  const startNo = state.doc.lineAt(lineStart).number;
  for (let n = startNo + 1; n <= Math.min(state.doc.lines, startNo + 5000); n++) {
    const l = state.doc.line(n);
    if (/^\s*%+\s*(#?endregion\b|\}\s*$)/.test(l.text)) return { from: lineEnd, to: l.from - 1 };
  }
  return null;
}

// ───────────────────────────── BibTeX ─────────────────────────────

interface BibState {
  inEntry: boolean;
  depth: number;
  expectKey: boolean;
  inValue: boolean;
}

const bibtexParser: StreamParser<BibState> = {
  name: 'bibtex',
  startState: () => ({ inEntry: false, depth: 0, expectKey: false, inValue: false }),
  token(stream, state) {
    if (stream.eatSpace()) return null;
    if (!state.inEntry || state.depth === 0) {
      if (stream.match(/^@[a-zA-Z]+/)) {
        state.inEntry = true;
        state.expectKey = true;
        state.depth = 0;
        return 'keyword';
      }
      if (stream.match(/^%.*/)) return 'comment';
      if (stream.eat('{') || stream.eat('(')) {
        state.depth = 1;
        return 'bracket';
      }
      stream.skipToEnd();
      return 'comment';
    }
    if (state.depth === 1) {
      if (state.expectKey) {
        if (stream.match(/^[^,\s}]+/)) {
          state.expectKey = false;
          return 'labelName';
        }
      }
      if (stream.match(/^[a-zA-Z_-][\w-]*(?=\s*=)/)) return 'propertyName';
      if (stream.eat('=')) return 'operator';
      if (stream.eat(',')) {
        state.expectKey = false;
        return 'punctuation';
      }
      if (stream.match(/^\d+/)) return 'number';
      if (stream.eat('"')) {
        while (!stream.eol()) {
          const ch = stream.next();
          if (ch === '\\') stream.next();
          else if (ch === '"') break;
        }
        return 'string';
      }
      if (stream.eat('{')) {
        state.depth++;
        return 'string';
      }
      if (stream.eat('}') || stream.eat(')')) {
        state.depth = 0;
        state.inEntry = false;
        return 'bracket';
      }
      if (stream.match(/^[a-zA-Z]\w*/)) return 'variableName';
      if (stream.match(/^%.*/)) return 'comment';
      stream.next();
      return null;
    }
    // Inside a braced value.
    while (!stream.eol()) {
      const ch = stream.next();
      if (ch === '\\') {
        stream.next();
        continue;
      }
      if (ch === '{') state.depth++;
      else if (ch === '}') {
        state.depth--;
        if (state.depth === 1) return 'string';
      }
    }
    return 'string';
  },
  languageData: { commentTokens: { line: '%' }, closeBrackets: { brackets: ['{', '"'] } },
};

const bibtex = StreamLanguage.define(bibtexParser);

// ───────────────────────────── per file ─────────────────────────────

export type LanguageId = 'latex' | 'bibtex' | 'markdown' | 'plain' | 'code';

export function languageIdFor(path: string): LanguageId {
  const ext = extname(path);
  if (isTexPath(path) || ['sty', 'cls', 'dtx', 'ins', 'clo', 'def', 'tikz', 'pgf', 'bbx', 'cbx', 'lbx', 'rnw', 'rtex', 'fd'].includes(ext)) return 'latex';
  if (ext === 'bib') return 'bibtex';
  if (ext === 'md' || ext === 'markdown') return 'markdown';
  if (legacy[ext]) return 'code';
  return 'plain';
}

const legacy: Record<string, () => Extension> = {
  py: () => StreamLanguage.define(python),
  sage: () => StreamLanguage.define(python),
  lua: () => StreamLanguage.define(lua),
  sh: () => StreamLanguage.define(shell),
  yaml: () => StreamLanguage.define(yaml),
  yml: () => StreamLanguage.define(yaml),
  toml: () => StreamLanguage.define(toml),
  js: () => StreamLanguage.define(javascript),
  ts: () => StreamLanguage.define(javascript),
  json: () => StreamLanguage.define(json),
  css: () => StreamLanguage.define(css),
  r: () => StreamLanguage.define(r),
};

const langCache = new Map<string, Extension>();

/** Base language support for a path (syntax + folding + language data). */
export function languageFor(path: string): Extension {
  const id = languageIdFor(path);
  if (id === 'latex') {
    return [
      texLanguage,
      texLanguage.data.of({ closeBrackets: { brackets: ['{', '[', '('] } }),
      foldService.of(sectionFold),
      foldService.of(preambleFold),
      foldService.of(regionFold),
    ];
  }
  if (id === 'bibtex') return bibtex;
  if (id === 'markdown') return markdown();
  const ext = extname(path);
  if (legacy[ext]) {
    let l = langCache.get(ext);
    if (!l) langCache.set(ext, (l = legacy[ext]()));
    return l;
  }
  return [];
}

export const languageLabels: Record<LanguageId, string> = {
  latex: 'LaTeX',
  bibtex: 'BibTeX',
  markdown: 'Markdown',
  plain: 'Plain text',
  code: 'Code',
};
