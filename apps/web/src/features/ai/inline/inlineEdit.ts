/**
 * Cmd/Ctrl-K inline edit: a floating prompt at the selection (or cursor line) that streams
 * `rewriteSelection` output as a live diff (old text struck/red, new text green).
 * Accept: Tab / Enter (when finished) · Reject: Esc · Retry.
 */
import { Prec, StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, type DecorationSet } from '@codemirror/view';
import { getEditorBridge } from '@/services/editor';
import { loadAi } from '../sdk';
import { chatModelRef, resolveModel } from '../runtime';

type Phase = 'prompt' | 'streaming' | 'done' | 'error';

interface Session {
  id: number;
  from: number;
  to: number;
  original: string;
  instruction: string;
  proposal: string;
  phase: Phase;
  error?: string;
}

const setSession = StateEffect.define<Session | null>();
const patchSession = StateEffect.define<Partial<Session>>();

export const inlineEditField = StateField.define<Session | null>({
  create: () => null,
  update(v, tr) {
    if (v && tr.docChanged) {
      const from = tr.changes.mapPos(v.from, 1);
      const to = Math.max(from, tr.changes.mapPos(v.to, -1));
      v = { ...v, from, to };
    }
    for (const e of tr.effects) {
      if (e.is(setSession)) v = e.value;
      else if (e.is(patchSession) && v) v = { ...v, ...e.value };
    }
    return v;
  },
});

// ─────────────────────────── prompt widget (plain DOM) ───────────────────────────

const QUICK = [
  ['Fix grammar', 'Fix grammar, spelling and punctuation; change as little as possible.'],
  ['More formal', 'Rewrite in a more formal, academic register.'],
  ['More concise', 'Make this more concise without losing content.'],
  ['To English', 'Translate into English, keeping LaTeX intact.'],
] as const;

class Controller {
  dom: HTMLElement;
  input: HTMLInputElement;
  status: HTMLElement;
  err: HTMLElement;
  chips: HTMLElement;
  buttons: Record<string, HTMLButtonElement> = {};
  lastPhase: Phase | null = null;
  abort: AbortController | null = null;

  constructor(
    readonly id: number,
    private view: EditorView,
  ) {
    const el = (tag: string, cls: string, text?: string) => {
      const e = document.createElement(tag);
      e.className = cls;
      if (text) e.textContent = text;
      return e;
    };
    this.dom = el('div', 'cm-ai-edit');
    this.dom.setAttribute('data-ai-edit', '');
    const row = el('div', 'cm-ai-edit-row');
    row.appendChild(el('span', 'cm-ai-edit-icon', '✦'));
    this.input = document.createElement('input');
    this.input.className = 'cm-ai-edit-input';
    this.input.spellcheck = false;
    row.appendChild(this.input);
    this.status = el('span', 'cm-ai-edit-status');
    row.appendChild(this.status);
    const mk = (act: string, label: string, hint?: string, primary = false) => {
      const b = el('button', `cm-ai-edit-btn${primary ? ' cm-ai-edit-btn-primary' : ''}`) as HTMLButtonElement;
      b.type = 'button';
      b.textContent = label;
      if (hint) {
        const k = el('kbd', 'cm-ai-edit-kbd', hint);
        b.appendChild(k);
      }
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => this.act(act));
      this.buttons[act] = b;
      row.appendChild(b);
    };
    mk('generate', 'Generate', '↵', true);
    mk('stop', 'Stop');
    mk('accept', 'Accept', 'Tab', true);
    mk('retry', 'Retry');
    mk('reject', 'Reject', 'Esc');
    this.dom.appendChild(row);
    this.chips = el('div', 'cm-ai-edit-chips');
    for (const [label, instruction] of QUICK) {
      const c = el('button', 'cm-ai-edit-chip', label) as HTMLButtonElement;
      c.type = 'button';
      c.addEventListener('mousedown', (e) => e.preventDefault());
      c.addEventListener('click', () => {
        this.input.value = instruction;
        this.act('generate');
      });
      this.chips.appendChild(c);
    }
    this.dom.appendChild(this.chips);
    this.err = el('div', 'cm-ai-edit-error');
    this.dom.appendChild(this.err);

