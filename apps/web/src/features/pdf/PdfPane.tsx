/**
 * The right-hand preview of the compiled PDF: toolbar, flicker-free viewer,
 * compile progress / failure overlays, SyncTeX in both directions.
 */
import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftToLine,
  ArrowRightToLine,
  Download,
  ExternalLink,
  LocateFixed,
  Moon,
  MousePointerClick,
  PanelLeft,
  X,
} from 'lucide-react';
import { useWorkspace } from '@/state/workspace';
import { useSettings } from '@/state/settings';
import { executeCommand } from '@/services/commands';
import { IconButton, Spinner, type MenuEntry } from '@/ui';
import { cn } from '@/lib/cn';
import { PdfViewer } from './PdfViewer';
import type { PdfView } from './engine';
import { PdfEmptyState, ProgressTrack, compilePercent } from './PdfEmptyState';
import { activePreviewView, registerPreviewView, usePdfPane } from './controller';
import { activeTexPath, consumePendingForward, forwardBoxes, inverseSearch, setPendingForward, tidyBoxes } from './synctex';
import { downloadPdf, pdfFileName, syncFromCursor, toggleFollowCursor } from './actions';
import { openPdfWindow } from './popout';

export function PdfPane() {
  return <PdfPreview id="pane" />;
}

/** Shared by the docked pane and the detached window. */
export function PdfPreview({ id, detached }: { id: 'pane' | 'popout'; detached?: boolean }) {
  const pdf = useWorkspace((s) => s.compile.pdf);
  const compile = useWorkspace((s) => s.compile);
  if (!pdf) return <PdfEmptyState compile={compile} />;
  return <PreviewViewer id={id} detached={detached} pdf={pdf} />;
}

const ourNonces = new Set<number>();
let highlightNonce = 1_000_000;

