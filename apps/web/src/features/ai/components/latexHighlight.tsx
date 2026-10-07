/** Lightweight LaTeX syntax highlighting for chat code blocks (not the editor). */
import type { ReactNode } from 'react';

const RE = /(%.*$)|(\$\$[^$]*\$\$|\$[^$\n]*\$|\\\(|\\\)|\\\[|\\\])|(\\(?:begin|end))(\{)([^}]*)(\})|(\\[a-zA-Z@]+\*?|\\.)|([{}[\]])|(&)/gm;

export function highlightLatex(code: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of code.matchAll(RE)) {
    if (m.index! > last) out.push(code.slice(last, m.index));
    if (m[1]) out.push(<span key={k++} className="italic text-fg-subtle">{m[1]}</span>);
    else if (m[2]) out.push(<span key={k++} className="text-[#0d9488] dark:text-[#2dd4bf]">{m[2]}</span>);
    else if (m[3])
      out.push(
        <span key={k++}>
          <span className="text-[#7c3aed] dark:text-[#b69cff]">{m[3]}</span>
          <span className="text-fg-subtle">{m[4]}</span>
          <span className="text-[#c2410c] dark:text-[#fdba74]">{m[5]}</span>
          <span className="text-fg-subtle">{m[6]}</span>
        </span>,
      );
    else if (m[7]) out.push(<span key={k++} className="text-[#2563eb] dark:text-[#7cb3ff]">{m[7]}</span>);
    else if (m[8] || m[9]) out.push(<span key={k++} className="text-fg-subtle">{m[0]}</span>);
    last = m.index! + m[0].length;
  }
  if (last < code.length) out.push(code.slice(last));
  return out;
}

export function isLatexLang(lang: string | undefined): boolean {
  return !lang || /^(latex|tex|bibtex|bib|sty|cls)$/i.test(lang);
}
