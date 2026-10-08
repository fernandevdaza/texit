import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronRight, ChevronsDownUp, Ellipsis, Replace, ReplaceAll, Search, X } from 'lucide-react';
import { dirname } from '@texit/core';
import { useWorkspace } from '@/state/workspace';
import { getEditorBridge } from '@/services/editor';
import { cn } from '@/lib/cn';
import { t as translate, useT } from '@/lib/i18n';
import { confirmDialog, EmptyState, IconButton, PanelHeader, Spinner, toast, Tooltip } from '@/ui';
import { FileIcon } from '@/features/files/FileIcon';
import { editorController } from '@/features/editor/cm/controller';
import { replaceInFile, replacementFor, buildRegex, searchProject, EMPTY_MATCH_ERROR, MAX_MATCHES, type SearchMatch, type SearchResult } from './engine';
import { useSearchUi } from './store';

type FlatRow = { kind: 'file'; fileId: string } | { kind: 'match'; fileId: string; index: number };

function Toggle({ on, onClick, title, children }: { on: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <Tooltip content={title}>
      <button
        type="button"
        aria-pressed={on}
        aria-label={title}
        onClick={onClick}
        className="inline-flex h-5 min-w-5 items-center justify-center rounded px-1 font-mono text-[11px] font-semibold text-fg-subtle transition-colors hover:bg-hover hover:text-fg aria-pressed:bg-accent-soft aria-pressed:text-accent"
      >
        {children}
      </button>
    </Tooltip>
  );
}

const fieldCls =
  'flex min-h-7 min-w-0 flex-1 items-center gap-0.5 rounded-md border border-border bg-surface-2/60 pl-2 pr-1 transition-[border,box-shadow] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/15';
const inputCls = 'h-7 min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-fg-subtle';

