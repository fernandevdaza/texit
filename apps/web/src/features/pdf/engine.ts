/**
 * PdfView — a custom, imperative, virtualized PDF renderer built on the
 * pdf.js core API (no PDFViewer component).
 *
 * Why custom: the #1 requirement is a flicker-free recompile. A new version
 * is loaded offscreen, laid out, and its visible pages are rendered into
 * detached canvases; then the whole page container is swapped in a single
 * task while the scroll position is restored (page + relative offset). pdf.js'
 * PDFViewer clears all pages on `setDocument`, which flashes.
 *
 * Other highlights:
 *  - pages are absolutely positioned (positions computed here, never read
 *    back from the DOM), only pages near the viewport get canvases / text
 *    layers, canvases are capped (memory) and evicted beyond a pixel budget;
 *  - zoom keeps the old bitmaps CSS-scaled and re-renders once the zoom
 *    settles (smooth pinch), anchored at the pointer;
 *  - at high zoom a "detail" canvas renders just the visible region at full
 *    resolution so text stays crisp without giant canvases;
 *  - text layer (selection / copy), annotation layer (links), find, SyncTeX
 *    highlights, back/forward history for internal links.
 */
import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import type { TextContent } from 'pdfjs-dist/types/src/display/api';
import { isCancelled, loadPdfjs, openPdf, PDF_TO_CSS, type Pdfjs } from './pdfjs';
import { buildPageIndex, buildRegex, findInPage, itemRanges, type FindOptions, type PageMatch, type PageTextIndex } from './find';
import { createLinkService, openExternalUrl } from './links';

export type ZoomMode = 'page-width' | 'page-fit' | 'auto';
export type Zoom = ZoomMode | number;

/** A point in PDF points (1/72 in), origin at the top-left of the page. Page is 1-based. */
export interface PdfPoint {
  page: number;
  x: number;
  y: number;
}
export interface PdfRect extends PdfPoint {
  width: number;
  height: number;
}

export interface FindState {
  query: string;
  total: number;
  /** 1-based index of the selected match (0 = none). */
  current: number;
  searching: boolean;
}

export interface PdfViewState {
  status: 'empty' | 'loading' | 'ready' | 'error';
  error: string | null;
  numPages: number;
  /** Current page (1-based). */
  page: number;
  /** Effective zoom factor (1 = 100 %). */
  scale: number;
  /** Requested zoom (a fit mode or a fixed factor). */
  zoom: Zoom;
  /** A new version is being prepared in the background. */
  reloading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  /** Bumped every time a new document is swapped in. */
  docVersion: number;
  find: FindState;
}

/** A reading position that survives document swaps and remounts. */
export interface PdfPosition {
  page: number;
  /** Fraction of the page height at the top of the viewport. */
  fy: number;
  fx?: number;
}

export interface PdfViewOptions {
  /** Position used for the very first document (e.g. restored after a remount). */
  initialPosition?: PdfPosition | null;
  /** Inverse search request (double-click when enabled, or Mod-click). */
  onInverse?: (pt: PdfPoint, ev: MouseEvent) => void;
  /** Whether double-click triggers `onInverse`. */
  doubleClickInverse?: () => boolean;
}

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 5;
export const ZOOM_PRESETS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];
const ZOOM_LADDER = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

const PAD_X = 14;
const PAD_Y = 14;
const GAP = 12;
/** Max pixels of one canvas (≈ 64 MB RGBA). */
const MAX_CANVAS_PIXELS = 16_777_216;
/** Total pixels kept alive across rendered canvases. */
const PIXEL_BUDGET = 56_000_000;
const ZOOM_SETTLE_MS = 180;
const MAX_INFLIGHT = 2;
/** Visible pages of a new version must render within this budget before the swap. */
const SWAP_RENDER_BUDGET_MS = 1500;
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function releaseCanvas(c: HTMLCanvasElement | null | undefined) {
  if (!c) return;
  c.width = 0;
  c.height = 0;
  c.remove();
}

