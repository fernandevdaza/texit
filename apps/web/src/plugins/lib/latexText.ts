/**
 * Small, dependency-free LaTeX text helpers used as fallbacks while (or if)
 * the @texit/core implementations are unavailable, and by built-in plugins.
 */
import type { LatexAnalysis } from '@texit/core';

/** Remove `%` comments (keeps escaped `\%`). */
export function stripComments(src: string): string {
  return src.replace(/(^|[^\\])%.*$/gm, '$1');
}

/** Body of a document between \begin{document} and \end{document} (or the whole source). */
export function documentBody(src: string): { body: string; lineOffset: number } {
  const begin = src.search(/\\begin\s*\{document\}/);
  if (begin < 0) return { body: src, lineOffset: 0 };
  const startIdx = src.indexOf('}', begin) + 1;
  const endRel = src.slice(startIdx).search(/\\end\s*\{document\}/);
  const body = endRel < 0 ? src.slice(startIdx) : src.slice(startIdx, startIdx + endRel);
  return { body, lineOffset: src.slice(0, startIdx).split('\n').length - 1 };
}

const NON_TEXT_COMMANDS =
  'begin|end|label|ref|eqref|cref|Cref|autoref|pageref|nameref|cite[a-zA-Z]*|[a-zA-Z]*cite|nocite|usepackage|RequirePackage|documentclass|input|include|subfile|import|includegraphics|includepdf|bibliography|bibliographystyle|addbibresource|printbibliography|url|hspace|vspace|setlength|addtolength|newcommand|renewcommand|providecommand|newenvironment|renewenvironment|DeclareMathOperator|def|graphicspath|pagestyle|thispagestyle|setcounter|addtocounter|color|definecolor|hypersetup|geometry|newtheorem|theoremstyle|lstset|setminted|tikzset|pgfplotsset';

/** Approximate texcount-style word count of LaTeX source (comments, math and command names ignored). */
export function countWordsFallback(source: string): { words: number; characters: number; mathInline: number; mathDisplay: number } {
  let s = stripComments(source);
  let mathInline = 0;
  let mathDisplay = 0;
  s = s.replace(/\\begin\s*\{(verbatim|lstlisting|minted|comment|tikzpicture|filecontents)\*?\}[\s\S]*?\\end\s*\{\1\*?\}/g, ' ');
  s = s.replace(
    /\\begin\s*\{(equation|align|alignat|gather|multline|eqnarray|displaymath|flalign|math|dmath)\*?\}[\s\S]*?\\end\s*\{\1\*?\}/g,
    () => {
      mathDisplay++;
      return ' ';
    },
  );
  s = s.replace(/\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]/g, () => {
    mathDisplay++;
    return ' ';
  });
  s = s.replace(/\\\([\s\S]*?\\\)|\$(?:\\.|[^$\\])+\$/g, () => {
    mathInline++;
    return ' ';
  });
  // \href{url}{text}, \textcolor{c}{text}: drop the first argument only.
  s = s.replace(/\\(?:href|textcolor|colorbox)\s*\{[^{}]*\}/g, ' ');
  // Commands whose arguments are not prose.
  s = s.replace(new RegExp(`\\\\(?:${NON_TEXT_COMMANDS})\\*?\\s*(?:\\[[^\\]]*\\]\\s*)*(?:\\{[^{}]*\\}\\s*){0,3}`, 'g'), ' ');
  s = s.replace(/\\[a-zA-Z@]+\*?/g, ' ').replace(/\\./g, ' ');
  s = s.replace(/[{}[\]&~^_#]/g, ' ');
  const words = s.match(/[\p{L}\p{N}]+(?:['’.\-][\p{L}\p{N}]+)*/gu) ?? [];
  const characters = words.reduce((n, w) => n + w.replace(/['’.\-]/g, '').length, 0);
  return { words: words.length, characters, mathInline, mathDisplay };
}

const SECTION_LEVELS: Record<string, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4,
  paragraph: 5,
  subparagraph: 6,
};

/** Minimal analysis (outline, labels, refs, citations, includes) — fallback for core's analyzeLatex. */
export function analyzeLatexFallback(source: string): LatexAnalysis {
  const out: LatexAnalysis = {
    outline: [],
    labels: [],
    refs: [],
    citations: [],
    includes: [],
    commands: [],
    environments: [],
    packages: [],
    magic: {},
  };
  const lines = source.split('\n');
  lines.forEach((raw, i) => {
    const line = i + 1;
    const magic = /^\s*%\s*!\s*TEX\s+(\w+)\s*=\s*(.+?)\s*$/i.exec(raw);
    if (magic) out.magic[magic[1].toLowerCase()] = magic[2];
    const text = stripComments(raw);
    for (const m of text.matchAll(/\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)(\*?)\s*(?:\[[^\]]*\])?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)) {
      out.outline.push({ level: SECTION_LEVELS[m[1]], kind: m[1], title: m[3].trim(), line, starred: !!m[2] });
    }
    for (const m of text.matchAll(/\\begin\s*\{frame\}(?:\[[^\]]*\])?\s*(?:\{([^{}]*)\})?/g)) {
      out.outline.push({ level: -1, kind: 'frame', title: (m[1] ?? 'Frame').trim(), line, starred: false });
    }
    for (const m of text.matchAll(/\\label\s*\{([^}]+)\}/g)) out.labels.push({ name: m[1].trim(), line });
    for (const m of text.matchAll(/\\(ref|eqref|cref|Cref|autoref|pageref|nameref)\s*\{([^}]+)\}/g)) {
      for (const name of m[2].split(',')) out.refs.push({ name: name.trim(), line, command: m[1] });
    }
    for (const m of text.matchAll(/\\([a-zA-Z]*cite[a-zA-Z]*)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}/g)) {
      out.citations.push({ keys: m[2].split(',').map((k) => k.trim()).filter(Boolean), line, command: m[1] });
    }
    for (const m of text.matchAll(/\\(input|include|subfile|includegraphics|bibliography|addbibresource|includepdf)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
      for (const p of m[1] === 'bibliography' ? m[2].split(',') : [m[2]]) out.includes.push({ command: m[1], path: p.trim(), line });
    }
    for (const m of text.matchAll(/\\import\s*\{([^}]*)\}\s*\{([^}]+)\}/g)) {
      out.includes.push({ command: 'import', path: `${m[1].replace(/\/?$/, '/')}${m[2]}`, line });
    }
    for (const m of text.matchAll(/\\usepackage\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g)) {
      for (const name of m[2].split(',')) out.packages.push({ name: name.trim(), options: m[1], line });
    }
    const dc = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/.exec(text);
    if (dc && !out.documentClass) out.documentClass = { name: dc[2].trim(), options: dc[1] };
  });
  return out;
}
