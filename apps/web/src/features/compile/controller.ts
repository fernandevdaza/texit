/**
 * App compile controller: owns the single `CompileService` (BusyTeX in the
 * browser, native TeX on desktop, an optional remote server, plugin backends),
 * feeds `useWorkspace.compile`, runs auto-compile and engine warm-up, and
 * implements the `CompileController` bridge used by plugins, AI tools and
 * keyboard shortcuts.
 */
import {
  BusyTexBackend,
  CompileService,
  NativeBackend,
  RemoteBackend,
  detectCompileSettings,
  type BackendStatus,
  type CompileBackend,
  type CompileRequest,
  type CompileResult,
  type CompileServiceResult,
  type CompileStatus as ServiceStatus,
} from '@texit/compiler';
import { normalizePath, parseSyncTex, resolveProjectPath } from '@texit/core';
import type { BibTool, Diagnostic, Disposable, ProjectDoc, ProjectFile, SyncTexData, TexEngine } from '@texit/core';
import { create } from 'zustand';
import { host } from '@/lib/platform';
import { setCompileController, type CompileController } from '@/services/compile';
import { loadCachedResult, saveCachedResult } from './pdfCache';
import { useSettings, type CompileSettings as AppCompileSettings } from '@/state/settings';
import { useLayout, useWorkspace } from '@/state/workspace';
import { t } from '@/lib/i18n';
import { toast } from '@/ui';
import { formatDurationL, localizeDetail } from './format';

export type CompileReason = 'manual' | 'auto' | 'ai' | 'plugin' | 'open';

export const ENGINE_LABELS: Record<TexEngine, string> = { pdflatex: 'pdfLaTeX', xelatex: 'XeLaTeX', lualatex: 'LuaLaTeX' };
export const BACKEND_SHORT: Record<string, string> = { busytex: 'WASM', native: 'Native', remote: 'Remote' };

/** UI-facing state that is not part of the workspace store. */
interface CompileUiState {
  /** Latest availability of each registered backend (refreshed lazily). */
  backends: { id: string; label: string; kind: CompileBackend['kind']; status?: BackendStatus }[];
  /** Engine / backend actually used by the last run. */
  lastEngine?: TexEngine;
  /** Why the engine was chosen ('% !TEX program = xelatex', 'uses fontspec', …). */
  engineReason?: string;
  /** Increments after each finished run (for flash animations). */
  runCounter: number;
  lastOutcome?: 'success' | 'error' | 'cancelled';
  lastDurationMs?: number;
  /** Index of the diagnostic the user last jumped to (F8). */
  cursor: number;
}

export const useCompileUi = create<CompileUiState>(() => ({ backends: [], runCounter: 0, cursor: -1 }));

const BUSYTEX_BASE = `${import.meta.env.BASE_URL}busytex/`;

function engineOf(v: unknown): TexEngine | undefined {
  return v === 'pdflatex' || v === 'xelatex' || v === 'lualatex' ? v : undefined;
}

/** Rewrite SyncTeX input paths below the build dir into project-relative paths. */
function normalizeSyncTex(data: SyncTexData, buildDir: string | undefined, projectPaths: string[]): SyncTexData {
  const known = new Set(projectPaths);
  const root = buildDir ? buildDir.replace(/\\/g, '/').replace(/\/+$/, '') : '';
  const inputs = new Map<number, string>();
  for (const [tag, raw] of data.inputs) {
    const p = raw.replace(/\\/g, '/');
    let rel: string | undefined;
    if (root && p.startsWith(`${root}/`)) rel = normalizePath(p.slice(root.length + 1));
    if (!rel || !known.has(rel)) {
      try {
        rel = resolveProjectPath(p, projectPaths) ?? rel;
      } catch {
        /* resolver unavailable: keep what we have */
      }
    }
    inputs.set(tag, rel && known.has(rel) ? rel : raw);
  }
  return { ...data, inputs };
}

