#!/usr/bin/env node
// TexIt reference compile server — remote compile protocol v1 (see README.md).
// Zero dependencies, Node >= 22. Runs latexmk (preferred) or tectonic.
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm, access, constants } from 'node:fs/promises';
import { timingSafeEqual, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PROTOCOL = 1;
const VERSION = '0.1.0';

const env = process.env;
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);

export const config = {
  host: env.HOST ?? '0.0.0.0',
  port: num(env.PORT, 8787),
  token: env.TEXIT_COMPILE_TOKEN || '',
  corsOrigins: (env.TEXIT_CORS_ORIGIN ?? '*').split(',').map((s) => s.trim()).filter(Boolean),
  maxBodyBytes: num(env.TEXIT_MAX_BODY_MB, 50) * 1024 * 1024,
  maxFiles: num(env.TEXIT_MAX_FILES, 2000),
  timeoutMs: num(env.TEXIT_TIMEOUT_S, 90) * 1000,
  maxConcurrent: Math.max(1, num(env.TEXIT_MAX_CONCURRENT, 2)),
  maxQueue: Math.max(0, num(env.TEXIT_MAX_QUEUE, 8)),
  maxLogBytes: num(env.TEXIT_MAX_LOG_KB, 512) * 1024,
  driver: env.TEXIT_DRIVER ?? 'auto', // auto | latexmk | tectonic
  workDir: env.TEXIT_WORK_DIR || path.join(tmpdir(), 'texit-compile'),
  keepJobs: env.TEXIT_KEEP_JOBS === '1',
};

const ENGINES = ['pdflatex', 'xelatex', 'lualatex'];
const LATEXMK_ENGINE_FLAG = { pdflatex: '-pdf', xelatex: '-pdfxe', lualatex: '-pdflua' };
// latexmk rc files are Perl: never let a project provide one (we also pass -norc).
const FORBIDDEN_NAMES = new Set(['latexmkrc', '.latexmkrc']);

// ───────────────────────────── tool detection ─────────────────────────────

async function which(cmd) {
  for (const dir of (env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, cmd);
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function firstLine(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 5000 }, (err, stdout) => resolve(err ? '' : String(stdout).split('\n')[0].trim()));
  });
}

export async function detectTools() {
  const tools = {};
  for (const id of ['latexmk', 'tectonic', ...ENGINES, 'biber', 'bibtex']) tools[id] = await which(id);
  const pdftexVersion = tools.pdflatex ? await firstLine(tools.pdflatex, ['--version']) : '';
  const distribution = /\((TeX Live [^)]*|MiKTeX[^)]*)\)/.exec(pdftexVersion)?.[1];
  const tectonicVersion = tools.tectonic ? await firstLine(tools.tectonic, ['--version']) : '';
  const drivers = [];
  if (tools.latexmk && ENGINES.some((e) => tools[e])) drivers.push('latexmk');
  if (tools.tectonic) drivers.push('tectonic');
  const engines = drivers.includes('tectonic') ? [...ENGINES] : ENGINES.filter((e) => tools[e]);
  return { tools, drivers, engines, distribution: distribution ?? (tectonicVersion || undefined) };
}

