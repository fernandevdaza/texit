import type { CliAgentEvent } from '@texit/core';
import { createClaudeParser } from './claude';
import { createCodexParser } from './codex';
import { createGeminiParser } from './gemini';
import { createOpencodeParser } from './opencode';
import type { AgentStreamParser, ParserOptions } from './common';

export { LineSplitter, type AgentStreamParser, type ParserOptions } from './common';
export { createClaudeParser, createCodexParser, createGeminiParser, createOpencodeParser };

/** Plain-text CLIs (aider): every stdout line is assistant text. */
export function createTextParser(): AgentStreamParser {
  return {
    sessionId: () => undefined,
    error: () => undefined,
    line: (line): CliAgentEvent[] => [{ type: 'text', text: `${line}\n` }],
  };
}

export function createParser(agent: string, opts: ParserOptions = {}): AgentStreamParser {
  switch (agent) {
    case 'codex':
      return createCodexParser(opts);
    case 'claude':
      return createClaudeParser(opts);
    case 'gemini':
    case 'qwen':
      return createGeminiParser(opts);
    case 'opencode':
      return createOpencodeParser(opts);
    default:
      return createTextParser();
  }
}
