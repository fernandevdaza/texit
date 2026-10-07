/**
 * CompileService — framework-agnostic compile orchestrator used by the app and
 * by plugins: backend registry and selection, settings detection, per-project
 * coalescing, cancellation, `onWillCompile` hooks, status/result events,
 * diagnostics and a small LRU of the last successful PDF per project.
 */
import { normalizePath, parseLatexLog } from '@texit/core';
import type { BibTool, Diagnostic, Disposable, ProjectFile, TexEngine } from '@texit/core';
import type { ParseLogOptions } from '@texit/core';
import { CoalescingQueue } from './coalesce';
import { LruCache } from './lru';
import { detectCompileSettings, type CompileSettings, type DetectSettingsOptions } from './settings';
import type { BackendStatus, CompileBackend, CompileRequest, CompileResult, ExtendedCompileBackend } from './types';
import { anySignal, errorMessage, normalizeFiles, now } from './util';

export type CompileState = 'idle' | 'preparing' | 'compiling' | 'success' | 'error';

export interface CompileStatus {
  projectId: string;
  state: CompileState;
  /** Human-readable progress / outcome text. */
  message?: string;
  /** 0–1 while a backend downloads / prepares. */
  progress?: number;
  backendId?: string;
  /** Another compile (with a newer snapshot) is queued behind the current one. */
  queued: boolean;
  /** Epoch ms when the current/last run started. */
  startedAt?: number;
  /** Set on success / error. */
  durationMs?: number;
  timestamp: number;
}

/** Project files, or a function returning the latest snapshot (called when the run actually starts). */
export type FilesSnapshot = ProjectFile[] | (() => ProjectFile[] | Promise<ProjectFile[]>);

export interface CompileOptions {
  projectId: string;
  files: FilesSnapshot;
  /** Main file; auto-detected when omitted. `% !TEX root` is always followed. */
  mainPath?: string;
  /** Explicit engine or 'auto' (default). `% !TEX program` magic comments win over both. */
  engine?: TexEngine | 'auto';
  bibTool?: BibTool;
  makeindex?: boolean | 'auto';
  /** Default true. */
  synctex?: boolean;
  /** Single pass, no reruns (fast preview). */
  draft?: boolean;
  shellEscape?: boolean;
  /** Use this backend (falls back to the default choice if it is unavailable). */
  backendId?: string;
  signal?: AbortSignal;
  onLog?: (chunk: string) => void;
  /** Free-form trigger tag ('manual', 'auto', 'agent'…) passed to hooks and results. */
  reason?: string;
}

export interface WillCompileContext {
  readonly projectId: string;
  /** Replace or mutate to transform what gets compiled. */
  files: ProjectFile[];
  mainPath: string;
  engine: TexEngine;
  bibTool: BibTool;
  draft: boolean;
  readonly backendId: string;
  readonly reason?: string;
  readonly settings: CompileSettings;
  /** Append a line to the compile output stream. */
  log(line: string): void;
}

/** Return a new file list (or mutate `ctx`) to transform the compile input. */
export type WillCompileHook = (ctx: WillCompileContext) => void | ProjectFile[] | Promise<void | ProjectFile[]>;

export interface CompileTiming {
  /** Time spent waiting for a preceding compile of the same project. */
  queuedMs: number;
  prepareMs: number;
  compileMs: number;
  parseMs: number;
  totalMs: number;
}

export interface CompileServiceResult extends CompileResult {
  projectId: string;
  mainPath: string;
  settings: Omit<CompileSettings, 'scan'>;
  reason?: string;
  startedAt: number;
  finishedAt: number;
  timing: CompileTiming;
}

export interface CompileServiceOptions {
  backends?: CompileBackend[];
  /** Preferred backend id ('' / undefined → native if available, else busytex). */
  preferredBackend?: string;
  /** Engine when nothing in the project hints otherwise (default pdflatex). */
  defaultEngine?: TexEngine;
  /** Projects whose last successful PDF is kept in memory (default 8). */
  lastSuccessCapacity?: number;
  /** Log parser (default: `parseLatexLog` from @texit/core). */
  parseLog?: (log: string, opts: ParseLogOptions) => Diagnostic[];
}

