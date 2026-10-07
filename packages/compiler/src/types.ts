// Single source of truth lives in the (MIT) plugin API so plugins can provide compile backends.
import type { BackendStatus, CompileBackend, CompileRequest } from '@texit/plugin-api';
import type { Disposable } from '@texit/core';

export type {
  BackendStatus,
  CompileBackend,
  CompileRequest,
  CompileResult,
} from '@texit/plugin-api';

export type CompileBackendKind = 'wasm' | 'native' | 'remote' | 'plugin';

/**
 * Optional capabilities a backend may implement on top of `CompileBackend`.
 * `CompileService` detects them by duck typing, so plugin backends can opt in
 * without depending on this package.
 *
 * `BackendStatus.progress` is a fraction in [0, 1] throughout this package.
 */
export interface CompileBackendExtensions {
  /**
   * Like `prepare`, but for a concrete request (e.g. BusyTeX picks the TeX Live
   * data package the project needs before downloading anything).
   */
  prepareFor?(req: CompileRequest, onProgress?: (s: BackendStatus) => void): Promise<void>;
  /** Status changes outside of `prepare` (e.g. a data-package download triggered by `compile`). */
  onStatusChange?(cb: (s: BackendStatus) => void): Disposable;
}

export type ExtendedCompileBackend = CompileBackend & CompileBackendExtensions;
