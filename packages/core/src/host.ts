/**
 * Contract of the native host bridge.
 *
 * In the desktop app (Electron) the preload script exposes an object that
 * implements `TexitHost` as `window.texit`. In the browser it is undefined and
 * the web app falls back to WASM / web-only features. Every method must be
 * serialisable over Electron IPC (plain objects, strings, Uint8Array).
 */
import type { ProjectFile, TexEngine } from './types';

export interface TexitHost {
  readonly kind: 'electron';
  readonly platform: 'darwin' | 'win32' | 'linux';
  readonly appVersion: string;
  /** Desktop (additive): how the native window frame is drawn, so the UI can leave room for window controls. */
  readonly chrome?: HostWindowChrome;

  tex: HostTex;
  fs: HostFs;
  agents: HostAgents;
  mcp: HostMcp;
  secrets: HostSecrets;
  shell: HostShell;
  app: HostApp;
}

// ─────────────────────────── Native TeX ───────────────────────────

export interface NativeTexTool {
  id: 'tectonic' | 'latexmk' | 'pdflatex' | 'xelatex' | 'lualatex' | 'bibtex' | 'biber' | 'makeindex' | 'synctex' | string;
  path: string;
  version?: string;
}

export interface NativeTexInfo {
  /** Detected binaries. */
  tools: NativeTexTool[];
  /** TeX distribution name if detected (TeX Live, MacTeX, MiKTeX, Tectonic…). */
  distribution?: string;
}

export interface NativeCompileRequest {
  jobId: string;
  /** Project identifier — used to keep a persistent build dir (fast incremental builds). */
  projectId: string;
  files: ProjectFile[];
  mainPath: string;
  engine: TexEngine;
  /** 'auto' picks latexmk when present, otherwise tectonic, otherwise the raw engine. */
  driver: 'auto' | 'latexmk' | 'tectonic' | 'raw';
  bibTool: 'auto' | 'bibtex' | 'biber' | 'none';
  synctex: boolean;
  shellEscape?: boolean;
  /** Single pass, no reruns (fast preview). */
  draft?: boolean;
  /** Run makeindex: true / false / 'auto' (driver decides; latexmk does this by default). */
  makeindex?: boolean | 'auto';
  /** Extra environment variables. */
  env?: Record<string, string>;
}

export interface NativeCompileResult {
  status: 'success' | 'error' | 'cancelled';
  pdf?: Uint8Array;
  /** Raw (possibly gzipped) .synctex(.gz) bytes. */
  synctex?: Uint8Array;
  log: string;
  durationMs: number;
  /** The absolute build directory (used to map SyncTeX absolute paths back to project paths). */
  buildDir: string;
  /** Description of the command line that was run. */
  command: string;
}

export interface HostTex {
  detect(): Promise<NativeTexInfo>;
  compile(req: NativeCompileRequest, onLog?: (chunk: string) => void): Promise<NativeCompileResult>;
  cancel(jobId: string): Promise<void>;
}

// ─────────────────────────── File system ───────────────────────────

export interface HostFileEntry {
  /** Path relative to the directory that was read. */
  path: string;
  content: Uint8Array;
  mtimeMs: number;
}

export interface HostWatchEvent {
  type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir';
  /** Relative path inside the watched directory. */
  path: string;
  content?: Uint8Array;
}

export interface HostFs {
  pickDirectory(opts?: { title?: string; defaultPath?: string }): Promise<string | null>;
  pickFiles(opts?: { title?: string; filters?: { name: string; extensions: string[] }[]; multiple?: boolean }): Promise<{ name: string; path: string; content: Uint8Array }[] | null>;
  saveFile(opts: { defaultName: string; content: Uint8Array; filters?: { name: string; extensions: string[] }[] }): Promise<string | null>;
  /** Read every file under `dir` (ignores .git, node_modules, build artefacts). */
  readTree(dir: string): Promise<HostFileEntry[]>;
  /** Read a single file (additive; watch events omit the content of large files). */
  readFile?(absPath: string): Promise<Uint8Array>;
  writeFile(absPath: string, content: Uint8Array | string): Promise<void>;
  mkdir(absPath: string): Promise<void>;
  remove(absPath: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  /** Watch a directory recursively. Returns an unsubscribe function. */
  watch(dir: string, cb: (events: HostWatchEvent[]) => void): Promise<() => void>;
  /**
   * Directory where TexIt mirrors a local-first project to disk so CLI agents
   * (Codex, Claude Code, Gemini CLI…) and external editors can work on it.
   */
  projectMirrorDir(projectId: string): Promise<string>;
  revealInFolder(absPath: string): Promise<void>;
  openPath(absPath: string): Promise<void>;
}

// ─────────────────────────── CLI agents (subscription-based) ───────────────────────────

export type CliAgentId = 'codex' | 'claude' | 'gemini' | 'opencode' | 'aider' | 'qwen' | string;

export interface CliAgentInfo {
  id: CliAgentId;
  name: string;
  installed: boolean;
  path?: string;
  version?: string;
  /** Human-readable hint for installing / logging-in. */
  hint?: string;
}

export interface CliAgentRunRequest {
  runId: string;
  agent: CliAgentId;
  prompt: string;
  /** Working directory (usually the project mirror dir). */
  cwd: string;
  model?: string;
  /** Continue a previous session if the CLI supports it. */
  sessionId?: string;
  /** Let the agent write files without asking (maps to each CLI's auto-approve flag). */
  autoApprove?: boolean;
  /** MCP servers to expose to the CLI agent (e.g. TexIt's own MCP server). */
  mcpServers?: { name: string; url: string; headers?: Record<string, string> }[];
  env?: Record<string, string>;
}

export type CliAgentEvent =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool'; name: string; input?: unknown; output?: string; status: 'started' | 'completed' | 'failed' }
  | { type: 'file-change'; path: string; kind: 'add' | 'change' | 'delete' }
  | { type: 'session'; sessionId: string }
  | { type: 'stderr'; text: string }
  | { type: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number }
  | { type: 'done'; exitCode: number; error?: string };

export interface HostAgents {
  detect(): Promise<CliAgentInfo[]>;
  /** Start a run; events stream through `onEvent`. Resolves when the process exits. */
  run(req: CliAgentRunRequest, onEvent: (e: CliAgentEvent) => void): Promise<{ exitCode: number }>;
  cancel(runId: string): Promise<void>;
}

// ─────────────────────────── MCP ───────────────────────────

export interface McpStdioConfig {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

/** A JSON-RPC 2.0 message (request / response / notification). */
export type JsonRpcMessage = Record<string, unknown> & { jsonrpc: '2.0' };

export interface McpServerToolCall {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface McpServerInfo {
  running: boolean;
  /** e.g. http://127.0.0.1:4317/mcp */
  url?: string;
  port?: number;
  /** Bearer token required by the server. */
  token?: string;
}

export interface HostMcp {
  /** Spawn a stdio MCP server; messages flow through `send` / `onMessage`. */
  startStdio(cfg: McpStdioConfig): Promise<void>;
  send(id: string, msg: JsonRpcMessage): Promise<void>;
  onMessage(id: string, cb: (msg: JsonRpcMessage) => void): () => void;
  onExit(id: string, cb: (info: { code: number | null; stderr: string }) => void): () => void;
  stop(id: string): Promise<void>;

