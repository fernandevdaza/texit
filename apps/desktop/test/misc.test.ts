import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { extractDeepLinks, extractOpenPaths, PendingQueue } from '../src/main/open-paths';
import { fitToDisplays } from '../src/main/window-state';
import { isIgnoredPath } from '../src/main/files/ignore';
import { collapseEvents, readTree, watchDir, writeFileAtomic } from '../src/main/files/files';
import { clientConfigSnippets } from '../src/main/mcp/snippets';

describe('open paths', () => {
  const exists = (p: string) => ['/home/me/paper.tex', '/home/me/thesis'].includes(p);
  it('extracts existing paths from packaged argv', () => {
    expect(extractOpenPaths(['/opt/TexIt/texit', '--flag', 'paper.tex', 'missing.tex', 'texit://open', '/home/me/thesis'], { cwd: '/home/me', isPackaged: true, exists })).toEqual([
      '/home/me/paper.tex',
      '/home/me/thesis',
    ]);
  });
  it('skips the entry script in dev and honours --', () => {
    expect(extractOpenPaths(['electron', '.', '--', '-weird.tex', 'paper.tex'], { cwd: '/home/me', isPackaged: false, exists: (p) => p.endsWith('.tex') })).toEqual([
      '/home/me/-weird.tex',
      '/home/me/paper.tex',
    ]);
  });
  it('extracts deep links', () => {
    expect(extractDeepLinks(['x', 'texit://join/abc', 'https://x', 'TEXIT://open?p=1'])).toEqual(['texit://join/abc', 'TEXIT://open?p=1']);
  });
  it('queues until a sink is attached', () => {
    const q = new PendingQueue<string>();
    q.push('a');
    q.push('b');
    const got: string[] = [];
    q.attach((x) => (got.push(x), true));
    q.push('c');
    expect(got).toEqual(['a', 'b', 'c']);
    q.detach();
    q.push('d');
    expect(q.size).toBe(1);
  });
});

describe('window state', () => {
  const displays = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  it('keeps visible bounds and clamps sizes', () => {
    expect(fitToDisplays({ x: 100, y: 100, width: 1200, height: 800, maximized: true }, displays)).toEqual({ x: 100, y: 100, width: 1200, height: 800, maximized: true, fullscreen: false });
    expect(fitToDisplays({ x: 0, y: 0, width: 100, height: 100 }, displays)).toMatchObject({ width: 720, height: 480 });
  });
  it('drops positions on unplugged monitors', () => {
    const s = fitToDisplays({ x: 3000, y: 100, width: 1200, height: 800 }, displays);
    expect(s.x).toBeUndefined();
    expect(s.width).toBe(1200);
  });
});

describe('ignore rules', () => {
  it('ignores VCS, deps and LaTeX artefacts but keeps sources', () => {
    for (const p of ['.git/config', 'node_modules/x/index.js', 'main.aux', 'main.synctex.gz', 'build/main.fdb_latexmk', '.DS_Store', 'sub/.#main.tex', 'main.log', '_minted-main/x.pygtex']) {
      expect(isIgnoredPath(p), p).toBe(true);
    }
    for (const p of ['main.tex', 'refs.bib', 'figs/plot.pdf', 'figs/a.png', 'latexmkrc', '.latexmkrc', 'style.sty', 'data.csv']) {
      expect(isIgnoredPath(p), p).toBe(false);
    }
  });
});

describe('fs services', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texit-fs-'));
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('collapses watch events', () => {
    expect(
      collapseEvents([
        { type: 'add', path: 'a' },
        { type: 'change', path: 'a' },
        { type: 'add', path: 'b' },
        { type: 'unlink', path: 'b' },
        { type: 'unlink', path: 'c' },
        { type: 'add', path: 'c' },
      ]),
    ).toEqual([
      { type: 'add', path: 'a' },
      { type: 'change', path: 'c' },
    ]);
  });

  it('writes atomically and reads a tree without artefacts', async () => {
    await writeFileAtomic(path.join(dir, 'main.tex'), 'hello');
    await writeFileAtomic(path.join(dir, 'figs', 'x.png'), new Uint8Array([1, 2, 3]));
    fs.writeFileSync(path.join(dir, 'main.aux'), 'aux');
    fs.mkdirSync(path.join(dir, '.git'));
    fs.writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref');
    const tree = await readTree(dir);
    expect(tree.map((f) => f.path)).toEqual(['figs/x.png', 'main.tex']);
    expect(Buffer.from(tree[1].content).toString()).toBe('hello');
    expect(fs.readdirSync(dir).some((n) => n.includes('texit-tmp'))).toBe(false);
  });

  it('watches with debounced batches that carry content', async () => {
    const batches: { type: string; path: string; text?: string }[][] = [];
    const w = watchDir(dir, (evs) => batches.push(evs.map((e) => ({ type: e.type, path: e.path, text: e.content ? Buffer.from(e.content).toString() : undefined }))), { debounceMs: 60 });
    await new Promise((r) => setTimeout(r, 400));
    fs.writeFileSync(path.join(dir, 'new.tex'), 'v1');
    fs.writeFileSync(path.join(dir, 'ignored.log'), 'x');
    await new Promise((r) => setTimeout(r, 900));
    fs.rmSync(path.join(dir, 'new.tex'));
    await new Promise((r) => setTimeout(r, 900));
    await w.close();
    const flat = batches.flat();
    expect(flat).toContainEqual({ type: 'add', path: 'new.tex', text: 'v1' });
    expect(flat).toContainEqual({ type: 'unlink', path: 'new.tex', text: undefined });
    expect(flat.some((e) => e.path === 'ignored.log')).toBe(false);
  }, 10_000);
});

describe('MCP client snippets', () => {
  it('renders configs for every client', () => {
    const s = clientConfigSnippets({ url: 'http://127.0.0.1:4317/mcp', token: 'TOKEN' });
    expect(s.map((x) => x.id)).toEqual(['claude-code', 'codex', 'cursor', 'vscode', 'gemini']);
    expect(s[0].snippet).toBe('claude mcp add --transport http texit http://127.0.0.1:4317/mcp --header "Authorization: Bearer TOKEN"');
    expect(s[1].snippet).toContain('[mcp_servers.texit]');
    expect(s[1].snippet).toContain('http_headers = { "Authorization" = "Bearer TOKEN" }');
    expect(JSON.parse(s[2].snippet)).toEqual({ mcpServers: { texit: { url: 'http://127.0.0.1:4317/mcp', headers: { Authorization: 'Bearer TOKEN' } } } });
    expect(JSON.parse(s[3].snippet).servers.texit.type).toBe('http');
    expect(JSON.parse(s[4].snippet).mcpServers.texit.httpUrl).toBe('http://127.0.0.1:4317/mcp');
  });
});
