/**
 * PDF preview feature: commands, SyncTeX wiring, detached window lifecycle.
 */
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Download,
  ExternalLink,
  LocateFixed,
  Maximize,
  MoveHorizontal,
  PanelLeft,
  Search,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { registerCommands } from '@/services/commands';
import { useLayout, useWorkspace } from '@/state/workspace';
import { activePreviewView, usePdfPane } from './controller';
import { downloadPdf, syncFromCursor, toggleFollowCursor } from './actions';
import { closePdfWindow, openPdfWindow } from './popout';
import { inverseSearch, setPendingForward, trackSyncTex } from './synctex';

export { PdfPane } from './PdfPane';
export { PdfViewer } from './PdfViewer';

const hasPdf = () => !!useWorkspace.getState().compile.pdf;
const withView = (fn: (v: NonNullable<ReturnType<typeof activePreviewView>>) => void) => () => {
  const v = activePreviewView();
  if (v) fn(v);
};

export function activate(): void | (() => void) {
  const untrack = trackSyncTex();

  const commands = registerCommands([
    { id: 'pdf.download', title: 'Download PDF', category: 'PDF', icon: Download, when: hasPdf, run: () => downloadPdf() },
    { id: 'pdf.zoomIn', title: 'Zoom in', category: 'PDF', icon: ZoomIn, keybinding: 'Mod-=', when: hasPdf, run: withView((v) => v.zoomIn()) },
    { id: 'pdf.zoomOut', title: 'Zoom out', category: 'PDF', icon: ZoomOut, keybinding: 'Mod--', when: hasPdf, run: withView((v) => v.zoomOut()) },
    { id: 'pdf.fitWidth', title: 'Fit width', category: 'PDF', icon: MoveHorizontal, when: hasPdf, run: withView((v) => v.zoomTo('page-width')) },
    { id: 'pdf.fitPage', title: 'Fit page', category: 'PDF', icon: Maximize, when: hasPdf, run: withView((v) => v.zoomTo('page-fit')) },
    { id: 'pdf.openInNewWindow', title: 'Open PDF in new window', category: 'PDF', icon: ExternalLink, keywords: ['detach', 'popout', 'second monitor'], run: () => openPdfWindow() },
    { id: 'pdf.toggleFollowCursor', title: 'Toggle follow cursor', category: 'PDF', icon: LocateFixed, keywords: ['synctex', 'sync'], run: toggleFollowCursor },
    {
      id: 'pdf.syncFromCursor',
      title: 'Show cursor position in PDF',
      category: 'PDF',
      icon: ArrowRightToLine,
      keywords: ['synctex', 'forward search'],
      when: hasPdf,
      run: syncFromCursor,
    },
    {
      id: 'pdf.syncToSource',
      title: 'Go to source of visible PDF location',
      category: 'PDF',
      icon: ArrowLeftToLine,
      keywords: ['synctex', 'inverse search'],
      when: hasPdf,
      run: withView((v) => {
        const pt = v.viewportCenterPoint();
        if (pt) inverseSearch(pt);
      }),
    },
    { id: 'pdf.toggleThumbnails', title: 'Toggle page thumbnails', category: 'PDF', icon: PanelLeft, run: () => usePdfPane.setState((s) => ({ thumbnails: !s.thumbnails })) },
    {
      id: 'pdf.find',
      title: 'Find in PDF',
      category: 'PDF',
      icon: Search,
      when: hasPdf,
      run: withView((v) => {
        // Focus the viewer and replay Mod-f so the viewer opens its find bar.
        const el = v.element;
        if (!el) return;
        el.focus();
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', metaKey: isMac, ctrlKey: !isMac, bubbles: true }));
      }),
    },
  ]);

  // A forward search while the preview is hidden: open it and replay once ready.
  const unsubSync = useWorkspace.subscribe((s, prev) => {
    const r = s.pdfSyncRequest;
    if (!r || r === prev.pdfSyncRequest) return;
    const layout = useLayout.getState();
    const visible = layout.pdfOpen && layout.focusMode !== 'editor';
    if (!visible && s.compile.pdf && !usePdfPane.getState().popoutOpen) {
      setPendingForward(r.path, r.line);
      layout.set({ pdfOpen: true, focusMode: layout.focusMode === 'editor' ? 'none' : layout.focusMode });
    }
  });

  // Close the detached window when the project closes.
  const unsubSession = useWorkspace.subscribe((s, prev) => {
    if (prev.session && s.session !== prev.session) closePdfWindow();
  });

  return () => {
    untrack();
    commands.dispose();
    unsubSync();
    unsubSession();
    closePdfWindow();
  };
}
