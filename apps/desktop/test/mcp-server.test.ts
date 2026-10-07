import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { normalizeSchema, TexitMcpServer } from '../src/main/mcp/server';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'texit-mcp-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('TexitMcpServer', () => {
  const server = new TexitMcpServer({ tokenFile: path.join(dir, 'token'), version: '0.0.0-test', timeoutMs: 300 });
  afterAll(() => server.stop());

  it('serves tools over Streamable HTTP with bearer auth and forwards calls', async () => {
    server.setTools([
      { name: 'read_file', description: 'Read a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
      { name: 'slow', description: 'Never answered', inputSchema: {} },
    ]);
    server.setDispatcher((call) => {
      if (call.tool === 'read_file') setTimeout(() => server.respond(call.callId, { content: [{ type: 'text', text: `content of ${call.args.path}` }] }), 5);
      return true;
    });
    const info = await server.start({ port: 0 });
    expect(info.running).toBe(true);
    expect(info.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(fs.statSync(path.join(dir, 'token')).mode & 0o777).toBe(0o600);

    // Unauthorized / wrong host.
    const unauth = await fetch(info.url!, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(unauth.status).toBe(401);
    const badOrigin = await fetch(info.url!, { method: 'POST', headers: { origin: 'https://evil.example', authorization: `Bearer ${info.token}` }, body: '{}' });
    expect(badOrigin.status).toBe(403);

    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(info.url!), { requestInit: { headers: { Authorization: `Bearer ${info.token}` } } }));
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toEqual(['read_file', 'slow']);
    expect(tools.tools[1].inputSchema).toEqual({ type: 'object' });

    const r = await client.callTool({ name: 'read_file', arguments: { path: 'main.tex' } });
    expect(r.content).toEqual([{ type: 'text', text: 'content of main.tex' }]);

    const slow = await client.callTool({ name: 'slow', arguments: {} });
    expect(slow.isError).toBe(true);
    expect((slow.content as any)[0].text).toMatch(/did not answer/);

    server.setDispatcher(() => false);
    const noRenderer = await client.callTool({ name: 'read_file', arguments: {} });
    expect(noRenderer.isError).toBe(true);
    await client.close();
  });

  it('reuses the persisted token and falls back to a free port', async () => {
    const info = server.info();
    const other = new TexitMcpServer({ tokenFile: path.join(dir, 'token'), version: 'x' });
    const info2 = await other.start({ port: info.port });
    expect(info2.port).not.toBe(info.port);
    expect(info2.token).toBe(info.token);
    await other.stop();
    expect(other.info().running).toBe(false);
  });

  it('normalises schemas', () => {
    expect(normalizeSchema(undefined)).toEqual({ type: 'object', properties: {} });
    expect(normalizeSchema({ properties: { a: {} } })).toEqual({ type: 'object', properties: { a: {} } });
    expect(normalizeSchema({ type: 'string' })).toEqual({ type: 'object', properties: {} });
  });
});
