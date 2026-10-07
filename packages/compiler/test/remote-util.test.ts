import { describe, expect, it } from 'vitest';
import { RemoteBackend } from '../src/remote/backend';
import { decodeRemoteFiles, encodeRemoteFiles, type RemoteCompileRequestBody } from '../src/remote/protocol';
import { base64ToBytes, bytesToBase64, stripBuildArtifacts } from '../src/util';

describe('base64', () => {
  it('round-trips arbitrary bytes and matches Buffer', () => {
    for (const len of [0, 1, 2, 3, 4, 5, 100, 100_001]) {
      const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37 + 11) & 255);
      const b64 = bytesToBase64(bytes);
      expect(b64).toBe(Buffer.from(bytes).toString('base64'));
      expect(base64ToBytes(b64)).toEqual(bytes);
    }
  });
});

describe('stripBuildArtifacts', () => {
  it('drops stale outputs of the main job but keeps .bbl and other files', () => {
    const files = ['src/main.tex', 'src/main.aux', 'src/main.pdf', 'src/main.bbl', 'src/main.synctex.gz', 'figs/main.pdf', 'other.aux'].map((path) => ({ path, content: '' }));
    expect(stripBuildArtifacts(files, 'src/main.tex').map((f) => f.path)).toEqual(['src/main.tex', 'src/main.bbl', 'figs/main.pdf', 'other.aux']);
  });
});

describe('remote protocol', () => {
  it('encodes text as text and binary as base64', () => {
    const enc = encodeRemoteFiles([{ path: 'a.tex', content: 'x' }, { path: 'b.png', content: new Uint8Array([1, 2, 3]) }]);
    expect(enc).toEqual([{ path: 'a.tex', text: 'x' }, { path: 'b.png', base64: 'AQID' }]);
    expect(decodeRemoteFiles(enc)[1].content).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('RemoteBackend posts the protocol body and decodes the result', async () => {
    let sent: { url: string; init: RequestInit } | undefined;
    const fetchFn = (async (url: string, init: RequestInit = {}) => {
      if (url.endsWith('/v1/info')) {
        return Response.json({ protocol: 1, name: 'srv', version: '1', engines: ['pdflatex'], drivers: ['latexmk'], auth: 'bearer', limits: { maxRequestBytes: 1, timeoutMs: 1, maxFiles: 1 } });
      }
      sent = { url, init };
      return Response.json({ status: 'success', pdfBase64: bytesToBase64(new TextEncoder().encode('%PDF-1.7')), synctexBase64: 'AQID', log: 'ok', buildDir: '/tmp/job' });
    }) as unknown as typeof fetch;
    const b = new RemoteBackend({ url: 'https://srv.example/', token: 't0k', fetch: fetchFn });
    expect(await b.status()).toMatchObject({ available: true });
    expect(b.engines).toEqual(['pdflatex']);
    const r = await b.compile({ files: [{ path: 'main.tex', content: 'x' }], mainPath: 'main.tex', engine: 'pdflatex', bibTool: 'auto', synctex: true, projectId: 'p' });
    expect(r).toMatchObject({ status: 'success', log: 'ok', buildDir: '/tmp/job', backendId: 'remote' });
    expect(new TextDecoder().decode(r.pdf)).toBe('%PDF-1.7');
    expect(sent?.url).toBe('https://srv.example/v1/compile');
    expect((sent?.init.headers as Record<string, string>).Authorization).toBe('Bearer t0k');
    const body = JSON.parse(String(sent?.init.body)) as RemoteCompileRequestBody;
    expect(body).toMatchObject({ protocol: 1, mainPath: 'main.tex', engine: 'pdflatex', files: [{ path: 'main.tex', text: 'x' }] });
  });

  it('RemoteBackend reports HTTP errors, network errors and missing config', async () => {
    const reject = (async () => Response.json({ error: { code: 'unauthorized', message: 'bad token' } }, { status: 401 })) as unknown as typeof fetch;
    const req = { files: [], mainPath: 'main.tex', engine: 'pdflatex' as const, bibTool: 'auto' as const, synctex: false, projectId: 'p' };
    expect((await new RemoteBackend({ url: 'http://x', fetch: reject }).compile(req)).log).toMatch(/401.*unauthorized: bad token/);
    const down = (async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const r = await new RemoteBackend({ url: 'http://x', fetch: down }).compile(req);
    expect(r.status).toBe('error');
    expect(r.log).toMatch(/Could not reach/);
    expect(await new RemoteBackend({ url: '' }).status()).toMatchObject({ available: false });
  });
});
