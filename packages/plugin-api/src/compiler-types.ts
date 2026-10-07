// Re-declared here (structurally identical to @texit/compiler) so that the
// MIT-licensed plugin API does not depend on AGPL compiler code.
import type { BibTool, Diagnostic, ProjectFile, TexEngine } from '@texit/core';

export interface CompileRequest {
  files: ProjectFile[];
  mainPath: string;
  engine: TexEngine;
  bibTool: BibTool;
  makeindex?: boolean | 'auto';
  synctex: boolean;
  draft?: boolean;
  shellEscape?: boolean;
  projectId: string;
  signal?: AbortSignal;
  onLog?: (chunk: string) => void;
}

export interface CompileResult {
  status: 'success' | 'error' | 'cancelled';
  pdf?: Uint8Array;
  synctex?: Uint8Array;
  log: string;
  diagnostics: Diagnostic[];
  durationMs: number;
  backendId: string;
  engine: TexEngine;
  buildDir?: string;
}

export interface BackendStatus {
  available: boolean;
  detail?: string;
  /** Download / preparation progress as a fraction in [0, 1] (undefined when indeterminate). */
  progress?: number;
}

export interface CompileBackend {
  id: string;
  label: string;
  kind: 'wasm' | 'native' | 'remote' | 'plugin';
  description?: string;
  engines: TexEngine[];
  status(): Promise<BackendStatus>;
  prepare?(onProgress?: (s: BackendStatus) => void): Promise<void>;
  /** Like `prepare`, for a concrete request (e.g. pick and download the TeX Live packages this project needs). */
  prepareFor?(req: CompileRequest, onProgress?: (s: BackendStatus) => void): Promise<void>;
  /** Status changes outside `prepare` (e.g. a download triggered by `compile`). Returns an unsubscribe handle. */
  onStatusChange?(cb: (s: BackendStatus) => void): { dispose(): void };
  compile(req: CompileRequest): Promise<CompileResult>;
  dispose?(): void;
}
