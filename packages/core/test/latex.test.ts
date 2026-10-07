import { describe, expect, it } from 'vitest';
import {
  analyzeLatex,
  countWords,
  countXparseArgs,
  latexToPlainText,
  lintLatex,
  maskLatex,
  parseBibtex,
  parseMagicComments,
} from '../src/latex';

const raw = String.raw;

describe('maskLatex', () => {
  it('keeps length and newlines, masks comments and verbatim', () => {
    const src = raw`a % comment {
\% not a comment \\% but this is
\verb|{%}| x \url{http://a.com/%20}
\begin{verbatim}
\section{x} {
\end{verbatim}
end`;
    const m = maskLatex(src);
    expect(m.length).toBe(src.length);
    expect(m.split('\n').length).toBe(src.split('\n').length);
    expect(m).not.toContain('comment {');
    expect(m).toContain(raw`\% not a comment \\%`);
    expect(m).not.toContain('but this is');
    expect(m).not.toContain('{%}');
    expect(m).not.toContain('%20');
    expect(m).not.toContain(raw`\section{x}`);
    expect(m).toContain(raw`\end{verbatim}`);
  });
});

describe('parseMagicComments', () => {
  it('parses TeXShop/TeXstudio magic comments', () => {
    const m = parseMagicComments(`% !TEX program = xelatex\n%!TeX TS-program = lualatex\n% !TEX root = ../main.tex\n% !TeX spellcheck = en_US\n% !BIB program = biber\n\\documentclass{article}`);
    expect(m).toEqual({ program: 'xelatex', 'ts-program': 'lualatex', root: '../main.tex', spellcheck: 'en_US', 'bib-program': 'biber' });
    expect(parseMagicComments('% !TeX TS-program = lualatex').program).toBe('lualatex');
  });
});

describe('latexToPlainText', () => {
  it('cleans titles', () => {
    expect(latexToPlainText(raw`Erd\H{o}s and Schr\"odinger's caf\'e -- \textbf{bold} $x^2$ \LaTeX{} rocks~ok`)).toBe("Erdős and Schrödinger's café – bold $x^2$ LaTeX rocks ok");
    expect(latexToPlainText(raw`Intro\label{sec:x}\footnote{note} \texorpdfstring{$\alpha$}{alpha}`)).toBe('Intro alpha');
    expect(latexToPlainText(raw`A \& B \\ C`)).toBe('A & B C');
  });
});