/** Make diagnostic file paths project-relative when possible. */
function resolveDiagnostics(diags: Diagnostic[], projectPaths: string[]): Diagnostic[] {
  const known = new Set(projectPaths);
  return diags.map((d) => {
    if (!d.file || known.has(d.file)) return d;
    let file: string | undefined;
    try {
      file = resolveProjectPath(d.file, projectPaths);
    } catch {
      file = undefined;
    }
    return file ? { ...d, file } : d;
  });
}

/** Short status text for log chunks ("Running biber…"). */
const TOOL_RE = /^\$ (?:busytex )?(pdflatex|xelatex|luahblatex|lualatex|bibtex8|bibtex|biber|makeindex|xdvipdfmx)\b|Running '(pdflatex|xelatex|lualatex|biber|bibtex|makeindex)/m;
const TOOL_LABEL: Record<string, string> = {
  pdflatex: 'pdfLaTeX',
  xelatex: 'XeLaTeX',
  luahblatex: 'LuaLaTeX',
  lualatex: 'LuaLaTeX',
  bibtex8: 'BibTeX',
  bibtex: 'BibTeX',
  biber: 'Biber',
  makeindex: 'MakeIndex',
  xdvipdfmx: 'xdvipdfmx',
};

const isBackendFailure = (r: CompileResult) =>
  r.status === 'error' &&
  (r.diagnostics.some((d) => d.code === 'compile-service') || /^(BusyTeX error|Native compilation failed|Could not reach|Compile server|No compile backend)/.test(r.log));

class AppCompileController implements CompileController {
  readonly service: CompileService;
  private busytex: BusyTexBackend;
  private native: NativeBackend | null = null;
  private remote: RemoteBackend | null = null;
  private remoteReg: Disposable | null = null;
  private busytexReg: Disposable;
  private readonly didListeners = new Set<(r: CompileResult) => void>();
  private lastResult: CompileResult | null = null;
  private pdfVersion = 0;

  private project: ProjectDoc | null = null;
  private projectId: string | null = null;
  private detachProject: (() => void) | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private warmTimer: ReturnType<typeof setTimeout> | undefined;
  private compiledOnce = new Set<string>();
  private liveBuffer = '';
  private liveTimer: ReturnType<typeof setTimeout> | undefined;
  private downloadToast: string | number | null = null;
  private readonly disposers: (() => void)[] = [];

  constructor() {
    const s = useSettings.getState().compile;
    this.service = new CompileService({ lastSuccessCapacity: 6 });
    this.busytex = this.makeBusyTex(s.texliveEndpoint);
    this.busytexReg = this.service.register(this.busytex);
    if (host?.tex) {
      this.native = new NativeBackend();
      this.service.register(this.native);
    }
    this.syncRemote(s);

    this.disposers.push(
      useSettings.subscribe((next, prev) => {
        const a = next.compile;
        const b = prev.compile;
        if (a.texliveEndpoint !== b.texliveEndpoint) {
          this.busytexReg.dispose();
          this.busytex.dispose();
          this.busytex = this.makeBusyTex(a.texliveEndpoint);
          this.busytexReg = this.service.register(this.busytex);
        }
        if (a.remoteUrl !== b.remoteUrl || a.remoteToken !== b.remoteToken) this.syncRemote(a);
        if (a.auto && !b.auto) this.scheduleAuto();
        if (a !== b) void this.refreshBackends();
      }),
    );
    this.service.onStatus((st) => this.onServiceStatus(st));
    this.disposers.push(
      useWorkspace.subscribe((st, prev) => {
        if (st.project !== prev.project || st.session?.id !== prev.session?.id) this.attach(st.project, st.session?.id ?? null);
      }),
    );
    const ws = useWorkspace.getState();
    if (ws.project) this.attach(ws.project, ws.session?.id ?? null);
    void this.refreshBackends();
  }

  private makeBusyTex(endpoint: string): BusyTexBackend {
    return new BusyTexBackend({ basePath: BUSYTEX_BASE, remoteEndpoint: endpoint.trim() || undefined });
  }

