import { describe, expect, it } from 'vitest';
import { ProjectDoc, type HostWatchEvent, type TexitHost } from '@texit/core';
import { FolderSync, threeWayMerge } from './folder-sync';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array | string) => (typeof b === 'string' ? b : new TextDecoder().decode(b));
const DIR = '/mirror';

/** In-memory host.fs that echoes our own writes back through the watcher, like chokidar would. */
function fakeHost() {
  const files = new Map<string, Uint8Array>();
  const ops: string[] = [];
  let watcher: ((e: HostWatchEvent[]) => void) | null = null;
  const rel = (abs: string) => abs.slice(DIR.length + 1);
  const emit = (events: HostWatchEvent[]) => watcher?.(events);
  const host = {
    platform: 'darwin',
    fs: {
      mkdir: async () => undefined,
      readTree: async () => [...files].map(([p, content]) => ({ path: rel(p), content, mtimeMs: 0 })),
      readFile: async (p: string) => files.get(p)!,
      writeFile: async (p: string, c: Uint8Array | string) => {
        const bytes = typeof c === 'string' ? enc(c) : c;
        const existed = files.has(p);
        files.set(p, bytes);
        ops.push(`write ${rel(p)}`);
        emit([{ type: existed ? 'change' : 'add', path: rel(p), content: bytes }]);
      },
      remove: async (p: string) => {
        files.delete(p);
        ops.push(`remove ${rel(p)}`);
        emit([{ type: 'unlink', path: rel(p) }]);
      },
      rename: async (a: string, b: string) => {
        files.set(b, files.get(a)!);
        files.delete(a);
        ops.push(`rename ${rel(a)} -> ${rel(b)}`);
        emit([{ type: 'unlink', path: rel(a) }, { type: 'add', path: rel(b), content: files.get(b) }]);
      },
      watch: async (_dir: string, cb: (e: HostWatchEvent[]) => void) => {
        watcher = cb;
        return () => (watcher = null);
      },
    },
  } as unknown as TexitHost;
  /** Simulate an external program (CLI agent / editor) changing the folder. */
  const external = (events: HostWatchEvent[]) => {
    for (const e of events) {
      if (e.type === 'unlink') files.delete(`${DIR}/${e.path}`);
      else if (e.content) files.set(`${DIR}/${e.path}`, e.content);
    }
    emit(events);
  };
  return { host, files, ops, external, read: (p: string) => dec(files.get(`${DIR}/${p}`)!) };
}

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

function makeProject() {
  const p = new ProjectDoc();
  p.init({ id: 'p', name: 'P' });
  p.createFile('main.tex', '\\documentclass{article}\nA\nB\nC\n');
  p.createFile('figs/plot.png', new Uint8Array([1, 2, 3]));
  return p;
}

