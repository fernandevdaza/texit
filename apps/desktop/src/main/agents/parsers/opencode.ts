/**
 * Parser for `opencode run --format json`.
 *
 *   {"type":"step_start","timestamp":…,"sessionID":"ses_…","part":{…}}
 *   {"type":"text","sessionID":"…","part":{"type":"text","text":"…"}}
 *   {"type":"reasoning","sessionID":"…","part":{"type":"reasoning","text":"…"}}
 *   {"type":"tool_use","sessionID":"…","part":{"type":"tool","tool":"edit","callID":"…",
 *        "state":{"status":"completed"|"error","input":{…},"output":"…","error":"…"}}}
 *   {"type":"step_finish","sessionID":"…","part":{"type":"step-finish","tokens":{"input":…,"output":…},"cost":…}}
 *   {"type":"error","sessionID":"…","error":{"name":"APIError","data":{"message":"…"}}}
 */
import type { CliAgentEvent } from '@texit/core';
import { contentToText, errorMessage, num, relToCwd, tryJson, type AgentStreamParser, type ParserOptions } from './common';

const WRITE_TOOLS = new Set(['edit', 'write', 'patch', 'multiedit']);

export function createOpencodeParser(opts: ParserOptions = {}): AgentStreamParser {
  let session: string | undefined;
  let fatal: string | undefined;

  const tool = (part: any, out: CliAgentEvent[]) => {
    const state = part?.state ?? {};
    const name = String(part?.tool ?? 'tool');
    const status = state.status === 'error' ? 'failed' : state.status === 'completed' ? 'completed' : 'started';
    out.push({
      type: 'tool',
      name,
      input: state.input,
      output: status === 'failed' ? errorMessage(state.error) : contentToText(state.output),
      status,
    });
    if (status === 'completed' && WRITE_TOOLS.has(name)) {
      const file = state.input?.filePath ?? state.input?.file_path ?? state.input?.path;
      if (typeof file === 'string') out.push({ type: 'file-change', path: relToCwd(file, opts.cwd), kind: name === 'write' ? 'add' : 'change' });
    }
  };

  return {
    sessionId: () => session,
    error: () => fatal,
    line(line) {
      const ev = tryJson(line);
      if (!ev || typeof ev !== 'object') return line.trim() ? [{ type: 'stderr', text: line }] : [];
      const out: CliAgentEvent[] = [];
      if (typeof ev.sessionID === 'string' && ev.sessionID !== session) {
        session = ev.sessionID;
        out.push({ type: 'session', sessionId: ev.sessionID });
      }
      switch (ev.type) {
        case 'text':
          if (ev.part?.text) out.push({ type: 'text', text: String(ev.part.text) });
          break;
        case 'reasoning':
          if (ev.part?.text) out.push({ type: 'reasoning', text: String(ev.part.text) });
          break;
        case 'tool_use':
          tool(ev.part, out);
          break;
        case 'step_finish': {
          const t = ev.part?.tokens ?? {};
          out.push({ type: 'usage', inputTokens: num(t.input), outputTokens: num(t.output), costUsd: num(ev.part?.cost) });
          break;
        }
        case 'error':
          fatal = errorMessage(ev.error);
          out.push({ type: 'stderr', text: fatal });
          break;
        default:
          break;
      }
      return out;
    },
  };
}
