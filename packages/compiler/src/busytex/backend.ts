/**
 * BusyTeX (TeX Live 2026 compiled to WebAssembly) compile backend.
 *
 * - Runs in a Web Worker (the stock `busytex_worker.js` from the asset dir).
 * - Lazily initialised; download progress is reported via `BackendStatus.progress` (0–1).
 * - Loads exactly one TeX Live data package (basic / recommended / extra), the
 *   smallest one that provides every package/class the project uses. If a
 *   compile fails because of a missing file that a bigger package has, it is
 *   retried once with that package.
 * - Compiles are serialised. Aborting terminates the worker; it is re-created
 *   lazily on the next compile (data packages come from the IndexedDB cache).
 *
 * COOP/COEP are NOT required: the engine is single-threaded (no SharedArrayBuffer).
 */
import { extname, normalizePath, dirname } from '@texit/core';
import type { Disposable, TexEngine } from '@texit/core';
import { clearAllPackageCache, ensureCacheVersion, isPackageCached } from 'texlyre-busytex';
import { detectBibTool, detectMakeindex, includeClosure } from '../settings';
import { mergeScans } from '../latex-scan';
import type { BackendStatus, CompileRequest, CompileResult, ExtendedCompileBackend } from '../types';
import {
  AbortedError,
  Mutex,
  compactBytes,
  errorMessage,
  formatBytes,
  isAbortError,
  normalizeFiles,
  now,
  stripBuildArtifacts,
} from '../util';
import {
  DEFAULT_DATA_PACKAGES,
  collectRequirements,
  escalationTier,
  findMissingFiles,
  loadDataPackageIndex,
  selectDataPackageTier,
  type DataPackageIndex,
  type TierSelection,
} from './data-packages';
import { allLogText, buildBusyTexLog, summarizeCommands } from './log';
import { BusyTexWorkerClient, type BusyTexAssetUrls, type BusyTexCompileInput, type BusyTexCompileOutput, type BusyTexDriver } from './worker-client';

export interface BusyTexBackendOptions {
  /**
   * URL (absolute, root-relative or relative to the document) of the directory
   * holding the BusyTeX assets, e.g. `${import.meta.env.BASE_URL}busytex/`.
   */
  basePath: string;
  /**
   * Optional TeX Live on-demand endpoint (`GET {endpoint}/{kpathsea format}/{file}`):
   * files missing from the loaded data package are fetched from it.
   */
  remoteEndpoint?: string;
  /** Data package names, smallest first (default: texlive-basic, -recommended, -extra). */
  dataPackages?: readonly string[];
  /** Data package `prepare()` warms up without a project (default: the smallest). */
  defaultDataPackage?: string;
  /** Minimum data package per engine (default: none). */
  minDataPackageByEngine?: Partial<Record<TexEngine, string>>;
  /** Hard limit for one compile (default 10 min). The worker is killed when exceeded. */
  compileTimeoutMs?: number;
  /** Fail initialisation after this long without any progress (default 2 min, 10 min without byte progress). */
  initStallTimeoutMs?: number;
  /** Retry once with a bigger data package on missing-file errors (default true). */
  autoEscalate?: boolean;
  /**
   * Inject a tiny blob: script into the worker (default true): byte-level download
   * progress and stopping after the first fatal TeX error instead of running all passes.
   * Needs `worker-src`/`script-src` to allow `blob:` if a CSP is set; harmless if blocked.
   */
  workerHooks?: boolean;
  /** Base for resolving a relative `basePath` (default `document.baseURI`). */
  documentBaseUrl?: string;
  /** Custom fetch (asset checks and index loading). */
  fetch?: typeof fetch;
  /** Label override. */
  label?: string;
}

const DRIVERS: Record<TexEngine, BusyTexDriver> = {
  pdflatex: 'pdftex_bibtex8',
  xelatex: 'xetex_bibtex8_dvipdfmx',
  // LuaHBTeX — the only Lua format shipped (luahblatex.fmt); `lualatex.fmt` does not exist in the data packages.
  lualatex: 'luahbtex_bibtex8',
};

/** Directory where the worker mounts the project (SyncTeX paths are absolute below it). */
export const BUSYTEX_PROJECT_DIR = '/home/web_user/project_dir';

type Phase = 'idle' | 'loading-index' | 'downloading' | 'starting' | 'ready' | 'compiling' | 'error';

function prettyTier(name: string): string {
  return name.replace(/^texlive-/, '');
}