describe('FolderSync', () => {
  it('mirrors the project to disk and back without echo loops', async () => {
    const project = makeProject();
    const fx = fakeHost();
    fx.files.set(`${DIR}/stale.txt`, enc('old'));
    const sync = new FolderSync({ project, dir: DIR, host: fx.host, debounceMs: 5 });
    await sync.start();
    expect(fx.read('main.tex')).toContain('documentclass');
    expect([...fx.files.get(`${DIR}/figs/plot.png`)!]).toEqual([1, 2, 3]);
    expect(fx.files.has(`${DIR}/stale.txt`)).toBe(false);
    const writesAfterStart = fx.ops.filter((o) => o.startsWith('write')).length;

    // Y → disk
    const id = project.findByPath('main.tex')!;
    project.getYText(id)!.insert(0, '% hi\n');
    await tick();
    await sync.flush();
    expect(fx.read('main.tex').startsWith('% hi\n')).toBe(true);
    expect(fx.ops.filter((o) => o.startsWith('write')).length).toBe(writesAfterStart + 1); // the echo did not trigger another write

    // disk → Y (external edit), applied as a minimal diff
    fx.external([{ type: 'change', path: 'main.tex', content: enc(fx.read('main.tex').replace('B', 'BEE')) }]);
    await tick();
    await sync.flush();
    expect(project.readText(id)).toContain('BEE');
    expect(fx.ops.filter((o) => o.startsWith('write')).length).toBe(writesAfterStart + 1);

    // external add + delete
    fx.external([{ type: 'add', path: 'sec/new.tex', content: enc('new') }]);
    await tick();
    expect(project.readPath('sec/new.tex')).toBe('new');
    fx.external([{ type: 'unlink', path: 'sec/new.tex' }]);
    await tick();
    expect(project.findByPath('sec/new.tex')).toBeNull();
    await sync.stop();
  });

  it('keeps node ids for external renames and renames on disk for project renames', async () => {
    const project = makeProject();
    const fx = fakeHost();
    const sync = new FolderSync({ project, dir: DIR, host: fx.host, debounceMs: 5 });
    await sync.start();
    const id = project.findByPath('main.tex')!;
    const content = fx.files.get(`${DIR}/main.tex`)!;
    fx.external([{ type: 'unlink', path: 'main.tex' }, { type: 'add', path: 'paper.tex', content }]);
    await tick();
    expect(project.findByPath('paper.tex')).toBe(id);

    project.rename(id, 'thesis.tex');
    await tick();
    await sync.flush();
    expect(fx.ops).toContain('rename paper.tex -> thesis.tex');
    expect(fx.files.has(`${DIR}/paper.tex`)).toBe(false);

    project.delete(project.findByPath('figs/plot.png')!);
    await tick();
    await sync.flush();
    expect(fx.files.has(`${DIR}/figs/plot.png`)).toBe(false);
    await sync.stop();
  });

  it('merges concurrent local and disk edits (3-way)', async () => {
    const project = makeProject();
    const fx = fakeHost();
    const conflicts: string[] = [];
    const sync = new FolderSync({ project, dir: DIR, host: fx.host, debounceMs: 10_000, onConflict: (c) => conflicts.push(c.resolution) });
    await sync.start();
    const id = project.findByPath('main.tex')!;
    // Local (unflushed) edit on line "A", external edit on line "C".
    project.writeFile(id, project.readText(id).replace('A\n', 'A local\n'));
    fx.external([{ type: 'change', path: 'main.tex', content: enc(fx.read('main.tex').replace('C\n', 'C disk\n')) }]);
    await tick();
    expect(conflicts).toEqual(['merged']);
    expect(project.readText(id)).toBe('\\documentclass{article}\nA local\nB\nC disk\n');
    await sync.flush();
    expect(fx.read('main.tex')).toBe('\\documentclass{article}\nA local\nB\nC disk\n');
    await sync.stop();
  });

  it('imports a folder with disk-to-project', async () => {
    const project = new ProjectDoc();
    project.init({ id: 'q', name: 'Q' });
    project.createFile('only-in-project.tex', 'x');
    const fx = fakeHost();
    fx.files.set(`${DIR}/main.tex`, enc('\\documentclass{article}'));
    fx.files.set(`${DIR}/img/a.png`, new Uint8Array([9]));
    const changed: string[] = [];
    const sync = new FolderSync({ project, dir: DIR, host: fx.host, initial: 'disk-to-project', onDiskChange: (p) => changed.push(...p) });
    await sync.start();
    expect(project.listFiles().map((f) => f.path)).toEqual(['img/a.png', 'main.tex']);
    expect(changed.sort()).toEqual(['img/a.png', 'main.tex']);
    expect(fx.ops.filter((o) => o.startsWith('write'))).toEqual([]);
    await sync.stop();
  });
});

describe('threeWayMerge', () => {
  it('merges non-overlapping edits and reports overlapping ones', () => {
    expect(threeWayMerge('a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n')).toBe('A\nb\nC\n');
    expect(threeWayMerge('a\n', 'x\n', 'y\n')).toBe(false);
    expect(threeWayMerge('a', 'a', 'b')).toBe('b');
  });
});
