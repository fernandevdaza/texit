/**
 * Parser for `codex exec --json` (JSONL "thread events").
 *
 *   {"type":"thread.started","thread_id":"…"}
 *   {"type":"turn.started"}
 *   {"type":"item.started"|"item.updated"|"item.completed","item":{"id":"item_0","type":"agent_message"|"reasoning"|
 *        "command_execution"|"file_change"|"mcp_tool_call"|"web_search"|"todo_list"|"error", …}}
 *   {"type":"turn.completed","usage":{"input_tokens":…,"cached_input_tokens":…,"output_tokens":…}}
 *   {"type":"turn.failed","error":{"message":"…"}}
 *   {"type":"error","message":"…"}
 */
import type { CliAgentEvent } from '@texit/core';
import { contentToText, errorMessage, num, relToCwd, tryJson, type AgentStreamParser, type ParserOptions } from './common';

function toolName(item: any): string {
  switch (item.type) {
    case 'command_execution':
      return 'shell';
    case 'mcp_tool_call':
      return [item.server, item.tool].filter(Boolean).join('.') || 'mcp';
    case 'web_search':
      return 'web_search';
    default:
      return String(item.type ?? 'tool');
  }
}

function toolInput(item: any): unknown {
  switch (item.type) {
    case 'command_execution':
      return { command: item.command };
    case 'mcp_tool_call':
      return item.arguments ?? item.args;
    case 'web_search':
      return { query: item.query };
    default:
      return undefined;
  }
}

const isTool = (t: unknown) => t === 'command_execution' || t === 'mcp_tool_call' || t === 'web_search';

export function createCodexParser(opts: ParserOptions = {}): AgentStreamParser {
  let session: string | undefined;
  let fatal: string | undefined;

  const completed = (item: any, out: CliAgentEvent[]) => {
    switch (item.type) {
      case 'agent_message':
      case 'assistant_message':
        if (item.text) out.push({ type: 'text', text: String(item.text) });
        break;
      case 'reasoning':
        if (item.text) out.push({ type: 'reasoning', text: String(item.text) });
        break;
      case 'command_execution': {
        const failed = item.status === 'failed' || (typeof item.exit_code === 'number' && item.exit_code !== 0);
        out.push({ type: 'tool', name: 'shell', input: toolInput(item), output: contentToText(item.aggregated_output), status: failed ? 'failed' : 'completed' });
        break;
      }
      case 'mcp_tool_call': {
        const failed = item.status === 'failed' || !!item.error;
        out.push({
          type: 'tool',
          name: toolName(item),
          input: toolInput(item),
          output: failed ? errorMessage(item.error) : contentToText(item.result),
          status: failed ? 'failed' : 'completed',
        });
        break;
      }
      case 'web_search':
        out.push({ type: 'tool', name: 'web_search', input: toolInput(item), status: 'completed' });
        break;
      case 'file_change':
        if (item.status !== 'failed' && Array.isArray(item.changes)) {
          for (const c of item.changes) {
            if (!c || typeof c.path !== 'string') continue;
            const kind = c.kind === 'add' ? 'add' : c.kind === 'delete' ? 'delete' : 'change';
            out.push({ type: 'file-change', path: relToCwd(c.path, opts.cwd), kind });
          }
        }
        break;
      case 'error':
        // Non-fatal warnings (e.g. unknown model metadata) are reported as items.
        if (item.message) out.push({ type: 'stderr', text: String(item.message) });
        break;
      default:
        break;
    }
  };

  return {
    sessionId: () => session,
    error: () => fatal,
    line(line) {
      const ev = tryJson(line);
      if (!ev || typeof ev !== 'object') return line.trim() ? [{ type: 'stderr', text: line }] : [];
      const out: CliAgentEvent[] = [];
      switch (ev.type) {
        case 'thread.started':
          if (typeof ev.thread_id === 'string') {
            session = ev.thread_id;
            out.push({ type: 'session', sessionId: ev.thread_id });
          }
          break;
        case 'item.started': {
          const item = ev.item ?? {};
          if (isTool(item.type)) out.push({ type: 'tool', name: toolName(item), input: toolInput(item), status: 'started' });
          break;
        }
        case 'item.completed':
          completed(ev.item ?? {}, out);
          break;
        case 'turn.completed': {
          const u = ev.usage ?? {};
          out.push({ type: 'usage', inputTokens: num(u.input_tokens), outputTokens: num(u.output_tokens) });
          break;
        }
        case 'turn.failed':
          fatal = errorMessage(ev.error);
          break;
        case 'error':
          fatal = errorMessage(ev.message ?? ev.error);
          out.push({ type: 'stderr', text: fatal });
          break;
        default:
          break;
      }
      return out;
    },
  };
}
