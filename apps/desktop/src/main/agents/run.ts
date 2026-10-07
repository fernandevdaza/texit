/**
 * Runs a CLI agent non-interactively and streams its parsed events.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { ChildProcess } from 'node:child_process';
import type { CliAgentEvent, CliAgentRunRequest } from '@texit/core';
import { killTree, spawnTree } from '../util/process';
import { buildAgentCommand } from './args';
import { createParser, LineSplitter } from './parsers';
import { resolveAgentBinary } from './registry';

/** Agents may legitimately run for a long time; this only guards against hung processes. */
export const AGENT_TIMEOUT_MS = 60 * 60 * 1000;

interface Run {
  child: ChildProcess | null;
  cancelled: boolean;
}

const runs = new Map<string, Run>();

export async function cancelAgentRun(runId: string): Promise<void> {
  const run = runs.get(runId);
  if (!run) return;
  run.cancelled = true;
  if (run.child) await killTree(run.child);
}

export async function cancelAllAgentRuns(): Promise<void> {
  await Promise.all(Array.from(runs.keys()).map((id) => cancelAgentRun(id)));
}

export async function runAgent(req: CliAgentRunRequest, emit: (e: CliAgentEvent) => void): Promise<{ exitCode: number }> {
  if (runs.has(req.runId)) throw new Error(`Run ${req.runId} is already active`);
  const run: Run = { child: null, cancelled: false };
  runs.set(req.runId, run);
  const send = (e: CliAgentEvent) => {
    try {
      emit(e);
    } catch {
      /* renderer gone */
    }
  };
  const tmpFiles: string[] = [];
  let doneSent = false;
  const done = (exitCode: number, error?: string) => {
    if (doneSent) return;
    doneSent = true;
    send({ type: 'done', exitCode, ...(error ? { error } : {}) });
  };

  try {
    const st = await fs.stat(req.cwd).catch(() => null);
    if (!st?.isDirectory()) throw new Error(`Working directory does not exist: ${req.cwd}`);
    const bin = await resolveAgentBinary(req.agent);
    if (!bin) throw new Error(`${req.agent} CLI was not found. Install it and make sure it is on your PATH.`);

    const tmpDir = path.join(os.tmpdir(), 'texit-agents');
    await fs.mkdir(tmpDir, { recursive: true, mode: 0o700 });
    const cmd = buildAgentCommand(req, { tmpDir, runId: req.runId.replace(/[^A-Za-z0-9_-]/g, '_') });
    for (const f of cmd.files) {
      await fs.writeFile(f.path, f.content, { mode: 0o600 });
      tmpFiles.push(f.path);
    }
    for (const note of cmd.notes) send({ type: 'stderr', text: `[texit] ${note}\n` });
    if (run.cancelled) {
      done(-1, 'Cancelled');
      return { exitCode: -1 };
    }

    const child = await spawnTree(bin, cmd.args, {
      cwd: req.cwd,
      stdio: [cmd.stdin !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      extraEnv: {
        ...req.env,
        ...cmd.env,
        // Plain, machine-readable output.
        NO_COLOR: '1',
        FORCE_COLOR: '0',
        TERM: 'dumb',
        TEXIT_AGENT_RUN: req.runId,
      },
    });
    run.child = child;

    if (cmd.stdin !== undefined && child.stdin) {
      child.stdin.on('error', () => undefined); // EPIPE if the CLI exits early
      child.stdin.end(cmd.stdin);
    }

    const parser = createParser(req.agent, { cwd: req.cwd });
    const splitter = new LineSplitter();
    const decoder = new StringDecoder('utf8');
    const handleLines = (lines: string[]) => {
      for (const line of lines) for (const e of parser.line(line)) send(e);
    };
    child.stdout?.on('data', (d: Buffer) => handleLines(splitter.push(decoder.write(d))));

    let stderrTail = '';
    const errDecoder = new StringDecoder('utf8');
    child.stderr?.on('data', (d: Buffer) => {
      const text = errDecoder.write(d);
      if (!text) return;
      stderrTail = (stderrTail + text).slice(-4000);
      send({ type: 'stderr', text });
    });

    const timer = setTimeout(() => {
      send({ type: 'stderr', text: `[texit] agent timed out after ${AGENT_TIMEOUT_MS / 60000} min\n` });
      void cancelAgentRun(req.runId);
    }, AGENT_TIMEOUT_MS);

    const code = await new Promise<number>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (c, signal) => resolve(c ?? (signal ? -1 : 0)));
    }).finally(() => clearTimeout(timer));

    handleLines(splitter.push(decoder.end()));
    handleLines(splitter.flush());

    if (run.cancelled) {
      done(code === 0 ? -1 : code, 'Cancelled');
      return { exitCode: code === 0 ? -1 : code };
    }
    const streamError = parser.error();
    const error = streamError ?? (code !== 0 ? lastLines(stderrTail) || `${req.agent} exited with code ${code}` : undefined);
    // Some CLIs exit 0 even when the turn failed (auth errors…): surface it as a failure.
    const exitCode = code === 0 && streamError ? 1 : code;
    done(exitCode, error);
    return { exitCode };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    send({ type: 'stderr', text: `[texit] ${message}\n` });
    done(-1, message);
    return { exitCode: -1 };
  } finally {
    runs.delete(req.runId);
    await Promise.all(tmpFiles.map((f) => fs.rm(f, { force: true }).catch(() => undefined)));
  }
}

function lastLines(s: string, n = 5): string {
  return s.trim().split(/\r?\n/).slice(-n).join('\n');
}
