/**
 * Editing helpers & LaTeX keymaps: wrap/unwrap formatting, snippets, comment
 * toggling, auto-inserting \end{env} on Enter, the reveal flash.
 */
import { snippet, startCompletion, completionStatus } from '@codemirror/autocomplete';
import { indentUnit } from '@codemirror/language';
import { toggleLineComment } from '@codemirror/commands';
import { EditorSelection, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, keymap, type Command, type DecorationSet, type KeyBinding } from '@codemirror/view';
import { stripComment } from '../projectIndex';
import { shouldAutoTrigger } from './completion';

/** Toggle `before…after` around every selection range (unwraps when already wrapped). */
export function wrapSelection(view: EditorView, before: string, after: string): boolean {
  const { state } = view;
  const tr = state.changeByRange((range) => {
    const text = state.sliceDoc(range.from, range.to);
    // Selection includes the wrapper → unwrap.
    if (text.startsWith(before) && text.endsWith(after) && text.length >= before.length + after.length) {
      const inner = text.slice(before.length, text.length - after.length);
      return {
        changes: { from: range.from, to: range.to, insert: inner },
        range: EditorSelection.range(range.from, range.from + inner.length),
      };
    }
    // Wrapper just outside the selection → unwrap.
    const outerBefore = state.sliceDoc(range.from - before.length, range.from);
    const outerAfter = state.sliceDoc(range.to, range.to + after.length);
    if (outerBefore === before && outerAfter === after) {
      return {
        changes: [
          { from: range.from - before.length, to: range.from },
          { from: range.to, to: range.to + after.length },
        ],
        range: EditorSelection.range(range.from - before.length, range.to - before.length),
      };
    }
    return {
      changes: [
        { from: range.from, insert: before },
        { from: range.to, insert: after },
      ],
      range: range.empty ? EditorSelection.cursor(range.from + before.length) : EditorSelection.range(range.from + before.length, range.to + before.length),
    };
  });
  view.dispatch(state.update(tr, { scrollIntoView: true, userEvent: 'input.format' }));
  return true;
}

export const wrapCommand = (before: string, after: string): Command => (view) => wrapSelection(view, before, after);

/** Insert a CodeMirror snippet template at the selection (replacing it). `${SELECTION}` is replaced by the selected text. */
export function insertSnippet(view: EditorView, template: string): boolean {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  const line = view.state.doc.lineAt(range.from);
  let from = range.from;
  let tpl = template.replace('${SELECTION}', selected.replace(/[{}]/g, (c) => `\\${c}`));
  // Block snippets start on their own line.
  if (/^\\begin/.test(template) && line.text.slice(0, range.from - line.from).trim()) tpl = `\n${tpl}`;
  if (/^\\begin/.test(template) && line.text.slice(0, range.from - line.from).trim() === '' && line.text.trim() === '') from = line.from + (line.text.length - line.text.trimStart().length);
  snippet(tpl)(view, { label: 'snippet' }, from, range.to);
  view.focus();
  return true;
}

export const toggleComment: Command = (view) => toggleLineComment(view);

/** Enter right after `\begin{env}` inserts the matching `\end{env}` (when unbalanced). */
const insertEnvEnd: Command = (view) => {
  const { state } = view;
  if (state.selection.ranges.length !== 1 || !state.selection.main.empty) return false;
  if (state.readOnly) return false;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const before = stripComment(line.text.slice(0, pos - line.from));
  const after = line.text.slice(pos - line.from);
  if (after.trim()) return false;
  const m = /\\begin\s*\{([^}]+)\}(?:\s*\[[^\]]*\])?(?:\s*\{[^}]*\})*\s*$/.exec(before);
  if (!m) return false;
  const name = m[1].trim();
  if (name === 'document' && /\\end\{document\}/.test(state.doc.sliceString(pos))) return false;
  // Balance check: only insert when this environment is not already closed.
  const text = state.doc.toString();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const begins = (text.match(new RegExp(`\\\\begin\\s*\\{${esc}\\}`, 'g')) ?? []).length;
  const ends = (text.match(new RegExp(`\\\\end\\s*\\{${esc}\\}`, 'g')) ?? []).length;
  if (ends >= begins) return false;
  const indent = /^\s*/.exec(line.text)![0];
  const unit = state.facet(indentUnit);
  const insert = `\n${indent}${unit}\n${indent}\\end{${name}}`;
  view.dispatch({
    changes: { from: pos, to: line.to, insert },
    selection: { anchor: pos + 1 + indent.length + unit.length },
    scrollIntoView: true,
    userEvent: 'input',
  });
  return true;
};

/** Open completion after typing `{` in argument positions (\ref{, \cite{, \begin{ …). */
const autoTriggerOnBrace = EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== '{' && text !== ',') return false;
  setTimeout(() => {
    if (completionStatus(view.state) === null && shouldAutoTrigger(view)) startCompletion(view);
  }, 0);
  return false;
});

export const latexKeymap: KeyBinding[] = [
  { key: 'Mod-b', run: wrapCommand('\\textbf{', '}'), preventDefault: true },
  { key: 'Mod-i', run: wrapCommand('\\textit{', '}'), preventDefault: true },
  { key: 'Mod-u', run: wrapCommand('\\underline{', '}'), preventDefault: true },
  { key: 'Mod-Shift-m', run: wrapCommand('$', '$'), preventDefault: true },
  { key: 'Mod-/', run: toggleComment, preventDefault: true },
  { key: 'Enter', run: insertEnvEnd },
];

export function latexEditing(): Extension {
  return [keymap.of(latexKeymap), autoTriggerOnBrace];
}


// ───────────────────────────── reveal flash ─────────────────────────────

export const flashLine = StateEffect.define<number>();
const clearFlash = StateEffect.define<null>();
const flashDeco = Decoration.line({ class: 'cm-flash-line' });

export const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(flashLine)) {
        const line = tr.state.doc.lineAt(Math.min(e.value, tr.state.doc.length));
        deco = Decoration.set([flashDeco.range(line.from)]);
      } else if (e.is(clearFlash)) deco = Decoration.none;
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export function flash(view: EditorView, pos: number) {
  view.dispatch({ effects: flashLine.of(pos) });
  setTimeout(() => {
    try {
      view.dispatch({ effects: clearFlash.of(null) });
    } catch {
      /* view destroyed */
    }
  }, 1500);
}