  private syncRemote(s: AppCompileSettings) {
    const url = s.remoteUrl.trim();
    if (!url) {
      this.remoteReg?.dispose();
      this.remoteReg = null;
      this.remote = null;
      return;
    }
    if (this.remote) this.remote.configure({ url, token: s.remoteToken || undefined });
    else {
      this.remote = new RemoteBackend({ url, token: s.remoteToken || undefined, label: 'Remote server' });
      this.remoteReg = this.service.register(this.remote);
    }
  }

  // ───────────────────────────── project lifecycle ─────────────────────────────

  private attach(project: ProjectDoc | null, projectId: string | null) {
    this.detachProject?.();
    this.detachProject = null;
    clearTimeout(this.autoTimer);
    clearTimeout(this.warmTimer);
    if (this.projectId && this.projectId !== projectId) this.service.cancel(this.projectId);
    this.project = project;
    this.projectId = projectId;
    this.lastResult = null;
    useCompileUi.setState({ cursor: -1, lastOutcome: undefined, lastDurationMs: undefined, engineReason: undefined, lastEngine: undefined });
    if (!project || !projectId) return;

    const unsub = project.onContentChange(() => this.scheduleAuto());
    this.detachProject = unsub;

    // First open in this session: compile right away (auto) or at least warm up the engine.
    if (!this.compiledOnce.has(projectId)) {
      this.compiledOnce.add(projectId);
      const prev = this.service.lastSuccess(projectId);
      if (prev?.pdf) this.publish(prev, true);
      else
        void loadCachedResult(projectId).then((cached) => {
          // Only if nothing newer arrived meanwhile.
          const ws = useWorkspace.getState();
          if (!cached || this.projectId !== projectId || ws.compile.pdf) return;
          const { status, detail, progress } = ws.compile;
          this.publish(cached, true);
          // A compile may already be running: keep showing its progress over the cached PDF.
          if (status === 'compiling' || status === 'preparing') useWorkspace.getState().setCompile({ status, detail, progress });
        });
      if (useSettings.getState().compile.auto) {
        this.warmTimer = setTimeout(() => void this.compile({ reason: 'open' }), 150);
        return;
      }
    } else {
      const prev = this.service.lastSuccess(projectId);
      if (prev?.pdf) this.publish(prev, true);
    }
    this.warmTimer = setTimeout(() => void this.warmUp(), 1200);
  }

  private scheduleAuto() {
    const s = useSettings.getState().compile;
    if (!s.auto || !this.project) return;
    clearTimeout(this.autoTimer);
    this.autoTimer = setTimeout(() => void this.compile({ reason: 'auto', draft: s.draftWhileTyping }), Math.max(200, s.autoDelayMs));
  }

  /** Download / start the engine the project will need, without compiling. */
  private async warmUp() {
    const project = this.project;
    const projectId = this.projectId;
    if (!project || !projectId || this.service.isCompiling(projectId)) return;
    try {
      const opts = this.buildOptions(project, 'auto');
      const { backend } = await this.service.chooseBackend(opts.backendId, opts.engine);
      if (typeof backend.prepareFor !== 'function') return;
      const req: CompileRequest = {
        files: opts.files,
        mainPath: opts.mainPath ?? '',
        engine: opts.engine,
        bibTool: opts.bibTool,
        synctex: true,
        projectId,
      };
      await backend.prepareFor(req, (st) => {
        if (st.progress === undefined || this.projectId !== projectId || this.service.isCompiling(projectId)) return;
        this.onBackendProgress(st);
        useWorkspace.getState().setCompile({ status: 'preparing', detail: this.progressText(st), progress: st.progress });
      });
      if (this.projectId === projectId && !this.service.isCompiling(projectId) && useWorkspace.getState().compile.status === 'preparing') {
        useWorkspace.getState().setCompile({ status: this.lastResult ? (this.lastResult.status === 'success' ? 'success' : 'error') : 'idle', detail: undefined, progress: undefined });
      }
      this.finishDownloadToast();
    } catch {
      /* warm-up is best effort */
    }
  }

  // ───────────────────────────── compile ─────────────────────────────