function PreviewViewer({ id, detached, pdf }: { id: 'pane' | 'popout'; detached?: boolean; pdf: Uint8Array }) {
  const pdfVersion = useWorkspace((s) => s.compile.pdfVersion);
  const projectId = useWorkspace((s) => s.meta?.id ?? null);
  const pdfSettings = useSettings((s) => s.pdf);
  const setPdf = useSettings((s) => s.setPdf);
  const thumbnails = usePdfPane((s) => s.thumbnails);
  const [view, setView] = useState<PdfView | null>(null);
  const viewRef = useRef<PdfView | null>(null);

  // Remember zoom + position across remounts of the docked pane.
  const [initial] = useState(() => {
    const p = usePdfPane.getState();
    return {
      zoom: p.zoom ?? pdfSettings.defaultZoom,
      position: id === 'pane' && (p.position as { projectId?: string } | null)?.projectId === projectId ? p.position : null,
    };
  });

  const onViewRef = (v: PdfView | null) => {
    if (!v && viewRef.current && id === 'pane') {
      const pos = viewRef.current.savePosition();
      usePdfPane.setState({ position: pos ? { ...pos, projectId } as never : null, zoom: viewRef.current.getSnapshot().zoom });
    }
    viewRef.current = v;
    registerPreviewView(id, v);
    setView(v);
  };

  // Persist the zoom choice (fit modes and fixed zoom) for next time.
  useEffect(() => {
    if (!view) return;
    let last = view.getSnapshot().zoom;
    return view.subscribe(() => {
      const z = view.getSnapshot().zoom;
      if (z !== last) {
        last = z;
        usePdfPane.setState({ zoom: z });
      }
    });
  }, [view]);

  // Forward SyncTeX requests from the editor, and highlights requested by others.
  useEffect(() => {
    if (!view) return;
    const run = (path: string, line: number, mode: 'flash' | 'soft') => {
      const boxes = tidyBoxes(forwardBoxes(path, line, { silent: mode === 'soft' }));
      if (!boxes.length) return false;
      view.highlight(boxes, mode === 'flash' ? { scroll: 'center', style: 'flash' } : { scroll: 'nearest', style: 'soft' });
      if (mode === 'flash') {
        const nonce = ++highlightNonce;
        ourNonces.add(nonce);
        useWorkspace.setState({ pdfHighlight: boxes.map((b) => ({ ...b, nonce })) });
      }
      return true;
    };
    const unsub = useWorkspace.subscribe((s, prev) => {
      if (s.pdfSyncRequest && s.pdfSyncRequest !== prev.pdfSyncRequest) {
        if (view.getSnapshot().status === 'ready') run(s.pdfSyncRequest.path, s.pdfSyncRequest.line, 'flash');
        else setPendingForward(s.pdfSyncRequest.path, s.pdfSyncRequest.line);
      }
      if (s.pdfHighlight && s.pdfHighlight !== prev.pdfHighlight) {
        const n = s.pdfHighlight[0]?.nonce;
        if (n != null && !ourNonces.has(n)) view.highlight(s.pdfHighlight, { scroll: 'center', style: 'flash' });
      }
    });
    // Follow-cursor after each compile (and a pending request from before the pane was open).
    let lastDoc = view.getSnapshot().docVersion;
    const unsubView = view.subscribe(() => {
      const st = view.getSnapshot();
      if (st.docVersion === lastDoc || st.status !== 'ready') return;
      lastDoc = st.docVersion;
      const pending = consumePendingForward();
      if (pending) {
        run(pending.path, pending.line, 'flash');
        return;
      }
      if (useSettings.getState().pdf.followCursor) {
        const path = activeTexPath();
        if (path) run(path, useWorkspace.getState().cursor.line, 'soft');
      }
    });
    return () => {
      unsub();
      unsubView();
    };
  }, [view]);

  // Live follow: when the cursor moves to another line, keep the PDF in sync.
  useEffect(() => {
    if (!view || !pdfSettings.followCursor) return;
    let t = 0;
    const unsub = useWorkspace.subscribe((s, prev) => {
      if (s.cursor.line === prev.cursor.line && s.activeFileId === prev.activeFileId) return;
      clearTimeout(t);
      t = window.setTimeout(() => {
        const path = activeTexPath();
        if (!path || view.getSnapshot().status !== 'ready') return;
        const boxes = tidyBoxes(forwardBoxes(path, useWorkspace.getState().cursor.line, { silent: true }));
        if (boxes.length) view.highlight(boxes, { scroll: 'nearest', style: 'soft' });
      }, 350);
    });
    return () => {
      clearTimeout(t);
      unsub();
    };
  }, [view, pdfSettings.followCursor]);

  const onInverse = (pt: { page: number; x: number; y: number }) => {
    if (inverseSearch(pt) && detached) window.focus();
  };

  const syncToSource = () => {
    const pt = view?.viewportCenterPoint();
    if (pt) onInverse(pt);
  };

  const menuItems: MenuEntry[] = [
    { label: 'Download PDF', icon: <Download />, onSelect: () => void downloadPdf() },
    ...(!detached ? [{ label: 'Open in new window', icon: <ExternalLink />, onSelect: () => openPdfWindow() } as MenuEntry] : []),
    { type: 'separator' },
    { label: 'Go to source', icon: <ArrowLeftToLine />, onSelect: syncToSource },
    { label: 'Show cursor in PDF', icon: <ArrowRightToLine />, onSelect: syncFromCursor },
    { label: 'Follow cursor', icon: <LocateFixed />, checked: pdfSettings.followCursor, onSelect: toggleFollowCursor },
    {
      label: 'Double-click jumps to source',
      icon: <MousePointerClick />,
      checked: pdfSettings.doubleClickToSource,
      onSelect: () => setPdf({ doubleClickToSource: !pdfSettings.doubleClickToSource }),
    },
    { type: 'separator' },
    {
      label: 'PDF in dark mode',
      icon: <Moon />,
      submenu: [
        { label: 'Original colors', checked: pdfSettings.darkMode === 'off', onSelect: () => setPdf({ darkMode: 'off' }) },
        { label: 'Dimmed paper', checked: pdfSettings.darkMode === 'dim', onSelect: () => setPdf({ darkMode: 'dim' }) },
        { label: 'Inverted (dark paper)', checked: pdfSettings.darkMode === 'invert', onSelect: () => setPdf({ darkMode: 'invert' }) },
      ],
    },
    { label: 'Page thumbnails', icon: <PanelLeft />, checked: thumbnails, onSelect: () => usePdfPane.setState({ thumbnails: !thumbnails }) },
  ];

  const nt = detached;
  const toolbarEnd = (
    <>
      <IconButton label="Go to source (center of view)" size="sm" onClick={syncToSource} noTooltip={nt} className="hidden @[440px]:inline-flex">
        <ArrowLeftToLine />
      </IconButton>
      <IconButton label="Show cursor in PDF" size="sm" onClick={syncFromCursor} noTooltip={nt} className="hidden @[440px]:inline-flex">
        <ArrowRightToLine />
      </IconButton>
      <IconButton
        label={pdfSettings.followCursor ? 'Following cursor' : 'Follow cursor'}
        size="sm"
        active={pdfSettings.followCursor}
        onClick={toggleFollowCursor}
        noTooltip={nt}
        className={cn('hidden @[520px]:inline-flex', pdfSettings.followCursor && 'text-accent')}
      >
        <LocateFixed />
      </IconButton>
      <div className="mx-0.5 hidden h-4 w-px bg-border @[380px]:block" />
      <IconButton label="Download PDF" size="sm" onClick={() => void downloadPdf()} noTooltip={nt} className="hidden @[380px]:inline-flex">
        <Download />
      </IconButton>
      {!detached && (
        <IconButton label="Open in new window" size="sm" onClick={() => openPdfWindow()} className="hidden @[480px]:inline-flex">
          <ExternalLink />
        </IconButton>
      )}
    </>
  );

  return (
    <PdfViewer
      data={pdf}
      version={pdfVersion}
      fileName={pdfFileName()}
      defaultZoom={initial.zoom}
      initialPosition={initial.position}
      thumbnails={thumbnails}
      onThumbnailsChange={(v) => usePdfPane.setState({ thumbnails: v })}
      onInverseSearch={onInverse}
      doubleClickToSource={pdfSettings.doubleClickToSource}
      viewRef={onViewRef}
      toolbarEnd={toolbarEnd}
      menuItems={detached ? undefined : menuItems}
      detached={detached}
      overlay={<CompileOverlay />}
    />
  );
}

