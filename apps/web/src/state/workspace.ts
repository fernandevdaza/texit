/**
 * Workspace state for the currently open project.
 *
 * The ProjectDoc (Yjs) is the source of truth for files; this store only
 * keeps UI state (tabs, panels, compile output, navigation requests).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CompileResult } from '@texit/compiler';
import type { Diagnostic, FileNode, ProjectDoc, ProjectMeta, SyncTexData } from '@texit/core';
import type { ProjectSession } from '@/services/projects';

export type CompileStatus = 'idle' | 'preparing' | 'compiling' | 'success' | 'error' | 'cancelled';

export interface CompileState {
  status: CompileStatus;
  /** Human-readable progress ("Downloading TeX Live 43%", "Running biber…"). */
  detail?: string;
  progress?: number;
  startedAt?: number;
  /** Last result (success or failure). */
  result: CompileResult | null;
  /** Last PDF that compiled successfully — stays visible while a new compile fails. */
  pdf: Uint8Array | null;
  /** Bumped every time `pdf` changes (cheap change detection for viewers). */
  pdfVersion: number;
  synctex: SyncTexData | null;
  diagnostics: Diagnostic[];
  /** Live log while compiling (when the backend streams). */
  liveLog: string;
  backendId?: string;
}

export interface RevealRequest {
  fileId: string;
  line: number;
  column?: number;
  /** Select the whole line / a range after revealing. */
  select?: { from: number; to: number };
  nonce: number;
}

export interface PdfSyncRequest {
  /** Project-relative path. */
  path: string;
  line: number;
  nonce: number;
}

export interface WorkspaceState {
  session: ProjectSession | null;
  project: ProjectDoc | null;
  meta: ProjectMeta | null;
  /** Cached file list, refreshed on tree changes. */
  files: FileNode[];
  /** Bumped on any tree change. */
  treeVersion: number;

  openTabs: string[];
  activeFileId: string | null;
  /** Tab opened as a transient preview (single-click in file tree). */
  previewTabId: string | null;

  cursor: { line: number; column: number; selected: number };

  compile: CompileState;

  revealRequest: RevealRequest | null;
  pdfSyncRequest: PdfSyncRequest | null;
  /** Fired by the PDF viewer to highlight a location after forward search. */
  pdfHighlight: { page: number; x: number; y: number; width: number; height: number; nonce: number }[] | null;

  // actions
  setSession(session: ProjectSession | null): void;
  refreshTree(): void;
  openFile(fileId: string, opts?: { preview?: boolean; line?: number; column?: number }): void;
  closeTab(fileId: string): void;
  closeOtherTabs(fileId: string): void;
  setActive(fileId: string | null): void;
  pinTab(fileId: string): void;
  reorderTabs(tabs: string[]): void;
  setCursor(c: WorkspaceState['cursor']): void;
  setCompile(patch: Partial<CompileState>): void;
  /** Open a file (by id or project path) and scroll to a line. */
  revealLocation(fileIdOrPath: string, line: number, column?: number): void;
  /** Ask the PDF viewer to scroll to the source location (forward SyncTeX). */
  syncPdfTo(path: string, line: number): void;
}

const initialCompile: CompileState = {
  status: 'idle',
  result: null,
  pdf: null,
  pdfVersion: 0,
  synctex: null,
  diagnostics: [],
  liveLog: '',
};

let nonce = 1;