function sameBytes(a: Uint8Array, b: Uint8Array) {
  if (a === b) return true;
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface Detail {
  canvas: HTMLCanvasElement;
  task: RenderTask;
  k: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

class Slot {
  readonly el: HTMLDivElement;
  readonly paper: HTMLDivElement;
  readonly overlay: HTMLDivElement;
  top = 0;
  left = 0;
  width = 0;
  height = 0;
  canvas: HTMLCanvasElement | null = null;
  canvasK = 0;
  /** Rendered below the device pixel ratio because of the canvas cap. */
  capped = false;
  task: RenderTask | null = null;
  taskK = 0;
  taskPromise: Promise<void> | null = null;
  /** High-resolution tile of the visible region (shown) and the one being rendered. */
  detail: Detail | null = null;
  detailPending: Detail | null = null;
  textState: 0 | 1 | 2 = 0;
  textEl: HTMLDivElement | null = null;
  textLayer: TextLayer | null = null;
  textK = 0;
  annoState: 0 | 1 | 2 = 0;
  annoEl: HTMLDivElement | null = null;
  /** Text-div indices currently wrapped with find highlights. */
  hlDivs: number[] = [];

  constructor(
    readonly index: number,
    readonly proxy: PDFPageProxy,
    readonly wPt: number,
    readonly hPt: number,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'tx-pdf-page';
    this.el.dataset.page = String(index + 1);
    this.paper = document.createElement('div');
    this.paper.className = 'tx-pdf-paper';
    this.overlay = document.createElement('div');
    this.overlay.className = 'tx-pdf-overlay';
    this.el.append(this.paper, this.overlay);
  }

  applyLayout() {
    const s = this.el.style;
    s.transform = `translate(${this.left}px, ${this.top}px)`;
    s.width = `${this.width}px`;
    s.height = `${this.height}px`;
  }

  cancelRender() {
    if (this.task) {
      this.task.cancel();
      this.task = null;
    }
  }

  get pixels() {
    const c = this.canvas;
    const d = this.detail?.canvas;
    return (c ? c.width * c.height : 0) + (d ? d.width * d.height : 0);
  }

  dropDetail() {
    if (this.detailPending) {
      this.detailPending.task.cancel();
      releaseCanvas(this.detailPending.canvas);
      this.detailPending = null;
    }
    if (this.detail) {
      releaseCanvas(this.detail.canvas);
      this.detail = null;
    }
  }

  dropCanvas() {
    this.cancelRender();
    this.dropDetail();
    releaseCanvas(this.canvas);
    this.canvas = null;
    this.canvasK = 0;
    this.paper.classList.remove('is-rendered');
  }

  dropLayers() {
    this.textLayer?.cancel();
    this.textLayer = null;
    this.textEl?.remove();
    this.textEl = null;
    this.textState = 0;
    this.hlDivs = [];
    this.annoEl?.remove();
    this.annoEl = null;
    this.annoState = 0;
  }

  dispose() {
    this.dropCanvas();
    this.dropLayers();
    this.overlay.replaceChildren();
  }
}

class Doc {
  readonly pagesEl: HTMLDivElement;
  readonly slots: Slot[];
  disposed = false;
  /** CSS px per PDF point used by the last layout. */
  k = 0;
  scale = 1;
  /** Viewport width used by the last layout. */
  layoutWidth = -1;
  private tc = new Map<number, Promise<TextContent>>();
  readonly idx = new Map<number, PageTextIndex>();
  private refCache = new Map<string, number>();

  constructor(
    readonly doc: PDFDocumentProxy,
    readonly task: PDFDocumentLoadingTask,
    readonly bytes: Uint8Array,
    proxies: PDFPageProxy[],
  ) {
    this.pagesEl = document.createElement('div');
    this.pagesEl.className = 'tx-pdf-pages';
    this.slots = proxies.map((p, i) => {
      const vp = p.getViewport({ scale: 1 });
      return new Slot(i, p, vp.width, vp.height);
    });
    this.pagesEl.append(...this.slots.map((s) => s.el));
  }

  textContent(i: number): Promise<TextContent> {
    let p = this.tc.get(i);
    if (!p) {
      p = this.slots[i].proxy.getTextContent();
      this.tc.set(i, p);
    }
    return p;
  }

  async textIndex(i: number): Promise<PageTextIndex> {
    let x = this.idx.get(i);
    if (!x) {
      x = buildPageIndex(await this.textContent(i));
      this.idx.set(i, x);
    }
    return x;
  }

  async pageIndexForRef(ref: { num: number; gen: number }): Promise<number> {
    const key = `${ref.num}R${ref.gen}`;
    const cached = this.refCache.get(key);
    if (cached !== undefined) return cached;
    const i = await this.doc.getPageIndex(ref);
    this.refCache.set(key, i);
    return i;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const s of this.slots) s.dispose();
    this.pagesEl.remove();
    void this.task.destroy();
  }
}

interface Anchor {
  index: number;
  fx: number;
  fy: number;
  vx: number;
  vy: number;
}

const initialFind: FindState = { query: '', total: 0, current: 0, searching: false };

const initialState: PdfViewState = {
  status: 'empty',
  error: null,
  numPages: 0,
  page: 1,
  scale: 1,
  zoom: 'page-width',
  reloading: false,
  canGoBack: false,
  canGoForward: false,
  docVersion: 0,
  find: initialFind,
};

export class PdfView {
  private state: PdfViewState = initialState;
  private listeners = new Set<() => void>();
  private sc: HTMLDivElement | null = null;
  private lib: Pdfjs | null = null;
  private cur: Doc | null = null;
  private next: Doc | null = null;
  private loadGen = 0;
  private data: Uint8Array | null = null;
  private pendingData: Uint8Array | null = null;
  private zoom: Zoom = 'page-width';
  private scale = 1;
  private raf = 0;
  private settleTimer = 0;
  private zoomingUntil = 0;
  private ro: ResizeObserver | null = null;
  private ac: AbortController | null = null;
  private pendingZoom: { factor: number; x: number; y: number } | null = null;
  private zoomRaf = 0;
  private resizeRaf = 0;
  private gestureScale = 1;
  private backStack: Anchor[] = [];
  private fwdStack: Anchor[] = [];
  private dprQuery: MediaQueryList | null = null;
  private linkService: ReturnType<typeof createLinkService>;
  // find
  private findGen = 0;
  private findRe: RegExp | null = null;
  private findOpts: FindOptions = {};
  private matches: PageMatch[] = [];
  private matchIdx = -1;
  private pageMatchRange = new Map<number, [number, number]>();
  // highlight
  private hlEls: HTMLElement[] = [];
  private hlTimer = 0;

  constructor(public options: PdfViewOptions = {}) {
    const self = this;
    this.linkService = createLinkService({
      goToDestination: (d) => void self.goToDestination(d),
      goToPage: (n) => self.goToPage(n, { history: true }),
      executeNamedAction: (a) => self.namedAction(a),
      get pagesCount() {
        return self.numPages;
      },
      get page() {
        return self.state.page;
      },
    });
  }

  // ───────────────────────────── store ─────────────────────────────

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.state;

  private set(patch: Partial<PdfViewState>) {
    let changed = false;
    for (const key in patch) {
      if ((patch as Record<string, unknown>)[key] !== (this.state as unknown as Record<string, unknown>)[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  private setFind(patch: Partial<FindState>) {
    this.set({ find: { ...this.state.find, ...patch } });
  }

  // ───────────────────────────── lifecycle ─────────────────────────────

  get element() {
    return this.sc;
  }

  private get win(): Window {
    return this.sc?.ownerDocument.defaultView ?? window;
  }

  private get k() {
    return this.scale * PDF_TO_CSS;
  }

  private get dpr() {
    return this.win.devicePixelRatio || 1;
  }

  attach(el: HTMLDivElement) {
    if (this.sc === el) return;
    this.detach();
    this.sc = el;
    const ac = (this.ac = new AbortController());
    const opt = { signal: ac.signal };
    el.addEventListener('scroll', this.onScroll, { passive: true, signal: ac.signal });
    el.addEventListener('wheel', this.onWheel, { passive: false, signal: ac.signal });
    el.addEventListener('gesturestart', this.onGestureStart as EventListener, { passive: false, signal: ac.signal });
    el.addEventListener('gesturechange', this.onGestureChange as EventListener, { passive: false, signal: ac.signal });
    el.addEventListener('gestureend', this.onGestureEnd as EventListener, { passive: false, signal: ac.signal });
    el.addEventListener('dblclick', this.onDblClick, opt);
    el.addEventListener('click', this.onClick, opt);
    el.addEventListener('mousedown', this.onMouseDown, opt);
    el.addEventListener('copy', this.onCopy, opt);
    el.ownerDocument.addEventListener('pointerup', this.onPointerUp, opt);
    const RO = (this.win as Window & typeof globalThis).ResizeObserver ?? ResizeObserver;
    this.ro = new RO(() => this.onResize());
    this.ro.observe(el);
    this.watchDpr();
    const data = this.data;
    this.data = null;
    if (data) void this.setDocument(data);
  }

  detach() {
    if (!this.sc) return;
    this.ac?.abort();
    this.ac = null;
    this.ro?.disconnect();
    this.ro = null;
    this.dprQuery = null;
    cancelAnimationFrame(this.raf);
    cancelAnimationFrame(this.zoomRaf);
    cancelAnimationFrame(this.resizeRaf);
    this.raf = this.zoomRaf = this.resizeRaf = 0;
    clearTimeout(this.settleTimer);
    clearTimeout(this.hlTimer);
    this.loadGen++;
    this.pendingData = null;
    this.findGen++;
    this.next?.dispose();
    this.next = null;
    this.cur?.dispose();
    this.cur = null;
    this.sc = null;
    // Keep `data` so a re-attach (React StrictMode) reloads it.
    this.state = { ...this.state, status: this.data ? 'loading' : 'empty', reloading: false };
  }

  destroy() {
    this.data = null;
    this.detach();
    this.listeners.clear();
  }

  private watchDpr() {
    if (!this.ac) return;
    const q = this.win.matchMedia(`(resolution: ${this.dpr}dppx)`);
    this.dprQuery = q;
    q.addEventListener(
      'change',
      () => {
        if (this.dprQuery !== q) return;
        // Moved to a screen with another pixel ratio: re-render everything.
        for (const s of this.cur?.slots ?? []) s.canvasK = -1;
        this.watchDpr();
        this.scheduleUpdate();
      },
      { once: true, signal: this.ac.signal },
    );
  }

  // ───────────────────────────── document ─────────────────────────────

  /** Show a document. When a document is already shown, the new one is swapped in without flicker. */
  async setDocument(data: Uint8Array | null): Promise<void> {
    if (data === this.data && (!data || this.cur?.bytes === data || this.pendingData === data)) return;
    this.data = data;
    const gen = ++this.loadGen;
    this.pendingData = null;
    if (!data) {
      this.next?.dispose();
      this.next = null;
      this.cur?.dispose();
      this.cur = null;
      this.set({ status: 'empty', numPages: 0, reloading: false, error: null });
      return;
    }
    if (!this.sc) return;
    if (this.cur && sameBytes(this.cur.bytes, data)) {
      this.set({ reloading: false });
      return;
    }
    if (this.cur) this.set({ reloading: true });
    else this.set({ status: 'loading', error: null });
    let task: PDFDocumentLoadingTask | null = null;
    this.pendingData = data;
    try {
      this.lib = await loadPdfjs();
      if (gen !== this.loadGen) return;
      task = await openPdf(data);
      const doc = await task.promise;
      if (gen !== this.loadGen) {
        void task.destroy();
        return;
      }
      const proxies = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
      if (gen !== this.loadGen) {
        void task.destroy();
        return;
      }
      const D = new Doc(doc, task, data, proxies);
      this.next?.dispose();
      this.next = D;
      await this.prepare(D);
      if (gen !== this.loadGen || D.disposed) {
        if (this.next === D) this.next = null;
        D.dispose();
        return;
      }
      this.pendingData = null;
      this.swap(D);
    } catch (err) {
      if (gen !== this.loadGen) return;
      this.pendingData = null;
      if (task) void task.destroy();
      if (this.next && !this.next.disposed && this.next.task === task) {
        this.next.dispose();
        this.next = null;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (this.cur) {
        console.warn('[pdf] could not load the new version, keeping the previous one', err);
        this.set({ reloading: false });
      } else {
        this.set({ status: 'error', error: message, reloading: false });
      }
    }
  }

  /** Lay out a new document offscreen and render the pages that will be visible after the swap. */
  private async prepare(D: Doc) {
    // pdf.js paces rendering with requestAnimationFrame, which is paused in
    // hidden windows: keep showing the old version until we can render the new one.
    await this.whenVisible(D);
    if (D.disposed || !this.sc) return;
    const sc = this.sc;
    this.layoutDoc(D, this.resolveScale(this.zoom, D));
    const target = this.cur ? this.mapPosition(this.cur, D) : this.initialTarget(D);
    const [first, last] = this.visibleRange(D, target.top, target.top + sc.clientHeight);
    const jobs: Promise<void>[] = [];
    for (let i = first; i <= last && i - first < 6; i++) jobs.push(this.renderSlot(D, D.slots[i], D.k));
    await Promise.race([Promise.all(jobs), sleep(SWAP_RENDER_BUDGET_MS)]);
  }

  private whenVisible(D: Doc): Promise<void> {
    const doc = this.sc?.ownerDocument;
    if (!doc || doc.visibilityState !== 'hidden' || !this.cur) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (doc.visibilityState !== 'hidden' || D.disposed || !this.sc) {
          doc.removeEventListener('visibilitychange', check);
          clearInterval(poll);
          resolve();
        }
      };
      const poll = window.setInterval(check, 1000);
      doc.addEventListener('visibilitychange', check);
    });
  }

  private swap(D: Doc) {
    const sc = this.sc!;
    const old = this.cur;
    // Zoom or size may have changed while preparing.
    const scale = this.resolveScale(this.zoom, D);
    if (Math.abs(scale * PDF_TO_CSS - D.k) > 1e-6 || D.layoutWidth !== sc.clientWidth) this.layoutDoc(D, scale);
    const pos = old ? this.mapPosition(old, D) : this.initialTarget(D);
    this.options.initialPosition = null;
    this.scale = D.scale;
    this.cur = D;
    this.next = null;
    sc.append(D.pagesEl);
    if (old) old.pagesEl.remove();
    sc.scrollTop = pos.top;
    sc.scrollLeft = pos.left;
    old?.dispose();
    this.backStack = [];
    this.fwdStack = [];
    this.clearHighlight();
    this.set({
      status: 'ready',
      error: null,
      reloading: false,
      numPages: D.slots.length,
      scale: this.scale,
      zoom: this.zoom,
      docVersion: this.state.docVersion + 1,
      canGoBack: false,
      canGoForward: false,
    });
    this.update();
    if (this.findRe) void this.runFind(true);
  }

  private initialTarget(D: Doc): { top: number; left: number } {
    const p = this.options.initialPosition;
    const s = p && D.slots[clamp(p.page - 1, 0, D.slots.length - 1)];
    if (!p || !s) return { top: 0, left: 0 };
    return { top: Math.max(0, s.top + p.fy * s.height), left: Math.max(0, s.left + (p.fx ?? 0) * s.width) };
  }

  /** Current reading position (top-left of the viewport). */
  savePosition(): PdfPosition | null {
    const D = this.cur;
    const a = D && this.captureAnchor(D, 0, 0);
    return a ? { page: a.index + 1, fy: a.fy, fx: a.fx } : null;
  }

  /** Map the current reading position of `from` (top-left of the viewport) onto `to`. */
  private mapPosition(from: Doc, to: Doc): { top: number; left: number } {
    const a = this.captureAnchor(from, 0, 0);
    if (!a) return { top: 0, left: 0 };
    const s = to.slots[Math.min(a.index, to.slots.length - 1)];
    if (!s) return { top: 0, left: 0 };
    return { top: Math.max(0, s.top + a.fy * s.height), left: Math.max(0, s.left + a.fx * s.width) };
  }

  // ───────────────────────────── layout ─────────────────────────────

  private layoutDoc(D: Doc, scale: number) {
    const sc = this.sc;
    const k = scale * PDF_TO_CSS;
    const cw = sc?.clientWidth ?? 0;
    let maxW = 0;
    for (const s of D.slots) {
      s.width = Math.floor(s.wPt * k);
      s.height = Math.floor(s.hPt * k);
      if (s.width > maxW) maxW = s.width;
    }
    const contentW = Math.max(cw, maxW + 2 * PAD_X);
    let y = PAD_Y;
    for (const s of D.slots) {
      s.top = y;
      s.left = Math.floor((contentW - s.width) / 2);
      y += s.height + GAP;
      s.applyLayout();
    }
    const contentH = D.slots.length ? y - GAP + PAD_Y : 0;
    const st = D.pagesEl.style;
    st.width = `${contentW}px`;
    st.height = `${contentH}px`;
    st.setProperty('--scale-factor', String(k));
    D.k = k;
    D.scale = scale;
    D.layoutWidth = cw;
  }

  private resolveScale(zoom: Zoom, D: Doc | null = this.cur): number {
    if (typeof zoom === 'number') return clamp(zoom, ZOOM_MIN, ZOOM_MAX);
    if (!D || !D.slots.length || !this.sc) return this.scale;
    let cw = this.sc.clientWidth;
    let ch = this.sc.clientHeight;
    if (cw < 40 || ch < 40) {
      // Not laid out yet (hidden pane): keep a sane default until the resize observer fires.
      cw = Math.max(cw, 800);
      ch = Math.max(ch, 1000);
    }
    let maxW = 0;
    for (const s of D.slots) maxW = Math.max(maxW, s.wPt);
    const ref = D.slots[clamp(this.state.page - 1, 0, D.slots.length - 1)];
    const widthScale = (cw - 2 * PAD_X) / (maxW * PDF_TO_CSS);
    const pageScale = Math.min((cw - 2 * PAD_X) / (ref.wPt * PDF_TO_CSS), (ch - 2 * PAD_Y) / (ref.hPt * PDF_TO_CSS));
    let v: number;
    if (zoom === 'page-width') v = widthScale;
    else if (zoom === 'page-fit') v = pageScale;
    else v = ref.wPt > ref.hPt ? Math.min(pageScale, widthScale) : Math.min(widthScale, 1.25);
    return clamp(v, 0.1, ZOOM_MAX);
  }

  private visibleRange(D: Doc, top: number, bottom: number): [number, number] {
    const slots = D.slots;
    if (!slots.length) return [0, -1];
    let lo = 0;
    let hi = slots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (slots[mid].top + slots[mid].height < top) lo = mid + 1;
      else hi = mid;
    }
    let last = lo;
    while (last + 1 < slots.length && slots[last + 1].top < bottom) last++;
    return [lo, last];
  }

  private slotAtY(D: Doc, y: number): number {
    const slots = D.slots;
    let lo = 0;
    let hi = slots.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (slots[mid].top - GAP / 2 <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private captureAnchor(D: Doc, vx: number, vy: number): Anchor | null {
    const sc = this.sc;
    if (!sc || !D.slots.length) return null;
    const cx = sc.scrollLeft + vx;
    const cy = sc.scrollTop + vy;
    const i = this.slotAtY(D, cy);
    const s = D.slots[i];
    return { index: i, fx: (cx - s.left) / (s.width || 1), fy: (cy - s.top) / (s.height || 1), vx, vy };
  }

  private restoreAnchor(D: Doc, a: Anchor) {
    const sc = this.sc;
    if (!sc) return;
    const s = D.slots[Math.min(a.index, D.slots.length - 1)];
    if (!s) return;
    sc.scrollLeft = s.left + a.fx * s.width - a.vx;
    sc.scrollTop = s.top + a.fy * s.height - a.vy;
  }

  // ───────────────────────────── zoom ─────────────────────────────

  /** Set the zoom. `anchor` (client coords) stays fixed on screen; defaults to the viewport center. */
  zoomTo(zoom: Zoom, anchor?: { clientX: number; clientY: number }) {
    this.zoom = typeof zoom === 'number' ? clamp(zoom, ZOOM_MIN, ZOOM_MAX) : zoom;
    const D = this.cur;
    if (!D) {
      this.set({ zoom: this.zoom });
      return;
    }
    this.applyScale(this.resolveScale(this.zoom, D), anchor);
  }

  zoomIn() {
    const s = this.scale;
    this.zoomTo(ZOOM_LADDER.find((z) => z > s * 1.01) ?? ZOOM_MAX);
  }

  zoomOut() {
    const s = this.scale;
    this.zoomTo([...ZOOM_LADDER].reverse().find((z) => z < s * 0.99) ?? ZOOM_MIN);
  }

  private applyScale(scale: number, anchor?: { clientX: number; clientY: number }, transient = false) {
    const D = this.cur;
    const sc = this.sc;
    if (!D || !sc) return;
    const rect = sc.getBoundingClientRect();
    const vx = anchor ? anchor.clientX - rect.left : sc.clientWidth / 2;
    const vy = anchor ? anchor.clientY - rect.top : sc.clientHeight / 2;
    const a = this.captureAnchor(D, vx, vy);
    const changed = Math.abs(scale - D.scale) > 1e-6;
    if (changed) {
      for (const s of D.slots) s.dropDetail();
      this.layoutDoc(D, scale);
      if (a) this.restoreAnchor(D, a);
      this.zoomingUntil = performance.now() + (transient ? ZOOM_SETTLE_MS : 60);
    }
    this.scale = scale;
    this.set({ scale, zoom: this.zoom });
    this.scheduleUpdate();
  }

  private onWheel = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey) || !this.cur) return;
    e.preventDefault();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= 100;
    // Discrete mouse-wheel notches zoom by a fixed step; trackpad pinch is continuous.
    const discrete = e.deltaMode !== 0 || (Number.isInteger(e.deltaY) && Math.abs(dy) >= 50);
    const factor = discrete ? (dy < 0 ? 1.15 : 1 / 1.15) : Math.exp(-dy * 0.01);
    this.queueZoom(factor, e.clientX, e.clientY);
  };

  private queueZoom(factor: number, x: number, y: number) {
    if (this.pendingZoom) {
      this.pendingZoom.factor *= factor;
      this.pendingZoom.x = x;
      this.pendingZoom.y = y;
    } else this.pendingZoom = { factor, x, y };
    if (!this.zoomRaf)
      this.zoomRaf = this.win.requestAnimationFrame(() => {
        this.zoomRaf = 0;
        const p = this.pendingZoom;
        this.pendingZoom = null;
        if (!p) return;
        const scale = clamp(this.scale * p.factor, ZOOM_MIN, ZOOM_MAX);
        this.zoom = scale;
        this.applyScale(scale, { clientX: p.x, clientY: p.y }, true);
      });
  }

  // Safari trackpad pinch.
  private onGestureStart = (e: Event & { scale?: number }) => {
    e.preventDefault();
    this.gestureScale = 1;
  };
  private onGestureChange = (e: Event & { scale?: number; clientX?: number; clientY?: number }) => {
    e.preventDefault();
    const s = e.scale ?? 1;
    const factor = s / this.gestureScale;
    this.gestureScale = s;
    this.queueZoom(factor, e.clientX ?? 0, e.clientY ?? 0);
  };
  private onGestureEnd = (e: Event) => {
    e.preventDefault();
  };

  private onResize() {
    if (this.resizeRaf) return;
    this.resizeRaf = this.win.requestAnimationFrame(() => {
      this.resizeRaf = 0;
      const D = this.cur;
      const sc = this.sc;
      if (!D || !sc) return;
      const a = this.captureAnchor(D, 0, 0);
      const scale = this.resolveScale(this.zoom, D);
      this.layoutDoc(D, scale);
      if (a) this.restoreAnchor(D, a);
      if (Math.abs(scale - this.scale) > 1e-6) {
        for (const s of D.slots) s.dropDetail();
        this.zoomingUntil = performance.now() + ZOOM_SETTLE_MS;
      }
      this.scale = scale;
      this.set({ scale });
      this.scheduleUpdate();
    });
  }

  // ───────────────────────────── render scheduling ─────────────────────────────

  private onScroll = () => this.scheduleUpdate();

  private scheduleUpdate() {
    if (this.raf || !this.sc) return;
    // rAF, with a timer fallback: rAF is paused in hidden/occluded windows, but
    // a swapped-in document should still finish rendering there.
    const win = this.win;
    let timer = 0;
    const run = () => {
      win.cancelAnimationFrame(this.raf);
      clearTimeout(timer);
      this.raf = 0;
      this.update();
    };
    this.raf = win.requestAnimationFrame(run);
    timer = window.setTimeout(run, 150);
  }

  private update() {
    const D = this.cur;
    const sc = this.sc;
    if (!D || !sc || !D.slots.length) return;
    const top = sc.scrollTop;
    const h = sc.clientHeight;
    const [first, last] = this.visibleRange(D, top, top + h);

    // Current page: the one occupying most of the viewport.
    let best = first;
    let bestH = -1;
    for (let i = first; i <= last; i++) {
      const s = D.slots[i];
      const vis = Math.min(s.top + s.height, top + h) - Math.max(s.top, top);
      if (vis > bestH + 1) {
        bestH = vis;
        best = i;
      }
    }
    if (top + h >= sc.scrollHeight - 2) best = last; // scrolled to the very end
    this.set({ page: best + 1 });

    const now = performance.now();
    const zooming = now < this.zoomingUntil;
    const k = D.k;
    const center = top + h / 2;
    const order: number[] = [];
    for (let i = first; i <= last; i++) order.push(i);
    order.sort((a, b) => Math.abs(D.slots[a].top + D.slots[a].height / 2 - center) - Math.abs(D.slots[b].top + D.slots[b].height / 2 - center));
    if (last + 1 < D.slots.length) order.push(last + 1);
    if (first - 1 >= 0) order.push(first - 1);
    if (last + 2 < D.slots.length) order.push(last + 2);
    const wanted = new Set(order);

    let inflight = 0;
    for (const s of D.slots) {
      if (s.task && !wanted.has(s.index)) s.cancelRender();
      if (s.task) inflight++;
      if (s.detailPending) inflight++;
    }
    for (const i of order) {
      if (inflight >= MAX_INFLIGHT) break;
      const s = D.slots[i];
      if (s.task) {
        if (s.taskK !== k && !zooming) {
          s.cancelRender();
        } else continue;
      }
      if (!s.canvas || (s.canvasK !== k && !zooming)) {
        void this.renderSlot(D, s, k);
        inflight++;
      }
    }

    if (!zooming) {
      // Crisp detail tiles for visible pages whose full canvas had to be capped.
      for (let i = first; i <= last && inflight < MAX_INFLIGHT; i++) {
        const s = D.slots[i];
        if (s.capped && s.canvasK === k && !s.task && !s.detailPending && this.needsDetail(s)) {
          this.renderDetail(D, s, k);
          inflight++;
        }
      }
      for (let i = Math.max(0, first - 1); i <= Math.min(D.slots.length - 1, last + 1); i++) this.ensureLayers(D, D.slots[i]);
    } else {
      clearTimeout(this.settleTimer);
      this.settleTimer = window.setTimeout(() => this.scheduleUpdate(), this.zoomingUntil - now + 10);
    }
    this.evict(D, first, last);
  }

  private renderSlot(D: Doc, s: Slot, k: number): Promise<void> {
    const lib = this.lib;
    if (!lib) return Promise.resolve();
    if (s.task && s.taskK === k && s.taskPromise) return s.taskPromise;
    s.cancelRender();
    const vp = s.proxy.getViewport({ scale: k });
    const area = vp.width * vp.height;
    let sx = this.dpr;
    if (area * sx * sx > MAX_CANVAS_PIXELS) sx = Math.sqrt(MAX_CANVAS_PIXELS / area);
    const canvas = document.createElement('canvas');
    canvas.className = 'tx-pdf-canvas';
    canvas.width = Math.max(1, Math.floor(vp.width * sx));
    canvas.height = Math.max(1, Math.floor(vp.height * sx));
    const task = s.proxy.render({
      canvas,
      viewport: vp,
      transform: sx !== 1 ? [sx, 0, 0, sx, 0, 0] : undefined,
      annotationMode: lib.AnnotationMode.ENABLE_FORMS,
    });
    s.task = task;
    s.taskK = k;
    const p = task.promise.then(
      () => {
        if (s.task !== task) {
          releaseCanvas(canvas);
          return;
        }
        s.task = null;
        s.taskPromise = null;
        if (D.disposed) {
          releaseCanvas(canvas);
          return;
        }
        s.dropDetail();
        if (s.canvas) s.canvas.replaceWith(canvas);
        else s.paper.prepend(canvas);
        releaseCanvas(s.canvas);
        s.canvas = canvas;
        s.canvasK = k;
        s.capped = sx < this.dpr * 0.98;
        s.paper.classList.add('is-rendered');
        if (D === this.cur) this.scheduleUpdate();
      },
      (err) => {
        releaseCanvas(canvas);
        if (s.task === task) {
          s.task = null;
          s.taskPromise = null;
        }
        if (!isCancelled(err)) console.warn('[pdf] render failed', err);
        if (D === this.cur) this.scheduleUpdate();
      },
    );
    s.taskPromise = p;
    return p;
  }

  private visibleRectOf(s: Slot, margin: number) {
    const sc = this.sc!;
    const x0 = Math.max(0, sc.scrollLeft - s.left - margin);
    const y0 = Math.max(0, sc.scrollTop - s.top - margin);
    const x1 = Math.min(s.width, sc.scrollLeft + sc.clientWidth - s.left + margin);
    const y1 = Math.min(s.height, sc.scrollTop + sc.clientHeight - s.top + margin);
    return { x: Math.floor(x0), y: Math.floor(y0), w: Math.ceil(x1 - x0), h: Math.ceil(y1 - y0) };
  }

  private needsDetail(s: Slot) {
    const v = this.visibleRectOf(s, 0);
    if (v.w <= 0 || v.h <= 0) return false;
    const d = s.detail;
    if (!d || d.k !== s.canvasK) return true;
    return v.x < d.x || v.y < d.y || v.x + v.w > d.x + d.w || v.y + v.h > d.y + d.h;
  }

  private renderDetail(D: Doc, s: Slot, k: number) {
    const lib = this.lib;
    if (!lib) return;
    const r = this.visibleRectOf(s, 200);
    if (r.w <= 0 || r.h <= 0) return;
    const dpr = this.dpr;
    const canvas = document.createElement('canvas');
    canvas.className = 'tx-pdf-detail';
    canvas.width = Math.ceil(r.w * dpr);
    canvas.height = Math.ceil(r.h * dpr);
    const cs = canvas.style;
    cs.left = `${r.x}px`;
    cs.top = `${r.y}px`;
    cs.width = `${r.w}px`;
    cs.height = `${r.h}px`;
    const task = s.proxy.render({
      canvas,
      viewport: s.proxy.getViewport({ scale: k }),
      transform: [dpr, 0, 0, dpr, -r.x * dpr, -r.y * dpr],
      annotationMode: lib.AnnotationMode.ENABLE_FORMS,
    });
    const pending: Detail = { canvas, task, k, ...r };
    s.detailPending = pending;
    task.promise.then(
      () => {
        if (s.detailPending !== pending) return releaseCanvas(canvas);
        s.detailPending = null;
        if (D.disposed || s.canvasK !== k) return releaseCanvas(canvas);
        releaseCanvas(s.detail?.canvas);
        s.paper.append(canvas);
        s.detail = pending;
        if (D === this.cur) this.scheduleUpdate();
      },
      (err) => {
        releaseCanvas(canvas);
        if (s.detailPending === pending) s.detailPending = null;
        if (!isCancelled(err)) console.warn('[pdf] detail render failed', err);
      },
    );
  }

  private evict(D: Doc, first: number, last: number) {
    let total = 0;
    for (const s of D.slots) total += s.pixels;
    if (total > PIXEL_BUDGET) {
      const far = D.slots
        .filter((s) => (s.canvas || s.detail) && (s.index < first - 1 || s.index > last + 1))
        .sort((a, b) => Math.abs(b.index - (first + last) / 2) - Math.abs(a.index - (first + last) / 2));
      for (const s of far) {
        total -= s.pixels;
        s.dropCanvas();
        if (total <= PIXEL_BUDGET) break;
      }
    }
    // Details are only useful while visible.
    for (const s of D.slots) if ((s.detail || s.detailPending) && (s.index < first || s.index > last)) s.dropDetail();
    // Keep the DOM light: drop text/annotation layers far from the viewport.
    for (const s of D.slots) if ((s.textState || s.annoState) && (s.index < first - 8 || s.index > last + 8)) s.dropLayers();
  }

  // ───────────────────────────── text & annotation layers ─────────────────────────────

  private ensureLayers(D: Doc, s: Slot) {
    const lib = this.lib;
    if (!lib) return;
    if (s.textState === 0) {
      s.textState = 1;
      D.textContent(s.index)
        .then(async (tc) => {
          if (D.disposed || s.textState !== 1) return;
          const el = document.createElement('div');
          el.className = 'textLayer';
          const layer = new lib.TextLayer({ textContentSource: tc, container: el, viewport: s.proxy.getViewport({ scale: D.k }) });
          s.textLayer = layer;
          s.textEl = el;
          await layer.render();
          if (D.disposed || s.textLayer !== layer) return;
          const end = document.createElement('div');
          end.className = 'endOfContent';
          el.append(end);
          s.paper.after(el);
          s.textState = 2;
          s.textK = D.k;
          if (D === this.cur) this.applyFindHighlights(D, s);
        })
        .catch((err) => {
          if (s.textState === 1) s.textState = 0;
          if (!isCancelled(err)) console.warn('[pdf] text layer failed', err);
        });
    } else if (s.textState === 2 && s.textLayer && Math.abs(s.textK - D.k) / D.k > 0.2) {
      // Re-measure glyph widths after a large zoom change.
      s.textLayer.update({ viewport: s.proxy.getViewport({ scale: D.k }) });
      s.textK = D.k;
    }
    if (s.annoState === 0) {
      s.annoState = 1;
      s.proxy
        .getAnnotations({ intent: 'display' })
        .then(async (annotations) => {
          if (D.disposed || s.annoState !== 1) return;
          if (!annotations.length) {
            s.annoState = 2;
            return;
          }
          const div = document.createElement('div');
          div.className = 'annotationLayer';
          const viewport = s.proxy.getViewport({ scale: D.k }).clone({ dontFlip: true });
          const layer = new lib.AnnotationLayer({
            div,
            accessibilityManager: null,
            annotationCanvasMap: null,
            annotationEditorUIManager: null,
            page: s.proxy,
            viewport,
            structTreeLayer: null,
            commentManager: null,
            linkService: this.linkService,
            annotationStorage: D.doc.annotationStorage,
          });
          await layer.render({
            annotations,
            viewport,
            div,
            page: s.proxy,
            linkService: this.linkService as never,
            renderForms: false,
            imageResourcesPath: '',
          });
          if (D.disposed || s.annoState !== 1) return;
          s.annoEl = div;
          s.overlay.before(div);
          s.annoState = 2;
        })
        .catch((err) => {
          if (s.annoState === 1) s.annoState = 0;
          console.warn('[pdf] annotation layer failed', err);
        });
    }
  }

  private onMouseDown = (e: MouseEvent) => {
    const tl = (e.target as HTMLElement | null)?.closest?.('.textLayer');
    if (tl) tl.classList.add('selecting');
  };

  private onPointerUp = () => {
    const sc = this.sc;
    if (!sc) return;
    for (const el of sc.querySelectorAll('.textLayer.selecting')) el.classList.remove('selecting');
  };

  private onCopy = (e: ClipboardEvent) => {
    const sel = this.win.getSelection();
    if (!sel || sel.isCollapsed || !e.clipboardData) return;
    const text = sel
      .toString()
      .replace(/\u0000/g, '')
      .normalize('NFKC');
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  };

  // ───────────────────────────── navigation ─────────────────────────────

  get numPages() {
    return this.cur?.slots.length ?? 0;
  }

  get currentPage() {
    return this.state.page;
  }

  private pushHistory() {
    const D = this.cur;
    if (!D) return;
    const a = this.captureAnchor(D, 0, 0);
    if (!a) return;
    this.backStack.push(a);
    if (this.backStack.length > 50) this.backStack.shift();
    this.fwdStack = [];
    this.set({ canGoBack: true, canGoForward: false });
  }

  back() {
    const D = this.cur;
    const a = this.backStack.pop();
    if (!D || !a) return;
    const here = this.captureAnchor(D, 0, 0);
    if (here) this.fwdStack.push(here);
    this.restoreAnchor(D, a);
    this.set({ canGoBack: this.backStack.length > 0, canGoForward: this.fwdStack.length > 0 });
  }

  forward() {
    const D = this.cur;
    const a = this.fwdStack.pop();
    if (!D || !a) return;
    const here = this.captureAnchor(D, 0, 0);
    if (here) this.backStack.push(here);
    this.restoreAnchor(D, a);
    this.set({ canGoBack: this.backStack.length > 0, canGoForward: this.fwdStack.length > 0 });
  }

  goToPage(n: number, opts: { history?: boolean } = {}) {
    const D = this.cur;
    const sc = this.sc;
    if (!D || !sc || !D.slots.length) return;
    const i = clamp(Math.round(n) - 1, 0, D.slots.length - 1);
    if (opts.history) this.pushHistory();
    sc.scrollTop = Math.max(0, D.slots[i].top - GAP / 2 - 2);
    this.set({ page: i + 1 });
  }

  nextPage() {
    this.goToPage(this.state.page + 1);
  }

  prevPage() {
    const D = this.cur;
    const sc = this.sc;
    if (!D || !sc) return;
    // If the current page's top is above the viewport, go to its top first.
    const s = D.slots[this.state.page - 1];
    if (s && s.top < sc.scrollTop - GAP) this.goToPage(this.state.page);
    else this.goToPage(this.state.page - 1);
  }

  /** Scroll so a point (PDF points, top-left origin) is visible. */
  scrollToPoint(pt: PdfPoint, opts: { align?: 'top' | 'center' | 'nearest'; height?: number; width?: number } = {}) {
    const D = this.cur;
    const sc = this.sc;
    if (!D || !sc) return;
    const s = D.slots[clamp(pt.page - 1, 0, D.slots.length - 1)];
    const k = D.k;
    const y = s.top + pt.y * k;
    const x = s.left + pt.x * k;
    const h = (opts.height ?? 0) * k;
    const w = (opts.width ?? 0) * k;
    const viewH = sc.clientHeight;
    const viewW = sc.clientWidth;
    const align = opts.align ?? 'center';
    let top = sc.scrollTop;
    if (align === 'top') top = y - 24;
    else if (align === 'center') top = h > viewH * 0.8 ? y - 32 : y + h / 2 - viewH / 2;
    else if (y < top + 24 || y + h > top + viewH - 24) top = h > viewH * 0.8 ? y - 32 : y + h / 2 - viewH / 2;
    sc.scrollTop = Math.max(0, top);
    if (x < sc.scrollLeft || x + w > sc.scrollLeft + viewW) sc.scrollLeft = Math.max(0, x + w / 2 - viewW / 2);
  }

  private async goToDestination(dest: string | unknown[]) {
    const D = this.cur;
    if (!D) return;
    try {
      const explicit = typeof dest === 'string' ? await D.doc.getDestination(dest) : dest;
      if (!Array.isArray(explicit) || D !== this.cur) return;
      const ref = explicit[0] as unknown;
      let index: number;
      if (ref && typeof ref === 'object') index = await D.pageIndexForRef(ref as { num: number; gen: number });
      else if (Number.isInteger(ref)) index = ref as number;
      else return;
      if (D !== this.cur || !D.slots[index]) return;
      const kind = (explicit[1] as { name?: string } | undefined)?.name;
      const args = explicit.slice(2) as (number | null)[];
      let px: number | null = null;
      let py: number | null = null;
      if (kind === 'XYZ') [px, py] = [args[0], args[1]];
      else if (kind === 'FitH' || kind === 'FitBH') py = args[0];
      else if (kind === 'FitR') [px, py] = [args[0], args[3]];
      const s = D.slots[index];
      this.pushHistory();
      if (py == null) {
        this.goToPage(index + 1);
        return;
      }
      const [x, y] = s.proxy.getViewport({ scale: 1 }).convertToViewportPoint(px ?? 0, py);
      this.scrollToPoint({ page: index + 1, x: px == null ? 0 : x, y }, { align: 'top' });
      this.flashMarker({ page: index + 1, x: 0, y });
    } catch (err) {
      console.warn('[pdf] could not resolve destination', dest, err);
    }
  }

  private namedAction(action: string) {
    switch (action) {
      case 'NextPage':
        this.nextPage();
        break;
      case 'PrevPage':
        this.prevPage();
        break;
      case 'FirstPage':
        this.goToPage(1, { history: true });
        break;
      case 'LastPage':
        this.goToPage(this.numPages, { history: true });
        break;
      case 'GoBack':
        this.back();
        break;
      case 'GoForward':
        this.forward();
        break;
    }
  }

  // ───────────────────────────── coordinates / SyncTeX ─────────────────────────────

  /** Convert client coordinates to a PDF point (null when not over a page). */
  clientToPdf(clientX: number, clientY: number): PdfPoint | null {
    const D = this.cur;
    const sc = this.sc;
    if (!D || !sc) return null;
    const rect = sc.getBoundingClientRect();
    const cx = clientX - rect.left + sc.scrollLeft;
    const cy = clientY - rect.top + sc.scrollTop;
    const i = this.slotAtY(D, cy);
    const s = D.slots[i];
    if (!s || cx < s.left || cx > s.left + s.width || cy < s.top || cy > s.top + s.height) return null;
    return { page: i + 1, x: (cx - s.left) / D.k, y: (cy - s.top) / D.k };
  }

  /** A point near the middle of what is currently on screen (for "sync to source"). */
  viewportCenterPoint(): PdfPoint | null {
    const D = this.cur;
    const sc = this.sc;
    if (!D || !sc || !D.slots.length) return null;
    const cy = sc.scrollTop + sc.clientHeight / 2;
    const i = this.slotAtY(D, cy);
    const s = D.slots[i];
    const y = clamp((cy - s.top) / D.k, 0, s.hPt);
    return { page: i + 1, x: s.wPt / 2, y };
  }

  private inverseAt(e: MouseEvent) {
    const pt = this.clientToPdf(e.clientX, e.clientY);
    if (!pt) return;
    this.ripple(e);
    this.options.onInverse?.(pt, e);
  }

  private onDblClick = (e: MouseEvent) => {
    if (!this.options.onInverse || !(this.options.doubleClickInverse?.() ?? true)) return;
    if ((e.target as HTMLElement).closest('.annotationLayer a')) return;
    this.inverseAt(e);
    // The double-click also selected a word; that's noise after a jump.
    this.win.getSelection()?.removeAllRanges();
  };

  private onClick = (e: MouseEvent) => {
    const mod = MAC ? e.metaKey : e.ctrlKey;
    if (!mod || !this.options.onInverse) return;
    e.preventDefault();
    e.stopPropagation();
    this.inverseAt(e);
  };

  private ripple(e: MouseEvent) {
    const D = this.cur;
    const pt = this.clientToPdf(e.clientX, e.clientY);
    if (!D || !pt) return;
    const s = D.slots[pt.page - 1];
    const el = document.createElement('div');
    el.className = 'tx-pdf-ripple';
    el.style.left = `${(pt.x / s.wPt) * 100}%`;
    el.style.top = `${(pt.y / s.hPt) * 100}%`;
    s.overlay.append(el);
    setTimeout(() => el.remove(), 700);
  }

  /** Briefly mark a vertical position (link targets). */
  private flashMarker(pt: PdfPoint) {
    const D = this.cur;
    if (!D) return;
    const s = D.slots[pt.page - 1];
    if (!s) return;
    const el = document.createElement('div');
    el.className = 'tx-pdf-marker';
    el.style.top = `${(pt.y / s.hPt) * 100}%`;
    s.overlay.append(el);
    setTimeout(() => el.remove(), 1600);
  }

  /**
   * Highlight rectangles (e.g. forward SyncTeX results) with an animated
   * flash, optionally scrolling the first one into view.
   */
  highlight(rects: PdfRect[], opts: { scroll?: 'center' | 'nearest' | 'none'; style?: 'flash' | 'soft' } = {}) {
    const D = this.cur;
    if (!D) return;
    this.clearHighlight();
    const valid = rects.filter((r) => r.page >= 1 && r.page <= D.slots.length);
    if (!valid.length) return;
    const page = valid[0].page;
    const onPage = valid.filter((r) => r.page === page);
    const style = opts.style ?? 'flash';
    for (const r of valid) {
      const s = D.slots[r.page - 1];
      const w = Math.max(r.width, 2);
      const h = Math.max(r.height, 2);
      const el = document.createElement('div');
      el.className = `tx-pdf-hl tx-pdf-hl-${style}`;
      const pad = 1.5;
      el.style.left = `${((r.x - pad) / s.wPt) * 100}%`;
      el.style.top = `${((r.y - pad) / s.hPt) * 100}%`;
      el.style.width = `${((w + 2 * pad) / s.wPt) * 100}%`;
      el.style.height = `${((h + 2 * pad) / s.hPt) * 100}%`;
      s.overlay.append(el);
      this.hlEls.push(el);
    }
    // Margin pointer next to the first line (Skim-style).
    {
      const s = D.slots[page - 1];
      const r = onPage[0];
      const el = document.createElement('div');
      el.className = `tx-pdf-pointer tx-pdf-hl-${style}`;
      el.style.top = `${((r.y + Math.max(r.height, 2) / 2) / s.hPt) * 100}%`;
      s.overlay.append(el);
      this.hlEls.push(el);
    }
    const scroll = opts.scroll ?? 'center';
    if (scroll !== 'none') {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const r of onPage) {
        x0 = Math.min(x0, r.x);
        y0 = Math.min(y0, r.y);
        x1 = Math.max(x1, r.x + r.width);
        y1 = Math.max(y1, r.y + r.height);
      }
      this.scrollToPoint({ page, x: x0, y: y0 }, { align: scroll, height: y1 - y0, width: x1 - x0 });
    }
    clearTimeout(this.hlTimer);
    this.hlTimer = window.setTimeout(() => this.clearHighlight(), style === 'flash' ? 2600 : 1800);
  }

  clearHighlight() {
    clearTimeout(this.hlTimer);
    for (const el of this.hlEls) el.remove();
    this.hlEls = [];
  }

  // ───────────────────────────── thumbnails ─────────────────────────────

  /** Page sizes in PDF points (for thumbnail placeholders). */
  pageSizes(): { w: number; h: number }[] {
    return this.cur?.slots.map((s) => ({ w: s.wPt, h: s.hPt })) ?? [];
  }

  /** Render a small bitmap of a page. Resolves to null when the document changed meanwhile. */
  async renderThumbnail(index: number, cssWidth: number): Promise<HTMLCanvasElement | null> {
    const D = this.cur;
    const lib = this.lib;
    if (!D || !lib) return null;
    const s = D.slots[index];
    if (!s) return null;
    const dpr = this.dpr;
    const scale = (cssWidth / s.wPt) * dpr;
    const vp = s.proxy.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(vp.width));
    canvas.height = Math.max(1, Math.round(vp.height));
    // Fast path: downscale the already-rendered page bitmap.
    if (s.canvas && s.canvas.width >= canvas.width) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(s.canvas, 0, 0, canvas.width, canvas.height);
        return canvas;
      }
    }
    try {
      await s.proxy.render({ canvas, viewport: vp, annotationMode: lib.AnnotationMode.ENABLE_FORMS }).promise;
    } catch (err) {
      releaseCanvas(canvas);
      if (!isCancelled(err) && !D.disposed) console.warn('[pdf] thumbnail failed', err);
      return null;
    }
    if (D !== this.cur) {
      releaseCanvas(canvas);
      return null;
    }
    return canvas;
  }

  /** Outline (bookmarks) of the current document. */
  async outline() {
    return (await this.cur?.doc.getOutline()) ?? null;
  }

  // ───────────────────────────── find ─────────────────────────────

  find(query: string, opts: FindOptions = {}) {
    this.findOpts = opts;
    this.findRe = buildRegex(query, opts);
    this.setFind({ query });
    void this.runFind(false);
  }

  /** Select the next (dir = 1) or previous (dir = -1) match. */
  findNext(dir: 1 | -1 = 1) {
    const n = this.matches.length;
    if (!n) return;
    const prev = this.matchIdx;
    this.matchIdx = prev < 0 ? (dir > 0 ? 0 : n - 1) : (prev + dir + n) % n;
    this.selectMatch(prev);
  }

  closeFind() {
    this.findGen++;
    this.findRe = null;
    this.clearFindHighlights();
    this.matches = [];
    this.matchIdx = -1;
    this.pageMatchRange.clear();
    this.set({ find: initialFind });
  }

  private clearFindHighlights() {
    const D = this.cur;
    if (!D) return;
    for (const s of D.slots) {
      if (!s.hlDivs.length || !s.textLayer) continue;
      const divs = s.textLayer.textDivs;
      const strs = s.textLayer.textContentItemsStr;
      for (const i of s.hlDivs) if (divs[i]) divs[i].textContent = strs[i];
      s.hlDivs = [];
    }
  }

  private async runFind(keepPosition: boolean) {
    const gen = ++this.findGen;
    const D = this.cur;
    this.clearFindHighlights();
    this.matches = [];
    this.pageMatchRange.clear();
    const prevIdx = this.matchIdx;
    this.matchIdx = -1;
    const re = this.findRe;
    if (!D || !re) {
      this.setFind({ total: 0, current: 0, searching: false });
      return;
    }
    this.setFind({ searching: true, total: 0, current: 0 });
    const startPage = this.state.page - 1;
    let lastEmit = performance.now();
    for (let i = 0; i < D.slots.length; i++) {
      let idx: PageTextIndex;
      try {
        idx = await D.textIndex(i);
      } catch {
        continue;
      }
      if (gen !== this.findGen || D !== this.cur) return;
      const ms = findInPage(idx, re, i);
      if (ms.length) {
        this.pageMatchRange.set(i, [this.matches.length, this.matches.length + ms.length]);
        for (const m of ms) this.matches.push(m);
        if (this.matchIdx < 0 && i >= startPage) {
          this.matchIdx = this.matches.length - ms.length;
          this.selectMatch(-1, !keepPosition || prevIdx < 0);
        } else this.applyFindHighlights(D, D.slots[i]);
      }
      if (performance.now() - lastEmit > 120) {
        lastEmit = performance.now();
        this.setFind({ total: this.matches.length, current: this.matchIdx + 1 });
      }
    }
    if (this.matchIdx < 0 && this.matches.length) {
      this.matchIdx = 0;
      this.selectMatch(-1, !keepPosition);
    }
    this.setFind({ total: this.matches.length, current: this.matchIdx + 1, searching: false });
  }

  private selectMatch(prevIdx: number, reveal = true) {
    const D = this.cur;
    if (!D) return;
    const m = this.matches[this.matchIdx];
    const pm = this.matches[prevIdx];
    if (pm && (!m || pm.page !== m.page)) this.applyFindHighlights(D, D.slots[pm.page]);
    if (!m) return;
    this.applyFindHighlights(D, D.slots[m.page]);
    this.setFind({ current: this.matchIdx + 1, total: Math.max(this.state.find.total, this.matches.length) });
    if (!reveal) return;
    const idx = D.idx.get(m.page);
    const r = idx && itemRanges(idx, m.start, m.end)[0];
    const s = D.slots[m.page];
    if (!idx || !r) return;
    const it = idx.items[r.item];
    const t = it.transform as number[];
    const fh = Math.hypot(t[2], t[3]) || 10;
    const vp = s.proxy.getViewport({ scale: 1 });
    const [x, y] = vp.convertToViewportPoint(t[4] + (it.width * r.from) / Math.max(1, it.str.length), t[5] + fh);
    this.scrollToPoint({ page: m.page + 1, x, y }, { align: 'nearest', height: fh * 1.3, width: 20 });
  }

  private applyFindHighlights(D: Doc, s: Slot) {
    const layer = s.textLayer;
    if (!layer || s.textState !== 2) return;
    const divs = layer.textDivs;
    const strs = layer.textContentItemsStr;
    for (const i of s.hlDivs) if (divs[i]) divs[i].textContent = strs[i];
    s.hlDivs = [];
    const range = this.pageMatchRange.get(s.index);
    const idx = D.idx.get(s.index);
    if (!range || !idx) return;
    const segs = new Map<number, { from: number; to: number; sel: boolean }[]>();
    for (let mi = range[0]; mi < range[1]; mi++) {
      const m = this.matches[mi];
      for (const r of itemRanges(idx, m.start, m.end)) {
        let list = segs.get(r.item);
        if (!list) segs.set(r.item, (list = []));
        list.push({ from: r.from, to: r.to, sel: mi === this.matchIdx });
      }
    }
    for (const [item, list] of segs) {
      const div = divs[item];
      const str = strs[item];
      if (!div || str == null) continue;
      list.sort((a, b) => a.from - b.from);
      const frag = document.createDocumentFragment();
      let pos = 0;
      for (const seg of list) {
        if (seg.from < pos) continue;
        if (seg.from > pos) frag.append(str.slice(pos, seg.from));
        const span = document.createElement('span');
        span.className = seg.sel ? 'tx-find-hit is-selected' : 'tx-find-hit';
        span.textContent = str.slice(seg.from, seg.to);
        frag.append(span);
        pos = seg.to;
      }
      if (pos < str.length) frag.append(str.slice(pos));
      div.replaceChildren(frag);
      s.hlDivs.push(item);
    }
  }
}

export { openExternalUrl };
