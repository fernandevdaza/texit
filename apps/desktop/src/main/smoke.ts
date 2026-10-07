/**
 * `--smoke` self-test: boots the real main process, loads an app-origin page
 * with the production preload, exercises the bridge end-to-end and prints a
 * JSON report. Exit code 0 = all checks passed.
 */
import fs from 'node:fs';
import { app, BrowserWindow } from 'electron';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { APP_ORIGIN } from './protocol-utils';
import { setVirtualPage } from './protocol';
import { runtime } from './paths';

const PAGE = '/__texit_smoke__';

const PAGE_SCRIPT = String.raw`(async () => {
  const t = window.texit;
  const r = { bridge: {} };
  r.bridge.type = typeof t;
  if (!t) return r;
  r.bridge.keys = Object.keys(t).sort();
  r.bridge.platform = t.platform;
  r.bridge.appVersion = t.appVersion;
  r.bridge.chrome = t.chrome;
  r.bridge.cssTitlebar = getComputedStyle(document.documentElement).getPropertyValue('--texit-titlebar-height');
  r.bridge.nodeLeak = typeof require !== 'undefined' || typeof process !== 'undefined';

  const t0 = performance.now();
  r.tex = await t.tex.detect();
  r.texDetectMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  r.agents = await t.agents.detect();
  r.agentsDetectMs = Math.round(performance.now() - t1);

  // MCP: publish a tool and answer calls from the renderer.
  await t.mcp.setServerTools([{ name: 'echo', description: 'Echo the arguments', inputSchema: { type: 'object', properties: { text: { type: 'string' } } } }]);
  window.__mcpCalls = 0;
  t.mcp.onServerToolCall(async (call) => {
    window.__mcpCalls++;
    await t.mcp.respondToolCall(call.callId, { content: [{ type: 'text', text: 'echo:' + JSON.stringify(call.args) }] });
  });
  r.mcpServer = await t.mcp.startServer();
  r.mcpSnippets = (await t.mcp.clientConfigSnippets()).map((s) => s.id);

  // Filesystem round trip in the project mirror dir.
  const dir = await t.fs.projectMirrorDir('smoke-project');
  const events = [];
  const unwatch = await t.fs.watch(dir, (batch) => events.push(...batch.map((e) => e.type + ':' + e.path + (e.content ? '(' + e.content.byteLength + 'B)' : ''))));
  await t.fs.writeFile(dir + '/main.tex', '\\documentclass{article}');
  await t.fs.mkdir(dir + '/figs');
  await new Promise((res) => setTimeout(res, 1200));
  const tree = await t.fs.readTree(dir);
  unwatch();
  r.fs = { dir, tree: tree.map((f) => f.path + ':' + f.content.byteLength), watchEvents: events };

  // Native compile (tectonic / latexmk / raw — whatever is installed).
  const main = '\\documentclass{article}\n\\begin{document}\nHello from TexIt \\cite{knuth}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n';
  const bib = '@book{knuth, author={Donald E. Knuth}, title={The {\\TeX}book}, publisher={Addison-Wesley}, year={1984}}\n';
  let chunks = 0;
  const c0 = performance.now();
  const res = await t.tex.compile({ jobId: 'smoke-1', projectId: 'smoke-project', files: [{ path: 'main.tex', content: main }, { path: 'refs.bib', content: new TextEncoder().encode(bib) }], mainPath: 'main.tex', engine: 'pdflatex', driver: 'auto', bibTool: 'auto', synctex: true }, () => chunks++);
  r.compile = { status: res.status, pdfBytes: res.pdf ? res.pdf.byteLength : 0, pdfMagic: res.pdf ? new TextDecoder().decode(res.pdf.slice(0, 5)) : null, synctexBytes: res.synctex ? res.synctex.byteLength : 0, logChunks: chunks, logHasCitation: /knuth|bbl|BibTeX/i.test(res.log), command: res.command, buildDir: res.buildDir, durationMs: res.durationMs, wallMs: Math.round(performance.now() - c0) };

  // Cancellation path.
  const p = t.tex.compile({ jobId: 'smoke-2', projectId: 'smoke-cancel', files: [{ path: 'main.tex', content: '\\documentclass{article}\\begin{document}\\loop\\iftrue\\repeat\\end{document}' }], mainPath: 'main.tex', engine: 'pdflatex', driver: 'auto', bibTool: 'none', synctex: false });
  setTimeout(() => t.tex.cancel('smoke-2'), 1500);
  const cancelled = await p;
  r.cancel = { status: cancelled.status, durationMs: cancelled.durationMs };

  // Protocol checks.
  const idx = await fetch('/index.html').catch((e) => ({ status: String(e) }));
  r.protocol = { indexStatus: idx.status, indexType: idx.headers ? idx.headers.get('content-type') : null };
  const spa = await fetch('/project/abc', { headers: { accept: 'text/html' } }).catch((e) => ({ status: String(e) }));
  r.protocol.spaFallbackStatus = spa.status;
  const missing = await fetch('/assets/definitely-missing.js').catch((e) => ({ status: String(e) }));
  r.protocol.missingAssetStatus = missing.status;
  const trav = await fetch('/%2e%2e/%2e%2e/package.json').catch((e) => ({ status: String(e) }));
  r.protocol.traversalStatus = trav.status;
  return r;
})()`;

