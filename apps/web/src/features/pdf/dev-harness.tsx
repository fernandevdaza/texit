/**
 * Dev-only test harness for the PDF viewer, mounted by
 * `public/__test__/viewer.html` (not imported by the app, so never bundled).
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@/index.css';
import { TooltipProvider } from '@/ui';
import { useSettings } from '@/state/settings';
import { PdfViewer } from './PdfViewer';
import type { PdfView } from './engine';

declare global {
  interface Window {
    __harness?: {
      files: Record<string, Uint8Array>;
      view: PdfView | null;
      setDoc: (key: string) => void;
      settings: typeof useSettings;
      lastInverse?: unknown;
    };
  }
}

export async function mountHarness(el: HTMLElement) {
  const params = new URLSearchParams(location.search);
  if (params.get('dark')) document.documentElement.classList.add('dark');
  if (params.get('raf') === 'timer') {
    // Automated runs in a hidden browser pane: rAF never fires there.
    window.requestAnimationFrame = (cb) => window.setTimeout(() => cb(performance.now()), 16);
    window.cancelAnimationFrame = (id) => clearTimeout(id);
    Object.defineProperty(document, 'visibilityState', { get: () => 'visible' });
  }
  const load = async (u: string) => new Uint8Array(await (await fetch(u)).arrayBuffer());
  const files: Record<string, Uint8Array> = { v1: await load('/__test__/sample-v1.pdf'), v2: await load('/__test__/sample-v2.pdf'), big: await load('/__test__/sample-big.pdf') };
  const h: NonNullable<Window['__harness']> = { files, view: null, setDoc: () => {}, settings: useSettings };
  window.__harness = h;
  const side = Number(params.get('w') ?? 720);

  function App() {
    const [doc, setDoc] = useState({ data: files.v1, version: 1 });
    h.setDoc = (k) => setDoc((d) => ({ data: files[k], version: d.version + 1 }));
    return (
      <div className="flex h-full bg-bg">
        <div style={{ width: side }} className="shrink-0 border-r border-border" />
        <div className="min-w-0 flex-1">
          <PdfViewer
            data={doc.data}
            version={doc.version}
            fileName="sample.pdf"
            viewRef={(v) => (h.view = v)}
            onInverseSearch={(pt) => (h.lastInverse = pt)}
            menuItems={[{ label: 'Example item', onSelect: () => {} }]}
          />
        </div>
      </div>
    );
  }
  createRoot(el).render(
    <TooltipProvider>
      <App />
    </TooltipProvider>,
  );
}