interface RunRequest {
  opts: CompileOptions;
  submittedAt: number;
}

const DEFAULT_ORDER = ['native', 'busytex'];

export class CompileService {
  private readonly backends = new Map<string, CompileBackend>();
  private preferred: string | undefined;
  private readonly defaultEngine: TexEngine;
  private readonly parseLog: (log: string, opts: ParseLogOptions) => Diagnostic[];
  private readonly hooks: WillCompileHook[] = [];
  private readonly statusListeners = new Set<(s: CompileStatus) => void>();
  private readonly resultListeners = new Set<(r: CompileServiceResult) => void>();
  private readonly statuses = new Map<string, CompileStatus>();
  private readonly running = new Map<string, AbortController>();
  private readonly successes: LruCache<string, CompileServiceResult>;
  private readonly queue: CoalescingQueue<RunRequest, CompileServiceResult>;
  private disposed = false;

  constructor(opts: CompileServiceOptions = {}) {
    for (const b of opts.backends ?? []) this.backends.set(b.id, b);
    this.preferred = opts.preferredBackend || undefined;
    this.defaultEngine = opts.defaultEngine ?? 'pdflatex';
    this.parseLog = opts.parseLog ?? parseLatexLog;
    this.successes = new LruCache(Math.max(1, opts.lastSuccessCapacity ?? 8));
    this.queue = new CoalescingQueue((key, req) => this.run(key, req));
  }

  // ───────────────────────────── registry ─────────────────────────────

  register(backend: CompileBackend): Disposable {
    this.backends.set(backend.id, backend);
    return {
      dispose: () => {
        if (this.backends.get(backend.id) === backend) this.backends.delete(backend.id);
      },
    };
  }

  list(): CompileBackend[] {
    return [...this.backends.values()];
  }

  get(id: string): CompileBackend | undefined {
    return this.backends.get(id);
  }

  /** Status of every registered backend (for settings UIs). */
  async listStatus(): Promise<{ backend: CompileBackend; status: BackendStatus }[]> {
    return Promise.all(this.list().map(async (backend) => ({ backend, status: await safeStatus(backend) })));
  }

  setPreferredBackend(id: string | undefined): void {
    this.preferred = id || undefined;
  }

  get preferredBackend(): string | undefined {
    return this.preferred;
  }

  /**
   * Pick a backend: `requested` → preferred → native (if available) → busytex →
   * any other available backend supporting `engine`.
   */
  async chooseBackend(requested?: string, engine?: TexEngine): Promise<{ backend: CompileBackend; note?: string }> {
    const order = [requested, this.preferred, ...DEFAULT_ORDER, ...this.backends.keys()].filter(
      (id, i, arr): id is string => !!id && arr.indexOf(id) === i,
    );
    const skipped: string[] = [];
    for (const id of order) {
      const backend = this.backends.get(id);
      if (!backend) continue;
      if (engine && backend.engines.length && !backend.engines.includes(engine)) {
        if (id === requested || id === this.preferred) skipped.push(`${backend.label} does not support ${engine}`);
        continue;
      }
      const status = await safeStatus(backend);
      if (status.available) {
        return { backend, note: skipped.length ? `${skipped.join('; ')} — using ${backend.label}` : undefined };
      }
      if (id === requested || id === this.preferred) skipped.push(`${backend.label} unavailable${status.detail ? ` (${status.detail})` : ''}`);
    }
    throw new Error(skipped.length ? `No compile backend available: ${skipped.join('; ')}` : 'No compile backend available');
  }

  /** Warm up a backend (downloads the WASM TeX distribution, detects native tools…). */
  async prepare(backendId?: string, onProgress?: (s: BackendStatus) => void): Promise<void> {
    const { backend } = await this.chooseBackend(backendId);
    await backend.prepare?.(onProgress);
  }

