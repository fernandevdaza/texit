import path from 'node:path';
import type { CliAgentEvent } from '@texit/core';

/** A stateful parser turning one CLI's stdout lines into `CliAgentEvent`s. */
export interface AgentStreamParser {
  /** Parse one complete stdout line (without the trailing newline). */
  line(line: string): CliAgentEvent[];
  /** Fatal error reported inside the stream (turn failure, auth error…), if any. */
  error(): string | undefined;
  /** Session id seen in the stream, if any. */
  sessionId(): string | undefined;
}

export interface ParserOptions {
  /** Agent working directory, used to report file changes relative to it. */
  cwd?: string;
}

/**
 * Incremental newline splitter for stdout chunks (handles CRLF, partial lines
 * and multi-byte characters split across chunks when fed strings decoded with
 * a streaming decoder / `setEncoding('utf8')`).
 */
export class LineSplitter {
  private buf = '';
  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      out.push(line);
    }
    return out;
  }
  flush(): string[] {
    const rest = this.buf.replace(/\r$/, '');
    this.buf = '';
    return rest ? [rest] : [];
  }
}

export function tryJson(line: string): any | undefined {
  const t = line.trim();
  if (!t || (t[0] !== '{' && t[0] !== '[')) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

/** Report a path relative to the agent cwd (POSIX separators) when it lives inside it. */
export function relToCwd(p: string, cwd?: string): string {
  if (!p) return p;
  if (!cwd) return p.replace(/\\/g, '/');
  const abs = path.isAbsolute(p) ? p : path.join(cwd, p);
  const rel = path.relative(cwd, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return abs.replace(/\\/g, '/');
  return rel.split(path.sep).join('/');
}

/** Dig a human-readable message out of nested JSON error payloads. */
export function errorMessage(value: unknown): string {
  if (value == null) return 'Unknown error';
  if (typeof value === 'string') {
    const inner = tryJson(value);
    if (inner !== undefined) {
      const msg = errorMessage(inner);
      if (msg && msg !== 'Unknown error') return msg;
    }
    return value;
  }
  if (typeof value === 'object') {
    const v = value as Record<string, any>;
    if (v.error !== undefined && v.error !== value) {
      const nested = errorMessage(v.error);
      if (nested !== 'Unknown error') return nested;
    }
    if (typeof v.message === 'string') return errorMessage(v.message);
    if (v.data && typeof v.data.message === 'string') return v.data.message;
    if (typeof v.name === 'string') return v.name;
  }
  return 'Unknown error';
}

/** Flatten tool result payloads (strings, MCP content arrays, objects) into text. */
export function contentToText(content: unknown, max = 20_000): string | undefined {
  if (content == null) return undefined;
  let s: string;
  if (typeof content === 'string') s = content;
  else if (Array.isArray(content)) {
    s = content
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object' && typeof (c as any).text === 'string') return (c as any).text as string;
        if (c && (c as any).type === 'image') return '[image]';
        return JSON.stringify(c);
      })
      .join('\n');
  } else if (typeof content === 'object' && Array.isArray((content as any).content)) {
    return contentToText((content as any).content, max);
  } else s = JSON.stringify(content);
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s;
}

export function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
