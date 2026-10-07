/**
 * Turn the BusyTeX pipeline's per-command log entries into a single raw log
 * that reads like a normal TeX log: the `.log` of the last TeX pass first
 * (what log parsers expect), followed by delimited sections for the
 * auxiliary tools (bibtex8 / biber / makeindex / xdvipdfmx).
 */
import type { BusyTexLogEntry } from './worker-client';

const RULE = '='.repeat(72);

function isTexEntry(e: BusyTexLogEntry): boolean {
  return !/^(bibtex|biber|makeindex|xdvipdfmx)\b/.test(e.cmd);
}

/** Emscripten runtime chatter that is not useful to users. */
function clean(s: string): string {
  return s
    .split('\n')
    .filter((l) => !/keepRuntimeAlive\(\) is set|^program exited \(with status: \d+\)/.test(l))
    .join('\n');
}

function toolName(cmd: string): string {
  return cmd.split(/\s+/)[0] || 'tool';
}

/** Short description of the command list, e.g. `pdflatex ×3, biber`. */
export function summarizeCommands(logs: BusyTexLogEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of logs) counts.set(toolName(e.cmd), (counts.get(toolName(e.cmd)) ?? 0) + 1);
  return [...counts].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)).join(', ');
}

export function buildBusyTexLog(rawLogs: BusyTexLogEntry[], fallback = ''): string {
  if (!rawLogs.length) return fallback;
  const logs = rawLogs.map((e) => ({ ...e, stdout: clean(e.stdout ?? ''), stderr: clean(e.stderr ?? ''), log: e.log ?? '' }));
  const parts: string[] = [];
  let lastTex = -1;
  logs.forEach((e, i) => {
    if (isTexEntry(e)) lastTex = i;
  });
  const tex = lastTex >= 0 ? logs[lastTex] : undefined;
  if (tex) {
    if (tex.log.trim()) parts.push(tex.log.trimEnd());
    else {
      // TeX died before writing its .log (bad format, fatal error…): show its terminal output.
      const out = [tex.stdout, tex.stderr].filter((s) => s.trim()).join('\n');
      parts.push(out || `${toolName(tex.cmd)} exited with code ${tex.exit_code} without writing a log.`);
    }
  }
  logs.forEach((e, i) => {
    if (i === lastTex || isTexEntry(e)) return;
    const body = [e.log, e.stdout, e.stderr]
      .map((s) => s.trim())
      .filter((s, idx, arr) => s && arr.indexOf(s) === idx)
      .join('\n');
    if (!body && e.exit_code === 0) return;
    parts.push(`${RULE}\n[${toolName(e.cmd)}] ${e.cmd} (exit code ${e.exit_code})\n${RULE}\n${body}`);
  });
  if (tex && tex.exit_code !== 0 && tex.stderr.trim() && tex.log.trim()) {
    parts.push(`${RULE}\n[${toolName(tex.cmd)}] stderr\n${RULE}\n${tex.stderr.trim()}`);
  }
  return parts.join('\n\n') + '\n';
}

/** Everything the tools printed (for missing-file detection). */
export function allLogText(logs: BusyTexLogEntry[], extra = ''): string {
  return logs.map((e) => [e.log, e.stdout, e.stderr, e.texmflog, e.missfontlog].join('\n')).join('\n') + '\n' + extra;
}
