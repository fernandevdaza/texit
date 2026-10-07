/**
 * Compile bridge — the compile feature implements this controller (wrapping
 * @texit/compiler's CompileService) and registers it with `setCompileController`.
 * Everything else (toolbar, AI tools, plugins, keyboard shortcuts, auto-compile)
 * goes through `getCompileController()`.
 */
import type { CompileBackend, CompileResult } from '@texit/compiler';
import type { Disposable, ProjectFile } from '@texit/core';

export interface CompileController {
  compile(opts?: { draft?: boolean; reason?: 'manual' | 'auto' | 'ai' | 'plugin' }): Promise<CompileResult | null>;
  cancel(): void;
  registerBackend(backend: CompileBackend): Disposable;
  listBackends(): CompileBackend[];
  onWillCompile(cb: (files: ProjectFile[]) => ProjectFile[] | void | Promise<ProjectFile[] | void>): Disposable;
  onDidCompile(cb: (result: CompileResult) => void): Disposable;
  getLastResult(): CompileResult | null;
}

let controller: CompileController | null = null;

export function setCompileController(c: CompileController | null) {
  controller = c;
}

export function getCompileController(): CompileController | null {
  return controller;
}
