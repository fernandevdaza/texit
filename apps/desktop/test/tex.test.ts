import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { afterAll, describe, expect, it } from 'vitest';
import { detectBibNeed, engineArgs, formatCommand, jobStem, latexmkArgs, needsRerun, pickDriver, tectonicArgs } from '../src/main/tex/args';
import { guessDistribution, parseToolVersion } from '../src/main/tex/detect';
import { MANIFEST_NAME, safeRelative, syncBuildDir } from '../src/main/tex/sync';
import { compileNative, sanitizeProjectId } from '../src/main/tex/compile';

describe('latexmk args', () => {
  it('pdflatex with synctex, nonstop, file-line-error and -f', () => {
    expect(latexmkArgs({ engine: 'pdflatex', mainPath: 'main.tex', synctex: true, bibTool: 'auto' })).toEqual([
      '-pdf', '-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-f', '-no-shell-escape', 'main.tex',
    ]);
  });
  it('xelatex / lualatex, bib control, shell escape and -norc', () => {
    expect(latexmkArgs({ engine: 'xelatex', mainPath: 'src\\thesis.tex', synctex: false, bibTool: 'none', shellEscape: true, noRc: true })).toEqual([
      '-norc', '-xelatex', '-interaction=nonstopmode', '-file-line-error', '-f', '-bibtex-', '-shell-escape', 'src/thesis.tex',
    ]);
    expect(latexmkArgs({ engine: 'lualatex', mainPath: 'a.tex', synctex: true, bibTool: 'biber' })).toContain('-lualatex');
    expect(latexmkArgs({ engine: 'lualatex', mainPath: 'a.tex', synctex: true, bibTool: 'biber' })).toContain('-bibtex');
  });
});

describe('tectonic args', () => {
  it('V2 compile with logs, intermediates, synctex and continue-on-errors', () => {
    expect(tectonicArgs({ mainPath: 'main.tex', synctex: true, buildDir: '/b/p' })).toEqual([
      '-X', 'compile', 'main.tex', '--keep-logs', '--keep-intermediates', '--outdir', '/b/p', '--synctex', '-Z', 'continue-on-errors',
    ]);
  });
  it('adds the build root to the search path for mains in subfolders, and shell escape', () => {
    const a = tectonicArgs({ mainPath: 'tex/main.tex', synctex: false, shellEscape: true, buildDir: '/b/p' });
    expect(a).toContain('search-path=/b/p');
    expect(a).toContain('shell-escape');
    expect(a).toContain('shell-escape-cwd=/b/p');
    expect(a).not.toContain('--synctex');
  });
});

describe('raw engine helpers', () => {
  it('engine args', () => {
    expect(engineArgs({ mainPath: 'main.tex', synctex: true })).toEqual(['-synctex=1', '-interaction=nonstopmode', '-file-line-error', '-no-shell-escape', 'main.tex']);
  });
  it('job stems', () => {
    expect(jobStem('chapters/main.tex')).toBe('main');
    expect(jobStem('a.b.tex')).toBe('a.b');
    expect(jobStem('README')).toBe('README');
  });
  it('bibliography detection', () => {
    const aux = '\\citation{knuth}\n\\bibdata{refs}\n';
    expect(detectBibNeed({ bibTool: 'auto', aux, hasBcf: false })).toBe('bibtex');
    expect(detectBibNeed({ bibTool: 'auto', aux: '', hasBcf: true })).toBe('biber');
    expect(detectBibNeed({ bibTool: 'none', aux, hasBcf: true })).toBeNull();
    expect(detectBibNeed({ bibTool: 'biber', aux, hasBcf: false })).toBeNull();
    expect(detectBibNeed({ bibTool: 'auto', aux: '\\relax', hasBcf: false })).toBeNull();
  });
  it('rerun detection', () => {
    expect(needsRerun('LaTeX Warning: Label(s) may have changed. Rerun to get cross-references right.')).toBe(true);
    expect(needsRerun('Package rerunfilecheck Warning: File `main.out\' has changed.\n(rerunfilecheck) Rerun to get outlines right')).toBe(true);
    expect(needsRerun('Output written on main.pdf (1 page).')).toBe(false);
  });
  it('driver selection', () => {
    expect(pickDriver('auto', { latexmk: true, tectonic: true, engine: true })).toBe('latexmk');
    expect(pickDriver('auto', { latexmk: true, tectonic: true, engine: false })).toBe('tectonic');
    expect(pickDriver('auto', { latexmk: false, tectonic: false, engine: true })).toBe('raw');
    expect(pickDriver('auto', { latexmk: false, tectonic: false, engine: false })).toBeNull();
    expect(pickDriver('latexmk', { latexmk: true, tectonic: true, engine: false })).toBeNull();
    expect(pickDriver('tectonic', { latexmk: true, tectonic: true, engine: true })).toBe('tectonic');
  });
  it('formats commands for display', () => {
    expect(formatCommand('latexmk', ['-pdf', 'my file.tex', "it's"])).toBe(`latexmk -pdf 'my file.tex' 'it'\\''s'`);
  });
});