  private buildOptions(project: ProjectDoc, reason: CompileReason) {
    const meta = project.getMeta();
    const settings = useSettings.getState().compile;
    const files = project.snapshot();
    const mainId = project.getMainFileId();
    const mainPath = mainId ? project.getPath(mainId) : undefined;
    // Magic comments win; package heuristics only override the pdfLaTeX default (pdfLaTeX can't run fontspec & co.).
    const metaEngine = engineOf(meta.engine) ?? 'pdflatex';
    const detected = detectCompileSettings(files, mainPath, { engine: 'auto', defaultEngine: metaEngine });
    let engine: TexEngine = metaEngine;
    let engineReason: string | undefined = meta.engine ? 'project setting' : undefined;
    if (detected.engineSource === 'magic' || (detected.engineSource === 'packages' && metaEngine === 'pdflatex')) {
      engine = detected.engine;
      engineReason = detected.engineReason;
    }
    const backendPref = meta.compilerBackend || settings.backend;
    return {
      files,
      mainPath: detected.mainPath || mainPath,
      engine,
      engineReason,
      bibTool: (meta.bibTool || 'auto') as BibTool,
      backendId: backendPref && backendPref !== 'auto' ? backendPref : undefined,
      synctex: settings.synctex,
      shellEscape: settings.shellEscape,
      reason,
    };
  }

  async compile(opts: { draft?: boolean; reason?: CompileReason } = {}): Promise<CompileResult | null> {
    const project = this.project;
    const projectId = this.projectId;
    if (!project || !projectId) return null;
    clearTimeout(this.autoTimer);
    if (opts.reason !== 'auto' && opts.reason !== 'open') clearTimeout(this.warmTimer);
    const reason = opts.reason ?? 'manual';
    const base = this.buildOptions(project, reason);
    useCompileUi.setState({ engineReason: base.engineReason });

    const result = await this.service.compile({
      projectId,
      // Read the latest snapshot when the run actually starts (coalesced runs get fresh content).
      files: () => (this.project === project ? project.snapshot() : base.files),
      mainPath: base.mainPath,
      engine: base.engine,
      bibTool: base.bibTool,
      synctex: base.synctex,
      shellEscape: base.shellEscape,
      draft: !!opts.draft,
      backendId: base.backendId,
      reason,
      onLog: (chunk) => this.onLog(projectId, chunk),
    });
    if (this.projectId !== projectId) return result;
    this.publish(result, false);
    return result;
  }

  cancel(): void {
    clearTimeout(this.autoTimer);
    if (this.projectId) this.service.cancel(this.projectId);
  }

  /** Clear the in-browser TeX Live cache, then recompile. */
  async clearCacheAndRecompile(): Promise<void> {
    this.cancel();
    try {
      await this.busytex.clearCache();
      toast.success(t('compile.cacheCleared'), { description: t('compile.cacheClearedDesc') });
    } catch (err) {
      toast.error(t('compile.cacheClearFailed'), { description: err instanceof Error ? err.message : String(err) });
    }
    await this.compile({ reason: 'manual' });
  }

  private onLog(projectId: string, chunk: string) {
    if (this.projectId !== projectId) return;
    this.liveBuffer += chunk;
    const m = TOOL_RE.exec(chunk);
    if (m) {
      const tool = TOOL_LABEL[m[1] ?? m[2]] ?? m[1] ?? m[2];
      const ws = useWorkspace.getState();
      if (ws.compile.status === 'compiling') ws.setCompile({ detail: `Running ${tool}…` });
    }
    if (this.liveTimer) return;
    this.liveTimer = setTimeout(() => {
      this.liveTimer = undefined;
      if (this.projectId !== projectId) return;
      const buf = this.liveBuffer;
      this.liveBuffer = '';
      const ws = useWorkspace.getState();
      const next = ws.compile.liveLog + buf;
      ws.setCompile({ liveLog: next.length > 400_000 ? next.slice(-300_000) : next });
    }, 120);
  }

