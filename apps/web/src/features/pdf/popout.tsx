/**
 * "Open in new window": a detached, live preview window (second monitor
 * friendly). The window is same-origin `about:blank`; we render the preview
 * into it with a React root owned by this (main) window, so it shares the
 * stores — it updates on every compile and SyncTeX works in both directions.
 * Falls back to opening the PDF bytes in a new tab when pop-ups are blocked.
 */
import { createRoot, type Root } from 'react-dom/client';
import { useWorkspace } from '@/state/workspace';
import { useCommands } from '@/services/commands';
import { matchesKeybinding } from '@/lib/platform';
import { toast } from '@/ui';
import { usePdfPane } from './controller';
import { pdfFileName } from './actions';

let popout: { win: Window; root: Root; cleanup: () => void } | null = null;

export function isPdfWindowOpen() {
  return !!popout && !popout.win.closed;
}

export function closePdfWindow() {
  if (!popout) return;
  const p = popout;
  popout = null;
  p.cleanup();
  try {
    p.win.close();
  } catch {
    /* ignore */
  }
}

function openBytesInTab(): boolean {
  const pdf = useWorkspace.getState().compile.pdf;
  if (!pdf) return false;
  const url = URL.createObjectURL(new Blob([pdf as BlobPart], { type: 'application/pdf' }));
  const w = window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return !!w;
}

export function openPdfWindow() {
  if (popout && !popout.win.closed) {
    popout.win.focus();
    return;
  }
  const win = window.open('', 'texit-pdf-preview', 'popup=yes,width=900,height=1120');
  if (!win || !win.document) {
    if (!openBytesInTab()) toast('Could not open a new window', { description: 'Allow pop-ups for TexIt and try again.' });
    return;
  }
  mountPdfWindow(win);
  win.focus();
}

/** Render the live preview into a blank same-origin window (exported for tests: works with an iframe's window too). */
export function mountPdfWindow(win: Window) {
  const doc = win.document;
  doc.open();
  doc.write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body></body></html>');
  doc.close();

  // Styles: copy every stylesheet, and keep copying new ones (lazy chunks, HMR).
  const cloneStyle = (n: Node) => {
    if (n instanceof HTMLStyleElement) {
      const s = doc.createElement('style');
      s.textContent = n.textContent;
      doc.head.append(s);
    } else if (n instanceof HTMLLinkElement && n.rel === 'stylesheet') {
      const l = doc.createElement('link');
      l.rel = 'stylesheet';
      l.href = n.href;
      doc.head.append(l);
    }
  };
  document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(cloneStyle);
  const headObs = new MutationObserver((records) => records.forEach((r) => r.addedNodes.forEach(cloneStyle)));
  headObs.observe(document.head, { childList: true });

  // Theme: mirror <html class="dark"> and the accent CSS variables.
  const syncRoot = () => {
    doc.documentElement.className = document.documentElement.className;
    doc.documentElement.style.cssText = document.documentElement.style.cssText;
  };
  syncRoot();
  const rootObs = new MutationObserver(syncRoot);
  rootObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });

  const syncTitle = () => {
    doc.title = `${pdfFileName()} — TexIt`;
  };
  syncTitle();
  const unsubTitle = useWorkspace.subscribe((s, p) => s.meta !== p.meta && syncTitle());

  doc.body.style.cssText = 'margin:0;height:100vh;overflow:hidden';
  const container = doc.createElement('div');
  container.style.height = '100%';
  doc.body.append(container);

  // Global shortcuts (compile, toggle panels…) also work from the detached window.
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    for (const cmd of Object.values(useCommands.getState().commands)) {
      if (!cmd.global || !cmd.keybinding) continue;
      if (cmd.keybinding.split(/\s*\|\s*/).some((kb) => matchesKeybinding(e, kb)) && (!cmd.when || cmd.when())) {
        e.preventDefault();
        void cmd.run();
        return;
      }
    }
  };
  win.addEventListener('keydown', onKey);

  const root = createRoot(container);
  void import('./PdfPane').then(({ PdfPreview }) => {
    if (popout?.root !== root) return;
    root.render(
      <div className="h-full bg-pdf-bg font-sans text-[13px] text-fg antialiased">
        <PdfPreview id="popout" detached />
      </div>,
    );
  });

  const onMainUnload = () => closePdfWindow();
  window.addEventListener('pagehide', onMainUnload);

  const cleanup = () => {
    headObs.disconnect();
    rootObs.disconnect();
    unsubTitle();
    window.removeEventListener('pagehide', onMainUnload);
    win.removeEventListener('keydown', onKey);
    try {
      root.unmount();
    } catch {
      /* window already gone */
    }
    usePdfPane.setState({ popoutOpen: false });
  };
  popout = { win, root, cleanup };
  win.addEventListener('pagehide', () => {
    if (popout?.win === win) {
      popout = null;
      cleanup();
    }
  });
  usePdfPane.setState({ popoutOpen: true });
}