  // ───────────────────────────── settings ─────────────────────────────

  detectSettings(files: ProjectFile[], mainPath?: string, opts: DetectSettingsOptions = {}): CompileSettings {
    return detectCompileSettings(files, mainPath, { defaultEngine: this.defaultEngine, ...opts });
  }

  // ───────────────────────────── hooks & events ─────────────────────────────

  /** Register a hook run before each compile (in registration order); used by plugins to transform files. */
  onWillCompile(hook: WillCompileHook): Disposable {
    this.hooks.push(hook);
    return {
      dispose: () => {
        const i = this.hooks.indexOf(hook);
        if (i !== -1) this.hooks.splice(i, 1);
      },
    };
  }

  onStatus(cb: (s: CompileStatus) => void): Disposable {
    this.statusListeners.add(cb);
    return { dispose: () => this.statusListeners.delete(cb) };
  }

  onResult(cb: (r: CompileServiceResult) => void): Disposable {
    this.resultListeners.add(cb);
    return { dispose: () => this.resultListeners.delete(cb) };
  }

  getStatus(projectId: string): CompileStatus {
    return this.statuses.get(projectId) ?? { projectId, state: 'idle', queued: false, timestamp: Date.now() };
  }

  isCompiling(projectId: string): boolean {
    return this.queue.isRunning(projectId);
  }

  /** Last successful result (with PDF) of a project, if still in the LRU. */
  lastSuccess(projectId: string): CompileServiceResult | undefined {
    return this.successes.get(projectId);
  }

  forgetProject(projectId: string): void {
    this.successes.delete(projectId);
    this.statuses.delete(projectId);
  }

  // ───────────────────────────── compile ─────────────────────────────

  /**
   * Compile a project. If a compile of the same project is running, the request
   * is coalesced: one more run happens afterwards with the latest request, and
   * every coalesced caller receives that run's result.
   */
  compile(opts: CompileOptions): Promise<CompileServiceResult> {
    if (this.disposed) return Promise.reject(new Error('CompileService was disposed'));
    const key = opts.projectId;
    const wasRunning = this.queue.isRunning(key);
    const p = this.queue.submit(key, { opts, submittedAt: Date.now() });
    if (wasRunning) this.patchStatus(key, { queued: true });
    return p;
  }

  /** Cancel the running compile of a project and drop its queued follow-up. */
  cancel(projectId: string): void {
    const startedAt = Date.now();
    this.queue.dropPending(projectId, this.cancelledResult(projectId, startedAt));
    this.running.get(projectId)?.abort();
  }

  cancelAll(): void {
    for (const key of this.queue.keys()) this.cancel(key);
  }

  dispose(): void {
    this.disposed = true;
    this.cancelAll();
    this.statusListeners.clear();
    this.resultListeners.clear();
    this.hooks.length = 0;
  }

  // ───────────────────────────── internals ─────────────────────────────

