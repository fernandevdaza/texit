/**
 * TexIt Plugin API (MIT licensed so plugins can use any license).
 *
 * A plugin is an ES module whose default export is the result of
 * `definePlugin({...})`. Plugins can be:
 *   - built-in (bundled with the app),
 *   - installed from a URL (ES module, e.g. from a CDN / GitHub raw / npm via esm.sh),
 *   - installed from a local .js file,
 *   - listed in the community registry (registry.json).
 *
 * Plugins run in the page context with the permissions declared in their
 * manifest; the user must approve third-party plugins on install.
 */
import type { BackendStatus, CompileBackend, CompileRequest, CompileResult } from './compiler-types';
import type { BibEntry, Diagnostic, Disposable, LatexAnalysis, ProjectFile, ProjectTemplate } from '@texit/core';

export type { BackendStatus, CompileBackend, CompileRequest, CompileResult };
export type { BibEntry, Diagnostic, Disposable, LatexAnalysis, ProjectFile, ProjectTemplate };

/**
 * Semver of the API implemented by the host. A plugin declaring
 * `apiVersion: 'X.Y.Z'` loads when X equals the host major and Y ≤ host minor.
 *
 * 1.1.0 — additive: `api.latex`, `api.ui.showPanel/getTheme/onThemeChange`,
 * `api.editor.wrapSelection/focus`, `api.settings.onDidChange`, status item
 * handles with `refresh()`, declarative `settings` in the manifest.
 *
 * 1.2.0 — additive: `api.ui.getLocale/onLocaleChange` and the optional
 * `locales` manifest field (translated name, description, settings, command
 * and panel titles).
 */
export const PLUGIN_API_VERSION = '1.2.0';

export type PluginPermission =
  | 'project:read'
  | 'project:write'
  | 'editor'
  | 'ui'
  | 'compiler'
  | 'ai'
  | 'network'
  | 'storage';

export interface PluginManifest {
  id: string; // reverse-dns style, e.g. 'org.texit.wordcount'
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** lucide icon name (e.g. 'sigma') or an inline SVG string. */
  icon?: string;
  /** Minimum TexIt plugin API version. */
  apiVersion?: string;
  permissions?: PluginPermission[];
  /** Free-form keywords shown in the plugin browser (e.g. ['bibtex', 'references']). */
  tags?: string[];
  /**
   * Declarative settings. The host renders a settings form for them (plugin
   * card → Settings) and `api.settings.get(key)` falls back to `default`.
   */
  settings?: PluginSettingDef[];
  /**
   * Translations of the manifest's user-visible strings, keyed by BCP-47
   * language tag (e.g. `es`, `pt-BR`). English (the plain fields) is the
   * fallback. The host uses them for the plugin list, details dialog,
   * settings form, command palette and panel titles — even while the plugin
   * is disabled. Strings rendered by the plugin itself are translated with
   * `api.ui.getLocale()` / `api.ui.onLocaleChange()`.
   */
  locales?: Record<string, PluginManifestLocalization>;
}

/** Localized manifest strings for one language (see `PluginManifest.locales`). */
export interface PluginManifestLocalization {
  name?: string;
  description?: string;
  /** Command titles by command id (as registered, without the plugin prefix). */
  commands?: Record<string, string>;
  /** Panel titles by panel id (as registered, without the plugin prefix). */
  panels?: Record<string, string>;
  /** Setting labels by setting key. `options` maps option values to labels. */
  settings?: Record<string, { title?: string; description?: string; placeholder?: string; options?: Record<string, string> }>;
}

/** A user-configurable plugin setting rendered by the host. */
export interface PluginSettingDef {
  key: string;
  title: string;
  description?: string;
  type: 'boolean' | 'string' | 'text' | 'number' | 'select';
  default?: unknown;
  /** For `select`. */
  options?: { value: string; label: string }[];
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
}

export interface TexitPlugin extends PluginManifest {
  activate(api: PluginAPI): void | Disposable | Promise<void | Disposable>;
  deactivate?(): void | Promise<void>;
}

export function definePlugin(plugin: TexitPlugin): TexitPlugin {
  return plugin;
}

// ───────────────────────────── API surface ─────────────────────────────

export interface CommandDef {
  id: string;
  title: string;
  category?: string;
  icon?: string;
  /** e.g. 'Mod-Shift-w' (CodeMirror key notation). */
  keybinding?: string;
  when?: 'always' | 'editor' | 'project';
  run(...args: unknown[]): unknown | Promise<unknown>;
}

export interface PanelDef {
  id: string;
  title: string;
  icon?: string;
  /** Where the panel lives. */
  location: 'sidebar' | 'bottom' | 'right';
  /** Render into a plain DOM container; return a cleanup function. Framework-agnostic. */
  render(container: HTMLElement, ctx: PanelContext): void | (() => void);
}

export interface PanelContext {
  api: PluginAPI;
  theme: 'light' | 'dark';
  onThemeChange(cb: (theme: 'light' | 'dark') => void): Disposable;
}

export interface StatusItemDef {
  id: string;
  align?: 'left' | 'right';
  priority?: number;
  /** Called on every editor/project change; return text (and optional tooltip). */
  render(ctx: { api: PluginAPI }): { text: string; tooltip?: string; icon?: string } | null;
  onClick?(): void;
}

/** Returned by `ui.registerStatusItem`: call `refresh()` after async work to re-render. */
export interface StatusItemHandle extends Disposable {
  refresh(): void;
}

/** A math symbol from the host's symbol table (`api.latex.symbols()`). */
export interface MathSymbolInfo {
  /** The command to insert, e.g. '\\alpha'. */
  command: string;
  /** Unicode glyph used for display/search, when known. */
  glyph?: string;
  /** Group, e.g. 'Greek', 'Relations', 'Arrows'. */
  category: string;
  /** Package required (e.g. 'amssymb'), if any. */
  package?: string;
  /** Human-readable name / extra search words. */
  name?: string;
}

