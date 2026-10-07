/**
 * Shared domain types for TexIt.
 *
 * Paths are always POSIX-style, project-relative, without a leading slash
 * (e.g. `chapters/intro.tex`). The project root has the id `ROOT_ID` ('').
 */

export type NodeKind = 'file' | 'folder';

export interface FileNode {
  id: string;
  name: string;
  /** Parent folder id; `ROOT_ID` ('') for top-level entries. */
  parentId: string;
  kind: NodeKind;
  /** Computed full path (project-relative). */
  path: string;
  /** True for files whose content is stored as text (Y.Text). */
  isText: boolean;
  createdAt: number;
  updatedAt: number;
  /** Byte size for binary files, character length for text files. */
  size: number;
}

/** A plain (non-CRDT) file used for compile requests, zip import/export, templates, AI tools… */
export interface ProjectFile {
  path: string;
  content: string | Uint8Array;
}

export type TexEngine = 'pdflatex' | 'xelatex' | 'lualatex';
export type BibTool = 'auto' | 'bibtex' | 'biber' | 'none';

export interface ProjectMeta {
  id: string;
  name: string;
  /** Id of the root .tex file. Empty string → auto-detect. */
  mainFileId: string;
  engine: TexEngine;
  bibTool: BibTool;
  /** Preferred compile backend id (e.g. 'busytex', 'native', 'remote'); empty → app default. */
  compilerBackend: string;
  createdAt: number;
  updatedAt: number;
  /** Free-form tags shown in the dashboard. */
  tags: string[];
  /** Spell-check / editor language (BCP-47), e.g. 'en-US', 'es-ES'. */
  language: string;
}

/** Lightweight record stored in the project index (dashboard), separate from the Y.Doc. */
export interface ProjectSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  openedAt: number;
  tags: string[];
  engine: TexEngine;
  /** Optional data URL / SVG thumbnail of the first PDF page. */
  thumbnail?: string;
  /** If the project is shared for real-time collaboration. */
  collab?: { room: string; role: 'owner' | 'guest' };
  /** Desktop: project mirrored to / opened from a folder on disk. */
  folderPath?: string;
  trashed?: boolean;
  starred?: boolean;
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'badbox';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  message: string;
  /** Project-relative path if it could be resolved. */
  file?: string;
  /** 1-based line number. */
  line?: number;
  /** Extra context lines from the log. */
  context?: string;
  /** The raw log excerpt this diagnostic was parsed from. */
  raw?: string;
  /** Machine-friendly category, e.g. 'undefined-reference', 'missing-package', 'overfull-hbox'. */
  code?: string;
}

/** Template used by "New project". */
export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  category: 'basic' | 'academic' | 'presentation' | 'cv' | 'letter' | 'book' | 'poster' | 'other';
  engine: TexEngine;
  /** Path of the main file inside `files`. */
  main: string;
  files: ProjectFile[];
  /** CSS gradient / accent used for the card thumbnail. */
  accent?: string;
  tags?: string[];
  /**
   * Extra files fetched when the project is created (e.g. class files that the
   * in-browser TeX Live doesn't ship). `url` is relative to the app's base URL.
   */
  assets?: { path: string; url: string }[];
}

export interface Disposable {
  dispose(): void;
}