describe('analyzeLatex', () => {
  const src = raw`% !TEX program = xelatex
\documentclass[11pt, a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[margin=1in]{geometry}
\usepackage{amsmath, amssymb,hyperref}
\newcommand{\R}{\mathbb{R}}
\newcommand\norm[2][2]{\left\|#1\right\|_{#2}\section{#1}\label{#2}\ref{#1}}
\renewcommand*{\vec}[1]{\mathbf{#1}}
\DeclareMathOperator*{\argmax}{arg\,max}
\def\foo#1#2{#1 and #2}
\NewDocumentCommand{\bar}{s o m D<>{x}}{}
\DeclarePairedDelimiter{\abs}{\lvert}{\rvert}
\newenvironment{myenv}[1][default]{\begin{center}}{\end{center}}
\NewDocumentEnvironment{boxed}{O{} m}{}{}
\newtheorem{theorem}{Theorem}[section]
\newtheorem*{remark}{Remark}
\graphicspath{{figures/}{img/}}
\title{A \textbf{Great} Paper\thanks{Funded}}
\begin{document}
\maketitle
\part{One}
\chapter*{Preface}
\section[Short]{Introduction to \emph{Things} {nested {braces}}}\label{sec:intro}
See \ref{sec:intro}, \eqref{eq:1}, \autoref{fig:plot}, \Cref{a,b}, \pageref*{p} and \crefrange{r1}{r2}.
\cite{knuth84}, \citep[see][p.~5]{lamport94, goossens}, \parencites[see][]{a}[p.~4]{b,c}, \nocite{*}
\textcite{t1} \footcite[12]{f1} \citeauthor*{ca} \citeyear{cy} \autocite{ac}
% \section{Commented}
% \cite{commented}
\verb|\section{Verb}| and \url{http://x.com/%20}
\begin{verbatim}
\section{In verbatim}
\end{verbatim}
\begin{lstlisting}[language=Python]
\label{nope}
\end{lstlisting}
\subsection*{Starred}
\subsubsection{Deep}
\paragraph{Para}
\subparagraph{Subpara}
\begin{equation}
  E = mc^2 \label{eq:1}
\end{equation}
\begin{align}
 a &= b \label{eq:a} \\
 c &= d \label{eq:c}
\end{align}
\begin{figure}[htbp]
  \centering
  \includegraphics[width=\linewidth]{figs/plot.pdf}
  \caption{A nice plot of \emph{data}.}
  \label{fig:plot}
\end{figure}
\begin{theorem}[Pythagoras]\label{thm:p} $a^2+b^2=c^2$ \end{theorem}
\input{chapters/intro}
\include{chapters/two}
\subfile{sub/file}
\import{sections/}{methods}
\subimport{parts}{a.tex}
\bibliography{refs, other}
\addbibresource[location=local]{library.bib}
\includepdf[pages=-]{scan.pdf}
\lstinputlisting[language=C]{code/main.c}
\inputminted{python}{code/app.py}
\input chapters/bare
\end{document}
`;
  const a = analyzeLatex(src);

  it('extracts the outline with levels, starred and short titles', () => {
    expect(a.outline.map((o) => [o.level, o.kind, o.title, o.starred])).toEqual([
      [0, 'part', 'One', false],
      [1, 'chapter', 'Preface', true],
      [2, 'section', 'Introduction to Things nested braces', false],
      [3, 'subsection', 'Starred', true],
      [4, 'subsubsection', 'Deep', false],
      [5, 'paragraph', 'Para', false],
      [6, 'subparagraph', 'Subpara', false],
    ]);
    const sec = a.outline[2];
    expect(sec.shortTitle).toBe('Short');
    expect(sec.line).toBe(src.split('\n').findIndex((l) => l.startsWith(raw`\section[Short]`)) + 1);
    expect(src.slice(sec.offset!, sec.offset! + 8)).toBe(raw`\section`);
  });

  it('extracts labels with context', () => {
    const byName = Object.fromEntries(a.labels.map((l) => [l.name, l]));
    expect(Object.keys(byName)).toEqual(['sec:intro', 'eq:1', 'eq:a', 'eq:c', 'fig:plot', 'thm:p']);
    expect(byName['sec:intro'].context).toBe('section: Introduction to Things nested braces');
    expect(byName['eq:1'].context).toBe('equation: E = mc^2');
    expect(byName['eq:a'].context).toBe('align: a = b');
    expect(byName['eq:c'].context).toBe('align: c = d');
    expect(byName['fig:plot'].context).toBe('figure: A nice plot of data.');
    expect(byName['thm:p'].context).toBe('theorem: Pythagoras');
    expect(byName['fig:plot'].line).toBe(src.split('\n').findIndex((l) => l.includes('label{fig:plot}')) + 1);
  });

  it('extracts refs and citations (ignoring comments, verbatim and macro bodies)', () => {
    expect(a.refs.map((r) => `${r.command}:${r.name}`)).toEqual([
      'ref:sec:intro', 'eqref:eq:1', 'autoref:fig:plot', 'Cref:a', 'Cref:b', 'pageref*:p', 'crefrange:r1', 'crefrange:r2',
    ]);
    expect(a.citations.map((c) => [c.command, c.keys])).toEqual([
      ['cite', ['knuth84']],
      ['citep', ['lamport94', 'goossens']],
      ['parencites', ['a', 'b', 'c']],
      ['nocite', ['*']],
      ['textcite', ['t1']],
      ['footcite', ['f1']],
      ['citeauthor*', ['ca']],
      ['citeyear', ['cy']],
      ['autocite', ['ac']],
    ]);
  });

  it('extracts includes', () => {
    expect(a.includes.map((i) => `${i.command}:${i.path}`)).toEqual([
      'includegraphics:figs/plot.pdf', 'input:chapters/intro', 'include:chapters/two', 'subfile:sub/file',
      'import:sections/methods', 'subimport:parts/a.tex', 'bibliography:refs', 'bibliography:other',
      'addbibresource:library.bib', 'includepdf:scan.pdf', 'lstinputlisting:code/main.c', 'inputminted:code/app.py',
      'input:chapters/bare',
    ]);
    expect(a.graphicsPath).toEqual(['figures/', 'img/']);
  });

  it('extracts definitions with argument counts', () => {
    expect(a.commands.map((c) => [c.name, c.args, !!c.optionalArg])).toEqual([
      ['R', 0, false], ['norm', 2, true], ['vec', 1, false], ['argmax', 0, false], ['foo', 2, false], ['bar', 4, true], ['abs', 1, false],
    ]);
    expect(a.environments.map((e) => [e.name, e.args ?? null, e.title ?? null])).toEqual([
      ['myenv', 1, null], ['boxed', 2, null], ['theorem', null, 'Theorem'], ['remark', null, 'Remark'],
    ]);
  });

  it('extracts packages, class, magic and title', () => {
    expect(a.packages.map((p) => [p.name, p.options ?? null, p.line])).toEqual([
      ['inputenc', 'utf8', 3], ['geometry', 'margin=1in', 4], ['amsmath', null, 5], ['amssymb', null, 5], ['hyperref', null, 5],
    ]);
    expect(a.documentClass).toEqual({ name: 'article', options: '11pt, a4paper' });
    expect(a.magic.program).toBe('xelatex');
    expect(a.title).toBe('A Great Paper');
  });

  it('handles beamer frames', () => {
    const b = analyzeLatex(raw`\documentclass{beamer}
\begin{document}
\section{Intro}
\begin{frame}{First \alert{frame}}
\end{frame}
\begin{frame}[fragile]
  \frametitle{Second}
  \begin{verbatim}
  \frametitle{Not me}
  \end{verbatim}
\end{frame}
\begin{frame}<2->[t]{Third}{Sub}
\end{frame}
\begin{frame}
\end{frame}
\end{document}`);
    expect(b.outline.map((o) => [o.kind, o.level, o.title, o.line])).toEqual([
      ['section', 2, 'Intro', 3],
      ['frame', -1, 'First frame', 4],
      ['frame', -1, 'Second', 6],
      ['frame', -1, 'Third', 12],
      ['frame', -1, 'Untitled frame', 14],
    ]);
  });

  it('ignores definitions and parameters', () => {
    const b = analyzeLatex(raw`\newcommand{\fig}[1]{\begin{figure}\label{#1}\end{figure}}\renewcommand{\cite}[1]{x}`);
    expect(b.labels).toEqual([]);
    expect(b.outline).toEqual([]);
  });

  it('counts xparse argument specs', () => {
    expect(countXparseArgs('m')).toEqual({ args: 1, optionalFirst: false });
    expect(countXparseArgs('s o m')).toEqual({ args: 3, optionalFirst: true });
    expect(countXparseArgs('O{default} m D<>{x} r() e{^_} t+ >{\\SplitList{,}}m').args).toBe(8);
  });

  it('is fast on large documents', () => {
    const chunk = raw`\section{S}\label{s} Text with \ref{s} and \cite{k} and $x^2$ math. \begin{equation}a\end{equation}` + '\n';
    const big = chunk.repeat(5000); // ~500 KB
    const t0 = performance.now();
    const r = analyzeLatex(big);
    countWords(big);
    lintLatex(big);
    const dt = performance.now() - t0;
    expect(r.outline.length).toBe(5000);
    expect(dt).toBeLessThan(2000);
  });
});

