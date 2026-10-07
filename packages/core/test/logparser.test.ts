import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseLatexLog, resolveProjectPath, unwrapLogLines } from '../src/logparser';
import type { Diagnostic } from '../src/types';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const brief = (ds: Diagnostic[]) => ds.map((d) => [d.severity, d.code, d.file ?? null, d.line ?? null]);

describe('resolveProjectPath', () => {
  const paths = ['main.tex', 'chapters/intro.tex', 'sub/main.tex', 'refs.bib', 'figures/plot.pdf'];
  it('matches relative, absolute and Windows paths by longest suffix', () => {
    expect(resolveProjectPath('./main.tex', paths)).toBe('main.tex');
    expect(resolveProjectPath('main.tex', paths)).toBe('main.tex');
    expect(resolveProjectPath('/tmp/build/x1/main.tex', paths)).toBe('main.tex');
    expect(resolveProjectPath('/home/web_user/project/./sub/main.tex', paths)).toBe('sub/main.tex');
    expect(resolveProjectPath('/tmp/x/./chapters/../main.tex', paths)).toBe('main.tex');
    expect(resolveProjectPath('C:\\Users\\me\\proj\\chapters\\intro.tex', paths)).toBe('chapters/intro.tex');
    expect(resolveProjectPath('"./chapters/intro.tex"', paths)).toBe('chapters/intro.tex');
    expect(resolveProjectPath('chapters/intro', paths)).toBe('chapters/intro.tex');
    expect(resolveProjectPath('./Chapters/Intro.tex', paths)).toBe('chapters/intro.tex');
  });
  it('does not match unrelated or distribution files', () => {
    expect(resolveProjectPath('/usr/local/texlive/2023/texmf-dist/tex/latex/base/article.cls', ['article.cls'])).toBeUndefined();
    expect(resolveProjectPath('/x/ymain.tex', paths)).toBeUndefined();
    expect(resolveProjectPath('other.tex', paths)).toBeUndefined();
    expect(resolveProjectPath('main.tex', [])).toBeUndefined();
  });
});

describe('unwrapLogLines', () => {
  it('joins lines wrapped at 79 columns', () => {
    const a = 'x'.repeat(79);
    expect(unwrapLogLines(`${a}\nrest\nnext`)).toEqual([a + 'rest', 'next']);
    expect(unwrapLogLines(`${'y'.repeat(76)}...\nnext`)).toEqual([`${'y'.repeat(76)}...`, 'next']);
    // Never glue a new message onto a wrapped line.
    expect(unwrapLogLines(`${a}\n! Undefined control sequence.`)).toEqual([a, '! Undefined control sequence.']);
    // UTF-8 byte counting (pdfTeX counts bytes).
    const u = 'é'.repeat(30) + 'x'.repeat(19); // 79 bytes
    expect(unwrapLogLines(`${u}\nmore`)).toEqual([u + 'more']);
  });
});

describe('parseLatexLog: pdfTeX log', () => {
  const ds = parseLatexLog(fixture('pdflatex-mixed.log'), {
    projectPaths: ['main.tex', 'chapters/introduction.tex', 'chapters/results.tex', 'appendix/proofs.tex', 'references.bib'],
    mainPath: 'main.tex',
  });

  it('finds every diagnostic with the right file and line', () => {
    expect(brief(ds)).toEqual([
      ['error', 'missing-package', 'main.tex', 5],
      ['warning', 'pdf-string', 'main.tex', 12],
      ['warning', 'undefined-reference', 'main.tex', 15],
      ['error', 'undefined-control-sequence', 'chapters/introduction.tex', 3],
      ['badbox', 'overfull-hbox', 'chapters/introduction.tex', 7],
      ['badbox', 'underfull-hbox', 'chapters/introduction.tex', 11],
      ['warning', 'font-warning', 'chapters/introduction.tex', 20],
      ['warning', 'undefined-citation', 'chapters/results.tex', 4],
      ['error', 'runaway-argument', 'chapters/results.tex', 30],
      ['badbox', 'overfull-vbox', 'chapters/results.tex', null],
      ['warning', 'float-specifier', 'appendix/proofs.tex', null],
      ['badbox', 'underfull-vbox', 'main.tex', null],
      ['warning', 'duplicate-destination', 'main.tex', 40],
      ['warning', 'undefined-references', 'main.tex', null],
      ['info', 'rerun-needed', 'main.tex', null],
      ['info', 'rerun-bibliography', 'main.tex', null],
      ['warning', 'unclosed-group', 'main.tex', null],
    ]);
  });

  it('keeps useful messages and context', () => {
    const missing = ds[0];
    expect(missing.message).toBe("LaTeX Error: File `fancypkg.sty' not found.");
    expect(missing.context).toContain('l.5 \\usepackage');
    expect(missing.context).not.toContain('Enter file name');
    const ucs = ds.find((d) => d.code === 'undefined-control-sequence')!;
    expect(ucs.context).toBe('l.3 This is \\bfseries\\textbff\n                              {important}.');
    expect(ucs.raw).toContain('./chapters/introduction.tex:3: Undefined control sequence.');
    const pdfString = ds.find((d) => d.code === 'pdf-string')!;
    expect(pdfString.message).toBe("Package hyperref Warning: Token not allowed in a PDF string (Unicode): removing `math shift' on input line 12.");
    const natbib = ds.find((d) => d.code === 'undefined-citation')!;
    expect(natbib.message).toContain("Citation `smith2020' on page 2 undefined on input line 4.");
    const overfull = ds.find((d) => d.code === 'overfull-hbox')!;
    expect(overfull.message).toBe('Overfull \\hbox (15.31474pt too wide) in paragraph at lines 7--9');
    expect(overfull.context).toContain('http://example.com/a/very/long/path');
    const runaway = ds.find((d) => d.code === 'runaway-argument')!;
    expect(runaway.context).toContain('Runaway argument?');
    expect(ds.find((d) => d.code === 'rerun-bibliography')!.message).toBe(
      'Package biblatex Warning: Please (re)run Biber on the file: main and rerun LaTeX afterwards.',
    );
  });

  it('does not report the emergency stop / fatal error after a real error', () => {
    expect(ds.some((d) => d.code === 'emergency-stop' || d.code === 'fatal-error')).toBe(false);
  });
});

