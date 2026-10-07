/**
 * Snippets pack — common LaTeX environments as completion snippets.
 * Templates use CodeMirror snippet syntax: ${1:placeholder}, ${} for the final
 * cursor. A literal brace right after a backslash must be written as \\{ .
 */
import { definePlugin, type Snippet } from '@texit/plugin-api';

const tex = ['tex', 'ltx', 'latex', 'sty', 'cls'];

export const SNIPPETS: Snippet[] = [
  { label: 'fig', detail: 'figure environment', template: '\\begin{figure}[${1:htbp}]\n\t\\centering\n\t\\includegraphics[width=${2:0.8}\\linewidth]{${3:path}}\n\t\\caption{${4:Caption}}\n\t\\label{fig:${5:label}}\n\\end{figure}\n${}' },
  {
    label: 'subfig',
    detail: 'figure with two subfigures (subcaption)',
    template:
      '\\begin{figure}[${1:htbp}]\n\t\\centering\n\t\\begin{subfigure}[b]{0.48\\linewidth}\n\t\t\\centering\n\t\t\\includegraphics[width=\\linewidth]{${2:left}}\n\t\t\\caption{${3:Left}}\n\t\t\\label{fig:${4:left}}\n\t\\end{subfigure}\n\t\\hfill\n\t\\begin{subfigure}[b]{0.48\\linewidth}\n\t\t\\centering\n\t\t\\includegraphics[width=\\linewidth]{${5:right}}\n\t\t\\caption{${6:Right}}\n\t\t\\label{fig:${7:right}}\n\t\\end{subfigure}\n\t\\caption{${8:Caption}}\n\t\\label{fig:${9:label}}\n\\end{figure}\n${}',
  },
  { label: 'tab', detail: 'table environment (booktabs)', template: '\\begin{table}[${1:htbp}]\n\t\\centering\n\t\\caption{${2:Caption}}\n\t\\label{tab:${3:label}}\n\t\\begin{tabular}{${4:lcr}}\n\t\t\\toprule\n\t\t${5:A} & ${6:B} & ${7:C} \\\\\n\t\t\\midrule\n\t\t${8} \\\\\n\t\t\\bottomrule\n\t\\end{tabular}\n\\end{table}\n${}' },
  { label: 'eq', detail: 'numbered equation', template: '\\begin{equation}\n\t${1}\n\t\\label{eq:${2:label}}\n\\end{equation}\n${}' },
  { label: 'eq*', detail: 'unnumbered equation', template: '\\begin{equation*}\n\t${1}\n\\end{equation*}\n${}' },
  { label: 'align', detail: 'align environment', template: '\\begin{align}\n\t${1:a} &= ${2:b} \\\\\n\t${3:c} &= ${4:d}\n\\end{align}\n${}' },
  { label: 'align*', detail: 'align* environment', template: '\\begin{align*}\n\t${1:a} &= ${2:b}\n\\end{align*}\n${}' },
  { label: 'gather', detail: 'gather environment', template: '\\begin{gather}\n\t${1}\n\\end{gather}\n${}' },
  { label: 'cases', detail: 'piecewise definition', template: '\\begin{cases}\n\t${1:x} & \\text{if } ${2:x > 0}, \\\\\n\t${3:-x} & \\text{otherwise}.\n\\end{cases}${}' },
  { label: 'matrix', detail: 'pmatrix 2×2', template: '\\begin{pmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${4:d}\n\\end{pmatrix}${}' },
  { label: 'bmatrix', detail: 'bmatrix 2×2', template: '\\begin{bmatrix}\n\t${1:a} & ${2:b} \\\\\n\t${3:c} & ${4:d}\n\\end{bmatrix}${}' },
  { label: 'thm', detail: 'theorem', template: '\\begin{theorem}[${1:Name}]\n\t\\label{thm:${2:label}}\n\t${3}\n\\end{theorem}\n${}' },
  { label: 'lem', detail: 'lemma', template: '\\begin{lemma}\n\t\\label{lem:${1:label}}\n\t${2}\n\\end{lemma}\n${}' },
  { label: 'defn', detail: 'definition', template: '\\begin{definition}[${1:Term}]\n\t${2}\n\\end{definition}\n${}' },
  { label: 'cor', detail: 'corollary', template: '\\begin{corollary}\n\t${1}\n\\end{corollary}\n${}' },
  { label: 'proof', detail: 'proof environment', template: '\\begin{proof}\n\t${1}\n\\end{proof}\n${}' },
  { label: 'item', detail: 'itemize list', template: '\\begin{itemize}\n\t\\item ${1}\n\t\\item ${2}\n\\end{itemize}\n${}' },
  { label: 'enum', detail: 'enumerate list', template: '\\begin{enumerate}\n\t\\item ${1}\n\t\\item ${2}\n\\end{enumerate}\n${}' },
  { label: 'desc', detail: 'description list', template: '\\begin{description}\n\t\\item[${1:Term}] ${2:Definition}\n\\end{description}\n${}' },
  { label: 'frame', detail: 'beamer frame', template: '\\begin{frame}{${1:Title}}\n\t${2}\n\\end{frame}\n${}' },
  { label: 'cols', detail: 'beamer two columns', template: '\\begin{columns}\n\t\\begin{column}{0.5\\textwidth}\n\t\t${1}\n\t\\end{column}\n\t\\begin{column}{0.5\\textwidth}\n\t\t${2}\n\t\\end{column}\n\\end{columns}\n${}' },
  { label: 'tikz', detail: 'tikzpicture', template: '\\begin{tikzpicture}[${1:scale=1}]\n\t\\draw (${2:0,0}) -- (${3:1,1});\n\t${4}\n\\end{tikzpicture}\n${}' },
  { label: 'tikzfig', detail: 'figure with tikzpicture', template: '\\begin{figure}[${1:htbp}]\n\t\\centering\n\t\\begin{tikzpicture}\n\t\t${2}\n\t\\end{tikzpicture}\n\t\\caption{${3:Caption}}\n\t\\label{fig:${4:label}}\n\\end{figure}\n${}' },
  { label: 'minted', detail: 'code listing (minted, needs shell escape)', template: '\\begin{minted}{${1:python}}\n${2}\n\\end{minted}\n${}' },
  { label: 'lst', detail: 'code listing (listings)', template: '\\begin{lstlisting}[language=${1:Python}, caption={${2:Caption}}]\n${3}\n\\end{lstlisting}\n${}' },
  { label: 'verb', detail: 'verbatim block', template: '\\begin{verbatim}\n${1}\n\\end{verbatim}\n${}' },
  { label: 'sec', detail: 'section with label', template: '\\section{${1:Title}}\n\\label{sec:${2:label}}\n${}' },
  { label: 'ssec', detail: 'subsection with label', template: '\\subsection{${1:Title}}\n\\label{sec:${2:label}}\n${}' },
  { label: 'quote', detail: 'quote environment', template: '\\begin{quote}\n\t${1}\n\\end{quote}\n${}' },
  { label: 'center', detail: 'center environment', template: '\\begin{center}\n\t${1}\n\\end{center}\n${}' },
  { label: 'mini', detail: 'minipage', template: '\\begin{minipage}{${1:0.45}\\linewidth}\n\t${2}\n\\end{minipage}${}' },
  { label: 'href', detail: 'hyperlink', template: '\\href{${1:https://}}{${2:text}}${}' },
  { label: 'article', detail: 'article skeleton', template: '\\documentclass[${1:11pt}]{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\\usepackage{amsmath, amssymb}\n\\usepackage{graphicx}\n\\usepackage{hyperref}\n\n\\title{${2:Title}}\n\\author{${3:Author}}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n${4}\n\n\\end{document}\n' },
].map((s) => ({ ...s, languages: tex }));

export default definePlugin({
  id: 'org.texit.snippets',
  name: 'Snippets pack',
  version: '1.0.0',
  author: 'TexIt',
  icon: 'brackets',
  description: 'Completion snippets for figures, tables, equations, theorems, lists, beamer frames, TikZ, code listings and more. Type e.g. “fig” and press Enter.',
  permissions: ['editor'],
  tags: ['snippets', 'productivity'],
  activate(api) {
    api.editor.registerSnippets(SNIPPETS);
  },
});
