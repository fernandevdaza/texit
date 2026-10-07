/// <reference types="vite/client" />
/* Browser harness: compiles sample projects with BusyTexBackend / CompileService and reports timings. */
import type { ProjectFile, TexEngine } from '@texit/core';
import { BusyTexBackend, CompileService, RemoteBackend, type CompileServiceResult } from '../src';

const $ = (id: string) => document.getElementById(id)!;
const logEl = $('log');
const statusEl = $('status');

const backend = new BusyTexBackend({ basePath: `${import.meta.env.BASE_URL}busytex/` });
const service = new CompileService({ backends: [backend] });
service.onStatus((s) => {
  statusEl.textContent = `${s.state}${s.message ? ` — ${s.message}` : ''}${s.progress !== undefined ? ` (${Math.round(s.progress * 100)}%)` : ''}${s.queued ? ' [queued]' : ''}`;
});

async function png(): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = 240;
  c.height = 120;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0b7';
  g.fillRect(0, 0, 240, 120);
  g.fillStyle = '#fff';
  g.font = 'bold 36px sans-serif';
  g.fillText('TexIt', 60, 72);
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

const HELLO = String.raw`\documentclass{article}
\begin{document}
Hello, \LaTeX{} world! $e^{i\pi}+1=0$
\end{document}
`;

const cases: Record<string, () => Promise<{ files: ProjectFile[]; mainPath?: string; engine?: TexEngine | 'auto' }>> = {
  hello: async () => ({ files: [{ path: 'main.tex', content: HELLO }] }),
  'amsmath-tikz-biblatex': async () => ({
    files: [
      {
        path: 'main.tex',
        content: String.raw`\documentclass{article}
\usepackage{amsmath,amssymb}
\usepackage{tikz}
\usetikzlibrary{arrows.meta}
\usepackage[backend=biber,style=numeric]{biblatex}
\addbibresource{refs.bib}
\begin{document}
\section{Intro}\label{sec:intro}
As shown by Knuth~\cite{knuth84}, see Section~\ref{sec:intro}.
\begin{align}
  \int_0^1 x^2\,dx &= \frac{1}{3} \label{eq:1}
\end{align}
\begin{tikzpicture}
  \draw[-{Stealth}] (0,0) -- (2,1) node[right] {tikz};
  \fill[blue!30] (3,0) circle (0.5);
\end{tikzpicture}
\printbibliography
\end{document}
`,
      },
      {
        path: 'refs.bib',
        content: `@book{knuth84, author = {Donald E. Knuth}, title = {The {\\TeX}book}, publisher = {Addison-Wesley}, year = {1984}}\n`,
      },
    ],
  }),
  'xelatex-fontspec': async () => ({
    files: [
      {
        path: 'main.tex',
        content: String.raw`\documentclass{article}
\usepackage{fontspec}
\setmainfont{TeX Gyre Pagella}
\begin{document}
Ünïcödé text with fontspec: “quotes”, ligatures ffi — and Ελληνικά?
\end{document}
`,
      },
    ],
  }),
  'multifile-image': async () => {
    const image = await png();
    return {
      mainPath: 'src/main.tex',
      files: [
        {
          path: 'src/main.tex',
          content: String.raw`\documentclass{report}
\usepackage{graphicx}
\begin{document}
\input{chapters/one}
\include{chapters/two}
\begin{figure}[h]\centering
\includegraphics[width=4cm]{../figures/logo.png}
\caption{A PNG from the project}\label{fig:logo}
\end{figure}
See Figure~\ref{fig:logo} and \cite{lamport94}.
\bibliographystyle{plain}
\bibliography{../refs}
\end{document}
`,
        },
        { path: 'src/chapters/one.tex', content: '\\chapter{One}\nFirst chapter.\n' },
        { path: 'src/chapters/two.tex', content: '\\chapter{Two}\nSecond chapter.\n' },
        { path: 'figures/logo.png', content: image },
        { path: 'refs.bib', content: '@book{lamport94, author={Leslie Lamport}, title={LaTeX: A Document Preparation System}, publisher={Addison-Wesley}, year={1994}}\n' },
      ],
    };
  },
  lualatex: async () => ({
    files: [{ path: 'main.tex', content: '% !TEX program = lualatex\n' + HELLO.replace('Hello', '\\directlua{tex.print("Lua says hi")} Hello') }],
  }),
  'error-missing-brace': async () => ({
    files: [{ path: 'main.tex', content: '\\documentclass{article}\n\\begin{document}\n\\textbf{oops\n\\end{document}\n' }],
  }),
};