export class BusyTexBackend implements ExtendedCompileBackend {
  readonly id = 'busytex';
  readonly kind = 'wasm' as const;
  readonly label: string;
  readonly description = 'TeX Live 2026 compiled to WebAssembly. Runs in your browser — no installation, works offline after the first download.';
  readonly engines: TexEngine[] = ['pdflatex', 'xelatex', 'lualatex'];

  private readonly opts: BusyTexBackendOptions;
  private readonly tiers: readonly string[];
  private readonly fetchFn: typeof fetch;
  private readonly mutex = new Mutex();
  private readonly listeners = new Set<(s: BackendStatus) => void>();

  private baseUrl: string | null = null;
  private baseUrlError: string | null = null;
  private client: BusyTexWorkerClient | null = null;
  private clientTier = -1;
  private clientCompiles = 0;
  private indexPromise: Promise<DataPackageIndex | null> | null = null;
  private assetCheck: { ok: boolean; detail?: string; at: number } | null = null;
  private cacheVersionChecked = false;

  private phase: Phase = 'idle';
  private detail = 'Not started — TeX Live is downloaded on first compile';
  private progress: number | undefined;
  private disposed = false;

  constructor(opts: BusyTexBackendOptions) {
    this.opts = opts;
    this.label = opts.label ?? 'TeX Live (WebAssembly)';
    this.tiers = opts.dataPackages?.length ? [...opts.dataPackages] : [...DEFAULT_DATA_PACKAGES];
    this.fetchFn = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
    try {
      const href =
        opts.documentBaseUrl ??
        (typeof document !== 'undefined' ? document.baseURI : typeof location !== 'undefined' ? location.href : undefined);
      const base = opts.basePath.endsWith('/') ? opts.basePath : `${opts.basePath}/`;
      this.baseUrl = new URL(base, href).href;
    } catch (err) {
      this.baseUrlError = `Invalid BusyTeX basePath "${opts.basePath}": ${errorMessage(err)}`;
    }
  }

  // ───────────────────────────── public API ─────────────────────────────

  async status(): Promise<BackendStatus> {
    if (typeof Worker === 'undefined' || typeof WebAssembly === 'undefined') {
      return { available: false, detail: 'Requires Web Workers and WebAssembly' };
    }
    if (this.baseUrlError) return { available: false, detail: this.baseUrlError };
    const assets = await this.checkAssets();
    if (!assets.ok) return { available: false, detail: assets.detail };
    return this.snapshot();
  }

  /** Warm up the engine with the default (or currently loaded) data package. */
  async prepare(onProgress?: (s: BackendStatus) => void): Promise<void> {
    const tierName = this.opts.defaultDataPackage ?? this.tiers[0];
    const tier = Math.max(0, this.tiers.indexOf(tierName));
    await this.mutex.run(() => this.withProgress(onProgress, () => this.ensureClient(tier)));
  }

  /** Download / start the data package this request needs (no compile). */
  async prepareFor(req: CompileRequest, onProgress?: (s: BackendStatus) => void): Promise<void> {
    await this.mutex.run(() =>
      this.withProgress(onProgress, async () => {
        const sel = await this.selectForFiles(req.files, req.engine);
        await this.ensureClient(sel.tier, req.signal);
      }),
    );
  }

  onStatusChange(cb: (s: BackendStatus) => void): Disposable {
    this.listeners.add(cb);
    return { dispose: () => this.listeners.delete(cb) };
  }

  /** The data package currently loaded in the engine, if any. */
  get loadedDataPackage(): string | undefined {
    return this.client?.alive ? this.tiers[this.clientTier] : undefined;
  }

  /** Engine applet versions (pdftex, xetex, luahbtex, bibtex8, …) once started. */
  get versions(): Readonly<Record<string, string>> {
    return this.client?.versions ?? {};
  }

  /** Which data package a project needs, and why (for UI / diagnostics). */
  async selectDataPackage(files: CompileRequest['files'], engine: TexEngine): Promise<TierSelection & { dataPackage: string; index: DataPackageIndex['source'] | 'none' }> {
    const index = await this.loadIndex();
    const sel = await this.selectForFiles(files, engine);
    return { ...sel, dataPackage: this.tiers[sel.tier], index: index?.source ?? 'none' };
  }

