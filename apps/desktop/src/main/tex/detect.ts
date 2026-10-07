import type { NativeTexInfo, NativeTexTool } from '@texit/core';
import { capture, firstLine } from '../util/process';
import { which } from '../util/which';

export const TEX_TOOL_IDS = ['tectonic', 'latexmk', 'pdflatex', 'xelatex', 'lualatex', 'bibtex', 'biber', 'makeindex', 'synctex'] as const;

const VERSION_ARGS: Record<string, string[]> = {
  tectonic: ['--version'],
  latexmk: ['-v'],
  pdflatex: ['--version'],
  xelatex: ['--version'],
  lualatex: ['--version'],
  bibtex: ['--version'],
  biber: ['--version'],
  makeindex: ['-h'], // prints the version banner on stderr
  synctex: ['version'],
};

/** Extract a concise version string from a tool's version banner. */
export function parseToolVersion(id: string, output: string): string | undefined {
  const text = output.trim();
  if (!text) return undefined;
  const line = firstLine(text) ?? '';
  switch (id) {
    case 'tectonic':
      return line.match(/Tectonic\s+(\S+)/i)?.[1] ?? line;
    case 'latexmk':
      return text.match(/Latexmk,.*?Version\s+(\S+)/i)?.[1] ?? line;
    case 'biber':
      return line.match(/biber version:\s*(\S+)/i)?.[1] ?? line;
    case 'synctex':
      return text.match(/version\s+([\d.]+)/i)?.[1] ?? line;
    default:
      return line;
  }
}

/** Guess the TeX distribution from binary locations and version banners. */
export function guessDistribution(tools: NativeTexTool[]): string | undefined {
  const engine = tools.find((t) => t.id === 'pdflatex') ?? tools.find((t) => t.id === 'xelatex') ?? tools.find((t) => t.id === 'lualatex');
  if (engine) {
    const v = engine.version ?? '';
    const p = engine.path;
    const tl = v.match(/\((TeX Live \d{4}[^)]*)\)/i)?.[1];
    if (/MiKTeX/i.test(v) || /miktex/i.test(p)) return 'MiKTeX';
    if (/TinyTeX/i.test(p)) return tl ? `TinyTeX (${tl})` : 'TinyTeX';
    if (p.startsWith('/Library/TeX/')) return tl ? `MacTeX (${tl})` : 'MacTeX';
    if (tl) return tl;
    if (/texlive/i.test(p)) return 'TeX Live';
    return 'TeX distribution';
  }
  if (tools.some((t) => t.id === 'tectonic')) return 'Tectonic';
  return undefined;
}

let cache: { at: number; value: Promise<NativeTexInfo> } | null = null;

export function detectTex(force = false): Promise<NativeTexInfo> {
  if (!force && cache && Date.now() - cache.at < 15_000) return cache.value;
  const value = (async (): Promise<NativeTexInfo> => {
    const found = await Promise.all(
      TEX_TOOL_IDS.map(async (id): Promise<NativeTexTool | null> => {
        const p = await which(id);
        if (!p) return null;
        const r = await capture(p, VERSION_ARGS[id] ?? ['--version'], { timeoutMs: 8000 });
        return { id, path: p, version: parseToolVersion(id, `${r.stdout}\n${r.stderr}`) };
      }),
    );
    const tools = found.filter((t): t is NativeTexTool => !!t);
    return { tools, distribution: guessDistribution(tools) };
  })();
  cache = { at: Date.now(), value };
  value.catch(() => (cache = null));
  return value;
}
