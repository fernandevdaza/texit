/**
 * Thin client for the stock `busytex_worker.js` shipped with the BusyTeX assets.
 *
 * We drive the worker's message protocol directly (instead of using
 * `BusyTexRunner`) to get: byte-level download progress, configurable
 * timeouts, abortable compiles (the worker is terminated — wasm cannot be
 * interrupted) and a hard guarantee that only one data package is loaded.
 *
 * Protocol (see busytex_worker.js):
 *   → { load_shell_handler_script: url }                 ← { shell_handler_script_loaded } | { exception }
 *   → { busytex_js, busytex_wasm, biber_*, preload_data_packages_js, data_packages_js, texmf_local, preload }
 *                                                        ← { print }* … { initialized: versions } | { exception }
 *   → { files, main_tex_path, bibtex, biber, makeindex, rerun, verbose, driver, data_packages_js, remote_endpoint, shell_escape }
 *                                                        ← { print }* … { pdf, synctex, log, exit_code, logs } | { exception }
 */
import { AbortedError } from '../util';

export type BusyTexDriver = 'pdftex_bibtex8' | 'xetex_bibtex8_dvipdfmx' | 'luahbtex_bibtex8';

export interface BusyTexAssetUrls {
  workerJs: string;
  busytexJs: string;
  busytexWasm: string;
  biberJs: string;
  biberWasm: string;
  biberData: string;
}

export interface BusyTexInitProgress {
  /** 'download': bytes of the data package; 'prepare': emscripten run dependencies. */
  phase: 'download' | 'prepare' | 'done';
  loaded: number;
  total: number;
  /** 0–1 */
  fraction: number;
}

export interface BusyTexLogEntry {
  cmd: string;
  texmflog: string;
  missfontlog: string;
  log: string;
  aux: string;
  stdout: string;
  stderr: string;
  exit_code: number;
}

export interface BusyTexWorkerFile {
  path: string;
  contents: string | Uint8Array;
}

export interface BusyTexCompileInput {
  files: BusyTexWorkerFile[];
  mainTexPath: string;
  bibtex: boolean;
  biber: boolean;
  /** null → run makeindex only if a non-empty .idx was produced. */
  makeindex: boolean | null;
  rerun: boolean;
  driver: BusyTexDriver;
  remoteEndpoint?: string;
  shellEscape: boolean;
}

export interface BusyTexCompileOutput {
  pdf: Uint8Array | null;
  synctex: Uint8Array | null;
  log: string;
  exitCode: number;
  logs: BusyTexLogEntry[];
}

export interface BusyTexInitOptions {
  urls: BusyTexAssetUrls;
  /** Absolute URLs of the data package `.js` loaders to preload (exactly one tier). */
  dataPackagesJs: string[];
  onProgress?: (p: BusyTexInitProgress) => void;
  onPrint?: (line: string) => void;
  /** Fail if the worker is silent for this long while initializing (ms). */
  stallTimeoutMs?: number;
  /** Inject {@link WORKER_HOOK_SOURCE} (byte-level download progress, fail fast on fatal errors). Default true. */
  workerHooks?: boolean;
  signal?: AbortSignal;
}

const DOWNLOAD_RE = /^Downloading data\.\.\. \((\d+)\/(\d+)\)$/;
const PREPARE_RE = /^Preparing\.\.\. \((\d+)\/(\d+)\)$/;

/**
 * Executed inside the worker before the pipeline is created (best effort — if
 * it cannot load, e.g. because a CSP forbids blob: scripts, the stock behaviour
 * remains):
 *
 * 1. Download progress. Emscripten data packages call
 *    `Module.setStatus('Downloading data... (loaded/total)')`, where `Module` is
 *    the `BusytexPipeline` class, which has no `setStatus` until the engine has
 *    started. Forward those messages to the main thread.
 * 2. Fail fast on fatal TeX errors. The pipeline treats a run as successful when
 *    stdout is non-empty and lacks known fatal strings; in batchmode stdout only
 *    holds the banner, so a fatal error in the first pass costs two more passes.
 *    A run whose .log says "Fatal error occurred" / "Emergency stop" is a failure.
 */
