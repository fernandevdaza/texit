/**
 * In-file find & replace panel styled like the rest of the app (replaces
 * CodeMirror's default search form). Supports case / whole-word / regex,
 * match counter, replace one / all, and keyboard shortcuts.
 */
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  replaceAll,
  replaceNext,
  search,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view';
import { isMac } from '@/lib/platform';

const icons = {
  chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 7-7 7 7"/><path d="M12 19V5"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="m19 12-7 7-7-7"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  replace: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4c0-1.1.9-2 2-2"/><path d="M20 2c1.1 0 2 .9 2 2"/><path d="M22 8c0 1.1-.9 2-2 2"/><path d="M16 10c-1.1 0-2-.9-2-2"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5c0-1.7 1.3-3 3-3h1"/><rect width="8" height="8" x="2" y="14" rx="2"/></svg>',
  replaceAll: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14a2 2 0 0 1 2-2"/><path d="M14 4a2 2 0 0 1 2-2"/><path d="M16 10a2 2 0 0 1-2-2"/><path d="M20 14a2 2 0 0 1 2 2"/><path d="M20 2a2 2 0 0 1 2 2"/><path d="M22 8a2 2 0 0 1-2 2"/><path d="m3 7 3 3 3-3"/><path d="M6 10V5a 3 3 0 0 1 3-3h1"/><rect x="2" y="14" width="8" height="8" rx="2"/></svg>',
};

const btnCls =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 [&_svg]:size-3.5';
const toggleCls =
  'inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[11px] font-semibold text-fg-subtle transition-colors hover:bg-hover hover:text-fg aria-pressed:bg-accent-soft aria-pressed:text-accent';
const inputWrapCls =
  'flex h-7 min-w-0 flex-1 items-center gap-0.5 rounded-md border border-border bg-surface-2/60 pl-2 pr-1 transition-[border,box-shadow] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15';
const inputCls = 'h-full min-w-0 flex-1 bg-transparent font-mono text-[12px] text-fg outline-none placeholder:font-sans placeholder:text-fg-subtle';

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html !== undefined) e.innerHTML = html;
  return e;
}

