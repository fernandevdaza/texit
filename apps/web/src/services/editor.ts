/**
 * Editor bridge — lets non-editor code (AI, plugins, PDF SyncTeX, command
 * palette…) talk to the active CodeMirror editor without importing it.
 * The editor feature registers the implementation with `setEditorBridge`.
 */
import type { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';
import type { Disposable } from '@texit/core';
import { Emitter } from '@/lib/emitter';

export interface EditorSelectionInfo {
  fileId: string;
  path: string;
  from: number;
  to: number;
  text: string;
  /** 1-based line of the selection head. */
  line: number;
  column: number;
}

export interface EditorBridge {
  getView(): EditorView | null;
  getSelection(): EditorSelectionInfo | null;
  replaceSelection(text: string): void;
  insertText(text: string): void;
  /** Wrap the selection, e.g. ('\\textbf{', '}'). */
  wrapSelection(before: string, after: string): void;
  focus(): void;
}

let bridge: EditorBridge | null = null;

export function setEditorBridge(b: EditorBridge | null) {
  bridge = b;
}

export function getEditorBridge(): EditorBridge | null {
  return bridge;
}

/** Emits whenever the selection / cursor moves in the active editor. */
export const selectionChanged = new Emitter<EditorSelectionInfo | null>();

/**
 * Extra CodeMirror extensions contributed by other features or plugins
 * (snippets, completion sources, AI ghost text, collaboration cursors…).
 * The editor reconfigures itself when this list changes.
 */
const extensionContributions = new Map<string, Extension>();
export const extensionsChanged = new Emitter<void>();

export function contributeEditorExtension(id: string, ext: Extension): Disposable {
  extensionContributions.set(id, ext);
  extensionsChanged.emit();
  return {
    dispose() {
      if (extensionContributions.get(id) === ext) {
        extensionContributions.delete(id);
        extensionsChanged.emit();
      }
    },
  };
}

export function getContributedExtensions(): Extension[] {
  return Array.from(extensionContributions.values());
}
