/**
 * Ghost-text completions: after typing pauses (~400 ms) ask the fast model for a short
 * continuation and show it greyed out at the cursor. Tab accepts, Esc dismisses; any
 * keystroke cancels the in-flight request.
 */
import { completionStatus } from '@codemirror/autocomplete';
import { Prec, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type ViewUpdate } from '@codemirror/view';
import type { ModelRef } from '@texit/ai';
import { getEditorBridge } from '@/services/editor';
import { loadAi } from '../sdk';
import { completionModelRef, providerReady, resolveModel, type ResolvedModel } from '../runtime';
import { findProvider, useAiSettings } from '../store';
import { inlineEditField } from './inlineEdit';

interface Ghost {
  pos: number;
  text: string;
}

const setGhost = StateEffect.define<Ghost | null>();

const ghostField = StateField.define<Ghost | null>({
  create: () => null,
  update(g, tr) {
    for (const e of tr.effects) if (e.is(setGhost)) return e.value;
    if (!g) return g;
    if (tr.docChanged) {
      // Typing the ghost's next characters keeps the rest of the suggestion.
      if (tr.isUserEvent('input.type')) {
        let inserted = '';
        let at = -1;
        tr.changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
          if (fromA === toA) {
            at = fromA;
            inserted += text.toString();
          } else at = -2;
        });
        if (at === g.pos && inserted && g.text.startsWith(inserted) && g.text.length > inserted.length) {
          return { pos: g.pos + inserted.length, text: g.text.slice(inserted.length) };
        }
        return null;
      }
      if (tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('undo') || tr.isUserEvent('redo')) return null;
      return { ...g, pos: tr.changes.mapPos(g.pos) };
    }
    if (tr.selection && tr.selection.main.head !== g.pos) return null;
    return g;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (g) =>
      g ? Decoration.set([Decoration.widget({ widget: new GhostWidget(g.text), side: 1 }).range(g.pos)]) : Decoration.none,
    ),
});

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(o: GhostWidget) {
    return o.text === this.text;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-ai-ghost';
    span.textContent = this.text;
    const hint = document.createElement('span');
    hint.className = 'cm-ai-ghost-hint';
    hint.textContent = 'Tab';
    span.appendChild(hint);
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

let modelCache: { key: string; model: ResolvedModel } | null = null;
async function fastModel(ref: ModelRef) {
  const key = `${ref.providerId}::${ref.modelId}`;
  if (modelCache?.key !== key) modelCache = { key, model: await resolveModel(ref) };
  return modelCache.model.model;
}

function enabled(): ModelRef | null {
  const s = useAiSettings.getState();
  if (!s.inlineCompletions) return null;
  const ref = completionModelRef();
  return ref && providerReady(findProvider(ref.providerId)) ? ref : null;
}

const DELAY = 400;

const ghostPlugin = ViewPlugin.fromClass(
  class {
    timer: ReturnType<typeof setTimeout> | null = null;
    abort: AbortController | null = null;
    failures = 0;

    constructor(readonly view: EditorView) {}

    update(u: ViewUpdate) {
      const typed = u.transactions.some((tr) => tr.isUserEvent('input.type'));
      if (u.docChanged || u.selectionSet) this.cancel();
      if (typed && !u.state.field(ghostField)) this.schedule();
    }

    cancel() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = null;
      this.abort?.abort();
      this.abort = null;
    }

    schedule() {
      if (!enabled() || this.failures >= 3) return;
      this.timer = setTimeout(() => void this.request(), DELAY);
    }

    async request() {
      this.timer = null;
      const view = this.view;
      const state = view.state;
      const ref = enabled();
      if (!ref || !view.hasFocus) return;
      const sel = state.selection;
      if (sel.ranges.length > 1 || !sel.main.empty) return;
      if (completionStatus(state) !== null) return;
      if (state.field(inlineEditField, false)) return;
      const pos = sel.main.head;
      const line = state.doc.lineAt(pos);
      const lineText = line.text;
      if (/^\s*%/.test(lineText)) return; // comment-only line
      const after = lineText.slice(pos - line.from);
      if (/^\w/.test(after)) return; // mid-word
      const before = lineText.slice(0, pos - line.from);
      if (!before.trim() && line.number > 1 && !state.doc.line(line.number - 1).text.trim()) return; // blank paragraph start

      const ac = new AbortController();
      this.abort = ac;
      const docVersion = state.doc;
      try {
        const [ai, model] = await Promise.all([loadAi(), fastModel(ref)]);
        if (!model || ac.signal.aborted) return;
        const text = await ai.inlineComplete({
          model,
          prefix: state.doc.sliceString(Math.max(0, pos - 4000), pos),
          suffix: state.doc.sliceString(pos, Math.min(state.doc.length, pos + 1500)),
          path: getEditorBridge()?.getSelection()?.path,
          signal: ac.signal,
        });
        this.failures = 0;
        if (ac.signal.aborted || !text || view.state.doc !== docVersion || view.state.selection.main.head !== pos) return;
        view.dispatch({ effects: setGhost.of({ pos, text }) });
      } catch (err) {
        if (!ac.signal.aborted) {
          this.failures++;
          if (import.meta.env.DEV) console.debug('[texit ai] inline completion failed', err);
        }
      } finally {
        if (this.abort === ac) this.abort = null;
      }
    }

    destroy() {
      this.cancel();
    }
  },
);

// Reset the failure counter when settings change (e.g. a new key).
useAiSettings.subscribe(() => {
  modelCache = null;
});

function acceptGhost(view: EditorView): boolean {
  const g = view.state.field(ghostField, false);
  if (!g) return false;
  view.dispatch({
    changes: { from: g.pos, insert: g.text },
    selection: { anchor: g.pos + g.text.length },
    effects: setGhost.of(null),
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  return true;
}

const theme = EditorView.baseTheme({
  '.cm-ai-ghost': { color: 'var(--tx-fg-subtle, #999)', opacity: '0.75', whiteSpace: 'pre-wrap', pointerEvents: 'none' },
  '.cm-ai-ghost-hint': {
    marginLeft: '6px',
    padding: '0 4px',
    borderRadius: '4px',
    border: '1px solid var(--tx-border, rgb(0 0 0 / .1))',
    fontFamily: 'var(--font-sans, ui-sans-serif)',
    fontSize: '10px',
    verticalAlign: '1px',
    opacity: '0.8',
  },
});

export function ghostTextExtension(): Extension {
  return [
    ghostField,
    ghostPlugin,
    theme,
    Prec.highest(
      keymap.of([
        { key: 'Tab', run: acceptGhost },
        {
          key: 'Escape',
          run: (view) => {
            if (!view.state.field(ghostField, false)) return false;
            view.dispatch({ effects: setGhost.of(null) });
            return true;
          },
        },
      ]),
    ),
  ];
}