  private onServiceStatus(st: ServiceStatus) {
    if (st.projectId !== this.projectId) return;
    const ws = useWorkspace.getState();
    if (st.state === 'preparing') {
      if (ws.compile.status !== 'preparing' && ws.compile.status !== 'compiling') {
        clearTimeout(this.liveTimer);
        this.liveTimer = undefined;
        this.liveBuffer = '';
        ws.setCompile({ liveLog: '' });
      }
      if (st.progress !== undefined) this.onBackendProgress({ available: true, detail: st.message, progress: st.progress });
      ws.setCompile({
        status: 'preparing',
        detail: st.progress !== undefined ? this.progressText({ available: true, detail: st.message, progress: st.progress }) : st.message,
        progress: st.progress,
        startedAt: st.startedAt ?? Date.now(),
        backendId: st.backendId,
      });
    } else if (st.state === 'compiling') {
      ws.setCompile({ status: 'compiling', detail: 'Compiling…', progress: undefined, startedAt: st.startedAt ?? ws.compile.startedAt ?? Date.now(), backendId: st.backendId });
    }
    // success / error / idle are published from the result (with the PDF), see publish().
  }

  private progressText(st: BackendStatus): string {
    const pct = st.progress !== undefined ? ` ${Math.round(st.progress * 100)}%` : '';
    const detail = (st.detail ?? 'Preparing').replace(/\s*·\s*[\d.]+ [KM]B \/ [\d.]+ [KM]B$/, '');
    return `${detail}${pct}`;
  }

  private onBackendProgress(st: BackendStatus) {
    if (!st.detail?.startsWith('Downloading') || st.progress === undefined) return;
    const title = st.detail.replace(/\s*·.*$/, '').replace(/…$/, '');
    const size = /\/ ([\d.]+ [KM]B)$/.exec(st.detail)?.[1];
    if (this.downloadToast === null) {
      this.downloadToast = toast.loading(localizeDetail(title), {
        description: t('compile.download.desc', { size: size ? ` (${size})` : '' }),
      });
    }
  }

  private finishDownloadToast(failed = false) {
    if (this.downloadToast === null) return;
    const id = this.downloadToast;
    this.downloadToast = null;
    if (failed) toast.error(t('compile.download.failed'), { id, description: t('compile.download.failedDesc') });
    else toast.success(t('compile.download.ready'), { id, description: t('compile.download.readyDesc') });
  }

  /** Push a result into the workspace store (keeps the last good PDF on failure). */
  private publish(result: CompileResult, restored: boolean) {
    const ws = useWorkspace.getState();
    const project = this.project;
    const projectPaths = project ? project.listFiles().map((f) => f.path) : [];
    const diagnostics = resolveDiagnostics(result.diagnostics ?? [], projectPaths);
    const patch: Parameters<typeof ws.setCompile>[0] = {
      result,
      diagnostics,
      detail: undefined,
      progress: undefined,
      backendId: result.backendId || ws.compile.backendId,
    };

    if (result.status === 'success' && result.pdf) {
      let synctex: SyncTexData | null = null;
      if (result.synctex) {
        try {
          synctex = normalizeSyncTex(parseSyncTex(result.synctex), result.buildDir, projectPaths);
        } catch (err) {
          console.warn('[compile] SyncTeX parse failed', err);
        }
      }
      this.pdfVersion = Math.max(this.pdfVersion, ws.compile.pdfVersion) + 1;
      Object.assign(patch, { status: 'success', pdf: result.pdf, pdfVersion: this.pdfVersion, synctex });
    } else if (result.status === 'cancelled') {
      patch.status = 'cancelled';
    } else {
      patch.status = 'error';
    }
    if (!restored) {
      clearTimeout(this.liveTimer);
      this.liveTimer = undefined;
      if (this.liveBuffer) patch.liveLog = ws.compile.liveLog + this.liveBuffer;
      this.liveBuffer = '';
    }
    ws.setCompile(patch);
    this.lastResult = result;
    if (!restored && result.status === 'success' && this.projectId) void saveCachedResult(this.projectId, result);

    const timing = (result as Partial<CompileServiceResult>).timing;
    useCompileUi.setState((s) => ({
      runCounter: restored ? s.runCounter : s.runCounter + 1,
      lastOutcome: result.status,
      lastDurationMs: timing?.totalMs ?? result.durationMs,
      lastEngine: result.engine,
      cursor: -1,
    }));
    if (restored) return;

    this.finishDownloadToast(result.status === 'error' && /download|fetch|network/i.test(result.log) && !result.pdf);
    if (isBackendFailure(result)) {
      toast.error(t('compile.couldNotRun'), {
        description: result.log.split('\n')[0].slice(0, 220),
        action: { label: t('compile.showLog'), onClick: () => useLayout.getState().showBottomPanel('log') },
      });
    }
    for (const l of this.didListeners) {
      try {
        l(result);
      } catch (err) {
        console.error('[compile] onDidCompile listener failed', err);
      }
    }
  }