    this.input.addEventListener('keydown', (e) => {
      const s = this.session();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.act('reject');
      } else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (s?.phase === 'done' && this.input.value.trim() === s.instruction) this.act('accept');
        else this.act('generate');
      } else if (e.key === 'Tab' && s?.phase === 'done') {
        e.preventDefault();
        this.act('accept');
      }
    });
  }

  setView(view: EditorView) {
    this.view = view;
  }

  session(): Session | null {
    const s = this.view.state.field(inlineEditField, false);
    return s && s.id === this.id ? s : null;
  }

  sync(s: Session) {
    const placeholder = s.from === s.to ? 'Generate at cursor… (e.g. “a table of the results”)' : 'Edit selection… (e.g. “make this more formal”)';
    if (this.input.placeholder !== placeholder) this.input.placeholder = placeholder;
    if (s.phase === this.lastPhase && s.phase !== 'error') return;
    this.lastPhase = s.phase;
    const show = (k: string, on: boolean) => (this.buttons[k].style.display = on ? '' : 'none');
    show('generate', s.phase === 'prompt' || s.phase === 'error');
    show('stop', s.phase === 'streaming');
    show('accept', s.phase === 'done');
    show('retry', s.phase === 'done' || s.phase === 'error');
    show('reject', true);
    this.chips.style.display = s.phase === 'prompt' && s.from !== s.to ? '' : 'none';
    this.status.textContent = s.phase === 'streaming' ? 'Writing…' : '';
    this.status.classList.toggle('cm-ai-edit-busy', s.phase === 'streaming');
    this.err.textContent = s.phase === 'error' ? (s.error ?? 'Something went wrong') : '';
    this.err.style.display = s.phase === 'error' ? '' : 'none';
    this.input.disabled = s.phase === 'streaming';
  }

  act(action: string) {
    const view = this.view;
    const s = this.session();
    if (!s) return;
    switch (action) {
      case 'generate':
      case 'retry': {
        const instruction = (action === 'retry' ? s.instruction : this.input.value).trim();
        if (!instruction) {
          this.input.focus();
          return;
        }
        void this.run(instruction);
        return;
      }
      case 'stop':
        this.abort?.abort();
        return;
      case 'accept':
        if (s.phase !== 'done') return;
        view.dispatch({
          changes: { from: s.from, to: s.to, insert: s.proposal },
          effects: setSession.of(null),
          selection: { anchor: s.from + s.proposal.length },
          userEvent: 'input.ai',
          scrollIntoView: true,
        });
        controllers.delete(this.id);
        view.focus();
        return;
      case 'reject':
        this.abort?.abort();
        view.dispatch({ effects: setSession.of(null) });
        controllers.delete(this.id);
        view.focus();
        return;
    }
  }

  async run(instruction: string) {
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;
    const view = this.view;
    const patch = (p: Partial<Session>) => {
      if (this.session()) view.dispatch({ effects: patchSession.of(p) });
    };
    patch({ instruction, phase: 'streaming', proposal: '', error: undefined });
    let pending: string | null = null;
    let raf = 0;
    try {
      const [ai, resolved] = await Promise.all([loadAi(), resolveModel(chatModelRef())]);
      if (!resolved.model) throw new Error('Inline edits need an API or local model (CLI agents are chat-only).');
      const s = this.session();
      if (!s || ac.signal.aborted) return;
      const doc = view.state.doc;
      const text = await ai.rewriteSelection({
        model: resolved.model,
        instruction,
        selection: s.original,
        before: doc.sliceString(Math.max(0, s.from - 2500), s.from),
        after: doc.sliceString(s.to, Math.min(doc.length, s.to + 1500)),
        path: getEditorBridge()?.getSelection()?.path,
        signal: ac.signal,
        onDelta: (_d, all) => {
          pending = all;
          if (!raf)
            raf = requestAnimationFrame(() => {
              raf = 0;
              if (pending != null) patch({ proposal: pending });
            });
        },
      });
      cancelAnimationFrame(raf);
      if (ac.signal.aborted) patch({ phase: text ? 'done' : 'prompt', proposal: text });
      else patch({ phase: 'done', proposal: text });
      this.input.value = instruction;
      this.input.focus();
    } catch (err) {
      cancelAnimationFrame(raf);
      patch({ phase: 'error', error: (err as Error)?.message ?? String(err) });
    } finally {
      if (this.abort === ac) this.abort = null;
    }
  }
}

