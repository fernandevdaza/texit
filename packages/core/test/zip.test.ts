import { describe, expect, it } from 'vitest';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { decodeText, exportZip, importZip } from '../src/zip';
import type { ProjectFile } from '../src/types';

const MAIN = '\\documentclass{article}\n\\begin{document}\nHéllo — wörld\n\\end{document}\n';

describe('zip', () => {
  it('round-trips text and binary files', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
    const files: ProjectFile[] = [
      { path: 'main.tex', content: MAIN },
      { path: 'chapters/intro.tex', content: '\\section{Intro}' },
      { path: 'figures/logo.png', content: png },
      { path: 'refs.bib', content: '@article{a, title={T}}' },
    ];
    const zip = exportZip(files);
    const back = importZip(zip, 'My Paper.zip');
    expect(back.files.map((f) => f.path)).toEqual(['chapters/intro.tex', 'figures/logo.png', 'main.tex', 'refs.bib']);
    expect(back.files.find((f) => f.path === 'main.tex')!.content).toBe(MAIN);
    expect(back.files.find((f) => f.path === 'figures/logo.png')!.content).toEqual(png);
    expect(back.mainPath).toBe('main.tex');
    expect(back.suggestedName).toBe('My Paper');
  });

  it('exports into a root folder and strips it again on import', () => {
    const zip = exportZip([{ path: 'paper.tex', content: MAIN }, { path: 'img/a.jpg', content: new Uint8Array([1]) }], { rootFolder: 'Thesis 2026' });
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(['Thesis 2026/img/a.jpg', 'Thesis 2026/paper.tex']);
    const back = importZip(zip, 'download.zip');
    expect(back.suggestedName).toBe('Thesis 2026');
    expect(back.files.map((f) => f.path)).toEqual(['img/a.jpg', 'paper.tex']);
    expect(back.mainPath).toBe('paper.tex');
  });

  it('strips nested common roots and ignores junk and build artefacts', () => {
    const zip = zipSync({
      'repo-main/': new Uint8Array(),
      'repo-main/paper/main.tex': strToU8(MAIN),
      'repo-main/paper/sections/a.tex': strToU8('A'),
      'repo-main/paper/main.aux': strToU8('aux'),
      'repo-main/paper/main.log': strToU8('log'),
      'repo-main/paper/main.synctex.gz': new Uint8Array([1]),
      'repo-main/paper/main.fdb_latexmk': strToU8('x'),
      'repo-main/paper/main.fls': strToU8('x'),
      'repo-main/paper/main.bbl': strToU8('keep me'),
      'repo-main/paper/.DS_Store': new Uint8Array([0]),
      'repo-main/paper/.git/config': strToU8('x'),
      'repo-main/paper/_minted-main/x.pygtex': strToU8('x'),
      '__MACOSX/repo-main/paper/._main.tex': new Uint8Array([0]),
    });
    const r = importZip(zip);
    expect(r.files.map((f) => f.path)).toEqual(['main.bbl', 'main.tex', 'sections/a.tex']);
    expect(r.suggestedName).toBe('repo-main');
    expect(r.mainPath).toBe('main.tex');
  });

  it('does not strip when files are at different roots', () => {
    const zip = zipSync({ 'a/main.tex': strToU8(MAIN), 'b.tex': strToU8('x') });
    const r = importZip(zip, 'x.zip');
    expect(r.files.map((f) => f.path)).toEqual(['a/main.tex', 'b.tex']);
    expect(r.mainPath).toBe('a/main.tex');
    expect(r.suggestedName).toBe('x');
  });

  it('decodes latin1 text and Windows paths', () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1
    const zip = zipSync({ 'dir\\notes.tex': latin1, 'bom.tex': new Uint8Array([0xef, 0xbb, 0xbf, 0x41]) });
    const r = importZip(zip);
    expect(r.files).toEqual([
      { path: 'bom.tex', content: 'A' },
      { path: 'dir/notes.tex', content: 'café' },
    ]);
    expect(decodeText(strToU8('ünïcode'))).toBe('ünïcode');
    expect(r.mainPath).toBeUndefined();
  });

  it('prefers a real main file over subfiles and standalone figures', () => {
    const zip = zipSync({
      'fig.tex': strToU8('\\documentclass{standalone}\\begin{document}\\end{document}'),
      'ch1.tex': strToU8('\\documentclass[thesis.tex]{subfiles}\\begin{document}\\end{document}'),
      'thesis.tex': strToU8('\\documentclass{report}\\begin{document}\\end{document}'),
    });
    expect(importZip(zip).mainPath).toBe('thesis.tex');
  });
});
