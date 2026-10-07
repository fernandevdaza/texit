import { describe, expect, it, vi } from 'vitest';
import type { BackendStatus, CompileBackend, CompileRequest, CompileResult } from '../src/types';
import { CoalescingQueue } from '../src/coalesce';
import { CompileService, type CompileStatus } from '../src/service';
import { LruCache } from '../src/lru';

const DOC = '\\documentclass{article}\n\\begin{document}Hi\\end{document}\n';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

class FakeBackend implements CompileBackend {
  kind = 'plugin' as const;
  engines: CompileBackend['engines'] = ['pdflatex', 'xelatex', 'lualatex'];
  calls: CompileRequest[] = [];
  gates: ReturnType<typeof deferred<void>>[] = [];
  manual = false;
  constructor(
    public id: string,
    public available = true,
    public label = id,
  ) {}
  async status(): Promise<BackendStatus> {
    return { available: this.available, detail: this.available ? 'ok' : 'down' };
  }
  async compile(req: CompileRequest): Promise<CompileResult> {
    this.calls.push(req);
    if (this.manual) {
      const g = deferred<void>();
      this.gates.push(g);
      await Promise.race([g.promise, new Promise((r) => req.signal?.addEventListener('abort', r))]);
    }
    if (req.signal?.aborted) return { status: 'cancelled', log: '', diagnostics: [], durationMs: 1, backendId: this.id, engine: req.engine };
    const text = String(req.files.find((f) => f.path === req.mainPath)?.content ?? '');
    const ok = !text.includes('\\error');
    return { status: ok ? 'success' : 'error', pdf: ok ? new Uint8Array([37, 80, 68, 70]) : undefined, log: ok ? 'fine' : '! Undefined control sequence.', diagnostics: [], durationMs: 5, backendId: this.id, engine: req.engine };
  }
}

describe('CoalescingQueue', () => {
  it('runs immediately, then once more with the latest request', async () => {
    const gates: ReturnType<typeof deferred<void>>[] = [];
    const seen: number[] = [];
    const q = new CoalescingQueue<number, number>(async (_k, n) => {
      seen.push(n);
      const g = deferred<void>();
      gates.push(g);
      await g.promise;
      return n * 10;
    });
    const p1 = q.submit('a', 1);
    const p2 = q.submit('a', 2);
    const p3 = q.submit('a', 3);
    const pb = q.submit('b', 7); // other keys are independent
    expect(seen).toEqual([1, 7]);
    gates[0].resolve();
    expect(await p1).toBe(10);
    await tick();
    expect(seen).toEqual([1, 7, 3]); // 2 was dropped
    gates[2].resolve();
    expect(await p2).toBe(30);
    expect(await p3).toBe(30);
    gates[1].resolve();
    expect(await pb).toBe(70);
    expect(q.isRunning('a')).toBe(false);
  });
  it('continues after a failing run and can drop pending work', async () => {
    let n = 0;
    const g = deferred<void>();
    const q = new CoalescingQueue<string, string>(async (_k, r) => {
      n++;
      if (r === 'boom') {
        await g.promise;
        throw new Error('boom');
      }
      return r;
    });
    const p1 = q.submit('k', 'boom');
    const p2 = q.submit('k', 'x');
    expect(q.dropPending('k', 'dropped')).toBe(true);
    g.resolve();
    await expect(p1).rejects.toThrow('boom');
    expect(await p2).toBe('dropped');
    expect(n).toBe(1);
    expect(await q.submit('k', 'y')).toBe('y');
  });
});

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.keys()).toEqual(['a', 'c']);
  });
});