class TexitSearchPanel implements Panel {
  dom: HTMLElement;
  top = true;
  private query: SearchQuery;
  private searchInput: HTMLInputElement;
  private replaceInput: HTMLInputElement;
  private caseBtn: HTMLButtonElement;
  private wordBtn: HTMLButtonElement;
  private reBtn: HTMLButtonElement;
  private count: HTMLElement;
  private replaceRow: HTMLElement;
  private expandBtn: HTMLButtonElement;
  private showReplace = false;
  private countTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private view: EditorView) {
    this.query = getSearchQuery(view.state);
    this.dom = h('div', { class: 'cm-tx-search flex items-start gap-1 px-2 py-1.5 font-sans', role: 'search' });

    this.expandBtn = h('button', { class: `${btnCls} mt-0.5 transition-transform`, title: 'Toggle replace', 'aria-label': 'Toggle replace', type: 'button' }, icons.chevron);
    this.expandBtn.onclick = () => this.setReplaceVisible(!this.showReplace, true);

    const rows = h('div', { class: 'flex min-w-0 flex-1 flex-col gap-1' });

    // Find row
    const findRow = h('div', { class: 'flex items-center gap-1' });
    const findWrap = h('div', { class: inputWrapCls });
    this.searchInput = h('input', { class: inputCls, placeholder: 'Find', 'main-field': 'true', 'aria-label': 'Find', spellcheck: 'false', autocomplete: 'off' });
    this.caseBtn = h('button', { class: toggleCls, title: 'Match case (Alt+C)', 'aria-pressed': 'false', type: 'button' }, 'Aa');
    this.wordBtn = h('button', { class: toggleCls, title: 'Whole word (Alt+W)', 'aria-pressed': 'false', type: 'button' }, '<span class="underline decoration-1 underline-offset-2">ab</span>');
    this.reBtn = h('button', { class: toggleCls, title: 'Regular expression (Alt+R)', 'aria-pressed': 'false', type: 'button' }, '.*');
    findWrap.append(this.searchInput, this.caseBtn, this.wordBtn, this.reBtn);
    this.count = h('span', { class: 'w-[74px] shrink-0 text-center text-[11px] tabular-nums text-fg-subtle' });
    const prev = h('button', { class: btnCls, title: 'Previous match (Shift+Enter)', 'aria-label': 'Previous match', type: 'button' }, icons.up);
    const next = h('button', { class: btnCls, title: 'Next match (Enter)', 'aria-label': 'Next match', type: 'button' }, icons.down);
    const close = h('button', { class: btnCls, title: 'Close (Escape)', 'aria-label': 'Close', type: 'button' }, icons.close);
    prev.onclick = () => findPrevious(this.view);
    next.onclick = () => findNext(this.view);
    close.onclick = () => {
      closeSearchPanel(this.view);
      this.view.focus();
    };
    findRow.append(findWrap, this.count, prev, next, close);

    // Replace row
    this.replaceRow = h('div', { class: 'hidden items-center gap-1' });
    const replWrap = h('div', { class: inputWrapCls });
    this.replaceInput = h('input', { class: inputCls, placeholder: 'Replace', 'aria-label': 'Replace', spellcheck: 'false', autocomplete: 'off' });
    replWrap.append(this.replaceInput);
    const replOne = h('button', { class: btnCls, title: 'Replace (Enter)', 'aria-label': 'Replace', type: 'button' }, icons.replace);
    const replAll = h('button', { class: btnCls, title: `Replace all (${isMac ? '⌥' : 'Alt+'}Enter)`, 'aria-label': 'Replace all', type: 'button' }, icons.replaceAll);
    replOne.onclick = () => replaceNext(this.view);
    replAll.onclick = () => replaceAll(this.view);
    const spacer = h('span', { class: 'w-[74px] shrink-0' });
    this.replaceRow.append(replWrap, spacer, replOne, replAll, h('span', { class: 'size-6 shrink-0' }));

    rows.append(findRow, this.replaceRow);
    this.dom.append(this.expandBtn, rows);

    // Events
    const commit = () => this.commit();
    this.searchInput.addEventListener('input', commit);
    this.replaceInput.addEventListener('input', commit);
    for (const [btn, key] of [
      [this.caseBtn, 'caseSensitive'],
      [this.wordBtn, 'wholeWord'],
      [this.reBtn, 'regexp'],
    ] as const) {
      btn.onclick = () => {
        btn.setAttribute('aria-pressed', String(btn.getAttribute('aria-pressed') !== 'true'));
        this.commit();
        void key;
      };
    }
    this.dom.addEventListener('keydown', (e) => this.onKey(e));
    this.syncFromQuery(this.query);
    if (this.query.replace) this.setReplaceVisible(true, false);
  }

  private onKey(e: KeyboardEvent) {
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeSearchPanel(this.view);
      this.view.focus();
    } else if (e.key === 'Enter' && e.target === this.searchInput) {
      e.preventDefault();
      (e.shiftKey ? findPrevious : findNext)(this.view);
    } else if (e.key === 'Enter' && e.target === this.replaceInput) {
      e.preventDefault();
      if (e.altKey) replaceAll(this.view);
      else replaceNext(this.view);
    } else if (e.altKey && !mod && ['c', 'w', 'r', 'ç', '∑', '®'].includes(e.key.toLowerCase())) {
      const code = e.code;
      const btn = code === 'KeyC' ? this.caseBtn : code === 'KeyW' ? this.wordBtn : code === 'KeyR' ? this.reBtn : null;
      if (btn) {
        e.preventDefault();
        btn.click();
      }
    } else if (mod && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      this.searchInput.select();
    } else if (mod && (e.key.toLowerCase() === 'h' || (e.altKey && e.key.toLowerCase() === 'f'))) {
      e.preventDefault();
      this.setReplaceVisible(true, true);
    }
  }

  private setReplaceVisible(on: boolean, focus: boolean) {
    this.showReplace = on;
    this.replaceRow.classList.toggle('hidden', !on);
    this.replaceRow.classList.toggle('flex', on);
    this.expandBtn.style.transform = on ? 'rotate(90deg)' : '';
    if (on && focus) this.replaceInput.focus();
    this.view.requestMeasure();
  }

  private commit() {
    const q = new SearchQuery({
      search: this.searchInput.value,
      caseSensitive: this.caseBtn.getAttribute('aria-pressed') === 'true',
      wholeWord: this.wordBtn.getAttribute('aria-pressed') === 'true',
      regexp: this.reBtn.getAttribute('aria-pressed') === 'true',
      replace: this.replaceInput.value,
    });
    if (!q.eq(this.query)) {
      this.query = q;
      this.view.dispatch({ effects: setSearchQuery.of(q) });
      this.scheduleCount();
    }
    this.searchInput.parentElement!.classList.toggle('!border-danger', !!q.search && !q.valid);
  }

  private syncFromQuery(q: SearchQuery) {
    this.query = q;
    if (this.searchInput.value !== q.search) this.searchInput.value = q.search;
    if (this.replaceInput.value !== q.replace) this.replaceInput.value = q.replace;
    this.caseBtn.setAttribute('aria-pressed', String(q.caseSensitive));
    this.wordBtn.setAttribute('aria-pressed', String(q.wholeWord));
    this.reBtn.setAttribute('aria-pressed', String(q.regexp));
    this.scheduleCount();
  }

  private scheduleCount() {
    clearTimeout(this.countTimer);
    this.countTimer = setTimeout(() => this.updateCount(), 60);
  }

  private updateCount() {
    const q = this.query;
    if (!q.search) {
      this.count.textContent = '';
      return;
    }
    if (!q.valid) {
      this.count.textContent = 'Invalid';
      return;
    }
    const state = this.view.state;
    const sel = state.selection.main;
    let total = 0;
    let current = 0;
    const cursor = q.getCursor(state);
    const LIMIT = 9999;
    for (let r = cursor.next(); !r.done; r = cursor.next()) {
      total++;
      const v = r.value as { from: number; to: number };
      if (v.from === sel.from && v.to === sel.to) current = total;
      if (total > LIMIT) break;
    }
    if (!total) this.count.textContent = 'No results';
    else this.count.textContent = `${current ? `${current} of ` : ''}${total > LIMIT ? `${LIMIT}+` : total}`;
    this.count.classList.toggle('text-danger', total === 0);
  }

  mount() {
    this.searchInput.focus();
    this.searchInput.select();
    this.scheduleCount();
  }

  update(u: ViewUpdate) {
    for (const tr of u.transactions) {
      for (const e of tr.effects) {
        if (e.is(setSearchQuery) && !e.value.eq(this.query)) this.syncFromQuery(e.value);
      }
    }
    if (u.docChanged || u.selectionSet) this.scheduleCount();
  }

  destroy() {
    clearTimeout(this.countTimer);
  }
}

export function searchExtension(): Extension {
  return [
    search({ top: true, createPanel: (view) => new TexitSearchPanel(view) }),
    EditorView.baseTheme({
      '.cm-tx-search button': { cursor: 'default' },
    }),
  ];
}
