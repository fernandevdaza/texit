/**
 * TexIt remote compile protocol, version 1.
 *
 * A deliberately small HTTP + JSON protocol so anyone can self-host a compile
 * server (reference implementation: `apps/compile-server`).
 *
 *   GET  {base}/v1/info      → 200 RemoteInfo
 *   POST {base}/v1/compile   (Content-Type: application/json, body RemoteCompileRequestBody)
 *                            → 200 RemoteCompileResponseBody   (the compile ran: success OR TeX error/timeout)
 *                            → 4xx/5xx RemoteErrorBody          (the request was rejected)
 *
 * - Auth: optional `Authorization: Bearer <token>`; servers answer 401 when it is required.
 * - Files: `text` (UTF-8) for text files, `base64` for binary files (images, PDFs, fonts).
 *   Paths are POSIX, project-relative, without `..` segments.
 * - Servers MUST run TeX without shell escape, MUST enforce size/time limits and
 *   SHOULD send CORS headers so browsers can call them directly.
 * - Error codes: bad-request (400), unauthorized (401), too-large (413),
 *   busy (429 / 503, with Retry-After), internal (500).
 */
import type { BibTool, ProjectFile, TexEngine } from '@texit/core';
import { base64ToBytes, bytesToBase64, compactBytes } from '../util';

export const REMOTE_PROTOCOL_VERSION = 1;

export interface RemoteFile {
  path: string;
  /** UTF-8 text content (text files). */
  text?: string;
  /** Base64 content (binary files). */
  base64?: string;
}

export interface RemoteCompileRequestBody {
  protocol: typeof REMOTE_PROTOCOL_VERSION;
  /** Opaque project id; servers may use it to keep a warm build directory. */
  projectId?: string;
  mainPath: string;
  engine: TexEngine;
  bibTool: BibTool;
  makeindex?: boolean | 'auto';
  synctex: boolean;
  /** Single pass (no reruns). */
  draft?: boolean;
  files: RemoteFile[];
}

export interface RemoteCompileResponseBody {
  status: 'success' | 'error';
  pdfBase64?: string;
  /** Gzipped SyncTeX (`.synctex.gz`) bytes. Paths inside are absolute below `buildDir`. */
  synctexBase64?: string;
  log: string;
  durationMs?: number;
  /** Build directory on the server (for SyncTeX path mapping). */
  buildDir?: string;
  /** e.g. 'latexmk' | 'tectonic'. */
  driver?: string;
}

export interface RemoteInfo {
  protocol: number;
  name: string;
  version: string;
  engines: TexEngine[];
  drivers: string[];
  distribution?: string;
  auth: 'none' | 'bearer';
  limits: { maxRequestBytes: number; timeoutMs: number; maxFiles: number };
}

export interface RemoteErrorBody {
  error: { code: 'bad-request' | 'unauthorized' | 'too-large' | 'busy' | 'internal' | string; message: string };
}

export function encodeRemoteFiles(files: ProjectFile[]): RemoteFile[] {
  return files.map((f) =>
    typeof f.content === 'string' ? { path: f.path, text: f.content } : { path: f.path, base64: bytesToBase64(compactBytes(f.content)) },
  );
}

export function decodeRemoteFiles(files: RemoteFile[]): ProjectFile[] {
  return files.map((f) => ({ path: f.path, content: f.base64 !== undefined ? base64ToBytes(f.base64) : (f.text ?? '') }));
}

export function isRemoteCompileResponse(v: unknown): v is RemoteCompileResponseBody {
  return !!v && typeof v === 'object' && ((v as RemoteCompileResponseBody).status === 'success' || (v as RemoteCompileResponseBody).status === 'error');
}

export function isRemoteError(v: unknown): v is RemoteErrorBody {
  return !!v && typeof v === 'object' && typeof (v as RemoteErrorBody).error?.message === 'string';
}