describe('parseBibtex', () => {
  const bib = raw`% JabRef comment line
@string{acm = "ACM Press"}
@String{jnl = {Journal of } # "Things"}
@comment{ this @article{fake, title={x}} is ignored }
@preamble{ "\newcommand{\noop}[1]{}" }

@article{knuth84,
  author    = {Donald E. Knuth},
  title     = {Literate {P}rogramming},
  journal   = jnl,
  year      = 1984,
  month     = may,
  publisher = acm,
  note      = "The {"}quoted{"} part" # { and more},
  pages     = {97--111},
}

@Book(lamport94,
  title = "{\LaTeX}: A Document Preparation System",
  author = "Leslie Lamport and M\"uller, Hans",
  edition = {2nd}
)

@inproceedings{child,
  author = {A. Child},
  title = {Child Paper},
  crossref = {parentproc},
}
@proceedings{parentproc,
  title = {Proceedings of Things},
  year = {2020},
  editor = {E. Ditor},
}
@article{broken,
  title = {Unclosed {brace,
  year = 2000
@misc{after, title = {Recovered}}
@misc{nofields}
`;
  const entries = parseBibtex(bib);
  const by = Object.fromEntries(entries.map((e) => [e.key, e]));

  it('parses entries, types and lines', () => {
    expect(entries.map((e) => e.key)).toEqual(['knuth84', 'lamport94', 'child', 'parentproc', 'broken', 'after', 'nofields']);
    expect(by.knuth84.type).toBe('article');
    expect(by.lamport94.type).toBe('book');
    expect(by.knuth84.line).toBe(7);
    expect(by.lamport94.line).toBe(bib.split('\n').findIndex((l) => l.startsWith('@Book(')) + 1);
  });

  it('resolves macros, concatenation, months and quotes', () => {
    expect(by.knuth84.fields).toMatchObject({
      author: 'Donald E. Knuth',
      title: 'Literate {P}rogramming',
      journal: 'Journal of Things',
      year: '1984',
      month: 'May',
      publisher: 'ACM Press',
      note: 'The {"}quoted{"} part and more',
      pages: '97--111',
    });
    expect(by.lamport94.fields.title).toBe(raw`{\LaTeX}: A Document Preparation System`);
    expect(by.lamport94.fields.author).toBe(raw`Leslie Lamport and M\"uller, Hans`);
  });

  it('applies crossref inheritance', () => {
    expect(by.child.fields).toMatchObject({ booktitle: 'Proceedings of Things', year: '2020', editor: 'E. Ditor', title: 'Child Paper' });
  });

  it('recovers from malformed entries', () => {
    expect(by.after.fields.title).toBe('Recovered');
    expect(by.nofields.fields).toEqual({});
    expect(parseBibtex('')).toEqual([]);
    expect(parseBibtex('@article{x, title = {a}')).toHaveLength(1);
  });
});

