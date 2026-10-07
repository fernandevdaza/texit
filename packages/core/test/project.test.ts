import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import {
  ProjectDoc,
  ROOT_ID,
  applyTextDiff,
  createProjectFromFiles,
  decodeProject,
  detectMainPath,
  encodeProject,
} from '../src/project';
import {
  basename,
  dirname,
  extname,
  isImagePath,
  isPdfPath,
  isTextPath,
  isTexPath,
  joinPath,
  normalizePath,
  resolveRelative,
  stripExtension,
  uniquePath,
} from '../src/paths';

describe('paths', () => {
  it('normalizes', () => {
    expect(normalizePath('./a//b/../c/')).toBe('a/c');
    expect(normalizePath('\\a\\b\\c.tex')).toBe('a/b/c.tex');
    expect(normalizePath('/abs/x')).toBe('abs/x');
    expect(normalizePath('../../x')).toBe('x');
    expect(joinPath('a', '', 'b/', '/c')).toBe('a/b/c');
    expect(dirname('a/b/c.tex')).toBe('a/b');
    expect(dirname('c.tex')).toBe('');
    expect(basename('a/b/c.tex')).toBe('c.tex');
    expect(extname('a/B.TeX')).toBe('tex');
    expect(extname('.gitignore')).toBe('');
    expect(extname('archive.synctex.gz')).toBe('gz');
    expect(stripExtension('a/b.tex')).toBe('a/b');
    expect(stripExtension('Makefile')).toBe('Makefile');
  });

  it('classifies files', () => {
    expect(isTextPath('main.tex')).toBe(true);
    expect(isTextPath('refs.bib')).toBe(true);
    expect(isTextPath('.latexmkrc')).toBe(true);
    expect(isTextPath('Makefile')).toBe(true);
    expect(isTextPath('fig.png')).toBe(false);
    expect(isTextPath('doc.pdf')).toBe(false);
    expect(isTexPath('a.ltx')).toBe(true);
    expect(isTexPath('a.sty')).toBe(false);
    expect(isImagePath('x.JPG')).toBe(true);
    expect(isPdfPath('x.pdf')).toBe(true);
  });

  it('makes unique paths and resolves relative references', () => {
    const existing = new Set(['a/fig.png', 'a/fig (2).png']);
    expect(uniquePath('a/fig.png', (p) => existing.has(p))).toBe('a/fig (3).png');
    expect(uniquePath('a/new.png', (p) => existing.has(p))).toBe('a/new.png');
    expect(uniquePath('README', (p) => p === 'README')).toBe('README (2)');
    expect(resolveRelative('chapters/one.tex', 'fig.png')).toBe('chapters/fig.png');
    expect(resolveRelative('chapters/one.tex', '/fig.png')).toBe('fig.png');
    expect(resolveRelative('main.tex', '../x.tex')).toBe('x.tex');
  });
});

