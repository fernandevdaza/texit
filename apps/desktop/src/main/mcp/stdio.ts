/**
 * stdio MCP servers: spawned with the user's login PATH, newline-delimited
 * JSON-RPC framing on stdin/stdout, stderr captured for diagnostics.
 */
import { StringDecoder } from 'node:string_decoder';
import type { ChildProcess } from 'node:child_process';
import type { JsonRpcMessage, McpStdioConfig } from '@texit/core';
import { killTree, spawnTree } from '../util/process';
import { which } from '../util/which';
import { LineSplitter } from '../agents/parsers/common';

const STDERR_CAP = 64 * 1024;

interface StdioProc {
  child: ChildProcess;
  stderr: string;
  stopping: boolean;
}

export interface StdioHandlers {
  onMessage(msg: JsonRpcMessage): void;
  onExit(info: { code: number | null; stderr: string }): void;
}

const procs = new Map<string, StdioProc>();

export async function startStdio(cfg: McpStdioConfig, handlers: StdioHandlers): Promise<void> {
  await stopStdio(cfg.id);
  const resolved = (await which(cfg.command)) ?? cfg.command;
  const child = await spawnTree(resolved, cfg.args ?? [], {
    cwd: cfg.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    extraEnv: cfg.env,
  });
  const proc: StdioProc = { child, stderr: '', stopping: false };
  procs.set(cfg.id, proc);

  const splitter = new LineSplitter();
  const decoder = new StringDecoder('utf8');
  const onLines = (lines: string[]) => {
    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      try {
        const msg = JSON.parse(t);
        if (msg && typeof msg === 'object' && msg.jsonrpc === '2.0') handlers.onMessage(msg as JsonRpcMessage);
        else appendStderr(proc, `[non JSON-RPC stdout] ${t}\n`);
      } catch {
        appendStderr(proc, `[stdout] ${t}\n`);
      }
    }
  };
  child.stdout?.on('data', (d: Buffer) => onLines(splitter.push(decoder.write(d))));
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (d: string) => appendStderr(proc, d));
  child.stdin?.on('error', (err) => appendStderr(proc, `[stdin] ${err.message}\n`));

  let exited = false;
  const finish = (code: number | null) => {
    if (exited) return;
    exited = true;
    onLines(splitter.flush());
    if (procs.get(cfg.id) === proc) procs.delete(cfg.id);
    handlers.onExit({ code, stderr: proc.stderr });
  };
  child.once('error', (err) => {
    appendStderr(proc, `${err.message}\n`);
    finish(null);
  });
  child.once('close', (code) => finish(code));

  // Surface immediate spawn failures (ENOENT…) as a rejected start.
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(new Error(`Failed to start MCP server "${cfg.command}": ${err.message}`));
    child.once('error', onError);
    child.once('spawn', () => {
      child.off('error', onError);
      resolve();
    });
  });
}

function appendStderr(proc: StdioProc, s: string) {
  proc.stderr = (proc.stderr + s).slice(-STDERR_CAP);
}

export async function sendStdio(id: string, msg: JsonRpcMessage): Promise<void> {
  const proc = procs.get(id);
  if (!proc || !proc.child.stdin || proc.child.stdin.destroyed) throw new Error(`MCP server ${id} is not running`);
  const line = `${JSON.stringify(msg)}\n`;
  await new Promise<void>((resolve, reject) => {
    proc.child.stdin!.write(line, (err) => (err ? reject(err) : resolve()));
  });
}

export async function stopStdio(id: string): Promise<void> {
  const proc = procs.get(id);
  if (!proc) return;
  proc.stopping = true;
  procs.delete(id);
  try {
    proc.child.stdin?.end();
  } catch {
    /* ignore */
  }
  await killTree(proc.child, 1500);
}

export async function stopAllStdio(): Promise<void> {
  await Promise.all(Array.from(procs.keys()).map((id) => stopStdio(id)));
}
