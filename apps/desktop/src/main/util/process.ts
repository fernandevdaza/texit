/**
 * Child-process helpers: cross-platform spawning (Windows .cmd shims via
 * cross-spawn), process-tree termination and a registry so every child is
 * killed when the app quits.
 */
import { execFile, type ChildProcess, type SpawnOptions } from 'node:child_process';
import path from 'node:path';
import crossSpawn from 'cross-spawn';
import { childEnv } from './env-path';

const live = new Set<ChildProcess>();

export interface SpawnTreeOptions extends Omit<SpawnOptions, 'detached'> {
  /** Directories to put first on PATH (e.g. the directory of the resolved binary). */
  prependPath?: string[];
  extraEnv?: Record<string, string | undefined>;
}

/**
 * Spawn a process in its own process group (POSIX) so the whole tree can be
 * killed, with the user's login PATH.
 */
export async function spawnTree(command: string, args: string[], opts: SpawnTreeOptions = {}): Promise<ChildProcess> {
  const { prependPath = [], extraEnv, env, ...rest } = opts;
  const binDir = path.isAbsolute(command) ? [path.dirname(command)] : [];
  const mergedEnv = await childEnv({ ...(env as Record<string, string | undefined> | undefined), ...extraEnv }, [...binDir, ...prependPath]);
  const child = crossSpawn(command, args, {
    ...rest,
    env: mergedEnv,
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  live.add(child);
  const forget = () => live.delete(child);
  child.once('exit', forget);
  child.once('error', forget);
  return child;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isAlive(child: ChildProcess): boolean {
  return child.exitCode === null && child.signalCode === null;
}

/** Kill a process and all of its descendants. Resolves once the process exited (or after a grace period). */
export async function killTree(child: ChildProcess, graceMs = 2500): Promise<void> {
  if (!child.pid || !isAlive(child)) return;
  const pid = child.pid;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => resolve());
    });
    await Promise.race([exited, sleep(graceMs)]);
    return;
  }
  const signal = (sig: NodeJS.Signals) => {
    try {
      process.kill(-pid, sig); // the whole process group
    } catch {
      try {
        child.kill(sig);
      } catch {
        /* already gone */
      }
    }
  };
  signal('SIGTERM');
  await Promise.race([exited, sleep(graceMs)]);
  if (isAlive(child)) {
    signal('SIGKILL');
    await Promise.race([exited, sleep(1000)]);
  }
}

/** Kill every child spawned through `spawnTree` (used on app quit). */
export async function killAllChildren(): Promise<void> {
  await Promise.all(Array.from(live).map((c) => killTree(c, 1000).catch(() => undefined)));
}

/** Synchronous best-effort variant for the `will-quit` handler. */
export function killAllChildrenSync(): void {
  for (const child of live) {
    if (!child.pid || !isAlive(child)) continue;
    try {
      if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

export interface CaptureResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** Run a short-lived command and capture its output (used for `--version` probes). */
export async function capture(command: string, args: string[], opts: { timeoutMs?: number; cwd?: string; env?: Record<string, string> } = {}): Promise<CaptureResult> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  let child: ChildProcess;
  try {
    child = await spawnTree(command, args, { cwd: opts.cwd, extraEnv: opts.env, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    return { code: null, stdout: '', stderr: String(err), timedOut: false };
  }
  let stdout = '';
  let stderr = '';
  const cap = 256 * 1024;
  child.stdout?.on('data', (d: Buffer) => {
    if (stdout.length < cap) stdout += d.toString('utf8');
  });
  child.stderr?.on('data', (d: Buffer) => {
    if (stderr.length < cap) stderr += d.toString('utf8');
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void killTree(child, 500);
  }, timeoutMs);
  const code = await new Promise<number | null>((resolve) => {
    child.once('error', (err) => {
      stderr += String(err);
      resolve(null);
    });
    child.once('close', (c) => resolve(c));
  });
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
}

/** First non-empty line of a `--version` output. */
export function firstLine(s: string): string | undefined {
  return s
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
}
