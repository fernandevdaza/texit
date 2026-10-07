/**
 * Contracts for TexIt's AI layer.
 *
 * Provider kinds:
 *  - API providers (bring your own key): OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, DeepSeek, Mistral, xAI, any OpenAI-compatible endpoint.
 *  - Local models: Ollama, LM Studio, llama.cpp server, vLLM (OpenAI-compatible endpoints on localhost).
 *  - Subscription CLI agents (desktop only): Codex CLI (ChatGPT plan), Claude Code (Claude plan), Gemini CLI, opencode… run through the host bridge.
 */
import type { Diagnostic } from '@texit/core';

export type ProviderKind =
  | 'openai'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'groq'
  | 'deepseek'
  | 'mistral'
  | 'xai'
  | 'openai-compatible'
  | 'ollama'
  | 'lmstudio'
  | 'cli';

export interface ProviderConfig {
  id: string;
  kind: ProviderKind;
  name: string;
  enabled: boolean;
  baseURL?: string;
  /** Stored in the OS keychain on desktop; in localStorage (opt-in) on web. Never synced to collaborators. */
  apiKey?: string;
  /** For kind 'cli': which CLI agent ('codex' | 'claude' | 'gemini' | …). */
  cliAgent?: string;
  /** Known/selected model ids. */
  models: string[];
  defaultModel?: string;
  headers?: Record<string, string>;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export interface AISettings {
  providers: ProviderConfig[];
  /** Model used by the chat agent. */
  chatModel?: ModelRef;
  /** Small/fast model for inline completions (ghost text). */
  completionModel?: ModelRef;
  /** Enable inline AI completions in the editor. */
  inlineCompletions: boolean;
  /** Let the agent apply edits without asking (otherwise each edit is shown as a reviewable diff). */
  autoApplyEdits: boolean;
  /** MCP servers the agent can use. */
  mcpServers: McpServerConfig[];
  /** Expose the open project as an MCP server for external agents (desktop). */
  exposeMcpServer: boolean;
  /** Extra system prompt appended to the built-in one. */
  customInstructions?: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  transport: 'http' | 'sse' | 'stdio';
  /** http / sse */
  url?: string;
  headers?: Record<string, string>;
  /** stdio (desktop only) */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Everything the agent's built-in tools need from the running app.
 * The web app implements this against the live ProjectDoc / compiler / editor.
 */
export interface ProjectToolContext {
  listFiles(): { path: string; isText: boolean; size: number }[];
  readFile(path: string): Promise<string | null>;
  /** Create or overwrite a text file. */
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  renameFile(from: string, to: string): Promise<void>;
  /** Exact search/replace edit; throws if `search` is not found exactly once (unless replaceAll). */
  editFile(path: string, search: string, replace: string, opts?: { replaceAll?: boolean }): Promise<void>;
  search(query: string, opts?: { regex?: boolean; caseSensitive?: boolean }): Promise<{ path: string; line: number; text: string }[]>;
  compile(): Promise<{ status: string; diagnostics: Diagnostic[]; logTail: string }>;
  getDiagnostics(): Diagnostic[];
  getMainPath(): string | null;
  getActiveFile(): { path: string; selection?: { from: number; to: number; text: string; line: number } } | null;
  /** Ask the user to approve a proposed change (diff review UI). Resolves true if accepted. */
  reviewEdit?(path: string, before: string, after: string): Promise<boolean>;
  /**
   * Optional confirmation for non-content changes (delete / rename) when edits are not auto-applied.
   * When absent, deletes fall back to `reviewEdit(path, before, '')` and renames are applied directly.
   */
  confirmAction?(action: { kind: 'delete' | 'rename'; path: string; newPath?: string }): Promise<boolean>;
}

export type ChatRole = 'user' | 'assistant' | 'system';

export interface ChatAttachment {
  kind: 'file' | 'selection' | 'diagnostics' | 'image';
  path?: string;
  text?: string;
  /** data URL for images */
  dataUrl?: string;
  /** 1-based start line (selection attachments). */
  line?: number;
  /** Structured diagnostics (kind 'diagnostics'); used when `text` is absent. */
  diagnostics?: Diagnostic[];
  /** Display name (e.g. pasted image file name). */
  name?: string;
}

export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool-call'; id: string; name: string; input: unknown; status: 'running' | 'done' | 'error'; output?: string }
  | { type: 'file-edit'; path: string; before?: string; after?: string; status: 'proposed' | 'applied' | 'rejected' }
  | { type: 'error'; message: string };

export interface ChatMessage {
  id: string;
  role: ChatRole;
  parts: ChatPart[];
  attachments?: ChatAttachment[];
  createdAt: number;
  model?: ModelRef;
  /**
   * User messages: project context captured when the message was sent (`buildProjectContext`).
   * Replayed verbatim on later turns so the history stays byte-stable (prompt caching).
   */
  context?: string;
}

export type FileEditOp = 'create' | 'edit' | 'delete' | 'rename';

export type AgentEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'reasoning-delta'; text: string }
  /** Emitted before the tool executes (so it always precedes the tool's `file-edit` events). */
  | { type: 'tool-call'; id: string; name: string; input: unknown }
  | { type: 'tool-result'; id: string; name: string; output: string; isError?: boolean }
  | {
      type: 'file-edit';
      path: string;
      before?: string;
      after?: string;
      status: 'proposed' | 'applied' | 'rejected';
      /** Tool call that produced the edit (absent for CLI agents). */
      toolCallId?: string;
      /** Kind of change; `edit` when absent. */
      op?: FileEditOp;
      /** Target path for `rename`. */
      newPath?: string;
    }
  | { type: 'step-finish'; finishReason?: string }
  | {
      type: 'usage';
      inputTokens?: number;
      outputTokens?: number;
      reasoningTokens?: number;
      cachedInputTokens?: number;
      /** Reported by some CLI agents. */
      costUsd?: number;
    }
  /** CLI agents: session id to pass back as `sessionId` to continue the conversation. */
  | { type: 'session'; sessionId: string }
  /** Diagnostic output that is not part of the answer (CLI stderr, provider warnings). */
  | { type: 'log'; text: string }
  | { type: 'error'; message: string }
  | { type: 'done'; reason?: AgentDoneReason };

export type AgentDoneReason = 'stop' | 'length' | 'tool-calls' | 'max-steps' | 'aborted' | 'error' | 'content-filter' | 'other';

/** Static description of a provider kind (see `PROVIDER_PRESETS`). */
export interface ProviderPreset {
  kind: ProviderKind;
  label: string;
  description: string;
  /** Default endpoint; `undefined` → the SDK's default (or user-supplied for generic endpoints). */
  defaultBaseURL?: string;
  /** Whether a base URL must be entered by the user. */
  needsBaseURL: boolean;
  /** `true` required, `'optional'` (local servers / proxies), `false` never used. */
  needsApiKey: boolean | 'optional';
  /** Where to get an API key. */
  apiKeyUrl?: string;
  docsUrl?: string;
  /** Suggested model ids (runtime listing via `listModels` is preferred). */
  suggestedModels: SuggestedModel[];
  /** Good default for the chat agent. */
  defaultModel?: string;
  /** Small/fast model suggested for inline completions. */
  completionModel?: string;
  /** Whether models from this provider generally support tool calling (agent mode). */
  supportsTools: boolean;
  /** Whether `listModels` can enumerate models. */
  supportsModelListing: boolean;
  /** Direct browser use: 'ok' (CORS allowed), 'config' (works after a local setting), 'proxy' (needs desktop/proxy), 'desktop-only'. */
  browser: 'ok' | 'config' | 'proxy' | 'desktop-only';
  /** Human-readable CORS / environment caveat shown in settings. */
  browserNote?: string;
  /** Only available in the desktop app. */
  desktopOnly?: boolean;
}

export interface SuggestedModel {
  id: string;
  label?: string;
  /** e.g. 'flagship', 'fast', 'reasoning', 'coding', 'local' */
  tags?: string[];
}

/** A model returned by `listModels`. */
export interface ListedModel {
  id: string;
  label?: string;
  contextWindow?: number;
  ownedBy?: string;
}