describe('parseLatexLog: real Tectonic/XeTeX log', () => {
  const log = fixture('tectonic-errors.log');
  it('tracks files without "./" prefixes and extensions', () => {
    const ds = parseLatexLog(log, { projectPaths: ['main.tex', 'chapters/one.tex'], mainPath: 'main.tex' });
    expect(brief(ds)).toEqual([
      ['warning', 'undefined-reference', 'main.tex', 6],
      ['warning', 'undefined-citation', 'main.tex', 6],
      ['error', 'undefined-control-sequence', 'chapters/one.tex', 2],
      ['error', 'environment-mismatch', 'chapters/one.tex', 5],
      ['error', 'undefined-control-sequence', 'main.tex', 9],
      ['error', 'missing-dollar', 'main.tex', 11],
      ['warning', 'undefined-references', 'main.tex', null],
    ]);
  });
  it('works without project paths (relative paths are kept)', () => {
    const ds = parseLatexLog(log);
    expect(ds.filter((d) => d.severity === 'error').map((d) => d.file)).toEqual(['chapters/one', 'chapters/one', 'main.tex', 'main.tex']);
  });
  it('deduplicates repeated diagnostics (concatenated runs)', () => {
    const once = parseLatexLog(log, { projectPaths: ['main.tex', 'chapters/one.tex'] });
    const twice = parseLatexLog(log + '\n' + log, { projectPaths: ['main.tex', 'chapters/one.tex'] });
    expect(twice.length).toBe(once.length);
  });
});

describe('parseLatexLog: misc formats', () => {
  it('parses Tectonic console output', () => {
    const ds = parseLatexLog('error: chapters/one:2: Undefined control sequence\nwarning: main.tex:12: Reference `x\' on page 1 undefined on input line 12.', {
      projectPaths: ['main.tex', 'chapters/one.tex'],
    });
    expect(brief(ds)).toEqual([
      ['error', 'undefined-control-sequence', 'chapters/one.tex', 2],
      ['warning', 'undefined-reference', 'main.tex', 12],
    ]);
  });

  it('parses biber output', () => {
    const ds = parseLatexLog(fixture('biber.blg'), { projectPaths: ['main.tex', 'references.bib'] });
    expect(brief(ds)).toEqual([
      ['warning', 'biber-warning', 'references.bib', 14],
      ['error', 'biber-error', 'references.bib', 22],
      ['warning', 'missing-bib-entry', null, null],
    ]);
  });

  it('parses bibtex output', () => {
    const ds = parseLatexLog(fixture('bibtex.blg'), { projectPaths: ['main.tex', 'references.bib'] });
    expect(brief(ds)).toEqual([
      ['error', 'bibtex-error', 'references.bib', 12],
      ['error', 'bibtex-error', 'references.bib', 30],
      ['warning', 'missing-bib-entry', null, null],
      ['warning', 'bibtex-warning', null, null],
      ['warning', 'bibtex-warning', 'references.bib', 41],
    ]);
    expect(ds[0].message).toBe("I was expecting a `,' or a `}'");
    expect(ds[0].context).toContain('title = "A study');
  });

  it('reports emergency stops and fatal errors when nothing else explains them', () => {
    const log = `(./main.tex\n! Emergency stop.\n<*> main.tex\n            \n*** (job aborted, no legal \\end found)\n\n!  ==> Fatal error occurred, no output PDF file produced!\n`;
    const ds = parseLatexLog(log, { projectPaths: ['main.tex'] });
    expect(ds.map((d) => d.code)).toEqual(['emergency-stop']);
  });

  it('maps errors raised inside package files to the including project file without a line', () => {
    const log = `(./main.tex (/usr/share/texlive/texmf-dist/tex/latex/geometry/geometry.sty\n! Package keyval Error: foo undefined.\n\nSee the keyval package documentation for explanation.\nType  H <return>  for immediate help.\n ...                                              \n                                                  \nl.1013 \\ProcessOptionsKV[p]{Gm}\n                              %\n\n))`;
    const ds = parseLatexLog(log, { projectPaths: ['main.tex'], mainPath: 'main.tex' });
    expect(brief(ds)).toEqual([['error', 'package-error', 'main.tex', null]]);
  });

  it('handles quoted file names with spaces and the missing-file code', () => {
    const log = `("./my chapter.tex"\n! LaTeX Error: File \`figures/plot.png' not found.\n\nl.7 \\includegraphics{figures/plot.png}\n                                         \n\n)`;
    const ds = parseLatexLog(log, { projectPaths: ['my chapter.tex'] });
    expect(brief(ds)).toEqual([['error', 'missing-file', 'my chapter.tex', 7]]);
  });

  it('is linear on big logs', () => {
    const chunk = fixture('pdflatex-mixed.log');
    const big = Array.from({ length: 200 }, () => chunk).join('\n');
    const t0 = performance.now();
    parseLatexLog(big, { projectPaths: ['main.tex'] });
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});