export function SearchPanel() {
  const ui = useSearchUi();
  const project = useWorkspace((s) => s.project);
  const files = useWorkspace((s) => s.files);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [contentVersion, setContentVersion] = useState(0);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState<number>(-1);
  const queryRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const t = useT();

  // Prefill with the editor selection when opening.
  useEffect(() => {
    const sel = getEditorBridge()?.getSelection();
    if (sel?.text && !sel.text.includes('\n') && sel.text.length < 200) useSearchUi.getState().set({ query: sel.text });
    requestAnimationFrame(() => {
      queryRef.current?.focus();
      queryRef.current?.select();
    });
  }, []);
  useEffect(() => {
    if (ui.focusNonce) {
      queryRef.current?.focus();
      queryRef.current?.select();
    }
  }, [ui.focusNonce]);

  // Re-run when files change (debounced).
  useEffect(() => {
    if (!project) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = project.onContentChange(() => {
      clearTimeout(t);
      t = setTimeout(() => setContentVersion((v) => v + 1), 400);
    });
    return () => {
      clearTimeout(t);
      off();
    };
  }, [project]);

  useEffect(() => {
    if (!project || !ui.query) {
      setResult(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    const t = setTimeout(() => {
      try {
        setResult(searchProject(project, useWorkspace.getState().files, ui));
      } finally {
        setBusy(false);
      }
    }, 180);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, ui.query, ui.caseSensitive, ui.wholeWord, ui.regex, ui.include, ui.exclude, contentVersion, files]);

  const regex = useMemo(() => buildRegex(ui), [ui.query, ui.caseSensitive, ui.wholeWord, ui.regex]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const fr of result?.files ?? []) {
      out.push({ kind: 'file', fileId: fr.file.id });
      if (!collapsed.has(fr.file.id)) fr.matches.forEach((_, index) => out.push({ kind: 'match', fileId: fr.file.id, index }));
    }
    return out;
  }, [result, collapsed]);

  useEffect(() => setCursor(-1), [result]);

  const reveal = (fileId: string, m: SearchMatch, focus: boolean) => {
    const ws = useWorkspace.getState();
    if (ws.openTabs.includes(fileId)) ws.setActive(fileId);
    else ws.openFile(fileId, { preview: true });
    useWorkspace.setState({ revealRequest: { fileId, line: m.line, column: m.column, select: { from: m.from, to: m.to }, nonce: Date.now() + Math.random() } });
    if (focus) setTimeout(() => getEditorBridge()?.focus(), 50);
  };

  const doReplace = (fileId: string, only?: SearchMatch) => {
    if (!project) return 0;
    const undo = editorController.ensureUndoManager(fileId);
    undo?.stopCapturing();
    const n = replaceInFile(project, fileId, ui, ui.replace, only ? { from: only.from, to: only.to, text: only.text } : undefined);
    undo?.stopCapturing();
    return n;
  };

  const replaceAllEverywhere = async () => {
    if (!result?.total || !project) return;
    const ok = await confirmDialog({
      title: translate('search.confirmTitle', { count: result.total }),
      message: (
        <>
          {translate('search.confirmFiles', { count: result.files.length })} “<span className="font-mono">{ui.replace}</span>”. {translate('search.confirmUndo')}
        </>
      ),
      confirmLabel: translate('search.replaceAll'),
    });
    if (!ok) return;
    let n = 0;
    for (const fr of result.files) n += doReplace(fr.file.id);
    toast.success(translate('search.replaced', { count: n }));
  };

  const toggleFile = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const byFile = useMemo(() => new Map((result?.files ?? []).map((f) => [f.file.id, f])), [result]);

  const onListKey = (e: KeyboardEvent) => {
    if (!rows.length) return;
    const moveTo = (i: number) => {
      const idx = Math.max(0, Math.min(rows.length - 1, i));
      setCursor(idx);
      const r = rows[idx];
      listRef.current?.querySelector<HTMLElement>(`[data-row="${idx}"]`)?.scrollIntoView({ block: 'nearest' });
      if (r.kind === 'match') {
        const m = byFile.get(r.fileId)?.matches[r.index];
        if (m) reveal(r.fileId, m, false);
      }
    };
    const r = rows[cursor];
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        moveTo(cursor + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (cursor <= 0) queryRef.current?.focus();
        else moveTo(cursor - 1);
        break;
      case 'ArrowLeft':
        if (r) {
          e.preventDefault();
          if (r.kind === 'file' && !collapsed.has(r.fileId)) toggleFile(r.fileId);
          else moveTo(rows.findIndex((x) => x.kind === 'file' && x.fileId === r.fileId));
        }
        break;
      case 'ArrowRight':
        if (r?.kind === 'file' && collapsed.has(r.fileId)) {
          e.preventDefault();
          toggleFile(r.fileId);
        }
        break;
      case 'Enter':
        if (!r) break;
        e.preventDefault();
        if (r.kind === 'file') toggleFile(r.fileId);
        else {
          const m = byFile.get(r.fileId)?.matches[r.index];
          if (m) reveal(r.fileId, m, true);
        }
        break;
      case 'Escape':
        queryRef.current?.focus();
        break;
    }
  };

  const onQueryKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter') {
      e.preventDefault();
      const first = rows.findIndex((r) => r.kind === 'match');
      if (first >= 0) {
        listRef.current?.focus();
        setCursor(first);
        const r = rows[first] as Extract<FlatRow, { kind: 'match' }>;
        const m = byFile.get(r.fileId)?.matches[r.index];
        if (m) reveal(r.fileId, m, false);
      }
    } else if (e.altKey && ['KeyC', 'KeyW', 'KeyR'].includes(e.code)) {
      e.preventDefault();
      if (e.code === 'KeyC') ui.set({ caseSensitive: !ui.caseSensitive });
      if (e.code === 'KeyW') ui.set({ wholeWord: !ui.wholeWord });
      if (e.code === 'KeyR') ui.set({ regex: !ui.regex });
    } else if (e.key === 'Escape' && ui.query) {
      e.preventDefault();
      ui.set({ query: '' });
    }
  };

  const showReplacePreview = ui.showReplace && typeof regex !== 'string';

  return (
    <div className="flex h-full min-h-0 flex-col" data-keep-focus>
      <PanelHeader
        title={t('panel.search')}
        actions={
          <>
            <IconButton size="xs" label={t('search.collapseAll')} disabled={!result?.files.length} onClick={() => setCollapsed(new Set(result?.files.map((f) => f.file.id)))}>
              <ChevronsDownUp />
            </IconButton>
            <IconButton size="xs" label={t('search.clear')} disabled={!ui.query} onClick={() => ui.set({ query: '', replace: '' })}>
              <X />
            </IconButton>
          </>
        }
      />
      <div className="flex gap-1 px-2 pb-2">
        <button
          onClick={() => ui.set({ showReplace: !ui.showReplace })}
          aria-label={t('search.toggleReplace')}
          title={`${t('search.toggleReplace')} (⌘⇧H)`}
          className="mt-0.5 flex h-6 w-4 shrink-0 items-center justify-center rounded text-fg-subtle hover:bg-hover hover:text-fg"
        >
          <ChevronRight className={cn('size-3.5 transition-transform', ui.showReplace && 'rotate-90')} />
        </button>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className={cn(fieldCls, typeof regex === 'string' && regex !== 'empty' && '!border-danger')}>
            <input
              ref={queryRef}
              value={ui.query}
              onChange={(e) => ui.set({ query: e.target.value })}
              onKeyDown={onQueryKey}
              placeholder={t('search.placeholder')}
              spellCheck={false}
              aria-label={t('search.searchInProject')}
              className={cn(inputCls, 'font-mono text-[12px] placeholder:font-sans')}
            />
            <Toggle on={ui.caseSensitive} title={`${t('search.matchCase')} (⌥C)`} onClick={() => ui.set({ caseSensitive: !ui.caseSensitive })}>
              Aa
            </Toggle>
            <Toggle on={ui.wholeWord} title={`${t('search.matchWholeWord')} (⌥W)`} onClick={() => ui.set({ wholeWord: !ui.wholeWord })}>
              <span className="underline decoration-1 underline-offset-2">ab</span>
            </Toggle>
            <Toggle on={ui.regex} title={`${t('search.useRegex')} (⌥R)`} onClick={() => ui.set({ regex: !ui.regex })}>
              .*
            </Toggle>
          </div>
          {ui.showReplace && (
            <div className="flex items-center gap-1">
              <div className={fieldCls}>
                <input
                  value={ui.replace}
                  onChange={(e) => ui.set({ replace: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.altKey || e.metaKey)) {
                      e.preventDefault();
                      void replaceAllEverywhere();
                    }
                  }}
                  placeholder={t('search.replacePlaceholder')}
                  spellCheck={false}
                  aria-label={t('search.replaceWith')}
                  className={cn(inputCls, 'font-mono text-[12px] placeholder:font-sans')}
                />
              </div>
              <IconButton size="sm" label={`${t('search.replaceAll')} (⌥↩)`} disabled={!result?.total} onClick={() => void replaceAllEverywhere()}>
                <ReplaceAll />
              </IconButton>
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 truncate text-[11px] text-fg-subtle">
              {typeof regex === 'string' && regex !== 'empty' ? (
                <span className="text-danger">{regex === EMPTY_MATCH_ERROR ? t('search.matchesEmpty') : regex}</span>
              ) : busy ? (
                <span className="inline-flex items-center gap-1.5">
                  <Spinner className="size-3" /> {t('search.searching')}
                </span>
              ) : result ? (
                result.total ? (
                  t('search.inFiles', {
                    summary: result.truncated ? t('search.resultCount_other', { count: `${MAX_MATCHES}+` }) : t('search.resultCount', { count: result.total }),
                    count: result.files.length,
                  })
                ) : (
                  t('search.noResults')
                )
              ) : null}
            </div>
            <button
              onClick={() => ui.set({ showFilters: !ui.showFilters })}
              aria-label={t('search.toggleFilters')}
              title={t('search.filtersTitle')}
              className={cn('flex h-5 shrink-0 items-center rounded px-1 text-fg-subtle hover:bg-hover hover:text-fg', (ui.showFilters || ui.include || ui.exclude) && 'text-accent')}
            >
              <Ellipsis className="size-3.5" />
            </button>
          </div>
          {ui.showFilters && (
            <div className="flex flex-col gap-1">
              <label className="text-[10.5px] font-medium uppercase tracking-wide text-fg-subtle">{t('search.include')}</label>
              <div className={fieldCls}>
                <input value={ui.include} onChange={(e) => ui.set({ include: e.target.value })} placeholder={t('search.includeExample')} spellCheck={false} className={inputCls} />
              </div>
              <label className="mt-1 text-[10.5px] font-medium uppercase tracking-wide text-fg-subtle">{t('search.exclude')}</label>
              <div className={fieldCls}>
                <input value={ui.exclude} onChange={(e) => ui.set({ exclude: e.target.value })} placeholder={t('search.excludeExample')} spellCheck={false} className={inputCls} />
              </div>
            </div>
          )}
        </div>
      </div>
      <div
        ref={listRef}
        tabIndex={0}
        role="tree"
        aria-label={t('search.results')}
        onKeyDown={onListKey}
        className="min-h-0 flex-1 overflow-y-auto border-t border-border pb-4 outline-none"
      >
        {!ui.query && (
          <EmptyState icon={<Search />} title={t('search.emptyTitle')} description={t('search.emptyHint')} />
        )}
        {rows.map((r, i) => {
          const fr = byFile.get(r.fileId);
          if (!fr) return null;
          if (r.kind === 'file') {
            const isCollapsed = collapsed.has(r.fileId);
            return (
              <div
                key={`f-${r.fileId}`}
                data-row={i}
                role="treeitem"
                aria-expanded={!isCollapsed}
                onClick={() => {
                  setCursor(i);
                  toggleFile(r.fileId);
                }}
                className={cn(
                  'group sticky top-0 z-[1] flex h-[26px] cursor-default select-none items-center gap-1.5 bg-surface pl-1.5 pr-2 text-[12.5px] text-fg hover:bg-hover',
                  cursor === i && 'bg-accent-soft',
                )}
              >
                <ChevronRight className={cn('size-3.5 shrink-0 text-fg-subtle transition-transform', !isCollapsed && 'rotate-90')} />
                <FileIcon path={fr.file.path} className="size-[15px]" />
                <span className="truncate font-medium">{fr.file.name}</span>
                <span className="min-w-0 flex-1 truncate text-[11px] text-fg-subtle">{dirname(fr.file.path)}</span>
                {ui.showReplace && (
                  <Tooltip content={t('search.replaceAllInFile')}>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const n = doReplace(r.fileId);
                        if (n) toast.success(t('search.replacedInFile', { count: n, name: fr.file.name }));
                      }}
                      className="hidden size-5 items-center justify-center rounded text-fg-muted hover:bg-active hover:text-fg group-hover:flex"
                      aria-label={t('search.replaceAllInFile')}
                    >
                      <ReplaceAll className="size-3.5" />
                    </button>
                  </Tooltip>
                )}
                <span className="rounded-full bg-surface-2 px-1.5 text-[10.5px] tabular-nums text-fg-muted ring-1 ring-border">{fr.matches.length}</span>
              </div>
            );
          }
          const m = fr.matches[r.index];
          const repl = showReplacePreview ? replacementFor(m.text, regex as RegExp, ui.replace, ui.regex) : null;
          return (
            <div
              key={`m-${r.fileId}-${r.index}`}
              data-row={i}
              role="treeitem"
              onClick={() => {
                setCursor(i);
                reveal(r.fileId, m, true);
              }}
              className={cn(
                'group relative flex h-[24px] cursor-default select-none items-center gap-2 pl-8 pr-2 text-[12px] text-fg-muted hover:bg-hover hover:text-fg',
                cursor === i && 'bg-accent-soft text-fg',
              )}
            >
              <span className="w-7 shrink-0 text-right font-mono text-[10.5px] tabular-nums text-fg-subtle">{m.line}</span>
              <span className="min-w-0 flex-1 truncate whitespace-pre font-mono text-[11.5px]">
                {m.preview.slice(0, m.pStart)}
                {repl !== null ? (
                  <>
                    <span className="rounded-sm bg-danger-soft text-danger line-through decoration-danger/60">{m.preview.slice(m.pStart, m.pEnd)}</span>
                    <span className="rounded-sm bg-success-soft text-success">{repl}</span>
                  </>
                ) : (
                  <mark className="rounded-sm bg-warning/25 px-px text-fg">{m.preview.slice(m.pStart, m.pEnd)}</mark>
                )}
                {m.preview.slice(m.pEnd)}
              </span>
              {ui.showReplace && (
                <Tooltip content={t('search.replace')}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      doReplace(r.fileId, m);
                    }}
                    className="hidden size-5 shrink-0 items-center justify-center rounded text-fg-muted hover:bg-active hover:text-fg group-hover:flex"
                    aria-label={t('search.replaceThisMatch')}
                  >
                    <Replace className="size-3.5" />
                  </button>
                </Tooltip>
              )}
            </div>
          );
        })}
        {result?.truncated && <div className="px-3 py-2 text-[11px] text-fg-subtle">{t('search.truncated', { max: MAX_MATCHES })}</div>}
      </div>
    </div>
  );
}
