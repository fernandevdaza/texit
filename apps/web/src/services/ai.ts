/**
 * AI bridge — implemented by the AI feature, consumed by plugins and other
 * features (e.g. "Explain this error" in the problems panel).
 */
import type { Disposable } from '@texit/core';
import type { AIToolDef } from '@texit/plugin-api';

export interface AiBridge {
  /** One-shot completion with the user's default chat model. Throws if no model is configured. */
  complete(prompt: string, opts?: { system?: string; signal?: AbortSignal }): Promise<string>;
  /** Tools contributed by plugins, offered to the agent. */
  registerTool(tool: AIToolDef): Disposable;
  /** Open the chat panel and send a message (optionally with attachments of the current context). */
  ask(message: string, opts?: { includeSelection?: boolean; includeDiagnostics?: boolean }): void;
  isConfigured(): boolean;
}

let bridge: AiBridge | null = null;

export function setAiBridge(b: AiBridge | null) {
  bridge = b;
}

export function getAiBridge(): AiBridge | null {
  return bridge;
}