describe('detection helpers', () => {
  it('parses versions', () => {
    expect(parseToolVersion('tectonic', 'Tectonic 0.17.0')).toBe('0.17.0');
    expect(parseToolVersion('latexmk', '\nLatexmk, John Collins, 7 Jan. 2024. Version 4.83\n')).toBe('4.83');
    expect(parseToolVersion('pdflatex', 'pdfTeX 3.141592653-2.6-1.40.26 (TeX Live 2024)\nkpathsea version 6.4.0')).toBe('pdfTeX 3.141592653-2.6-1.40.26 (TeX Live 2024)');
    expect(parseToolVersion('biber', 'biber version: 2.19')).toBe('2.19');
    expect(parseToolVersion('synctex', 'This is SyncTeX command line utility, version 1.5')).toBe('1.5');
    expect(parseToolVersion('x', '')).toBeUndefined();
  });
  it('guesses the distribution', () => {
    expect(guessDistribution([{ id: 'pdflatex', path: '/Library/TeX/texbin/pdflatex', version: 'pdfTeX 3.14 (TeX Live 2025)' }])).toBe('MacTeX (TeX Live 2025)');
    expect(guessDistribution([{ id: 'pdflatex', path: 'C:\\Users\\me\\AppData\\Local\\Programs\\MiKTeX\\miktex\\bin\\x64\\pdflatex.exe', version: 'MiKTeX-pdfTeX 4.19 (MiKTeX 24.1)' }])).toBe('MiKTeX');
    expect(guessDistribution([{ id: 'pdflatex', path: '/home/me/.TinyTeX/bin/x86_64-linux/pdflatex', version: 'pdfTeX (TeX Live 2025)' }])).toBe('TinyTeX (TeX Live 2025)');
    expect(guessDistribution([{ id: 'tectonic', path: '/opt/homebrew/bin/tectonic', version: '0.17.0' }])).toBe('Tectonic');
    expect(guessDistribution([])).toBeUndefined();
  });
});