async function mcpClientCheck(url: string, token: string) {
  const out: Record<string, unknown> = {};
  const unauth = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' });
  out.unauthorizedStatus = unauth.status;
  const client = new Client({ name: 'texit-smoke', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${token}` } } });
  await client.connect(transport);
  out.serverVersion = client.getServerVersion();
  const tools = await client.listTools();
  out.tools = tools.tools.map((t) => t.name);
  const res = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
  out.callResult = (res.content as { type: string; text: string }[])[0]?.text;
  const unknown = await client.callTool({ name: 'nope', arguments: {} });
  out.unknownToolIsError = unknown.isError === true;
  await client.close();
  return out;
}

export async function runSmoke(preload: string): Promise<number> {
  const report: Record<string, unknown> = { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome, webRoot: runtime.webRoot };
  let ok = true;
  setVirtualPage(PAGE, '<!doctype html><html><head><meta charset="utf-8"><title>TexIt smoke</title></head><body>smoke</body></html>');
  const win = new BrowserWindow({
    show: false,
    webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  try {
    await win.loadURL(`${APP_ORIGIN}${PAGE}`);
    const page = (await win.webContents.executeJavaScript(PAGE_SCRIPT)) as Record<string, any>;
    Object.assign(report, page);
    const srv = page.mcpServer as { url?: string; token?: string } | undefined;
    if (srv?.url && srv.token) {
      report.mcpClient = await mcpClientCheck(srv.url, srv.token);
      report.mcpCallsHandledByRenderer = await win.webContents.executeJavaScript('window.__mcpCalls');
    }
    const checks: Record<string, boolean> = {
      bridgeExposed: page.bridge?.type === 'object',
      noNodeInRenderer: page.bridge?.nodeLeak === false,
      texDetected: Array.isArray(page.tex?.tools),
      agentsDetected: Array.isArray(page.agents),
      mcpRoundTrip: (report.mcpClient as any)?.callResult === 'echo:{"text":"hi"}',
      mcpAuthRequired: (report.mcpClient as any)?.unauthorizedStatus === 401,
      fsRoundTrip: Array.isArray(page.fs?.tree) && page.fs.tree.some((f: string) => f.startsWith('main.tex')),
      compileProducedPdf: page.tex?.tools?.length ? page.compile?.pdfMagic === '%PDF-' : true,
      cancelWorks: page.tex?.tools?.length ? page.cancel?.status === 'cancelled' : true,
      traversalBlocked: page.protocol?.traversalStatus !== 200,
    };
    report.checks = checks;
    ok = Object.values(checks).every(Boolean);
  } catch (err) {
    report.error = err instanceof Error ? err.stack ?? err.message : String(err);
    ok = false;
  } finally {
    win.destroy();
  }
  report.ok = ok;
  process.stdout.write(`TEXIT_SMOKE_REPORT ${JSON.stringify(report, null, 2)}\n`);
  try {
    fs.rmSync(app.getPath('userData'), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  return ok ? 0 : 1;
}