describe('ProjectDoc', () => {
  const make = () => {
    const p = new ProjectDoc();
    p.init({ id: 'p1', name: 'Test' });
    return p;
  };

  it('initialises meta without overwriting', () => {
    const p = make();
    expect(p.getMeta()).toMatchObject({ id: 'p1', name: 'Test', engine: 'pdflatex', bibTool: 'auto', mainFileId: '', language: 'en-US', tags: [] });
    p.setMeta({ engine: 'xelatex' });
    p.init({ id: 'p1', name: 'Other', engine: 'lualatex' });
    expect(p.getMeta()).toMatchObject({ name: 'Test', engine: 'xelatex' });
  });

  it('creates files and folders', () => {
    const p = make();
    const id = p.createFile('chapters/intro.tex', 'Hello');
    const img = p.createFile('figs/a.png', new Uint8Array([1, 2, 3]));
    expect(p.readText(id)).toBe('Hello');
    expect(p.getNode(id)).toMatchObject({ path: 'chapters/intro.tex', name: 'intro.tex', kind: 'file', isText: true, size: 5 });
    expect(p.getNode(img)).toMatchObject({ isText: false, size: 3 });
    expect(p.readBinary(img)).toEqual(new Uint8Array([1, 2, 3]));
    expect(p.findByPath('chapters')).not.toBeNull();
    expect(p.list().map((n) => `${n.kind}:${n.path}`)).toEqual([
      'folder:chapters', 'file:chapters/intro.tex', 'folder:figs', 'file:figs/a.png',
    ]);
    expect(p.children(ROOT_ID).map((n) => n.name)).toEqual(['chapters', 'figs']);
    // Overwrite keeps the id.
    expect(p.createFile('chapters/intro.tex', 'Hi')).toBe(id);
    expect(p.readPath('chapters/intro.tex')).toBe('Hi');
    expect(p.readPath('missing.tex')).toBeNull();
    // A text path given bytes is decoded.
    const t = p.createFile('notes.txt', new TextEncoder().encode('héllo'));
    expect(p.readText(t)).toBe('héllo');
    expect(() => p.createFile('chapters', 'x')).toThrow();
    expect(() => p.createFile('', 'x')).toThrow();
  });

  it('renames, moves, duplicates and deletes', () => {
    const p = make();
    const dir = p.createFolder('src');
    const f = p.createFile('a.tex', 'A');
    p.rename(f, 'b.tex');
    expect(p.getNode(f)!.path).toBe('b.tex');
    // tex → png switches storage to binary
    p.rename(f, 'b.png');
    expect(p.getNode(f)!.isText).toBe(false);
    expect(new TextDecoder().decode(p.readBinary(f))).toBe('A');
    p.rename(f, 'b.tex');
    expect(p.readText(f)).toBe('A');
    p.createFile('c.tex', 'C');
    expect(() => p.rename(f, 'c.tex')).toThrow(/already exists/);

    p.move(f, dir);
    expect(p.getNode(f)!.path).toBe('src/b.tex');
    expect(() => p.move(dir, dir)).toThrow();
    const sub = p.createFolder('src/sub');
    expect(() => p.move(dir, sub)).toThrow(/into itself/);
    expect(() => p.move(f, p.findByPath('c.tex')!)).toThrow(/not a folder/);
    p.createFile('b.tex', 'root b');
    expect(() => p.move(f, ROOT_ID)).toThrow(/already exists/);

    const copy = p.duplicate(f)!;
    expect(p.getNode(copy)!.path).toBe('src/b copy.tex');
    const copy2 = p.duplicate(f)!;
    expect(p.getNode(copy2)!.path).toBe('src/b copy 2.tex');
    expect(p.duplicate(dir)).toBeNull();

    p.setMeta({ mainFileId: f });
    p.delete(dir);
    expect(p.has(f)).toBe(false);
    expect(p.has(sub)).toBe(false);
    expect(p.has(copy)).toBe(false);
    expect(p.getMeta().mainFileId).toBe('');
    expect(p.listFiles().map((n) => n.path)).toEqual(['b.tex', 'c.tex']);
  });

  it('imports files and snapshots', () => {
    const p = make();
    p.importFiles([
      { path: 'main.tex', content: '\\documentclass{article}' },
      { path: 'img/x.png', content: new Uint8Array([9]) },
      { path: '', content: 'ignored' },
    ]);
    p.importFiles([{ path: 'part.tex', content: 'p' }], { into: 'sub' });
    expect(p.snapshot().map((f) => f.path)).toEqual(['img/x.png', 'main.tex', 'sub/part.tex']);
    p.importFiles([{ path: 'only.tex', content: 'o' }], { replace: true });
    expect(p.snapshot()).toEqual([{ path: 'only.tex', content: 'o' }]);
  });

  it('detects the main file', () => {
    const p = make();
    p.createFile('chapters/one.tex', '\\chapter{One}');
    p.createFile('figure.tex', '\\documentclass{standalone}\n\\begin{document}x\\end{document}');
    p.createFile('thesis.tex', '% \\documentclass{fake}\n\\documentclass{book}\n\\begin{document}\\end{document}');
    expect(p.getNode(p.getMainFileId()!)!.path).toBe('thesis.tex');
    const m = p.createFile('main.tex', '\\documentclass{article}\\begin{document}\\end{document}');
    expect(p.getMainFileId()).toBe(m);
    const explicit = p.findByPath('chapters/one.tex')!;
    p.setMeta({ mainFileId: explicit });
    expect(p.getMainFileId()).toBe(explicit);

    expect(detectMainPath([
      { path: 'sub/main.tex', content: '\\documentclass{article}\\begin{document}' },
      { path: 'chap.tex', content: '\\documentclass[main.tex]{subfiles}\\begin{document}' },
      { path: 'paper.tex', content: '%\\documentclass{x}' },
    ])).toBe('sub/main.tex');
    expect(detectMainPath([{ path: 'a.tex', content: 'no class' }])).toBeUndefined();
  });

  it('applyTextDiff makes minimal edits', () => {
    const doc = new Y.Doc();
    const t = doc.getText('t');
    t.insert(0, 'Hello brave world');
    const deltas: unknown[] = [];
    t.observe((e) => deltas.push(e.delta));
    applyTextDiff(t, 'Hello new world');
    expect(t.toString()).toBe('Hello new world');
    expect(deltas).toEqual([[{ retain: 6 }, { delete: 5 }, { insert: 'new' }]]);
    applyTextDiff(t, 'Hello new world');
    expect(deltas.length).toBe(1);
    applyTextDiff(t, '');
    expect(t.toString()).toBe('');
  });

  it('writeFile preserves concurrent edits elsewhere', () => {
    const a = make();
    const id = a.createFile('main.tex', 'line one\nline two\nline three\n');
    const b = decodeProject(encodeProject(a));
    // A edits line one via writeFile (diff), B types into line three concurrently.
    a.writeFile(id, 'LINE ONE\nline two\nline three\n');
    b.getYText(id)!.insert('line one\nline two\nline three'.length, '!');
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    expect(a.readText(id)).toBe('LINE ONE\nline two\nline three!\n');
    expect(b.readText(id)).toBe(a.readText(id));
  });

  it('syncs two docs through incremental updates', () => {
    const a = new ProjectDoc();
    const b = new ProjectDoc();
    a.doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') Y.applyUpdate(b.doc, u, 'remote');
    });
    b.doc.on('update', (u: Uint8Array, origin: unknown) => {
      if (origin !== 'remote') Y.applyUpdate(a.doc, u, 'remote');
    });
    a.init({ id: 'p', name: 'Shared' });
    const id = a.createFile('main.tex', 'abc');
    expect(b.readText(id)).toBe('abc');
    b.getYText(id)!.insert(3, 'def');
    a.getYText(id)!.insert(0, '>');
    expect(a.readText(id)).toBe('>abcdef');
    expect(b.readText(id)).toBe('>abcdef');
    b.rename(id, 'paper.tex');
    expect(a.getNode(id)!.path).toBe('paper.tex');
    expect(b.getMeta().name).toBe('Shared');
  });

  it('handles concurrent conflicting operations without corruption', () => {
    const a = new ProjectDoc();
    a.init({ id: 'p', name: 'x' });
    const dir = a.createFolder('dir');
    const f = a.createFile('dir/f.tex', 'f');
    const b = decodeProject(encodeProject(a));
    // A deletes the folder while B edits a file inside it.
    a.delete(dir);
    b.getYText(f)!.insert(1, 'oo');
    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b.doc));
    Y.applyUpdate(b.doc, Y.encodeStateAsUpdate(a.doc));
    for (const p of [a, b]) {
      expect(p.listFiles().map((n) => n.path)).toEqual([]);
    }
  });

  it('notifies observers', () => {
    const p = make();
    const tree = vi.fn();
    const content = vi.fn();
    const offTree = p.onTreeChange(tree);
    const offContent = p.onContentChange(content);
    const id = p.createFile('a.tex', 'x');
    expect(tree).toHaveBeenCalled();
    content.mockClear();
    p.getYText(id)!.insert(1, 'y');
    expect(content).toHaveBeenCalledWith(new Set([id]));
    const img = p.createFile('i.png', new Uint8Array([1]));
    expect(content.mock.calls.some(([ids]) => (ids as Set<string>).has(img))).toBe(true);
    offTree();
    offContent();
    tree.mockClear();
    p.createFile('b.tex', '');
    expect(tree).not.toHaveBeenCalled();
  });

  it('builds a project from files', () => {
    const p = createProjectFromFiles({ id: 'x', name: 'From files' }, [
      { path: 'paper.tex', content: '\\documentclass{article}\\begin{document}\\end{document}' },
      { path: 'other.tex', content: 'x' },
    ]);
    expect(p.getNode(p.getMeta().mainFileId)!.path).toBe('paper.tex');
    const q = createProjectFromFiles({ id: 'y', name: 'n' }, [{ path: 'a.tex', content: '' }, { path: 'b.tex', content: '' }], 'b.tex');
    expect(q.getNode(q.getMainFileId()!)!.path).toBe('b.tex');
  });
});
