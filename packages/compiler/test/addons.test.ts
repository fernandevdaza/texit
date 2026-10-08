import { describe, expect, it } from 'vitest';
import { TexAddons, providedNames } from '../src/busytex/addons';
import { findMissingFiles } from '../src/busytex/data-packages';

const manifest = {
  version: 1,
  files: {
    'spanish.ldf': 'babel/babel-spanish/spanish.ldf',
    'romanidx.sty': 'babel/babel-spanish/romanidx.sty',
    'ngerman.ldf': 'babel/babel-german/ngerman.ldf',
    'babel-german.def': 'babel/babel-german/babel-german.def',
    'IEEEtran.cls': 'ieee/IEEEtran.cls',
  },
};

function fakeFetch(calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
    return new Response(new TextEncoder().encode(`%% ${url.split('/').pop()}`));
  }) as typeof fetch;
}

describe('TeX Live add-ons', () => {
  it('resolves needed files plus companions in the same folder', async () => {
    const a = new TexAddons('https://x.test/texlive-addons/', fakeFetch([]));
    expect((await a.resolve(['spanish.ldf', 'tikz.sty'], new Set())).sort()).toEqual(['romanidx.sty', 'spanish.ldf']);
    expect((await a.resolve(['ngerman.ldf'], new Set())).sort()).toEqual(['babel-german.def', 'ngerman.ldf']);
    expect(await a.resolve(['IEEEtran.cls|ieeetran.cls'], new Set())).toEqual(['IEEEtran.cls']);
  });

  it('never shadows files the project provides', async () => {
    const a = new TexAddons('https://x.test/texlive-addons/', fakeFetch([]));
    expect(await a.resolve(['IEEEtran.cls'], providedNames(['sub/IEEEtran.cls']))).toEqual([]);
  });

  it('loads and caches files', async () => {
    const calls: string[] = [];
    const a = new TexAddons('https://x.test/texlive-addons/', fakeFetch(calls));
    const files = await a.load(['spanish.ldf']);
    await a.load(['spanish.ldf']);
    expect(new TextDecoder().decode(files[0].content)).toBe('%% spanish.ldf');
    expect(calls.filter((c) => c.endsWith('spanish.ldf'))).toHaveLength(1);
  });

  it('is a no-op without a base URL', async () => {
    const a = new TexAddons(null, fakeFetch([]));
    expect(await a.resolve(['spanish.ldf'], new Set())).toEqual([]);
  });

  it('maps babel "Unknown option" errors to the missing .ldf', () => {
    const log = "! Package babel Error: Unknown option 'spanish'. Suggested actions:\n(babel)                * Make sure you haven't misspelled it";
    expect(findMissingFiles(log)).toContain('spanish.ldf');
  });
});

import { collectRequirements } from '../src/busytex/data-packages';

describe('font requirements', () => {
  const doc = (pre: string) => [{ path: 'main.tex', content: `\\documentclass{article}\n${pre}\n\\begin{document}x\\end{document}` }];
  it('T1 with Computer Modern needs cm-super', () => {
    expect(collectRequirements(doc('\\usepackage[T1]{fontenc}'))).toContain('cm-super-t1.enc');
  });
  it('T1 with lmodern (or another font package) does not', () => {
    expect(collectRequirements(doc('\\usepackage[T1]{fontenc}\n\\usepackage{lmodern}'))).not.toContain('cm-super-t1.enc');
    expect(collectRequirements(doc('\\usepackage[T1]{fontenc}\n\\usepackage{mathptmx}'))).not.toContain('cm-super-t1.enc');
  });
  it('detects missing encoding/font files in pdfTeX errors', () => {
    const log = '!pdfTeX error: /bin/busytex (file cm-super-t1.enc): cannot open encoding file f\nor reading';
    expect(findMissingFiles(log)).toContain('cm-super-t1.enc');
  });
});