  // ───────────────────────────── bridge API ─────────────────────────────

  registerBackend(backend: CompileBackend): Disposable {
    const d = this.service.register(backend);
    void this.refreshBackends();
    return {
      dispose: () => {
        d.dispose();
        void this.refreshBackends();
      },
    };
  }

  listBackends(): CompileBackend[] {
    return this.service.list();
  }

  onWillCompile(cb: (files: ProjectFile[]) => ProjectFile[] | void | Promise<ProjectFile[] | void>): Disposable {
    return this.service.onWillCompile(async (ctx) => {
      const out = await cb(ctx.files);
      return Array.isArray(out) ? out : undefined;
    });
  }

  onDidCompile(cb: (result: CompileResult) => void): Disposable {
    this.didListeners.add(cb);
    return { dispose: () => this.didListeners.delete(cb) };
  }

  getLastResult(): CompileResult | null {
    return this.lastResult;
  }

  /** Re-query every backend's availability (for menus / status bar). */
  async refreshBackends(): Promise<void> {
    const list = await this.service.listStatus();
    useCompileUi.setState({
      backends: list.map(({ backend, status }) => ({ id: backend.id, label: backend.label, kind: backend.kind, status })),
    });
  }

  /** Jump to the next / previous diagnostic (errors first). */
  jumpToDiagnostic(dir: 1 | -1): boolean {
    const ws = useWorkspace.getState();
    const rank = { error: 0, warning: 1, badbox: 2, info: 3 } as const;
    const list = ws.compile.diagnostics
      .filter((d) => d.file && d.line && ws.project?.findByPath(d.file))
      .sort((a, b) => rank[a.severity] - rank[b.severity]);
    if (!list.length) return false;
    const cur = useCompileUi.getState().cursor;
    const next = cur < 0 ? (dir === 1 ? 0 : list.length - 1) : (cur + dir + list.length) % list.length;
    useCompileUi.setState({ cursor: next });
    const d = list[next];
    ws.revealLocation(d.file!, d.line!);
    toast(`${next + 1}/${list.length} · ${d.message.slice(0, 90)}`, { id: 'compile-jump', duration: 1800 });
    return true;
  }

  dispose() {
    this.detachProject?.();
    clearTimeout(this.autoTimer);
    clearTimeout(this.warmTimer);
    clearTimeout(this.liveTimer);
    this.disposers.forEach((d) => d());
    this.service.dispose();
    this.busytex.dispose();
    this.native?.dispose();
  }
}

let instance: AppCompileController | null = null;

export function getController(): AppCompileController | null {
  return instance;
}

export function startCompileController(): () => void {
  if (!instance) {
    instance = new AppCompileController();
    setCompileController(instance);
  }
  return () => {
    setCompileController(null);
    instance?.dispose();
    instance = null;
  };
}

export function formatResultSummary(): string | null {
  const ui = useCompileUi.getState();
  if (!ui.lastOutcome || ui.lastDurationMs === undefined) return null;
  return t(ui.lastOutcome === 'success' ? 'compile.status.compiledIn' : 'compile.status.failedIn', { duration: formatDurationL(ui.lastDurationMs) });
}
