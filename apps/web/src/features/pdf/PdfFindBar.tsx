import { useEffect, useRef, useState } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, Search, WholeWord, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT } from '@/lib/i18n';
import { Spinner } from '@/ui';
import './i18n';
import type { PdfView, PdfViewState } from './engine';

/** Floating find-in-PDF bar (Mod-f while the viewer has focus). */
export function PdfFindBar({
  view,
  state,
  onClose,
  focusNonce,
}: {
  view: PdfView;
  state: PdfViewState;
  onClose: () => void;
  /** Changes whenever Mod-f is pressed again → refocus + select. */
  focusNonce: number;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(state.find.query);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusNonce]);

  // Debounced incremental search.
  useEffect(() => {
    const t = setTimeout(() => view.find(query, { caseSensitive, wholeWord }), query.length < 3 ? 220 : 90);
    return () => clearTimeout(t);
  }, [query, caseSensitive, wholeWord, view]);

  const { total, current, searching } = state.find;
  const hasQuery = query.trim().length > 0;

  const toggleCls = (on: boolean) =>
    cn(
      'flex size-6 items-center justify-center rounded-md transition-colors [&_svg]:size-3.5',
      on ? 'bg-accent-soft text-accent' : 'text-fg-subtle hover:bg-hover hover:text-fg',
    );
  const navCls = 'flex size-6 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-35 [&_svg]:size-3.5';

  return (
    <div
      className="absolute right-3 top-2.5 z-30 flex h-9 animate-scale-in items-center gap-1 rounded-xl border border-border bg-elevated/95 pl-2.5 pr-1 shadow-pop backdrop-blur-xl"
      role="search"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <Search className="size-3.5 shrink-0 text-fg-subtle" />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            view.findNext(e.shiftKey ? -1 : 1);
          }
        }}
        placeholder={t('pdf.find')}
        spellCheck={false}
        aria-label={t('pdf.find')}
        className="h-7 w-40 min-w-0 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-subtle"
      />
      <span className={cn('flex min-w-[52px] items-center justify-end gap-1 whitespace-nowrap px-1 text-[11px] tabular-nums', hasQuery && !searching && total === 0 ? 'text-danger' : 'text-fg-subtle')}>
        {searching && <Spinner className="size-3" />}
        {hasQuery ? (total ? `${current || '–'}/${total}` : searching ? '' : t('pdf.findNoResults')) : ''}
      </span>
      <div className="mx-0.5 h-4 w-px bg-border" />
      <button type="button" className={toggleCls(caseSensitive)} onClick={() => setCaseSensitive((v) => !v)} title={t('pdf.matchCase')} aria-pressed={caseSensitive}>
        <CaseSensitive />
      </button>
      <button type="button" className={toggleCls(wholeWord)} onClick={() => setWholeWord((v) => !v)} title={t('pdf.wholeWord')} aria-pressed={wholeWord}>
        <WholeWord />
      </button>
      <button type="button" className={navCls} onClick={() => view.findNext(-1)} disabled={!total} title={t('pdf.prevMatch')}>
        <ChevronUp />
      </button>
      <button type="button" className={navCls} onClick={() => view.findNext(1)} disabled={!total} title={t('pdf.nextMatch')}>
        <ChevronDown />
      </button>
      <button type="button" className={navCls} onClick={onClose} title={t('pdf.closeFind')}>
        <X />
      </button>
    </div>
  );
}