describe('CompileService', () => {
  it('chooses preferred → native → busytex → any available', async () => {
    const native = new FakeBackend('native', false);
    const busy = new FakeBackend('busytex');
    const remote = new FakeBackend('remote');
    const s = new CompileService({ backends: [remote, busy, native] });
    expect((await s.chooseBackend()).backend.id).toBe('busytex');
    native.available = true;
    expect((await s.chooseBackend()).backend.id).toBe('native');
    s.setPreferredBackend('remote');
    expect((await s.chooseBackend()).backend.id).toBe('remote');
    remote.available = false;
    const c = await s.chooseBackend();
    expect(c.backend.id).toBe('native');
    expect(c.note).toMatch(/remote unavailable/);
    remote.engines = ['pdflatex'];
    remote.available = true;
    expect((await s.chooseBackend(undefined, 'xelatex')).backend.id).toBe('native');
  });

  it('compiles with detected settings, fills diagnostics and keeps the last success', async () => {
    const b = new FakeBackend('busytex');
    const parseLog = vi.fn(() => [{ severity: 'error' as const, message: 'Undefined control sequence.' }]);
    const s = new CompileService({ backends: [b], parseLog });
    const statuses: CompileStatus['state'][] = [];
    s.onStatus((st) => statuses.push(st.state));
    const r = await s.compile({ projectId: 'p', files: [{ path: 'main.tex', content: '% !TEX program = xelatex\n' + DOC }] });
    expect(r).toMatchObject({ status: 'success', mainPath: 'main.tex', engine: 'xelatex', backendId: 'busytex' });
    expect(b.calls[0]).toMatchObject({ engine: 'xelatex', synctex: true, bibTool: 'auto', projectId: 'p' });
    expect(statuses).toEqual(['preparing', 'compiling', 'success']);
    expect(s.lastSuccess('p')?.pdf).toBeDefined();

    const bad = await s.compile({ projectId: 'p', files: [{ path: 'main.tex', content: DOC.replace('Hi', '\\error') }] });
    expect(bad.status).toBe('error');
    expect(bad.diagnostics).toEqual([{ severity: 'error', message: 'Undefined control sequence.' }]);
    expect(parseLog).toHaveBeenLastCalledWith('! Undefined control sequence.', { projectPaths: ['main.tex'], mainPath: 'main.tex' });
    expect(s.lastSuccess('p')).toBe(r);
    expect(s.getStatus('p').state).toBe('error');
  });

  it('survives a throwing log parser (core not implemented yet)', async () => {
    const s = new CompileService({ backends: [new FakeBackend('busytex')], parseLog: () => { throw new Error('not implemented'); } });
    const r = await s.compile({ projectId: 'p', files: [{ path: 'main.tex', content: DOC }] });
    expect(r.status).toBe('success');
    expect(r.diagnostics).toEqual([]);
  });

  it('coalesces requests per project and reads the latest snapshot', async () => {
    const b = new FakeBackend('busytex');
    b.manual = true;
    const s = new CompileService({ backends: [b], parseLog: () => [] });
    let version = 1;
    const snapshot = () => [{ path: 'main.tex', content: DOC.replace('Hi', `v${version}`) }];
    const p1 = s.compile({ projectId: 'p', files: snapshot });
    await vi.waitFor(() => expect(b.calls).toHaveLength(1));
    version = 2;
    const p2 = s.compile({ projectId: 'p', files: snapshot });
    version = 3;
    const p3 = s.compile({ projectId: 'p', files: snapshot });
    expect(s.getStatus('p').queued).toBe(true);
    b.gates[0].resolve();
    await p1;
    await vi.waitFor(() => expect(b.calls).toHaveLength(2));
    expect(String(b.calls[1].files[0].content)).toContain('v3');
    b.gates[1].resolve();
    const [r2, r3] = await Promise.all([p2, p3]);
    expect(r2).toBe(r3);
    expect(b.calls).toHaveLength(2);
  });

  it('cancel aborts the running compile and drops the queued one', async () => {
    const b = new FakeBackend('busytex');
    b.manual = true;
    const s = new CompileService({ backends: [b], parseLog: () => [] });
    const p1 = s.compile({ projectId: 'p', files: [{ path: 'main.tex', content: DOC }] });
    await vi.waitFor(() => expect(b.calls).toHaveLength(1));
    const p2 = s.compile({ projectId: 'p', files: [{ path: 'main.tex', content: DOC }] });
    s.cancel('p');
    expect((await p1).status).toBe('cancelled');
    expect((await p2).status).toBe('cancelled');
    expect(b.calls).toHaveLength(1);
    expect(s.getStatus('p').state).toBe('idle');
  });

  it('runs onWillCompile hooks in order and tolerates failures', async () => {
    const b = new FakeBackend('busytex');
    const s = new CompileService({ backends: [b], parseLog: () => [] });
    const out: string[] = [];
    s.onWillCompile((ctx) => [...ctx.files, { path: 'generated.tex', content: 'gen' }]);
    s.onWillCompile(() => {
      throw new Error('plugin bug');
    });
    const d = s.onWillCompile((ctx) => {
      ctx.draft = true;
    });
    await s.compile({ projectId: 'p', files: [{ path: 'main.tex', content: DOC }], onLog: (c) => out.push(c) });
    expect(b.calls[0].files.map((f) => f.path)).toContain('generated.tex');
    expect(b.calls[0].draft).toBe(true);
    expect(out.join('')).toMatch(/hook failed: plugin bug/);
    d.dispose();
    await s.compile({ projectId: 'p', files: [{ path: 'main.tex', content: DOC }] });
    expect(b.calls[1].draft).toBe(false);
  });

  it('reports a clear error when there is no main file or no backend', async () => {
    const s = new CompileService({ backends: [new FakeBackend('busytex', false)], parseLog: () => [] });
    const r = await s.compile({ projectId: 'p', files: [{ path: 'main.tex', content: DOC }] });
    expect(r.status).toBe('error');
    expect(r.log).toMatch(/No compile backend available/);
    const s2 = new CompileService({ backends: [new FakeBackend('busytex')], parseLog: () => [] });
    expect((await s2.compile({ projectId: 'p', files: [{ path: 'notes.txt', content: 'x' }] })).log).toMatch(/No main \.tex file/);
  });

  it('forwards backend prepare progress as preparing status', async () => {
    const b = new FakeBackend('busytex') as FakeBackend & { prepare: CompileBackend['prepare'] };
    b.prepare = async (onProgress) => {
      onProgress?.({ available: true, detail: 'Downloading', progress: 0.5 });
    };
    const s = new CompileService({ backends: [b], parseLog: () => [] });
    const seen: (number | undefined)[] = [];
    s.onStatus((st) => st.state === 'preparing' && seen.push(st.progress));
    await s.compile({ projectId: 'p', files: [{ path: 'main.tex', content: DOC }] });
    expect(seen).toContain(0.5);
  });
});
