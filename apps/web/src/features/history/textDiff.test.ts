import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyMinimalTextDiff, compareFiles, lineStats, summarize } from './textDiff';

function text(initial: string) {
  const doc = new Y.Doc();
  const yt = doc.getText('t');
  yt.insert(0, initial);
  return { doc, yt };
}

describe('applyMinimalTextDiff', () => {
  it('produces the target text', () => {
    const cases: [string, string][] = [
      ['a\nb\nc\n', 'a\nB\nc\n'],
      ['', 'hello\nworld'],
      ['hello\nworld', ''],
      ['one\ntwo\nthree', 'zero\none\nthree\nfour'],
      ['\\section{Intro}\nText here.\n', '\\section{Introduction}\nMore text here.\n\\section{End}\n'],
    ];
    for (const [a, b] of cases) {
      const { yt } = text(a);
      applyMinimalTextDiff(yt, b);
      expect(yt.toString()).toBe(b);
    }
  });

  it('keeps concurrent edits elsewhere in the file (collaborators merge)', () => {
    const base = 'line 1\nline 2\nline 3\nline 4\nline 5\n';
    const a = text(base);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    const bt = b.getText('t');

    // Peer A restores an old version of line 2; peer B concurrently edits line 5.
    applyMinimalTextDiff(a.yt, 'line 1\nold line 2\nline 3\nline 4\nline 5\n');
    bt.insert(bt.toString().indexOf('line 5') + 6, ' (edited by B)');

    Y.applyUpdate(a.doc, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a.doc));
    const expected = 'line 1\nold line 2\nline 3\nline 4\nline 5 (edited by B)\n';
    expect(a.yt.toString()).toBe(expected);
    expect(bt.toString()).toBe(expected);
  });

  it('is a no-op when equal', () => {
    const { doc, yt } = text('same');
    let updates = 0;
    doc.on('update', () => updates++);
    applyMinimalTextDiff(yt, 'same');
    expect(updates).toBe(0);
  });
});

describe('compareFiles', () => {
  it('classifies added / deleted / modified files with line stats', () => {
    const before = [
      { path: 'main.tex', content: 'a\nb\n' },
      { path: 'old.tex', content: 'x\ny\nz\n' },
      { path: 'img.png', content: new Uint8Array([1, 2, 3]) },
    ];
    const after = [
      { path: 'main.tex', content: 'a\nc\nd\n' },
      { path: 'new.tex', content: 'n\n' },
      { path: 'img.png', content: new Uint8Array([1, 2, 3]) },
    ];
    const changes = compareFiles(before, after);
    expect(changes.map((c) => [c.path, c.kind])).toEqual([
      ['main.tex', 'modified'],
      ['new.tex', 'added'],
      ['old.tex', 'deleted'],
    ]);
    expect(changes[0]).toMatchObject({ added: 2, removed: 1 });
    expect(summarize(changes)).toEqual({ files: 3, added: 3, removed: 4, addedFiles: 1, deletedFiles: 1 });
    expect(compareFiles(before, after, { includeUnchanged: true }).find((c) => c.path === 'img.png')?.kind).toBe('unchanged');
  });

  it('counts line changes', () => {
    expect(lineStats('a\nb\n', 'a\nb\n')).toEqual({ added: 0, removed: 0 });
    expect(lineStats('a\n', 'a\nb\nc\n')).toEqual({ added: 2, removed: 0 });
  });
});
