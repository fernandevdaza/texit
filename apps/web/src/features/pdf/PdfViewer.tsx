/**
 * Reusable PDF viewer (pdf.js core + our virtualized renderer, see engine.ts).
 * Used by the PDF preview pane and by the editor area to display .pdf files.
 */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, ChevronDown, Download, Maximize, MoveHorizontal, PanelLeft, Search, ZoomIn, ZoomOut, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/cn';
import { downloadBlob } from '@/lib/format';
import { matchesKeybinding } from '@/lib/platform';
import { useResolvedTheme, useSettings } from '@/state/settings';
import { DropdownMenu, EmptyState, IconButton, Spinner, Tooltip, type MenuEntry } from '@/ui';
import { PdfView, ZOOM_PRESETS, type PdfPoint, type PdfPosition, type PdfViewState, type Zoom } from './engine';
import { PdfFindBar } from './PdfFindBar';
import { PdfThumbnails } from './PdfThumbnails';
import './pdf.css';

export type { PdfPoint, PdfRect, Zoom, PdfPosition } from './engine';
export { PdfView } from './engine';

export interface PdfViewerProps {
  data: Uint8Array;
  /** Changes whenever `data` is replaced (the viewer keeps scroll position and zoom between versions). */
  version?: number;
  fileName?: string;
  className?: string;
  /** Show the built-in toolbar (default true). */
  toolbar?: boolean;
  /** Extra toolbar content, rendered before the "more" menu. */
  toolbarEnd?: ReactNode;
  /** Extra entries for the toolbar's "more" menu. */
  menuItems?: MenuEntry[];
  /** Rendered over the page area (progress bars, banners…). */
  overlay?: ReactNode;
  /** Dark-mode rendering; defaults to the user's setting (only applies with the dark theme). */
  darkMode?: 'off' | 'invert' | 'dim';
  /** Initial zoom; defaults to the user's setting. */
  defaultZoom?: Zoom;
  /** Initial reading position (e.g. restored after a remount). */
  initialPosition?: PdfPosition | null;
  /** Controlled thumbnails sidebar. */
  thumbnails?: boolean;
  onThumbnailsChange?: (open: boolean) => void;
  /** Inverse search: fired on Mod-click, or double-click when `doubleClickToSource`. */
  onInverseSearch?: (pt: PdfPoint, ev: MouseEvent) => void;
  doubleClickToSource?: boolean;
  /** Receives the imperative viewer (zoom, navigation, highlight, find…). */
  viewRef?: (view: PdfView | null) => void;
  /** Use native controls instead of portalled menus/tooltips (detached windows). */
  detached?: boolean;
}

