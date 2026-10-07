/**
 * The editor controller owns ONE CodeMirror EditorView for the whole app. Each
 * open text file gets its own cached EditorState (undo history via a per-file
 * Y.UndoManager, selection, scroll) bound to the file's Y.Text with yCollab.
 * Settings, theme, awareness and contributed extensions are applied live
 * through compartments.
 */
import * as Y from 'yjs';
import { Compartment, EditorSelection, EditorState, Prec, type Extension, type StateEffect } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  scrollPastEnd,
  tooltips,
  type ViewUpdate,
} from '@codemirror/view';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from '@codemirror/language';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { acceptCompletion, autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { lintKeymap } from '@codemirror/lint';
import { yCollab, yUndoManagerKeymap, ySyncAnnotation } from 'y-codemirror.next';
import { vim, getCM } from '@replit/codemirror-vim';
import { emacs } from '@replit/codemirror-emacs';
import type { ProjectDoc } from '@texit/core';
import { getAwareness } from '@/services/collab';
import { getContributedExtensions, selectionChanged, type EditorSelectionInfo } from '@/services/editor';
import { useSettings, useResolvedTheme, type EditorSettings } from '@/state/settings';
import { useWorkspace, type RevealRequest } from '@/state/workspace';
import { promptDialog } from '@/ui';
import { Emitter } from '@/lib/emitter';
import { isMac } from '@/lib/platform';
import { editorTheme, fontTheme, highlightStyle } from './theme';
import { languageFor, languageIdFor, texLanguage, type LanguageId } from './language';
import { latexCompletionSource } from './completion';
import { hoverExtensions } from './hover';
import { mathHighlighter } from './math';
import { diagnosticsExtension, refreshDiagnostics } from './diagnostics';
import { richText } from './richText';
import { flash, flashField, latexEditing } from './editing';
import { searchExtension } from './searchPanel';
import { fileInfo } from './fileInfo';

interface Session {
  id: string;
  path: string;
  lang: LanguageId;
  ytext: Y.Text;
  undo: Y.UndoManager;
  state: EditorState;
  scroll: StateEffect<unknown> | null;
  lastUsed: number;
}

const MAX_SESSIONS = 40;

// LaTeX completion is attached as language data so contributed sources (languageData) merge with it.
const latexCompletionData = texLanguage.data.of({ autocomplete: latexCompletionSource });

export const gotoLineCommand = (view: EditorView) => {
  void promptDialog({
    title: 'Go to line',
    message: `Line number (1–${view.state.doc.lines}), optionally followed by :column.`,
    placeholder: `${view.state.doc.lineAt(view.state.selection.main.head).number}`,
    validate: (v) => (/^\s*\d+(\s*[:,]\s*\d+)?\s*$/.test(v) ? null : 'Enter a line number, e.g. 42 or 42:7'),
  }).then((v) => {
    if (!v) return;
    const [l, c] = v.split(/[:,]/).map((x) => parseInt(x.trim(), 10));
    const line = view.state.doc.line(Math.max(1, Math.min(l, view.state.doc.lines)));
    const pos = line.from + Math.max(0, Math.min((c || 1) - 1, line.length));
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: 'center' }) });
    flash(view, pos);
    view.focus();
  });
  return true;
};

export class EditorController {
  view: EditorView | null = null;
  project: ProjectDoc | null = null;
  activeId: string | null = null;
  private sessions = new Map<string, Session>();
  private pendingReveal: RevealRequest | null = null;
  private cursorTimer: ReturnType<typeof setTimeout> | undefined;
  private vimCleanup: (() => void) | null = null;
  /** Fires on vim mode changes ('normal' | 'insert' | 'visual' | 'replace'). */
  readonly vimMode = new Emitter<string>();
  vimModeValue = 'normal';
  /** Fires after the active state changed (file switch / reset). */
  readonly activeChanged = new Emitter<string | null>();