  /**
   * TexIt as an MCP server (Streamable HTTP on localhost) so external agents
   * (Claude Code, Codex, Cursor…) can read/edit/compile the open project.
   * The host forwards tool calls to the renderer, which executes them against
   * the live Y.Doc and answers with `respondToolCall`.
   */
  serverInfo(): Promise<McpServerInfo>;
  startServer(opts?: { port?: number }): Promise<McpServerInfo>;
  stopServer(): Promise<void>;
  /** Tools the renderer exposes through the server (name, description, JSON schema). */
  setServerTools(tools: { name: string; description: string; inputSchema: Record<string, unknown> }[]): Promise<void>;
  onServerToolCall(cb: (call: McpServerToolCall) => void): () => void;
  respondToolCall(callId: string, result: { content: { type: 'text'; text: string }[]; isError?: boolean }): Promise<void>;
  /**
   * Ready-to-paste configuration for external MCP clients (Claude Code, Codex,
   * Cursor, VS Code, Gemini CLI). Starts the server if needed. (additive)
   */
  clientConfigSnippets?(): Promise<McpClientConfigSnippet[]>;
}

export interface McpClientConfigSnippet {
  id: 'claude-code' | 'codex' | 'cursor' | 'vscode' | 'gemini' | string;
  label: string;
  language: 'shell' | 'toml' | 'json';
  /** Where the snippet goes: a config file path or "terminal". */
  target: string;
  snippet: string;
}

// ─────────────────────────── Secrets / shell / app ───────────────────────────

export interface HostSecrets {
  /** Stored with the OS keychain (Electron safeStorage). */
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface HostShell {
  openExternal(url: string): Promise<void>;
}

export interface HostApp {
  /** Native menu → renderer commands (command ids from the web command registry). */
  onMenuCommand(cb: (commandId: string) => void): () => void;
  /** Files/folders opened via OS (double-click .tex / .zip, drag on dock icon, `texit path`). */
  onOpenPath(cb: (absPath: string) => void): () => void;
  setTitle(title: string): void;
  setDocumentEdited?(edited: boolean): void;
  getPathForFile?(file: File): string;
  checkForUpdates(): Promise<{ available: boolean; version?: string }>;
  /** `texit://…` deep links opened via the OS (additive). */
  onDeepLink?(cb: (url: string) => void): () => void;
  /** Windows/Linux: recolor the window-controls overlay to match the app theme (additive, no-op on macOS). */
  setTitleBarOverlay?(opts: { color?: string; symbolColor?: string; height?: number }): Promise<void>;
}

/**
 * Native window chrome (additive). The preload also sets CSS custom properties
 * on <html>: `--texit-titlebar-height`, `--texit-titlebar-inset-left`,
 * `--texit-titlebar-inset-right`, plus `data-texit-platform` / `data-texit-chrome`.
 */
export interface HostWindowChrome {
  /** 'hiddenInset': macOS traffic lights over the content; 'overlay': Windows/Linux window-controls overlay. */
  style: 'hiddenInset' | 'overlay' | 'native';
  /** Height (CSS px) of the draggable title-bar area the UI should render (`-webkit-app-region: drag`). */
  height: number;
  /** Space (CSS px) to keep free on the left (macOS traffic lights). */
  insetLeft: number;
  /** Space (CSS px) to keep free on the right (Windows/Linux caption buttons). */
  insetRight: number;
}

declare global {
  interface Window {
    texit?: TexitHost;
  }
}

export function getHost(): TexitHost | undefined {
  return typeof window !== 'undefined' ? window.texit : undefined;
}

export function isDesktop(): boolean {
  return !!getHost();
}