export function PdfViewer({
  data,
  version,
  fileName,
  className,
  toolbar = true,
  toolbarEnd,
  menuItems,
  overlay,
  darkMode,
  defaultZoom,
  initialPosition,
  thumbnails: thumbnailsProp,
  onThumbnailsChange,
  onInverseSearch,
  doubleClickToSource = true,
  viewRef,
  detached,
}: PdfViewerProps) {
  const settingsPdf = useSettings((s) => s.pdf);
  const theme = useResolvedTheme((s) => s.theme);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onInverseSearch, doubleClickToSource });
  callbacks.current = { onInverseSearch, doubleClickToSource };

  const [view] = useState(() => {
    const v = new PdfView({
      initialPosition,
      onInverse: (pt, ev) => callbacks.current.onInverseSearch?.(pt, ev),
      doubleClickInverse: () => callbacks.current.doubleClickToSource,
    });
    v.zoomTo(defaultZoom ?? settingsPdf.defaultZoom);
    return v;
  });
  const state = useSyncExternalStore(view.subscribe, view.getSnapshot);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    view.attach(el);
    viewRef?.(view);
    return () => {
      viewRef?.(null);
      view.detach();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useEffect(() => {
    void view.setDocument(data);
  }, [view, data, version]);

  const [thumbsLocal, setThumbsLocal] = useState(false);
  const thumbnails = thumbnailsProp ?? thumbsLocal;
  const setThumbnails = (v: boolean) => {
    setThumbsLocal(v);
    onThumbnailsChange?.(v);
  };

  const [findOpen, setFindOpen] = useState(false);
  const [findNonce, setFindNonce] = useState(0);
  const openFind = () => {
    setFindOpen(true);
    setFindNonce((n) => n + 1);
  };
  const closeFind = () => {
    setFindOpen(false);
    view.closeFind();
    scrollerRef.current?.focus({ preventScroll: true });
  };

  // "Back" pill after following an internal link.
  const [showBack, setShowBack] = useState(false);
  useEffect(() => {
    setShowBack(state.canGoBack);
    if (!state.canGoBack) return;
    const t = setTimeout(() => setShowBack(false), 9000);
    return () => clearTimeout(t);
  }, [state.canGoBack, state.docVersion]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const ne = e.nativeEvent;
    const t = e.target as HTMLElement;
    const typing = !!t.closest('input, textarea, select, [contenteditable="true"]');
    const run = (fn: () => void) => {
      e.preventDefault();
      e.stopPropagation();
      fn();
    };
    if (matchesKeybinding(ne, 'Mod-f')) return run(openFind);
    if (matchesKeybinding(ne, 'Mod-g')) return run(() => view.findNext(1));
    if (matchesKeybinding(ne, 'Mod-Shift-g')) return run(() => view.findNext(-1));
    if (typing) return;
    if (matchesKeybinding(ne, 'Mod-=') || matchesKeybinding(ne, 'Mod-+') || matchesKeybinding(ne, 'Mod-Shift-=')) return run(() => view.zoomIn());
    if (matchesKeybinding(ne, 'Mod--')) return run(() => view.zoomOut());
    if (matchesKeybinding(ne, 'Mod-0')) return run(() => view.zoomTo(defaultZoom ?? settingsPdf.defaultZoom));
    if (matchesKeybinding(ne, 'Mod-[') || matchesKeybinding(ne, 'Alt-ArrowLeft')) return run(() => view.back());
    if (matchesKeybinding(ne, 'Mod-]') || matchesKeybinding(ne, 'Alt-ArrowRight')) return run(() => view.forward());
    if (matchesKeybinding(ne, 'Mod-ArrowUp') || (e.key === 'Home' && !e.metaKey && !e.ctrlKey)) return run(() => view.goToPage(1));
    if (matchesKeybinding(ne, 'Mod-ArrowDown') || (e.key === 'End' && !e.metaKey && !e.ctrlKey)) return run(() => view.goToPage(view.numPages));
    if (e.key === 'Escape') {
      if (findOpen) return run(closeFind);
      view.clearHighlight();
      return;
    }
    const sc = scrollerRef.current;
    const noHScroll = !sc || sc.scrollWidth <= sc.clientWidth + 1;
    if (!e.altKey && !e.metaKey && !e.ctrlKey && noHScroll) {
      if (e.key === 'ArrowRight') return run(() => view.nextPage());
      if (e.key === 'ArrowLeft') return run(() => view.prevPage());
    }
  };

  const pdfDark = theme === 'dark' ? (darkMode ?? settingsPdf.darkMode) : 'off';

  return (
    <div className={cn('relative flex h-full min-h-0 flex-col bg-pdf-bg', className)} data-pdf-dark={pdfDark} onKeyDown={onKeyDown}>
      {toolbar && (
        <PdfToolbar
          view={view}
          state={state}
          detached={detached}
          thumbnails={thumbnails}
          onToggleThumbnails={() => setThumbnails(!thumbnails)}
          onFind={() => (findOpen ? closeFind() : openFind())}
          findOpen={findOpen}
          end={toolbarEnd}
          menuItems={menuItems}
          onDownload={fileName ? () => downloadBlob(data, fileName, 'application/pdf') : undefined}
        />
      )}
      <div className="relative flex min-h-0 flex-1">
        {thumbnails && state.status === 'ready' && <PdfThumbnails view={view} state={state} />}
        <div className="relative min-w-0 flex-1">
          <div ref={scrollerRef} tabIndex={0} className="tx-pdf-scroller absolute inset-0" aria-label={fileName ? `PDF: ${fileName}` : 'PDF document'} />
          {state.status === 'loading' && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="flex items-center gap-2 rounded-full bg-elevated/90 px-3 py-1.5 text-[12px] text-fg-muted shadow-pop">
                <Spinner className="size-3.5" /> Opening PDF…
              </div>
            </div>
          )}
          {state.status === 'error' && (
            <div className="absolute inset-0 flex items-center justify-center">
              <EmptyState icon={<AlertTriangle />} title="This PDF could not be displayed" description={state.error ?? undefined} />
            </div>
          )}
          {findOpen && <PdfFindBar view={view} state={state} onClose={closeFind} focusNonce={findNonce} />}
          {showBack && state.canGoBack && (
            <button
              type="button"
              onClick={() => view.back()}
              className="absolute bottom-4 left-4 z-20 flex h-8 animate-slide-up items-center gap-1.5 rounded-full border border-border bg-elevated/95 pl-2.5 pr-3 text-[12px] font-medium text-fg shadow-pop backdrop-blur-xl transition-colors hover:bg-surface-2"
            >
              <ArrowLeft className="size-3.5" /> Back
            </button>
          )}
          {overlay}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── toolbar ─────────────────────────────

function zoomLabel(state: PdfViewState) {
  return `${Math.round(state.scale * 100)}%`;
}

function PdfToolbar({
  view,
  state,
  detached,
  thumbnails,
  onToggleThumbnails,
  onFind,
  findOpen,
  end,
  menuItems,
  onDownload,
}: {
  view: PdfView;
  state: PdfViewState;
  detached?: boolean;
  thumbnails: boolean;
  onToggleThumbnails: () => void;
  onFind: () => void;
  findOpen: boolean;
  end?: ReactNode;
  menuItems?: MenuEntry[];
  onDownload?: () => void;
}) {
  const ready = state.status === 'ready';
  const zoomItems: MenuEntry[] = [
    { label: 'Fit width', icon: <MoveHorizontal />, checked: state.zoom === 'page-width', onSelect: () => view.zoomTo('page-width') },
    { label: 'Fit page', icon: <Maximize />, checked: state.zoom === 'page-fit', onSelect: () => view.zoomTo('page-fit') },
    { label: 'Automatic', checked: state.zoom === 'auto', onSelect: () => view.zoomTo('auto') },
    { type: 'separator' },
    ...ZOOM_PRESETS.map(
      (z): MenuEntry => ({
        label: `${Math.round(z * 100)}%`,
        checked: typeof state.zoom === 'number' && Math.abs(state.zoom - z) < 0.001,
        onSelect: () => view.zoomTo(z),
      }),
    ),
    { type: 'separator' },
    { label: 'Zoom in', icon: <ZoomIn />, shortcut: 'Mod-=', onSelect: () => view.zoomIn() },
    { label: 'Zoom out', icon: <ZoomOut />, shortcut: 'Mod--', onSelect: () => view.zoomOut() },
  ];
  const nt = detached; // no portalled tooltips in detached windows

  return (
    <div className="@container relative z-10 flex h-9 shrink-0 select-none items-center gap-0.5 border-b border-border bg-surface px-1.5">
      <IconButton label="Thumbnails" size="sm" active={thumbnails} onClick={onToggleThumbnails} disabled={!ready} noTooltip={nt}>
        <PanelLeft />
      </IconButton>
      <PageInput view={view} state={state} />
      <div className="mx-auto flex items-center gap-0.5">
        <IconButton label="Zoom out" shortcut="Mod--" size="sm" onClick={() => view.zoomOut()} disabled={!ready} noTooltip={nt} className="hidden @[300px]:inline-flex">
          <ZoomOut />
        </IconButton>
        {detached ? (
          <select
            value={typeof state.zoom === 'number' ? String(state.zoom) : state.zoom}
            onChange={(e) => {
              const v = e.target.value;
              view.zoomTo(v === 'page-width' || v === 'page-fit' || v === 'auto' ? v : Number(v));
            }}
            className="h-7 rounded-md bg-transparent px-1.5 text-[12px] tabular-nums text-fg-muted outline-none hover:bg-hover"
          >
            <option value="page-width">Fit width</option>
            <option value="page-fit">Fit page</option>
            <option value="auto">Automatic</option>
            {typeof state.zoom === 'number' && !ZOOM_PRESETS.includes(state.zoom) && <option value={String(state.zoom)}>{zoomLabel(state)}</option>}
            {ZOOM_PRESETS.map((z) => (
              <option key={z} value={String(z)}>
                {Math.round(z * 100)}%
              </option>
            ))}
          </select>
        ) : (
          <DropdownMenu
            align="center"
            className="min-w-[180px]"
            items={zoomItems}
            trigger={
              <button
                type="button"
                disabled={!ready}
                className="flex h-7 min-w-[64px] items-center justify-center gap-1 rounded-md px-1.5 text-[12px] font-medium tabular-nums text-fg-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40 data-[state=open]:bg-hover data-[state=open]:text-fg"
              >
                {zoomLabel(state)}
                <ChevronDown className="size-3 text-fg-subtle" />
              </button>
            }
          />
        )}
        <IconButton label="Zoom in" shortcut="Mod-=" size="sm" onClick={() => view.zoomIn()} disabled={!ready} noTooltip={nt} className="hidden @[300px]:inline-flex">
          <ZoomIn />
        </IconButton>
      </div>
      {state.reloading && (
        <Tooltip content="Loading the new version…" disabled={nt}>
          <span className="flex size-6 items-center justify-center text-fg-subtle">
            <Spinner className="size-3" />
          </span>
        </Tooltip>
      )}
      <IconButton label="Find in PDF" shortcut="Mod-f" size="sm" active={findOpen} onClick={onFind} disabled={!ready} noTooltip={nt}>
        <Search />
      </IconButton>
      {end}
      {onDownload && !menuItems && (
        <IconButton label="Download PDF" size="sm" onClick={onDownload} noTooltip={nt} className="hidden @[380px]:inline-flex">
          <Download />
        </IconButton>
      )}
      {menuItems && menuItems.length > 0 && !detached && (
        <DropdownMenu
          align="end"
          items={menuItems}
          trigger={
            <button
              type="button"
              aria-label="More"
              className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-hover hover:text-fg data-[state=open]:bg-hover data-[state=open]:text-fg [&_svg]:size-4"
            >
              <MoreHorizontal />
            </button>
          }
        />
      )}
    </div>
  );
}

function PageInput({ view, state }: { view: PdfView; state: PdfViewState }) {
  const [draft, setDraft] = useState<string | null>(null);
  const ready = state.status === 'ready';
  const commit = () => {
    if (draft != null) {
      const n = parseInt(draft, 10);
      if (Number.isFinite(n)) view.goToPage(n, { history: true });
    }
    setDraft(null);
  };
  const width = `${Math.max(2, String(state.numPages || 1).length) + 1.6}ch`;
  return (
    <div className="ml-1 flex items-center gap-1 text-[12px] tabular-nums text-fg-subtle">
      <input
        value={draft ?? (ready ? String(state.page) : '–')}
        disabled={!ready}
        onFocus={(e) => {
          setDraft(String(state.page));
          requestAnimationFrame(() => e.target.select());
        }}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            view.goToPage(state.page + (e.key === 'ArrowUp' ? -1 : 1));
          }
        }}
        aria-label="Page number"
        style={{ width }}
        className="h-6 rounded-md border border-transparent bg-surface-2 px-1 text-center font-medium text-fg outline-none transition-[border,box-shadow] hover:border-border focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-50"
      />
      <span className="whitespace-nowrap">/ {ready ? state.numPages : '–'}</span>
    </div>
  );
}