export const useWorkspace = create<WorkspaceState>((set, get) => ({
  session: null,
  project: null,
  meta: null,
  files: [],
  treeVersion: 0,
  openTabs: [],
  activeFileId: null,
  previewTabId: null,
  cursor: { line: 1, column: 1, selected: 0 },
  compile: initialCompile,
  revealRequest: null,
  pdfSyncRequest: null,
  pdfHighlight: null,

  setSession(session) {
    set({
      session,
      project: session?.project ?? null,
      meta: session?.project.getMeta() ?? null,
      files: session?.project.list() ?? [],
      openTabs: [],
      activeFileId: null,
      previewTabId: null,
      compile: initialCompile,
      revealRequest: null,
      pdfSyncRequest: null,
      pdfHighlight: null,
      treeVersion: get().treeVersion + 1,
    });
  },

  refreshTree() {
    const p = get().project;
    if (!p) return;
    const files = p.list();
    const ids = new Set(files.map((f) => f.id));
    const openTabs = get().openTabs.filter((id) => ids.has(id));
    let activeFileId = get().activeFileId;
    if (activeFileId && !ids.has(activeFileId)) activeFileId = openTabs[openTabs.length - 1] ?? null;
    set({ files, meta: p.getMeta(), openTabs, activeFileId, treeVersion: get().treeVersion + 1 });
  },

  openFile(fileId, opts) {
    const { openTabs, previewTabId } = get();
    let tabs = openTabs;
    let preview = previewTabId;
    if (!tabs.includes(fileId)) {
      if (opts?.preview && preview && tabs.includes(preview)) {
        // Replace the existing preview tab.
        tabs = tabs.map((t) => (t === preview ? fileId : t));
      } else {
        const idx = tabs.indexOf(get().activeFileId ?? '');
        tabs = idx >= 0 ? [...tabs.slice(0, idx + 1), fileId, ...tabs.slice(idx + 1)] : [...tabs, fileId];
      }
      preview = opts?.preview ? fileId : preview === fileId ? null : preview;
    } else if (!opts?.preview && preview === fileId) {
      preview = null;
    }
    set({
      openTabs: tabs,
      activeFileId: fileId,
      previewTabId: preview,
      revealRequest: opts?.line ? { fileId, line: opts.line, column: opts.column, nonce: nonce++ } : get().revealRequest,
    });
  },

  closeTab(fileId) {
    const { openTabs, activeFileId } = get();
    const idx = openTabs.indexOf(fileId);
    const tabs = openTabs.filter((t) => t !== fileId);
    set({
      openTabs: tabs,
      activeFileId: activeFileId === fileId ? (tabs[Math.min(idx, tabs.length - 1)] ?? null) : activeFileId,
      previewTabId: get().previewTabId === fileId ? null : get().previewTabId,
    });
  },

  closeOtherTabs(fileId) {
    set({ openTabs: [fileId], activeFileId: fileId, previewTabId: null });
  },

  setActive(fileId) {
    set({ activeFileId: fileId });
  },

  pinTab(fileId) {
    if (get().previewTabId === fileId) set({ previewTabId: null });
  },

  reorderTabs(tabs) {
    set({ openTabs: tabs });
  },

  setCursor(cursor) {
    set({ cursor });
  },

  setCompile(patch) {
    set({ compile: { ...get().compile, ...patch } });
  },

  revealLocation(fileIdOrPath, line, column) {
    const p = get().project;
    if (!p) return;
    const id = p.has(fileIdOrPath) ? fileIdOrPath : p.findByPath(fileIdOrPath);
    if (!id) return;
    get().openFile(id, { line, column });
    set({ revealRequest: { fileId: id, line, column, nonce: nonce++ } });
  },

  syncPdfTo(path, line) {
    set({ pdfSyncRequest: { path, line, nonce: nonce++ } });
  },
}));

// ───────────────────────────── layout (persisted) ─────────────────────────────

export interface LayoutState {
  sidebarOpen: boolean;
  sidebarPanel: string;
  bottomOpen: boolean;
  bottomPanel: string;
  pdfOpen: boolean;
  aiOpen: boolean;
  /** Editor-only / PDF-only focus modes. */
  focusMode: 'none' | 'editor' | 'pdf';
  set(patch: Partial<Omit<LayoutState, 'set' | 'toggle' | 'showSidebarPanel' | 'showBottomPanel'>>): void;
  toggle(key: 'sidebarOpen' | 'bottomOpen' | 'pdfOpen' | 'aiOpen'): void;
  /** Open the sidebar on a panel; toggles closed if it's already the visible one. */
  showSidebarPanel(id: string, opts?: { toggle?: boolean }): void;
  showBottomPanel(id: string, opts?: { toggle?: boolean }): void;
}

export const useLayout = create<LayoutState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      sidebarPanel: 'files',
      bottomOpen: false,
      bottomPanel: 'problems',
      pdfOpen: true,
      aiOpen: false,
      focusMode: 'none',
      set: (patch) => set(patch),
      toggle: (key) => set({ [key]: !get()[key] } as Partial<LayoutState>),
      showSidebarPanel(id, opts) {
        const s = get();
        if (opts?.toggle && s.sidebarOpen && s.sidebarPanel === id) set({ sidebarOpen: false });
        else set({ sidebarOpen: true, sidebarPanel: id });
      },
      showBottomPanel(id, opts) {
        const s = get();
        if (opts?.toggle && s.bottomOpen && s.bottomPanel === id) set({ bottomOpen: false });
        else set({ bottomOpen: true, bottomPanel: id });
      },
    }),
    { name: 'texit:layout', version: 1 },
  ),
);

/** Convenience non-hook accessors. */
export const workspace = () => useWorkspace.getState();
export const layout = () => useLayout.getState();