const controllers = new Map<number, Controller>();

class PromptWidget extends WidgetType {
  constructor(readonly id: number) {
    super();
  }
  eq(other: PromptWidget) {
    return other.id === this.id;
  }
  toDOM(view: EditorView) {
    let c = controllers.get(this.id);
    if (!c) {
      c = new Controller(this.id, view);
      controllers.set(this.id, c);
    } else c.setView(view);
    return c.dom;
  }
  ignoreEvent() {
    return true;
  }
  destroy() {
    /* controller lives until accept/reject */
  }
}

class InsertWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly streaming: boolean,
  ) {
    super();
  }
  eq(o: InsertWidget) {
    return o.text === this.text && o.streaming === this.streaming;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = `cm-ai-ins${this.streaming ? ' cm-ai-ins-streaming' : ''}`;
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const s = state.field(inlineEditField, false);
  if (!s) return Decoration.none;
  const decos = [];
  const lineStart = state.doc.lineAt(s.from).from;
  decos.push(Decoration.widget({ widget: new PromptWidget(s.id), block: true, side: -1 }).range(lineStart));
  const showDiff = s.phase === 'streaming' || s.phase === 'done' || (s.phase === 'error' && s.proposal);
  if (s.to > s.from) decos.push(Decoration.mark({ class: showDiff ? 'cm-ai-del' : 'cm-ai-target' }).range(s.from, s.to));
  if (showDiff && s.proposal) decos.push(Decoration.widget({ widget: new InsertWidget(s.proposal, s.phase === 'streaming'), side: 1 }).range(s.to));
  return Decoration.set(decos, true);
}

const decorationField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update: (deco, tr) => (tr.docChanged || tr.effects.length || tr.startState.field(inlineEditField, false) !== tr.state.field(inlineEditField, false) ? buildDecorations(tr.state) : deco),
  provide: (f) => EditorView.decorations.from(f),
});

const syncPlugin = ViewPlugin.define(() => ({
  update(u) {
    const s = u.state.field(inlineEditField, false);
    if (s) controllers.get(s.id)?.sync(s);
  },
}));

let seq = 0;

/** Open (or focus) the inline edit prompt in a view. */
export function openInlineEdit(view: EditorView): boolean {
  const existing = view.state.field(inlineEditField, false);
  if (existing === undefined) return false;
  if (existing) {
    controllers.get(existing.id)?.input.focus();
    return true;
  }
  const sel = view.state.selection.main;
  const id = ++seq;
  const session: Session = {
    id,
    from: sel.from,
    to: sel.to,
    original: view.state.sliceDoc(sel.from, sel.to),
    instruction: '',
    proposal: '',
    phase: 'prompt',
  };
  view.dispatch({ effects: setSession.of(session), scrollIntoView: true });
  requestAnimationFrame(() => {
    const c = controllers.get(id);
    if (c) {
      c.sync(session);
      c.input.focus();
    }
  });
  return true;
}

function currentController(view: EditorView): Controller | null {
  const s = view.state.field(inlineEditField, false);
  return s ? (controllers.get(s.id) ?? null) : null;
}

