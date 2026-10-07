/**
 * Native LaTeX compilation (latexmk, tectonic or raw engine passes).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { NativeCompileRequest, NativeCompileResult, NativeTexInfo } from '@texit/core';
import { killTree, spawnTree } from '../util/process';
import { detectTex } from './detect';
import { detectBibNeed, engineArgs, formatCommand, jobStem, latexmkArgs, needsRerun, pickDriver, tectonicArgs, toPosix } from './args';
import { safeRelative, syncBuildDir } from './sync';

/** Hard limit for one compile (first tectonic runs download their bundle). */
export const COMPILE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_LOG_CHARS = 8 * 1024 * 1024;

interface Job {
  jobId: string;
  projectId: string;
  cancelled: boolean;
  timedOut: boolean;
  child: ChildProcess | null;
  done: Promise<unknown>;
}

const jobs = new Map<string, Job>();
const projectJobs = new Map<string, Job>();

export function sanitizeProjectId(id: string): string {
  const clean = String(id).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  if (!clean || /^_+$/.test(clean)) throw new Error('Invalid projectId');
  return clean;
}

export async function cancelCompile(jobId: string): Promise<void> {
  const job = jobs.get(jobId);
  if (!job) return;
  job.cancelled = true;
  if (job.child) await killTree(job.child);
}

export async function cancelAllCompiles(): Promise<void> {
  await Promise.all(Array.from(jobs.keys()).map((id) => cancelCompile(id)));
}

class CancelledError extends Error {}

export async function compileNative(
  req: NativeCompileRequest,
  opts: { buildRoot: string; onLog?: (chunk: string) => void },
): Promise<NativeCompileResult> {
  const started = Date.now();
  const projectKey = sanitizeProjectId(req.projectId);
  const buildDir = path.join(opts.buildRoot, projectKey);
  const emit = (s: string) => {
    try {
      opts.onLog?.(s);
    } catch {
      /* renderer gone */
    }
  };

  // Latest compile of a project wins: cancel the previous one and wait for it to release the build dir.
  const previous = projectJobs.get(projectKey);
  if (previous) {
    previous.cancelled = true;
    if (previous.child) await killTree(previous.child);
    await previous.done.catch(() => undefined);
  }

  let resolveDone!: () => void;
  const job: Job = {
    jobId: req.jobId,
    projectId: projectKey,
    cancelled: false,
    timedOut: false,
    child: null,
    done: new Promise<void>((r) => (resolveDone = r)),
  };
  jobs.set(req.jobId, job);
  projectJobs.set(projectKey, job);
  const timer = setTimeout(() => {
    job.timedOut = true;
    job.cancelled = true;
    if (job.child) void killTree(job.child);
  }, COMPILE_TIMEOUT_MS);

  const commands: string[] = [];
  let consoleOut = '';
  const appendConsole = (s: string) => {
    if (consoleOut.length < MAX_LOG_CHARS) consoleOut += s;
    emit(s);
  };

  const base = (status: NativeCompileResult['status'], extra: Partial<NativeCompileResult> = {}): NativeCompileResult => ({
    status,
    log: consoleOut,
    durationMs: Date.now() - started,
    buildDir,
    command: commands.join(' && '),
    ...extra,
  });

  try {
    const mainRel = safeRelative(req.mainPath);
    if (!mainRel) throw new Error(`Invalid main file path: ${req.mainPath}`);
    if (!req.files.some((f) => safeRelative(f.path) === mainRel)) throw new Error(`Main file not found in project: ${mainRel}`);

    const stats = await syncBuildDir(buildDir, req.files);
    appendConsole(`[texit] build dir ${buildDir} (${stats.written} written, ${stats.unchanged} unchanged, ${stats.deleted} removed)\n`);
    if (job.cancelled) throw new CancelledError();

    const info = await detectTex();
    const tool = (id: string) => info.tools.find((t) => t.id === id)?.path ?? null;
    const enginePath = tool(req.engine);
    const driver = pickDriver(req.driver, { latexmk: !!tool('latexmk'), tectonic: !!tool('tectonic'), engine: !!enginePath });
    if (!driver) throw new Error(noToolMessage(req, info));

    const stem = jobStem(mainRel);
    // latexmk/raw write outputs in the cwd (build root); tectonic is given --outdir <buildDir>.
    const outBase = path.join(buildDir, stem);
    const run = (cmd: string, args: string[], label?: string) => runStep(job, cmd, args, buildDir, req.env, appendConsole, commands, label);

    if (driver === 'tectonic') {
      if (req.engine !== 'xelatex') appendConsole(`[texit] note: Tectonic is XeTeX-based; the "${req.engine}" engine setting is ignored.\n`);
      if (req.bibTool === 'biber' && !tool('biber')) appendConsole('[texit] warning: biblatex/biber requested but no `biber` binary was found on PATH.\n');
      await run(tool('tectonic')!, tectonicArgs({ mainPath: mainRel, synctex: req.synctex, shellEscape: req.shellEscape, buildDir }));
    } else if (driver === 'latexmk') {
      const hasRc = req.files.some((f) => /(^|\/)\.?latexmkrc$/.test(toPosix(f.path)));
      const noRc = hasRc && !req.shellEscape;
      if (noRc) appendConsole('[texit] note: ignoring latexmkrc files (enable shell-escape to trust this project\'s latexmkrc).\n');
      await run(tool('latexmk')!, latexmkArgs({ engine: req.engine, mainPath: mainRel, synctex: req.synctex, shellEscape: req.shellEscape, bibTool: req.bibTool, noRc }));
    } else {
      await rawBuild(req, mainRel, stem, enginePath!, tool, run, buildDir);
    }

    if (job.cancelled) throw new CancelledError();
    return await collect(base, outBase, started);
  } catch (err) {
    if (err instanceof CancelledError || job.cancelled) {
      if (job.timedOut) {
        appendConsole(`\n[texit] compile timed out after ${Math.round(COMPILE_TIMEOUT_MS / 1000)} s\n`);
        return base('error');
      }
      appendConsole('\n[texit] compile cancelled\n');
      return base('cancelled');
    }
    appendConsole(`\n[texit] ${err instanceof Error ? err.message : String(err)}\n`);
    return base('error');
  } finally {
    clearTimeout(timer);
    jobs.delete(req.jobId);
    if (projectJobs.get(projectKey) === job) projectJobs.delete(projectKey);
    resolveDone();
  }
}

