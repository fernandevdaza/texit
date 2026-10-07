import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DATA_PACKAGES,
  buildIndexFromFileLists,
  buildIndexFromProvides,
  collectRequirements,
  escalationTier,
  findMissingFiles,
  loadDataPackageIndex,
  parseProvidesPackageIndex,
  selectDataPackageTier,
} from '../src/busytex/data-packages';

const tiers = DEFAULT_DATA_PACKAGES;
const lists = [
  'build/texlive-basic\nbuild/texlive-basic/texmf-dist/tex/latex/base/article.cls\nbuild/texlive-basic/texmf-dist/tex/latex/amsmath/amsmath.sty\nbuild/texlive-basic/texmf-dist/bibtex/bst/base/plain.bst\nbuild/texlive-basic/texmf-dist/fonts/tfm/public/cm/cmr10.tfm\n',
  'build/texlive-recommended/texmf-dist/tex/latex/base/article.cls\nbuild/texlive-recommended/texmf-dist/tex/latex/amsmath/amsmath.sty\n/x/tikz.sty\n/x/fontspec.sty\n/x/beamer.cls\n/x/pgflibraryarrows.meta.code.tex\n/x/qhvr.pfb\n',
  '/x/article.cls\n/x/amsmath.sty\n/x/tikz.sty\n/x/fontspec.sty\n/x/beamer.cls\n/x/biblatex.sty\n/x/numeric.bbx\n/x/numeric.cbx\n/x/tikzlibrarycd.code.tex\n/x/xeCJK-missing-on-purpose\n',
];
const index = buildIndexFromFileLists(tiers, lists);

describe('indexes', () => {
  it('maps basenames to the smallest tier', () => {
    expect(index.lookup('amsmath.sty')).toBe(0);
    expect(index.lookup('tikz.sty')).toBe(1);
    expect(index.lookup('biblatex.sty')).toBe(2);
    expect(index.lookup('IEEEtran.cls')).toBeUndefined();
    expect(index.lookup('AMSMATH.STY')).toBe(0);
    expect(index.complete).toBe(true);
  });
  it('parses providespackage indexes', () => {
    const text = '// \\ProvidesPackage{hyperref}\n//   \\ProvidesPackage{geometry}[2020/01/02 v5]\n//  {\\@expl@provides@file@@Nnnnnn\\ProvidesPackage{Package}}\n//  \\ProvidesPackage{#1}\n';
    expect(parseProvidesPackageIndex(text).sort()).toEqual(['geometry', 'hyperref']);
    const partial = buildIndexFromProvides(tiers, [text, '// \\ProvidesPackage{xcolor}', '']);
    expect(partial.lookup('xcolor.sty')).toBe(1);
    expect(partial.complete).toBe(false);
  });
  it('loads the best available index and ignores SPA html fallbacks', async () => {
    const html = new Response('<!doctype html><html></html>', { headers: { 'content-type': 'text/html' } });
    const fetchFn = (async (url: string) => {
      if (url.endsWith('texlive-basic.txt')) return html.clone();
      if (url.endsWith('.providespackage.txt')) return new Response('// \\ProvidesPackage{amsmath}');
      return new Response('nope', { status: 404 });
    }) as unknown as typeof fetch;
    const idx = await loadDataPackageIndex('/busytex/', tiers, fetchFn);
    expect(idx?.source).toBe('providespackage');
    const none = await loadDataPackageIndex('/busytex/', tiers, (async () => new Response('', { status: 404 })) as unknown as typeof fetch);
    expect(none).toBeNull();
  });
});