/** Result of `api.latex.countWords`. */
export interface WordCount {
  words: number;
  characters: number;
  mathInline: number;
  mathDisplay: number;
}

export interface Snippet {
  /** Trigger text shown in completion, e.g. 'fig'. */
  label: string;
  /** CodeMirror snippet template, using ${1:placeholder} syntax. */
  template: string;
  detail?: string;
  /** Restrict to file extensions, e.g. ['tex']. */
  languages?: string[];
}

export interface CompletionItem {
  label: string;
  /** Text to insert (defaults to label). Supports snippet syntax if `snippet` is true. */
  insert?: string;
  snippet?: boolean;
  detail?: string;
  info?: string;
  type?: 'command' | 'environment' | 'reference' | 'citation' | 'file' | 'keyword' | 'text';
  boost?: number;
}

export interface CompletionSourceDef {
  id: string;
  /** Regex matched against the text before the cursor; return null to skip. */
  trigger: RegExp;
  provide(ctx: { before: string; match: RegExpMatchArray; path: string }): CompletionItem[] | Promise<CompletionItem[]>;
}

export interface AIToolDef {
  name: string;
  description: string;
  /** JSON schema of the input. */
  inputSchema: Record<string, unknown>;
  execute(input: any): Promise<unknown> | unknown;
}

export interface QuickPickItem<T = unknown> {
  label: string;
  description?: string;
  value: T;
}

export interface EditorSelection {
  path: string;
  from: number;
  to: number;
  text: string;
  line: number;
}

export interface PluginAPI {
  readonly apiVersion: string;
  readonly plugin: PluginManifest;

  commands: {
    register(cmd: CommandDef): Disposable;
    execute(id: string, ...args: unknown[]): Promise<unknown>;
  };

  ui: {
    registerPanel(panel: PanelDef): Disposable;
    registerStatusItem(item: StatusItemDef): StatusItemHandle;
    /** Reveal one of this plugin's panels (short id as registered) or a built-in panel id. */
    showPanel(id: string): void;
    getTheme(): 'light' | 'dark';
    onThemeChange(cb: (theme: 'light' | 'dark') => void): Disposable;
    /** The UI language as a BCP-47 tag (e.g. 'en', 'es'). Since 1.2.0. */
    getLocale(): string;
    /** Fires when the user switches the UI language. Since 1.2.0. */
    onLocaleChange(cb: (locale: string) => void): Disposable;
    toast(message: string, opts?: { type?: 'info' | 'success' | 'error' | 'warning'; description?: string }): void;
    quickPick<T>(items: QuickPickItem<T>[], opts?: { placeholder?: string }): Promise<T | undefined>;
    prompt(opts: { title: string; placeholder?: string; value?: string }): Promise<string | undefined>;
    confirm(opts: { title: string; message?: string; danger?: boolean }): Promise<boolean>;
    /** Open a modal hosting arbitrary DOM. */
    modal(opts: { title: string; width?: number; render(container: HTMLElement, close: () => void): void | (() => void) }): Promise<void>;
  };

  editor: {
    getActivePath(): string | null;
    getSelection(): EditorSelection | null;
    replaceSelection(text: string): void;
    insertText(text: string): void;
    /** Wrap the selection (or insert at the cursor), e.g. ('\\textbf{', '}'). */
    wrapSelection(before: string, after: string): void;
    /** Give keyboard focus back to the editor. */
    focus(): void;
    /** Open a file and optionally reveal a line. */
    open(path: string, line?: number): void;
    registerSnippets(snippets: Snippet[]): Disposable;
    registerCompletionSource(source: CompletionSourceDef): Disposable;
    onDidChangeActiveFile(cb: (path: string | null) => void): Disposable;
    onDidChangeSelection(cb: (sel: EditorSelection | null) => void): Disposable;
  };

  project: {
    getName(): string;
    getMainPath(): string | null;
    listFiles(): { path: string; isText: boolean; size: number }[];
    readFile(path: string): Promise<string | Uint8Array | null>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    deleteFile(path: string): Promise<void>;
    onDidChangeFiles(cb: () => void): Disposable;
  };

  compiler: {
    compile(): Promise<CompileResult | null>;
    registerBackend(backend: CompileBackend): Disposable;
    onWillCompile(cb: (files: ProjectFile[]) => ProjectFile[] | void | Promise<ProjectFile[] | void>): Disposable;
    onDidCompile(cb: (result: CompileResult) => void): Disposable;
    getLastResult(): CompileResult | null;
  };

  ai: {
    registerTool(tool: AIToolDef): Disposable;
    /** One-shot completion using the user's configured default model. */
    complete(prompt: string, opts?: { system?: string }): Promise<string>;
  };

  templates: {
    register(template: ProjectTemplate): Disposable;
  };

  settings: {
    get<T = unknown>(key: string, fallback?: T): T;
    set(key: string, value: unknown): void;
    /** Fires when a setting changes (from `set` or from the settings form). */
    onDidChange(cb: (key: string, value: unknown) => void): Disposable;
  };

  /**
   * LaTeX helpers shared with the app (same algorithms as the outline, word
   * counter and autocompletion). Pure functions — no permission required.
   */
  latex: {
    analyze(source: string): LatexAnalysis;
    countWords(source: string): WordCount;
    parseBibtex(source: string): BibEntry[];
    symbols(): MathSymbolInfo[];
  };

  /** Plugin-scoped persistent key/value storage. */
  storage: {
    get<T = unknown>(key: string): Promise<T | undefined>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
}