// ───────────────────────────── helpers ─────────────────────────────

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function corsHeaders(req) {
  const origin = req.headers.origin;
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (config.corsOrigins.includes('*')) h['Access-Control-Allow-Origin'] = '*';
  else if (origin && config.corsOrigins.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  // Chrome Private Network Access: allow public sites to reach a server on localhost / LAN.
  if (req.headers['access-control-request-private-network'] === 'true') h['Access-Control-Allow-Private-Network'] = 'true';
  return h;
}

function send(req, res, status, body, extra = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  res.end(data);
}

function checkAuth(req) {
  if (!config.token) return;
  const header = req.headers.authorization ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  const digest = (s) => createHash('sha256').update(s).digest();
  if (!m || !timingSafeEqual(digest(m[1].trim()), digest(config.token))) {
    throw new HttpError(401, 'unauthorized', 'Missing or invalid bearer token', { 'WWW-Authenticate': 'Bearer' });
  }
}

async function readBody(req) {
  const declared = Number(req.headers['content-length'] ?? 0);
  if (declared > config.maxBodyBytes) throw new HttpError(413, 'too-large', `Request exceeds ${config.maxBodyBytes} bytes`);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > config.maxBodyBytes) throw new HttpError(413, 'too-large', `Request exceeds ${config.maxBodyBytes} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** POSIX, project-relative, no `..`; null if unsafe. */
export function safeRelPath(p) {
  if (typeof p !== 'string' || !p || p.length > 512 || p.includes('\0')) return null;
  const parts = p.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  if (!parts.length || parts.some((s) => s === '..')) return null;
  return parts.join('/');
}

export function validateRequest(body) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'bad-request', 'Body must be a JSON object');
  if (body.protocol !== PROTOCOL) throw new HttpError(400, 'bad-request', `Unsupported protocol ${body.protocol} (expected ${PROTOCOL})`);
  const mainPath = safeRelPath(body.mainPath);
  if (!mainPath) throw new HttpError(400, 'bad-request', 'Invalid mainPath');
  if (!ENGINES.includes(body.engine)) throw new HttpError(400, 'bad-request', `Invalid engine (expected one of ${ENGINES.join(', ')})`);
  if (!Array.isArray(body.files) || !body.files.length) throw new HttpError(400, 'bad-request', 'files must be a non-empty array');
  if (body.files.length > config.maxFiles) throw new HttpError(413, 'too-large', `Too many files (max ${config.maxFiles})`);
  const files = [];
  for (const f of body.files) {
    const p = safeRelPath(f?.path);
    if (!p) throw new HttpError(400, 'bad-request', `Invalid file path: ${JSON.stringify(f?.path)}`);
    if (typeof f.text === 'string') files.push({ path: p, data: Buffer.from(f.text, 'utf8') });
    else if (typeof f.base64 === 'string') files.push({ path: p, data: Buffer.from(f.base64, 'base64') });
    else throw new HttpError(400, 'bad-request', `File ${p} needs "text" or "base64"`);
  }
  if (!files.some((f) => f.path === mainPath)) throw new HttpError(400, 'bad-request', `Main file ${mainPath} is not among the files`);
  if (!/\.(tex|ltx|latex)$/i.test(mainPath)) throw new HttpError(400, 'bad-request', 'mainPath must be a .tex file');
  const bibTool = ['auto', 'bibtex', 'biber', 'none'].includes(body.bibTool) ? body.bibTool : 'auto';
  return { mainPath, engine: body.engine, bibTool, synctex: body.synctex !== false, draft: body.draft === true, files };
}

// ───────────────────────────── concurrency ─────────────────────────────

let active = 0;
const waiting = [];
function acquire() {
  if (active < config.maxConcurrent) {
    active++;
    return Promise.resolve();
  }
  if (waiting.length >= config.maxQueue) {
    return Promise.reject(new HttpError(503, 'busy', 'Server is busy, retry later', { 'Retry-After': '5' }));
  }
  return new Promise((resolve) => waiting.push(resolve));
}
function release() {
  const next = waiting.shift();
  if (next) next();
  else active--;
}

// ───────────────────────────── compile ─────────────────────────────

const running = new Set();

function truncate(s, max) {
  return s.length > max ? `${s.slice(0, max / 4)}\n\n[… ${s.length - max} bytes truncated …]\n\n${s.slice(-(max * 3) / 4)}` : s;
}

async function readIf(p, enc) {
  try {
    return await readFile(p, enc);
  } catch {
    return null;
  }
}

function buildCommand(tools, job, mainAbs) {
  const driver = config.driver === 'auto' ? (tools.drivers.includes('latexmk') && tools.tools[job.engine] ? 'latexmk' : tools.drivers[0]) : config.driver;
  if (driver === 'latexmk' && tools.tools.latexmk) {
    const args = ['-norc', LATEXMK_ENGINE_FLAG[job.engine], '-cd', '-interaction=nonstopmode', '-halt-on-error', '-file-line-error', '-no-shell-escape'];
    if (job.synctex) args.push('-synctex=1');
    if (job.bibTool === 'none') args.push('-bibtex-');
    if (job.draft) args.push('-e', '$max_repeat=1');
    args.push(mainAbs);
    return { driver, cmd: tools.tools.latexmk, args, cwd: path.dirname(mainAbs) };
  }
  if (driver === 'tectonic' && tools.tools.tectonic) {
    // Tectonic is XeTeX-based: the engine choice is ignored. --untrusted disables shell escape & co.
    const args = ['--untrusted', '--keep-logs', '--keep-intermediates', '--chatter', 'minimal'];
    if (job.synctex) args.push('--synctex');
    if (job.draft) args.push('--reruns', '0');
    args.push(path.basename(mainAbs));
    return { driver, cmd: tools.tools.tectonic, args, cwd: path.dirname(mainAbs) };
  }
  throw new HttpError(500, 'internal', `No usable TeX driver (configured: ${config.driver})`);
}

export async function compile(tools, job, signal) {
  const t0 = Date.now();
  await mkdir(config.workDir, { recursive: true });
  const jobDir = await mkdtemp(path.join(config.workDir, 'job-'));
  const skipped = [];
  try {
    for (const f of job.files) {
      if (FORBIDDEN_NAMES.has(path.posix.basename(f.path))) {
        skipped.push(f.path);
        continue;
      }
      const abs = path.join(jobDir, f.path);
      if (!abs.startsWith(jobDir + path.sep)) throw new HttpError(400, 'bad-request', `Invalid file path: ${f.path}`);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, f.data);
    }
    const mainAbs = path.join(jobDir, job.mainPath);
    const { driver, cmd, args, cwd } = buildCommand(tools, job, mainAbs);
    // Persistent, shared caches (luaotfload font cache, tectonic bundle cache) — never the job dir.
    const texmfVar = path.join(config.workDir, 'texmf-var');
    const home = path.join(config.workDir, 'home');
    await Promise.all([mkdir(texmfVar, { recursive: true }), mkdir(home, { recursive: true })]);

    const childEnv = {
      PATH: env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
      HOME: home,
      LANG: 'C.UTF-8',
      TEXMFVAR: texmfVar,
      ...(env.TECTONIC_CACHE_DIR ? { TECTONIC_CACHE_DIR: env.TECTONIC_CACHE_DIR } : {}),
      TEXMFOUTPUT: jobDir,
      shell_escape: 'f',
      openout_any: 'p',
      // Paranoid reading blocks absolute paths and `..`; projects whose main file lives in a
      // sub-directory legitimately use `../`, so they get "restricted" (no dot files) instead.
      openin_any: job.mainPath.includes('/') ? 'r' : 'p',
      SOURCE_DATE_EPOCH: String(Math.floor(Date.now() / 1000)),
    };

    let output = '';
    let timedOut = false;
    const child = spawn(cmd, args, { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    running.add(child);
    const kill = () => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    };
    const onData = (d) => {
      if (output.length < config.maxLogBytes * 2) output += d.toString('utf8');
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, config.timeoutMs);
    signal?.addEventListener('abort', kill, { once: true });
    const exitCode = await new Promise((resolve) => {
      child.on('error', (err) => {
        output += `\n${err.message}\n`;
        resolve(-1);
      });
      child.on('close', (code) => resolve(code ?? -1));
    });
    clearTimeout(timer);
    signal?.removeEventListener('abort', kill);
    running.delete(child);

    const stem = mainAbs.replace(/\.[^./]+$/, '');
    const pdf = exitCode === 0 ? await readIf(`${stem}.pdf`) : null;
    const synctex = pdf && job.synctex ? await readIf(`${stem}.synctex.gz`) : null;
    const texLog = (await readIf(`${stem}.log`, 'utf8')) ?? '';
    const blg = (await readIf(`${stem}.blg`, 'utf8')) ?? '';
    const parts = [texLog.trimEnd()];
    if (blg.trim()) parts.push(`${'='.repeat(72)}\n[bibliography] ${path.basename(stem)}.blg\n${'='.repeat(72)}\n${blg.trim()}`);
    parts.push(`${'='.repeat(72)}\n[${driver}] ${path.basename(cmd)} ${args.map((a) => (a === mainAbs ? job.mainPath : a)).join(' ')} (exit code ${exitCode})\n${'='.repeat(72)}\n${output.trim()}`);
    if (skipped.length) parts.push(`[compile-server] Ignored ${skipped.join(', ')} (latexmk rc files are not allowed).`);
    if (timedOut) parts.push(`[compile-server] Timed out after ${config.timeoutMs / 1000} s — the process was killed.`);
    const log = truncate(parts.filter(Boolean).join('\n\n') + '\n', config.maxLogBytes);
    const success = exitCode === 0 && !!pdf && pdf.length > 0 && !timedOut;
    return {
      status: success ? 'success' : 'error',
      pdfBase64: success ? pdf.toString('base64') : undefined,
      synctexBase64: success && synctex ? synctex.toString('base64') : undefined,
      log,
      durationMs: Date.now() - t0,
      buildDir: jobDir,
      driver,
    };
  } finally {
    if (!config.keepJobs) await rm(jobDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ───────────────────────────── server ─────────────────────────────

export function createCompileServer(tools) {
  return createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    let status = 500;
    try {
      if (req.method === 'OPTIONS') {
        status = 204;
        res.writeHead(204, corsHeaders(req));
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/healthz') {
        status = 200;
        return send(req, res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/v1/info') {
        checkAuth(req);
        status = 200;
        return send(req, res, 200, {
          protocol: PROTOCOL,
          name: 'texit-compile-server',
          version: VERSION,
          engines: tools.engines,
          drivers: tools.drivers,
          distribution: tools.distribution,
          auth: config.token ? 'bearer' : 'none',
          limits: { maxRequestBytes: config.maxBodyBytes, timeoutMs: config.timeoutMs, maxFiles: config.maxFiles },
        });
      }
      if (req.method === 'POST' && url.pathname === '/v1/compile') {
        checkAuth(req);
        if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
          throw new HttpError(400, 'bad-request', 'Content-Type must be application/json');
        }
        const raw = await readBody(req);
        let body;
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch {
          throw new HttpError(400, 'bad-request', 'Invalid JSON');
        }
        const job = validateRequest(body);
        await acquire();
        const ctrl = new AbortController();
        const onClose = () => {
          if (!res.writableEnded) ctrl.abort();
        };
        res.on('close', onClose);
        try {
          const result = await compile(tools, job, ctrl.signal);
          status = 200;
          if (!ctrl.signal.aborted) send(req, res, 200, result);
        } finally {
          res.off('close', onClose);
          release();
        }
        return;
      }
      throw new HttpError(404, 'not-found', `No route for ${req.method} ${url.pathname}`);
    } catch (err) {
      const e = err instanceof HttpError ? err : new HttpError(500, 'internal', err instanceof Error ? err.message : String(err));
      status = e.status;
      if (!res.headersSent) send(req, res, e.status, { error: { code: e.code, message: e.message } }, e.headers);
      else res.end();
    } finally {
      if (url.pathname !== '/healthz') console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${status} ${Date.now() - started}ms`);
    }
  });
}

async function main() {
  const tools = await detectTools();
  if (!tools.drivers.length) {
    console.error('No TeX driver found: install latexmk + TeX Live, or tectonic.');
    process.exit(1);
  }
  const server = createCompileServer(tools);
  server.requestTimeout = config.timeoutMs + 60_000;
  server.listen(config.port, config.host, () => {
    console.log(
      `texit-compile-server ${VERSION} on http://${config.host}:${config.port} — drivers: ${tools.drivers.join(', ')}; engines: ${tools.engines.join(', ')}` +
        `${tools.distribution ? `; ${tools.distribution}` : ''}; auth: ${config.token ? 'bearer' : 'none'}; CORS: ${config.corsOrigins.join(', ')}`,
    );
  });
  const shutdown = () => {
    server.close();
    for (const child of running) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* ignore */
      }
    }
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

if (path.basename(process.argv[1] ?? '') === 'server.mjs') {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