  private async run(projectId: string, { opts, submittedAt }: RunRequest): Promise<CompileServiceResult> {
    const startedAt = Date.now();
    const t0 = now();
    const ctrl = new AbortController();
    const signal = anySignal([opts.signal, ctrl.signal]);
    this.running.set(projectId, ctrl);
    const emitLog = (line: string) => {
      try {
        opts.onLog?.(line.endsWith('\n') ? line : `${line}\n`);
      } catch {
        /* ignore */
      }
    };
    let backendId: string | undefined;
    let prepareMs = 0;
    let compileMs = 0;
    let settings: CompileSettings | undefined;
    let mainPath = opts.mainPath ? normalizePath(opts.mainPath) : '';

    const finish = (result: CompileResult, parseMs = 0): CompileServiceResult => {
      const finishedAt = Date.now();
      const { scan: _scan, ...plainSettings } = settings ?? detectCompileSettings([], undefined);
      const r: CompileServiceResult = {
        ...result,
        projectId,
        mainPath,
        settings: plainSettings,
        reason: opts.reason,
        startedAt,
        finishedAt,
        timing: {
          queuedMs: Math.max(0, startedAt - submittedAt),
          prepareMs: Math.round(prepareMs),
          compileMs: Math.round(compileMs),
          parseMs: Math.round(parseMs),
          totalMs: Math.round(now() - t0),
        },
      };
      if (r.status === 'success' && r.pdf) this.successes.set(projectId, r);
      return r;
    };

    try {
      this.setStatus(projectId, { state: 'preparing', message: 'Preparing…', startedAt, backendId });
      const files = normalizeFiles(typeof opts.files === 'function' ? await opts.files() : opts.files);
      settings = detectCompileSettings(files, opts.mainPath, {
        engine: opts.engine ?? 'auto',
        bibTool: opts.bibTool ?? 'auto',
        makeindex: opts.makeindex ?? 'auto',
        defaultEngine: this.defaultEngine,
      });
      mainPath = settings.mainPath;
      if (!mainPath) throw new Error('No main .tex file found (a file with \\documentclass and \\begin{document}).');
      if (settings.requestedMainPath) emitLog(`[texit] % !TEX root: compiling ${mainPath} instead of ${settings.requestedMainPath}`);
      emitLog(`[texit] ${mainPath} · ${settings.engine}${settings.engineReason ? ` (${settings.engineReason})` : ''}`);

      const { backend, note } = await this.chooseBackend(opts.backendId, settings.engine);
      backendId = backend.id;
      if (note) emitLog(`[texit] ${note}`);
      throwIfAborted(signal.signal);

      const ctx: WillCompileContext = {
        projectId,
        files,
        mainPath,
        engine: settings.engine,
        bibTool: opts.bibTool ?? 'auto',
        draft: !!opts.draft,
        backendId: backend.id,
        reason: opts.reason,
        settings,
        log: emitLog,
      };
      for (const hook of [...this.hooks]) {
        try {
          const out = await hook(ctx);
          if (Array.isArray(out)) ctx.files = out;
        } catch (err) {
          emitLog(`[texit] onWillCompile hook failed: ${errorMessage(err)}`);
        }
      }
      mainPath = normalizePath(ctx.mainPath);
      const req: CompileRequest = {
        files: normalizeFiles(ctx.files),
        mainPath,
        engine: ctx.engine,
        bibTool: ctx.bibTool,
        makeindex: opts.makeindex ?? 'auto',
        synctex: opts.synctex ?? true,
        draft: ctx.draft,
        shellEscape: opts.shellEscape,
        projectId,
        signal: signal.signal,
        onLog: opts.onLog,
      };

      // Prepare (downloads / detection), forwarding backend progress.
      const ext = backend as ExtendedCompileBackend;
      const onPrepare = (s: BackendStatus) =>
        this.setStatus(projectId, { state: 'preparing', message: s.detail ?? 'Preparing…', progress: s.progress, startedAt, backendId });
      const tp = now();
      if (typeof ext.prepareFor === 'function') await ext.prepareFor(req, onPrepare);
      else if (typeof backend.prepare === 'function') await backend.prepare(onPrepare);
      prepareMs = now() - tp;
      throwIfAborted(signal.signal);

      // Compile; a backend may still need to download (e.g. bigger TeX Live package on retry).
      this.setStatus(projectId, { state: 'compiling', message: `Compiling with ${backend.label}…`, startedAt, backendId });
      let downloading = false;
      const sub = ext.onStatusChange?.((s) => {
        if (s.progress !== undefined) {
          downloading = true;
          this.setStatus(projectId, { state: 'preparing', message: s.detail, progress: s.progress, startedAt, backendId });
        } else if (downloading) {
          downloading = false;
          this.setStatus(projectId, { state: 'compiling', message: `Compiling with ${backend.label}…`, startedAt, backendId });
        }
      });
      const tc = now();
      let result: CompileResult;
      try {
        result = await backend.compile(req);
      } finally {
        sub?.dispose();
        compileMs = now() - tc;
      }

      const tParse = now();
      const diagnostics = [...(result.diagnostics ?? [])];
      if (result.status !== 'cancelled' && result.log) {
        try {
          diagnostics.push(...this.parseLog(result.log, { projectPaths: req.files.map((f) => f.path), mainPath }));
        } catch {
          /* parser unavailable or failed: diagnostics stay empty */
        }
      }
      const final = finish({ ...result, diagnostics }, now() - tParse);
      this.report(projectId, final);
      return final;
    } catch (err) {
      const cancelled = signal.signal.aborted;
      const final = finish({
        status: cancelled ? 'cancelled' : 'error',
        log: cancelled ? 'Compilation cancelled.\n' : `${errorMessage(err)}\n`,
        diagnostics: cancelled ? [] : [{ severity: 'error', message: errorMessage(err), code: 'compile-service' }],
        durationMs: Math.round(now() - t0),
        backendId: backendId ?? '',
        engine: settings?.engine ?? this.defaultEngine,
      });
      this.report(projectId, final);
      return final;
    } finally {
      signal.dispose();
      if (this.running.get(projectId) === ctrl) this.running.delete(projectId);
    }
  }

