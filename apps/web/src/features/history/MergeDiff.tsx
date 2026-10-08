/** Read-only CodeMirror diff (side-by-side MergeView or unified view). */
import { useEffect, useRef } from 'react';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';
import { latex } from 'codemirror-lang-latex';
import { extname } from '@texit/core';
import { t as tr, useLocale } from '@/lib/i18n';
import './i18n';

const theme = EditorView.theme({
  '&': { fontSize: '12.5px', backgroundColor: 'var(--tx-surface)', color: 'var(--tx-fg)', height: '100%' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6' },
  '.cm-gutters': { backgroundColor: 'var(--tx-surface)', color: 'var(--tx-fg-subtle)', borderRight: '1px solid var(--tx-border)' },
  '.cm-content': { caretColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-changedLine': { backgroundColor: 'color-mix(in srgb, var(--tx-success) 9%, transparent) !important' },
  '.cm-changedText': { background: 'color-mix(in srgb, var(--tx-success) 26%, transparent) !important' },
  '.cm-deletedChunk': { backgroundColor: 'color-mix(in srgb, var(--tx-danger) 9%, transparent) !important' },
  '.cm-deletedChunk .cm-deletedText, .cm-deletedText': { background: 'color-mix(in srgb, var(--tx-danger) 26%, transparent) !important' },
  // `cm-merge-a` is set on the editor element itself (the side showing the old text).
  '&.cm-merge-a .cm-changedLine, .cm-deletedLine': { backgroundColor: 'color-mix(in srgb, var(--tx-danger) 9%, transparent) !important' },
  '&.cm-merge-a .cm-changedText': { background: 'color-mix(in srgb, var(--tx-danger) 26%, transparent) !important' },
  '.cm-changeGutter': { width: '3px', paddingLeft: '0' },
  '.cm-changedLineGutter': { background: 'var(--tx-success)' },
  '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': { background: 'var(--tx-danger)' },
  '.cm-collapsedLines': {
    background: 'var(--tx-surface-2)',
    color: 'var(--tx-fg-subtle)',
    fontFamily: 'var(--font-sans)',
    fontSize: '11px',
    padding: '3px 12px',
    borderTop: '1px solid var(--tx-border)',
    borderBottom: '1px solid var(--tx-border)',
  },
  '.cm-collapsedLines:hover': { color: 'var(--tx-fg)' },
});

const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.function(t.variableName), t.tagName], color: 'var(--tx-accent)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--tx-fg-subtle)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string), t.attributeValue], color: 'var(--tx-success)' },
  { tag: [t.number, t.bool, t.atom], color: 'var(--tx-warning)' },
  { tag: [t.heading, t.strong], fontWeight: '600' },
  { tag: [t.emphasis], fontStyle: 'italic' },
  { tag: [t.bracket, t.brace, t.squareBracket, t.punctuation], color: 'var(--tx-fg-muted)' },
  { tag: [t.processingInstruction, t.meta, t.labelName], color: 'var(--tx-info)' },
]);

function language(path: string): Extension[] {
  if (['tex', 'sty', 'cls', 'ltx', 'latex', 'bbx', 'cbx'].includes(extname(path))) {
    try {
      return [latex({ autoCloseTags: false, enableLinting: false, enableTooltips: false, enableAutocomplete: false, autoCloseBrackets: false })];
    } catch {
      return [];
    }
  }
  return [];
}

function base(path: string): Extension[] {
  return [
    // @codemirror/merge UI strings ("$ unchanged lines", …) in the UI language.
    EditorState.phrases.of({
      '$ unchanged lines': tr('history.unchangedLines'),
      'Revert this chunk': tr('history.revertChunk'),
      Accept: tr('history.accept'),
      Reject: tr('history.reject'),
    }),
    lineNumbers(),
    EditorView.lineWrapping,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    theme,
    syntaxHighlighting(highlight),
    ...language(path),
  ];
}

export function MergeDiff({ path, before, after, mode }: { path: string; before: string; after: string; mode: 'split' | 'unified' }) {
  const ref = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  useEffect(() => {
    const parent = ref.current;
    if (!parent) return;
    const collapse = { margin: 3, minSize: 6 };
    if (mode === 'split') {
      const mv = new MergeView({
        a: { doc: before, extensions: base(path) },
        b: { doc: after, extensions: base(path) },
        parent,
        gutter: true,
        highlightChanges: true,
        collapseUnchanged: collapse,
      });
      mv.dom.style.height = '100%';
      return () => mv.destroy();
    }
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: after,
        extensions: [...base(path), unifiedMergeView({ original: before, mergeControls: false, gutter: true, highlightChanges: true, collapseUnchanged: collapse, syntaxHighlightDeletions: true })],
      }),
    });
    return () => view.destroy();
  }, [path, before, after, mode, locale]);
  return <div ref={ref} className="h-full min-h-0 overflow-auto [&_.cm-mergeView]:h-full [&_.cm-mergeViewEditors]:min-h-full" />;
}