  private c = {
    file: new Compartment(),
    language: new Compartment(),
    theme: new Compartment(),
    font: new Compartment(),
    wrap: new Compartment(),
    gutters: new Compartment(),
    fold: new Compartment(),
    activeLine: new Compartment(),
    tabSize: new Compartment(),
    attrs: new Compartment(),
    keymapMode: new Compartment(),
    complete: new Compartment(),
    brackets: new Compartment(),
    lint: new Compartment(),
    rich: new Compartment(),
    hover: new Compartment(),
    collab: new Compartment(),
    contributed: new Compartment(),
  };

  // ───────────────────────── view ─────────────────────────

  ensureView(): EditorView {
    if (this.view) return this.view;
    this.view = new EditorView({
      state: EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true), editorTheme(useResolvedTheme.getState().theme === 'dark')] }),
    });
    this.view.dom.classList.add('tx-editor');
    return this.view;
  }

  private settings(): EditorSettings {
    return useSettings.getState().editor;
  }

  // ───────────────────────── compartment contents ─────────────────────────

  private cfg = {
    file: (s: Session) => fileInfo.of({ id: s.id, path: s.path }),
    language: (s: Session) => [languageFor(s.path), s.lang === 'latex' ? [latexCompletionData, latexEditing(), mathHighlighter] : []],
    theme: () => editorTheme(useResolvedTheme.getState().theme === 'dark'),
    font: () => {
      const e = this.settings();
      return fontTheme({ fontFamily: e.fontFamily, fontSize: e.fontSize, lineHeight: e.lineHeight });
    },
    wrap: () => (this.settings().wordWrap ? EditorView.lineWrapping : []),
    gutters: () => (this.settings().lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    fold: () =>
      this.settings().foldGutter
        ? foldGutter({
            markerDOM: (open) => {
              const span = document.createElement('span');
              span.className = `cm-fold-marker ${open ? 'cm-fold-open' : 'cm-fold-closed'}`;
              span.innerHTML = open
                ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>'
                : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';
              return span;
            },
          })
        : [],
    activeLine: () => (this.settings().highlightActiveLine ? highlightActiveLine() : []),
    tabSize: () => {
      const n = Math.max(1, Math.min(8, this.settings().tabSize || 2));
      return [EditorState.tabSize.of(n), indentUnit.of(' '.repeat(n))];
    },
    attrs: () =>
      EditorView.contentAttributes.of({
        spellcheck: this.settings().spellcheck ? 'true' : 'false',
        autocorrect: 'off',
        autocapitalize: 'off',
        lang: this.project?.getMeta().language?.split('-')[0] ?? 'en',
      }),
    keymapMode: () => {
      const k = this.settings().keymap;
      if (k === 'vim') return Prec.highest(vim({ status: true }));
      if (k === 'emacs') return Prec.highest(emacs());
      return [];
    },
    complete: () =>
      this.settings().autocomplete
        ? autocompletion({
            activateOnTyping: true,
            icons: true,
            closeOnBlur: true,
            maxRenderedOptions: 80,
            defaultKeymap: true,
            tooltipClass: () => 'cm-tx-autocomplete',
            optionClass: () => 'cm-tx-option',
          })
        : autocompletion({ activateOnTyping: false }),
    brackets: () => (this.settings().autoCloseBrackets ? closeBrackets() : []),
    lint: () => diagnosticsExtension({ liveLint: this.settings().liveLint }),
    rich: (s: Session) => (this.settings().richText && s.lang === 'latex' ? richText : []),
    hover: (s: Session) => (s.lang === 'latex' ? hoverExtensions({ mathPreview: this.settings().mathPreview }) : []),
    collab: (s: Session) => yCollab(s.ytext, getAwareness(), { undoManager: s.undo }),
    contributed: () => getContributedExtensions(),
  };

  private extensionsFor(s: Session): Extension {
    const c = this.c;
    return [
      c.file.of(this.cfg.file(s)),
      c.language.of(this.cfg.language(s)),
      c.theme.of(this.cfg.theme()),
      c.font.of(this.cfg.font()),
      c.wrap.of(this.cfg.wrap()),
      c.gutters.of(this.cfg.gutters()),
      c.fold.of(this.cfg.fold()),
      c.activeLine.of(this.cfg.activeLine()),
      c.tabSize.of(this.cfg.tabSize()),
      c.attrs.of(this.cfg.attrs()),
      c.keymapMode.of(this.cfg.keymapMode()),
      c.complete.of(this.cfg.complete()),
      c.brackets.of(this.cfg.brackets()),
      c.lint.of(this.cfg.lint()),
      c.rich.of(this.cfg.rich(s)),
      c.hover.of(this.cfg.hover(s)),
      c.collab.of(this.cfg.collab(s)),
      c.contributed.of(this.cfg.contributed()),
      // static
      tooltips({ parent: document.body, position: 'fixed' }),
      highlightSpecialChars(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(highlightStyle),
      bracketMatching(),
      rectangularSelection(),
      crosshairCursor(),
      highlightSelectionMatches({ minSelectionLength: 2 }),
      searchExtension(),
      flashField,
      scrollPastEnd(),
      Prec.high(keymap.of(yUndoManagerKeymap)),
      keymap.of([
        { key: 'Tab', run: acceptCompletion },
        ...closeBracketsKeymap,
        // Mod-Enter is the global compile shortcut — never swallow it.
        ...defaultKeymap.filter((k) => k.key !== 'Mod-Enter' && k.key !== 'Mod-i' && k.key !== 'Mod-l'),
        ...searchKeymap.filter((k) => k.key !== 'Mod-Alt-g'),
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        { key: 'Ctrl-g', run: gotoLineCommand, preventDefault: true },
        { key: 'Mod-Alt-g', run: gotoLineCommand, preventDefault: true },
        indentWithTab,
      ]),
      EditorView.updateListener.of((u) => this.onUpdate(u)),
      // ⌘/Ctrl-click → show this location in the PDF (forward SyncTeX).
      EditorView.domEventHandlers({
        mousedown: (e, view) => {
          if (e.button !== 0 || !(isMac ? e.metaKey : e.ctrlKey) || e.altKey || e.shiftKey) return false;
          const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
          const info = view.state.facet(fileInfo);
          if (pos == null || !info) return false;
          e.preventDefault();
          view.dispatch({ selection: { anchor: pos } });
          useWorkspace.getState().syncPdfTo(info.path, view.state.doc.lineAt(pos).number);
          return true;
        },
      }),
    ];
  }

  // ───────────────────────── sessions ─────────────────────────

  private createSession(id: string): Session | null {
    const project = this.project;
    if (!project) return null;
    const ytext = project.getYText(id);
    if (!ytext) return null;
    const path = project.getPath(id);
    const undo = new Y.UndoManager(ytext, { captureTimeout: 500 });
    const s: Session = { id, path, lang: languageIdFor(path), ytext, undo, state: null as unknown as EditorState, scroll: null, lastUsed: Date.now() };
    s.state = EditorState.create({ doc: ytext.toString(), extensions: this.extensionsFor(s) });
    this.sessions.set(id, s);
    this.evict();
    return s;
  }

  private evict() {
    if (this.sessions.size <= MAX_SESSIONS) return;
    const open = new Set(useWorkspace.getState().openTabs);
    const candidates = [...this.sessions.values()].filter((s) => s.id !== this.activeId && !open.has(s.id)).sort((a, b) => a.lastUsed - b.lastUsed);
    for (const s of candidates.slice(0, this.sessions.size - MAX_SESSIONS)) this.dropSession(s.id);
  }

  private dropSession(id: string) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    s.undo.destroy();
  }

  /** The Y.UndoManager of a file (created on demand) — used by project-wide replace so edits are undoable. */
  ensureUndoManager(id: string): Y.UndoManager | null {
    const s = this.sessions.get(id) ?? this.createSession(id);
    return s?.undo ?? null;
  }

  /** Bring a detached cached state up to date with its Y.Text (edits that happened while hidden). */
  private syncDetached(s: Session) {
    const text = s.ytext.toString();
    const cur = s.state.doc.toString();
    if (text === cur) return;
    let start = 0;
    const min = Math.min(text.length, cur.length);
    while (start < min && text.charCodeAt(start) === cur.charCodeAt(start)) start++;
    let endA = cur.length;
    let endB = text.length;
    while (endA > start && endB > start && cur.charCodeAt(endA - 1) === text.charCodeAt(endB - 1)) {
      endA--;
      endB--;
    }
    s.state = s.state.update({ changes: { from: start, to: endA, insert: text.slice(start, endB) } }).state;
  }

  setProject(project: ProjectDoc | null) {
    if (project === this.project) return;
    for (const id of [...this.sessions.keys()]) this.dropSession(id);
    this.project = project;
    this.activeId = null;
    this.pendingReveal = null;
    if (this.view) this.view.setState(EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true), this.cfg.theme()] }));
    this.activeChanged.emit(null);
  }

  /** Show a text file in the editor. Returns false if the file has no text content. */
  showFile(id: string): boolean {
    const view = this.ensureView();
    if (!this.project) return false;
    let s = this.sessions.get(id);
    const ytext = this.project.getYText(id);
    if (!ytext) return false;
    if (s && s.ytext !== ytext) {
      this.dropSession(id);
      s = undefined;
    }
    if (this.activeId === id && s && view.state.facet(fileInfo)?.id === id) {
      // Already showing this file: never reset the view (would drop focus, completion, IME…).
      s.state = view.state;
      this.flushReveal();
      return true;
    }
    this.saveActive();
    if (!s) s = this.createSession(id) ?? undefined;
    if (!s) return false;
    // Renamed (path / language changed) while cached.
    const path = this.project.getPath(id);
    if (path !== s.path) {
      s.path = path;
      s.lang = languageIdFor(path);
      s.state = s.state.update({ effects: this.allEffects(s) }).state;
    }
    this.syncDetached(s);
    s.lastUsed = Date.now();
    this.activeId = id;
    view.setState(s.state);
    s.state = view.state;
    if (s.scroll) view.dispatch({ effects: s.scroll });
    this.bindVim();
    this.publishFileToAwareness();
    this.emitSelection();
    this.activeChanged.emit(id);
    this.flushReveal();
    return true;
  }

  /** Detach the current file (e.g. an image tab became active). */
  hide() {
    this.saveActive();
    const wasActive = this.activeId !== null;
    this.activeId = null;
    // Detach the file state so its plugins/tooltips (mounted on <body>) go away.
    if (wasActive && this.view) this.view.setState(EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true), this.cfg.theme()] }));
    this.publishFileToAwareness();
    this.activeChanged.emit(null);
  }

  private saveActive() {
    if (!this.view || !this.activeId) return;
    const s = this.sessions.get(this.activeId);
    if (s && this.view.state.facet(fileInfo)?.id === s.id) {
      s.state = this.view.state;
      try {
        s.scroll = this.view.scrollSnapshot();
      } catch {
        s.scroll = null;
      }
    }
  }

  /** Called when the project tree changed: drop deleted files, track renames. */
  onTreeChanged() {
    if (!this.project) return;
    for (const [id, s] of this.sessions) {
      if (!this.project.has(id) || this.project.getYText(id) !== s.ytext) {
        if (id === this.activeId) this.activeId = null;
        this.dropSession(id);
        continue;
      }
      const path = this.project.getPath(id);
      if (path !== s.path) {
        s.path = path;
        s.lang = languageIdFor(path);
        if (id === this.activeId && this.view) this.view.dispatch({ effects: this.allEffects(s) });
        else s.state = s.state.update({ effects: this.allEffects(s) }).state;
      }
    }
  }

  // ───────────────────────── reconfiguration ─────────────────────────

  private allEffects(s: Session): StateEffect<unknown>[] {
    const c = this.c;
    const cfg = this.cfg;
    return [
      c.file.reconfigure(cfg.file(s)),
      c.language.reconfigure(cfg.language(s)),
      c.theme.reconfigure(cfg.theme()),
      c.font.reconfigure(cfg.font()),
      c.wrap.reconfigure(cfg.wrap()),
      c.gutters.reconfigure(cfg.gutters()),
      c.fold.reconfigure(cfg.fold()),
      c.activeLine.reconfigure(cfg.activeLine()),
      c.tabSize.reconfigure(cfg.tabSize()),
      c.attrs.reconfigure(cfg.attrs()),
      c.keymapMode.reconfigure(cfg.keymapMode()),
      c.complete.reconfigure(cfg.complete()),
      c.brackets.reconfigure(cfg.brackets()),
      c.lint.reconfigure(cfg.lint()),
      c.rich.reconfigure(cfg.rich(s)),
      c.hover.reconfigure(cfg.hover(s)),
    ];
  }

  /** Apply `make(session)` effects to the active view and every cached state. */
  private reconfigure(make: (s: Session) => StateEffect<unknown>[]) {
    for (const s of this.sessions.values()) {
      const effects = make(s);
      if (!effects.length) continue;
      if (s.id === this.activeId && this.view && this.view.state.facet(fileInfo)?.id === s.id) {
        this.view.dispatch({ effects });
        s.state = this.view.state;
      } else {
        s.state = s.state.update({ effects }).state;
      }
    }
  }

  applySettings(next: EditorSettings, prev: EditorSettings) {
    const c = this.c;
    const cfg = this.cfg;
    const changed = (keys: (keyof EditorSettings)[]) => keys.some((k) => next[k] !== prev[k]);
    this.reconfigure((s) => {
      const e: StateEffect<unknown>[] = [];
      if (changed(['fontFamily', 'fontSize', 'lineHeight'])) e.push(c.font.reconfigure(cfg.font()));
      if (changed(['wordWrap'])) e.push(c.wrap.reconfigure(cfg.wrap()));
      if (changed(['lineNumbers'])) e.push(c.gutters.reconfigure(cfg.gutters()));
      if (changed(['foldGutter'])) e.push(c.fold.reconfigure(cfg.fold()));
      if (changed(['highlightActiveLine'])) e.push(c.activeLine.reconfigure(cfg.activeLine()));
      if (changed(['tabSize'])) e.push(c.tabSize.reconfigure(cfg.tabSize()));
      if (changed(['spellcheck'])) e.push(c.attrs.reconfigure(cfg.attrs()));
      if (changed(['keymap'])) e.push(c.keymapMode.reconfigure(cfg.keymapMode()));
      if (changed(['autocomplete'])) e.push(c.complete.reconfigure(cfg.complete()));
      if (changed(['autoCloseBrackets'])) e.push(c.brackets.reconfigure(cfg.brackets()));
      if (changed(['liveLint'])) e.push(c.lint.reconfigure(cfg.lint()));
      if (changed(['richText'])) e.push(c.rich.reconfigure(cfg.rich(s)));
      if (changed(['mathPreview'])) e.push(c.hover.reconfigure(cfg.hover(s)));
      return e;
    });
    if (next.keymap !== prev.keymap) this.bindVim();
  }

  applyTheme() {
    this.reconfigure(() => [this.c.theme.reconfigure(this.cfg.theme())]);
    if (this.view && !this.activeId) this.view.setState(EditorState.create({ doc: '', extensions: [EditorState.readOnly.of(true), this.cfg.theme()] }));
  }

  applyAwareness() {
    this.reconfigure((s) => [this.c.collab.reconfigure(this.cfg.collab(s))]);
    this.publishFileToAwareness();
  }

  applyContributed() {
    this.reconfigure(() => [this.c.contributed.reconfigure(this.cfg.contributed())]);
  }

  refreshDiagnostics() {
    if (this.view && this.activeId) this.view.dispatch({ effects: refreshDiagnostics.of(null) });
  }

  // ───────────────────────── vim mode tracking ─────────────────────────

  private bindVim() {
    this.vimCleanup?.();
    this.vimCleanup = null;
    if (!this.view || this.settings().keymap !== 'vim') return;
    // The vim plugin is (re)created with the state; wait a tick for it.
    queueMicrotask(() => {
      const cm = this.view ? getCM(this.view) : null;
      if (!cm) return;
      const handler = (e: { mode: string; subMode?: string }) => {
        this.vimModeValue = e.subMode ? `${e.mode} ${e.subMode}` : e.mode;
        this.vimMode.emit(this.vimModeValue);
      };
      cm.on('vim-mode-change', handler);
      this.vimModeValue = 'normal';
      this.vimMode.emit('normal');
      this.vimCleanup = () => cm.off('vim-mode-change', handler);
    });
  }

  // ───────────────────────── updates ─────────────────────────

  private onUpdate(u: ViewUpdate) {
    if (u.view !== this.view) return;
    const info = u.state.facet(fileInfo);
    if (!info || info.id !== this.activeId) return;
    if (u.docChanged) {
      // Editing a preview tab pins it.
      const local = u.transactions.some((tr) => tr.docChanged && tr.annotation(ySyncAnnotation) === undefined);
      if (local && useWorkspace.getState().previewTabId === info.id) useWorkspace.getState().pinTab(info.id);
    }
    if (u.selectionSet || u.docChanged) {
      clearTimeout(this.cursorTimer);
      this.cursorTimer = setTimeout(() => this.emitSelection(), 60);
    }
  }

  getSelectionInfo(): EditorSelectionInfo | null {
    const view = this.view;
    if (!view || !this.activeId) return null;
    const info = view.state.facet(fileInfo);
    if (!info) return null;
    const sel = view.state.selection.main;
    const line = view.state.doc.lineAt(sel.head);
    return { fileId: info.id, path: info.path, from: sel.from, to: sel.to, text: view.state.sliceDoc(sel.from, sel.to), line: line.number, column: sel.head - line.from + 1 };
  }

  private emitSelection() {
    const info = this.getSelectionInfo();
    selectionChanged.emit(info);
    if (info) {
      const sel = this.view!.state.selection;
      const selected = sel.ranges.reduce((n, r) => n + (r.to - r.from), 0);
      const cur = useWorkspace.getState().cursor;
      if (cur.line !== info.line || cur.column !== info.column || cur.selected !== selected) useWorkspace.getState().setCursor({ line: info.line, column: info.column, selected });
    }
  }

  // ───────────────────────── reveal ─────────────────────────

  reveal(req: RevealRequest) {
    this.pendingReveal = req;
    if (this.activeId === req.fileId && this.view) this.flushReveal();
  }

  private flushReveal() {
    const req = this.pendingReveal;
    const view = this.view;
    if (!req || !view || req.fileId !== this.activeId) return;
    this.pendingReveal = null;
    const doc = view.state.doc;
    const lineNo = Math.max(1, Math.min(req.line || 1, doc.lines));
    const line = doc.line(lineNo);
    const anchor = line.from + Math.max(0, Math.min((req.column ?? 1) - 1, line.length));
    const sel = req.select
      ? EditorSelection.range(Math.min(req.select.from, doc.length), Math.min(req.select.to, doc.length))
      : EditorSelection.cursor(anchor);
    // Defer so the newly attached state is measured first.
    requestAnimationFrame(() => {
      if (this.view !== view || this.activeId !== req.fileId) return;
      view.dispatch({ selection: sel, effects: EditorView.scrollIntoView(sel, { y: 'center' }), userEvent: 'select.reveal' });
      flash(view, sel.from);
      const wantFocus = () => {
        const active = document.activeElement;
        return !active || active === document.body || !(active.closest('[data-keep-focus]') || active.closest('[role="dialog"]'));
      };
      if (wantFocus()) view.focus();
      // Dialogs (command palette) restore focus on close — take it back afterwards.
      setTimeout(() => {
        if (this.view === view && this.activeId === req.fileId && !view.hasFocus && wantFocus()) view.focus();
      }, 120);
    });
  }

  // ───────────────────────── awareness ─────────────────────────

  publishFileToAwareness() {
    const a = getAwareness();
    if (!a) return;
    const local = a.getLocalState() as { user?: Record<string, unknown> } | null;
    const s = useSettings.getState();
    const user = local?.user ?? { name: s.userName, color: s.userColor, colorLight: `${s.userColor}33` };
    if (user.fileId === (this.activeId ?? undefined)) return;
    a.setLocalStateField('user', { ...user, fileId: this.activeId ?? undefined });
  }

  // ───────────────────────── bridge helpers ─────────────────────────

  activeView(): EditorView | null {
    return this.view && this.activeId ? this.view : null;
  }
}

/**
 * Singleton. In dev, a hot update of this module (or anything it imports) must
 * not create a second controller bound to stale states → force a full reload.
 */
export const editorController = new EditorController();
if (import.meta.hot) import.meta.hot.accept(() => location.reload());