  private report(projectId: string, r: CompileServiceResult): void {
    const queued = this.queue.hasPending(projectId);
    if (r.status === 'cancelled') {
      this.setStatus(projectId, { state: 'idle', message: 'Compilation cancelled', backendId: r.backendId, queued });
    } else {
      const errors = r.diagnostics.filter((d) => d.severity === 'error').length;
      const secs = (r.timing.totalMs / 1000).toFixed(1);
      this.setStatus(projectId, {
        state: r.status === 'success' ? 'success' : 'error',
        message:
          r.status === 'success'
            ? `Compiled in ${secs} s`
            : errors
              ? `${errors} error${errors === 1 ? '' : 's'} — compilation failed`
              : 'Compilation failed',
        backendId: r.backendId,
        startedAt: r.startedAt,
        durationMs: r.timing.totalMs,
        queued,
      });
    }
    for (const l of this.resultListeners) {
      try {
        l(r);
      } catch {
        /* listener errors must not break compilation */
      }
    }
  }

  private cancelledResult(projectId: string, startedAt: number): CompileServiceResult {
    const { scan: _scan, ...settings } = detectCompileSettings([], undefined);
    return {
      status: 'cancelled',
      log: 'Compilation cancelled.\n',
      diagnostics: [],
      durationMs: 0,
      backendId: '',
      engine: this.defaultEngine,
      projectId,
      mainPath: '',
      settings,
      startedAt,
      finishedAt: startedAt,
      timing: { queuedMs: 0, prepareMs: 0, compileMs: 0, parseMs: 0, totalMs: 0 },
    };
  }

  private setStatus(projectId: string, s: Omit<CompileStatus, 'projectId' | 'timestamp' | 'queued'> & { queued?: boolean }): void {
    const status: CompileStatus = {
      ...s,
      projectId,
      queued: s.queued ?? this.queue.hasPending(projectId),
      timestamp: Date.now(),
    };
    this.statuses.set(projectId, status);
    for (const l of this.statusListeners) {
      try {
        l(status);
      } catch {
        /* ignore */
      }
    }
  }

  private patchStatus(projectId: string, patch: Partial<CompileStatus>): void {
    const cur = this.getStatus(projectId);
    const { projectId: _p, timestamp: _t, ...rest } = { ...cur, ...patch };
    this.setStatus(projectId, rest);
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const err = new Error('Compilation cancelled');
    err.name = 'AbortError';
    throw err;
  }
}

async function safeStatus(backend: CompileBackend): Promise<BackendStatus> {
  try {
    return await backend.status();
  } catch (err) {
    return { available: false, detail: errorMessage(err) };
  }
}
