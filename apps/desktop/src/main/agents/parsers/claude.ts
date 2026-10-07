/**
 * Parser for `claude -p --output-format stream-json --verbose`.
 *
 *   {"type":"system","subtype":"init","session_id":"…","model":"…",…}
 *   {"type":"assistant","message":{"content":[{"type":"text"|"thinking"|"tool_use",…}],…},"session_id":"…"}
 *   {"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"…","content":…,"is_error":false}]},
 *    "tool_use_result":{…}}
 *   {"type":"result","subtype":"success"|"error_…","is_error":false,"result":"…","total_cost_usd":…,"usage":{…}}
 */
import type { CliAgentEvent } from '@texit/core';
import { contentToText, errorMessage, num, relToCwd, tryJson, type AgentStreamParser, type ParserOptions } from './common';

const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);

export function createClaudeParser(opts: ParserOptions = {}): AgentStreamParser {
  let session: string | undefined;
  let fatal: string | undefined;
  const tools = new Map<string, { name: string; input: any }>();

  const setSession = (id: unknown, out: CliAgentEvent[]) => {
    if (typeof id === 'string' && id && id !== session) {
      session = id;
      out.push({ type: 'session', sessionId: id });
    }
  };

  const assistant = (ev: any, out: CliAgentEvent[]) => {
    setSession(ev.session_id, out);
    const content: any[] = Array.isArray(ev.message?.content) ? ev.message.content : [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && block.text) out.push({ type: 'text', text: String(block.text) });
      else if (block.type === 'thinking' && block.thinking) out.push({ type: 'reasoning', text: String(block.thinking) });
      else if (block.type === 'tool_use') {
        tools.set(block.id, { name: block.name, input: block.input });
        out.push({ type: 'tool', name: String(block.name), input: block.input, status: 'started' });
      }
    }
    if (ev.error && ev.is_api_error_message) {
      const text = content.find((b) => b?.type === 'text')?.text;
      fatal = text ? String(text) : String(ev.error);
    }
  };

  const user = (ev: any, out: CliAgentEvent[]) => {
    const content: any[] = Array.isArray(ev.message?.content) ? ev.message.content : [];
    for (const block of content) {
      if (!block || block.type !== 'tool_result') continue;
      const t = tools.get(block.tool_use_id);
      const failed = !!block.is_error;
      out.push({ type: 'tool', name: t?.name ?? 'tool', input: t?.input, output: contentToText(block.content), status: failed ? 'failed' : 'completed' });
      if (!failed && t && EDIT_TOOLS.has(t.name)) {
        const file = t.input?.file_path ?? t.input?.notebook_path ?? ev.tool_use_result?.filePath;
        if (typeof file === 'string') {
          const kind = ev.tool_use_result?.type === 'create' ? 'add' : 'change';
          out.push({ type: 'file-change', path: relToCwd(file, opts.cwd), kind });
        }
      }
      tools.delete(block.tool_use_id);
    }
  };

  const result = (ev: any, out: CliAgentEvent[]) => {
    setSession(ev.session_id, out);
    const u = ev.usage ?? {};
    const input = (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0);
    out.push({
      type: 'usage',
      inputTokens: u.input_tokens === undefined ? undefined : input,
      outputTokens: num(u.output_tokens),
      costUsd: num(ev.total_cost_usd),
    });
    if (ev.is_error || (typeof ev.subtype === 'string' && ev.subtype.startsWith('error'))) {
      const errors = Array.isArray(ev.errors) && ev.errors.length ? ev.errors.map((e: unknown) => errorMessage(e)).join('\n') : '';
      fatal = (typeof ev.result === 'string' && ev.result) || errors || fatal || String(ev.subtype ?? 'error');
    }
  };

  return {
    sessionId: () => session,
    error: () => fatal,
    line(line) {
      const ev = tryJson(line);
      if (!ev || typeof ev !== 'object') return line.trim() ? [{ type: 'stderr', text: line }] : [];
      const out: CliAgentEvent[] = [];
      if (ev.type === 'system' && ev.subtype === 'init') setSession(ev.session_id, out);
      else if (ev.type === 'assistant') assistant(ev, out);
      else if (ev.type === 'user') user(ev, out);
      else if (ev.type === 'result') result(ev, out);
      return out;
    },
  };
}