describe('countWords', () => {
  it('counts body text, headers, captions and math', () => {
    const src = raw`\documentclass{article}
\usepackage{amsmath}
\title{Not counted}
\begin{document}
\section{Hello World}
This is \emph{some} \textbf{bold}face text with a ref~\ref{x} and cite \cite[p.~2]{k}.
% this comment is ignored
Inline $a+b$ and \(c\), display \[d\] and
\begin{equation} e = f \end{equation}
\begin{figure}\caption{A short caption}\end{figure}
Caf\'e na\"ive don't well-known 3.14 \footnote{Foot note}
\begin{verbatim}
not counted at all
\end{verbatim}
\end{document}
ignored after end`;
    const w = countWords(src);
    expect(w.headerWords).toBe(2);
    expect(w.headers).toBe(1);
    // This is some boldface text with a ref and cite | Inline and display and | Café naïve don't well-known 3.14
    expect(w.textWords).toBe(10 + 4 + 5);
    expect(w.captionWords).toBe(3 + 2);
    expect(w.words).toBe(w.textWords + w.headerWords + w.captionWords);
    expect(w.mathInline).toBe(2);
    expect(w.mathDisplay).toBe(2);
    expect(w.floats).toBe(1);
    expect(w.characters).toBeGreaterThan(80);
  });

  it('counts fragments without preamble, returns 0 for preamble-only', () => {
    expect(countWords('Just three words').words).toBe(3);
    expect(countWords(raw`\documentclass{article}\usepackage{x}`).words).toBe(0);
    expect(countWords('日本語テキスト').words).toBe(7);
  });
});

describe('lintLatex', () => {
  const codes = (src: string) => lintLatex(src).map((d) => d.code);

  it('accepts valid documents', () => {
    expect(
      lintLatex(raw`\documentclass{article}
\newcommand{\be}{\begin{equation}}
\newenvironment{myeq}{\begin{equation}}{\end{equation}}
\begin{document}
$a$ and $$b$$ and \(c\) and \[d\] \{ \} \verb|{| % {
\begin{align} x &= \text{if $y$} \\ z \end{align}
\begin{tikzpicture}\node {$x$};\end{tikzpicture}
\end{document}`),
    ).toEqual([]);
  });

  it('reports unbalanced braces with offsets', () => {
    const src = 'a { b } } c {';
    const d = lintLatex(src);
    expect(d.map((x) => [x.code, x.from, x.to, x.severity, x.line])).toEqual([
      ['unmatched-brace', 8, 9, 'error', 1],
      ['unclosed-brace', 12, 13, 'error', 1],
    ]);
  });

  it('reports environment problems', () => {
    const src = '\\begin{itemize}\n\\begin{enumerate}\n\\end{itemize}\n\\end{foo}\n\\begin{center}';
    const d = lintLatex(src);
    expect(d.map((x) => [x.code, x.line])).toEqual([
      ['unclosed-environment', 2],
      ['environment-mismatch', 3],
      ['end-without-begin', 4],
      ['unclosed-environment', 5],
    ]);
    const mismatch = d.find((x) => x.code === 'environment-mismatch')!;
    expect(src.slice(mismatch.from, mismatch.to)).toBe('\\end{itemize}');
    expect(mismatch.message).toContain('\\begin{enumerate} on line 2 ended by \\end{itemize}');
  });

  it('reports math problems', () => {
    expect(codes('a $x + y\n\nnext paragraph')).toEqual(['unclosed-math']);
    expect(codes('a $x + y')).toEqual(['unclosed-math']);
    expect(codes('\\[ x ')).toEqual(['unclosed-math']);
    expect(codes('x \\] y')).toEqual(['unmatched-math']);
    expect(codes('\\begin{equation} $x$ \\end{equation}')).toEqual(['math-in-math', 'math-in-math']);
    expect(codes('\\begin{align}\na\n\nb\n\\end{align}')).toEqual(['blank-line-in-math']);
    const d = lintLatex('ok $x');
    expect([d[0].from, d[0].to]).toEqual([3, 4]);
  });

  it('reports a trailing backslash, duplicate labels and missing begin{document}', () => {
    expect(codes('text \\')).toEqual(['trailing-backslash']);
    expect(codes('text \\\\')).toEqual([]);
    expect(codes('\\label{a} \\label{a}')).toEqual(['duplicate-label']);
    expect(codes('\\documentclass{article}\n\\usepackage{x}')).toEqual(['missing-begin-document']);
  });
});
