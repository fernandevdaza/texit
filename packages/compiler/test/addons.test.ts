import { describe, expect, it } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { TexAddons, providedNames, withPdfMapFiles } from '../src/busytex/addons';
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
  bundles: {
    newtx: {
      triggers: ['newtxtext.sty', 'newtxmath.sty'],
      archive: 'fonts/newtx.zip',
      requires: ['fontaxes.sty', 'xstring.sty'],
      pdfMapFiles: ['newtx.map'],
    },
  },
};
const newtxZip = zipSync({ 'newtxtext.sty': strToU8('%% text'), 'newtxmath.sty': strToU8('%% math'), 'newtx.map': strToU8('ntx') });

function fakeFetch(calls: string[]): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('manifest.json')) return new Response(JSON.stringify(manifest));
    if (url.endsWith('.zip')) return new Response(newtxZip);
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

describe('add-on bundles', () => {
  it('plans a whole bundle from a trigger, with its TeX Live dependencies and map files', async () => {
    const a = new TexAddons('https://x.test/texlive-addons/', fakeFetch([]));
    const plan = await a.plan(['newtxtext.sty', 'newtxmath.sty', 'spanish.ldf', 'tikz.sty'], new Set());
    expect(plan.bundles).toEqual(['newtx']);
    expect(plan.requires).toEqual(['fontaxes.sty', 'xstring.sty']);
    expect(plan.pdfMapFiles).toEqual(['newtx.map']);
    expect(plan.satisfied.sort()).toEqual(['newtxmath.sty', 'newtxtext.sty', 'spanish.ldf']);
    const files = await a.loadPlan(plan, new Set(['newtx.map']));
    expect(files.map((f) => f.name).sort()).toEqual(['newtxmath.sty', 'newtxtext.sty', 'romanidx.sty', 'spanish.ldf']);
  });
  it('downloads a bundle archive once', async () => {
    const calls: string[] = [];
    const a = new TexAddons('https://x.test/texlive-addons/', fakeFetch(calls));
    const plan = await a.plan(['newtxtext.sty'], new Set());
    await a.loadPlan(plan);
    await a.loadPlan(plan);
    expect(calls.filter((c) => c.endsWith('.zip'))).toHaveLength(1);
  });
  it('activates map files on line 1 without shifting lines', () => {
    const src = '\\documentclass{article}\n\\begin{document}x\\end{document}';
    const out = withPdfMapFiles(src, ['newtx.map']);
    expect(out.split('\n')).toHaveLength(src.split('\n').length);
    expect(out.startsWith('\\ifdefined\\pdfmapfile\\pdfmapfile{=newtx.map}\\fi\\documentclass')).toBe(true);
  });
});