function noToolMessage(req: NativeCompileRequest, info: NativeTexInfo): string {
  const found = info.tools.map((t) => t.id).join(', ') || 'none';
  if (req.driver === 'latexmk') return `latexmk and ${req.engine} are required for the latexmk driver (found: ${found}).`;
  if (req.driver === 'tectonic') return `tectonic was not found on PATH (found: ${found}).`;
  if (req.driver === 'raw') return `${req.engine} was not found on PATH (found: ${found}).`;
  return `No TeX installation found (looked for latexmk, tectonic and ${req.engine}). Install MacTeX/TeX Live/MiKTeX or Tectonic.`;
}

async function rawBuild(
  req: NativeCompileRequest,
  mainRel: string,
  stem: string,
  enginePath: string,
  tool: (id: string) => string | null,
  run: (cmd: string, args: string[], label?: string) => Promise<number | null>,
  buildDir: string,
) {
  const eargs = engineArgs({ mainPath: mainRel, synctex: req.synctex, shellEscape: req.shellEscape });
  await run(enginePath, eargs);
  const aux = await readText(path.join(buildDir, `${stem}.aux`));
  const hasBcf = await exists(path.join(buildDir, `${stem}.bcf`));
  const bib = detectBibNeed({ bibTool: req.bibTool, aux, hasBcf });
  let extraPass = false;
  if (bib) {
    const bibPath = tool(bib);
    if (bibPath) {
      await run(bibPath, [stem]);
      extraPass = true;
    }
  }
  if (await exists(path.join(buildDir, `${stem}.idx`))) {
    const mi = tool('makeindex');
    if (mi) {
      await run(mi, [`${stem}.idx`]);
      extraPass = true;
    }
  }
  let log = await readText(path.join(buildDir, `${stem}.log`));
  let passes = 1;
  while ((extraPass || (log && needsRerun(log))) && passes < 4) {
    extraPass = false;
    await run(enginePath, eargs, `pass ${passes + 1}`);
    passes++;
    log = await readText(path.join(buildDir, `${stem}.log`));
  }
}

async function runStep(
  job: Job,
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string> | undefined,
  out: (s: string) => void,
  commands: string[],
  label?: string,
): Promise<number | null> {
  if (job.cancelled) throw new CancelledError();
  const line = formatCommand(path.basename(cmd), args);
  commands.push(line);
  out(`\n$ ${line}${label ? `   # ${label}` : ''}\n`);
  const child = await spawnTree(cmd, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    extraEnv: { ...env, max_print_line: '10000', error_line: '254', half_error_line: '238', TEXIT: '1' },
  });
  job.child = child;
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (d: string) => out(d));
  child.stderr?.on('data', (d: string) => out(d));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (c) => resolve(c));
  });
  job.child = null;
  if (job.cancelled) throw new CancelledError();
  if (code !== 0) out(`[texit] ${path.basename(cmd)} exited with code ${code}\n`);
  return code;
}

async function collect(
  base: (s: NativeCompileResult['status'], extra?: Partial<NativeCompileResult>) => NativeCompileResult,
  outBase: string,
  started: number,
): Promise<NativeCompileResult> {
  const pdf = await readFresh(`${outBase}.pdf`, started);
  const synctex = (await readFresh(`${outBase}.synctex.gz`, started)) ?? (await readFresh(`${outBase}.synctex`, started));
  const texLog = await readText(`${outBase}.log`);
  const result = base(pdf ? 'success' : 'error', {
    pdf: pdf ?? undefined,
    synctex: synctex ?? undefined,
  });
  // Prefer the engine's .log (what log parsers expect); fall back to the console output.
  // A produced PDF counts as success (like Overleaf): errors are reported through the log.
  if (texLog && texLog.trim()) result.log = texLog;
  return result;
}

async function readFresh(p: string, sinceMs: number): Promise<Uint8Array | null> {
  try {
    const st = await fs.stat(p);
    if (!st.isFile() || st.mtimeMs < sinceMs - 1000) return null;
    return new Uint8Array(await fs.readFile(p));
  } catch {
    return null;
  }
}

async function readText(p: string): Promise<string | null> {
  try {
    return await fs.readFile(p, 'latin1').then((s) => {
      // TeX logs are usually UTF-8, but may contain invalid sequences: try UTF-8 first.
      const buf = Buffer.from(s, 'latin1');
      const utf = buf.toString('utf8');
      return utf.includes('�') ? s : utf;
    });
  } catch {
    return null;
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
