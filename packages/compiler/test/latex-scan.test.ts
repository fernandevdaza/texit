import { describe, expect, it } from 'vitest';
import { parseMagicComments, scanLatex, stripComments } from '../src/latex-scan';

describe('stripComments', () => {
  it('removes unescaped comments only', () => {
    expect(stripComments('a % b\n50\\% off % c\n\\\\% d')).toBe('a \n50\\% off \n\\\\');
  });
});

describe('parseMagicComments', () => {
  it('reads TeX and BIB magic comments case-insensitively', () => {
    const m = parseMagicComments('\ufeff% !TEX TS-program = xelatex\n%!TeX root=../main.tex\n% !BIB program = biber\n\\documentclass{article}');
    expect(m).toEqual({ 'ts-program': 'xelatex', root: '../main.tex', 'bib-program': 'biber' });
  });
  it('only looks at the head of the file', () => {
    expect(parseMagicComments('x\n'.repeat(60) + '% !TEX program = lualatex')).toEqual({});
  });
});

describe('scanLatex', () => {
  it('extracts packages, classes, bibliography, inputs and themes', () => {
    const s = scanLatex(String.raw`
\documentclass[11pt,a4paper]{beamer}
\usepackage[utf8]{inputenc}
\usepackage{amsmath, amssymb}
% \usepackage{commented}
\RequirePackage[backend=biber,style=ieee]{biblatex}
\addbibresource{refs.bib}
\usetheme{Madrid}\usecolortheme{beaver}
\usetikzlibrary{arrows.meta, calc}
\input{chapters/intro}
\input preamble
\import{parts/}{one}
\includegraphics[width=3cm]{fig/a.png}
\bibliographystyle{plainnat}
\setdefaultlanguage{french}
\makeindex
\begin{document}\end{document}`);
    expect(s.documentClass).toEqual({ name: 'beamer', options: ['11pt', 'a4paper'] });
    expect(s.packages.map((p) => p.name)).toEqual(['inputenc', 'amsmath', 'amssymb', 'biblatex']);
    expect(s.packages.find((p) => p.name === 'biblatex')?.options).toEqual(['backend=biber', 'style=ieee']);
    expect(s.bibResources).toEqual(['refs.bib']);
    expect(s.beamerThemeFiles).toEqual(['beamerthemeMadrid.sty', 'beamercolorthemebeaver.sty']);
    expect(s.tikzLibraries).toEqual(['arrows.meta', 'calc']);
    expect(s.inputs).toEqual(['chapters/intro', 'preamble', 'parts/one']);
    expect(s.graphics).toEqual(['fig/a.png']);
    expect(s.bibliographyStyles).toEqual(['plainnat']);
    expect(s.languages).toEqual(['french']);
    expect(s.hasMakeindex).toBe(true);
    expect(s.hasBeginDocument).toBe(true);
    expect(s.packages.some((p) => p.name === 'commented')).toBe(false);
  });
  it('does not confuse \\bibliographystyle with \\bibliography', () => {
    const s = scanLatex('\\bibliographystyle{plain}\\bibliography{a,b}');
    expect(s.bibliographies).toEqual(['a', 'b']);
  });
});
