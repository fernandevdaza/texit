export * from './types';

// Orchestration
export { CompileService } from './service';
export type {
  CompileOptions,
  CompileServiceOptions,
  CompileServiceResult,
  CompileState,
  CompileStatus,
  CompileTiming,
  FilesSnapshot,
  WillCompileContext,
  WillCompileHook,
} from './service';

// Settings detection
export {
  detectCompileSettings,
  detectEngine,
  detectBibTool,
  detectMakeindex,
  engineFromProgram,
  findMainFile,
  followTexRoot,
  includeClosure,
  LUALATEX_ONLY_PACKAGES,
  XELATEX_ONLY_PACKAGES,
  UNICODE_ENGINE_PACKAGES,
} from './settings';
export type { CompileSettings, DetectSettingsOptions, EngineSource } from './settings';
export { scanLatex, parseMagicComments, stripComments } from './latex-scan';
export type { LatexScan, LatexPackageUse } from './latex-scan';

// Backends
export { BusyTexBackend, BUSYTEX_PROJECT_DIR } from './busytex/backend';
export type { BusyTexBackendOptions } from './busytex/backend';
export {
  DEFAULT_DATA_PACKAGES,
  buildIndexFromFileLists,
  buildIndexFromProvides,
  collectRequirements,
  escalationTier,
  findMissingFiles,
  loadDataPackageIndex,
  parseFileList,
  parseProvidesPackageIndex,
  selectDataPackageTier,
} from './busytex/data-packages';
export type { DataPackageIndex, TierSelection, SelectTierOptions } from './busytex/data-packages';
export { NativeBackend } from './native';
export type { NativeBackendOptions } from './native';
export { RemoteBackend } from './remote/backend';
export type { RemoteBackendOptions } from './remote/backend';
export {
  REMOTE_PROTOCOL_VERSION,
  encodeRemoteFiles,
  decodeRemoteFiles,
} from './remote/protocol';
export type { RemoteCompileRequestBody, RemoteCompileResponseBody, RemoteErrorBody, RemoteFile, RemoteInfo } from './remote/protocol';

// Utilities
export { CoalescingQueue } from './coalesce';
export { LruCache } from './lru';
export { bytesToBase64, base64ToBytes, stripBuildArtifacts } from './util';