const WORKER_HOOK_SOURCE = `(function(){
  var P = self.BusytexPipeline;
  if (!P) return;
  if (!Object.prototype.hasOwnProperty.call(P, 'setStatus')) {
    var last = 0;
    P.setStatus = function (msg) {
      var t = Date.now();
      if (typeof msg === 'string' && msg.indexOf('Downloading data... (') === 0 && t - last < 100) return;
      last = t;
      postMessage({ print: String(msg) });
    };
  }
  var proto = P.prototype;
  if (proto && typeof proto._run_cmd === 'function' && !proto._run_cmd.__texit) {
    var orig = proto._run_cmd;
    var patched = function () {
      var res = orig.apply(this, arguments);
      var logs = arguments[10];
      if (res && res.exit_code === 0 && typeof res.log === 'string' && /Fatal error occurred|! Emergency stop/.test(res.log)) {
        if (Array.isArray(logs) && logs.length) logs[logs.length - 1].exit_code = 1;
        return { exit_code: 1, log: res.log };
      }
      return res;
    };
    patched.__texit = true;
    proto._run_cmd = patched;
  }
  // 3. Biber (WASM) double-encodes non-ASCII output (e.g. "Barab{\\\\'a}si" → U+0081 garbage in the .bbl).
  //    --output-safechars makes it emit LaTeX macros instead, which every engine handles.
  if (proto && typeof proto._run_biber === 'function' && !proto._run_biber.__texit) {
    var origBiber = proto._run_biber;
    var patchedBiber = function (FS, texPath, files, verboseArgs, logs) {
      var args = Array.isArray(verboseArgs) ? verboseArgs.slice() : [];
      if (args.indexOf('--output-safechars') === -1) args.unshift('--output-safechars');
      return origBiber.call(this, FS, texPath, files, args, logs);
    };
    patchedBiber.__texit = true;
    proto._run_biber = patchedBiber;
  }
})();`;

type Message = Record<string, unknown>;

interface PendingOp {
  onMessage(data: Message): void;
  onError(err: Error): void;
}

export class BusyTexWorkerClient {
  private worker: Worker | null;
  private op: PendingOp | null = null;
  private _versions: Record<string, string> = {};
  private _busy = false;

  private constructor(
    worker: Worker,
    readonly dataPackagesJs: readonly string[],
  ) {
    this.worker = worker;
    worker.onmessage = (ev: MessageEvent) => this.op?.onMessage((ev.data ?? {}) as Message);
    worker.onerror = (ev: ErrorEvent) => {
      ev.preventDefault?.();
      this.op?.onError(new Error(ev.message ? `BusyTeX worker error: ${ev.message}` : 'BusyTeX worker crashed'));
    };
    worker.onmessageerror = () => this.op?.onError(new Error('BusyTeX worker sent an unreadable message'));
  }

  /** Applet versions reported by the engine (`pdftex`, `xetex`, …). */
  get versions(): Readonly<Record<string, string>> {
    return this._versions;
  }

  get alive(): boolean {
    return this.worker !== null;
  }

  get busy(): boolean {
    return this._busy;
  }

  /** Spawn a worker and initialise the engine with the given data packages. */
  static async create(opts: BusyTexInitOptions): Promise<BusyTexWorkerClient> {
    if (opts.signal?.aborted) throw new AbortedError();
    const worker = new Worker(opts.urls.workerJs, { name: 'busytex' });
    const client = new BusyTexWorkerClient(worker, opts.dataPackagesJs);
    try {
      let hooked = false;
      if (opts.workerHooks !== false) hooked = await client.installHooks(opts.signal);
      await client.init(opts, hooked);
      return client;
    } catch (err) {
      client.terminate();
      throw err;
    }
  }

