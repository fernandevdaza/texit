/**
 * Lazy pdf.js loader. pdf.js (~400 KB) is only fetched once a PDF is shown,
 * and a single worker is shared by every document / viewer instance.
 */
import type * as PdfjsLib from 'pdfjs-dist';
import type { PDFDocumentLoadingTask, PDFWorker } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

export type Pdfjs = typeof PdfjsLib;

let libPromise: Promise<Pdfjs> | null = null;
let lib: Pdfjs | null = null;
let worker: PDFWorker | null = null;

export function loadPdfjs(): Promise<Pdfjs> {
  libPromise ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    lib = m;
    return m;
  });
  return libPromise;
}

/** The loaded library (null until `loadPdfjs()` resolved). */
export function pdfjsSync(): Pdfjs | null {
  return lib;
}

const PDFJS_ASSETS = new URL(`${import.meta.env.BASE_URL}pdfjs/`, document.baseURI).href;

/** CSS px per PDF point at 100 % zoom (96 / 72). */
export const PDF_TO_CSS = 96 / 72;

/**
 * Open a document from bytes. The bytes are copied: pdf.js transfers the
 * buffer to its worker, and the caller's array is usually shared state.
 */
export async function openPdf(data: Uint8Array): Promise<PDFDocumentLoadingTask> {
  const pdfjs = await loadPdfjs();
  if (!worker || worker.destroyed) worker = new pdfjs.PDFWorker({ name: 'texit-pdf' } as never);
  return pdfjs.getDocument({
    data: data.slice(),
    worker,
    verbosity: 0,
    // GPU-backed canvases: much smoother scrolling/compositing of many pages.
    enableHWA: true,
    // We never run PDF JavaScript or render XFA forms.
    enableXfa: false,
    isEvalSupported: false,
    // Runtime assets served by the `texit-pdfjs-assets` Vite plugin (non-embedded fonts, CJK CMaps, JPX/JBIG2 decoders).
    standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
    cMapUrl: `${PDFJS_ASSETS}cmaps/`,
    cMapPacked: true,
    iccUrl: `${PDFJS_ASSETS}iccs/`,
    wasmUrl: `${PDFJS_ASSETS}wasm/`,
  } as Parameters<Pdfjs['getDocument']>[0]);
}

/** Whether an error is pdf.js telling us a render/text task was cancelled. */
export function isCancelled(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'RenderingCancelledException' || name === 'AbortException';
}