// ───────────────────────────── overlays ─────────────────────────────

function CompileOverlay() {
  const status = useWorkspace((s) => s.compile.status);
  const detail = useWorkspace((s) => s.compile.detail);
  const progress = useWorkspace((s) => s.compile.progress);
  const result = useWorkspace((s) => s.compile.result);
  const dismissed = usePdfPane((s) => s.dismissedResult);
  const busy = status === 'preparing' || status === 'compiling';

  // Only show the status chip for compiles that take a while (no flashing on fast builds).
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!busy) {
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 700);
    return () => clearTimeout(t);
  }, [busy]);

  const pct = compilePercent({ progress, detail });
  const showError = status === 'error' && result && dismissed !== result;

  return (
    <>
      <div className={cn('pointer-events-none absolute inset-x-0 top-0 z-20 transition-opacity duration-300', busy ? 'opacity-100' : 'opacity-0')}>
        {busy && <ProgressTrack percent={pct} thin className="rounded-none bg-transparent ring-0" />}
      </div>
      {busy && slow && (
        <div className="pointer-events-none absolute inset-x-0 top-3 z-20 flex justify-center px-4">
          <div className="flex max-w-full animate-slide-up items-center gap-2 rounded-full border border-border bg-elevated/95 py-1 pl-2.5 pr-3 text-[12px] text-fg-muted shadow-pop backdrop-blur-xl">
            <Spinner className="size-3.5 shrink-0 text-accent" />
            <span className="truncate">{detail || (status === 'preparing' ? 'Preparing TeX engine…' : 'Compiling…')}</span>
            {pct != null && status === 'preparing' && <span className="tabular-nums text-fg-subtle">{pct}%</span>}
          </div>
        </div>
      )}
      {showError && !busy && (
        <div className="absolute inset-x-0 top-0 z-20 px-3 pt-3">
          <div className="mx-auto flex max-w-[560px] animate-slide-up items-center gap-2.5 rounded-xl border border-danger/25 bg-elevated/95 py-2 pl-3 pr-1.5 text-[12.5px] shadow-pop backdrop-blur-xl">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger">
              <AlertTriangle className="size-3.5" />
            </span>
            <span className="min-w-0 flex-1 leading-snug text-fg">
              <span className="font-medium">Last compile failed</span>
              <span className="text-fg-muted"> — showing the last successful PDF</span>
            </span>
            <button
              type="button"
              onClick={() => executeCommand('view.problems')}
              className="shrink-0 rounded-md px-2 py-1 text-[12px] font-medium text-danger transition-colors hover:bg-danger-soft"
            >
              View problems
            </button>
            <button
              type="button"
              aria-label="Dismiss"
              onClick={() => usePdfPane.setState({ dismissedResult: result })}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export { activePreviewView };
