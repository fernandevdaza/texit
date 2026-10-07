// Hermetic tests (no TeX needed). Set TEXIT_TEST_COMPILE=1 to also run a real compile with the detected driver.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.TEXIT_COMPILE_TOKEN = 'secret-token';
process.env.TEXIT_CORS_ORIGIN = 'https://app.example,http://localhost:5173';
process.env.TEXIT_MAX_BODY_MB = '1';
process.env.TEXIT_WORK_DIR = path.join(tmpdir(), `texit-compile-test-${process.pid}`);

const { createCompileServer, detectTools, safeRelPath, validateRequest } = await import('../server.mjs');

const fakeTools = { tools: {}, drivers: ['latexmk'], engines: ['pdflatex', 'xelatex', 'lualatex'], distribution: 'TeX Live 2099' };
let server;
let base;

before(async () => {
  server = createCompileServer(fakeTools);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const auth = { Authorization: 'Bearer secret-token' };

test('safeRelPath rejects traversal and normalises', () => {
  assert.equal(safeRelPath('a/./b//c.tex'), 'a/b/c.tex');
  assert.equal(safeRelPath('/abs/x.tex'), 'abs/x.tex');
  assert.equal(safeRelPath('a\\b.tex'), 'a/b.tex');
  assert.equal(safeRelPath('../etc/passwd'), null);
  assert.equal(safeRelPath('a/../../x'), null);
  assert.equal(safeRelPath(''), null);
  assert.equal(safeRelPath('a\0b'), null);
});

test('validateRequest checks protocol, engine, files and main file', () => {
  const ok = { protocol: 1, mainPath: 'main.tex', engine: 'pdflatex', bibTool: 'auto', synctex: true, files: [{ path: 'main.tex', text: 'x' }, { path: 'img.png', base64: 'AAEC' }] };
  const job = validateRequest(ok);
  assert.equal(job.files[1].data.length, 3);
  assert.throws(() => validateRequest({ ...ok, protocol: 2 }), /protocol/);
  assert.throws(() => validateRequest({ ...ok, engine: 'context' }), /engine/);
  assert.throws(() => validateRequest({ ...ok, mainPath: 'other.tex' }), /not among/);
  assert.throws(() => validateRequest({ ...ok, files: [{ path: '../x.tex', text: '' }] }), /Invalid file path/);
  assert.throws(() => validateRequest({ ...ok, files: [{ path: 'main.tex' }] }), /needs "text" or "base64"/);
});

test('GET /v1/info requires the bearer token and sends CORS headers', async () => {
  const unauth = await fetch(`${base}/v1/info`, { headers: { Origin: 'https://app.example' } });
  assert.equal(unauth.status, 401);
  assert.equal(unauth.headers.get('access-control-allow-origin'), 'https://app.example');
  assert.equal((await unauth.json()).error.code, 'unauthorized');

  const res = await fetch(`${base}/v1/info`, { headers: { ...auth, Origin: 'https://evil.example' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  const info = await res.json();
  assert.equal(info.protocol, 1);
  assert.equal(info.auth, 'bearer');
  assert.deepEqual(info.drivers, ['latexmk']);
});

test('OPTIONS preflight answers 204 with allowed headers', async () => {
  const res = await fetch(`${base}/v1/compile`, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' },
  });
  assert.equal(res.status, 204);
  assert.match(res.headers.get('access-control-allow-headers') ?? '', /Authorization/);
  assert.equal(res.headers.get('access-control-allow-private-network'), 'true');
});

test('POST /v1/compile rejects bad bodies and oversized requests', async () => {
  const bad = await fetch(`${base}/v1/compile`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(bad.status, 400);
  const big = await fetch(`${base}/v1/compile`, {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ protocol: 1, files: [{ path: 'a.tex', text: 'x'.repeat(2 * 1024 * 1024) }] }),
  });
  assert.equal(big.status, 413);
  assert.equal((await big.json()).error.code, 'too-large');
});

test('real compile with the installed driver', { skip: process.env.TEXIT_TEST_COMPILE !== '1' }, async () => {
  const tools = await detectTools();
  assert.ok(tools.drivers.length, 'no TeX driver installed');
  const real = createCompileServer(tools);
  await new Promise((r) => real.listen(0, '127.0.0.1', r));
  try {
    const url = `http://127.0.0.1:${real.address().port}/v1/compile`;
    const body = {
      protocol: 1,
      mainPath: 'src/main.tex',
      engine: 'pdflatex',
      bibTool: 'auto',
      synctex: true,
      files: [
        { path: 'src/main.tex', text: '\\documentclass{article}\\begin{document}Hello \\input{../part}\\end{document}\n' },
        { path: 'part.tex', text: 'from a parent directory.\n' },
        { path: 'src/latexmkrc', text: 'system("touch /tmp/pwned");\n' },
      ],
    };
    const res = await fetch(url, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const json = await res.json();
    assert.equal(res.status, 200, JSON.stringify(json));
    assert.equal(json.status, 'success', json.log);
    assert.equal(Buffer.from(json.pdfBase64, 'base64').subarray(0, 5).toString(), '%PDF-');
    assert.ok(json.synctexBase64);
    assert.match(json.log, /latexmk rc files are not allowed/);

    const err = await fetch(url, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, files: [{ path: 'src/main.tex', text: '\\documentclass{article}\\begin{document}\\undefinedmacro\\end{document}\n' }] }),
    });
    const errJson = await err.json();
    assert.equal(errJson.status, 'error');
    assert.match(errJson.log, /Undefined control sequence/);
  } finally {
    real.close();
  }
});
