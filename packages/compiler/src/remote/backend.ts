/** HTTP compile backend speaking the TexIt remote protocol v1 (see ./protocol.ts). */
import type { TexEngine } from '@texit/core';
import type { BackendStatus, CompileBackend, CompileRequest, CompileResult } from '../types';
import { anySignal, base64ToBytes, errorMessage, now } from '../util';
import {
  REMOTE_PROTOCOL_VERSION,
  encodeRemoteFiles,
  isRemoteCompileResponse,
  isRemoteError,
  type RemoteCompileRequestBody,
  type RemoteInfo,
} from './protocol';

export interface RemoteBackendOptions {
  /** Base URL of the compile server, e.g. `https://latex.example.org` (endpoints live under `/v1/`). */
  url: string;
  /** Bearer token, if the server requires one. */
  token?: string;
  /** Backend id (default 'remote'); use distinct ids to register several servers. */
  id?: string;
  label?: string;
  /** Client-side timeout per compile (default 5 min). */
  timeoutMs?: number;
  /** Extra request headers. */
  headers?: Record<string, string>;
  /** How long `/v1/info` results are cached by `status()` (default 30 s). */
  statusTtlMs?: number;
  fetch?: typeof fetch;
}

export class RemoteBackend implements CompileBackend {
  readonly id: string;
  readonly kind = 'remote' as const;
  readonly label: string;
  readonly description = 'Compiles on a self-hosted TexIt compile server (latexmk / tectonic over HTTP).';
  engines: TexEngine[] = ['pdflatex', 'xelatex', 'lualatex'];

  private opts: RemoteBackendOptions;
  private infoCache: { at: number; info?: RemoteInfo; error?: string } | null = null;

  constructor(opts: RemoteBackendOptions) {
    this.opts = { ...opts };
    this.id = opts.id ?? 'remote';
    this.label = opts.label ?? 'Remote compile server';
  }

  /** Update URL / token / headers at runtime (e.g. from the settings UI). */
  configure(patch: Partial<Pick<RemoteBackendOptions, 'url' | 'token' | 'headers' | 'timeoutMs'>>): void {
    this.opts = { ...this.opts, ...patch };
    this.infoCache = null;
  }

  get url(): string {
    return this.opts.url.trim().replace(/\/+$/, '');
  }

  private get fetchFn(): typeof fetch {
    return this.opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  }

  private headers(json: boolean): Record<string, string> {
    const h: Record<string, string> = { Accept: 'application/json', ...(this.opts.headers ?? {}) };
    if (json) h['Content-Type'] = 'application/json';
    if (this.opts.token) h.Authorization = `Bearer ${this.opts.token}`;
    return h;
  }

  /** Fetch `/v1/info` (uncached). */
  async info(signal?: AbortSignal): Promise<RemoteInfo> {
    if (!this.url) throw new Error('No compile server URL configured');
    const timeout = anySignal([signal, AbortSignal.timeout(10_000)]);
    try {
      const res = await this.fetchFn(`${this.url}/v1/info`, { headers: this.headers(false), signal: timeout.signal });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(isRemoteError(body) ? `${res.status} ${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`);
      if (!body || typeof body !== 'object' || typeof (body as RemoteInfo).protocol !== 'number') throw new Error('Not a TexIt compile server');
      const info = body as RemoteInfo;
      if (info.protocol !== REMOTE_PROTOCOL_VERSION) throw new Error(`Unsupported protocol version ${info.protocol}`);
      if (Array.isArray(info.engines) && info.engines.length) this.engines = info.engines;
      return info;
    } finally {
      timeout.dispose();
    }
  }

  async status(): Promise<BackendStatus> {
    if (!this.url) return { available: false, detail: 'No compile server URL configured' };
    const ttl = this.opts.statusTtlMs ?? 30_000;
    if (!this.infoCache || Date.now() - this.infoCache.at > ttl) {
      try {
        this.infoCache = { at: Date.now(), info: await this.info() };
      } catch (err) {
        this.infoCache = { at: Date.now(), error: errorMessage(err) };
      }
    }
    const { info, error } = this.infoCache;
    if (!info) return { available: false, detail: `${this.url}: ${error ?? 'unreachable'}` };
    const parts = [info.name, info.distribution, info.drivers.join('/'), info.engines.join(', ')].filter(Boolean);
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
    if (!this.url) return base({ status: 'error', log: 'No compile server URL configured.\n' });
    if (req.signal?.aborted) return base({ status: 'cancelled', log: 'Compilation cancelled.\n' });

    const body: RemoteCompileRequestBody = {
      protocol: REMOTE_PROTOCOL_VERSION,
      projectId: req.projectId,
      mainPath: req.mainPath,
      engine: req.engine,
      bibTool: req.bibTool,
      makeindex: req.makeindex ?? 'auto',
      synctex: req.synctex,
      draft: req.draft,
      files: encodeRemoteFiles(req.files),
    };
    const timeoutMs = this.opts.timeoutMs ?? 300_000;
    const combined = anySignal([req.signal, AbortSignal.timeout(timeoutMs)]);
    req.onLog?.(`[remote] POST ${this.url}/v1/compile (${req.engine})\n`);
    try {
      const res = await this.fetchFn(`${this.url}/v1/compile`, {
        method: 'POST',
        headers: this.headers(true),
        body: JSON.stringify(body),
        signal: combined.signal,
      });
      const json: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = isRemoteError(json) ? `${json.error.code}: ${json.error.message}` : `HTTP ${res.status} ${res.statusText}`;
        return base({ status: 'error', log: `Compile server rejected the request (${res.status}) — ${msg}\n` });
      }
      if (!isRemoteCompileResponse(json)) return base({ status: 'error', log: 'Compile server returned an invalid response.\n' });
      const pdf = json.pdfBase64 ? base64ToBytes(json.pdfBase64) : undefined;
      const success = json.status === 'success' && !!pdf?.byteLength;
      if (json.driver) req.onLog?.(`[remote] ${json.driver} finished with status ${json.status}\n`);
      return base({
        status: success ? 'success' : 'error',
        pdf: success ? pdf : undefined,
        synctex: success && req.synctex && json.synctexBase64 ? base64ToBytes(json.synctexBase64) : undefined,
        log: json.log ?? '',
        buildDir: json.buildDir,
      });
    } catch (err) {
      if (req.signal?.aborted) return base({ status: 'cancelled', log: 'Compilation cancelled.\n' });
      if (combined.signal.aborted) return base({ status: 'error', log: `Compile server did not answer within ${Math.round(timeoutMs / 1000)} s.\n` });
      return base({
        status: 'error',
        log: `Could not reach the compile server at ${this.url}: ${errorMessage(err)}\n(Check the URL, that the server is running and that it allows CORS from this origin.)\n`,
      });
    } finally {
      combined.dispose();
    }
  }
}