  /** Whether a data package is already in the browser's IndexedDB cache. */
  async isDataPackageCached(name: string): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      return await isPackageCached(`${this.baseUrl}${name}.js`);
    } catch {
      return false;
    }
  }

  /** Drop all cached TeX Live data packages (frees disk space; next compile re-downloads). */
  async clearCache(): Promise<void> {
    await this.mutex.run(async () => {
      this.killClient();
      await clearAllPackageCache();
      this.setPhase('idle', 'Cache cleared — TeX Live is downloaded on next compile', undefined);
    });
  }

  async compile(req: CompileRequest): Promise<CompileResult> {
    const t0 = now();
    const cancelled = () => this.result(req, t0, { status: 'cancelled', log: 'Compilation cancelled.\n' });
    const signal = req.signal;
    if (signal?.aborted) return cancelled();
    const run = this.mutex.run(() => this.compileExclusive(req, t0));
    if (!signal) return run;
    // Resolve immediately when aborted while still queued behind another compile.
    return new Promise<CompileResult>((resolve) => {
      const onAbort = () => resolve(cancelled());
      signal.addEventListener('abort', onAbort, { once: true });
      void run.then((r) => {
        signal.removeEventListener('abort', onAbort);
        resolve(r);
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.killClient();
    this.listeners.clear();
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async compileExclusive(req: CompileRequest, t0: number): Promise<CompileResult> {
    const emit = (line: string) => req.onLog?.(line.endsWith('\n') ? line : `${line}\n`);
    try {
      if (this.disposed) throw new Error('BusyTeX backend was disposed');
      if (req.signal?.aborted) throw new AbortedError();
      if (this.baseUrlError) throw new Error(this.baseUrlError);

      const mainPath = normalizePath(req.mainPath);
      let files = normalizeFiles(req.files);
      if (!files.some((f) => f.path === mainPath)) {
        return this.result(req, t0, { status: 'error', log: `Main file "${mainPath}" was not found in the project.\n` });
      }
      if (extname(mainPath) !== 'tex') {
        return this.result(req, t0, { status: 'error', log: `The WebAssembly compiler needs the main file to have a .tex extension (got "${mainPath}").\n` });
      }
      files = stripBuildArtifacts(files, mainPath);

      // Bibliography / index tools.
      const { scans } = includeClosure(files, mainPath);
      const scan = mergeScans([...scans.values()]);
      const magic = scans.get(mainPath)?.magic ?? {};
      const bibTool = req.bibTool === 'auto' ? detectBibTool(scan, magic) : req.bibTool;
      const makeindex = req.makeindex === true ? true : req.makeindex === false ? false : detectMakeindex(scan) ? true : null;

      // Data package.
      const index = await this.loadIndex();
      const sel = await this.selectForFiles(files, req.engine);
      emit(this.describeSelection(sel, index));
      if (sel.unknown.length && index?.complete) {
        const shown = sel.unknown.slice(0, 8).map((u) => u.split('|')[0]).join(', ');
        emit(`[busytex] Not in any TeX Live data package${this.opts.remoteEndpoint ? ' (will try the remote endpoint)' : ''}: ${shown}${sel.unknown.length > 8 ? ', …' : ''}`);
      }

      const input: BusyTexCompileInput = {
        files: files.map((f) => ({ path: f.path, contents: typeof f.content === 'string' ? f.content : compactBytes(f.content) })),
        mainTexPath: mainPath,
        bibtex: bibTool === 'bibtex' || bibTool === 'biber',
        biber: bibTool === 'biber',
        makeindex,
        rerun: !req.draft,
        driver: DRIVERS[req.engine] ?? DRIVERS.pdflatex,
        remoteEndpoint: this.opts.remoteEndpoint,
        shellEscape: req.shellEscape === true,
      };
      emit(
        `[busytex] ${req.engine} · bibliography: ${bibTool} · makeindex: ${makeindex === null ? 'if needed' : makeindex ? 'yes' : 'no'} · ${req.draft ? 'single pass (draft)' : 'rerun until stable'}`,
      );

      let out = await this.runCompile(input, sel.tier, req, emit);
      let success = out.exitCode === 0 && !!out.pdf;

      if (!success && this.opts.autoEscalate !== false) {
        const missing = findMissingFiles(allLogText(out.logs, out.log));
        const next = escalationTier(missing, index, this.clientTier, this.tiers.length);
        if (next !== undefined) {
          emit(`[busytex] Missing ${missing.slice(0, 4).join(', ')} — retrying with ${this.tiers[next]}`);
          out = await this.runCompile(input, next, req, emit);
          success = out.exitCode === 0 && !!out.pdf;
        }
      }

      emit(`[busytex] ${success ? 'Done' : 'Failed'}: ${summarizeCommands(out.logs)} (${Math.round(now() - t0)} ms)`);
      this.setPhase('ready', this.readyDetail(), undefined);
      return this.result(req, t0, {
        status: success ? 'success' : 'error',
        pdf: success ? (out.pdf ?? undefined) : undefined,
        synctex: success && req.synctex ? (out.synctex ?? undefined) : undefined,
        log: buildBusyTexLog(out.logs, out.log),
      });
    } catch (err) {
      if (isAbortError(err)) {
        this.setPhase(this.client?.alive ? 'ready' : 'idle', this.client?.alive ? this.readyDetail() : 'Stopped', undefined);
        return this.result(req, t0, { status: 'cancelled', log: 'Compilation cancelled.\n' });
      }
      const msg = errorMessage(err);
      this.setPhase('error', msg, undefined);
      return this.result(req, t0, { status: 'error', log: `BusyTeX error: ${msg}\n` });
    }
  }

  /** Compile on an engine with at least `tier`; re-creates a crashed worker once. */
  private async runCompile(input: BusyTexCompileInput, tier: number, req: CompileRequest, emit: (l: string) => void): Promise<BusyTexCompileOutput> {
    for (let attempt = 0; ; attempt++) {
      const client = await this.ensureClient(tier, req.signal);
      const reused = this.clientCompiles > 0;
      this.setPhase('compiling', `Compiling with ${req.engine}…`, undefined);
      try {
        this.clientCompiles++;
        return await client.compile(input, {
          signal: req.signal,
          timeoutMs: this.opts.compileTimeoutMs ?? 600_000,
          onPrint: (line) => emit(line),
        });
      } catch (err) {
        if (isAbortError(err) || attempt > 0 || !reused || /timed out/i.test(errorMessage(err))) throw err;
        // The engine's state may have been corrupted by a previous run: retry once on a fresh worker.
        emit(`[busytex] Engine crashed (${errorMessage(err)}) — restarting it and retrying`);
        this.killClient();
      }
    }
  }

  private minTierFor(engine: TexEngine): number {
    const name = this.opts.minDataPackageByEngine?.[engine];
    const i = name ? this.tiers.indexOf(name) : -1;
    return Math.max(0, i);
  }

  private async selectForFiles(files: CompileRequest['files'], engine: TexEngine): Promise<TierSelection> {
    const index = await this.loadIndex();
    const required = collectRequirements(normalizeFiles(files));
    const sel = selectDataPackageTier(required, index, {
      minTier: this.minTierFor(engine),
      hasRemoteEndpoint: !!this.opts.remoteEndpoint,
    });
    return { ...sel, tier: Math.min(sel.tier, this.tiers.length - 1) };
  }

  private describeSelection(sel: TierSelection, index: DataPackageIndex | null): string {
    const name = this.tiers[sel.tier];
    const loaded = this.client?.alive && this.clientTier > sel.tier ? ` (using already loaded ${this.tiers[this.clientTier]})` : '';
    if (!index) return `[busytex] Data package: ${name}${loaded} (no package index available)`;
    const why = sel.drivers.length ? ` — needed for ${sel.drivers.slice(0, 5).join(', ')}${sel.drivers.length > 5 ? ', …' : ''}` : '';
    return `[busytex] Data package: ${name}${loaded}${why}`;
  }

  private loadIndex(): Promise<DataPackageIndex | null> {
    if (!this.baseUrl) return Promise.resolve(null);
    if (!this.indexPromise) {
      const p = loadDataPackageIndex(this.baseUrl, this.tiers, this.fetchFn).catch(() => null);
      this.indexPromise = p;
      // Retry later if nothing could be loaded (e.g. offline on first visit).
      void p.then((idx) => {
        if (!idx && this.indexPromise === p) this.indexPromise = null;
      });
    }
    return this.indexPromise;
  }

  private assetUrls(): BusyTexAssetUrls {
    const b = this.baseUrl!;
    return {
      workerJs: `${b}busytex_worker.js`,
      busytexJs: `${b}busytex.js`,
      busytexWasm: `${b}busytex.wasm`,
      biberJs: `${b}biber.js`,
      biberWasm: `${b}biber.wasm`,
      biberData: `${b}biber.data`,
    };
  }

  private async checkAssets(): Promise<{ ok: boolean; detail?: string }> {
    const cached = this.assetCheck;
    if (cached && (cached.ok || Date.now() - cached.at < 10_000)) return cached;
    const url = this.assetUrls().workerJs;
    let result: { ok: boolean; detail?: string; at: number };
    try {
      const res = await this.fetchFn(url, { method: 'HEAD', cache: 'no-cache' });
      const type = res.headers.get('content-type') ?? '';
      result =
        res.ok && !type.includes('text/html')
          ? { ok: true, at: Date.now() }
          : { ok: false, at: Date.now(), detail: `BusyTeX assets not found at ${this.baseUrl} — run \`pnpm assets:busytex\`` };
    } catch {
      // Offline or blocked HEAD: do not claim the assets are missing.
      result = { ok: true, at: Date.now() };
    }
    this.assetCheck = result;
    return result;
  }

  private async ensureClient(tier: number, signal?: AbortSignal): Promise<BusyTexWorkerClient> {
    if (this.client?.alive && this.clientTier >= tier) return this.client;
    if (this.disposed) throw new Error('BusyTeX backend was disposed');
    if (!this.baseUrl) throw new Error(this.baseUrlError ?? 'BusyTeX basePath is not set');
    this.killClient();

    if (!this.cacheVersionChecked) {
      this.cacheVersionChecked = true;
      // Clears stale IndexedDB packages when the texlyre-busytex version changed.
      await ensureCacheVersion().catch(() => undefined);
    }
    const name = this.tiers[tier];
    const pretty = prettyTier(name);
    const cached = await this.isDataPackageCached(name);
    this.setPhase(cached ? 'starting' : 'downloading', cached ? `Loading TeX Live (${pretty}) from cache…` : `Downloading TeX Live (${pretty})…`, cached ? undefined : 0);

    const client = await BusyTexWorkerClient.create({
      urls: this.assetUrls(),
      dataPackagesJs: [`${this.baseUrl}${name}.js`],
      workerHooks: this.opts.workerHooks !== false,
      stallTimeoutMs: this.opts.initStallTimeoutMs,
      signal,
      onProgress: (p) => {
        if (p.phase === 'download') {
          const done = p.loaded >= p.total;
          this.setPhase(
            done ? 'starting' : 'downloading',
            done ? `Starting TeX engine (${pretty})…` : `Downloading TeX Live (${pretty}) · ${formatBytes(p.loaded)} / ${formatBytes(p.total)}`,
            done ? undefined : p.fraction,
          );
        } else if (p.phase === 'prepare' && this.phase !== 'downloading') {
          this.setPhase('starting', `Starting TeX engine (${pretty})…`, undefined);
        } else if (p.phase === 'done') {
          this.setPhase('starting', `Starting TeX engine (${pretty})…`, undefined);
        }
      },
    }).catch((err) => {
      if (!isAbortError(err)) this.setPhase('error', `Could not start TeX Live: ${errorMessage(err)}`, undefined);
      throw err;
    });
    this.client = client;
    this.clientTier = tier;
    this.clientCompiles = 0;
    this.setPhase('ready', this.readyDetail(), undefined);
    return client;
  }

  private killClient(): void {
    this.client?.terminate();
    this.client = null;
    this.clientTier = -1;
    this.clientCompiles = 0;
  }

  private readyDetail(): string {
    if (!this.client?.alive) return 'Not started — TeX Live is downloaded on first compile';
    return `Ready · TeX Live 2026 (${prettyTier(this.tiers[this.clientTier])})`;
  }

  private snapshot(): BackendStatus {
    return { available: true, detail: this.detail, progress: this.progress };
  }

  private setPhase(phase: Phase, detail: string, progress: number | undefined): void {
    if (this.phase === phase && this.detail === detail && this.progress === progress) return;
    this.phase = phase;
    this.detail = detail;
    this.progress = progress;
    const s = this.snapshot();
    for (const l of this.listeners) {
      try {
        l(s);
      } catch {
        /* listener errors must not break compilation */
      }
    }
  }

  private async withProgress<T>(onProgress: ((s: BackendStatus) => void) | undefined, fn: () => Promise<T>): Promise<T> {
    if (!onProgress) return fn();
    const sub = this.onStatusChange(onProgress);
    try {
      return await fn();
    } finally {
      sub.dispose();
    }
  }

  private result(
    req: CompileRequest,
    t0: number,
    r: Pick<CompileResult, 'status' | 'log'> & Partial<Pick<CompileResult, 'pdf' | 'synctex'>>,
  ): CompileResult {
    return {
      status: r.status,
      pdf: r.pdf,
      synctex: r.synctex,
      log: r.log,
      diagnostics: [],
      durationMs: Math.round(now() - t0),
      backendId: this.id,
      engine: req.engine,
      buildDir: BUSYTEX_PROJECT_DIR,
    };
  }
}

/** Directory (inside the worker FS) TeX runs in for a given main file — SyncTeX `Input:` paths are relative to the project dir. */
export function busyTexWorkingDir(mainPath: string): string {
  const d = dirname(normalizePath(mainPath));
  return d ? `${BUSYTEX_PROJECT_DIR}/${d}` : BUSYTEX_PROJECT_DIR;
}