const theme = EditorView.baseTheme({
  '.cm-ai-edit': {
    margin: '6px 0 4px',
    padding: '6px',
    borderRadius: '10px',
    border: '1px solid color-mix(in srgb, var(--tx-accent, #5b5bf0) 45%, transparent)',
    background: 'var(--tx-elevated, #fff)',
    boxShadow: '0 6px 20px -8px rgb(0 0 0 / .25), 0 0 0 3px color-mix(in srgb, var(--tx-accent, #5b5bf0) 12%, transparent)',
    fontFamily: 'var(--font-sans, ui-sans-serif, system-ui)',
    fontSize: '12.5px',
    maxWidth: '720px',
    cursor: 'default',
  },
  '.cm-ai-edit-row': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px' },
  '.cm-ai-edit-icon': { color: 'var(--tx-accent, #5b5bf0)', padding: '0 2px 0 4px', fontSize: '13px' },
  '.cm-ai-edit-input': {
    flex: '1',
    minWidth: '120px',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    color: 'var(--tx-fg, inherit)',
    font: 'inherit',
    padding: '4px 2px',
  },
  '.cm-ai-edit-status': { color: 'var(--tx-fg-subtle, #888)', fontSize: '11.5px' },
  '.cm-ai-edit-busy': { animation: 'cm-ai-pulse 1.2s ease-in-out infinite' },
  '@keyframes cm-ai-pulse': { '0%, 100%': { opacity: '.45' }, '50%': { opacity: '1' } },
  '.cm-ai-edit-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    height: '24px',
    padding: '0 8px',
    borderRadius: '6px',
    border: '1px solid var(--tx-border, rgb(0 0 0 / .1))',
    background: 'var(--tx-surface, #fff)',
    color: 'var(--tx-fg, inherit)',
    font: 'inherit',
    fontSize: '11.5px',
    fontWeight: '500',
    whiteSpace: 'nowrap',
  },
  '.cm-ai-edit-btn:hover': { background: 'var(--tx-hover, rgb(0 0 0 / .05))' },
  '.cm-ai-edit-btn-primary': { background: 'var(--tx-accent, #5b5bf0)', borderColor: 'transparent', color: '#fff' },
  '.cm-ai-edit-btn-primary:hover': { background: 'var(--tx-accent-hover, #4a4ae0)' },
  '.cm-ai-edit-kbd': { fontFamily: 'inherit', fontSize: '10px', opacity: '.7' },
  '.cm-ai-edit-chips': { display: 'flex', flexWrap: 'wrap', gap: '4px', padding: '6px 2px 0 24px' },
  '.cm-ai-edit-chip': {
    height: '22px',
    padding: '0 8px',
    borderRadius: '999px',
    border: '1px solid var(--tx-border, rgb(0 0 0 / .1))',
    background: 'transparent',
    color: 'var(--tx-fg-muted, #555)',
    font: 'inherit',
    fontSize: '11px',
  },
  '.cm-ai-edit-chip:hover': { color: 'var(--tx-fg, #000)', borderColor: 'var(--tx-border-strong, rgb(0 0 0 / .2))' },
  '.cm-ai-edit-error': { color: 'var(--tx-danger, #e5484d)', fontSize: '11.5px', padding: '4px 4px 0 24px' },
  '.cm-ai-target': { background: 'color-mix(in srgb, var(--tx-accent, #5b5bf0) 14%, transparent)', borderRadius: '2px' },
  '.cm-ai-del': {
    textDecoration: 'line-through',
    textDecorationColor: 'color-mix(in srgb, var(--tx-danger, #e5484d) 70%, transparent)',
    background: 'var(--tx-danger-soft, rgb(229 72 77 / .1))',
    color: 'var(--tx-fg-subtle, #888)',
  },
  '.cm-ai-ins': {
    background: 'var(--tx-success-soft, rgb(22 163 74 / .1))',
    color: 'var(--tx-fg, inherit)',
    whiteSpace: 'pre-wrap',
    borderRadius: '2px',
    boxShadow: 'inset 0 -1px 0 color-mix(in srgb, var(--tx-success, #16a34a) 50%, transparent)',
  },
  '.cm-ai-ins-streaming::after': { content: '"▍"', color: 'var(--tx-accent, #5b5bf0)', animation: 'cm-ai-pulse 1s steps(2) infinite' },
});

export function inlineEditExtension(): Extension {
  return [
    inlineEditField,
    decorationField,
    syncPlugin,
    theme,
    Prec.high(
      keymap.of([
        { key: 'Mod-k', preventDefault: true, run: openInlineEdit },
        {
          key: 'Escape',
          run: (view) => {
            const c = currentController(view);
            if (!c) return false;
            c.act('reject');
            return true;
          },
        },
        {
          key: 'Tab',
          run: (view) => {
            const s = view.state.field(inlineEditField, false);
            if (!s || s.phase !== 'done') return false;
            controllers.get(s.id)?.act('accept');
            return true;
          },
        },
      ]),
    ),
  ];
}