  private async installHooks(signal?: AbortSignal): Promise<boolean> {
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return false;
    const url = URL.createObjectURL(new Blob([WORKER_HOOK_SOURCE], { type: 'text/javascript' }));
    try {
      return await this.request<boolean>(
        { load_shell_handler_script: url },
        (data, done) => {
          if (data.shell_handler_script_loaded !== undefined) done(true);
          else if (data.exception !== undefined) done(false); // e.g. CSP forbids blob: scripts — stock behaviour remains
        },
        { timeoutMs: 10_000, signal, timeoutResult: false },
      );
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  private async init(opts: BusyTexInitOptions, hooked: boolean): Promise<void> {
    const { urls } = opts;
    let sawBytes = false;
    const stall = opts.stallTimeoutMs ?? (hooked ? 120_000 : 600_000);
    const versions = await this.request<Record<string, string>>(
      {
        busytex_js: urls.busytexJs,
        busytex_wasm: urls.busytexWasm,
        biber_js: urls.biberJs,
        biber_wasm: urls.biberWasm,
        biber_data: urls.biberData,
        preload_data_packages_js: [...opts.dataPackagesJs],
        // Empty catalog: disables the pipeline's own \ProvidesPackage-based resolver,
        // which would otherwise load *every* catalog package for tikz/fontspec/… documents.
        data_packages_js: [],
        texmf_local: [],
        preload: true,
      },
      (data, done, fail) => {
        if (data.initialized !== undefined) {
          opts.onProgress?.({ phase: 'done', loaded: 1, total: 1, fraction: 1 });
          done((data.initialized ?? {}) as Record<string, string>);
        } else if (data.exception !== undefined) {
          fail(new Error(String(data.exception)));
        } else if (typeof data.print === 'string') {
          const line = data.print;
          let m = DOWNLOAD_RE.exec(line);
          if (m) {
            sawBytes = true;
            const loaded = Number(m[1]);
            const total = Number(m[2]);
            opts.onProgress?.({ phase: 'download', loaded, total, fraction: total > 0 ? Math.min(1, loaded / total) : 0 });
            return;
          }
          m = PREPARE_RE.exec(line);
          if (m && !sawBytes) {
            const loaded = Number(m[1]);
            const total = Number(m[2]);
            opts.onProgress?.({ phase: 'prepare', loaded, total, fraction: total > 0 ? loaded / total : 0 });
          }
          opts.onPrint?.(line);
        }
      },
      { stallTimeoutMs: stall, signal: opts.signal, timeoutMessage: 'Timed out while starting the TeX engine (no progress)' },
    );
    this._versions = versions;
  }

  /** Run one compilation. Rejects with AbortedError on abort (the worker is terminated). */
  async compile(
    input: BusyTexCompileInput,
    opts: { signal?: AbortSignal; timeoutMs?: number; onPrint?: (line: string) => void } = {},
  ): Promise<BusyTexCompileOutput> {
    this._busy = true;
    try {
      return await this.request<BusyTexCompileOutput>(
        {
          files: input.files,
          main_tex_path: input.mainTexPath,
          bibtex: input.bibtex,
          biber: input.biber,
          makeindex: input.makeindex,
          rerun: input.rerun,
          verbose: 'silent',
          driver: input.driver,
          data_packages_js: [],
          remote_endpoint: input.remoteEndpoint || undefined,
          shell_escape: input.shellEscape,
        },
        (data, done, fail) => {
          if (data.exit_code !== undefined) {
            done({
              pdf: toBytes(data.pdf),
              synctex: toBytes(data.synctex),
              log: typeof data.log === 'string' ? data.log : '',
              exitCode: Number(data.exit_code),
              logs: Array.isArray(data.logs) ? (data.logs as BusyTexLogEntry[]) : [],
            });
          } else if (data.exception !== undefined) {
            fail(new Error(String(data.exception)));
          } else if (typeof data.print === 'string') {
            opts.onPrint?.(data.print);
          }
        },
        {
          timeoutMs: opts.timeoutMs,
          signal: opts.signal,
          timeoutMessage: `Compilation timed out after ${Math.round((opts.timeoutMs ?? 0) / 1000)} s`,
          terminateOnFailure: true,
        },
      );
    } finally {
      this._busy = false;
    }
  }

  terminate(): void {
    const w = this.worker;
    this.worker = null;
    if (w) {
      w.onmessage = null;
      w.onerror = null;
      w.terminate();
    }
    const op = this.op;
    this.op = null;
    op?.onError(new Error('BusyTeX worker terminated'));
  }

  private request<T>(
    message: Message,
    handle: (data: Message, done: (v: T) => void, fail: (e: Error) => void) => void,
    o: {
      timeoutMs?: number;
      stallTimeoutMs?: number;
      signal?: AbortSignal;
      timeoutMessage?: string;
      /** Resolve with this value instead of rejecting on timeout. */
      timeoutResult?: T;
      /** Kill the worker if the operation fails (its state is unknown afterwards). */
      terminateOnFailure?: boolean;
    },
  ): Promise<T> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error('BusyTeX worker is not running'));
    if (this.op) return Promise.reject(new Error('BusyTeX worker is busy'));
    if (o.signal?.aborted) return Promise.reject(new AbortedError());

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let hardTimer: ReturnType<typeof setTimeout> | undefined;
      let stallTimer: ReturnType<typeof setTimeout> | undefined;

      const cleanup = () => {
        settled = true;
        if (hardTimer) clearTimeout(hardTimer);
        if (stallTimer) clearTimeout(stallTimer);
        o.signal?.removeEventListener('abort', onAbort);
        if (this.op === op) this.op = null;
      };
      const done = (v: T) => {
        if (settled) return;
        cleanup();
        resolve(v);
      };
      const fail = (e: Error, terminate = o.terminateOnFailure) => {
        if (settled) return;
        cleanup();
        if (terminate) this.terminate();
        reject(e);
      };
      const onTimeout = () => {
        if (o.timeoutResult !== undefined) return done(o.timeoutResult);
        fail(new Error(o.timeoutMessage ?? 'BusyTeX worker timed out'), true);
      };
      const armStall = () => {
        if (!o.stallTimeoutMs) return;
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(onTimeout, o.stallTimeoutMs);
      };
      const onAbort = () => fail(new AbortedError(), true);

      const op: PendingOp = {
        onMessage: (data) => {
          armStall();
          try {
            handle(data, done, (e) => fail(e));
          } catch (e) {
            fail(e instanceof Error ? e : new Error(String(e)));
          }
        },
        onError: (e) => fail(e, true),
      };
      this.op = op;
      if (o.timeoutMs && o.timeoutMs > 0) hardTimer = setTimeout(onTimeout, o.timeoutMs);
      armStall();
      o.signal?.addEventListener('abort', onAbort, { once: true });
      try {
        worker.postMessage(message);
      } catch (e) {
        fail(e instanceof Error ? e : new Error(String(e)), true);
      }
    });
  }
}

function toBytes(v: unknown): Uint8Array | null {
  if (v instanceof Uint8Array) return v.byteLength > 0 ? v : null;
  if (v instanceof ArrayBuffer) return v.byteLength > 0 ? new Uint8Array(v) : null;
  return null;
}
