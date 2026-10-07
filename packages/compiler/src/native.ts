/**
 * Native TeX backend (desktop only): delegates to the Electron host bridge
 * (`window.texit.tex`), which runs latexmk / tectonic / the raw engine on a
 * persistent per-project build directory.
 */
import { getHost } from '@texit/core';
import type { NativeCompileRequest, NativeTexInfo, NativeTexTool, TexEngine, TexitHost } from '@texit/core';
import type { BackendStatus, CompileRequest, CompileResult, CompileBackend } from './types';
import { compactBytes, errorMessage, now, randomId } from './util';

export interface NativeBackendOptions {
  /** Host accessor (default: `getHost()` from @texit/core). */
  host?: () => TexitHost | undefined;
  /** Build driver (default 'auto': latexmk → tectonic → raw engine). */
  driver?: NativeCompileRequest['driver'];
  /** Extra environment variables for the TeX process. */
  env?: Record<string, string>;
  /** How long `detect()` results are cached (default 60 s). */
  detectTtlMs?: number;
}

const ENGINE_TOOLS: Record<TexEngine, string> = { pdflatex: 'pdflatex', xelatex: 'xelatex', lualatex: 'lualatex' };

function versionLabel(tool: NativeTexTool): string {
  const v = tool.version?.split('\n')[0]?.trim();
  return v ? `${tool.id} (${v.length > 60 ? `${v.slice(0, 57)}…` : v})` : tool.id;
}

export class NativeBackend implements CompileBackend {
  readonly id = 'native';
  readonly kind = 'native' as const;
  readonly label = 'Local TeX installation';
  readonly description = 'Uses the TeX distribution installed on this computer (TeX Live, MacTeX, MiKTeX or Tectonic) via latexmk.';
  readonly engines: TexEngine[] = ['pdflatex', 'xelatex', 'lualatex'];

  private readonly opts: NativeBackendOptions;
  private info: { value: NativeTexInfo; at: number } | null = null;
  private detecting: Promise<NativeTexInfo | null> | null = null;
  private readonly running = new Set<string>();

  constructor(opts: NativeBackendOptions = {}) {
    this.opts = opts;
  }

  private host(): TexitHost | undefined {
    try {
      return (this.opts.host ?? getHost)();
    } catch {
      return undefined;
    }
  }

  /** Detected TeX tools (cached; `force` re-runs detection, e.g. after the user installed TeX). */
  async detect(force = false): Promise<NativeTexInfo | null> {
    const host = this.host();
    if (!host?.tex) return null;
    const ttl = this.opts.detectTtlMs ?? 60_000;
    if (!force && this.info && Date.now() - this.info.at < ttl) return this.info.value;
    if (!this.detecting) {
      this.detecting = host.tex
        .detect()
        .then((value) => {
          this.info = { value, at: Date.now() };
          return value;
        })
        .catch(() => null)
        .finally(() => {
          this.detecting = null;
        });
    }
    return this.detecting;
  }

  /** Engines usable with the detected tools (tectonic covers all three via its XeTeX core). */
  supportedEngines(info: NativeTexInfo | null): TexEngine[] {
    if (!info) return [];
    const ids = new Set(info.tools.map((t) => t.id));
    const out = this.engines.filter((e) => ids.has(ENGINE_TOOLS[e]));
    if (!out.length && ids.has('tectonic')) return [...this.engines];
    return out;
  }

  async status(): Promise<BackendStatus> {
    const host = this.host();
    if (!host?.tex) return { available: false, detail: 'Only available in the desktop app' };
    const info = await this.detect();
    if (!info) return { available: false, detail: 'Could not detect a TeX installation' };
    const engines = this.supportedEngines(info);
    if (!engines.length) {
      return { available: false, detail: 'No TeX installation found — install TeX Live, MacTeX, MiKTeX or Tectonic' };
    }
    const ids = new Set(info.tools.map((t) => t.id));
    const driver = ids.has('latexmk') ? 'latexmk' : ids.has('tectonic') ? 'tectonic' : 'engine';
    const driverTool = info.tools.find((t) => t.id === driver);
    const parts = [
      info.distribution,
      driverTool ? versionLabel(driverTool) : undefined,
      engines.join(', '),
      ['biber', 'bibtex', 'makeindex'].filter((t) => ids.has(t)).join(', ') || undefined,
    ].filter(Boolean);
    return { available: true, detail: parts.join(' · ') };
  }

  async compile(req: CompileRequest): Promise<CompileResult> {
    const t0 = now();
    const base = (r: Partial<CompileResult> & Pick<CompileResult, 'status' | 'log'>): CompileResult => ({
      diagnostics: [],
      durationMs: Math.round(now() - t0),
      backendId: this.id,
      engine: req.engine,
      ...r,
    });
    const host = this.host();
    if (!host?.tex) return base({ status: 'error', log: 'The native TeX backend is only available in the desktop app.\n' });
    if (req.signal?.aborted) return base({ status: 'cancelled', log: 'Compilation cancelled.\n' });

    const jobId = randomId('job-');
    const nativeReq: NativeCompileRequest = {
      jobId,
      projectId: req.projectId,
      // Structured clone over IPC copies whole buffers of typed-array views: compact them.
      files: req.files.map((f) => ({ path: f.path, content: typeof f.content === 'string' ? f.content : compactBytes(f.content) })),
      mainPath: req.mainPath,
      engine: req.engine,
      driver: this.opts.driver ?? 'auto',
      bibTool: req.bibTool,
      synctex: req.synctex,
      shellEscape: req.shellEscape,
      draft: req.draft,
      makeindex: req.makeindex,
      env: this.opts.env,
    };

    let cancelled = false;
    const onAbort = () => {
      cancelled = true;
      void host.tex.cancel(jobId).catch(() => undefined);
    };
    req.signal?.addEventListener('abort', onAbort, { once: true });
    this.running.add(jobId);
    try {
      const res = await host.tex.compile(nativeReq, req.onLog);
      const status = cancelled ? 'cancelled' : res.status;
      if (res.command) req.onLog?.(`[native] ${res.command}\n`);
      return base({
        status,
        pdf: status === 'success' ? res.pdf : undefined,
        synctex: status === 'success' && req.synctex ? res.synctex : undefined,
        log: res.log,
        durationMs: res.durationMs || Math.round(now() - t0),
        buildDir: res.buildDir,
      });
    } catch (err) {
      if (cancelled) return base({ status: 'cancelled', log: 'Compilation cancelled.\n' });
      return base({ status: 'error', log: `Native compilation failed: ${errorMessage(err)}\n` });
    } finally {
      this.running.delete(jobId);
      req.signal?.removeEventListener('abort', onAbort);
    }
  }

  /** Cancel every running native job. */
  dispose(): void {
    const host = this.host();
    for (const id of this.running) void host?.tex.cancel(id).catch(() => undefined);
    this.running.clear();
  }
}
