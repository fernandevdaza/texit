/**
 * Parser for `gemini -o stream-json` (also used for Qwen Code, a Gemini CLI fork).
 *
 *   {"type":"init","timestamp":"…","session_id":"…","model":"…"}
 *   {"type":"message","role":"user"|"assistant","content":"…","delta":true}
 *   {"type":"tool_use","tool_name":"write_file","tool_id":"…","parameters":{…}}
 *   {"type":"tool_result","tool_id":"…","status":"success"|"error","output":"…","error":{"type":"…","message":"…"}}
 *   {"type":"error","severity":"warning"|"error","message":"…"}
 *   {"type":"result","status":"success"|"error","error":{…},"stats":{"input_tokens":…,"output_tokens":…,…}}
 */
import type { CliAgentEvent } from '@texit/core';
import { contentToText, errorMessage, num, relToCwd, tryJson, type AgentStreamParser, type ParserOptions } from './common';

const WRITE_TOOLS = new Set(['write_file', 'replace', 'edit', 'smart_edit', 'edit_file', 'write']);

export function createGeminiParser(opts: ParserOptions = {}): AgentStreamParser {
  let session: string | undefined;
  let fatal: string | undefined;
  const tools = new Map<string, { name: string; input: any }>();

  const toolResult = (ev: any, out: CliAgentEvent[]) => {
    const t = tools.get(ev.tool_id);
    const failed = ev.status === 'error' || !!ev.error;
    out.push({
      type: 'tool',
      name: t?.name ?? String(ev.tool_name ?? 'tool'),
      input: t?.input,
      output: failed ? errorMessage(ev.error ?? ev.output) : contentToText(ev.output),
      status: failed ? 'failed' : 'completed',
    });
    if (!failed && t && WRITE_TOOLS.has(t.name)) {
      const file = t.input?.file_path ?? t.input?.absolute_path ?? t.input?.path;
      if (typeof file === 'string') out.push({ type: 'file-change', path: relToCwd(file, opts.cwd), kind: 'change' });
    }
    if (ev.tool_id) tools.delete(ev.tool_id);
  };

  return {
    sessionId: () => session,
    error: () => fatal,
    line(line) {
      const ev = tryJson(line);
      if (!ev || typeof ev !== 'object') return line.trim() ? [{ type: 'stderr', text: line }] : [];
      const out: CliAgentEvent[] = [];
      switch (ev.type) {
        case 'init':
          if (typeof ev.session_id === 'string' && ev.session_id !== session) {
            session = ev.session_id;
            out.push({ type: 'session', sessionId: ev.session_id });
          }
          break;
        case 'message':
          if (ev.role === 'assistant' && ev.content) out.push({ type: 'text', text: String(ev.content) });
          break;
        case 'thought':
        case 'thinking': {
          const text = ev.content ?? ev.text ?? ev.subject;
          if (text) out.push({ type: 'reasoning', text: String(text) });
          break;
        }
        case 'tool_use': {
          const name = String(ev.tool_name ?? ev.name ?? 'tool');
          const input = ev.parameters ?? ev.args;
          if (ev.tool_id) tools.set(ev.tool_id, { name, input });
          out.push({ type: 'tool', name, input, status: 'started' });
          break;
        }
        case 'tool_result':
          toolResult(ev, out);
          break;
        case 'error': {
          const msg = errorMessage(ev.message ?? ev.error);
          out.push({ type: 'stderr', text: msg });
          if (ev.severity !== 'warning' && ev.severity !== 'info') fatal = msg;
          break;
        }
        case 'result': {
          const s = ev.stats ?? {};
          out.push({ type: 'usage', inputTokens: num(s.input_tokens ?? s.input), outputTokens: num(s.output_tokens ?? s.output) });
          if (ev.status === 'error' || ev.error) fatal = (ev.error ? errorMessage(ev.error) : undefined) ?? fatal ?? 'error';
          break;
        }
        default:
          break;
      }
      return out;
    },
  };
}
