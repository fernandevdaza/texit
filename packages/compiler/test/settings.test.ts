import { describe, expect, it } from 'vitest';
import type { ProjectFile } from '@texit/core';
import { detectCompileSettings, engineFromProgram, findMainFile, followTexRoot } from '../src/settings';

const doc = (preamble: string, body = 'Hi') => `\\documentclass{article}\n${preamble}\n\\begin{document}\n${body}\n\\end{document}\n`;
const one = (content: string): ProjectFile[] => [{ path: 'main.tex', content }];

describe('engine detection', () => {
  it('defaults to pdflatex', () => {
    expect(detectCompileSettings(one(doc('\\usepackage{amsmath}')), 'main.tex')).toMatchObject({ engine: 'pdflatex', engineSource: 'default' });
  });
  it('fontspec / unicode-math / polyglossia → xelatex', () => {
    for (const p of ['fontspec', 'unicode-math', 'polyglossia']) {
      expect(detectCompileSettings(one(doc(`\\usepackage{${p}}`)), 'main.tex')).toMatchObject({ engine: 'xelatex', engineSource: 'packages' });
    }
  });
  it('lualatex-only packages win over fontspec', () => {
    expect(detectCompileSettings(one(doc('\\usepackage{fontspec}\n\\usepackage{luacode}')), 'main.tex').engine).toBe('lualatex');
    expect(detectCompileSettings(one(doc('', '\\directlua{tex.print("x")}')), 'main.tex').engine).toBe('lualatex');
  });
  it('xelatex-only packages pick xelatex', () => {
    expect(detectCompileSettings(one(doc('\\usepackage{xeCJK}')), 'main.tex').engine).toBe('xelatex');
  });
  it('magic comments beat explicit settings and packages', () => {
    const s = detectCompileSettings(one('% !TEX program = lualatex\n' + doc('\\usepackage{xeCJK}')), 'main.tex', { engine: 'pdflatex' });
    expect(s).toMatchObject({ engine: 'lualatex', engineSource: 'magic' });
    expect(detectCompileSettings(one('% !TEX TS-program = XeLaTeX\n' + doc('')), 'main.tex').engine).toBe('xelatex');
  });
  it('explicit engine beats package heuristics', () => {
    expect(detectCompileSettings(one(doc('\\usepackage{fontspec}')), 'main.tex', { engine: 'lualatex' })).toMatchObject({ engine: 'lualatex', engineSource: 'explicit' });
  });
  it('scans included files and local packages', () => {
    const files: ProjectFile[] = [
      { path: 'main.tex', content: doc('\\usepackage{mystyle}', '\\input{chapters/a}') },
      { path: 'mystyle.sty', content: '\\RequirePackage{fontspec}' },
      { path: 'chapters/a.tex', content: 'text' },
      { path: 'unrelated.tex', content: '\\usepackage{luacode}' },
    ];
    const s = detectCompileSettings(files, 'main.tex');
    expect(s.engine).toBe('xelatex');
    expect(s.scannedPaths.sort()).toEqual(['chapters/a.tex', 'main.tex', 'mystyle.sty']);
  });
  it('maps program strings', () => {
    expect(engineFromProgram('latexmk -xelatex')).toBe('xelatex');
    expect(engineFromProgram('LuaLaTeX')).toBe('lualatex');
    expect(engineFromProgram('pdftex')).toBe('pdflatex');
    expect(engineFromProgram('context')).toBeUndefined();
  });
});

describe('bibliography & makeindex', () => {
  it('biblatex → biber unless backend=bibtex; \\bibliography → bibtex', () => {
    expect(detectCompileSettings(one(doc('\\usepackage{biblatex}\\addbibresource{r.bib}')), 'main.tex').bibTool).toBe('biber');
    expect(detectCompileSettings(one(doc('\\usepackage[backend=bibtex]{biblatex}')), 'main.tex').bibTool).toBe('bibtex');
    expect(detectCompileSettings(one(doc('', '\\bibliography{refs}')), 'main.tex').bibTool).toBe('bibtex');
    expect(detectCompileSettings(one(doc('')), 'main.tex').bibTool).toBe('none');
    expect(detectCompileSettings(one('% !BIB program = biber\n' + doc('', '\\bibliography{x}')), 'main.tex')).toMatchObject({ bibTool: 'biber', bibSource: 'magic' });
    expect(detectCompileSettings(one(doc('', '\\bibliography{x}')), 'main.tex', { bibTool: 'none' }).bibTool).toBe('none');
  });
  it('makeindex via \\makeindex or imakeidx', () => {
    expect(detectCompileSettings(one(doc('\\usepackage{makeidx}\\makeindex')), 'main.tex').makeindex).toBe(true);
    expect(detectCompileSettings(one(doc('\\usepackage{imakeidx}')), 'main.tex').makeindex).toBe(true);
    expect(detectCompileSettings(one(doc('')), 'main.tex').makeindex).toBe(false);
  });
});

describe('main file & % !TEX root', () => {
  const files: ProjectFile[] = [
    { path: 'chapters/intro.tex', content: '% !TEX root = ../thesis.tex\n\\chapter{Intro}' },
    { path: 'thesis.tex', content: '% !TEX program = xelatex\n' + doc('', '\\input{chapters/intro}') },
    { path: 'old/main-backup.tex', content: doc('') },
    { path: 'figure.tex', content: '\\documentclass{standalone}' },
  ];
  it('finds the most likely root document', () => {
    expect(findMainFile(files)).toBe('thesis.tex');
    expect(findMainFile([...files, { path: 'main.tex', content: doc('') }])).toBe('main.tex');
    expect(findMainFile([{ path: 'a.txt', content: 'x' }])).toBeUndefined();
  });
  it('follows % !TEX root from a child file', () => {
    expect(followTexRoot(files, 'chapters/intro.tex')).toBe('thesis.tex');
    const s = detectCompileSettings(files, 'chapters/intro.tex');
    expect(s).toMatchObject({ mainPath: 'thesis.tex', requestedMainPath: 'chapters/intro.tex', engine: 'xelatex', isCompilableMain: true });
  });
  it('ignores dangling roots and cycles', () => {
    expect(followTexRoot([{ path: 'a.tex', content: '% !TEX root = missing.tex' }], 'a.tex')).toBe('a.tex');
    const cyc: ProjectFile[] = [
      { path: 'a.tex', content: '% !TEX root = b.tex' },
      { path: 'b.tex', content: '% !TEX root = a.tex' },
    ];
    expect(followTexRoot(cyc, 'a.tex')).toBe('b.tex');
  });
  it('auto-detects when mainPath is omitted', () => {
    expect(detectCompileSettings(files).mainPath).toBe('thesis.tex');
    expect(detectCompileSettings([]).mainPath).toBe('');
  });
});