describe('requirements & selection', () => {
  it('collects requirements from all tex/sty/cls files, minus project files', () => {
    const req = collectRequirements([
      { path: 'main.tex', content: '\\documentclass{beamer}\\usepackage{amsmath,mylocal}\\usetikzlibrary{arrows.meta}\\bibliographystyle{plain}\\input{chap}' },
      { path: 'mylocal.sty', content: '\\RequirePackage{tikz}' },
      { path: 'chap.tex', content: '' },
      { path: 'img.png', content: new Uint8Array([1, 2]) },
    ]);
    expect(req).toEqual(['amsmath.sty', 'beamer.cls', 'plain.bst', 'tikz.sty', 'tikzlibraryarrows.meta.code.tex|pgflibraryarrows.meta.code.tex']);
  });
  it('picks the smallest sufficient tier', () => {
    expect(selectDataPackageTier(['article.cls', 'amsmath.sty'], index)).toMatchObject({ tier: 0, drivers: [] });
    expect(selectDataPackageTier(['article.cls', 'tikz.sty', 'tikzlibraryarrows.meta.code.tex|pgflibraryarrows.meta.code.tex'], index)).toMatchObject({ tier: 1, drivers: ['tikz.sty', 'tikzlibraryarrows.meta.code.tex|pgflibraryarrows.meta.code.tex'], unknown: [] });
    expect(selectDataPackageTier(['biblatex.sty', 'tikz.sty'], index)).toMatchObject({ tier: 2, drivers: ['biblatex.sty'] });
    expect(selectDataPackageTier(['amsmath.sty'], index, { minTier: 1 }).tier).toBe(1);
  });
  it('does not escalate for files no tier has (complete index)', () => {
    expect(selectDataPackageTier(['IEEEtran.cls', 'amsmath.sty'], index)).toMatchObject({ tier: 0, unknown: ['IEEEtran.cls'], escalatedForUnknown: false });
  });
  it('escalates unknown packages to the top tier with a partial index (unless remote)', () => {
    const partial = buildIndexFromProvides(tiers, ['// \\ProvidesPackage{amsmath}', '', '']);
    expect(selectDataPackageTier(['amsmath.sty', 'article.cls'], partial).tier).toBe(0);
    expect(selectDataPackageTier(['amsmath.sty', 'tikz.sty'], partial)).toMatchObject({ tier: 2, escalatedForUnknown: true });
    expect(selectDataPackageTier(['tikz.sty'], partial, { hasRemoteEndpoint: true }).tier).toBe(0);
  });
  it('without an index uses the minimum tier', () => {
    expect(selectDataPackageTier(['tikz.sty'], null, { minTier: 1 })).toMatchObject({ tier: 1, unknown: ['tikz.sty'] });
  });
});

describe('missing files & escalation', () => {
  const log = String.raw`
! LaTeX Error: File ` + '`tikz.sty' + String.raw`' not found.
! I can't find file ` + '`chapter3' + String.raw`'.
kpathsea: Running mktexpk --mfmode / --bdpi 600 --mag 1+264/600 --dpi 864 ec-qhvr
xdvipdfmx:warning: Could not locate a virtual/physical font for TFM "ec-qhvr".
I couldn't open style file IEEEtran.bst
! Font \T1/foo/m/n/10=foo1000 at 10.0pt not loadable: Metric (TFM) file not found.
! Package fontspec Error: The font "TeX Gyre Pagella" cannot be found.
`;
  it('extracts missing file names', () => {
    const m = findMissingFiles(log);
    for (const f of ['tikz.sty', 'chapter3.tex', 'ec-qhvr.tfm', 'ec-qhvr.vf', 'ec-qhvr.pfb', 'IEEEtran.bst', 'foo1000.tfm', 'texgyrepagella-regular.otf']) expect(m).toContain(f);
  });
  it('escalates only when a bigger tier helps', () => {
    expect(escalationTier(['tikz.sty'], index, 0, 3)).toBe(1);
    expect(escalationTier(['biblatex.sty', 'tikz.sty'], index, 0, 3)).toBe(2);
    expect(escalationTier(['IEEEtran.cls'], index, 0, 3)).toBeUndefined();
    expect(escalationTier(['tikz.sty'], index, 2, 3)).toBeUndefined();
    expect(escalationTier(['whatever.sty'], null, 0, 3)).toBe(2);
    expect(escalationTier([], null, 0, 3)).toBeUndefined();
  });
});

// Real BusyTeX listings (only when the assets were downloaded).
const assets = fileURLToPath(new URL('../../../apps/web/public/busytex/', import.meta.url));
describe.skipIf(!existsSync(`${assets}texlive-extra.txt`))('real BusyTeX listings', () => {
  const real = buildIndexFromFileLists(tiers, tiers.map((t) => readFileSync(`${assets}${t}.txt`, 'utf8')));
  it('classifies common packages', () => {
    const tierOf = (files: string[]) => tiers[selectDataPackageTier(files, real).tier];
    expect(tierOf(['article.cls', 'amsmath.sty', 'graphicx.sty', 'hyperref.sty', 'geometry.sty'])).toBe('texlive-basic');
    expect(tierOf(['tikz.sty', 'xcolor.sty', 'booktabs.sty', 'fontspec.sty', 'beamer.cls'])).toBe('texlive-recommended');
    expect(tierOf(['biblatex.sty'])).toBe('texlive-extra');
    expect(selectDataPackageTier(['IEEEtran.cls'], real).unknown).toEqual(['IEEEtran.cls']);
  });
});