const results: Record<string, unknown>[] = [];
(window as unknown as { harnessResults: unknown }).harnessResults = results;

function row(name: string, r: CompileServiceResult, note = '') {
  const tr = document.createElement('tr');
  for (const v of [name, r.backendId, r.engine, r.status, r.timing.totalMs, r.pdf?.byteLength ?? 0, r.synctex?.byteLength ?? 0, note]) {
    const td = document.createElement('td');
    td.textContent = String(v);
    tr.appendChild(td);
  }
  $('results').appendChild(tr);
}

async function run(name: string, extra: { draft?: boolean } = {}): Promise<Record<string, unknown>> {
  const c = await cases[name]();
  let output = '';
  const r = await service.compile({
    projectId: `harness-${name}`,
    files: c.files,
    mainPath: c.mainPath,
    engine: c.engine ?? 'auto',
    draft: extra.draft,
    onLog: (chunk) => (output += chunk),
  });
  logEl.textContent = output + '\n──── log ────\n' + r.log.slice(-6000);
  if (r.pdf) ($('pdf') as HTMLIFrameElement).src = URL.createObjectURL(new Blob([r.pdf as BlobPart], { type: 'application/pdf' }));
  const summary = {
    name,
    status: r.status,
    engine: r.engine,
    totalMs: r.timing.totalMs,
    prepareMs: r.timing.prepareMs,
    compileMs: r.timing.compileMs,
    pdfBytes: r.pdf?.byteLength ?? 0,
    pdfMagic: r.pdf ? new TextDecoder().decode(r.pdf.slice(0, 5)) : '',
    synctexBytes: r.synctex?.byteLength ?? 0,
    dataPackage: backend.loadedDataPackage,
    diagnostics: r.diagnostics.length,
    output: output.split('\n').filter((l) => l.startsWith('[')).join('\n'),
    logTail: r.status === 'success' ? undefined : r.log.slice(-1500),
  };
  results.push(summary);
  row(name, r, backend.loadedDataPackage ?? '');
  return summary;
}

/** Abort test: start a compile, abort after `ms`, then compile again (worker must be re-created). */
async function abortTest(ms = 300): Promise<Record<string, unknown>> {
  const c = await cases['amsmath-tikz-biblatex']();
  const ctrl = new AbortController();
  const t0 = performance.now();
  const p = backend.compile({ files: c.files, mainPath: 'main.tex', engine: 'pdflatex', bibTool: 'auto', synctex: true, projectId: 'abort', signal: ctrl.signal });
  setTimeout(() => ctrl.abort(), ms);
  const r = await p;
  const abortedAfter = Math.round(performance.now() - t0);
  const again = await run('hello');
  return { abortedStatus: r.status, abortedAfter, againStatus: again.status, againMs: again.totalMs };
}

/** Coalescing test: 5 rapid requests → 2 runs; all callers get a result. */
async function coalesceTest(): Promise<Record<string, unknown>> {
  let runs = 0;
  const sub = service.onResult(() => runs++);
  const c = await cases.hello();
  const ps = [1, 2, 3, 4, 5].map((i) =>
    service.compile({ projectId: 'coalesce', files: [{ path: 'main.tex', content: c.files[0].content.toString().replace('world', `world ${i}`) }] }),
  );
  const rs = await Promise.all(ps);
  sub.dispose();
  return { runs, statuses: rs.map((r) => r.status), sameResultForCoalesced: rs[1] === rs[4] };
}

/** texlive.net CORS probe (expected to fail: its CGI redirect lacks Access-Control-Allow-Origin). */
async function texliveNetProbe(): Promise<string> {
  const fd = new FormData();
  fd.append('filecontents[]', HELLO);
  fd.append('filename[]', 'document.tex');
  fd.append('engine', 'pdflatex');
  fd.append('return', 'pdf');
  try {
    const res = await fetch('https://texlive.net/cgi-bin/latexcgi', { method: 'POST', body: fd });
    return `ok ${res.status} ${res.headers.get('content-type')}`;
  } catch (e) {
    return `failed: ${(e as Error).message}`;
  }
}

Object.assign(window, { harness: { backend, service, run, abortTest, coalesceTest, texliveNetProbe, cases, RemoteBackend } });

for (const name of Object.keys(cases)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => void run(name);
  $('buttons').appendChild(b);
}
statusEl.textContent = `ready — crossOriginIsolated=${String(window.crossOriginIsolated)}`;