describe('build dir sync', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'texit-sync-'));
    dirs.push(d);
    return d;
  };
  afterAll(() => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

  it('rejects unsafe paths', () => {
    expect(safeRelative('a/../../etc/passwd')).toBeNull();
    expect(safeRelative('/etc/passwd')).toBeNull();
    expect(safeRelative('C:\\Windows\\x')).toBeNull();
    expect(safeRelative('a\0b')).toBeNull();
    expect(safeRelative('./chap/./intro.tex')).toBe('chap/intro.tex');
    expect(safeRelative('chap\\intro.tex')).toBe('chap/intro.tex');
  });

  it('writes changed files, keeps unchanged mtimes and aux files, deletes removed sources', async () => {
    const dir = tmp();
    const s1 = await syncBuildDir(dir, [
      { path: 'main.tex', content: 'A' },
      { path: 'chap/one.tex', content: new Uint8Array([66]) },
      { path: '../escape.tex', content: 'x' },
    ]);
    expect(s1).toEqual({ written: 2, unchanged: 0, deleted: 0 });
    expect(fs.existsSync(path.join(dir, '..', 'escape.tex'))).toBe(false);
    fs.writeFileSync(path.join(dir, 'main.aux'), 'aux');
    const mtime = fs.statSync(path.join(dir, 'main.tex')).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    const s2 = await syncBuildDir(dir, [{ path: 'main.tex', content: 'A' }]);
    expect(s2).toEqual({ written: 0, unchanged: 1, deleted: 1 });
    expect(fs.statSync(path.join(dir, 'main.tex')).mtimeMs).toBe(mtime);
    expect(fs.existsSync(path.join(dir, 'chap'))).toBe(false); // empty dir pruned
    expect(fs.readFileSync(path.join(dir, 'main.aux'), 'utf8')).toBe('aux');
    expect(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST_NAME), 'utf8')).files).toHaveProperty('main.tex');
    const s3 = await syncBuildDir(dir, [{ path: 'main.tex', content: 'B' }]);
    expect(s3.written).toBe(1);
  });

  it('sanitises project ids', () => {
    expect(sanitizeProjectId('abc-DEF_1')).toBe('abc-DEF_1');
    expect(sanitizeProjectId('../x')).toBe('___x');
    expect(() => sanitizeProjectId('..')).toThrow();
  });
});

const tectonic = (() => {
  for (const p of ['/opt/homebrew/bin/tectonic', '/usr/local/bin/tectonic', '/usr/bin/tectonic']) if (fs.existsSync(p)) return p;
  try {
    return execFileSync('which', ['tectonic'], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
})();

describe.skipIf(!tectonic)('native compile with tectonic (integration)', () => {
  const buildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'texit-builds-'));
  afterAll(() => fs.rmSync(buildRoot, { recursive: true, force: true }));

  it('compiles a document with a bibliography and SyncTeX', async () => {
    const logs: string[] = [];
    const res = await compileNative(
      {
        jobId: 'j1',
        projectId: 'p1',
        mainPath: 'main.tex',
        engine: 'xelatex',
        driver: 'tectonic',
        bibTool: 'auto',
        synctex: true,
        files: [
          { path: 'main.tex', content: '\\documentclass{article}\n\\begin{document}\nHi \\cite{k}.\n\\input{sec/a}\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n' },
          { path: 'sec/a.tex', content: 'Section text.' },
          { path: 'refs.bib', content: '@book{k, author={D. Knuth}, title={The TeXbook}, publisher={AW}, year={1984}}' },
        ],
      },
      { buildRoot, onLog: (s) => logs.push(s) },
    );
    expect(res.status).toBe('success');
    expect(Buffer.from(res.pdf!.slice(0, 5)).toString()).toBe('%PDF-');
    expect(res.synctex?.byteLength).toBeGreaterThan(0);
    expect(res.log).toMatch(/main\.bbl|bibdata|Knuth|plain/i);
    expect(res.command).toContain('tectonic -X compile main.tex');
    expect(res.buildDir).toBe(path.join(buildRoot, 'p1'));
    expect(logs.join('')).toContain('$ tectonic');
  }, 300_000);

  it('reports errors without a stale PDF and supports a missing main file', async () => {
    const res = await compileNative(
      { jobId: 'j2', projectId: 'p2', mainPath: 'nope.tex', engine: 'xelatex', driver: 'auto', bibTool: 'none', synctex: false, files: [{ path: 'main.tex', content: 'x' }] },
      { buildRoot },
    );
    expect(res.status).toBe('error');
    expect(res.pdf).toBeUndefined();
    expect(res.log).toMatch(/Main file not found/);
  });
});
